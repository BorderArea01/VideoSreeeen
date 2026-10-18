import test from 'node:test';
import assert from 'node:assert/strict';
import { playerFixture, metadataFixture } from './site-source.fixture';
import { Rooms } from '../server/rooms';
import {
  allowedSiteMetadata,
  assignedJson,
  mgnPage,
  mgnPublicSource,
  resolveMgnPage,
  RoomSources,
} from '../server/site-source';
import { publicTarget } from '../server/media';

const page = 'https://www.mgnacg.com/bangumi/193-3-17/';
const source = 'https://r2.jzacg.com/example/episode.mp4?Authorization=public-fixture-token';
test('蜜柑公开播放器元数据识别保留原站签发地址，不执行脚本或转发视频', async () => {
  const fixture = metadataFixture(await playerFixture());
  const media = await resolveMgnPage(
    page,
    fixture.fetch.bind(fixture),
    new AbortController().signal,
  );
  assert.equal(media.url, page);
  assert.equal(media.title, '番剧第16话');
  assert.equal(media.source?.video, source);
  assert.equal(media.source?.kind, 'file');
  assert.equal(fixture.requests.length, 3);
  assert.ok(fixture.requests.every(allowedSiteMetadata));
  assert.ok(fixture.requests.every((url) => !url.startsWith('https://r2.jzacg.com')));
  assert.deepEqual(
    assignedJson('player_aaaa={"title":"a } \\" b","x":{"v":1}}; dangerous()', 'player_aaaa'),
    { title: 'a } " b', x: { v: 1 } },
  );
});
test('识别拒绝任意 URL、跨域解析、内网源、坏密文，元数据端口不向任意媒体源开放', async () => {
  for (const raw of [
    'http://www.mgnacg.com/bangumi/193-3-17/',
    'https://www.mgnacg.com.evil.test/bangumi/193-3-17/',
    'https://www.mgnacg.com:8585/bangumi/193-3-17/',
    'https://u:p@www.mgnacg.com/bangumi/193-3-17/',
    'https://www.mgnacg.com/',
  ])
    assert.throws(() => mgnPage(raw));
  for (const raw of [
    'https://play.mknacg.top:8585/admin',
    'https://127.0.0.1/',
    'https://www.mgnacg.com/static/js/../../admin',
    'https://play.mknacg.top:8585/cloudplay/ccxl.php?url=opaque&redirect=other',
  ])
    assert.equal(allowedSiteMetadata(raw), false);
  await assert.rejects(mgnPublicSource(await playerFixture('https://127.0.0.1/private.mp4')));
  await assert.rejects(mgnPublicSource('<meta charset="UTF-8" id="now_0000000000">'));
  await assert.rejects(publicTarget('https://r2.jzacg.com:8585/movie.mp4'));
  for (const url of [
    'https://127.0.0.1:8088/movie.mp4',
    'https://play.xfvod.pro.evil.test:8088/movie.mp4',
    'http://play.xfvod.pro:8088/movie.mp4',
    'https://u:p@play.xfvod.pro:8088/movie.mp4',
  ])
    await assert.rejects(publicTarget(url));
  await assert.rejects(publicTarget('https://play.xfvod.pro:8088/movie.mp4', ['443']));
});
test('页面识别仅供在线成员，鉴权在请求前后生效；响应与并发有边界', async () => {
  const rooms = new Rooms(),
    socket: any = { readyState: 1, send() {}, close() {} };
  const { room, seat } = rooms.create('test', socket);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = metadataFixture(await playerFixture());
  const service = new RoomSources(rooms, async (url) => {
    await gate;
    return fixture.fetch(url);
  });
  const request = (secret = seat.resume, body = JSON.stringify({ url: page })) =>
    new Request(`https://test/resolve-source/${room.code}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'X-Member-Id': seat.id },
      body,
    });
  assert.equal((await service.handle(request('wrong'))).status, 401);
  assert.equal(fixture.requests.length, 0);
  const first = service.handle(request());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal((await service.handle(request())).status, 409);
  rooms.disconnect(room, seat, socket);
  release();
  assert.equal((await first).status, 401);
  assert.equal(room.media, null, 'Resolving metadata must not publish it behind the client');
  rooms.join(room.code + ':' + room.token, 'test', socket, seat.resume);
  const next = new RoomSources(rooms, fixture.fetch.bind(fixture));
  const oversized = await next.handle(request(seat.resume, 'x'.repeat(4097)));
  assert.equal(oversized.ok, false);
  const failing = new RoomSources(rooms, async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:8585');
  });
  const failure = await failing.handle(request());
  assert.equal(failure.status, 422);
  assert.doesNotMatch(await failure.text(), /127\.0\.0\.1|ECONNREFUSED/);
  const unavailable = new RoomSources(rooms, async (url) =>
    url.endsWith('playerconfig.js')
      ? new Response('private upstream details', { status: 520 })
      : fixture.fetch(url),
  );
  const upstreamFailure = await unavailable.handle(request());
  assert.equal(upstreamFailure.status, 422);
  const upstreamMessage = await upstreamFailure.text();
  assert.match(upstreamMessage, /播放器配置.*520/);
  assert.doesNotMatch(upstreamMessage, /private upstream|https:/);
  assert.equal(room.media, null);
  const abort = new AbortController();
  const interrupted = new RoomSources(rooms, fixture.fetch.bind(fixture));
  const hanging = new Request(`https://test/resolve-source/${room.code}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + seat.resume, 'X-Member-Id': seat.id },
    body: new ReadableStream<Uint8Array>(),
    signal: abort.signal,
    duplex: 'half',
  } as RequestInit);
  const pending = interrupted.handle(hanging);
  abort.abort();
  const canceled = await pending;
  assert.equal(canceled.status, 422);
  assert.match(await canceled.text(), /已取消识别/);
  assert.equal(
    (await interrupted.handle(request())).status,
    200,
    'Aborted input must release the room slot',
  );
});
