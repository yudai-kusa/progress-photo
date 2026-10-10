// 一覧(ホーム)
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate } from '../nav.js';
import { sheet } from '../ui.js';
import {
  state, tagsOf, tagName, sortPhotos, matchesFilter, saveFilter, thumbURL, getMeta, TAG_TYPES,
} from '../store.js';
import {
  formatDate, formatMonth, daysBetween, ymd, isIOS, isAndroid, isStandalone, loadPref, savePref, uid,
} from '../util.js';
import { canInstall, promptInstall, onInstallChange } from '../install.js';
import { readExifDate } from '../image.js';
import { iconButton } from './common.js';

const BACKUP_REMIND_DAYS = 30;
let savedScroll = 0;

export function render(root) {
  state.draft = null; // 追加・編集の途中で戻ってきた場合は破棄
  const f = state.filter;
  const filterBox = h('div', { class: 'filters' });
  const grid = h('div', { class: 'grid-wrap' });
  const banners = h('div', { class: 'banners' });

  const drawFilters = () => {
    const rows = TAG_TYPES.map(({ type, label }) => {
      const key = type === 'part' ? 'parts' : 'poses';
      return h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, label),
        h('div', { class: 'chips scroll' }, tagsOf(type).map((t) => h('button', {
          class: 'chip small' + (f[key].includes(t.id) ? ' on' : ''),
          onclick: () => {
            f[key] = f[key].includes(t.id) ? f[key].filter((x) => x !== t.id) : [...f[key], t.id];
            changed();
          },
        }, t.name))));
    });
    const active = f.parts.length + f.poses.length > 0;
    filterBox.replaceChildren(...rows, h('div', { class: 'filter-tools' },
      h('span', { class: 'muted small' }, countLabel()),
      active ? h('button', { class: 'link-btn', onclick: () => { f.parts = []; f.poses = []; changed(); } }, '絞り込み解除') : null,
      h('button', {
        class: 'link-btn',
        onclick: () => { f.order = f.order === 'desc' ? 'asc' : 'desc'; changed(); },
      }, icon('sort'), f.order === 'desc' ? '新しい順' : '古い順')));
  };

  const visible = () => sortPhotos(state.photos.filter((p) => matchesFilter(p)), f.order);
  const countLabel = () => `${visible().length}枚 / 全${state.photos.length}枚`;

  const drawGrid = () => {
    const photos = visible();
    if (!state.photos.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'まだ写真がありません'),
        h('p', {}, '右下の ＋ から写真を追加しましょう。'),
        h('p', { class: 'muted small' }, '写真はこの端末の中にだけ保存され、外部には送信されません。')));
      return;
    }
    if (!photos.length) {
      grid.replaceChildren(h('div', { class: 'empty' }, h('p', {}, '条件に合う写真がありません')));
      return;
    }
    const sections = [];
    let month = null;
    let cells = null;
    for (const p of photos) {
      const m = p.date.slice(0, 7);
      if (m !== month) {
        month = m;
        cells = h('div', { class: 'grid' });
        sections.push(h('h2', { class: 'month' }, formatMonth(p.date)), cells);
      }
      const pose = tagName(p.poseTagId);
      cells.append(h('button', { class: 'cell', onclick: () => navigate('#/photo/' + p.id) },
        h('img', { src: thumbURL(p), alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'cell-label' }, formatDate(p.date).slice(5), pose ? ` ${pose}` : '')));
    }
    grid.replaceChildren(...sections);
  };

  const changed = () => {
    saveFilter();
    drawFilters();
    drawGrid();
  };

  drawFilters();
  drawGrid();
  drawBanners(banners);
  const offInstall = onInstallChange(() => drawBanners(banners));

  root.append(
    h('header', { class: 'topbar' },
      h('h1', {}, '進捗フォト'),
      h('div', { class: 'topbar-actions' },
        iconButton('tag', 'タグ管理', () => navigate('#/tags')),
        iconButton('settings', '設定・バックアップ', () => navigate('#/settings')))),
    banners,
    filterBox,
    grid,
    h('button', { class: 'fab', 'aria-label': '写真を追加', onclick: openAddSheet }, icon('plus')),
  );

  requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  return () => {
    offInstall();
    savedScroll = window.scrollY;
  };
}

