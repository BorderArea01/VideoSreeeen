// Only this public, redirecting video CDN needs a fresh HTTP range response.
// Keep opaque responses opaque: no CORS bypass, response parsing, disk cache,
// application credentials or room-server media traffic.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'vs-disk-probe') event.ports[0]?.postMessage({ version: 1 });
});
// Same-client, application-owned disk resources. Never fetches an origin video.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = /^\/__vs_disk__\/([a-f0-9-]{36})\/([a-zA-Z0-9._-]{1,81})$/.exec(url.pathname);
  if (url.origin !== self.location.origin || !match) return;
  event.respondWith(
    (async () => {
      if (!event.clientId || !['GET', 'HEAD'].includes(event.request.method))
        return new Response('', { status: 404 });
      const client = await self.clients.get(event.clientId);
      if (!client || new URL(client.url).origin !== self.location.origin)
        return new Response('', { status: 404 });
      const channel = new MessageChannel();
      const port = channel.port1;
      let pending;
      const next = () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending = undefined;
            port.close();
            reject(new Error('Disk read timed out'));
          }, 30000);
          pending = (value) => {
            clearTimeout(timer);
            pending = undefined;
            value.error ? reject(new Error('Disk unavailable')) : resolve(value);
          };
        });
      port.onmessage = ({ data }) => pending?.(data);
      const metadata = next();
      client.postMessage({ type: 'vs-disk-read', job: match[1], name: match[2] }, [channel.port2]);
      try {
        const { size, block } = await metadata;
        if (!Number.isSafeInteger(size) || size < 1 || block !== 262144)
          throw new Error('Invalid disk metadata');
        let start = 0,
          end = size - 1;
        const range = event.request.headers.get('range');
        if (range) {
          const r = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!r || (!r[1] && !r[2])) {
            port.close();
            return new Response('', {
              status: 416,
              headers: { 'Content-Range': `bytes */${size}` },
            });
          }
          start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
          end = r[1] && r[2] ? Math.min(end, Number(r[2])) : end;
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= size
        ) {
          port.close();
          return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        let position = start;
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const offset = Math.floor(position / block) * block;
              const response = next();
              port.postMessage({ offset });
              const { bytes } = await response;
              if (
                !(bytes instanceof ArrayBuffer) ||
                bytes.byteLength !== Math.min(block, size - offset)
              )
                throw new Error('Invalid disk block');
              const part = new Uint8Array(bytes).subarray(
                position - offset,
                Math.min(bytes.byteLength, end - offset + 1),
              );
              position += part.length;
              controller.enqueue(part);
              if (position > end) {
                port.postMessage({ cancel: true });
                port.close();
                controller.close();
              }
            } catch (error) {
              port.close();
              controller.error(error);
            }
          },
          cancel() {
            port.postMessage({ cancel: true });
            port.close();
          },
        });
        const headers = {
          'Content-Type': match[2].endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        if (event.request.method === 'HEAD') {
          await stream.cancel();
          return new Response(null, { status: range ? 206 : 200, headers });
        }
        return new Response(stream, { status: range ? 206 : 200, headers });
      } catch {
        port.close();
        return new Response('', { status: 503 });
      }
    })(),
  );
});
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
