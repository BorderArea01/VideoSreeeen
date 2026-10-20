import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCacheNetwork, cacheRequest, checkBrowserCacheSize } from '../client/cache-network';

const source = 'https://example.com/movie.mp4?temporary=secret';
const fresh = () => new AbortController();
const fetcher = (run: (init: RequestInit) => Promise<Response>) =>
  (async (_url: unknown, init: RequestInit) => run(init)) as typeof fetch;

test('分块下载独立于先前无 Origin 的播放缓存，严格校验范围和完整字节数', async () => {
  const data = await browserCacheNetwork(
    'fetch',
    source,
    fresh().signal,
    2,
    3,
    fetcher(async (init) => {
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(new Headers(init.headers).get('Range'), 'bytes=2-4');
      return new Response(new Uint8Array([2, 3, 4]), {
        status: 206,
        headers: { 'Content-Range': 'bytes 2-4/5' },
      });
    }),
  );
  assert.deepEqual(data, new Uint8Array([2, 3, 4]));
  for (const [range, body] of [
    ['bytes 0-2/5', 'abc'],
    ['bytes 2-4/4', 'abc'],
    ['bytes 2-4/5', 'ab'],
    ['bytes 2-4/5', 'abcd'],
  ])
    await assert.rejects(
      browserCacheNetwork(
        'fetch',
        source,
        fresh().signal,
        2,
        3,
        fetcher(
          async () => new Response(body, { status: 206, headers: { 'Content-Range': range } }),
        ),
      ),
      /分块/,
    );
});

test('CDN 未公开 Content-Range 时通过 HEAD 识别超限整集，仍不放宽分块校验', async () => {
  const methods: string[] = [];
  const size = 413116624;
  const network = fetcher(async (init) => {
    methods.push(init.method ?? 'GET');
    assert.equal(init.cache, 'no-store');
    return init.method === 'HEAD'
      ? new Response(null, { headers: { 'Content-Length': String(size) } })
      : new Response('x', { status: 206, headers: { 'Content-Length': '1' } });
  });
  assert.deepEqual(await browserCacheNetwork('probe', source, fresh().signal, 0, 1, network), {
    size,
  });
  assert.deepEqual(methods, ['GET', 'HEAD']);
  assert.throws(() => checkBrowserCacheSize([{ size }]), /394\.0 MiB.*单轨 96 MiB、合计 128 MiB/);
  await assert.rejects(
    browserCacheNetwork('fetch', source, fresh().signal, 0, 1, network),
    /未向网页公开分块范围/,
  );
  assert.deepEqual(methods, ['GET', 'HEAD', 'GET']);
  assert.throws(() => checkBrowserCacheSize([{ size: 97 * 1024 ** 2 }]), /超过/);
  assert.throws(
    () => checkBrowserCacheSize([{ size: 70 * 1024 ** 2 }, { size: 60 * 1024 ** 2 }]),
    /超过/,
  );
  checkBrowserCacheSize([{ size: 96 * 1024 ** 2 }, { size: 32 * 1024 ** 2 }]);
});

test('网络与跨域失败保留不确定性，错误不泄漏源 URL；取消不转成下载失败', async () => {
  const network = fetcher(async () => {
    throw new TypeError('Failed to fetch ' + source);
  });
  for (const stage of ['plan', 'source'] as const)
    await assert.rejects(
      cacheRequest(source, fresh().signal, {}, stage, network),
      (error: Error) => {
        assert.match(error.message, stage === 'plan' ? /房间缓存计划/ : /可能.*网络.*跨域/);
        assert.doesNotMatch(error.message, /secret|example|Failed to fetch/);
        return true;
      },
    );
  const controller = fresh();
  controller.abort();
  await assert.rejects(browserCacheNetwork('fetch', source, controller.signal, 0, 1, network), {
    name: 'AbortError',
  });
});

test('服务器忽略 Range、视频过期或 HEAD 无有效总大小不能进入就绪', async () => {
  for (const status of [200, 403, 416])
    await assert.rejects(
      browserCacheNetwork(
        'probe',
        source,
        fresh().signal,
        0,
        1,
        fetcher(async () => new Response('not video', { status })),
      ),
      status === 200 ? /不支持分块/ : new RegExp('HTTP ' + status),
    );
  await assert.rejects(
    browserCacheNetwork(
      'probe',
      source,
      fresh().signal,
      0,
      1,
      fetcher(async (init) =>
        init.method === 'HEAD' ? new Response(null) : new Response('x', { status: 206 }),
      ),
    ),
    /未向网页公开视频大小/,
  );
});
