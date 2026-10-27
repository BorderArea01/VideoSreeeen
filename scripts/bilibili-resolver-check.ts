import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index';

// Public verification only. Never print the signed CDN URL, cookies or raw response.
const source = process.argv[2] || 'https://www.bilibili.com/video/BV1TuHM6REHk/';
const configured = process.env.VS_RESOLVER_URL?.trim();
const token = configured ? process.env.VS_RESOLVER_TOKEN?.trim() || '' : 'local-resolver-check';
assert.ok(configured || token, 'VS_RESOLVER_URL requires VS_RESOLVER_TOKEN');
const app = configured ? undefined : createApp({ resolverToken: token });
let base = configured?.replace(/\/+$/, '');
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
}
try {
  const response = await fetch(base + '/internal/bilibili-resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action: 'resolve', url: source }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await response.json()) as any;
  assert.equal(response.status, 200, String(payload?.error ?? ''));
  assert.equal(payload.media?.provider, 'bilibili');
  assert.equal(payload.media?.source?.bilibiliHtml5, true);
  assert.equal(payload.media?.source?.kind, 'file');
  assert.match(new URL(payload.media.source.video).hostname, /^[a-z0-9-]+\.bilivideo\.com$/);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: configured ? 'configured-resolver' : 'local-node',
        title: payload.media.title,
        duration: payload.media.duration,
        bilibiliHtml5: true,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
}
