// アプリ全体の状態(メモリ上のキャッシュ)と、IndexedDB への読み書き
import * as db from './db.js';
import { uid, loadPref, savePref } from './util.js';

const DEFAULT_TAGS = {
  part: ['胸', '背中', '脚', '肩', '腕'],
  pose: ['正面', '横', '背面'],
};

export const TAG_TYPES = [
  { type: 'part', label: '部位' },
  { type: 'pose', label: 'ポーズ' },
];

export const state = {
  tags: [],
  photos: [], // { id, date, partTagIds[], poseTagId, thumb(Blob), width, height, createdAt }
  filter: loadPref('filter', { parts: [], poses: [], order: 'desc' }),
  draft: null, // 追加・編集画面の入力途中の内容
};

export async function init() {
  const initialized = await db.get('meta', 'initialized');
  if (!initialized) {
    const tags = [];
    for (const { type } of TAG_TYPES) {
      DEFAULT_TAGS[type].forEach((name, order) => tags.push({ id: uid(), type, name, order }));
    }
    await db.write(['tags', 'meta'], (tx) => {
      const tagStore = tx.objectStore('tags');
      tags.forEach((t) => tagStore.put(t));
      tx.objectStore('meta').put({ key: 'initialized', value: true });
    });
  }
  await reload();
  cleanFilter();
}

export async function reload() {
  for (const url of thumbURLs.values()) URL.revokeObjectURL(url);
  thumbURLs.clear();
  state.tags = await db.getAll('tags');
  state.photos = await db.getAll('photos');
}

/* ---------- 設定値 ---------- */

export async function getMeta(key) {
  return (await db.get('meta', key))?.value;
}

export function setMeta(key, value) {
  return db.write(['meta'], (tx) => tx.objectStore('meta').put({ key, value }));
}

/* ---------- タグ ---------- */

export function tagsOf(type) {
  return state.tags.filter((t) => t.type === type).sort((a, b) => a.order - b.order);
}

export function tagName(id) {
  return state.tags.find((t) => t.id === id)?.name ?? '';
}

export function tagUsage(id) {
  return state.photos.filter((p) => p.poseTagId === id || p.partTagIds.includes(id)).length;
}

export async function addTag(type, name) {
  const list = tagsOf(type);
  const tag = { id: uid(), type, name, order: list.length ? list[list.length - 1].order + 1 : 0 };
  await db.write(['tags'], (tx) => tx.objectStore('tags').put(tag));
  state.tags.push(tag);
  return tag;
}

export async function renameTag(id, name) {
  const tag = state.tags.find((t) => t.id === id);
  const updated = { ...tag, name };
  await db.write(['tags'], (tx) => tx.objectStore('tags').put(updated));
  Object.assign(tag, updated);
}

// 並び順を1つ上(-1)または下(+1)へ
export async function moveTag(id, dir) {
  const tag = state.tags.find((t) => t.id === id);
  const list = tagsOf(tag.type);
  const i = list.indexOf(tag);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const updated = list.map((t, order) => ({ ...t, order }));
  await db.write(['tags'], (tx) => updated.forEach((t) => tx.objectStore('tags').put(t)));
  updated.forEach((u) => Object.assign(state.tags.find((t) => t.id === u.id), u));
}

// タグを削除し、付いていた写真からはタグだけ外す(写真は残す)
export async function deleteTag(id) {
  const changed = state.photos
    .filter((p) => p.poseTagId === id || p.partTagIds.includes(id))
    .map((p) => ({
      ...p,
      partTagIds: p.partTagIds.filter((t) => t !== id),
      poseTagId: p.poseTagId === id ? null : p.poseTagId,
    }));
  await db.write(['tags', 'photos'], (tx) => {
    tx.objectStore('tags').delete(id);
    changed.forEach((p) => tx.objectStore('photos').put(p));
  });
  state.tags = state.tags.filter((t) => t.id !== id);
  changed.forEach((c) => Object.assign(state.photos.find((p) => p.id === c.id), c));
  cleanFilter();
}

/* ---------- 写真 ---------- */

export function getPhoto(id) {
  return state.photos.find((p) => p.id === id);
}

// 日付順(同じ日なら追加順)
export function sortPhotos(list, order = 'asc') {
  const sorted = [...list].sort((a, b) =>
    a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1);
  return order === 'desc' ? sorted.reverse() : sorted;
}

export function matchesFilter(photo, filter = state.filter) {
  if (filter.parts.length && !photo.partTagIds.some((t) => filter.parts.includes(t))) return false;
  if (filter.poses.length && !filter.poses.includes(photo.poseTagId)) return false;
  return true;
}

export function saveFilter() {
  savePref('filter', state.filter);
}

// 削除済みタグをフィルターから取り除く
function cleanFilter() {
  const ids = new Set(state.tags.map((t) => t.id));
  state.filter.parts = state.filter.parts.filter((id) => ids.has(id));
  state.filter.poses = state.filter.poses.filter((id) => ids.has(id));
  saveFilter();
}

export async function addPhoto({ date, partTagIds, poseTagId, image, thumb, width, height }) {
  const photo = { id: uid(), date, partTagIds, poseTagId, thumb, width, height, createdAt: Date.now() };
  await db.write(['photos', 'images'], (tx) => {
    tx.objectStore('photos').put(photo);
    tx.objectStore('images').put({ id: photo.id, blob: image });
  });
  state.photos.push(photo);
  return photo;
}

export async function updatePhoto(id, patch) {
  const photo = getPhoto(id);
  const updated = { ...photo, ...patch };
  await db.write(['photos'], (tx) => tx.objectStore('photos').put(updated));
  Object.assign(photo, updated);
}

export async function deletePhoto(id) {
  await db.write(['photos', 'images'], (tx) => {
    tx.objectStore('photos').delete(id);
    tx.objectStore('images').delete(id);
  });
  state.photos = state.photos.filter((p) => p.id !== id);
  const url = thumbURLs.get(id);
  if (url) URL.revokeObjectURL(url);
  thumbURLs.delete(id);
}

export async function getImageBlob(id) {
  return (await db.get('images', id))?.blob ?? null;
}

// サムネイルの Object URL はアプリ起動中ずっと使い回す
const thumbURLs = new Map();

export function thumbURL(photo) {
  let url = thumbURLs.get(photo.id);
  if (!url) {
    url = URL.createObjectURL(photo.thumb);
    thumbURLs.set(photo.id, url);
  }
  return url;
}
