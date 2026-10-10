// 写真の詳細(左右スワイプで前後の写真へ)
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, home, setHash } from '../nav.js';
import { confirmDialog, toast } from '../ui.js';
import { state, getPhoto, deletePhoto, tagName, sortPhotos, matchesFilter } from '../store.js';
import { formatDate } from '../util.js';
import { createSwiper } from '../swiper.js';
import { topbar, iconButton, lazyPhoto } from './common.js';

export function render(root, { id }) {
  // 一覧と同じ絞り込み・並び順でスワイプできるようにする
  let photos = sortPhotos(state.photos.filter((p) => matchesFilter(p)), state.filter.order);
  let index = photos.findIndex((p) => p.id === id);
  if (index < 0) {
    const photo = getPhoto(id);
    if (!photo) return home();
    photos = [photo];
    index = 0;
  }
  const current = () => photos[index];

  const remove = async () => {
    if (!(await confirmDialog('この写真を削除しますか?元に戻せません。', { ok: '削除', danger: true }))) return;
    await deletePhoto(current().id);
    toast('削除しました');
    home();
  };

  const header = topbar('', {
    backTo: '#/',
    actions: [
      iconButton('edit', '編集', () => navigate('#/edit/' + current().id)),
      iconButton('trash', '削除', remove),
    ],
  });
  const title = header.querySelector('h1');
  const tags = h('div', { class: 'chips' });
  const counter = h('span', { class: 'muted small' });

  const update = () => {
    const photo = current();
    title.textContent = formatDate(photo.date);
    const parts = photo.partTagIds.map(tagName).filter(Boolean);
    const pose = tagName(photo.poseTagId);
    tags.replaceChildren(
      ...parts.map((n) => h('span', { class: 'chip small static' }, n)),
      pose ? h('span', { class: 'chip small static pose' }, pose) : '',
      !parts.length && !pose ? h('span', { class: 'muted small' }, 'タグなし') : '');
    counter.textContent = photos.length > 1 ? `${index + 1} / ${photos.length}` : '';
    setHash('#/photo/' + photo.id);
  };

  const swiper = createSwiper({
    count: photos.length,
    index,
    duration: 220,
    renderSlide: (i) => {
      const pic = lazyPhoto(photos[i]);
      return { el: h('div', {}, pic.img), load: pic.load, unload: pic.unload };
    },
    onChange: (i) => {
      index = i;
      update();
    },
  });
  swiper.el.classList.add('detail-swiper');
  update();

  root.append(
    header,
    h('div', { class: 'detail' },
      swiper.el,
      h('div', { class: 'detail-info' }, tags, counter),
      h('div', { class: 'stack page' },
        h('button', { class: 'btn btn-primary btn-block', onclick: () => navigate('#/compare/' + current().id) },
          icon('pin'), 'この写真を固定して比較'),
        photos.length > 1 ? h('p', { class: 'muted small center' }, '写真を左右にスワイプすると前後の写真に移ります') : null)),
  );

  return () => swiper.destroy();
}
