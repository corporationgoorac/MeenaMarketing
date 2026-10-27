// sw.js (Inside /billing/)

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'billing-app-v8'; // Bumped to v7 to trigger immediate cache refresh for the new offline logic[span_2](start_span)[span_2](end_span)
const DYNAMIC_CACHE_NAME = 'billing-app-dynamic-v7';[span_3](start_span)[span_3](end_span)

// 2. APP SHELL (Core assets located directly inside the 'billing' directory)
const ASSETS_TO_CACHE = [[span_4](start_span)[span_4](end_span)
  './',[span_5](start_span)[span_5](end_span)
  './abc.html',[span_6](start_span)[span_6](end_span)
  './aiBot.html', // Added aiBot.html to core shell[span_7](start_span)[span_7](end_span)
  './bill.html',[span_8](start_span)[span_8](end_span)
  './config.js',[span_9](start_span)[span_9](end_span)
  './dailyCheck.html',[span_10](start_span)[span_10](end_span)
  './icon.png',[span_11](start_span)[span_11](end_span)
  './inventory.html',[span_12](start_span)[span_12](end_span)
  './login.html',[span_13](start_span)[span_13](end_span)
  './manifest.json',[span_14](start_span)[span_14](end_span)
  './offer.html',[span_15](start_span)[span_15](end_span)
  './offline.html', // Added offline.html to be cached instantly[span_16](start_span)[span_16](end_span)
  './pending.html',[span_17](start_span)[span_17](end_span)
  './products.json',[span_18](start_span)[span_18](end_span)
  './today.html[span_19](start_span)'[span_19](end_span)
];[span_20](start_span)[span_20](end_span)

// 3. INSTALL EVENT: Pre-cache the App Shell
self.addEventListener('install', (event) => {[span_21](start_span)[span_21](end_span)
  console.log('[Billing Service Worker] Installing & Caching App Shell...');[span_22](start_span)[span_22](end_span)
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))[span_23](start_span)[span_23](end_span)
      .catch((error) => console.error('[Billing Service Worker] Cache AddAll Failed:', error))[span_24](start_span)[span_24](end_span)
  );
  // Force activate immediately without waiting for open tabs to close
  self.skipWaiting();[span_25](start_span)[span_25](end_span)
});

// 4. ACTIVATE EVENT: Clean up stale/outdated caches
self.addEventListener('activate', (event) => {[span_26](start_span)[span_26](end_span)
  console.log('[Billing Service Worker] Activating...');[span_27](start_span)[span_27](end_span)
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {[span_28](start_span)[span_28](end_span)
            console.log('[Billing Service Worker] Deleting old cache:', cacheName);[span_29](start_span)[span_29](end_span)
            return caches.delete(cacheName);[span_30](start_span)[span_30](end_span)
          }
        })
      );
    })
  );
  // Take control of all open pages in scope immediately
  self.clients.claim();[span_31](start_span)[span_31](end_span)
});

// 5. FETCH EVENT: 0ms Load + Hardware Offline Check & Cache Segregation
self.addEventListener('fetch', (event) => {[span_32](start_span)[span_32](end_span)
  // Intercept only standard GET requests (allows external CDNs to cache, ignores Firebase API calls)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;[span_33](start_span)[span_33](end_span)

  const isHTML = event.request.headers.get('accept')?.includes('text/html');[span_34](start_span)[span_34](end_span)

  // Absolute URL reference for offline.html to prevent cold-start relative path resolution bugs
  const offlinePageUrl = new URL('./offline.html', self.location).href;

  // STRICT HARDWARE OFFLINE CHECK
  // If the device knows it has no internet right now, instantly show offline.html
  if (isHTML && !navigator.onLine) {[span_35](start_span)[span_35](end_span)
    console.warn('[Billing Service Worker] Device is offline. Forcing offline.html');[span_36](start_span)[span_36](end_span)
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
      
      // The background network fetch for 0ms instant updates WITHOUT immediately catching the error
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // If valid response, silently update the cache for the NEXT visit
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {[span_37](start_span)[span_37](end_span)
          const responseClone = networkResponse.clone();[span_38](start_span)[span_38](end_span)
          const requestUrl = new URL(event.request.url);[span_39](start_span)[span_39](end_span)
          
          // PROFESSIONAL TWEAK: Segregate core files vs dynamic external assets
          const isCoreFile = ASSETS_TO_CACHE.some(route =>[span_40](start_span)[span_40](end_span)
            requestUrl.pathname.endsWith(route.replace('./', '')) && route !== './[span_41](start_span)'[span_41](end_span)
          );[span_42](start_span)[span_42](end_span)
          
          // Route the file to the correct organized cache folder
          const targetCache = isCoreFile ? CACHE_NAME : DYNAMIC_CACHE_NAME;[span_43](start_span)[span_43](end_span)
          
          caches.open(targetCache).then((cache) => cache.put(event.request, responseClone).catch((err) => console.warn('[Billing Service Worker] Cache put failed:', err)));[span_44](start_span)[span_44](end_span)
        }
        return networkResponse;[span_45](start_span)[span_45](end_span)
      });

      // 1. If we have the file in cache, return it instantly (0ms load)
      if (cachedResponse) {[span_46](start_span)[span_46](end_span)
        // Catch the background fetch error silently here so it doesn't clutter the console
        fetchPromise.catch(() => console.warn('[Billing Service Worker] Background update paused (Offline).'));[span_47](start_span)[span_47](end_span)
        return cachedResponse;[span_48](start_span)[span_48](end_span)
      }

      // 2. If it's NOT in the cache yet, wait for the network fetch
      return fetchPromise.catch(() => {
        // 3. ULTIMATE FAILSAFE: If offline and a requested HTML page isn't in cache, serve offline.html
        if (isHTML) {[span_49](start_span)[span_49](end_span)
          console.log('[Billing Service Worker] Offline HTML fallback triggered. Serving offline.html');[span_50](start_span)[span_50](end_span)
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
