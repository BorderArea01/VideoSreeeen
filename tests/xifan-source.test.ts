import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveXifanPage } from '../client/site-source';
import { describeUrl } from '../shared/sites';

const page = 'https://next.xifanacg.com/anime/151/play/1986?source=xfy2';
const issued = 'https://play.xfvod.pro:8088/example/15.mp4?issued=original';
const result = () => ({
  ok: true,
  anime_id: 151,
  episode_id: 1986,
  expires_at: Date.now() / 1000 + 60,
  candidates: [{ source_id: 5, source_code: 'xfy2', url: issued }],
});
const signal = () => new AbortController().signal;

test('稀饭 AL 按原站线路 1 请求，不改成旧番线路，也不接受串线结果', async () => {
  const al = 'https://next.xifanacg.com/anime/3434/play/203799?source=AL';
  const payload = {
    ...result(),
    anime_id: 3434,
    episode_id: 203799,
    candidates: [{ source_id: 1, source_code: 'AL', url: issued }],
  };
  const media = await resolveXifanPage(describeUrl(al), signal(), (async (_url, init) => {
    assert.deepEqual(JSON.parse(init!.body as string), {
      action: 'fallback',
      episode_id: 203799,
      source_id: 1,
    });
    assert.equal(init?.credentials, 'omit');
    return Response.json(payload);
  }) as typeof fetch);
  assert.equal(media.url, al);
  assert.equal(media.source?.video, issued);
  for (const candidates of [
    result().candidates,
    [{ source_id: 1, source_code: 'xfy2', url: issued }],
    [null],
  ])
    await assert.rejects(
      resolveXifanPage(describeUrl(al), signal(), (async () =>
        Response.json({ ...payload, candidates })) as typeof fetch),
    );
  for (const url of [
    al.replace('source=AL', 'source=al'),
    al + '&source=xfy2',
    al.replace('source=AL', 'source=__proto__'),
  ])
    await assert.rejects(
      resolveXifanPage(describeUrl(url), signal(), (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch),
      /暂未适配/,
    );
});

test('稀饭匿名公共播放接口：不附带房间凭据，保留原站签发地址和端口', async () => {
  let calls = 0;
  const media = await resolveXifanPage(describeUrl(page), signal(), (async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.xifanacg.com/functions/v1/issue-web-playback');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.equal(new Headers(init?.headers).has('X-Member-Id'), false);
    assert.deepEqual(JSON.parse(init!.body as string), {
      action: 'fallback',
      episode_id: 1986,
      source_id: 5,
    });
    return Response.json(result());
  }) as typeof fetch);
  assert.equal(calls, 1);
  assert.equal(media.url, page);
  assert.equal(media.provider, 'xifan');
  assert.equal(media.source?.video, issued);
});

test('稀饭拒绝错误剧集、线路、过期和任意媒体域名，不发布不匹配结果', async () => {
  const invalid = [
    { ...result(), anime_id: 999 },
    { ...result(), episode_id: 999 },
    { ...result(), expires_at: 1 },
    { ...result(), candidates: [{ source_id: 6, source_code: 'xfy2', url: issued }] },
    ...[
      'http://play.xfvod.pro/a.mp4',
      'https://play.xfvod.pro.evil.test/a.mp4',
      'https://u:p@play.xfvod.pro/a.mp4',
      'https://127.0.0.1/a.mp4',
      'https://play.xfvod.pro:8080/a.mp4',
      'https://play.xfvod.pro/a.html',
    ].map((url) => ({
      ...result(),
      candidates: [{ source_id: 5, source_code: 'xfy2', url }],
    })),
  ];
  for (const payload of invalid)
    await assert.rejects(
      resolveXifanPage(describeUrl(page), signal(), (async () =>
        Response.json(payload)) as typeof fetch),
    );
  for (const url of [
    page.replace('xfy2', 'other'),
    page.replace('https:', 'http:'),
    page.replace('/1986', '/invalid'),
  ])
    await assert.rejects(
      resolveXifanPage({ url, title: 'test', provider: 'xifan' }, signal(), (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch),
    );
});

test('稀饭遵守拒绝、频率及大小边界，不转发原始错误内容或自动重试', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      resolveXifanPage(describeUrl(page), signal(), (async () => {
        calls++;
        return new Response('private server body', { status });
      }) as typeof fetch),
      (error) => error instanceof Error && !error.message.includes('private server body'),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    resolveXifanPage(
      describeUrl(page),
      signal(),
      (async () => new Response('x'.repeat(65537))) as typeof fetch,
    ),
    /大小限制/,
  );
  const abort = new AbortController();
  const pending = resolveXifanPage(
    describeUrl(page),
    abort.signal,
    (async () => new Response(new ReadableStream())) as typeof fetch,
  );
  abort.abort();
  await assert.rejects(pending);
});
