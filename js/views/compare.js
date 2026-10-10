// 比較画面: 上半分に固定写真、下半分で他の写真を左右スワイプ
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, home } from '../nav.js';
import { state, getPhoto, getImageBlob, sortPhotos, matchesFilter, tagName, thumbURL } from '../store.js';
import { formatDate, daysBetween, relativeLabel, loadPref, savePref } from '../util.js';
import { topbar } from './common.js';

// 固定を入れ替えた直後に、下段で元の固定写真を表示するため
let focusId = null;

export function render(root, { id }) {
  const pinned = getPhoto(id);
  if (!pinned) return home();

  const cleanups = [];
  let samePose = loadPref('compareSamePose', true);
  const body = h('div', { class: 'compare' });

  const toggle = h('button', {
    class: 'chip small',
    onclick: () => {
      samePose = !samePose;
      savePref('compareSamePose', samePose);
      draw();
    },
  }, '同じポーズのみ');

  const candidates = () => {
    const usePose = samePose && pinned.poseTagId;
    const filter = { ...state.filter, poses: usePose ? [pinned.poseTagId] : state.filter.poses };
    return sortPhotos(state.photos.filter((p) => p.id !== pinned.id && matchesFilter(p, filter)), 'asc');
  };

  const draw = () => {
    while (cleanups.length) cleanups.pop()();
    toggle.classList.toggle('on', samePose);
    toggle.hidden = !pinned.poseTagId;
    const list = candidates();
    const startIndex = Math.max(0, focusId ? list.findIndex((p) => p.id === focusId) : list.length - 1);
    focusId = null;
    body.replaceChildren(pinnedPane(pinned, cleanups), sliderPane(pinned, list, startIndex, cleanups));
  };

  root.append(
    topbar('比較', { backTo: '#/photo/' + id, actions: [toggle] }),
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

// サムネイルを先に表示し、大きい画像を後から読み込む
function photoImage(photo) {
  const img = h('img', { src: thumbURL(photo), alt: '', decoding: 'async', draggable: 'false' });
  let url = null;
  let wanted = false;
  return {
    img,
    async load() {
      if (wanted) return;
      wanted = true;
      const blob = await getImageBlob(photo.id);
      if (!wanted || !blob || url) return;
      url = URL.createObjectURL(blob);
      img.src = url;
    },
    unload() {
      wanted = false;
      if (!url) return;
      img.src = thumbURL(photo);
      URL.revokeObjectURL(url);
      url = null;
    },
  };
}

function pinnedPane(pinned, cleanups) {
  const pic = photoImage(pinned);
  pic.load();
  cleanups.push(() => pic.unload());
  return h('section', { class: 'pane pane-pinned' },
    pic.img,
    h('span', { class: 'pin-badge' }, icon('pin'), '固定'),
    caption(pinned, '基準の写真'));
}

function sliderPane(pinned, list, startIndex, cleanups) {
  if (!list.length) {
    return h('section', { class: 'pane pane-empty' },
      h('p', {}, '比較できる写真がありません'),
      h('p', { class: 'muted small' }, pinned.poseTagId
        ? '「同じポーズのみ」を外すか、一覧の絞り込みを解除してください。'
        : '一覧の絞り込みを解除するか、写真を追加してください。'));
  }

  const counter = h('span', { class: 'counter' });
  const pics = [];
  const slides = list.map((p, i) => {
    const pic = photoImage(p);
    pics.push(pic);
    const days = daysBetween(pinned.date, p.date);
    return h('div', { class: 'slide', 'data-index': i },
      pic.img,
      h('button', {
        class: 'pin-btn',
        onclick: () => {
          focusId = pinned.id;
          navigate('#/compare/' + p.id, { replace: true });
        },
      }, icon('pin'), 'これを固定'),
      caption(p, h('span', { class: 'rel' + (days > 0 ? ' plus' : days < 0 ? ' minus' : '') }, relativeLabel(days))));
  });
  const track = h('div', { class: 'track' }, slides);

  // 表示中の前後だけ大きい画像を読み込む(メモリ節約)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const pic = pics[Number(e.target.dataset.index)];
      if (e.isIntersecting) pic.load();
      else pic.unload();
    }
  }, { root: track, rootMargin: '0px 100% 0px 100%' });
  slides.forEach((s) => io.observe(s));

  let index = startIndex;
  const updateCounter = () => {
    counter.textContent = `${index + 1} / ${list.length}`;
  };
  const onScroll = () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i !== index && i >= 0 && i < list.length) {
      index = i;
      updateCounter();
    }
  };
  const goTo = (i, smooth) => {
    index = Math.min(list.length - 1, Math.max(0, i));
    track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
    updateCounter();
  };
  const onResize = () => goTo(index, false);
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') goTo(index - 1, true);
    if (e.key === 'ArrowRight') goTo(index + 1, true);
  };

  track.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  requestAnimationFrame(() => goTo(startIndex, false));
  updateCounter();

  cleanups.push(() => {
    io.disconnect();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    pics.forEach((p) => p.unload());
  });

  return h('section', { class: 'pane pane-slider' },
    track,
    counter,
    list.length > 1 ? h('p', { class: 'swipe-hint' }, '← スワイプで切り替え →') : null);
}
