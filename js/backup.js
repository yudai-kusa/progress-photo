// バックアップ(ZIP)の書き出しと読み込み
//   data.json      … タグと写真のメタ情報
//   photos/<id>.jpg … 写真本体
//   thumbs/<id>.jpg … サムネイル
// 写真は既に JPEG なので圧縮せず「無圧縮 ZIP」で格納する(ライブラリ不要)
import * as db from './db.js';
import { state, reload, getImageBlob } from './store.js';
import { processImage } from './image.js';
import { isYmd, uid } from './util.js';

const APP_ID = 'progress-photo';
const FORMAT = 1;

export async function createBackup(onProgress) {
  const photos = state.photos;
  const data = {
    app: APP_ID,
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    tags: state.tags,
    photos: photos.map(({ thumb, ...meta }) => meta),
  };
  const files = [{ name: 'data.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) }];
  for (const p of photos) {
    const image = await getImageBlob(p.id);
    if (image) files.push({ name: `photos/${p.id}.jpg`, blob: image });
    files.push({ name: `thumbs/${p.id}.jpg`, blob: p.thumb });
  }
  return buildZip(files, onProgress);
}

export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `progress-photo-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.zip`;
}

// 読み込んで中身を確認する(まだ保存はしない)
export async function inspectBackup(file) {
  const zip = await readZip(file);
  const dataName = zip.names.find((n) => n === 'data.json' || n.endsWith('/data.json'));
  if (!dataName) throw new Error('このアプリのバックアップファイルではありません。');
  const prefix = dataName.slice(0, -'data.json'.length);
  let data;
  try {
    data = JSON.parse(await (await zip.blob(dataName)).text());
  } catch {
    throw new Error('バックアップの中身が壊れています。');
  }
  if (data?.app !== APP_ID || !Array.isArray(data.tags) || !Array.isArray(data.photos)) {
    throw new Error('このアプリのバックアップファイルではありません。');
  }
  return { zip, prefix, data };
}

// mode: 'merge'(今のデータに追加) | 'replace'(全部置き換え)
export async function restoreBackup({ zip, prefix, data }, mode, onProgress) {
  if (mode === 'replace') {
    await db.write(['photos', 'images', 'tags'], (tx) => {
      ['photos', 'images', 'tags'].forEach((s) => tx.objectStore(s).clear());
    });
    await reload();
  }

  // タグ: 同じ ID か、同じ種類・同じ名前があればそれを使う
  const tagMap = new Map();
  const newTags = [];
  const maxOrder = {};
  for (const t of state.tags) maxOrder[t.type] = Math.max(maxOrder[t.type] ?? -1, t.order);
  const incoming = data.tags
    .filter((t) => t && (t.type === 'part' || t.type === 'pose') && typeof t.name === 'string' && t.name)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const t of incoming) {
    const existing = [...state.tags, ...newTags];
    const same = existing.find((e) => e.id === t.id) || existing.find((e) => e.type === t.type && e.name === t.name);
    if (same) {
      tagMap.set(t.id, same.id);
      continue;
    }
    const order = (maxOrder[t.type] ?? -1) + 1;
    maxOrder[t.type] = order;
    const tag = { id: typeof t.id === 'string' && t.id ? t.id : uid(), type: t.type, name: t.name, order };
    newTags.push(tag);
    tagMap.set(t.id, tag.id);
  }
  if (newTags.length) await db.write(['tags'], (tx) => newTags.forEach((t) => tx.objectStore('tags').put(t)));

  // 写真: 既にある ID はスキップ
  const have = new Set(state.photos.map((p) => p.id));
  const result = { added: 0, skipped: 0, failed: 0 };
  const total = data.photos.length;
  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total);
    const p = data.photos[i];
    if (!p || typeof p.id !== 'string' || !isYmd(p.date)) {
      result.failed++;
      continue;
    }
    if (have.has(p.id)) {
      result.skipped++;
      continue;
    }
    try {
      const image = await zip.blob(`${prefix}photos/${p.id}.jpg`, 'image/jpeg');
      if (!image) throw new Error('missing image');
      let thumb = await zip.blob(`${prefix}thumbs/${p.id}.jpg`, 'image/jpeg');
      let { width, height } = p;
      if (!thumb || !width || !height) ({ thumb, width, height } = await processImage(image));
      const photo = {
        id: p.id,
        date: p.date,
        partTagIds: (Array.isArray(p.partTagIds) ? p.partTagIds : []).map((id) => tagMap.get(id)).filter(Boolean),
        poseTagId: tagMap.get(p.poseTagId) ?? null,
        thumb,
        width,
        height,
        createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
      };
      await db.write(['photos', 'images'], (tx) => {
        tx.objectStore('photos').put(photo);
        tx.objectStore('images').put({ id: photo.id, blob: image });
      });
      have.add(p.id);
      result.added++;
    } catch (e) {
      if (/容量/.test(e.message)) throw e;
      result.failed++;
    }
  }
  await reload();
  return result;
}

/* ---------- ZIP(無圧縮)の書き出し ---------- */

const enc = new TextEncoder();

async function buildZip(files, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (let i = 0; i < files.length; i++) {
    onProgress?.(i + 1, files.length);
    const { name, blob } = files[i];
    const nameBytes = enc.encode(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // ファイル名は UTF-8
    local.setUint16(8, 0, true); // 無圧縮
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, nameBytes, blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, nameBytes);

    offset += 30 + nameBytes.length + size;
    if (offset > 0xffffffff) throw new Error('データが大きすぎて1つのバックアップにまとめられません。');
  }

  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------- ZIP の読み込み(必要な部分だけ切り出して読む) ---------- */

const dec = new TextDecoder();

async function readZip(file) {
  const tailLen = Math.min(file.size, 22 + 65535);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP ファイルとして読み込めませんでした。');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());

  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP ファイルが壊れています。');
    const nameLen = cd.getUint16(p + 28, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    entries.set(name, {
      method: cd.getUint16(p + 10, true),
      size: cd.getUint32(p + 20, true),
      offset: cd.getUint32(p + 42, true),
    });
    p += 46 + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }

  return {
    names: [...entries.keys()],
    async blob(name, type = '') {
      const e = entries.get(name);
      if (!e) return null;
      const local = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      if (local.getUint32(0, true) !== 0x04034b50) throw new Error('ZIP ファイルが壊れています。');
      const start = e.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const raw = file.slice(start, start + e.size);
      if (e.method === 0) return new Blob([raw], { type });
      // 別のツールで圧縮し直された ZIP にも対応
      if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
        const out = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        return new Blob([out], { type });
      }
      throw new Error('対応していない圧縮形式の ZIP です。');
    },
  };
}
