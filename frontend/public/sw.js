/**
 * Service Worker for Progressive Web App
 * Feature: prove-present
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 * 
 * This service worker implements:
 * - Offline capability for cached resources (Req 20.2)
 * - Static asset caching for faster loading (Req 20.4)
 * - Network-first strategy for API calls
 * - Cache-first strategy for static assets
 * - Offline fallback page
 */

const CACHE_NAME = 'qr-attendance-v4';
const RUNTIME_CACHE = 'qr-attendance-runtime-v4';

// Core assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] Installation complete');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map((name) => {
              console.log('[Service Worker] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Chrome extensions and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Let browser handle manual-redirect requests natively
  // (returning redirected responses from SW can trigger network errors)
  if (request.redirect === 'manual') {
    return;
  }

  // Let browser handle auth and login navigations directly
  // to avoid redirect-mode incompatibilities during sign-in flows
  if (
    request.mode === 'navigate' &&
    (url.pathname === '/login' ||
      url.pathname === '/login/' ||
      url.pathname.startsWith('/.auth/') ||
      url.pathname.startsWith('/api/auth/'))
  ) {
    return;
  }

  // Never cache authentication endpoints - always fetch fresh
  if (url.pathname.startsWith('/.auth/')) {
    event.respondWith(fetch(request));
    return;
  }

  // API requests: Network-first strategy (always try network, fallback to cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return a custom offline response for API calls
            return new Response(
              JSON.stringify({ error: 'Offline', message: 'Network connection required' }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
    return;
  }

  // Static assets: Cache-first strategy (serve from cache, update in background)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version immediately
          // Update cache in background
          fetch(request).then((response) => {
            if (response.status === 200) {
              caches.open(RUNTIME_CACHE).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {
            // Ignore fetch errors for background updates
          });
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then((response) => {
            // Cache successful responses
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            // For other requests, return a basic error response
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});
