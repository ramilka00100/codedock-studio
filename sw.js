/* CodeDock Studio — service worker.
   Оболочка приложения кэшируется при установке, обновления подхватываются
   по сообщению SKIP_WAITING. Кэшируются только успешные ответы. */

const VERSION = 'codedock-v7';
const CORE = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    './icon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon-180.png'
];
const CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        await Promise.all(CORE.map(async (url) => {
            try {
                const response = await fetch(url, { cache: 'reload' });
                if (response.ok) await cache.put(url, response);
            } catch (error) {
                /* офлайн-первый запуск не должен ломать установку */
            }
        }));
        await Promise.all(CDN.map(async (url) => {
            try {
                const response = await fetch(url, { mode: 'cors' });
                if (response.ok) await cache.put(url, response);
            } catch (error) {
                /* иконки подтянутся позже */
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function cachePut(request, response) {
    if (!response || !response.ok) return;
    const cache = await caches.open(VERSION);
    await cache.put(request, response.clone());
}

async function networkFirst(request, fallbackUrl) {
    try {
        const response = await fetch(request);
        if (response.ok) await cachePut(request, response);
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fallback = await caches.match(fallbackUrl || './index.html');
        if (fallback) return fallback;
        throw error;
    }
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const network = fetch(request)
        .then(async (response) => {
            await cachePut(request, response);
            return response;
        })
        .catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    await cachePut(request, response);
    return response;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, './index.html'));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    if (CDN.some((asset) => url.href === asset)) {
        event.respondWith(cacheFirst(request));
    }
});
