import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const { DiskCache } = createRequire(import.meta.url)('../desktop/cache.cjs');
test('磁盘缓存：完整落盘后才就绪，指纹可跨平台核对，Range 播放，退出清理', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videosreeeen-test-'));
  const bytes = Buffer.from('a complete video fixture');
  let resolve!: (event: any) => void;
  const done = new Promise<any>((r) => {
    resolve = r;
  });
  const cache = new DiskCache(
    root,
    (event: any) => {
      if (event.state !== 'downloading') resolve(event);
    },
    async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
  );
  try {
    await cache.init();
    const jobId = randomUUID();
    await cache.start({
      jobId,
      plan: {
        kind: 'file',
        entry: 'video.mp4',
        files: [{ name: 'video.mp4', url: 'https://example.com/video.mp4' }],
      },
    });
    const ready = await done;
    assert.equal(ready.state, 'ready');
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(ready.fingerprint, createHash('sha256').update(fileHash).digest('hex'));
    assert.deepEqual(await readFile(join(root, jobId, 'video.mp4')), bytes);
    const response = await cache.response(
      new Request(`vs-cache://${jobId}/video.mp4`, { headers: { range: 'bytes=2-8' } }),
    );
    assert.equal(response.status, 206);
    assert.equal(await response.text(), bytes.subarray(2, 9).toString());
    await cache.clear(jobId);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await cache.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test('磁盘缓存：下载中断不能留下 ready 标记；路径逃逸被拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videosreeeen-test-'));
  let resolve!: (event: any) => void;
  const done = new Promise<any>((r) => {
    resolve = r;
  });
  const cache = new DiskCache(
    root,
    (event: any) => {
      if (event.state === 'error') resolve(event);
    },
    async () => new Response('short', { headers: { 'content-length': '100' } }),
  );
  try {
    await cache.init();
    const jobId = randomUUID();
    await assert.rejects(
      cache.start({
        jobId,
        plan: {
          entry: 'video.mp4',
          files: [{ name: '../other-app.mp4', url: 'https://example.com/a' }],
        },
      }),
    );
    await cache.start({
      jobId,
      plan: { entry: 'video.mp4', files: [{ name: 'video.mp4', url: 'https://example.com/a' }] },
    });
    const event = await done;
    assert.equal(event.state, 'error');
    assert.deepEqual(await readdir(root), []);
  } finally {
    await cache.stop();
    await rm(root, { recursive: true, force: true });
  }
});
