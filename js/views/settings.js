// 設定・バックアップ
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { busy, choose, alertDialog, toast } from '../ui.js';
import { state, getMeta, setMeta } from '../store.js';
import { createBackup, backupFileName, inspectBackup, restoreBackup } from '../backup.js';
import { formatBytes, isIOS, isStandalone } from '../util.js';
import { topbar } from './common.js';

export function render(root) {
  let alive = true;
  let backupURL = null;
  const lastBackup = h('p', { class: 'muted small' }, '');
  const backupResult = h('div', {});
  const storageInfo = h('div', { class: 'kv' });

  const refreshLast = async () => {
    const last = await getMeta('lastBackupAt');
    lastBackup.textContent = last
      ? `最後のバックアップ: ${new Date(last).toLocaleString('ja-JP')}`
      : 'まだバックアップしていません';
  };

  const refreshStorage = async () => {
    const rows = [['写真', `${state.photos.length}枚`]];
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage != null) rows.push(['使用容量', formatBytes(est.usage)]);
    } catch { /* 非対応 */ }
    try {
      const persisted = await navigator.storage?.persisted?.();
      if (persisted != null) rows.push(['自動削除の保護', persisted ? '有効' : '無効(ホーム画面に追加すると有効になりやすい)']);
    } catch { /* 非対応 */ }
    if (!alive) return;
    storageInfo.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  };

  // 1. ZIP を作る → 2. 「保存」ボタンを押す の2段階にする
  //    (iOS では共有シートをボタン操作の直後に開く必要があるため)
  const makeBackup = async () => {
    if (!state.photos.length && !(await choose('写真がありません。タグだけをバックアップしますか?', [
      { label: 'キャンセル', value: false },
      { label: '続ける', value: true, kind: 'primary' },
    ]))) return;
    const progress = busy('バックアップを作成中…');
    let blob;
    try {
      blob = await createBackup((i, n) => progress.update(`バックアップを作成中… ${Math.round((i / n) * 100)}%`));
    } catch (e) {
      progress.close();
      await alertDialog(e.message);
      return;
    }
    progress.close();
    const file = new File([blob], backupFileName(), { type: 'application/zip' });
    if (backupURL) URL.revokeObjectURL(backupURL);
    backupURL = URL.createObjectURL(file);
    const canShare = navigator.canShare?.({ files: [file] });

    const done = async () => {
      await setMeta('lastBackupAt', Date.now());
      refreshLast();
    };
    const share = async () => {
      try {
        await navigator.share({ files: [file], title: file.name });
        await done();
        toast('バックアップを保存しました');
      } catch (e) {
        if (e.name !== 'AbortError') await alertDialog('共有できませんでした。「ファイルとして保存」を試してください。');
      }
    };
    backupResult.replaceChildren(h('div', { class: 'card ready' },
      h('p', {}, h('strong', {}, '準備できました'), ` ${file.name}(${formatBytes(file.size)})`),
      canShare
        ? h('button', { class: 'btn btn-primary btn-block', onclick: share }, icon('share'), '保存・共有する')
        : null,
      h('a', {
        class: 'btn btn-block' + (canShare ? '' : ' btn-primary'),
        href: backupURL,
        download: file.name,
        onclick: () => { setTimeout(done, 500); },
      }, icon('download'), 'ファイルとして保存'),
      h('p', { class: 'muted small' }, isIOS()
        ? '「保存・共有する」→「\"ファイル\"に保存」で iCloud Drive などに保存できます。'
        : 'Google ドライブなど、端末の外にも保存しておくと安心です。')));
  };

  const fileInput = h('input', {
    type: 'file',
    accept: '.zip,application/zip',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await restore(file);
    },
  });

  const restore = async (file) => {
    let backup;
    try {
      backup = await inspectBackup(file);
    } catch (e) {
      await alertDialog(e.message);
      return;
    }
    const n = backup.data.photos.length;
    const when = backup.data.exportedAt ? new Date(backup.data.exportedAt).toLocaleString('ja-JP') : '不明';
    const mode = await choose(
      `作成日時: ${when}\n写真: ${n}枚\n\n今の写真(${state.photos.length}枚)をどうしますか?`,
      [
        { label: '今のデータに追加する', value: 'merge', kind: 'primary' },
        { label: 'すべて置き換える(今のデータは消えます)', value: 'replace', kind: 'danger' },
        { label: 'キャンセル', value: null },
      ],
      { title: 'バックアップを読み込む' });
    if (!mode) return;
    if (mode === 'replace' && state.photos.length && !(await choose(
      `今の写真${state.photos.length}枚とタグをすべて削除して、バックアップの内容に置き換えます。よろしいですか?`,
      [{ label: 'キャンセル', value: false }, { label: '置き換える', value: true, kind: 'danger' }],
    ))) return;

    const progress = busy('読み込み中…');
    try {
      const r = await restoreBackup(backup, mode, (i, total) => progress.update(`読み込み中… ${i} / ${total}`));
      progress.close();
      const lines = [`${r.added}枚を読み込みました。`];
      if (r.skipped) lines.push(`${r.skipped}枚は既にあるためスキップしました。`);
      if (r.failed) lines.push(`${r.failed}枚は読み込めませんでした。`);
      await alertDialog(lines.join('\n'), { title: '完了' });
    } catch (e) {
      progress.close();
      await alertDialog(e.message, { title: '読み込みに失敗しました' });
    }
    refreshStorage();
  };

  refreshLast();
  refreshStorage();

  root.append(
    topbar('設定・バックアップ', { backTo: '#/' }),
    h('div', { class: 'page' },
      h('section', { class: 'card' },
        h('h2', {}, 'バックアップを保存'),
        h('p', {}, 'すべての写真とタグを1つの ZIP ファイルにまとめます。機種変更や、アプリのデータが消えたときに読み込めば元に戻せます。'),
        lastBackup,
        h('button', { class: 'btn btn-primary btn-block', onclick: makeBackup }, 'バックアップを作成'),
        backupResult),
      h('section', { class: 'card' },
        h('h2', {}, 'バックアップから復元'),
        h('p', {}, 'このアプリで保存した ZIP ファイルを選んでください。'),
        h('label', { class: 'btn btn-block' }, 'ファイルを選ぶ', fileInput)),
      h('section', { class: 'card' },
        h('h2', {}, '保存状況'),
        storageInfo,
        isIOS() && !isStandalone()
          ? h('p', { class: 'warn small' }, 'いまは Safari で開いています。Safari とホーム画面のアプリでは保存場所が別なので、ホーム画面に追加したアプリで使ってください。')
          : null),
      h('section', { class: 'card' },
        h('h2', {}, 'このアプリについて'),
        h('p', {}, '写真とタグはこの端末の中(ブラウザのデータ領域)にだけ保存され、外部のサーバーには送信されません。'),
        h('p', { class: 'muted small' }, 'ブラウザのデータを消去したり、アプリをホーム画面から削除すると写真も消えます。定期的にバックアップしてください。'))),
  );

  return () => {
    alive = false;
    if (backupURL) URL.revokeObjectURL(backupURL);
  };
}
