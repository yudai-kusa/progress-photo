// 画面共通の部品
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { back } from '../nav.js';
import { getImageBlob, thumbURL } from '../store.js';

export function topbar(title, { backTo, actions = [] } = {}) {
  return h('header', { class: 'topbar' },
    backTo !== undefined
      ? h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back(backTo) }, icon('back'))
      : null,
    h('h1', {}, title),
    h('div', { class: 'topbar-actions' }, actions));
}

export function iconButton(name, label, onclick, extra = '') {
  return h('button', { class: 'icon-btn ' + extra, 'aria-label': label, title: label, onclick }, icon(name));
}

// タグ選択チップ。selected は Set、multi=false なら単一選択(もう一度押すと解除)
export function tagChips(tags, selected, { multi = true, onChange } = {}) {
  const wrap = h('div', { class: 'chips' });
  const draw = () => {
    wrap.replaceChildren(...tags.map((t) => h('button', {
      type: 'button',
      class: 'chip' + (selected.has(t.id) ? ' on' : ''),
      'aria-pressed': String(selected.has(t.id)),
      onclick: () => {
        if (selected.has(t.id)) selected.delete(t.id);
        else {
          if (!multi) selected.clear();
          selected.add(t.id);
        }
        draw();
        onChange?.();
      },
    }, t.name)));
    if (!tags.length) wrap.append(h('span', { class: 'muted small' }, 'タグがありません'));
  };
  draw();
  return wrap;
}

// Blob を表示する <img>。戻り値の revoke で URL を解放
export function blobImage(blob, attrs = {}) {
  const url = URL.createObjectURL(blob);
  const img = h('img', { src: url, alt: '', decoding: 'async', ...attrs });
  return { img, revoke: () => URL.revokeObjectURL(url) };
}

// サムネイルを先に表示し、大きい画像はデコードし終えてから差し替える(表示のカクつき防止)
export function lazyPhoto(photo) {
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
      const next = URL.createObjectURL(blob);
      const pre = new Image();
      pre.src = next;
      try {
        await pre.decode();
      } catch {
        // デコードに失敗してもそのまま表示を試みる
      }
      if (!wanted || url) {
        URL.revokeObjectURL(next);
        return;
      }
      url = next;
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
