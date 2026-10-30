import assert from 'node:assert/strict';
import test from 'node:test';
import { nextStartReady, waitForFirstVideoFrame } from '../client/playback-startup';
import { Rooms } from '../server/rooms';
import { randomUUID } from 'node:crypto';

test('只有实际视频帧回调放行；metadata/loadeddata 不冒充首帧，取消后的迟到帧无效', async () => {
  let callback!: () => void,
    cancelled = 0;
  const video = Object.assign(new EventTarget(), {
    readyState: 0,
    seeking: false,
    videoWidth: 0,
    error: null,
    requestVideoFrameCallback: (fn: () => void) => {
      callback = fn;
      return 1;
    },
    cancelVideoFrameCallback: () => {
      cancelled++;
    },
  });
  const controller = new AbortController();
  let ready = false;
  const waiting = waitForFirstVideoFrame(video as any, controller.signal).then(() => {
    ready = true;
  });
  Object.assign(video, { readyState: 2, videoWidth: 640 });
  video.dispatchEvent(new Event('loadeddata'));
  await Promise.resolve();
  assert.equal(ready, false);
  callback();
  await waiting;
  assert.equal(ready, true);
  const cancelledController = new AbortController();
  const old = waitForFirstVideoFrame(video as any, cancelledController.signal);
  const late = callback;
  cancelledController.abort();
  await assert.rejects(old, { name: 'AbortError' });
  late();
  assert.ok(cancelled > 0);
  const fallback = Object.assign(new EventTarget(), {
    readyState: 2,
    seeking: false,
    videoWidth: 640,
    error: null,
  });
  await waitForFirstVideoFrame(fallback as any, new AbortController().signal);
});

test('下一集首次起播有等待上限，离线和旧客户端不无限阻塞', () => {
  assert.equal(
    nextStartReady(
      [
        { online: true, playbackReady: true },
        { online: true, playbackReady: false },
      ],
      1200,
    ),
    false,
  );
  assert.equal(
    nextStartReady(
      [
        { online: true, playbackReady: true },
        { online: true, playbackReady: false },
      ],
      8000,
    ),
    true,
  );
  assert.equal(
    nextStartReady(
      [
        { online: true, playbackReady: true },
        { online: false, playbackReady: false },
        { online: true },
      ],
      0,
    ),
    true,
  );
});

test('首帧确认与 RTT/播放版本分离，旧媒体/旧缓存代次无效，普通缓冲不暂停全房', () => {
  const socket = () => ({ readyState: 1, send() {}, close() {} }),
    rooms = new Rooms(),
    { room, seat } = rooms.create('A', socket());
  seat.playbackReadyEvents = true;
  const act = (m: any) => rooms.act(room, seat, { op: randomUUID(), base: room.revision, ...m });
  const media = () =>
    act({
      type: 'media',
      media: {
        provider: 'direct',
        title: 'fixture',
        url: 'https://example.com/a.mp4',
        source: { kind: 'file', video: 'https://example.com/a.mp4' },
      },
    });
  media();
  const oldId = room.media!.id,
    oldEpoch = room.epoch;
  const ready = (id = room.media!.id, epoch = room.epoch, value = true) =>
    rooms.act(room, seat, { type: 'media-ready', mediaId: id, epoch, ready: value });
  const before = { ...room.playback };
  ready();
  assert.equal(rooms.snapshot(room).members[0]!.playbackReady, true);
  assert.deepEqual(room.playback, before);
  assert.equal(seat.rtt, null);
  act({ type: 'control', action: 'play' });
  ready(undefined, undefined, false);
  assert.equal(room.playback.paused, false);
  media();
  ready(oldId, oldEpoch);
  assert.equal(rooms.snapshot(room).members[0]!.playbackReady, false);
  ready();
  act({ type: 'mode', mode: 'cache' });
  ready(room.media!.id, oldEpoch);
  assert.equal(rooms.snapshot(room).members[0]!.playbackReady, false);
});
