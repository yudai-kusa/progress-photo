// IndexedDB の薄いラッパー
//   photos: 写真のメタ情報 + サムネイル(一覧で全件読む)
//   images: 表示用の大きい画像(必要なときだけ1枚ずつ読む)
//   tags  : 部位・ポーズのタグ
//   meta  : 設定値(最終バックアップ日時など)
const DB_NAME = 'progress-photo';
const DB_VERSION = 1;
export const STORES = ['photos', 'images', 'tags', 'meta'];

let dbPromise;

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースを開けませんでした。アプリを開き直してください。'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

// fn(tx) の中で同期的にリクエストを積む。トランザクション完了で resolve
export async function write(stores, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(friendlyError(tx.error));
    tx.onabort = () => reject(friendlyError(tx.error) || new Error('保存を中断しました'));
    try {
      fn(tx);
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}

function friendlyError(err) {
  if (err && err.name === 'QuotaExceededError') {
    return new Error('端末の空き容量が足りないため保存できませんでした。');
  }
  return err;
}
