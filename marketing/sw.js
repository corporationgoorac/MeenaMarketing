// sw.js (Inside /marketing/)

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'goorac-meena-v36'; // Bumped version to apply advanced fixes
const DYNAMIC_CACHE_NAME = 'goorac-meena-dynamic-v36';

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
  './offline.html',
  './pending.html',
  './products.json',
  './search.html',
  './settings.html',
  './today.html'
];

// 3. INSTALL EVENT
self.addEventListener('install', (event) => {
  console.log('[Marketing Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ADVANCED FIX 1: Cache individually to prevent a single 404 from breaking the cache
      return Promise.all(
        APP_SHELL.map((file) => {
          return cache.add(file).catch((err) => {
            console.warn(`[Marketing Service Worker] Skipped missing file: ${file}`, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// 4. ACTIVATE EVENT
self.addEventListener('activate', (event) => {
  console.log('[Marketing Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // ADVANCED FIX 2: Only delete old MARKETING caches. Stop deleting the Billing caches!
          if (cacheName.startsWith('goorac-meena-') && cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
            console.log('[Marketing Service Worker] Clearing Old Cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 5. FETCH EVENT - 0ms Load + Hardware Offline Check
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  const isHTML = event.request.headers.get('accept')?.includes('text/html');
  const offlinePageUrl = new URL('./offline.html', self.location).href;

  // STRICT HARDWARE OFFLINE CHECK
  if (isHTML && !navigator.onLine) {
    console.warn('[Marketing Service Worker] Device is offline. Forcing offline.html');
    event.respondWith(
      caches.match(offlinePageUrl).then((response) => {
        return response || caches.match('./offline.html').then((relResponse) => {
          return relResponse || new Response('<h2>You are offline</h2>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          });
        });
      })
    );
    return;
  }

  // IF ONLINE: Proceed with 0ms Instant Load (Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const clone = networkResponse.clone();
          const requestUrl = new URL(event.request.url);
          
          const isCoreFile = APP_SHELL.some(route => 
            requestUrl.pathname.endsWith(route.replace('./', '')) && route !== './'
          );
          
          const targetCache = isCoreFile ? CACHE_NAME : DYNAMIC_CACHE_NAME;
          caches.open(targetCache).then((cache) => cache.put(event.request, clone).catch(() => {}));
        }
        return networkResponse;
      });

      if (cachedResponse) {
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      return fetchPromise.catch(() => {
        // ADVANCED FIX 3: Prevent TypeError crashes on offline background images or API calls
        if (isHTML) {
          console.log('[Marketing Service Worker] Offline HTML fallback triggered. Serving offline.html');
          return caches.match(offlinePageUrl).then((response) => {
            return response || caches.match('./offline.html').then((relResponse) => {
              return relResponse || new Response('<h2>You are offline</h2>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
              });
            });
          });
        }
        return new Response('', { status: 404, statusText: 'Offline' });
      });
    })
  );
});
