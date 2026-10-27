/**
 * RetailEdge AI — Customer PWA Service Worker (RetailEdge Shopper)
 * Scope: /customer (registered separately from the Staff PWA worker, which owns /staff).
 * Caches the app shell and static assets only. Catalogue, map, route and cart data are cached by the app itself (localStorage,
 * always labelled stale). API calls and help-request submissions are never served from this cache.
 */

const CACHE_NAME = 'retalledge-shopper-v2';
const SHELL_ASSETS = ['/customer', '/manifest-customer.webmanifest', '/favicon.svg', '/icons/shopper-icon-192.svg', '/icons/shopper-icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW-Customer] Shell pre-cache warning:', err);
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k.startsWith('retalledge-shopper-')).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return;
  }

  // App navigations: network first, keep the latest shell for offline starts.
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/customer')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/customer', clone));
          }
          return res;
        })
        .catch(() => caches.match('/customer').then((hit) => hit || caches.match('/'))),
    );
    return;
  }

  // Static assets: cache first, refreshed in the background.
  if (/\.(js|css|svg|png|woff2?|jpg|jpeg|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
