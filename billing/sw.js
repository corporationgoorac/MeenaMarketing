// sw.js (Inside /billing/)

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'billing-app-v4'; // Bumped to v4 to trigger immediate cache refresh for offline.html
const DYNAMIC_CACHE_NAME = 'billing-app-dynamic-v4';

// 2. APP SHELL (Core assets located directly inside the 'billing' directory)
const ASSETS_TO_CACHE = [
  './',
  './abc.html',
  './aiBot.html', // Added aiBot.html to core shell
  './bill.html',
  './config.js',
  './dailyCheck.html',
  './icon.png',
  './inventory.html',
  './login.html',
  './manifest.json',
  './offer.html',
  './offline.html', // Added offline.html to be cached instantly
  './pending.html',
  './products.json',
  './today.html'
];

// 3. INSTALL EVENT: Pre-cache the App Shell
self.addEventListener('install', (event) => {
  console.log('[Billing Service Worker] Installing & Caching App Shell...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .catch((error) => console.error('[Billing Service Worker] Cache AddAll Failed:', error))
  );
  // Force activate immediately without waiting for open tabs to close
  self.skipWaiting();
});

// 4. ACTIVATE EVENT: Clean up stale/outdated caches
self.addEventListener('activate', (event) => {
  console.log('[Billing Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
            console.log('[Billing Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all open pages in scope immediately
  self.clients.claim();
});

// 5. FETCH EVENT: Pure Stale-While-Revalidate with Cache Segregation & Offline Fallback
self.addEventListener('fetch', (event) => {
  // Intercept only standard GET requests (allows external CDNs to cache, ignores Firebase API calls)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      // The background network fetch for 0ms instant updates WITHOUT immediately catching the error
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // If valid response, silently update the cache for the NEXT visit
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseClone = networkResponse.clone();
          const requestUrl = new URL(event.request.url);
          
          // PROFESSIONAL TWEAK: Segregate core files vs dynamic external assets
          const isCoreFile = ASSETS_TO_CACHE.some(route => 
            requestUrl.pathname.endsWith(route.replace('./', '')) && route !== './'
          );
          
          // Route the file to the correct organized cache folder
          const targetCache = isCoreFile ? CACHE_NAME : DYNAMIC_CACHE_NAME;
          
          caches.open(targetCache).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });

      // 1. If we have the file in cache, return it instantly (0ms load)
      if (cachedResponse) {
        // Catch the background fetch error silently here so it doesn't clutter the console
        fetchPromise.catch(() => console.warn('[Billing Service Worker] Background update paused (Offline).'));
        return cachedResponse;
      }

      // 2. If it's NOT in the cache yet, wait for the network fetch
      return fetchPromise.catch(() => {
        // 3. ULTIMATE FAILSAFE: If offline and a requested HTML page isn't in cache, serve offline.html
        if (event.request.headers.get('accept')?.includes('text/html')) {
          console.log('[Billing Service Worker] Offline HTML fallback triggered. Serving offline.html');
          return caches.match('./offline.html');
        }
      });
    })
  );
});