async function drawBanners(box) {
  const items = [];
  const showInstallTip = !isStandalone() && !loadPref('hideInstallTip', false);
  if (showInstallTip && canInstall()) {
    items.push(banner(
      'アプリとしてインストールできます',
      'ホーム画面から全画面で起動でき、写真のデータもブラウザに自動削除されにくくなります。',
      () => savePref('hideInstallTip', true),
      {
        label: 'インストール',
        onclick: async () => {
          if (!(await promptInstall())) return;
          savePref('hideInstallTip', true);
          drawBanners(box);
        },
      }));
  } else if (showInstallTip && isAndroid()) {
    items.push(banner(
      'ホーム画面に追加して使うのがおすすめです',
      'Chrome 右上のメニュー(⋮)→「ホーム画面に追加」または「アプリをインストール」。全画面で起動でき、データも自動削除されにくくなります。',
      () => savePref('hideInstallTip', true)));
  } else if (showInstallTip && isIOS()) {
    items.push(banner(
      'ホーム画面に追加して使ってください',
      'Safari の共有ボタン → 「ホーム画面に追加」。Safari とホーム画面のアプリでは保存場所が別なので、写真はホーム画面のアプリで追加してください。',
      () => savePref('hideInstallTip', true)));
  }
  if (state.photos.length) {
    const last = await getMeta('lastBackupAt');
    const days = last ? daysBetween(ymd(new Date(last)), ymd()) : null;
    const snoozed = loadPref('backupSnoozeUntil', 0) > Date.now();
    if (!snoozed && (days === null || days >= BACKUP_REMIND_DAYS)) {
      items.push(banner(
        days === null ? 'バックアップがまだありません' : `最後のバックアップから${days}日経っています`,
        '端末の不具合や機種変更に備えて、設定画面からバックアップを保存しておきましょう。',
        () => savePref('backupSnoozeUntil', Date.now() + 7 * 86400000),
        { label: 'バックアップする', onclick: () => navigate('#/settings') }));
    }
  }
  box.replaceChildren(...items);
}

function banner(title, text, onClose, action) {
  const el = h('div', { class: 'banner' },
    h('div', { class: 'banner-body' },
      h('strong', {}, title),
      h('p', {}, text),
      action ? h('button', { class: 'btn btn-primary btn-sm', onclick: action.onclick }, action.label) : null),
    h('button', { class: 'banner-close', 'aria-label': '閉じる', onclick: () => { onClose(); el.remove(); } }, '×'));
  return el;
}

// カメラ / アルバムの選択。iOS で確実にファイル選択を開くため <label> で <input> を包む
function openAddSheet() {
  let close;
  const onFiles = async (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || f.type === '');
    e.target.value = '';
    close();
    if (!files.length) return;
    await startDraft(files);
    navigate('#/add');
  };
  const pick = (label, iconName, capture) => h('label', { class: 'sheet-btn' },
    icon(iconName), label,
    h('input', { type: 'file', accept: 'image/*', hidden: true, multiple: !capture, capture: capture ? 'environment' : null, onchange: onFiles }));
  close = sheet([
    h('p', { class: 'sheet-title' }, '写真を追加'),
    pick('カメラで撮る', 'camera', true),
    pick('アルバムから選ぶ', 'image', false),
  ]);
}

async function startDraft(files) {
  const last = loadPref('lastTags', { parts: [], pose: null });
  const ids = new Set(state.tags.map((t) => t.id));
  const items = await Promise.all(files.map(async (file) => {
    const exif = await readExifDate(file);
    // 撮影日(EXIF)→ ファイルの日時 → 今日 の順で決める
    const modified = file.lastModified ? ymd(new Date(file.lastModified)) : null;
    return { key: uid(), file, date: exif ?? modified ?? ymd() };
  }));
  state.draft = {
    mode: 'add',
    items,
    partTagIds: new Set(last.parts.filter((id) => ids.has(id))),
    poseTagId: new Set(ids.has(last.pose) ? [last.pose] : []),
  };
}
