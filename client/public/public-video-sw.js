// Only this public, redirecting video CDN needs a fresh HTTP range response.
// Keep opaque responses opaque: no CORS bypass, response parsing, disk cache,
// application credentials or room-server media traffic.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (
    request.method !== 'GET' ||
    request.destination !== 'video' ||
    request.mode !== 'no-cors' ||
    new URL(request.url).origin !== 'https://apn.moedot.net'
  )
    return;
  event.respondWith(fetch(request, { cache: 'no-store', credentials: 'omit' }));
});
