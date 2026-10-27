import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index';
import { Rooms } from '../server/rooms';
import {
  RoomSources,
  SiteSourceError,
  type BilibiliResolver,
  type TextFetch,
} from '../server/site-source';

const page = 'https://www.bilibili.com/video/BV1TuHM6REHk/';
const cdn = () =>
  `https://upos-sz-mirrorcoso1.bilivideo.com/public/example.mp4?deadline=${Math.floor(Date.now() / 1000) + 3600}&upsig=fixture`;
const media = {
  url: page,
  provider: 'bilibili' as const,
  title: '公开片名',
  source: { kind: 'file' as const, video: cdn(), bilibiliHtml5: true as const },
  duration: 120,
};
function metadataFetch(seen: Array<Record<string, string> | undefined> = []): TextFetch {
  return async (url, _signal, headers) => {
    seen.push(headers);
    const payload = url.includes('/view?')
      ? {
          code: 0,
          data: {
            bvid: 'BV1TuHM6REHk',
            title: '公开片名',
            rights: { pay: 0 },
            pages: [
              { page: 1, cid: 123, duration: 120 },
              { page: 2, cid: 456, duration: 120 },
            ],
          },
        }
      : {
          code: 0,
          data: {
            quality: 16,
            format: 'mp4',
            is_preview: 0,
            is_drm: false,
            timelength: 120000,
            durl: [{ url: cdn() }],
          },
        };
    return Response.json(payload);
  };
}
function request(code: string, seat: { id: string; resume: string }, body: unknown) {
  return new Request(`https://test/resolve-source/${code}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + seat.resume,
      'X-Member-Id': seat.id,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
async function startApp(fetchText: TextFetch, resolverToken = '') {
  const app = createApp({ resolverToken, fetchText });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address() as { port: number };
  return { app, base: `http://127.0.0.1:${address.port}` };
}

test('部署级 B 站解析服务返回的媒体必须与同一 BV/分 P 一致且仍是游客源', async () => {
  const rooms = new Rooms(),
    socket: any = { readyState: 1, send() {}, close() {} };
  const { room, seat } = rooms.create('test', socket);
  const calls: string[] = [];
  const resolver: BilibiliResolver = async (action, url) => {
    calls.push(`${action}:${url}`);
    if (action === 'next') return { url: page + '?p=2', title: '下一分 P' };
    return media;
  };
  const service = new RoomSources(
    rooms,
    async () => {
      throw new Error('解析服务模式不应直接请求原站');
    },
    resolver,
  );
  const resolved = await service.handle(request(room.code, seat, { url: page }));
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).media.source.video, media.source.video);
  assert.deepEqual(calls, [`resolve:${page}`]);
  const next = await service.handle(request(room.code, seat, { action: 'next', url: page }));
  assert.equal(next.status, 200);
  assert.equal((await next.json()).next.url, page + '?p=2');
});

test('解析服务返回越权/异常地址、跨 BV 下一集或错误时不会发布到房间', async () => {
  const rooms = new Rooms(),
    socket: any = { readyState: 1, send() {}, close() {} };
  const { room, seat } = rooms.create('test', socket);
  const bad: BilibiliResolver[] = [
    async () => ({ ...media, source: { ...media.source, bilibiliHtml5: undefined } }),
    async () => ({ ...media, source: { ...media.source, video: 'https://evil.test/a.mp4' } }),
    async () => ({ ...media, source: { ...media.source, audio: cdn() } }),
    async () => ({ ...media, url: page + '?p=2' }),
    async () => ({ url: page + '?p=1', title: '错误分 P' }) as any,
    async () => {
      throw new SiteSourceError('B 站公开接口暂不可用（HTTP 412），请稍后重试');
    },
  ];
  for (const bilibiliResolver of bad) {
    const service = new RoomSources(rooms, metadataFetch(), bilibiliResolver);
    const response = await service.handle(request(room.code, seat, { url: page }));
    assert.equal(response.status, 422);
    assert.equal(room.media, null);
  }
});

test('Node 解析端点要求令牌、限制请求体，并使用 B 站元数据专用请求头', async () => {
  const headers: Array<Record<string, string> | undefined> = [];
  const fetchText = metadataFetch(headers);
  const { app, base } = await startApp(fetchText, 'resolver-token');
  try {
    const endpoint = base + '/internal/bilibili-resolve';
    assert.equal((await fetch(endpoint, { method: 'GET' })).status, 405);
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
          body: JSON.stringify({ url: page }),
        })
      ).status,
      401,
    );
    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer resolver-token',
      },
      body: 'x'.repeat(5000),
    });
    assert.equal(oversized.status, 413);
    const resolved = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer resolver-token',
      },
      body: JSON.stringify({ action: 'resolve', url: page }),
    });
    assert.equal(resolved.status, 200);
    const payload = await resolved.json();
    assert.equal(payload.media.source.video, media.source.video);
    assert.equal(payload.media.source.bilibiliHtml5, true);
    assert.ok(
      headers.every(
        (h) =>
          h?.Referer === 'https://www.bilibili.com/' &&
          /VideoSreeeen\//.test(h?.['User-Agent'] ?? ''),
      ),
    );
    const next = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer resolver-token',
      },
      body: JSON.stringify({ action: 'next', url: page }),
    });
    assert.equal(next.status, 200);
    assert.equal((await next.json()).next.url, page + '?p=2');
  } finally {
    await app.close();
  }
});

test('未配置令牌时 Node 解析端点关闭', async () => {
  const { app, base } = await startApp(metadataFetch());
  try {
    const response = await fetch(base + '/internal/bilibili-resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: page }),
    });
    assert.equal(response.status, 404);
  } finally {
    await app.close();
  }
});
