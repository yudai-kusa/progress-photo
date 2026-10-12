// アプリ内カメラ(撮影ガイド付き)
//   ・撮影前に選んだタグの直近の写真を半透明で重ねる
//   ・逆さ撮りモード: 重ねる写真を180°回して表示し、撮った写真も180°回して保存
//   ・カメラの映像は端末内で処理するだけで、外部には送らない
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { back, navigate } from '../nav.js';
import { sheet } from '../ui.js';
import { state, sortPhotos, tagsOf, thumbURL } from '../store.js';
import { formatDate, ymd, uid, loadPref, savePref } from '../util.js';
import { tagChips, lazyPhoto } from './common.js';

const TIMERS = [0, 3, 10, 20];
// 縦向きで 3:4 になるよう 4:3 を希望する(実際の解像度は機種しだい)
const VIDEO = { width: { ideal: 1920 }, height: { ideal: 1440 } };

export function render(root) {
  if (!navigator.mediaDevices?.getUserMedia) {
    root.append(h('div', { class: 'cam-error-page' },
      h('p', {}, 'このブラウザではアプリ内カメラを使えません。'),
      h('button', { class: 'btn', onclick: () => back('#/') }, '戻る')));
    return;
  }

  const ids = new Set(state.tags.map((t) => t.id));
  const last = loadPref('lastTags', { parts: [], pose: null });
  const parts = new Set(last.parts.filter((id) => ids.has(id)));
  const pose = new Set(ids.has(last.pose) ? [last.pose] : []);

  let upside = loadPref('camUpsideDown', true);
  let opacity = loadPref('camOpacity', 0.4);
  let overlayOn = loadPref('camOverlay', true);
  let timer = loadPref('camTimer', 0);
  let manualOverlayId = null;
  let overlayPhoto = null;
  let overlayPic = null;
  let stream = null;
  let cameras = [];
  let currentId = loadPref('camDeviceId', null);
  let facing = 'environment';
  let alive = true;
  let reviewing = false;
  let countdown = 0;
  let wakeLock = null;

  /* ---------- 映像と重ね写真 ---------- */
  const video = h('video', { class: 'cam-video', autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const frame = h('div', { class: 'cam-frame' }, video);
  const countdownEl = h('div', { class: 'cam-countdown', hidden: true });
  const status = h('div', { class: 'cam-status' });
  const stage = h('div', { class: 'cam-stage' }, frame, countdownEl, status);

  // 映像の縦横比を保ったまま、表示エリアいっぱいに収める
  const fit = () => {
    const vw = video.videoWidth || 3;
    const vh = video.videoHeight || 4;
    const s = Math.min(stage.clientWidth / vw, stage.clientHeight / vh);
    frame.style.width = `${Math.floor(vw * s)}px`;
    frame.style.height = `${Math.floor(vh * s)}px`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  video.addEventListener('loadedmetadata', fit);
  video.addEventListener('resize', fit);

  // 端末が自動回転で上下逆の画面になっている場合は、すでに正しい向きなので回さない
  const flipped = () => upside && screen.orientation?.type !== 'portrait-secondary';

  /* ---------- 操作部 ---------- */
  const upsideBtn = h('button', { class: 'chip small', onclick: () => {
    upside = !upside;
    savePref('camUpsideDown', upside);
    apply();
  } });
  const overlayInfo = h('div', { class: 'cam-overlay-info' });
  const opacityInput = h('input', {
    type: 'range', min: '0.1', max: '0.9', step: '0.05', value: String(opacity), 'aria-label': '重ねる写真の濃さ',
    oninput: () => {
      opacity = Number(opacityInput.value);
      savePref('camOpacity', opacity);
      apply();
    },
  });
  const overlayBtn = h('button', { class: 'cam-small-btn', onclick: () => {
    overlayOn = !overlayOn;
    savePref('camOverlay', overlayOn);
    apply();
  } });
  const timerBtn = h('button', { class: 'cam-small-btn', onclick: () => {
    timer = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length];
    savePref('camTimer', timer);
    apply();
  } });
  const shutter = h('button', { class: 'shutter', 'aria-label': '撮影', onclick: () => shoot() });
  const switchBtn = h('button', { class: 'cam-small-btn', onclick: () => switchCamera() });
  const controls = h('div', { class: 'cam-controls' },
    h('div', { class: 'cam-row' }, overlayBtn, h('span', { class: 'cam-label' }, '濃さ'), opacityInput),
    h('div', { class: 'cam-row cam-row-main' }, timerBtn, shutter, switchBtn));

  const apply = () => {
    const mirror = facing === 'user';
    const f = flipped();
    video.style.transform = mirror ? 'scaleX(-1)' : '';
    if (overlayPic) {
      overlayPic.img.style.transform = [f && 'rotate(180deg)', mirror && 'scaleX(-1)'].filter(Boolean).join(' ') || 'none';
      overlayPic.img.style.opacity = overlayOn ? String(opacity) : '0';
    }
    controls.classList.toggle('flipped', f);
    countdownEl.classList.toggle('flipped', f);
    upsideBtn.classList.toggle('on', upside);
    upsideBtn.replaceChildren(icon('rotate'), upside ? '逆さ撮り ON' : '逆さ撮り OFF');
    overlayBtn.replaceChildren(icon('layers'), overlayOn ? '重ね ON' : '重ね OFF');
    overlayBtn.classList.toggle('on', overlayOn);
    opacityInput.disabled = !overlayOn || !overlayPhoto;
    timerBtn.replaceChildren(icon('timer'), timer ? `${timer}秒` : 'タイマー');
    timerBtn.classList.toggle('on', timer > 0);
  };

  /* ---------- 重ねる写真 ---------- */
  // ポーズが同じで、選んだ部位を1つ以上含む写真(新しい順)
  const candidates = () => {
    const poseId = [...pose][0];
    let list = state.photos;
    if (poseId) list = list.filter((p) => p.poseTagId === poseId);
    if (parts.size) list = list.filter((p) => p.partTagIds.some((t) => parts.has(t)));
    return sortPhotos(list, 'desc');
  };

  const setOverlay = (photo) => {
    if (overlayPic) {
      overlayPic.unload();
      overlayPic.img.remove();
    }
    overlayPhoto = photo;
    overlayPic = null;
    if (photo) {
      overlayPic = lazyPhoto(photo);
      overlayPic.img.classList.add('cam-overlay');
      frame.append(overlayPic.img);
      overlayPic.load();
    }
    overlayInfo.replaceChildren(
      h('span', {}, photo ? `重ねる写真: ${formatDate(photo.date)}` : state.photos.length ? '同じタグの写真がありません' : 'まだ写真がありません'),
      state.photos.length ? h('button', { class: 'link-btn', onclick: pickOverlay }, photo ? '変更' : '選ぶ') : null);
    apply();
  };

  const refreshOverlay = () => {
    const manual = manualOverlayId && state.photos.find((p) => p.id === manualOverlayId);
    setOverlay(manual || candidates()[0] || null);
  };

  const onTagsChange = () => {
    manualOverlayId = null;
    savePref('lastTags', { parts: tagsOf('part').map((t) => t.id).filter((id) => parts.has(id)), pose: [...pose][0] ?? null });
    refreshOverlay();
  };

  const pickOverlay = () => {
    let showAll = !candidates().length;
    let close;
    const grid = h('div', { class: 'pick-grid' });
    const toggle = h('button', { class: 'link-btn', onclick: () => { showAll = !showAll; draw(); } });
    const draw = () => {
      const list = showAll ? sortPhotos(state.photos, 'desc') : candidates();
      grid.replaceChildren(...list.map((p) => h('button', {
        class: 'cell' + (p.id === overlayPhoto?.id ? ' on' : ''),
        onclick: () => {
          manualOverlayId = p.id;
          setOverlay(p);
          close();
        },
      }, h('img', { src: thumbURL(p), alt: '', loading: 'lazy' }), h('span', { class: 'cell-label' }, formatDate(p.date).slice(2)))));
      if (!list.length) grid.append(h('p', { class: 'muted small' }, '同じタグの写真がありません'));
      toggle.textContent = showAll ? '同じタグの写真だけ表示' : 'すべての写真から選ぶ';
    };
    close = sheet([
      h('p', { class: 'sheet-title' }, '重ねる写真を選ぶ'),
      grid,
      toggle,
      overlayPhoto ? h('button', { class: 'sheet-btn', onclick: () => { manualOverlayId = null; setOverlay(null); close(); } }, '重ねない') : null,
    ]);
    draw();
  };

  /* ---------- カメラ ---------- */
  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  };

  const showStatus = (message, retry) => {
    status.replaceChildren(...(message ? [h('p', {}, message), retry ? h('button', { class: 'btn btn-sm', onclick: () => start(currentId) }, 'もう一度試す') : null] : []));
    status.hidden = !message;
  };

  const start = async (deviceId) => {
    stop();
    showStatus('カメラを起動中…');
    const get = (v) => navigator.mediaDevices.getUserMedia({ video: v, audio: false });
    try {
      let s = null;
      if (deviceId) {
        try {
          s = await get({ ...VIDEO, deviceId: { exact: deviceId } });
        } catch (e) {
          if (e.name === 'NotAllowedError') throw e;
        }
      }
      s ??= await get({ ...VIDEO, facingMode: { ideal: 'environment' } });
      if (!alive || reviewing || document.hidden) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      await video.play().catch(() => {});
      const settings = s.getVideoTracks()[0].getSettings();
      currentId = settings.deviceId ?? null;
      cameras = await listCameras();
      facing = settings.facingMode || cameras.find((c) => c.deviceId === currentId)?.facing || 'environment';
      if (currentId) savePref('camDeviceId', currentId);
      updateSwitch();
      showStatus('');
      apply();
      fit();
      requestWakeLock();
    } catch (e) {
      showStatus(cameraErrorMessage(e), e.name !== 'NotFoundError');
    }
  };

  const updateSwitch = () => {
    switchBtn.hidden = cameras.length < 2;
    const backs = cameras.filter((c) => c.facing === 'environment');
    const i = backs.findIndex((c) => c.deviceId === currentId);
    const label = facing === 'user' ? '前面' : backs.length > 1 && i >= 0 ? `背面 ${i + 1}/${backs.length}` : '背面';
    switchBtn.replaceChildren(icon('switchCam'), label);
  };

  const switchCamera = () => {
    if (cameras.length < 2 || countdown) return;
    const i = cameras.findIndex((c) => c.deviceId === currentId);
    start(cameras[(i + 1) % cameras.length].deviceId);
  };

  const requestWakeLock = async () => {
    try {
      if (!wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* 非対応・拒否は無視 */ }
  };

  /* ---------- 撮影 ---------- */
  const cancelCountdown = () => {
    clearInterval(countdown);
    countdown = 0;
    countdownEl.hidden = true;
    shutter.classList.remove('counting');
  };

  const shoot = () => {
    if (countdown) {
      cancelCountdown();
      return;
    }
    if (!stream || !video.videoWidth) return;
    if (!timer) {
      capture();
      return;
    }
    let n = timer;
    countdownEl.textContent = String(n);
    countdownEl.hidden = false;
    shutter.classList.add('counting');
    countdown = setInterval(() => {
      n--;
      if (n > 0) {
        countdownEl.textContent = String(n);
      } else {
        cancelCountdown();
        capture();
      }
    }, 1000);
  };

  const capture = async () => {
    const w = video.videoWidth;
    const hh = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hh;
    const ctx = canvas.getContext('2d');
    if (flipped()) {
      ctx.translate(w, hh);
      ctx.rotate(Math.PI);
    }
    ctx.drawImage(video, 0, 0, w, hh);
    stage.classList.remove('flash');
    void stage.offsetWidth;
    stage.classList.add('flash');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    canvas.width = canvas.height = 0;
    if (!blob || !alive) return;
    showReview(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  };

  const showReview = (file) => {
    reviewing = true;
    video.pause();
    const url = URL.createObjectURL(file);
    let el;
    const retake = () => {
      el.remove();
      URL.revokeObjectURL(url);
      reviewing = false;
      if (stream) video.play().catch(() => {});
      else start(currentId);
    };
    const use = () => {
      stop();
      state.draft = {
        mode: 'add',
        items: [{ key: uid(), file, date: ymd() }],
        partTagIds: new Set(parts),
        poseTagId: new Set(pose),
      };
      navigate('#/add', { replace: true });
    };
    el = h('div', { class: 'cam-review' },
      h('img', { src: url, alt: '撮影した写真' }),
      h('div', { class: 'cam-review-bar' },
        h('button', { class: 'btn', onclick: retake }, '撮り直す'),
        h('button', { class: 'btn btn-primary', onclick: use }, 'これを使う')));
    root.append(el);
    cleanups.push(() => URL.revokeObjectURL(url));
  };

  /* ---------- 画面の組み立て ---------- */
  root.append(
    h('div', { class: 'cam-top' },
      h('div', { class: 'cam-top-row' },
        h('button', { class: 'icon-btn', 'aria-label': '閉じる', onclick: () => back('#/') }, icon('close')),
        h('div', { class: 'cam-tags' },
          tagRow('部位', tagChips(tagsOf('part'), parts, { onChange: onTagsChange })),
          tagRow('ポーズ', tagChips(tagsOf('pose'), pose, { multi: false, onChange: onTagsChange })))),
      h('div', { class: 'cam-top-row cam-top-sub' }, overlayInfo, upsideBtn)),
    stage,
    controls,
  );

  const onVisibility = () => {
    if (document.hidden) {
      cancelCountdown();
      stop();
    } else if (!reviewing) {
      start(currentId);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  screen.orientation?.addEventListener?.('change', apply);

  const cleanups = [];
  refreshOverlay();
  start(currentId);

  return () => {
    alive = false;
    cancelCountdown();
    stop();
    ro.disconnect();
    overlayPic?.unload();
    wakeLock?.release().catch(() => {});
    document.removeEventListener('visibilitychange', onVisibility);
    screen.orientation?.removeEventListener?.('change', apply);
    cleanups.forEach((f) => f());
  };
}

function tagRow(label, chips) {
  chips.classList.add('scroll');
  return h('div', { class: 'cam-tag-row' }, h('span', { class: 'filter-label' }, label), chips);
}

// 背面カメラを先、前面カメラを後に並べる
async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput' && d.deviceId);
  const cams = devices.map((d) => ({
    deviceId: d.deviceId,
    facing: /front|user|前面|フロント|イン/i.test(d.label) ? 'user' : 'environment',
  }));
  return [...cams.filter((c) => c.facing === 'environment'), ...cams.filter((c) => c.facing === 'user')];
}

function cameraErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
      return 'カメラの使用が許可されていません。Chrome のアドレスバー左のアイコン →「権限」→「カメラ」を許可してください。(ホーム画面のアプリの場合: アイコンを長押し →「アプリ情報」→「権限」→「カメラ」)';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'カメラが見つかりませんでした。';
    case 'NotReadableError':
      return 'カメラを起動できませんでした。他のアプリがカメラを使っていないか確認してください。';
    default:
      return `カメラを起動できませんでした。(${e?.message ?? e})`;
  }
}
