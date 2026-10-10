// Android(Chrome)の「アプリとしてインストール」ボタン用
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // Chrome 標準の小さなバーの代わりに、アプリ内のボタンを出す
  deferred = e;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function canInstall() {
  return deferred !== null;
}

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
