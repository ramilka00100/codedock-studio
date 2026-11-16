let virtualFiles = new Map();

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_PREVIEW_FILES') {
    virtualFiles.clear();
    const files = event.data.files || [];
    files.forEach((file) => {
      const path = file.path.replace(/^\/+/, '');
      virtualFiles.set(path, {
        content: file.content,
        type: getMimeType(file.name),
      });
    });
  }
});

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/__preview__/')) return;

  let filePath = url.pathname.replace('/__preview__/', '').replace(/^\/+/, '');
  if (!filePath) filePath = 'index.html';

  const file = virtualFiles.get(filePath);

  if (!file) {
    event.respondWith(new Response('Файл не найден', { status: 404 }));
    return;
  }

  event.respondWith(
    new Response(file.content, {
      status: 200,
      headers: {
        'Content-Type': file.type,
        'Access-Control-Allow-Origin': '*',
      },
    })
  );
});
