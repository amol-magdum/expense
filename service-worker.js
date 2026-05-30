/* PWA Service Worker (simple app-shell caching + basic offline fallback) */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `expense-tracker-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))).then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cache-first for same-origin app shell assets
  if (isSameOrigin(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;

        // Network then cache for same-origin GET requests
        if (req.method === 'GET') {
          return fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
              return res;
            })
            .catch(() => {
              // Offline fallback for navigation requests
              if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
                return caches.match('./index.html');
              }
              return undefined;
            });
        }

        return fetch(req);
      })
    );
    return;
  }

  // For cross-origin requests, just try network
  event.respondWith(fetch(req).catch(() => undefined));
});

// Basic message handler (optional)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
