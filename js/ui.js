// ダイアログ・トースト・ボトムシート
import { h } from './dom.js';

function overlay(content, { sheet = false, onDismiss } = {}) {
  const el = h('div', { class: 'overlay' + (sheet ? ' overlay-sheet' : '') }, content);
  el.addEventListener('click', (e) => {
    if (e.target === el) onDismiss?.();
  });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return () => el.remove();
}

// buttons: [{ label, value, kind: 'primary'|'danger'|undefined }]
export function choose(message, buttons, { title } = {}) {
  return new Promise((resolve) => {
    const done = (v) => {
      close();
      resolve(v);
    };
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
      title && h('h2', {}, title),
      message && h('p', { class: 'dialog-msg' }, message),
      h('div', { class: 'dialog-buttons' },
        buttons.map((b) => h('button', { class: 'btn ' + (b.kind ? 'btn-' + b.kind : ''), onclick: () => done(b.value) }, b.label))));
    const close = overlay(box, { onDismiss: () => done(null) });
  });
}

export async function confirmDialog(message, { ok = 'OK', danger = false, title } = {}) {
  const v = await choose(message, [
    { label: 'キャンセル', value: false },
    { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
  ], { title });
  return v === true;
}

export function alertDialog(message, { title } = {}) {
  return choose(message, [{ label: 'OK', value: true, kind: 'primary' }], { title });
}

export function promptDialog(title, value = '', { ok = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', type: 'text', value, placeholder, maxlength: '30' });
    const done = (v) => {
      close();
      resolve(v);
    };
    const submit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v);
      else input.focus();
    };
    const box = h('form', { class: 'dialog', onsubmit: submit },
      h('h2', {}, title),
      input,
      h('div', { class: 'dialog-buttons' },
        h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'キャンセル'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, ok)));
    const close = overlay(box, { onDismiss: () => done(null) });
    setTimeout(() => input.focus(), 50);
  });
}

// 画面下から出るシート。content は要素の配列。戻り値で閉じる
export function sheet(content) {
  let close;
  const box = h('div', { class: 'sheet' }, content,
    h('button', { class: 'sheet-btn sheet-cancel', onclick: () => close() }, 'キャンセル'));
  close = overlay(box, { sheet: true, onDismiss: () => close() });
  return close;
}

// 処理中表示(戻り値の update で文言更新、close で閉じる)
export function busy(message) {
  const text = h('p', {}, message);
  const close = overlay(h('div', { class: 'dialog busy' }, h('div', { class: 'spinner' }), text));
  return { update: (m) => (text.textContent = m), close };
}

let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}
