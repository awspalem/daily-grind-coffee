// The Daily Roast — Storefront Service Worker (PWA Offline & Asset Cache)
const CACHE_NAME = 'tdg-storefront-v1.2.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/images/pour_over.jpg',
  '/images/pour_over.webp',
  '/images/roaster.jpg',
  '/images/roaster.webp',
  '/images/bag_ethiopia.jpg',
  '/images/bag_ethiopia.webp',
  '/images/espresso.jpg',
  '/images/espresso.webp'
];

// Install: Pre-cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache assets warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Purge old cache stores & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Deleting stale cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy based on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // API Requests: Stale-While-Revalidate with graceful offline fallback.
  // Returns the cached response immediately (when present) and refreshes the
  // cache in the background. Public read endpoints also set Cache-Control
  // headers in the Worker so the network response is itself edge-cacheable.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);
        if (cached) {
          // Don't block the response on the network — let the next visit see it.
          networkPromise.catch(() => {});
          return cached;
        }
        const networkResponse = await networkPromise;
        if (networkResponse) return networkResponse;
        return new Response(
          JSON.stringify({ offline: true, message: 'Offline mode: connection unavailable. Showing local roastery state.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Navigation requests (HTML pages): Network-First, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Static Assets (CSS, JS, Fonts, Images, SVGs): Cache-First with Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
