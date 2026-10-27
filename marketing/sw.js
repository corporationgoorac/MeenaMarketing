// sw.js

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'goorac-meena-v35'; // Bumped version to v35 to trigger immediate cache refresh for offline.html
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
  './offline.html', // Added offline.html to be cached instantly
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

// 5. FETCH EVENT - 0ms Load + Hardware Offline Check
self.addEventListener('fetch', (event) => {
  // Only intercept standard GET requests from http/https
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  const isHTML = event.request.headers.get('accept')?.includes('text/html');

  // Absolute URL reference for offline.html to prevent cold-start relative path resolution bugs
  const offlinePageUrl = new URL('./offline.html', self.location).href;

  // STRICT HARDWARE OFFLINE CHECK
  // If the device knows it has no internet right now, instantly show offline.html
  if (isHTML && !navigator.onLine) {
    console.warn('[Service Worker] Device is offline. Forcing offline.html');
    event.respondWith(
      caches.match(offlinePageUrl).then((response) => {
        return response || new Response('<h2>You are offline</h2>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      })
    );
    return;
  }

  // IF ONLINE: Proceed with 0ms Instant Load (Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      // Define the background network fetch WITHOUT immediately catching the error
      const fetchPromise = fetch(event.request).then((networkResponse) => {
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
      });

      // 1. If we have the file in cache, return it instantly (0ms load)
      if (cachedResponse) {
        // Catch the background fetch error silently here so it doesn't clutter the console
        fetchPromise.catch(() => console.warn('[Service Worker] Background update paused (Offline).'));
        return cachedResponse;
      }

      // 2. If it's NOT in the cache yet, wait for the network fetch
      // 3. ULTIMATE FAILSAFE: If offline and a requested HTML page isn't in cache, serve offline.html
      return fetchPromise.catch(() => {
        if (isHTML) {
          console.log('[Service Worker] Offline HTML fallback triggered. Serving offline.html');
          return caches.match(offlinePageUrl).then((response) => {
            return response || new Response('<h2>You are offline</h2>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' }
            });
          });
        }
      });
    })
  );
});
