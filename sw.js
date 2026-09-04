const CACHE = 'elephant-v3';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate' || ASSETS.includes(new URL(e.request.url).pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
