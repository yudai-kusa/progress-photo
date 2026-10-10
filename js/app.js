import { init } from './store.js';
import { setRouter } from './nav.js';
import './install.js';
import { h } from './dom.js';
import * as list from './views/list.js';
import * as photo from './views/photo.js';
import * as editor from './views/editor.js';
import * as compare from './views/compare.js';
import * as tags from './views/tags.js';
import * as settings from './views/settings.js';
import * as camera from './views/camera.js';

// #/            一覧
// #/photo/<id>  写真の詳細
// #/add         追加(選んだ写真は state.draft に入っている)
// #/edit/<id>   日付・タグの編集
// #/compare/<id> 比較(id が固定写真)
// #/camera      アプリ内カメラ(撮影ガイド付き)
// #/tags        タグ管理
// #/settings    設定・バックアップ
const views = { '': list, photo, add: editor, edit: editor, compare, tags, settings, camera };

const root = document.getElementById('app');
let cleanup = null;

function route() {
  cleanup?.();
  cleanup = null;
  // 戻る操作などで画面が変わったら、開いていたダイアログも閉じる
  document.querySelectorAll('.overlay').forEach((el) => el.remove());
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const view = views[name] ?? list;
  root.replaceChildren();
  root.className = 'view-' + (name || 'list');
  cleanup = view.render(root, { name, id: arg ? decodeURIComponent(arg) : null }) ?? null;
}

async function start() {
  try {
    await init();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'fatal' },
      h('h1', {}, 'データを読み込めませんでした'),
      h('p', {}, String(e?.message ?? e)),
      h('p', {}, 'プライベートブラウズでは保存できないことがあります。通常モードで開き直してください。')));
    return;
  }
  setRouter(route);
  window.addEventListener('popstate', route);
  history.replaceState({ depth: history.state?.depth ?? 0 }, '', location.hash || '#/');
  route();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// 端末のブラウザにデータを自動削除されにくくする(対応ブラウザのみ)
navigator.storage?.persist?.().catch(() => {});

start();
