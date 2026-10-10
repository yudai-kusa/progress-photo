// 画像の縮小・サムネイル生成・撮影日の取得
const MAX_EDGE = 2048;
const THUMB_EDGE = 480;

// 向きの補正は、ブラウザが <img> を描画するときに EXIF の向きを反映するのを利用する
export async function processImage(source) {
  const img = await loadImage(source);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const image = await resize(img, w, h, MAX_EDGE, 0.85);
  const thumb = await resize(img, w, h, THUMB_EDGE, 0.8);
  return { image: image.blob, thumb: thumb.blob, width: image.width, height: image.height };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした(対応していない形式の可能性があります)'));
    };
    img.src = url;
  });
}

async function resize(img, w, h, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality));
  // iOS はキャンバスのメモリ上限が厳しいので、すぐ解放する
  canvas.width = canvas.height = 0;
  return { blob, width: cw, height: ch };
}

// JPEG の EXIF から撮影日(DateTimeOriginal、なければ DateTime)を 'YYYY-MM-DD' で返す
export async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
        return parseTiffDate(v, off + 10, Math.min(v.byteLength, off + 2 + len));
      }
      off += 2 + len;
    }
  } catch {
    // 読めなければ撮影日なし扱い
  }
  return null;
}

function parseTiffDate(v, start, end) {
  const le = v.getUint16(start) === 0x4949;
  const inRange = (o, n) => start + o + n <= end;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const readIFD = (o) => {
    const entries = {};
    if (!inRange(o, 2)) return entries;
    const n = u16(o);
    for (let i = 0; i < n && inRange(o + 2 + i * 12, 12); i++) entries[u16(o + 2 + i * 12)] = o + 2 + i * 12;
    return entries;
  };
  const str = (e) => {
    const count = u32(e + 4);
    const o = count > 4 ? u32(e + 8) : e + 8;
    let s = '';
    for (let i = 0; i < count - 1 && inRange(o + i, 1); i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };

  const ifd0 = readIFD(u32(4));
  let value = null;
  if (ifd0[0x8769] != null) {
    const exif = readIFD(u32(ifd0[0x8769] + 8));
    if (exif[0x9003] != null) value = str(exif[0x9003]);
  }
  if (!value && ifd0[0x0132] != null) value = str(ifd0[0x0132]);
  const m = value && value.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
