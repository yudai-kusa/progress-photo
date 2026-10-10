// 比較画面: 上半分に固定写真、下半分で他の写真を左右スワイプ
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, home } from '../nav.js';
import { state, getPhoto, sortPhotos, matchesFilter, tagName } from '../store.js';
import { createSwiper } from '../swiper.js';
import { formatDate, daysBetween, relativeLabel, loadPref, savePref } from '../util.js';
import { topbar, lazyPhoto } from './common.js';

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

function pinnedPane(pinned, cleanups) {
  const pic = lazyPhoto(pinned);
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
  const updateCounter = (i) => {
    counter.textContent = `${i + 1} / ${list.length}`;
  };
  const swiper = createSwiper({
    count: list.length,
    index: startIndex,
    renderSlide: (i) => {
      const p = list[i];
      const pic = lazyPhoto(p);
      const days = daysBetween(pinned.date, p.date);
      const el = h('div', { class: 'slide' },
        pic.img,
        h('button', {
          class: 'pin-btn',
          onclick: () => {
            focusId = pinned.id;
            navigate('#/compare/' + p.id, { replace: true });
          },
        }, icon('pin'), 'これを固定'),
        caption(p, h('span', { class: 'rel' + (days > 0 ? ' plus' : days < 0 ? ' minus' : '') }, relativeLabel(days))));
      return { el, load: pic.load, unload: pic.unload };
    },
    onChange: updateCounter,
  });
  updateCounter(startIndex);
  cleanups.push(() => swiper.destroy());

  return h('section', { class: 'pane pane-slider' },
    swiper.el,
    counter,
    list.length > 1 ? h('p', { class: 'swipe-hint' }, '← スワイプで切り替え →') : null);
}
