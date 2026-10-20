import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, devices, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
await mkdir('.local/screenshots', { recursive: true });
let data: Buffer;
try {
  data = await readFile('.local/flower.mp4');
} catch {
  const response = await fetch(
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  );
  assert.ok(response.ok);
  data = Buffer.from(await response.arrayBuffer());
  await writeFile('.local/flower.mp4', data);
}
let downloads = 0;
let holdSource = false,
  held = 0;
if (process.env.VS_TEST_LARGE_CACHE) {
  const size = 100 * 1024 ** 2,
    header = Buffer.alloc(8);
  header.writeUInt32BE(size);
  header.write('free', 4);
  data = Buffer.concat([data, header, Buffer.alloc(size - 8)]);
}
const source = createServer((request, response) => {
  // Deliberately omit Vary: Origin, as observed on the actual CDN. A media
  // element's response cannot be reused by the later CORS cache downloader.
  if (request.headers.origin) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  }
  response.setHeader('Cache-Control', 'max-age=600');
  response.setHeader('Content-Type', 'video/mp4');
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  response.setHeader('Content-Length', end - start + 1);
  if (request.headers.origin && request.method !== 'HEAD') downloads += end - start + 1;
  if (holdSource && request.headers.origin && end - start + 1 === 256 * 1024) {
    held++;
    response.write(data.subarray(start, start + 100));
    return;
  }
  response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl = `http://127.0.0.1:${(source.address() as any).port}/flower.mp4`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: Record<string, any> = {
  origin,
  realAndroidDevice: false,
  videoProxy: false,
  networkProxy: !!process.env.VS_TEST_PROXY,
};
const ready = async (page: Page, timeout = 30000) => {
  await page.waitForFunction(
    () => {
      const title = document.querySelector('#cache-title')!.textContent;
      return (
        title === '本机已准备好' ||
        (title === '本机缓存未完成' &&
          !document.querySelector<HTMLButtonElement>('#cache-button')!.disabled)
      );
    },
    {},
    { timeout },
  );
  assert.equal(
    await page.locator('#cache-title').textContent(),
    '本机已准备好',
    (await page.locator('#cache-description').textContent()) ?? '缓存未完成',
  );
};
try {
  const contexts = [await browser.newContext(), await browser.newContext(devices['Pixel 7'])];
  for (const context of contexts) {
    // Isolate origin-download recovery from P2P; the independent test:p2p
    // verifies member sourcing, corruption rejection and native disk writes.
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: {
          ...(await response.json()),
          mediaRelay: false,
          p2p: !!process.env.VS_CACHE_REAL_AL,
        },
      });
    });
    if (app)
      await context.route(origin + '/cache-plan/**', async (route) => {
        const response = await route.fetch();
        const plan = await response.json();
        for (const file of plan.files) {
          file.url = file.directUrl;
          delete file.directUrl;
        }
        await route.fulfill({ response, json: plan });
      });
  }
  const owner = await contexts[0].newPage(),
    viewer = await contexts[1].newPage();
  let latest: any;
  const failures: string[] = [];
  for (const page of [owner, viewer]) {
    page.on('pageerror', (e) => failures.push(e.message));
    page.on('websocket', (socket) =>
      socket.on('framereceived', (event) => {
        try {
          const message = JSON.parse(String(event.payload));
          if (message.room) latest = message.room;
        } catch {}
      }),
    );
  }
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('缓存下载验证');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('缓存故障恢复');
  await viewer.locator('#join-button').click();
  await owner.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await selectSource(owner, sourceUrl);
  for (const page of [owner, viewer])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
  await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
  await owner.locator('#mode-toggle').click();
  await owner.locator('#cache-button').click();
  await ready(owner);
  const failPlan = async (route: import('playwright').Route) => route.abort('failed');
  await viewer.route(origin + '/cache-plan/**', failPlan);
  await viewer.locator('#cache-button').click();
  await viewer.locator('#cache-title').filter({ hasText: '本机缓存未完成' }).waitFor();
  assert.match((await viewer.locator('#cache-description').textContent()) ?? '', /房间缓存计划/);
  assert.equal(latest.cacheReady, false);
  assert.equal(latest.playback.paused, true);
  assert.equal(await viewer.locator('#cache-stream').isVisible(), true);
  await viewer.unroute(origin + '/cache-plan/**', failPlan);
  await viewer.locator('#cache-button').click();
  await ready(viewer);
  await owner.locator('#mode-description').filter({ hasText: '大家都已准备好' }).waitFor();
  const fileHash = createHash('sha256').update(data).digest('hex');
  const fingerprint = createHash('sha256').update(fileHash).digest('hex');
  assert.ok(latest.members.every((m: any) => m.cache.fingerprint === fingerprint));
  for (const page of [owner, viewer]) {
    const stored = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith('videosreeeen-'));
      let size = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        for (const key of await cache.keys())
          size += (await (await cache.match(key))!.arrayBuffer()).byteLength;
      }
      return { names: names.length, bytes: size };
    });
    if (process.env.VS_TEST_LARGE_CACHE) {
      const sizes = await page.evaluate(async () => {
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('videosreeeen-disk');
        const result: number[] = [];
        for await (const directory of (root as any).values())
          for await (const f of directory.values()) result.push((await f.getFile()).size);
        return result;
      });
      assert.deepEqual(sizes, [data.length]);
      assert.equal(stored.names, 0);
    } else assert.deepEqual(stored, { names: 1, bytes: data.length });
    assert.ok((await page.locator('#video').getAttribute('src'))?.startsWith('blob:'));
  }
  proof.fixture = {
    bytesPerDevice: data.length,
    fingerprint,
    allReady: latest.cacheReady,
    sourceBytes: downloads,
    failedPlanRetry: true,
  };
  await owner.locator('#play-button').click();
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.2,
  );
  for (const page of [owner, viewer])
    await page
      .locator('#mode-description')
      .filter({ hasText: '本机应用缓存已清理' })
      .waitFor({ state: 'attached', timeout: 20000 });
  for (const page of [owner, viewer])
    assert.deepEqual(
      await page.evaluate(async () =>
        (await caches.keys()).filter((k) => k.startsWith('videosreeeen-')),
      ),
      [],
    );
  proof.fixture.endedCleanup = true;
  for (const page of [owner, viewer]) {
    const count = await page.evaluate(async () => {
      try {
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('videosreeeen-disk');
        let n = 0;
        for await (const _ of (root as any).keys()) n++;
        return n;
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError') return 0;
        throw e;
      }
    });
    assert.equal(count, 0);
  }
  if (process.env.VS_TEST_LARGE_CACHE) {
    await owner.locator('#cache-button').click();
    await owner.locator('#cache-button').filter({ hasText: '开始本机缓存' }).waitFor();
    holdSource = true;
    await owner.locator('#cache-button').click();
    for (let i = 0; i < 100 && !held; i++) await owner.waitForTimeout(50);
    assert.ok(held, 'A real block response was held after disk initialization');
    await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
    await owner.locator('#mode-toggle').click();
    await owner.locator('#cache-overlay').waitFor({ state: 'hidden' });
    await owner.waitForFunction(async () => {
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('videosreeeen-disk');
      for await (const _ of (root as any).keys()) return false;
      return true;
    });
    holdSource = false;
    proof.fixture.cancelledDownloadCleanup = true;
  }
  if (process.env.VS_CACHE_REAL_AL) {
    await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
    await owner.locator('#mode-toggle').click();
    await owner.waitForFunction(
      () => document.querySelector('#mode-toggle')!.getAttribute('aria-checked') === 'false',
    );
    await selectSource(owner, 'https://next.xifanacg.com/anime/3434/play/203799?source=AL');
    await owner.waitForFunction(
      () => {
        const video = document.querySelector<HTMLVideoElement>('#video')!;
        return video.readyState >= 2 && video.currentSrc.startsWith('https://play.xfvod.pro');
      },
      {},
      { timeout: 30000 },
    );
    if (latest.mode !== 'cache') await owner.locator('#mode-toggle').click();
    await owner.locator('#cache-button').click();
    const progress = setInterval(
      () =>
        console.log(
          'AL cache: ' +
            latest?.members
              .map((m: any) => `${m.cache.state}:${Math.floor(m.cache.progress * 100)}%`)
              .join(', '),
        ),
      10000,
    );
    try {
      await ready(owner, 600000);
    } finally {
      clearInterval(progress);
    }
    assert.equal(latest.cacheReady, false);
    await viewer.locator('#cache-button').click();
    await ready(viewer, 600000);
    assert.equal(latest.cacheReady, true);
    const fingerprints = latest.members.map((m: any) => m.cache.fingerprint);
    assert.equal(new Set(fingerprints).size, 1);
    proof.al = {
      bytes: latest.members.map((m: any) => m.cache.bytes),
      fingerprint: fingerprints[0],
      allReady: latest.cacheReady,
      viewer: await viewer.locator('#cache-description').textContent(),
    };
    await viewer.screenshot({
      path: '.local/screenshots/cache-disk-mobile.png',
      fullPage: true,
    });
    await owner.screenshot({
      path: '.local/screenshots/cache-disk-desktop.png',
      fullPage: true,
    });
    // Neither cached player may depend on its CDN during play or a real seek.
    for (const page of [owner, viewer])
      await page.route('https://play.xfvod.pro:8088/**', (route) => route.abort());
    await owner.locator('#play-button').click();
    await viewer.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.3,
      {},
      { timeout: 20000 },
    );
    await owner.locator('#seek').fill('60');
    await owner.locator('#seek').dispatchEvent('change');
    for (const page of [owner, viewer])
      await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#video')!;
          return (
            v.currentSrc.startsWith('blob:') &&
            v.videoWidth === 1920 &&
            v.currentTime > 60.2 &&
            !v.seeking
          );
        },
        {},
        { timeout: 20000 },
      );
    proof.al.offlineCdnPlaybackAndSeek = true;
  }
  await owner.locator('#leave-button').click();
  await viewer.locator('#leave-button').click();
  assert.deepEqual(failures, []);
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
  source.closeAllConnections();
  await new Promise<void>((r) => source.close(() => r()));
  if (app) await app.close();
  await writeFile('.local/cache-download-evidence.json', JSON.stringify(proof, null, 2));
}
