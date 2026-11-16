const CACHE_NAME = 'codedock-v4'; // <--- НОВАЯ ВЕРСИЯ
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((response) => {
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
      return response;
    }).catch(() => caches.match(e.request))
  );
});