import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAccountBilibiliMetadata, resolveAccountBilibiliPage } from '../shared/bilibili';
import { allowedSiteMetadata } from '../server/site-source';
import { MediaRelay } from '../server/media';

const page = 'https://www.bilibili.com/video/BV1R6xN66Exx/';
const deadline = Math.floor(Date.now() / 1000) + 3600;
const source = (name: string) =>
  'https://fixture.mcdn.bilivideo.cn:4483/public/' +
  name +
  '.m4s?deadline=' +
  deadline +
  '&upsig=fixture';
function fixture() {
  const nav: any = { code: 0, data: { isLogin: true } };
  const info: any = {
    code: 0,
    data: {
      bvid: 'BV1R6xN66Exx',
      title: '完整视频',
      rights: { pay: 0 },
      pages: [
        { page: 1, cid: 123, duration: 862 },
        { page: 2, cid: 456, duration: 862 },
      ],
    },
  };
  const play: any = {
    code: 0,
    data: {
      quality: 80,
      format: 'flv',
      timelength: 862000,
      is_preview: false,
      is_drm: false,
      dash: {
        duration: 862,
        video: [
          { width: 3840, height: 2160, codecs: 'avc1.640034', baseUrl: source('4k') },
          { width: 1920, height: 1080, codecs: 'hvc1.1.6', baseUrl: source('hevc') },
          { width: 1280, height: 720, codecs: 'avc1.640028', baseUrl: source('720') },
          { width: 1920, height: 1080, codecs: 'avc1.640032', baseUrl: source('1080') },
        ],
        audio: [{ codecs: 'mp4a.40.2', baseUrl: source('audio'), bandwidth: 128000 }],
      },
    },
  };
  const requests: string[] = [];
  const read = async (url: string) => {
    assert.equal(allowedAccountBilibiliMetadata(url), true);
    requests.push(url);
    return JSON.stringify(url.endsWith('/nav') ? nav : url.includes('/view?') ? info : play);
  };
  return { nav, info, play, read, requests };
}
test('本机正常登录取源选完整 AVC 1080p / AAC，保留签名与分 P；云端匿名白名单不扩大', async () => {
  const f = fixture(),
    result = await resolveAccountBilibiliPage(page + '?p=2', f.read);
  assert.equal(result.source?.video, source('1080'));
  assert.equal(result.source?.audio, source('audio'));
  assert.equal(result.source?.bilibiliDirect, true);
  assert.equal(result.duration, 862);
  assert.equal(result.url, page + '?p=2');
  assert.match(f.requests[2]!, /cid=456&qn=80&fnval=16&platform=html5&high_quality=1$/);
  assert.equal(allowedSiteMetadata(f.requests[2]!), false);
  assert.equal(JSON.stringify(result).includes('isLogin'), false);
  for (const raw of [
    f.requests[2] + '&try_look=1',
    f.requests[2]!.replace('&platform=html5&high_quality=1', ''),
    f.requests[2]!.replace('platform=html5', 'platform=pc'),
    f.requests[2]!.replace('high_quality=1', 'high_quality=0'),
    f.requests[2] + '&cookie=secret',
    'https://api.bilibili.com/x/web-interface/nav?redirect=https://evil.test',
    'https://api.bilibili.com.evil.test/x/web-interface/nav',
    'https://u:p@api.bilibili.com/x/web-interface/nav',
    'http://api.bilibili.com/x/web-interface/nav',
  ])
    assert.equal(allowedAccountBilibiliMetadata(raw), false);
});
test('未登录直接返回真实登录条件，不继续请求播放流、不默默退回游客源', async () => {
  const f = fixture();
  f.nav.data.isLogin = false;
  await assert.rejects(
    resolveAccountBilibiliPage(page, f.read),
    (e: any) => e.code === 'BILIBILI_LOGIN_REQUIRED',
  );
  assert.equal(f.requests.length, 1);
});

test('保留原站实际返回的 MCDN 8082 签名地址，优先于需要原站请求头的常规备源', async () => {
  const f = fixture();
  const original = source('1080').replace(':4483', ':8082');
  const track = f.play.data.dash.video.find((v: any) => v.codecs === 'avc1.640032');
  track.baseUrl = 'https://upos-sz-mirrorhwo1.bilivideo.com/public/video.m4s?deadline=' + deadline;
  track.backupUrl = [original];
  f.play.data.dash.audio[0].baseUrl = source('audio').replace(':4483', ':8082');
  const result = await resolveAccountBilibiliPage(page, f.read);
  assert.equal(result.source?.video, original);
  assert.equal(new URL(result.source!.audio!).port, '8082');
  assert.equal(result.source?.referer, undefined);
});

test('高清源在自建后端也保持各端原 CDN 加载；缓存计划不把服务器包装成原站代理', async () => {
  const media = await resolveAccountBilibiliPage(page, fixture().read);
  const room: any = { code: 'ABCDEF', mediaToken: 'fixture', media: { ...media, id: 'movie' } };
  const relay = new MediaRelay({ mediaAccess: () => room } as any);
  const plan = await relay.plan(room);
  assert.deepEqual(
    plan.files.map((f) => f.url),
    [media.source!.video, media.source!.audio],
  );
  let status = 0;
  const response: any = {
    writeHead(value: number) {
      status = value;
      return this;
    },
    end() {},
  };
  assert.equal(
    await relay.handle({ headers: {} } as any, response, '/media/ABCDEF/fixture/video'),
    true,
  );
  assert.equal(status, 404);
});
test('拒绝试看、DRM、错媒体、缺音轨、短片替代、失效签名、未知 CDN 与非高清替代', async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.info.data.rights.pay = 1;
    },
    (f) => {
      f.info.data.is_upower_exclusive = true;
    },
    (f) => {
      f.info.data.bvid = 'BV13Aa66LEAW';
    },
    (f) => {
      f.play.data.is_preview = true;
    },
    (f) => {
      f.play.data.is_drm = true;
    },
    (f) => {
      f.play.data.cid = 999;
    },
    (f) => {
      f.play.data.timelength = 6000;
    },
    (f) => {
      f.play.data.dash.duration = 6;
    },
    (f) => {
      f.play.data.dash.audio = [];
    },
    (f) => {
      f.play.data.dash.video = [
        { width: 640, height: 360, codecs: 'avc1.64001e', baseUrl: source('360') },
      ];
    },
    (f) => {
      for (const v of f.play.data.dash.video) v.is_drm = true;
    },
    (f) => {
      for (const v of f.play.data.dash.video)
        v.baseUrl = 'https://evil.test/a.m4s?deadline=9999999999';
    },
    (f) => {
      for (const v of f.play.data.dash.video)
        v.baseUrl = source('video').replace('deadline=', 'expired=');
    },
    (f) => {
      for (const v of f.play.data.dash.video) v.baseUrl = source('video').replace(':4483', ':1234');
    },
    (f) => {
      f.play.data.dash.audio[0].baseUrl = source('audio').replace(
        'bilivideo.cn',
        'bilivideo.cn.evil.test',
      );
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    await assert.rejects(resolveAccountBilibiliPage(page, f.read));
  }
});
