const CACHE_NAME = 'alpha-waves-v1';
const ASSETS = [
  '/social-media-2/',
  '/social-media-2/index.html',
  '/social-media-2/manifest.json',
  '/social-media-2/android-chrome-192x192.png',
  '/social-media-2/android-chrome-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
      .catch(() => caches.match('/social-media-2/index.html'))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
});

