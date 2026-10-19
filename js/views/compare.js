// 比較画面: 「並べる」は左で他の写真を左右スワイプ・右に固定写真。
// 「重ねる」は固定写真の上に半透明で重ね、指で位置・大きさ・角度を合わせられる
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, home } from '../nav.js';
import { state, getPhoto, sortPhotos, matchesFilter, tagName } from '../store.js';
import { createSwiper } from '../swiper.js';
import { formatDate, daysBetween, relativeLabel, loadPref, savePref } from '../util.js';
import { topbar, lazyPhoto } from './common.js';

// 固定を入れ替えた直後に、元の固定写真を表示するため
let focusId = null;
// 重ねたときの位置合わせ(固定写真と相手の組ごと、アプリを閉じるまで覚えておく)
const adjustments = new Map();

export function render(root, { id }) {
  const pinned = getPhoto(id);
  if (!pinned) return home();

  const cleanups = [];
  let samePose = loadPref('compareSamePose', true);
  let overlay = loadPref('compareOverlay', false);
  // モードを切り替えても同じ写真を表示し続けるため
  let currentId = focusId;
  focusId = null;
  const body = h('div', { class: 'compare' });

  const toggle = h('button', {
    class: 'chip small',
    onclick: () => {
      samePose = !samePose;
      savePref('compareSamePose', samePose);
      draw();
    },
  }, '同じポーズのみ');

  const modeBtn = h('button', {
    class: 'chip small with-icon',
    onclick: () => {
      overlay = !overlay;
      savePref('compareOverlay', overlay);
      draw();
    },
  }, icon('layers'), '重ねる');

  const candidates = () => {
    const usePose = samePose && pinned.poseTagId;
    const filter = { ...state.filter, poses: usePose ? [pinned.poseTagId] : state.filter.poses };
    return sortPhotos(state.photos.filter((p) => p.id !== pinned.id && matchesFilter(p, filter)), 'asc');
  };

  const draw = () => {
    while (cleanups.length) cleanups.pop()();
    toggle.classList.toggle('on', samePose);
    toggle.hidden = !pinned.poseTagId;
    modeBtn.classList.toggle('on', overlay);
    modeBtn.setAttribute('aria-pressed', String(overlay));
    const list = candidates();
    const found = currentId ? list.findIndex((p) => p.id === currentId) : -1;
    const startIndex = found >= 0 ? found : Math.max(0, list.length - 1);
    const onShow = (p) => {
      currentId = p.id;
    };
    body.classList.toggle('is-overlay', overlay && list.length > 0);
    if (!list.length) body.replaceChildren(emptyPane(pinned));
    else if (overlay) body.replaceChildren(...overlayView(pinned, list, startIndex, onShow, cleanups));
    else body.replaceChildren(...sideBySide(pinned, list, startIndex, onShow, cleanups));
  };

  root.append(
    topbar('比較', { backTo: '#/photo/' + id, actions: [toggle, modeBtn] }),
    body,
  );
  draw();

  return () => {
    while (cleanups.length) cleanups.pop()();
  };
}

function caption(photo, sub) {
  const tags = [...photo.partTagIds.map(tagName), tagName(photo.poseTagId)].filter(Boolean).join('・');
  return h('div', { class: 'caption' },
    h('div', { class: 'caption-date' }, formatDate(photo.date)),
    h('div', { class: 'caption-sub' }, sub, tags ? h('span', { class: 'caption-tags' }, tags) : null));
}

function relLabel(pinned, p) {
  const days = daysBetween(pinned.date, p.date);
  return h('span', { class: 'rel' + (days > 0 ? ' plus' : days < 0 ? ' minus' : '') }, relativeLabel(days));
}

function pinButton(pinned, p) {
  return h('button', {
    class: 'pin-btn',
    onclick: () => {
      focusId = pinned.id;
      navigate('#/compare/' + p.id, { replace: true });
    },
  }, icon('pin'), 'これを固定');
}

function emptyPane(pinned) {
  return h('section', { class: 'pane pane-empty' },
    h('p', {}, '比較できる写真がありません'),
    h('p', { class: 'muted small' }, pinned.poseTagId
      ? '「同じポーズのみ」を外すか、一覧の絞り込みを解除してください。'
      : '一覧の絞り込みを解除するか、写真を追加してください。'));
}

function pinnedPane(pinned, cleanups) {
  const pic = lazyPhoto(pinned);
  pic.load();
  cleanups.push(() => pic.unload());
  return h('section', { class: 'pane pane-pinned' },
    pic.img,
    h('span', { class: 'pin-badge' }, icon('pin'), '固定'),
    caption(pinned, '基準の写真'));
}

