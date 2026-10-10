// 写真の追加(複数可)と、日付・タグの編集
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, back, home } from '../nav.js';
import { busy, confirmDialog, alertDialog, toast } from '../ui.js';
import { state, tagsOf, getPhoto, addPhoto, updatePhoto, deletePhoto, thumbURL } from '../store.js';
import { processImage } from '../image.js';
import { ymd, isYmd, savePref } from '../util.js';
import { topbar, tagChips } from './common.js';

export function render(root, { name, id }) {
  if (name === 'edit') {
    const photo = getPhoto(id);
    if (!photo) return home();
    // タグ管理から戻ってきた時は入力途中の内容を使う
    if (state.draft?.mode !== 'edit' || state.draft.id !== id) {
      state.draft = {
        mode: 'edit',
        id,
        items: [{ key: id, date: photo.date, previewURL: thumbURL(photo) }],
        partTagIds: new Set(photo.partTagIds),
        poseTagId: new Set(photo.poseTagId ? [photo.poseTagId] : []),
      };
    }
  } else if (state.draft?.mode !== 'add') {
    return home();
  }

  const draft = state.draft;
  const isAdd = draft.mode === 'add';
  const urls = [];

  const items = draft.items.map((item) => {
    let src = item.previewURL;
    if (!src) {
      src = URL.createObjectURL(item.file);
      urls.push(src);
    }
    return h('div', { class: 'draft-item' },
      h('img', { src, alt: '', decoding: 'async' }),
      h('label', { class: 'field' },
        h('span', {}, '日付'),
        h('input', {
          class: 'input', type: 'date', value: item.date, max: ymd(),
          onchange: (e) => { if (isYmd(e.target.value)) item.date = e.target.value; },
        })));
  });

  let saving = false;
  const save = async () => {
    if (saving) return;
    saving = true;
    const partTagIds = tagsOf('part').map((t) => t.id).filter((t) => draft.partTagIds.has(t));
    const poseTagId = [...draft.poseTagId][0] ?? null;
    savePref('lastTags', { parts: partTagIds, pose: poseTagId });

    if (!isAdd) {
      try {
        await updatePhoto(draft.id, { date: draft.items[0].date, partTagIds, poseTagId });
      } catch (e) {
        saving = false;
        await alertDialog(e.message);
        return;
      }
      state.draft = null;
      toast('保存しました');
      back('#/photo/' + draft.id);
      return;
    }

    const progress = busy('保存中…');
    let saved = 0;
    const errors = [];
    try {
      for (const [i, item] of draft.items.entries()) {
        progress.update(`保存中… ${i + 1} / ${draft.items.length}`);
        try {
          const processed = await processImage(item.file);
          await addPhoto({ date: item.date, partTagIds, poseTagId, ...processed });
          saved++;
        } catch (e) {
          errors.push(e.message);
          if (/容量/.test(e.message)) break;
        }
      }
    } finally {
      progress.close();
    }
    if (errors.length) {
      await alertDialog(`${saved}枚保存しました。${errors.length}枚は保存できませんでした。\n${errors[0]}`);
    } else {
      toast(`${saved}枚保存しました`);
    }
    state.draft = null;
    home();
  };

  const remove = async () => {
    if (!(await confirmDialog('この写真を削除しますか?元に戻せません。', { ok: '削除', danger: true }))) return;
    await deletePhoto(draft.id);
    state.draft = null;
    toast('削除しました');
    home();
  };

  root.append(
    topbar(isAdd ? `写真を追加(${draft.items.length}枚)` : '写真を編集', { backTo: '#/' }),
    h('div', { class: 'page' },
      h('div', { class: 'draft-items' }, items),
      h('section', { class: 'card' },
        h('div', { class: 'section-head' },
          h('h2', {}, '部位'),
          h('span', { class: 'muted small' }, '複数選べます')),
        tagChips(tagsOf('part'), draft.partTagIds),
        h('div', { class: 'section-head' },
          h('h2', {}, 'ポーズ')),
        tagChips(tagsOf('pose'), draft.poseTagId, { multi: false }),
        h('button', { class: 'link-btn', onclick: () => navigate('#/tags') }, icon('tag'), 'タグを追加・編集')),
      isAdd && draft.items.length > 1
        ? h('p', { class: 'muted small' }, '選んだタグはすべての写真に付きます。日付は1枚ずつ変えられます。')
        : null,
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-primary btn-block', onclick: save }, '保存'),
        !isAdd ? h('button', { class: 'btn btn-danger-outline btn-block', onclick: remove }, icon('trash'), 'この写真を削除') : null)),
  );

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
