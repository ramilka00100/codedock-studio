const CACHE_NAME = 'codedock-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon.png'
];

// Установка SW и кэширование базовых ресурсов
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Активируем новый SW сразу
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Активация и удаление старых кэшей
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key); // Удаляем старый v1
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия Network First (Сначала сеть, потом кэш) для HTML/JS/CSS
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Если ответ успешный, клонируем его в кэш
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Если сети нет, отдаем из кэша
        return caches.match(e.request);
      })
  );
});