// タグ管理: 追加・名前変更・削除・並び替え
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { confirmDialog, promptDialog, alertDialog, toast } from '../ui.js';
import { tagsOf, addTag, renameTag, deleteTag, moveTag, tagUsage, TAG_TYPES } from '../store.js';
import { loadPref, savePref } from '../util.js';
import { topbar } from './common.js';

export function render(root) {
  let type = loadPref('tagTab', 'part');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const listBox = h('ul', { class: 'tag-list' });
  const typeLabel = () => TAG_TYPES.find((t) => t.type === type).label;

  const isDuplicate = (name, exceptId) => tagsOf(type).some((t) => t.name === name && t.id !== exceptId);

  // 失敗時はダイアログで知らせる
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      await alertDialog(e.message);
    }
    draw();
  };

  const draw = () => {
    tabs.replaceChildren(...TAG_TYPES.map((t) => h('button', {
      class: 'tab' + (t.type === type ? ' on' : ''),
      role: 'tab',
      'aria-selected': String(t.type === type),
      onclick: () => { type = t.type; savePref('tagTab', type); draw(); },
    }, t.label)));

    const tags = tagsOf(type);
    listBox.replaceChildren(...tags.map((t, i) => {
      const count = tagUsage(t.id);
      return h('li', { class: 'tag-row' },
        h('button', {
          class: 'tag-name',
          onclick: () => run(async () => {
            const name = await promptDialog('名前を変更', t.name, { ok: '変更' });
            if (!name || name === t.name) return;
            if (isDuplicate(name, t.id)) throw new Error(`「${name}」は既にあります`);
            await renameTag(t.id, name);
          }),
        }, h('span', {}, t.name), h('span', { class: 'muted small' }, `${count}枚`), icon('edit')),
        h('button', { class: 'icon-btn small', 'aria-label': '上へ', disabled: i === 0, onclick: () => run(() => moveTag(t.id, -1)) }, icon('up')),
        h('button', { class: 'icon-btn small', 'aria-label': '下へ', disabled: i === tags.length - 1, onclick: () => run(() => moveTag(t.id, 1)) }, icon('down')),
        h('button', {
          class: 'icon-btn small danger',
          'aria-label': '削除',
          onclick: () => run(async () => {
            const msg = count
              ? `「${t.name}」を削除しますか?\n付いている${count}枚の写真からこのタグが外れます(写真は消えません)。`
              : `「${t.name}」を削除しますか?`;
            if (!(await confirmDialog(msg, { ok: '削除', danger: true }))) return;
            await deleteTag(t.id);
            toast('削除しました');
          }),
        }, icon('trash')));
    }));
    if (!tags.length) listBox.append(h('li', { class: 'muted empty-row' }, 'タグがありません'));
  };

  const input = h('input', { class: 'input', type: 'text', maxlength: '30', placeholder: '新しいタグ名' });
  const form = h('form', {
    class: 'add-row',
    onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      run(async () => {
        if (isDuplicate(name)) throw new Error(`「${name}」は既にあります`);
        await addTag(type, name);
        input.value = '';
        toast(`${typeLabel()}タグ「${name}」を追加しました`);
      });
    },
  }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), '追加'));

  draw();
  root.append(
    topbar('タグ管理', { backTo: '#/' }),
    h('div', { class: 'page' },
      tabs,
      form,
      listBox,
      h('p', { class: 'muted small' }, '名前を押すと変更できます。▲▼で並び順(一覧や追加画面での表示順)を変えられます。')),
  );
}
