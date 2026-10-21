import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('公开视频连接只转发指定 CDN 的视频请求，保留 Range 和 opaque 响应，不存储媒体', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const calls: any[] = [];
  const opaque = { type: 'opaque', status: 0 };
  vm.runInNewContext(await readFile('client/public/public-video-sw.js', 'utf8'), {
    URL,
    self: { addEventListener: (name: string, handler: any) => handlers.set(name, handler) },
    fetch: async (request: any, options: any) => {
      calls.push({ request, options });
      return opaque;
    },
  });
  const request = {
    url: 'https://apn.moedot.net/test/04.mp4?issued=original',
    method: 'GET',
    destination: 'video',
    mode: 'no-cors',
    headers: { Range: 'bytes=1234567-' },
  };
  let response: Promise<unknown> | undefined;
  const forward = (request: any) =>
    handlers.get('fetch')!({
      request,
      respondWith: (value: Promise<unknown>) => {
        response = value;
      },
    });
  forward(request);
  assert.equal(await response, opaque);
  assert.equal(calls[0].request, request);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(Object.keys(calls[0].options).length, 2);
  for (const override of [
    { url: 'https://apn.moedot.net.evil.test/test.mp4' },
    { url: 'http://apn.moedot.net/test.mp4' },
    { url: 'https://apn.moedot.net:8088/test.mp4' },
    { url: 'https://play.xfvod.pro/test.mp4' },
    { url: 'https://videosreeeen.pages.dev/ws' },
    { destination: 'image' },
    { destination: '' },
    { mode: 'cors' },
    { method: 'POST' },
  ]) {
    response = undefined;
    forward({ ...request, ...override });
    assert.equal(response, undefined);
  }
  assert.equal(calls.length, 1);
});
