const CACHE_NAME = 'glassy-v1';
const ASSETS = [
  '/',
  '/social-media-2/',
  '/social-media-2/index.html',
  '/social-media-2/manifest.json',
  '/social-media-2/icons/icon-192.png',
  '/social-media-2/icons/icon-512.png'
  // প্রয়োজন হলে আরো asset যোগ করো: CSS/js/images ইত্যাদি
];

// Install - cache core files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => k !== CACHE_NAME ? caches.delete(k) : null))
    )
  );
  self.clients.claim();
});

// Fetch - try cache first, fallback to network
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET requests
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Put a copy in cache for future
          return caches.open(CACHE_NAME).then((cache) => {
            // safe: only cache successful responses
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(req, res.clone());
            }
            return res;
          });
        })
        .catch(() => caches.match('/social-media-2/index.html')); // offline fallback
    })
  );
});
