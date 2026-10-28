import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BilibiliWebSessions } from '../server/bilibili-web-session';
import { createApp } from '../server/index';
import { bilibiliLoginQr } from '../shared/bilibili-login';

const page = 'https://www.bilibili.com/video/BV1R6xN66Exx/';
test('扫码地址接受原站新版 account 路径和旧版 passport 路径，拒绝错 key、重复参数与伪造域名', () => {
  const key = '0123456789abcdef0123456789abcdef';
  for (const base of [
    'https://account.bilibili.com/h5/account-h5/auth/scan-web',
    'https://passport.bilibili.com/h5-app/passport/login/scan',
  ]) {
    const raw = base + '?qrcode_key=' + key;
    assert.equal(bilibiliLoginQr(raw, key)?.href, raw);
    assert.equal(bilibiliLoginQr(raw, '0'.repeat(32)), null);
    assert.equal(bilibiliLoginQr(raw + '&qrcode_key=' + key), null);
    assert.equal(bilibiliLoginQr(raw.replace('bilibili.com', 'bilibili.com.evil.test')), null);
    assert.equal(bilibiliLoginQr(raw.replace('https:', 'http:')), null);
  }
});
function fixture() {
  let now = Date.now(),
    confirmed = false,
    fetchOverride: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
  const seat = { online: true },
    guest = { online: true },
    members = new Map([
      ['host', seat],
      ['guest', guest],
    ]);
  const rooms: any = {
    rooms: new Map([['ABCDEF', { members }]]),
    memberAccess: (code: string, id: string, secret: string) =>
      code === 'ABCDEF' && secret === id + '-secret' && members.get(id)?.online
        ? { seat: members.get(id) }
        : null,
  };
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const track = (name: string) =>
    'https://fixture.mcdn.bilivideo.cn/public/' + name + '.m4s?deadline=' + deadline;
  const key = '0123456789abcdef0123456789abcdef';
  const calls: { url: string; init: RequestInit }[] = [];
  const json = (data: unknown, headers?: HeadersInit) =>
    new Response(JSON.stringify(data), { headers });
  const network = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (fetchOverride) return fetchOverride(url, init);
    assert.equal(init.redirect, 'manual');
    const cookie = new Headers(init.headers).get('cookie');
    if (new URL(url).hostname === 'passport.bilibili.com') {
      assert.equal(cookie, null);
      if (url.includes('/generate'))
        return json({
          code: 0,
          data: {
            qrcode_key: key,
            url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=' + key,
          },
        });
      return json(
        {
          code: 0,
          data: {
            code: confirmed ? 0 : 86101,
            url: 'ignored-credential-url',
            refresh_token: 'ignored-refresh',
          },
        },
        confirmed
          ? {
              'Set-Cookie':
                'SESSDATA=session_fixture; Domain=.bilibili.com; Path=/; Secure; HttpOnly',
            }
          : undefined,
      );
    }
    assert.equal(cookie, 'SESSDATA=session_fixture');
    if (url.endsWith('/nav')) return json({ code: 0, data: { isLogin: true } });
    if (url.includes('/view?'))
      return json({
        code: 0,
        data: {
          bvid: 'BV1R6xN66Exx',
          rights: { pay: 0 },
          pages: [{ page: 1, cid: 123, duration: 70 }],
        },
      });
    assert.match(url, /qn=80&fnval=16$/);
    return json({
      code: 0,
      data: {
        timelength: 70000,
        dash: {
          duration: 70,
          video: [{ width: 1920, height: 1080, codecs: 'avc1.640032', baseUrl: track('video') }],
          audio: [{ codecs: 'mp4a.40.2', baseUrl: track('audio') }],
        },
      },
    });
  };
  const sessions = new BilibiliWebSessions(rooms, network, () => now);
  const id = randomUUID();
  const req = (
    action: string,
    input: any = { id },
    member = 'host',
    origin: string | null = 'http://localhost',
  ) =>
    new Request('http://localhost/bili-web/ABCDEF/' + action, {
      method: 'POST',
      headers: {
        Host: 'localhost',
        ...(origin ? { Origin: origin } : {}),
        'X-Member-Id': member,
        Authorization: 'Bearer ' + member + '-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  return {
    sessions,
    calls,
    req,
    seat,
    guest,
    rooms,
    id,
    setConfirmed: () => {
      confirmed = true;
    },
    advance: (ms: number) => {
      now += ms;
    },
    override: (fn?: typeof fetchOverride) => {
      fetchOverride = fn;
    },
    json,
  };
}

test('网页取源验证默认关闭；登录接口不由普通 Node 实例暴露', async () => {
  const app = createApp();
  app.server.listen(0, '127.0.0.1');
  await new Promise<void>((r) => app.server.once('listening', r));
  try {
    const origin = 'http://127.0.0.1:' + (app.server.address() as any).port;
    assert.equal((await (await fetch(origin + '/config')).json()).bilibiliWebTrial, false);
    assert.equal((await fetch(origin + '/bili-web/ABCDEF/start', { method: 'POST' })).status, 404);
  } finally {
    await app.close();
  }
});

test('扫码会话仅供发起成员使用，原站 Cookie 只发给固定元数据接口，不进入响应或房间', async () => {
  const f = fixture();
  const created = await f.sessions.handle(f.req('start'));
  assert.equal(created.headers.get('cache-control'), 'private, no-store');
  assert.equal((await created.json()).state, 'waiting');
  assert.equal((await (await f.sessions.handle(f.req('poll'))).json()).state, 'waiting');
  f.advance(3000);
  f.setConfirmed();
  const authorized = await (await f.sessions.handle(f.req('poll'))).json();
  assert.equal(authorized.state, 'authorized');
  assert.equal(JSON.stringify(authorized).includes('session_fixture'), false);
  const media = await (await f.sessions.handle(f.req('resolve', { url: page }))).json();
  assert.equal(media.media.source.bilibiliDirect, true);
  assert.equal(media.media.source.kind, 'dash');
  assert.equal(JSON.stringify(media).includes('session_fixture'), false);
  assert.equal((await f.sessions.handle(f.req('logout', {}))).status, 200);
  assert.equal((await f.sessions.handle(f.req('resolve', { url: page }))).status, 409);
  assert.equal((await f.sessions.handle(f.req('resolve', { url: page }, 'guest'))).status, 409);
  assert.equal(f.rooms.rooms.get('ABCDEF').media, undefined);
  assert.equal(
    f.calls.some((c) => new URL(c.url).hostname.includes('bilivideo')),
    false,
  );
  f.sessions.close();
});

test('拒绝非同源、无成员凭证与无效扫码请求；不向原站发起请求', async () => {
  const f = fixture();
  for (const origin of [null, 'null', 'https://evil.test'])
    assert.equal(
      (await f.sessions.handle(f.req('start', { id: f.id }, 'host', origin))).status,
      403,
    );
  const invalid = f.req('start');
  invalid.headers.set('Authorization', 'Bearer wrong');
  assert.equal((await f.sessions.handle(invalid)).status, 401);
  assert.equal((await f.sessions.handle(f.req('start', { id: 'bad' }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('停止、会话期限、离开房间会失效；旧取消不能删除新的登录事务', async () => {
  const f = fixture();
  await f.sessions.handle(f.req('start'));
  f.advance(11000);
  const next = randomUUID();
  await f.sessions.handle(f.req('start', { id: next }));
  await f.sessions.handle(f.req('stop'));
  f.setConfirmed();
  assert.equal(
    (await (await f.sessions.handle(f.req('poll', { id: next }))).json()).state,
    'authorized',
  );
  f.advance(15 * 60 * 1000 + 1);
  f.sessions.sweep();
  assert.equal((await f.sessions.handle(f.req('resolve', { url: page }))).status, 409);
  await f.sessions.handle(f.req('start'));
  f.setConfirmed();
  await f.sessions.handle(f.req('poll'));
  f.seat.online = false;
  f.sessions.sweep();
  f.seat.online = true;
  assert.equal((await f.sessions.handle(f.req('resolve', { url: page }))).status, 409);
  await f.sessions.handle(f.req('start'));
  f.advance(120001);
  assert.equal((await f.sessions.handle(f.req('poll'))).status, 409);
});

test('源站拒绝、跳转、错误 Cookie 作用域和过大响应失败保密；不冒充登录成功', async () => {
  for (const status of [302, 412]) {
    const f = fixture();
    f.override(async () => new Response('private underlying message', { status }));
    const response = await f.sessions.handle(f.req('start'));
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.ok(text.includes(String(status)));
    assert.ok(!text.includes('private underlying'));
  }
  for (const cookie of [
    'SESSDATA=fixture; Domain=evil.test; Path=/',
    'other=fixture; Domain=.bilibili.com',
    'SESSDATA=bad value; Domain=.bilibili.com',
    'SESSDATA=fixture; Domain=.bilibili.com; Path=/; Max-Age=0',
    'SESSDATA=fixture; Domain=.bilibili.com; Path=/other/',
  ]) {
    const f = fixture();
    await f.sessions.handle(f.req('start'));
    f.override(async () => f.json({ code: 0, data: { code: 0 } }, { 'Set-Cookie': cookie }));
    assert.equal((await f.sessions.handle(f.req('poll'))).status, 400);
    assert.equal((await f.sessions.handle(f.req('resolve', { url: page }))).status, 409);
  }
  const f = fixture();
  f.override(async () => new Response('x'.repeat(512 * 1024 + 1)));
  assert.equal((await f.sessions.handle(f.req('start'))).status, 400);
});

test('停止中的迟到登录响应不能保存会话，也不能删除后续的新事务', async () => {
  const f = fixture();
  await f.sessions.handle(f.req('start'));
  let release!: (response: Response) => void;
  const received = new Promise<Response>((r) => {
    release = r;
  });
  f.override(async () => received);
  const pending = f.sessions.handle(f.req('poll'));
  while (f.calls.length < 2) await new Promise<void>((r) => setImmediate(r));
  await f.sessions.handle(f.req('stop'));
  f.override(undefined);
  const next = randomUUID();
  await f.sessions.handle(f.req('start', { id: next }));
  release(
    f.json(
      { code: 0, data: { code: 0 } },
      { 'Set-Cookie': 'SESSDATA=session_fixture; Domain=.bilibili.com; Path=/' },
    ),
  );
  assert.notEqual((await pending).status, 200);
  f.setConfirmed();
  assert.equal(
    (await (await f.sessions.handle(f.req('poll', { id: next }))).json()).state,
    'authorized',
  );
  f.sessions.close();
});
