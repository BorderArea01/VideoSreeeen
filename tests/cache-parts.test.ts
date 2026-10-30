import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BLOCK_SIZE } from '../shared/cache-plan';
import { mp4Bootstrap, partEnd, partOffsets } from '../shared/cache-parts';
import { Rooms } from '../server/rooms';
const require = createRequire(import.meta.url);
const { DiskCache } = require('../desktop/cache.cjs');
const { BlockCache } = require('../desktop/blocks.cjs');
const { cacheRoot, saveCacheRoot } = require('../desktop/cache-location.cjs');

test('分批覆盖所有字节不重叠；尾部 moov 初始化单独获取，不下载中间 mdat', async () => {
  for (const size of [1, BLOCK_SIZE - 1, BLOCK_SIZE * 11 + 10])
    for (const count of [2, 3] as const) {
      const offsets = Array.from({ length: count }, (_, i) =>
        partOffsets(size, i + 1, count),
      ).flat();
      assert.equal(new Set(offsets).size, Math.ceil(size / BLOCK_SIZE));
      assert.equal(partEnd(size, count, count), size);
    }
  const size = BLOCK_SIZE * 12,
    file = Buffer.alloc(size);
  file.writeUInt32BE(16);
  file.write('ftyp', 4);
  file.writeUInt32BE(size - BLOCK_SIZE - 16, 16);
  file.write('mdat', 20);
  file.writeUInt32BE(BLOCK_SIZE, size - BLOCK_SIZE);
  file.write('moov', size - BLOCK_SIZE + 4);
  const reads: number[] = [];
  const blocks = await mp4Bootstrap(size, async (offset) => {
    reads.push(offset);
    return file.subarray(offset, offset + BLOCK_SIZE);
  });
  assert.deepEqual(blocks, [0, size - BLOCK_SIZE]);
  assert.ok(reads.every((offset) => offset === 0 || offset === size - BLOCK_SIZE));
  await assert.rejects(
    mp4Bootstrap(8, async () => new Uint8Array(8)),
    /不支持/,
  );
});

test('分段门槛核对全员已落盘内容；后续不一致、断线、新成员和换代关闭门槛', () => {
  const socket = () => ({ readyState: 1, send() {}, close() {} });
  const rooms = new Rooms(),
    { room, seat: first } = rooms.create('A', socket());
  const { seat: second } = rooms.join(`${room.code}:${room.token}`, 'B', socket());
  first.cachePartsSupported = second.cachePartsSupported = true;
  const act = (message: any, seat = first) =>
    rooms.act(room, seat, { base: room.revision, op: randomUUID(), ...message });
  act({
    type: 'media',
    media: {
      provider: 'direct',
      title: 'fixture',
      url: 'https://example.com/a.mp4',
      source: { kind: 'file', video: 'https://example.com/a.mp4' },
    },
  });
  act({ type: 'mode', mode: 'cache', cacheParts: 3 });
  const status = (seat: typeof first, parts: string[], progress = parts.length / 3) =>
    act(
      {
        type: 'cache',
        mediaId: room.media!.id,
        epoch: room.epoch,
        state: 'downloading',
        progress,
        bytes: 999,
        parts,
      },
      seat,
    );
  status(first, ['a'.repeat(64)]);
  assert.equal(rooms.cacheReady(room), false);
  status(second, ['a'.repeat(64)]);
  assert.equal(rooms.cacheReady(room), true);
  act({ type: 'control', action: 'play' });
  assert.equal(room.playback.paused, false);
  status(first, ['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(rooms.cacheReady(room), true);
  status(second, ['a'.repeat(64), 'c'.repeat(64)]);
  assert.equal(rooms.cacheReady(room), false);
  assert.equal(room.playback.paused, true);
  assert.throws(() => status(first, ['a'.repeat(64)], 0.1), /校验|进度/);
  act({ type: 'mode', mode: 'cache', cacheParts: 2 });
  assert.equal(rooms.cacheReady(room), false);
  status(first, ['a'.repeat(64)], 0.5);
  status(second, ['a'.repeat(64)], 0.5);
  assert.equal(rooms.cacheReady(room), true);
  rooms.disconnect(room, second, second.socket!);
  assert.equal(rooms.cacheReady(room), false);
  rooms.join(`${room.code}:${room.token}`, 'C', socket());
  assert.throws(() => act({ type: 'mode', mode: 'cache', cacheParts: 3 }), /刷新|更新/);
});

test('Windows 缓存默认选择可用 D 盘，记住其他目录；仅清理应用作业，不碰旁边文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vs-location-'));
  try {
    const config = join(root, 'config'),
      drive = join(root, 'D'),
      other = join(root, 'other');
    await mkdir(config);
    await mkdir(drive);
    await mkdir(other);
    assert.ok((await cacheRoot(config, { drive })).startsWith(join(drive, 'VideoSreeeen-cache')));
    await writeFile(join(other, 'user-video.mp4'), 'user data');
    const selected = await saveCacheRoot(config, other);
    assert.equal(await cacheRoot(config, { drive }), selected);
    const cache = new DiskCache(selected, () => {});
    await cache.init();
    await cache.stop();
    assert.equal(await readFile(join(other, 'user-video.mp4'), 'utf8'), 'user data');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows 分段播放只读取已写入块：后续读取等待落盘，取消不返回稀疏零字节', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vs-partial-'));
  const cache = new DiskCache(root, () => {}),
    blocks = new BlockCache(cache),
    jobId = randomUUID();
  try {
    await cache.init();
    await blocks.call({
      action: 'init',
      jobId,
      entry: 'video.mp4',
      progressive: true,
      files: [{ name: 'video.mp4', size: 2 * BLOCK_SIZE }],
    });
    await blocks.call({
      action: 'put',
      jobId,
      name: 'video.mp4',
      offset: 0,
      data: Buffer.alloc(BLOCK_SIZE, 7).toString('base64'),
    });
    const response = await cache.response(
      new Request(`vs-cache://${jobId}/video.mp4`, {
        headers: { Range: `bytes=${BLOCK_SIZE - 1}-${BLOCK_SIZE + 1}` },
      }),
    );
    const bytes = response.arrayBuffer();
    await blocks.call({
      action: 'put',
      jobId,
      name: 'video.mp4',
      offset: BLOCK_SIZE,
      data: Buffer.alloc(BLOCK_SIZE, 8).toString('base64'),
    });
    assert.deepEqual(new Uint8Array(await bytes), new Uint8Array([7, 8, 8]));
    assert.equal(
      (
        await cache.response(
          new Request(`vs-cache://${jobId}/video.mp4`, { headers: { Range: 'bytes=99999999-' } }),
        )
      ).status,
      416,
    );
    blocks.cancel(jobId);
    await cache.clear(jobId);
    assert.equal((await cache.response(new Request(`vs-cache://${jobId}/video.mp4`))).status, 404);
  } finally {
    await cache.stop();
    await rm(root, { recursive: true, force: true });
  }
});
