// Service Worker for Nomacode PWA
// Bump on every shipped asset change so clients don't serve stale JS/CSS.
const CACHE_NAME = 'nomacode-v3';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/lib/xterm.css',
  '/lib/xterm.min.js',
  '/lib/xterm-addon-fit.min.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't cache API calls or WebSocket
  if (url.pathname.startsWith('/api') || event.request.url.includes('ws')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});
