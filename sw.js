const CACHE_NAME = 'doko-v4.40';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Alte Caches aufräumen
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // Allen offenen Clients Bescheid geben, dass eine neue Version aktiv ist
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
    });
  })());
});

self.addEventListener('fetch', e => {
  const url=e.request.url;
  if(url.includes('firebasedatabase.app')||url.includes('firebaseio.com')||url.includes('gstatic.com/firebasejs')||url.includes('cdnjs.cloudflare.com/ajax/libs/qrcode'))return;
  e.respondWith(
    fetch(e.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      return response;
    }).catch(() => caches.match(e.request))
  );
});