/* ---------- 並べる: 左がスワイプ、右が固定 ---------- */
function sideBySide(pinned, list, startIndex, onShow, cleanups) {
  const counter = h('span', { class: 'counter' });
  const seek = list.length > 1 ? seekBar(pinned, list, startIndex, (i) => swiper.goTo(i, false, { loadDelay: 150 })) : null;
  const update = (i) => {
    counter.textContent = `${i + 1} / ${list.length}`;
    seek?.set(i);
    onShow(list[i]);
  };
  const swiper = createSwiper({
    count: list.length,
    index: startIndex,
    renderSlide: (i) => {
      const p = list[i];
      const pic = lazyPhoto(p);
      const el = h('div', { class: 'slide' },
        pic.img,
        pinButton(pinned, p),
        caption(p, relLabel(pinned, p)));
      return { el, load: pic.load, unload: pic.unload };
    },
    onChange: update,
  });
  update(startIndex);
  cleanups.push(() => swiper.destroy());

  const slider = h('section', { class: 'pane pane-slider' },
    swiper.el,
    counter,
    list.length > 1 ? h('p', { class: 'swipe-hint' }, '← スワイプ →') : null);
  const row = h('div', { class: 'compare-row' }, slider, pinnedPane(pinned, cleanups));
  return seek ? [row, seek.el] : [row];
}

