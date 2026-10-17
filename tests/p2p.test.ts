import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { Rooms, type RoomSocket } from '../server/rooms';
import { clientMessageSchema } from '../shared/protocol';
const require = createRequire(import.meta.url);
const { DiskCache } = require('../desktop/cache.cjs'),
  { BlockCache } = require('../desktop/blocks.cjs');
class Socket implements RoomSocket {
  readyState = 1;
  messages: any[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
}
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
test('分块落盘：乱序、完整性门槛、Range 播放和取消后的隔离', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vs-blocks-')),
    cache = new DiskCache(root, () => {}),
    blocks = new BlockCache(cache),
    jobId = randomUUID();
  await cache.init();
  try {
    const a = Buffer.alloc(256 * 1024, 17),
      b = Buffer.from('last block'),
      bytes = Buffer.concat([a, b]);
    await blocks.call({
      action: 'init',
      jobId,
      entry: 'video.mp4',
      files: [{ name: 'video.mp4', size: bytes.length }],
    });
    await assert.rejects(() => blocks.call({ action: 'get', jobId, name: 'video.mp4', offset: 0 }));
    await blocks.call({
      action: 'put',
      jobId,
      name: 'video.mp4',
      offset: a.length,
      data: b.toString('base64'),
    });
    await assert.rejects(() => blocks.call({ action: 'finish', jobId }), /尚未完整/);
    assert.equal((await cache.response(new Request(`vs-cache://${jobId}/video.mp4`))).status, 404);
    await blocks.call({
      action: 'put',
      jobId,
      name: 'video.mp4',
      offset: 0,
      data: a.toString('base64'),
    });
    const ready = await blocks.call({ action: 'finish', jobId });
    assert.equal(ready.fingerprint, hash(hash(bytes)));
    const range = await cache.response(
      new Request(ready.entry, { headers: { Range: `bytes=${a.length}-` } }),
    );
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), b);
    await assert.rejects(() =>
      blocks.call({ action: 'get', jobId, name: '../private', offset: 0 }),
    );
    blocks.cancel(jobId);
    await cache.clear(jobId);
    await assert.rejects(
      () =>
        blocks.call({
          action: 'put',
          jobId,
          name: 'video.mp4',
          offset: 0,
          data: a.toString('base64'),
        }),
      /已取消/,
    );
  } finally {
    await cache.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test('P2P 信令仅发送给同房间目标，换片后拒绝旧信令', () => {
  const rooms = new Rooms(),
    a = new Socket(),
    b = new Socket(),
    c = new Socket();
  const { room, seat: first } = rooms.create('a', a),
    { seat: second } = rooms.join(`${room.code}:${room.token}`, 'b', b);
  rooms.create('c', c);
  rooms.act(room, first, {
    type: 'media',
    op: 'm',
    base: 0,
    media: {
      url: 'https://example.com/video.mp4',
      title: 'test',
      provider: 'direct',
      source: { kind: 'file', video: 'https://example.com/video.mp4' },
    },
  });
  rooms.act(room, first, { type: 'mode', op: 'cache', base: room.revision, mode: 'cache' });
  const signal = {
    type: 'signal' as const,
    to: second.id,
    mediaId: room.media!.id,
    epoch: room.epoch,
    data: { kind: 'description' as const, type: 'offer' as const, sdp: 'test' },
  };
  a.messages = [];
  b.messages = [];
  c.messages = [];
  rooms.act(room, first, signal);
  assert.equal(a.messages.length, 0);
  assert.equal(c.messages.length, 0);
  assert.equal(b.messages[0].from, first.id);
  assert.equal(JSON.stringify(rooms.dump(room)).includes('sdp'), false);
  rooms.act(room, first, { type: 'mode', op: 'stream', base: room.revision, mode: 'stream' });
  assert.throws(() => rooms.act(room, first, signal), /缓存连接已失效/);
  assert.equal(
    clientMessageSchema.safeParse({ ...signal, data: { ...signal.data, sdp: 'a'.repeat(32001) } })
      .success,
    false,
  );
});
test('房间恢复保留裁决与缓存门槛；缺少连接的成员不能继续假装已就绪', () => {
  const rooms = new Rooms(),
    a = new Socket(),
    b = new Socket();
  const { room, seat: first } = rooms.create('a', a),
    { seat: second } = rooms.join(`${room.code}:${room.token}`, 'b', b);
  rooms.act(room, first, {
    type: 'media',
    base: 0,
    op: 'm',
    media: {
      url: 'https://example.com/a.mp4',
      title: 'test',
      provider: 'direct',
      source: { kind: 'file', video: 'https://example.com/a.mp4' },
    },
  });
  rooms.act(room, first, { type: 'mode', base: room.revision, op: 'cache', mode: 'cache' });
  for (const s of [first, second])
    rooms.act(room, s, {
      type: 'cache',
      mediaId: room.media!.id,
      epoch: room.epoch,
      state: 'ready',
      progress: 1,
      bytes: 1,
      fingerprint: 'a'.repeat(64),
    });
  rooms.act(room, first, { type: 'control', base: room.revision, op: 'play', action: 'play' });
  const saved = rooms.dump(room),
    restored = new Rooms().restore(
      saved,
      new Map([
        [first.id, a],
        [second.id, b],
      ]),
    );
  assert.equal(restored.playback.paused, false);
  assert.equal(new Rooms().cacheReady(restored), true);
  const missing = new Rooms().restore(saved, new Map([[first.id, a]]));
  assert.equal(missing.playback.paused, true);
  assert.equal(new Rooms().cacheReady(missing), false);
});
