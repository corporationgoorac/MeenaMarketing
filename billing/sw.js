// sw.js (Inside /billing/)

// 1. CACHE CONFIGURATION
const CACHE_NAME = 'billing-app-v10'; // Bumped to v10 to apply the self-healing fix
const DYNAMIC_CACHE_NAME = 'billing-app-dynamic-v10';

// 2. APP SHELL (Matched EXACTLY to your actual folder contents)
const ASSETS_TO_CACHE = [
  './abc.html',
  './aiBot.html',
  './bill.html',
  './config.js',
  './dailyCheck.html',
  './icon.png',
  './inventory.html',
  './login.html',
  './manifest.json',
  './offer.html',
  './offline.html',
  './pending.html',
  './products.json',
  './today.html',
  './viewBill.html'
];

// 3. INSTALL EVENT: Pre-cache the App Shell Individually
self.addEventListener('install', (event) => {
  console.log('[Billing Service Worker] Installing & Caching App Shell...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ADVANCED FIX 1: Cache individually! If one file ever goes missing, it skips it safely instead of crashing everything.
      return Promise.all(
        ASSETS_TO_CACHE.map((file) => {
          return cache.add(file).catch((err) => {
            console.warn(`[Billing Service Worker] Skipped caching missing file: ${file}`, err);
          });
        })
      );
    })
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
          // ADVANCED FIX 2: Only delete old BILLING caches (starts with 'billing-app-'). Stop deleting the Marketing caches!
          if (cacheName.startsWith('billing-app-') && cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
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

// --- ADVANCED FIX 6: SILENT BACKGROUND HEALING ---
// This function runs without blocking the UI. It checks for critical missing files
// and silently restores them to the cache in the background.
function silentBackgroundHeal() {
  const criticalFiles = [
    './offline.html'
    // Note: You can add more absolute must-have files here in the future
  ];
  
  caches.open(CACHE_NAME).then((cache) => {
    criticalFiles.forEach((file) => {
      cache.match(file).then((cachedResponse) => {
        if (!cachedResponse) {
          console.log(`[Billing Service Worker] Background Heal: Missing ${file} detected. Downloading silently...`);
          fetch(file).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(file, networkResponse.clone());
              console.log(`[Billing Service Worker] Background Heal: Successfully restored ${file} to cache.`);
            }
          }).catch(() => {
            // Fails completely silently if the network drops during the background heal
          });
        }
      });
    });
  });
}
// --------------------------------------------------

// 5. FETCH EVENT: 0ms Load + Hardware Offline Check & Cache Segregation
self.addEventListener('fetch', (event) => {
  // Intercept only standard GET requests (allows external CDNs to cache, ignores Firebase API calls)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  const isHTML = event.request.headers.get('accept')?.includes('text/html');
  
  // ADVANCED FIX 3: Absolute URL reference for offline.html to prevent cold-start relative path bugs
  const offlinePageUrl = new URL('./offline.html', self.location).href;

  // STRICT HARDWARE OFFLINE CHECK
  // If the device knows it has no internet right now, instantly show offline.html
  if (isHTML && !navigator.onLine) {
    console.warn('[Billing Service Worker] Device is offline. Forcing offline.html');
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

  // TRIGGER SILENT HEAL (Only runs when online and requesting an HTML page)
  // event.waitUntil ensures the Service Worker stays alive long enough to finish the background check,
  // but it DOES NOT block event.respondWith from returning the page instantly.
  if (isHTML && navigator.onLine) {
    event.waitUntil(
      Promise.resolve().then(() => silentBackgroundHeal())
    );
  }

  // IF ONLINE: Proceed with 0ms Instant Load (Stale-While-Revalidate)
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
          
          // ADVANCED FIX 4: Catch background cache-put network errors safely
          caches.open(targetCache).then((cache) => cache.put(event.request, responseClone).catch(() => {}));
        }
        return networkResponse;
      });

      // 1. If we have the file in cache, return it instantly (0ms load)
      if (cachedResponse) {
        // Catch the background fetch error silently here so it doesn't clutter the console
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      // 2. If it's NOT in the cache yet, wait for the network fetch
      return fetchPromise.catch(() => {
        // ADVANCED FIX 5: HTML fails -> show offline.html. Image/JS fails -> return empty Response to avoid TypeError crash.
        if (isHTML) {
          console.log('[Billing Service Worker] Offline HTML fallback triggered. Serving offline.html');
          return caches.match(offlinePageUrl).then((response) => {
            return response || caches.match('./offline.html').then((relResponse) => {
              return relResponse || new Response('<h2>You are offline</h2>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
              });
            });
          });
        }
        // Fallback for non-HTML requests (images, external APIs) so it doesn't return undefined and crash
        return new Response('', { status: 404, statusText: 'Offline' });
      });
    })
  );
});
