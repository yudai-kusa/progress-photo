// 日付は端末のローカル日付を 'YYYY-MM-DD' 文字列で扱う
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function formatDate(s) {
  return isYmd(s) ? s.replaceAll('-', '/') : '';
}

export function formatMonth(s) {
  return `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月`;
}

// a から b までの日数(b が後なら正)
export function daysBetween(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function relativeLabel(days) {
  if (days === 0) return '固定写真と同じ日';
  return days > 0 ? `固定写真から${days}日後` : `固定写真の${-days}日前`;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

// localStorage は使えないことがある(プライベートモード等)ので必ず try で包む
export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem('pp.' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try { localStorage.setItem('pp.' + key, JSON.stringify(value)); } catch { /* 無視 */ }
}
