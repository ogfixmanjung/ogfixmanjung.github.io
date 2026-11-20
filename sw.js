/* Service worker: membolehkan app dibuka tanpa internet (offline). */
const CACHE = 'ogfix-v22';
const ASSETS = [
  './',
  './index.html',
  './resit.html',
  './css/style.css',
  './js/config.js',
  './js/db-local.js',
  './js/db-cloud.js',
  './js/db.js',
  './js/render.js',
  './js/app.js',
  './js/logo.js',
  './js/export.js',
  './js/viewer.js',
  './img/favicon.png',
  './img/icon-192.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network dulu (supaya sentiasa versi terbaru), cache jika offline. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Fail app sendiri + Firebase SDK (www.gstatic.com) disimpan untuk offline
  if (req.method !== 'GET' || (url.origin !== location.origin && url.host !== 'www.gstatic.com')) return;
  // Fail sendiri: sentiasa semak versi terbaru (elak design lama tersimpan)
  const net = url.origin === location.origin ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(
    net
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
