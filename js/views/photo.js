// 写真の詳細
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, home } from '../nav.js';
import { confirmDialog, toast } from '../ui.js';
import { getPhoto, getImageBlob, deletePhoto, tagName, thumbURL } from '../store.js';
import { formatDate } from '../util.js';
import { topbar, iconButton } from './common.js';

export function render(root, { id }) {
  const photo = getPhoto(id);
  if (!photo) return home();

  let url = null;
  let alive = true;
  // まずサムネイルを出し、大きい画像が読めたら差し替える
  const img = h('img', { class: 'detail-img', src: thumbURL(photo), alt: '', style: `aspect-ratio:${photo.width}/${photo.height}` });
  getImageBlob(id).then((blob) => {
    if (!blob || !alive) return;
    url = URL.createObjectURL(blob);
    img.src = url;
  });

  const remove = async () => {
    if (!(await confirmDialog('この写真を削除しますか?元に戻せません。', { ok: '削除', danger: true }))) return;
    await deletePhoto(id);
    toast('削除しました');
    home();
  };

  const parts = photo.partTagIds.map(tagName).filter(Boolean);
  const pose = tagName(photo.poseTagId);

  root.append(
    topbar(formatDate(photo.date), {
      backTo: '#/',
      actions: [
        iconButton('edit', '編集', () => navigate('#/edit/' + id)),
        iconButton('trash', '削除', remove),
      ],
    }),
    h('div', { class: 'detail' },
      img,
      h('div', { class: 'detail-info' },
        h('div', { class: 'chips' },
          parts.map((n) => h('span', { class: 'chip small static' }, n)),
          pose ? h('span', { class: 'chip small static pose' }, pose) : null,
          !parts.length && !pose ? h('span', { class: 'muted small' }, 'タグなし') : null)),
      h('div', { class: 'stack page' },
        h('button', { class: 'btn btn-primary btn-block', onclick: () => navigate('#/compare/' + id) },
          icon('pin'), 'この写真を固定して比較'))),
  );

  return () => {
    alive = false;
    if (url) URL.revokeObjectURL(url);
  };
}
