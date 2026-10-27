/**
 * RetailEdge AI — Staff PWA Service Worker
 * Scope: /staff
 * Provides offline caching, application shell support, background sync fallback, and notification routing.
 */

const CACHE_NAME = 'retalledge-staff-v1';
const SHELL_ASSETS = [
  '/',
  '/staff',
  '/manifest-staff.webmanifest',
  '/favicon.svg',
  '/icons/staff-icon-192.svg',
  '/icons/staff-icon-512.svg',
];

// Install Event: pre-cache critical shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW-Staff] Pre-caching non-critical asset error:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event: purge obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('retalledge-staff-')) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: network-first with cache fallback for app navigation and assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle requests inside /staff or static assets
  if (event.request.method !== 'GET') {
    return;
  }

  // For HTML navigations under /staff, return cached index if offline
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/staff')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/staff') || caches.match('/');
      })
    );
    return;
  }

  // For static assets, cache-first or stale-while-revalidate
  if (url.pathname.match(/\.(js|css|svg|png|woff2|jpg|webp)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Revalidate in background
          fetch(event.request)
            .then((fresh) => {
              if (fresh && fresh.status === 200) {
                caches.open(CACHE_NAME).then((c) => c.put(event.request, fresh));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Fallback default network fetch
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// Notification Click Handler: tap notification to open app or specific task
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/staff/tasks';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/staff') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
