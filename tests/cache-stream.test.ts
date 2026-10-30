import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';
import { cacheStream } from '../client/cache-stream';

test('缓存虚拟文件只读当前网页的落盘块，严格处理 Range；不访问网络或别的标签页', async () => {
  const handlers: Array<(event: any) => void> = [];
  let clientUrl = 'https://videosreeeen.pages.dev/',
    network = 0;
  const bytes = new Uint8Array(262144).map((_, i) => i % 251);
  vm.runInNewContext(await readFile('client/public/public-video-sw.js', 'utf8'), {
    URL,
    Response,
    ReadableStream,
    ArrayBuffer,
    Uint8Array,
    MessageChannel,
    setTimeout,
    clearTimeout,
    self: {
      location: new URL('https://videosreeeen.pages.dev/public-video-sw.js'),
      addEventListener: (name: string, handler: any) => {
        if (name === 'fetch') handlers.push(handler);
      },
      clients: {
        get: async () => ({
          url: clientUrl,
          postMessage: (message: any, ports: any[]) => {
            assert.equal(message.type, 'vs-disk-read');
            const port = ports[0];
            port.postMessage({ size: bytes.length, block: bytes.length });
            port.on('message', (data: any) => {
              if (data.cancel) {
                port.close();
                return;
              }
              assert.equal(data.offset, 0);
              const copy = bytes.slice().buffer;
              port.postMessage({ bytes: copy }, [copy]);
            });
          },
        }),
      },
    },
    fetch: () => {
      network++;
      throw new Error('Network must not be used');
    },
  });
  const request = async (range?: string, method = 'GET', clientId = 'owner') => {
    let result: Promise<Response> | undefined;
    const event = {
      clientId,
      request: new Request(
        'https://videosreeeen.pages.dev/__vs_disk__/00000000-0000-0000-0000-000000000000/video.mp4',
        { method, ...(range ? { headers: { Range: range } } : {}) },
      ),
      respondWith: (r: Promise<Response>) => {
        assert.equal(result, undefined);
        result = r;
      },
    };
    for (const handler of handlers) handler(event);
    return result!;
  };
  const response = await request('bytes=5-8');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 5-8/262144');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.subarray(5, 9));
  assert.equal((await request('bytes=1-2,5-9')).status, 416);
  assert.equal((await request('bytes=999999-')).status, 416);
  assert.equal((await request(undefined, 'POST')).status, 404);
  assert.equal((await request(undefined, 'GET', '')).status, 404);
  clientUrl = 'https://other.example/';
  assert.equal((await request()).status, 404);
  assert.equal(network, 0);
});

test('已有旧版 Service Worker 切换至新版时重新检查缓存播放能力，不需要再刷新一次', async () => {
  const original = new Map(
    ['window', 'navigator', 'location', 'MessageChannel'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const workers = new EventTarget() as any;
  workers.controller = { postMessage() {} };
  workers.register = async () => ({});
  workers.ready = Promise.resolve();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker: workers },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://videosreeeen.pages.dev/'),
  });
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: MessageChannel,
  });
  const controller = new AbortController();
  try {
    const result = cacheStream(
      '00000000-0000-0000-0000-000000000000',
      [{ name: 'video.mp4', size: 1 }],
      async () => new Uint8Array(1),
      controller.signal,
    );
    setTimeout(() => {
      workers.controller = {
        postMessage(_message: unknown, ports: any[]) {
          ports[0].postMessage({ version: 1 });
          ports[0].close();
        },
      };
      workers.dispatchEvent(new Event('controllerchange'));
    }, 20);
    assert.match((await result)('video.mp4'), /__vs_disk__/);
  } finally {
    controller.abort();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
