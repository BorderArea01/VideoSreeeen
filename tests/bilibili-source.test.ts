import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedSiteMetadata, RoomSources } from '../server/site-source';
import { bilibiliPage, resolveBilibiliPage, nextBilibiliPage } from '../server/bilibili-source';
import { Rooms } from '../server/rooms';

const page = 'https://www.bilibili.com/video/BV1TuHM6REHk/';
const cdn = () =>
  `https://upos-sz-mirrorcoso1.bilivideo.com/public/example.mp4?deadline=${Math.floor(Date.now() / 1000) + 3600}&upsig=fixture`;
function fixture() {
  const info = {
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
  };
  const play = {
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
  const requests: string[] = [];
  const read = async (url: string) => {
    assert.equal(allowedSiteMetadata(url), true);
    requests.push(url);
    return JSON.stringify(url.includes('/view?') ? info : play);
  };
  return { info, play, read, requests };
}

test('B 站本机下一分 P 只使用官方同 BV 剧集列表，末 P 不猜地址', async () => {
  const f = fixture();
  assert.equal((await nextBilibiliPage(page, f.read))?.url, page + '?p=2');
  assert.equal(await nextBilibiliPage(page + '?p=2', f.read), null);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((url) => url.includes('/x/web-interface/view?')));
});

test('B 站游客 HTML5 只取公开元数据，保留原 CDN 签名与所选分 P', async () => {
  const f = fixture();
  const media = await resolveBilibiliPage(page + '?p=2', f.read);
  assert.equal(media.url, page + '?p=2');
  assert.equal(media.provider, 'bilibili');
  assert.equal(media.title, '公开片名 · P2');
  assert.deepEqual(media.source, {
    kind: 'file',
    video: f.play.data.durl[0]!.url,
    bilibiliHtml5: true,
  });
  assert.equal(media.duration, 120);
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[1]!, /cid=456&qn=32&platform=html5$/);
  assert.ok(f.requests.every((u) => new URL(u).hostname === 'api.bilibili.com'));
  for (const raw of [
    page.replace('https:', 'http:'),
    page + '?p=0',
    page + '?p=2&vip=1',
    page.replace('www.bilibili.com', 'www.bilibili.com.evil.test'),
    page.replace('www.', 'u:p@www.'),
  ])
    assert.throws(() => bilibiliPage(raw));
  for (const url of [
    'https://api.bilibili.com/x/player/playurl?bvid=BV1TuHM6REHk&cid=123&qn=80&platform=html5',
    'https://api.bilibili.com/x/web-interface/view?bvid=BV1TuHM6REHk&cookie=secret',
    'https://api.bilibili.com/x/player/playurl?bvid=BV1TuHM6REHk&cid=123&qn=32&platform=html5&try_look=1',
  ])
    assert.equal(allowedSiteMetadata(url), false);
});

test('B 站拒绝付费、预览、短片替代、多段、错分 P、失效签名及未知 CDN', async () => {
  const variants = [
    (f: ReturnType<typeof fixture>) => {
      f.info.data.rights.pay = 1;
    },
    (f: ReturnType<typeof fixture>) => {
      f.info.data.bvid = 'BV13Aa66LEAW';
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.is_preview = 1;
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.is_drm = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.timelength = 6000;
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.durl.push({ url: cdn() });
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.durl[0]!.url = 'https://evil.test/a.mp4?deadline=9999999999';
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.durl[0]!.url = cdn().replace('bilivideo.com', 'bilivideo.com.evil.test');
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.data.durl[0]!.url = cdn().replace(/deadline=\d+/, 'deadline=1');
    },
    (f: ReturnType<typeof fixture>) => {
      f.play.code = -10403;
    },
  ];
  for (const change of variants) {
    const f = fixture();
    change(f);
    await assert.rejects(resolveBilibiliPage(page, f.read));
  }
  const f = fixture();
  await assert.rejects(resolveBilibiliPage(page + '?p=3', f.read));
  assert.equal(f.requests.length, 1);
});

test('B 站识别仍需在线成员，不发布房间状态，也不向原站发送房间凭据', async () => {
  const rooms = new Rooms(),
    socket: any = { readyState: 1, send() {}, close() {} };
  const { room, seat } = rooms.create('test', socket);
  const f = fixture();
  const sources = new RoomSources(rooms, async (url) => new Response(await f.read(url)));
  const request = (secret: string) =>
    new Request(`https://test/resolve-source/${room.code}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'X-Member-Id': seat.id },
      body: JSON.stringify({ url: page }),
    });
  assert.equal((await sources.handle(request('invalid'))).status, 401);
  assert.equal(f.requests.length, 0);
  const response = await sources.handle(request(seat.resume));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).media.source.video, f.play.data.durl[0]!.url);
  assert.equal(room.media, null);
  assert.equal((await sources.handle(request(seat.resume))).status, 429);
});
