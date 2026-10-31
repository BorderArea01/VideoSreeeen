import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';
import { BLOCK_SIZE } from '../shared/cache-plan';
import { partEnd, mp4Bootstrap, partOffsets } from '../shared/cache-parts';
import { createHash } from 'node:crypto';

const eviction = process.argv.includes('--eviction');

const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
let data: Buffer;
try {
  data = await readFile(eviction ? '.local/cache-window-fixture.mp4' : '.local/flower.mp4');
} catch {
  if (eviction) throw new Error('Run scripts/cache-window-fixture.mjs first');
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
let holdTail = eviction;
let interruptWhole = false;
const releaseTail: (() => void)[] = [];
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
  if (interruptWhole && request.headers.origin && !range && request.method === 'GET') {
    response.write(data.subarray(0, BLOCK_SIZE));
    setTimeout(() => response.destroy(), 150);
    return;
  }
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
    release.push(() => {
      if (holdTail && start >= partEnd(data.length, 2, parts)) releaseTail.push(send);
      else send();
    });
  } else if (
    holdTail &&
    request.headers.origin &&
    range &&
    start >= partEnd(data.length, 2, parts) &&
    !bootstrap.includes(start)
  ) {
    releaseTail.push(send);
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
  eviction,
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
    await context.addInitScript(String.raw`
      try { localStorage.setItem('videosreeeen.appearance', 'classic'); } catch {}
      window.__welcomes = 0;
      window.WebSocket = new Proxy(WebSocket, {construct(target, args) {
        const socket = Reflect.construct(target, args);
        if (new URL(args[0], location.href).pathname === '/ws') {
          window.__roomSocket = socket;
          socket.addEventListener('message', event => {
            try { if (JSON.parse(event.data).type === 'welcome') window.__welcomes++; } catch {}
          });
        }
        return socket;
      }});
    `);
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
        if (
          holdTail &&
          range &&
          start >= partEnd(data.length, 2, parts) &&
          !bootstrap.includes(start)
        )
          await new Promise<void>((resolve) => releaseTail.push(resolve));
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
  const reconnect = async (page: typeof owner) => {
    const count = await page.evaluate(() => {
      const previous = (window as any).__welcomes;
      (window as any).__roomSocket.close();
      return previous;
    });
    await page.waitForFunction((n) => (window as any).__welcomes > n, count);
  };
  const diskJobs = () =>
    owner.evaluate(async () => {
      const root = await (
        await (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-drive-fixture')
      ).getDirectoryHandle('videosreeeen-disk');
      const names = [];
      for await (const name of (root as any).keys()) names.push(name);
      return names.sort();
    });
  const failures: string[] = [];
  for (const page of [owner, viewer]) page.on('pageerror', (e) => failures.push(e.message));
  let latest: any;
  const controls: any[] = [];
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
            window: m.cache.window,
            released: m.cache.released,
          })),
        }
      : null,
  });
  owner.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.type === 'control') controls.push(message);
      } catch {}
    });
    socket.on('framereceived', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.room) latest = message.room;
      } catch {}
    });
  });
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
  const jobsBeforeReconnect = await diskJobs();
  const memberIds = latest.members.map((m: any) => m.id).sort();
  await reconnect(owner);
  await owner.waitForFunction(() =>
    /首批已就绪/.test(document.querySelector('#cache-title')!.textContent!),
  );
  await reconnect(viewer);
  await owner.waitForFunction(() =>
    document.querySelector('#mode-description')!.textContent!.includes('大家都已准备好'),
  );
  assert.deepEqual(await diskJobs(), jobsBeforeReconnect);
  assert.deepEqual(latest.members.map((m: any) => m.id).sort(), memberIds);
  assert.ok(latest.members.every((m: any) => m.cache.parts.length === 1 && m.cache.bytes > 0));
  proof.partialReconnectKeepsDiskAndHashes = true;
  if (await owner.locator('#video').evaluate((v: HTMLVideoElement) => v.paused))
    await owner.locator('#play-button').click();
  if (eviction) {
    const lockedOffset = partOffsets(data.length, 1, parts).find(
      (offset) => !bootstrap.includes(offset),
    );
    assert.notEqual(lockedOffset, undefined);
    proof.realFileLock = await owner.evaluate(async (offset) => {
      const selected = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('chosen-drive-fixture');
      const root = await selected.getDirectoryHandle('videosreeeen-disk');
      let directory!: FileSystemDirectoryHandle;
      for await (const d of (root as any).values())
        if (d.kind === 'directory') {
          directory = d;
          break;
        }
      const name = 'video.mp4.' + offset + '.part';
      const script = `let access; self.onmessage = async ({data}) => {
        if(data.release){access.close();self.postMessage('released');return;}
        let root=await navigator.storage.getDirectory();
        for(const part of data.path) root=await root.getDirectoryHandle(part);
        access=await (await root.getFileHandle(data.name)).createSyncAccessHandle();
        self.postMessage('locked');
      };`;
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      const worker = new Worker(url);
      (window as any).__cacheLock = worker;
      (window as any).__cacheLockURL = url;
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = () => resolve();
        worker.onerror = reject;
        worker.postMessage({
          path: ['chosen-drive-fixture', 'videosreeeen-disk', directory.name],
          name,
        });
      });
      try {
        await directory.removeEntry(name);
        throw new Error('Lock did not block deletion');
      } catch (error) {
        if (error instanceof DOMException) return { name: error.name, message: error.message };
        throw error;
      }
    }, lockedOffset!);
    assert.equal(proof.realFileLock.name, 'NoModificationAllowedError');
  }
  hold = false;
  for (const done of release.splice(0)) done();
  if (eviction) {
    await owner.waitForFunction(
      () =>
        parseFloat(
          document.querySelector<HTMLElement>('#seek')!.style.getPropertyValue('--cache-start'),
        ) > 0,
      {},
      { timeout: 20000 },
    );
    assert.ok(latest.cacheSliding);
    assert.ok(latest.cacheWindow.start > 0);
    for (let n = 0; n < 80 && !latest.members.every((m: any) => m.cache.released > 0); n++)
      await owner.waitForTimeout(100);
    assert.ok(
      latest.members.every(
        (m: any) => m.cache.released > 0 && m.cache.parts.length === 2 && m.cache.progress < 1,
      ),
    );
    proof.evictedBeforeFinalDownload = latest.members.map((m: any) => ({
      bytes: m.cache.bytes,
      retainedBytes: m.cache.retainedBytes,
      window: m.cache.window,
      released: m.cache.released,
    }));
    assert.ok(latest.members.every((m: any) => m.cache.state !== 'error'));
    await owner.evaluate(async () => {
      const worker = (window as any).__cacheLock as Worker;
      await new Promise<void>((resolve) => {
        worker.onmessage = () => resolve();
        worker.postMessage({ release: true });
      });
      worker.terminate();
      URL.revokeObjectURL((window as any).__cacheLockURL);
      delete (window as any).__cacheLock;
    });
    await owner.waitForTimeout(2000);
    proof.lockedDeletionDidNotInvalidateCache = true;
    const disk = await owner.evaluate(async () => {
      const root = await (
        await (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-drive-fixture')
      ).getDirectoryHandle('videosreeeen-disk');
      let bytes = 0,
        files = 0;
      for await (const dir of (root as any).values())
        if (dir.kind === 'directory')
          for await (const file of dir.values())
            if (file.kind === 'file') {
              bytes += (await file.getFile()).size;
              files++;
            }
      return { bytes, files };
    });
    assert.ok(disk.bytes > 0 && disk.bytes < latest.members[0].cache.bytes);
    proof.physicalDisk = disk;
    const before = controls.length;
    await owner.locator('#seek').evaluate((e: HTMLInputElement) => {
      e.value = '0';
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await owner.waitForTimeout(150);
    assert.equal(controls.length, before);
    assert.ok(await owner.locator('#video').evaluate((v: HTMLVideoElement) => v.currentTime > 2));
    proof.unavailableSeekBlocked = true;
    const valid = latest.cacheWindow.start + 0.5;
    await owner.locator('#seek').evaluate((e: HTMLInputElement, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }, valid);
    for (let n = 0; n < 50 && controls.length === before; n++) await owner.waitForTimeout(50);
    assert.equal(controls.length, before + 1);
    proof.retainedSeekAccepted = true;
    await owner.screenshot({ path: '.local/screenshots/cache-window.png', fullPage: true });
    holdTail = false;
    for (const done of releaseTail.splice(0)) done();
  }
  await owner.waitForFunction(
    () => document.querySelector('#cache-title')?.textContent === '本机已准备好',
    {},
    { timeout: 25000 },
  );
  assert.equal(latest.cacheReady, true);
  for (let n = 0; n < 100 && !latest.members.every((m: any) => m.cache.state === 'ready'); n++)
    await owner.waitForTimeout(50);
  assert.ok(
    latest.members.every((m: any) => m.cache.progress === 1 && m.cache.parts.length === parts),
  );
  proof.fullDownload = true;
  if (eviction) {
    const inner = createHash('sha256').update(data).digest('hex');
    const expected = createHash('sha256').update(inner).digest('hex');
    assert.ok(latest.members.every((m: any) => m.cache.fingerprint === expected));
    proof.wholeFingerprintAfterEviction = true;
    await owner
      .locator('#cache-title')
      .filter({ hasText: '缓存已清理' })
      .waitFor({ state: 'attached', timeout: 25000 });
    await viewer
      .locator('#cache-title')
      .filter({ hasText: '缓存已清理' })
      .waitFor({ state: 'attached', timeout: 25000 });
    proof.endCleanup = true;
  }
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
  let failRange = true,
    prefixDownloads = 0;
  interruptWhole = sequential;
  await ownerContext.route(url, async (route) => {
    const range = route.request().headers().range;
    if (range === 'bytes=0-262143') prefixDownloads++;
    if (failRange && range === 'bytes=262144-524287')
      await route.fulfill({
        status: 503,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '',
      });
    else await route.fallback();
  });
  await owner.locator('#mode-toggle').click();
  await owner.locator('#cache-button').click();
  await owner
    .locator('#cache-button')
    .filter({ hasText: '继续本机缓存' })
    .waitFor({ timeout: 20000 });
  const pausedJobs = await diskJobs();
  const retained = latest.members.find((m: any) => m.name === '分段房主').cache.bytes;
  assert.ok(retained > 0);
  await reconnect(owner);
  await owner.locator('#cache-button').filter({ hasText: '继续本机缓存' }).waitFor();
  assert.deepEqual(await diskJobs(), pausedJobs);
  await owner
    .locator('#cache-overlay')
    .screenshot({ path: '.local/screenshots/cache-continue.png' });
  failRange = false;
  interruptWhole = false;
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
  if (!sequential)
    assert.equal(prefixDownloads, 1, 'Continue must not redownload an already committed prefix');
  assert.deepEqual(await diskJobs(), pausedJobs);
  await reconnect(owner);
  await reconnect(viewer);
  await owner.locator('#mode-description').filter({ hasText: '大家都已准备好' }).waitFor();
  assert.deepEqual(await diskJobs(), pausedJobs);
  proof.fullModeContinuation = { retained, prefixDownloads, readyReconnectKeepsDisk: true };
  await owner.locator('#video').evaluate((video: HTMLVideoElement) => {
    const missing = new URL(video.currentSrc);
    missing.pathname = missing.pathname.replace(/[^/]+$/, 'missing.mp4');
    video.src = missing.href;
  });
  await owner.locator('#cache-button').filter({ hasText: '重试本机播放' }).waitFor();
  assert.deepEqual(await diskJobs(), pausedJobs);
  await owner.locator('#cache-button').click();
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  assert.deepEqual(await diskJobs(), pausedJobs);
  if (!sequential) assert.equal(prefixDownloads, 1);
  proof.playbackRetryKeepsDownloadedData = true;
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
  proof.checksPassed = true;
} catch (cause) {
  proof.diagnostic = await diagnostic();
  console.log(JSON.stringify(proof.diagnostic));
  proof.passed = false;
  proof.error = String(cause);
  throw cause;
} finally {
  hold = false;
  holdTail = false;
  for (const done of release.splice(0)) done();
  for (const done of releaseTail.splice(0)) done();
  for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'ignoreErrors' });
  await mkdir('.local/screenshots', { recursive: true });
  await browser.close();
  source.closeAllConnections();
  source.close();
  app.close();
  proof.cleanup = true;
  proof.passed = proof.checksPassed === true;
  await writeFile(
    eviction
      ? `.local/cache-window${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`
      : `.local/cache-parts-${parts}${sequential ? '-sequential' : ''}${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
}
console.log(JSON.stringify(proof, null, 2));
