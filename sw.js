// オフラインで起動できるよう、アプリ本体(写真以外)をキャッシュする。
// 起動時はキャッシュから即表示し、裏で最新版を取得して次回起動時に反映する。
const CACHE = 'progress-photo-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/dom.js',
  './js/icons.js',
  './js/image.js',
  './js/install.js',
  './js/nav.js',
  './js/store.js',
  './js/swiper.js',
  './js/ui.js',
  './js/util.js',
  './js/views/camera.js',
  './js/views/common.js',
  './js/views/compare.js',
  './js/views/editor.js',
  './js/views/list.js',
  './js/views/photo.js',
  './js/views/settings.js',
  './js/views/tags.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (cached) {
      event.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    return fresh;
  }));
});
