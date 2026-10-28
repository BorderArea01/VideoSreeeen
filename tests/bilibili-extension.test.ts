import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { nextBilibiliPage, bilibiliPage } from '../shared/bilibili';
import { allowedSiteMetadata, RoomSources } from '../server/site-source';
import { Rooms } from '../server/rooms';
import { readFileSync } from 'node:fs';
import { supportsBilibiliExtension } from '../client/bilibili-extension';

const source = buildSync({
  entryPoints: ['extension/background.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
}).outputFiles[0]!.text;
const id = '11111111-1111-4111-8111-111111111111';
const page = 'https://www.bilibili.com/video/BV1R6xN66Exx/';

test('旧取源助手必须先更新，观众端不要求助手；版本判断支持后续补丁和小版本', () => {
  for (const version of [undefined, null, '', '0.1.0', '0.0.99', '0.1.1-beta', 'invalid'])
    assert.equal(supportsBilibiliExtension(version), false);
  for (const version of ['0.1.1', '0.1.10', '0.2.0', '1.0.0'])
    assert.equal(supportsBilibiliExtension(version), true);
});
function environment(fetcher: typeof fetch) {
  let listener: any, removed: any, updated: any;
  runInNewContext(source, {
    chrome: {
      runtime: {
        getManifest: () => ({ version: 'test-helper-version' }),
        onMessage: {
          addListener: (fn: any) => {
            listener = fn;
          },
        },
      },
      tabs: {
        onRemoved: {
          addListener: (fn: any) => {
            removed = fn;
          },
        },
        onUpdated: {
          addListener: (fn: any) => {
            updated = fn;
          },
        },
      },
    },
    fetch: fetcher,
    URL,
    Headers,
    Response,
    AbortController,
    AbortSignal,
    Uint8Array,
    TextDecoder,
    Map,
    Error,
    Number,
  });
  const call = (
    message: any,
    sender: any = { frameId: 0, url: 'https://videosreeeen.pages.dev/', tab: { id: 3 } },
  ) => new Promise<any>((done) => listener({ id, ...message }, sender, done));
  return { call, removed, updated };
}

test('扩展只给受信网页顶层提供固定 B 站元数据能力，没有读取或导出 Cookie 权限', async () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://api.bilibili.com/*']);
  assert.equal(manifest.permissions, undefined);
  let calls = 0;
  const e = environment(async () => {
    calls++;
    return Response.json({});
  });
  for (const sender of [
    { frameId: 1, url: 'https://videosreeeen.pages.dev/', tab: { id: 3 } },
    { frameId: 0, url: 'https://videosreeeen.pages.dev.evil.test/', tab: { id: 3 } },
    { frameId: 0, url: 'https://www.bilibili.com/', tab: { id: 3 } },
    { frameId: 0, url: 'file:///app.html', tab: { id: 3 } },
    { frameId: 0, url: 'http://192.168.0.3/', tab: { id: 3 } },
  ])
    assert.equal((await e.call({ action: 'resolve', url: page }, sender)).code, 'DENIED');
  assert.equal(
    (await e.call({ action: 'fetch', url: 'https://api.bilibili.com/account' })).code,
    'DENIED',
  );
  assert.equal(
    (await e.call({ action: 'resolve', url: 'https://evil.test/' })).code,
    'SOURCE_FAILED',
  );
  assert.equal(calls, 0);
  assert.equal((await e.call({ action: 'ping' })).version, 'test-helper-version');
});

test('未登录时仅检查登录状态，凭据由浏览器处理，不发游客请求，不泄露接口响应', async () => {
  const requests: string[] = [];
  const e = environment(async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json({ code: -101, data: { isLogin: false, secret: 'never-return' } });
  });
  const result = await e.call({ action: 'resolve', url: page });
  assert.equal(result.code, 'LOGIN_REQUIRED');
  assert.deepEqual(requests, ['https://api.bilibili.com/x/web-interface/nav']);
  assert.ok(!JSON.stringify(result).includes('never-return'));
});

test('扩展取源支持取消、导航销毁、状态码保真和异常脱敏', async () => {
  let pending: AbortSignal | null = null;
  let started!: () => void;
  let ready = new Promise<void>((done) => {
    started = done;
  });
  const e = environment(async (_url, init) => {
    pending = init!.signal!;
    started();
    return new Promise<Response>((_done, reject) =>
      pending!.addEventListener('abort', () =>
        reject(new Error('https://private.test/?token=secret')),
      ),
    );
  });
  const first = e.call({ action: 'resolve', url: page });
  await ready;
  await e.call({ action: 'cancel' });
  assert.equal((await first).code, 'CANCELLED');
  ready = new Promise<void>((done) => {
    started = done;
  });
  const second = e.call({ action: 'resolve', url: page });
  await ready;
  e.updated(3, { status: 'loading' });
  assert.equal((await second).code, 'CANCELLED');
  const denied = environment(async () => new Response('private', { status: 412 }));
  assert.match((await denied.call({ action: 'resolve', url: page })).error, /HTTP 412/);
  const failed = environment(async () => {
    throw Error('https://private.test/?token=secret');
  });
  assert.doesNotMatch(
    JSON.stringify(await failed.call({ action: 'resolve', url: page })),
    /token|private|secret/,
  );
});

test('下一分 P 仅使用同 BV 原站列表；云端不再取 B 站元数据或游客流', async () => {
  const read = async () =>
    JSON.stringify({
      code: 0,
      data: { bvid: 'BV1R6xN66Exx', pages: [{ page: 1 }, { page: 2, part: '后篇' }] },
    });
  assert.equal((await nextBilibiliPage(page, read))?.url, page + '?p=2');
  assert.equal(await nextBilibiliPage(page + '?p=2', read), null);
  for (const url of [page.replace('https:', 'http:'), page + '?p=0', page + '?p=1&secret=1'])
    assert.throws(() => bilibiliPage(url));
  for (const url of [
    page,
    'https://api.bilibili.com/x/web-interface/nav',
    'https://api.bilibili.com/x/player/playurl?bvid=BV1R6xN66Exx&cid=123&qn=32&platform=html5',
  ])
    assert.equal(allowedSiteMetadata(url), false);
  const rooms = new Rooms(),
    socket: any = { readyState: 1, send() {}, close() {} };
  const { room, seat } = rooms.create('test', socket);
  let calls = 0;
  const service = new RoomSources(rooms, async () => {
    calls++;
    return Response.json({});
  });
  const response = await service.handle(
    new Request(`https://test/resolve-source/${room.code}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + seat.resume, 'X-Member-Id': seat.id },
      body: JSON.stringify({ url: page }),
    }),
  );
  assert.equal(response.status, 422);
  assert.equal(calls, 0);
  assert.equal(room.media, null);
});
