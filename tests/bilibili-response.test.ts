import test from 'node:test';
import assert from 'node:assert/strict';
import { readBilibiliMetadata } from '../extension/metadata';

const view = 'https://api.bilibili.com/x/web-interface/view?bvid=BV1eYxy6UEMj';
const nav = 'https://api.bilibili.com/x/web-interface/nav';
const play =
  'https://api.bilibili.com/x/player/playurl?bvid=BV1eYxy6UEMj&cid=123&qn=80&fnval=16&platform=html5&high_quality=1';
const signal = () => new AbortController().signal;

test('大合集视频信息超过旧 512 KiB 上限仍可完整读取，UTF-8 跨块不损坏', async () => {
  const value = JSON.stringify({
    code: 0,
    data: { title: '中文标题🌌', ugc_season: '集'.repeat(240000) },
  });
  const bytes = new TextEncoder().encode(value);
  assert.ok(bytes.byteLength > 512 * 1024);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + 4093);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  assert.equal(await readBilibiliMetadata(new Response(stream), view, signal()), value);
});

test('接口独立限额：视频信息允许较大目录，登录和播放响应保持较小上限', async () => {
  const medium = ' '.repeat(65 * 1024);
  assert.equal(
    (await readBilibiliMetadata(new Response(medium), view, signal())).length,
    medium.length,
  );
  await assert.rejects(
    readBilibiliMetadata(new Response(medium), nav, signal()),
    /登录状态.*大小限制/,
  );
  const playback = ' '.repeat(512 * 1024);
  assert.equal(
    (await readBilibiliMetadata(new Response(playback), play, signal())).length,
    playback.length,
  );
  await assert.rejects(
    readBilibiliMetadata(new Response(playback + 'x'), play, signal()),
    /播放信息.*大小限制/,
  );
});

test('实际解压后的流仍受 8 MiB 上限保护，无长度或谎报长度不能无限读取', async () => {
  for (const declared of [undefined, '1']) {
    let cancelled = false,
      reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: declared ? { 'content-length': declared } : {},
    });
    await assert.rejects(readBilibiliMetadata(response, view, signal()), /视频信息.*大小限制/);
    assert.equal(cancelled, true);
    assert.ok(reads <= 34);
    assert.equal(stream.locked, false);
  }
});

test('声明超限会提前停止读取；已经取消及读取途中取消均关闭流', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readBilibiliMetadata(
      new Response(stream, { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }),
      view,
      signal(),
    ),
    /大小限制/,
  );
  assert.equal(cancelled, true);
  for (const preAborted of [false, true]) {
    const controller = new AbortController();
    let didCancel = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        didCancel = true;
      },
    });
    if (preAborted) controller.abort();
    const task = readBilibiliMetadata(new Response(body), view, controller.signal);
    if (!preAborted) controller.abort();
    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(didCancel, true);
    assert.equal(body.locked, false);
  }
});

test('网络读取失败与不允许的接口不能冒充成功响应', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('network'));
      },
    }),
  );
  await assert.rejects(readBilibiliMetadata(response, view, signal()), /network/);
  await assert.rejects(
    readBilibiliMetadata(new Response('{}'), view + '&extra=1', signal()),
    /不在取源范围/,
  );
});
