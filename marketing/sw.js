// sw.js

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'goorac-meena-v33';
const DYNAMIC_CACHE_NAME = 'goorac-meena-dynamic-v2';

// 2. APP SHELL (Core Files)
const APP_SHELL = [
  './',
  './index.html',
  './abc.html',
  './add.html',
  './aiBot.html',
  './ask.html',
  './attandance.html',
  './companies.html',
  './config.js',
  './custombill.html',
  './dailyCheck.html',
  './delete.html',
  './icon.png',
  './inventory.html',
  './login.html',
  './makePayment.html',
  './manifest.json',
  './mrkting.html',
  './offer.html',
  './pending.html',
  './products.json',
  './search.html',
  './settings.html',
  './today.html'
];

// 3. INSTALL EVENT
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => console.error('[Service Worker] Pre-caching failed:', error))
  );
  self.skipWaiting();
});

// 4. ACTIVATE EVENT
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== DYNAMIC_CACHE_NAME) {
            console.log('[Service Worker] Clearing Old Cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 5. FETCH EVENT - Pure Stale-While-Revalidate with Cache Segregation
self.addEventListener('fetch', (event) => {
  // Only intercept standard GET requests from http/https
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // The background network fetch
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // If valid response, silently update the cache for the NEXT visit
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            
            // PROFESSIONAL TWEAK: Segregate core files vs dynamic external assets
            const requestUrl = new URL(event.request.url);
            // Check if the requested file is one of our core APP_SHELL files
            const isCoreFile = APP_SHELL.some(route => 
              requestUrl.pathname.endsWith(route.replace('./', '')) && route !== './'
            );
            
            // Route the file to the correct organized cache folder
            const targetCache = isCoreFile ? CACHE_NAME : DYNAMIC_CACHE_NAME;

            caches.open(targetCache).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => console.warn('[Service Worker] Background update failed (Offline).'));

      // Instantly return the cached version if it exists (0ms load), otherwise wait for the network
      return cachedResponse || fetchPromise;
    })
  );
});
