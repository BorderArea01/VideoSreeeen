import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';
import { BLOCK_SIZE } from '../shared/cache-plan';
import { partEnd, mp4Bootstrap } from '../shared/cache-parts';

const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
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
const parts = process.env.VS_CACHE_PARTS === '2' ? 2 : 3;
const sequential = !!process.env.VS_CACHE_NO_RANGE_HEADERS;
const bootstrap = await mp4Bootstrap(data.length, async (offset) =>
  data.subarray(offset, offset + BLOCK_SIZE),
);
let hold = true,
  waiting = 0;
const release: (() => void)[] = [];
const source = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (!sequential) response.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'video/mp4');
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  response.setHeader('Content-Length', end - start + 1);
  const send = () =>
    response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
  if (hold && sequential && request.headers.origin && !range && request.method !== 'HEAD') {
    const cut = partEnd(data.length, 1, parts);
    response.write(data.subarray(0, cut));
    waiting++;
    release.push(() => response.end(data.subarray(cut)));
  } else if (
    hold &&
    request.headers.origin &&
    range &&
    start >= partEnd(data.length, 1, parts) &&
    !bootstrap.includes(start)
  ) {
    waiting++;
    release.push(send);
  } else send();
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const url = process.env.VS_PUBLIC_URL
  ? 'https://cache-fixture.videosreeeen.test/flower.mp4'
  : `http://127.0.0.1:${(source.address() as any).port}/flower.mp4`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: any = {
  at: new Date().toISOString(),
  production: !!process.env.VS_PUBLIC_URL,
  mediaFixture: true,
  realPhone: false,
  parts,
  sequential,
};
let diagnostic = async () => ({});
try {
  const ownerContext = await browser.newContext(),
    viewerContext = await browser.newContext();
  await ownerContext.addInitScript(() => {
    (window as any).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-drive-fixture', {
        create: true,
      });
  });
  await viewerContext.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined });
  });
  for (const context of [ownerContext, viewerContext]) {
    if (process.env.VS_PUBLIC_URL)
      await context.route(url, async (route) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
        const start = Number(range?.[1] ?? 0),
          end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
        if (
          hold &&
          range &&
          start >= partEnd(data.length, 1, parts) &&
          !bootstrap.includes(start)
        ) {
          waiting++;
          await new Promise<void>((resolve) => release.push(resolve));
        }
        await route
          .fulfill({
            status: range ? 206 : 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Expose-Headers': 'Content-Range',
              'Content-Type': 'video/mp4',
              'Content-Length': String(end - start + 1),
              ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
            },
            body:
              route.request().method() === 'HEAD' ? Buffer.alloc(0) : data.subarray(start, end + 1),
          })
          .catch(() => {});
      });
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), mediaRelay: false, p2p: false },
      });
    });
    await context.route(origin + '/cache-plan/**', async (route) => {
      const response = await route.fetch();
      if (response.status() !== 200) {
        await route.fulfill({ response });
        return;
      }
      const plan = await response.json();
      for (const file of plan.files) {
        if (file.directUrl) {
          file.url = file.directUrl;
          delete file.directUrl;
        }
      }
      await route.fulfill({ response, json: plan });
    });
  }
  const owner = await ownerContext.newPage(),
    viewer = await viewerContext.newPage();
  const failures: string[] = [];
  for (const page of [owner, viewer]) page.on('pageerror', (e) => failures.push(e.message));
  let latest: any;
  diagnostic = async () => ({
    title: await owner.locator('#cache-title').textContent(),
    description: await owner.locator('#cache-description').textContent(),
    room: latest
      ? {
          cacheReady: latest.cacheReady,
          cacheParts: latest.cacheParts,
          members: latest.members.map((m: any) => ({
            state: m.cache.state,
            progress: m.cache.progress,
            parts: m.cache.parts?.length,
            error: m.cache.error,
          })),
        }
      : null,
  });
  owner.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.room) latest = message.room;
      } catch {}
    }),
  );
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('分段房主');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('分段观众');
  await viewer.locator('#join-button').click();
  await owner.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await selectSource(owner, url);
  await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
  await owner.locator('#cache-parts').selectOption(String(parts));
  await owner.locator('#mode-toggle').click();
  await owner.locator('#cache-button').click();
  await owner.locator('#cache-title').filter({ hasText: '首批已就绪' }).waitFor({ timeout: 25000 });
  assert.equal(latest.cacheReady, false);
  await viewer.locator('#cache-button').click();
  await owner
    .locator('#mode-description')
    .filter({ hasText: '大家都已准备好' })
    .waitFor({ timeout: 25000 });
  assert.ok(latest.members.every((m: any) => m.cache.progress < 1 && m.cache.parts.length === 1));
  proof.earlyReady = latest.members.map((m: any) => ({
    progress: m.cache.progress,
    bytes: m.cache.bytes,
  }));
  await owner.locator('#play-button').click();
  for (const page of [owner, viewer])
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return v.currentTime > 0.25 && v.videoWidth > 0 && !v.paused;
      },
      {},
      { timeout: 12000 },
    );
  assert.ok(waiting >= 2);
  proof.earlyDecode = await Promise.all(
    [owner, viewer].map((page) =>
      page.locator('#video').evaluate((v: HTMLVideoElement) => ({
        width: v.videoWidth,
        height: v.videoHeight,
        position: v.currentTime,
        frames: v.getVideoPlaybackQuality().totalVideoFrames,
        localDisk: v.currentSrc.includes('/__vs_disk__/'),
      })),
    ),
  );
  hold = false;
  for (const done of release.splice(0)) done();
  await owner.waitForFunction(
    () => document.querySelector('#cache-title')?.textContent === '本机已准备好',
    {},
    { timeout: 25000 },
  );
  assert.equal(latest.cacheReady, true);
  assert.ok(
    latest.members.every((m: any) => m.cache.progress === 1 && m.cache.parts.length === parts),
  );
  proof.fullDownload = true;
  await owner.locator('#mode-toggle').click();
  await owner.waitForTimeout(700);
  const entries = await owner.evaluate(async () => {
    const selected = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('chosen-drive-fixture');
    const root = await selected.getDirectoryHandle('videosreeeen-disk');
    const names: string[] = [];
    for await (const name of (root as any).keys()) names.push(name);
    return names;
  });
  assert.deepEqual(entries, []);
  proof.chosenDirectoryCleanup = true;
  await owner.locator('#cache-parts').selectOption('1');
  await owner.locator('#mode-toggle').click();
  await owner.locator('#cache-button').click();
  await viewer.locator('#cache-button').click();
  await owner.locator('#mode-description').filter({ hasText: '大家都已准备好' }).waitFor();
  for (const page of [owner, viewer])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
  assert.ok(
    latest.members.every((m: any) => m.cache.fingerprint === latest.members[0].cache.fingerprint),
  );
  proof.fullModeRegression = true;
  await owner.locator('#mode-toggle').click();
  await owner.reload();
  await owner
    .locator('#cache-location')
    .filter({ hasText: 'chosen-drive-fixture' })
    .waitFor({ state: 'attached' });
  await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
  proof.directoryRemembered = true;
  assert.deepEqual(failures, []);
  await owner.screenshot({ path: '.local/screenshots/cache-parts.png', fullPage: true });
  proof.passed = true;
} catch (cause) {
  proof.diagnostic = await diagnostic();
  console.log(JSON.stringify(proof.diagnostic));
  proof.passed = false;
  proof.error = String(cause);
  throw cause;
} finally {
  hold = false;
  for (const done of release.splice(0)) done();
  for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'ignoreErrors' });
  await mkdir('.local/screenshots', { recursive: true });
  await writeFile(
    `.local/cache-parts-${parts}${sequential ? '-sequential' : ''}${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
  await browser.close();
  source.closeAllConnections();
  source.close();
  app.close();
}