/* ---------- 重ねる: 固定写真の上に半透明で重ねる ---------- */
function overlayView(pinned, list, startIndex, onShow, cleanups) {
  let index = startIndex;
  let pic = null;
  let loadTimer = 0;
  let frame = 0;
  let opacity = loadPref('compareOpacity', 0.5);
  let tf = null; // { x, y, s, r } x,y は表示枠に対する割合、r は度

  const basePic = lazyPhoto(pinned);
  basePic.load();
  basePic.img.classList.add('ov-base');

  const holder = h('div', { class: 'ov-top' });
  const pinSlot = h('div', { class: 'ov-pin-slot' });
  const capSlot = h('div', { class: 'ov-cap-slot' });
  const stage = h('section', { class: 'pane ov-stage' },
    basePic.img,
    holder,
    h('span', { class: 'pin-badge ov-badge' }, icon('pin'), '固定 ', formatDate(pinned.date)),
    pinSlot,
    capSlot);

  const apply = () => {
    frame = 0;
    holder.style.opacity = String(opacity);
    holder.style.transform =
      `translate(${tf.x * 100}%, ${tf.y * 100}%) rotate(${tf.r}deg) scale(${tf.s})`;
    sizeLabel.textContent = `${Math.round(tf.s * 100)}%`;
    angleLabel.textContent = `${tf.r.toFixed(1)}°`;
    size.value = String(Math.round(tf.s * 100));
    angle.value = String(tf.r);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  /* --- 調整スライダー --- */
  const opacityLabel = h('span', { class: 'ov-val' }, `${Math.round(opacity * 100)}%`);
  const opacityRange = h('input', {
    type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(opacity * 100)),
    'aria-label': '重ねる写真の濃さ',
    oninput: () => {
      opacity = Number(opacityRange.value) / 100;
      opacityLabel.textContent = `${opacityRange.value}%`;
      savePref('compareOpacity', opacity);
      schedule();
    },
  });
  const sizeLabel = h('span', { class: 'ov-val' });
  const size = h('input', {
    type: 'range', min: '50', max: '200', step: '1',
    'aria-label': '重ねる写真の大きさ',
    oninput: () => {
      tf.s = Number(size.value) / 100;
      schedule();
    },
  });
  const angleLabel = h('span', { class: 'ov-val' });
  const angle = h('input', {
    type: 'range', min: '-45', max: '45', step: '0.5',
    'aria-label': '重ねる写真の角度',
    oninput: () => {
      tf.r = Number(angle.value);
      schedule();
    },
  });
  const ctrlRow = (label, range, val) => h('label', { class: 'ov-row' }, h('span', { class: 'ov-label' }, label), range, val);

  const counter = h('span', { class: 'ov-counter' });
  const prevBtn = h('button', { class: 'icon-btn', 'aria-label': '前の写真', onclick: () => show(index - 1, 0) }, icon('back'));
  const nextBtn = h('button', { class: 'icon-btn ov-next', 'aria-label': '次の写真', onclick: () => show(index + 1, 0) }, icon('back'));
  const controls = h('div', { class: 'ov-ctrl' },
    ctrlRow('濃さ', opacityRange, opacityLabel),
    ctrlRow('大きさ', size, sizeLabel),
    ctrlRow('角度', angle, angleLabel),
    h('div', { class: 'ov-actions' },
      prevBtn, counter, nextBtn,
      h('span', { class: 'ov-hint' }, 'ドラッグ・ピンチで調整'),
      h('button', {
        class: 'chip small',
        onclick: () => {
          Object.assign(tf, { x: 0, y: 0, s: 1, r: 0 });
          schedule();
        },
      }, 'リセット')));

  /* --- 写真の切り替え --- */
  const seek = list.length > 1 ? seekBar(pinned, list, startIndex, (i) => show(i, 150)) : null;
  const show = (i, loadDelay) => {
    i = Math.max(0, Math.min(list.length - 1, i));
    if (pic && i === index) return;
    index = i;
    const p = list[i];
    pic?.unload();
    pic = lazyPhoto(p);
    holder.replaceChildren(pic.img);
    clearTimeout(loadTimer);
    if (loadDelay) loadTimer = setTimeout(pic.load, loadDelay);
    else pic.load();
    const key = pinned.id + '>' + p.id;
    if (!adjustments.has(key)) adjustments.set(key, { x: 0, y: 0, s: 1, r: 0 });
    tf = adjustments.get(key);
    pinSlot.replaceChildren(pinButton(pinned, p));
    capSlot.replaceChildren(caption(p, relLabel(pinned, p)));
    counter.textContent = `${i + 1} / ${list.length}`;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === list.length - 1;
    seek?.set(i);
    onShow(p);
    schedule();
  };
  show(startIndex, 0);

  /* --- 指での操作: 1本指で移動、2本指で拡大縮小と回転 --- */
  const pointers = new Map();
  let start = null;
  const rebase = () => {
    const pts = [...pointers.values()];
    const rect = stage.getBoundingClientRect();
    start = null;
    if (!pts.length) return;
    const t = { ...tf };
    if (pts.length === 1) {
      start = { t, x: pts[0].x, y: pts[0].y, w: rect.width, h: rect.height };
    } else {
      const [a, b] = pts;
      start = {
        t, w: rect.width, h: rect.height,
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        a: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !start) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      tf.x = start.t.x + (pts[0].x - start.x) / start.w;
      tf.y = start.t.y + (pts[0].y - start.y) / start.h;
    } else {
      const [a, b] = pts;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let da = Math.atan2(b.y - a.y, b.x - a.x) - start.a;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      tf.s = Math.max(0.2, Math.min(5, start.t.s * (d / start.d)));
      tf.r = Math.round((start.t.r + (da * 180) / Math.PI) * 10) / 10;
      tf.x = start.t.x + ((a.x + b.x) / 2 - start.x) / start.w;
      tf.y = start.t.y + ((a.y + b.y) / 2 - start.y) / start.h;
    }
    schedule();
  });
  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    rebase();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  const onKey = (e) => {
    if (e.target.closest?.('input')) return;
    if (e.key === 'ArrowLeft') show(index - 1, 0);
    if (e.key === 'ArrowRight') show(index + 1, 0);
  };
  window.addEventListener('keydown', onKey);

  cleanups.push(() => {
    clearTimeout(loadTimer);
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKey);
    basePic.unload();
    pic?.unload();
  });

  return seek ? [stage, controls, seek.el] : [stage, controls];
}

// シークバー: つまみを動かすと写真が連続で切り替わる(日付順、左が古い)
function seekBar(pinned, list, index, onSeek) {
  const max = list.length - 1;
  const range = h('input', {
    type: 'range', min: '0', max: String(max), step: '1', value: String(index),
    'aria-label': '写真を選ぶ',
    oninput: () => onSeek(Number(range.value)),
  });
  // 固定写真の日付が、並びのどのあたりかを印で示す
  const before = list.filter((p) => p.date < pinned.date || (p.date === pinned.date && p.createdAt < pinned.createdAt)).length;
  const markPos = Math.min(100, Math.max(0, ((before - 0.5) / max) * 100));
  const short = (d) => formatDate(d).slice(2);
  return {
    el: h('div', { class: 'seek' },
      h('span', { class: 'seek-date' }, short(list[0].date)),
      h('div', { class: 'seek-track' },
        h('span', { class: 'seek-mark', style: `left:${markPos}%`, title: '固定写真の位置' }),
        range),
      h('span', { class: 'seek-date' }, short(list[max].date))),
    set(i) {
      range.value = String(i);
    },
  };
}
