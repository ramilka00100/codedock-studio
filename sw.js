const CACHE_NAME = 'codedock-v10'; // <--- ОБНОВЛЕНО
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './apple-touch-icon-180.png'
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
  // Не перехватываем запросы виртуального сервера предпросмотра
  if (e.request.url.includes('/__preview__/')) return;
  
  // Игнорируем запросы, отличные от GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then((response) => {
      // Кэшируем только успешные ответы
      if (!response || response.status !== 200 || response.type !== 'basic') {
        return response;
      }
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
      return response;
    }).catch(() => {
      return caches.match(e.request);
    })
  );
});
