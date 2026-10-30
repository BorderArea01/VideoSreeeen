import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
const data = await readFile('.local/flower.mp4').catch(async () => {
  const response = await fetch(
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  );
  assert.ok(response.ok);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir('.local', { recursive: true });
  await writeFile('.local/flower.mp4', bytes);
  return bytes;
});
const source = createServer((request, response) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const start = Number(range?.[1] ?? 0);
  const end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Content-Type', 'video/mp4');
  response.setHeader('Content-Length', end - start + 1);
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
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
const failures: string[] = [];
const proof: Record<string, unknown> = {
  at: new Date().toISOString(),
  target: process.env.VS_PUBLIC_URL ? 'public-preview' : 'local',
  realPhone: false,
};
async function context(roll: number) {
  const result = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await result.addInitScript((value) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = value;
        return array;
      }
      return original(array);
    }) as typeof crypto.getRandomValues;
  }, roll);
  await result.route(origin + '/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), mediaRelay: false, p2p: false },
    });
  });
  if (process.env.VS_PUBLIC_URL)
    await result.route(url, (route) => route.fulfill({ contentType: 'video/mp4', body: data }));
  result.on('page', (page) => page.on('pageerror', (cause) => failures.push(cause.message)));
  return result;
}
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
async function select(page: Page, value: string) {
  if (!(await page.locator('#settings-dialog').isVisible()))
    await page.locator('#appearance-button').click();
  await page.locator(`.theme-choice:has(input[value="${value}"])`).click();
  assert.equal(await theme(page), value);
  await page.waitForTimeout(180); // Let the existing 150 ms color transition settle before screenshots.
}
async function close(page: Page) {
  await page.locator('[data-close="settings-dialog"]').first().click();
}
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  await mkdir('.local/screenshots', { recursive: true });
  await mkdir('docs/screenshots', { recursive: true });
  const classicContext = await context(0);
  const classic = await classicContext.newPage();
  await classic.goto(origin);
  assert.equal(await theme(classic), 'classic');
  await classic.reload();
  assert.equal(await theme(classic), 'classic');
  await classic.evaluate(() => sessionStorage.setItem('videosreeeen.appearance.session', 'glitch'));
  const opened = classicContext.waitForEvent('page');
  await classic.evaluate(() => window.open(location.origin, '_blank'));
  const freshTab = await opened;
  await freshTab.waitForLoadState();
  assert.equal(await theme(freshTab), 'classic');
  await freshTab.close();
  proof.openerSessionDoesNotForceNewTab = true;
  const glitchContext = await context(1);
  const owner = await glitchContext.newPage();
  const operations: string[] = [];
  let watchingAppearance = false;
  owner.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (!watchingAppearance) return;
      try {
        const message = JSON.parse(String(payload));
        if (['control', 'media', 'mode', 'cache', 'unshare'].includes(message.type))
          operations.push(message.type);
      } catch {}
    });
  });
  await owner.goto(origin);
  assert.equal(await theme(owner), 'glitch');
  await owner.reload();
  assert.equal(await theme(owner), 'glitch');
  proof.randomVariantsAndStableReload = true;
  await select(owner, 'glitch'); // Clicking the already-selected random skin pins it too.
  assert.match(await owner.locator('#appearance-status').innerText(), /已记住/);
  await close(owner);
  await glitchContext.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = 0;
        return array;
      }
      return original(array);
    }) as typeof crypto.getRandomValues;
  });
  const pinned = await glitchContext.newPage();
  await pinned.goto(origin);
  assert.equal(await theme(pinned), 'glitch');
  await pinned.close();
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('皮肤验收');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  const viewer = await classicContext.newPage();
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('隔离观众');
  await viewer.locator('#join-button').click();
  await owner.waitForFunction(() => document.getElementById('member-count')?.textContent === '2');
  await selectSource(owner, url);
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await owner.locator('#play-button').click();
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.3,
  );
  await owner.evaluate(() => {
    (window as any).__appearancePlayer = document.querySelector('#video');
    (window as any).__appearanceLoads = 0;
    document
      .querySelector('#video')!
      .addEventListener('loadstart', () => (window as any).__appearanceLoads++);
  });
  await owner.locator('.daylight-voice > summary').click();
  await owner.evaluate(() => {
    (window as any).__appearanceVoice = document.getElementById('voice-panel');
  });
  await owner.locator('#voice-join').click();
  await owner.locator('#voice-mic').waitFor({ state: 'visible' });
  await owner.locator('.daylight-voice > summary').click();
  watchingAppearance = true;
  const stateBefore = await owner
    .locator('#video')
    .evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, time: v.currentTime }));
  await select(owner, 'classic');
  await close(owner);
  assert.equal(await theme(viewer), 'classic');
  await select(owner, 'glitch');
  await close(owner);
  await owner.locator('.daylight-voice > summary').click();
  assert.equal(
    await owner.evaluate(
      () => document.getElementById('voice-panel') === (window as any).__appearanceVoice,
    ),
    true,
  );
  await owner.locator('#voice-mic').waitFor({ state: 'visible' });
  assert.equal(await owner.locator('#voice-mic').innerText(), '开麦');
  await owner.locator('#voice-leave').click();
  await owner.locator('.daylight-voice > summary').click();
  proof.voiceReceiveSurvivesSkinSwitch = true;
  const uninterrupted = await owner.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return {
      same: v === (window as any).__appearancePlayer,
      loads: (window as any).__appearanceLoads,
      src: v.currentSrc,
      paused: v.paused,
      time: v.currentTime,
    };
  });
  assert.ok(uninterrupted.same);
  assert.equal(uninterrupted.loads, 0);
  assert.equal(uninterrupted.src, stateBefore.src);
  assert.equal(uninterrupted.paused, false);
  assert.ok(uninterrupted.time > stateBefore.time);
  assert.deepEqual(operations, []);
  watchingAppearance = false;
  proof.playbackUnaffected = uninterrupted;
  assert.equal(await theme(viewer), 'classic');
  await owner.locator('#chat-input').fill('皮肤只在本机切换。🟦');
  await owner.locator('#send-button').click();
  await viewer.locator('.bubble').filter({ hasText: '皮肤只在本机切换。🟦' }).waitFor();
  await viewer.locator('#chat-input').fill('观众端收到消息，视频继续播放。');
  await viewer.locator('#send-button').click();
  await owner.locator('.bubble').filter({ hasText: '观众端收到消息，视频继续播放。' }).waitFor();
  proof.independentViewerAndChat = true;
  const drag = await owner.locator('#chat-drag').boundingBox();
  assert.ok(drag);
  await owner.mouse.move(drag.x + 40, drag.y + 10);
  await owner.mouse.down();
  await owner.mouse.move(drag.x - 60, drag.y + 35);
  await owner.mouse.up();
  assert.equal(
    await owner.locator('#chat-panel').evaluate((e) => getComputedStyle(e).position),
    'fixed',
  );
  await owner.locator('#chat-dock').click();
  proof.floatingChatPreserved = true;
  await owner.locator('#play-button').click();
  await owner.locator('#cache-options > summary').click();
  await owner.screenshot({ path: '.local/screenshots/theme-glitch-room.png', fullPage: true });
  await owner.locator('#appearance-button').click();
  await owner
    .locator('#settings-dialog')
    .screenshot({ path: '.local/screenshots/theme-picker.png' });
  if (!process.env.VS_PUBLIC_URL)
    await owner
      .locator('.appearance-settings')
      .screenshot({ path: 'docs/screenshots/appearance-picker.png' });
  await close(owner);
  await owner.locator('#cache-options > summary').click();
  await select(owner, 'classic');
  await close(owner);
  await owner.screenshot({ path: '.local/screenshots/theme-classic-room.png', fullPage: true });
  await select(owner, 'glitch');
  await close(owner);
  await owner.evaluate(() => window.scrollTo(0, 0));
  proof.palette = await owner.evaluate(() =>
    Object.fromEntries(
      ['#room-button', '#source-form .button', '#choose-screen', '#voice-join'].map((selector) => {
        const e = document.querySelector<HTMLElement>(selector)!;
        const s = getComputedStyle(e);
        return [
          selector,
          {
            color: s.color,
            background: s.backgroundColor,
            opacity: s.opacity,
            disabled: (e as HTMLButtonElement).disabled,
          },
        ];
      }),
    ),
  );
  await owner.screenshot({ path: '.local/screenshots/theme-glitch-viewport.png' });
  await owner.setViewportSize({ width: 1536, height: 1024 });
  await owner.mouse.move(4, 180);
  await owner.waitForTimeout(1400);
  const composition = await owner.evaluate(() =>
    Object.fromEntries(
      ['#player-shell', '#chat-panel', '#playback-picker'].map((selector) => [
        selector,
        document.querySelector(selector)!.getBoundingClientRect().toJSON(),
      ]),
    ),
  );
  assert.ok(Math.abs(composition['#player-shell'].top - 204) < 3);
  assert.ok(Math.abs(composition['#player-shell'].left - 80) < 3);
  assert.ok(Math.abs(composition['#player-shell'].height - composition['#chat-panel'].height) < 3);
  assert.ok(Math.abs(composition['#playback-picker'].width - 1376) < 5);
  proof.referenceComposition1536 = composition;
  await owner.screenshot({ path: '.local/screenshots/daylight-reference-1536.png' });
  if (!process.env.VS_PUBLIC_URL)
    await owner.screenshot({ path: 'docs/screenshots/glitch-art.png' });
  for (const width of [390, 320]) {
    await owner.setViewportSize({ width, height: 844 });
    assert.equal(await overflow(owner), false, `overflow at ${width}`);
    await owner.locator('#appearance-button').click();
    await owner
      .locator('#settings-dialog')
      .screenshot({ path: `.local/screenshots/theme-picker-${width}.png` });
    assert.equal(await overflow(owner), false);
    await close(owner);
    await owner.screenshot({
      path: `.local/screenshots/theme-glitch-${width}.png`,
      fullPage: true,
    });
  }
  proof.mobileLayouts = [390, 320];
  await owner.setViewportSize({ width: 1440, height: 1000 });
  await owner.evaluate(() => window.scrollTo(0, 0));
  const signature = (selector = '#theme-scene') =>
    owner.locator(selector).evaluate((element: HTMLCanvasElement) => {
      const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
      let result = 2166136261;
      for (let i = 0; i < data.length; i += 256) {
        result = Math.imul(result ^ data[i]!, 16777619);
        result = Math.imul(result ^ data[i + 3]!, 16777619);
      }
      return result;
    });
  await owner.mouse.move(10, 200);
  await owner.waitForTimeout(1400);
  const still = await signature();
  await owner.mouse.move(12, 300);
  await owner.mouse.move(35, 340, { steps: 5 });
  await owner.waitForTimeout(80);
  assert.notEqual(await signature(), still);
  await owner.screenshot({ path: '.local/screenshots/theme-live-interaction.png' });
  await owner.waitForTimeout(1400);
  const settled = await signature();
  await owner.waitForTimeout(200);
  assert.equal(await signature(), settled);
  proof.liveCanvasAndIdleStop = true;
  for (const size of [
    { width: 2560, height: 1440 },
    { width: 800, height: 1100 },
  ]) {
    await owner.setViewportSize(size);
    await owner.waitForTimeout(100);
    const bounds = await owner.locator('#theme-scene').boundingBox();
    assert.ok(bounds && bounds.width >= size.width - 1 && bounds.height >= size.height - 1);
    assert.equal(
      await owner.locator('#theme-scene').evaluate((e: HTMLCanvasElement) => {
        const c = e.getContext('2d')!;
        return [
          c.getImageData(0, 0, 1, 1).data[3],
          c.getImageData(e.width - 1, e.height - 1, 1, 1).data[3],
        ].every((x) => x === 255);
      }),
      true,
    );
  }
  await owner.setViewportSize({ width: 1440, height: 1000 });
  const cdp = await glitchContext.newCDPSession(owner);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
  await owner.screenshot({ path: '.local/screenshots/theme-zoom.png' });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  proof.backgroundResizesAndZooms = true;
  await owner.emulateMedia({ reducedMotion: 'reduce' });
  await owner.locator('#source-form .button').hover();
  assert.equal(
    await owner
      .locator('#source-form .button')
      .evaluate((e) => getComputedStyle(e, '::before').animationName),
    'none',
  );
  await owner.waitForTimeout(500);
  const reducedInk = await signature();
  await owner.mouse.move(15, 180);
  await owner.waitForTimeout(150);
  assert.equal(await signature(), reducedInk);
  proof.reducedMotion = true;
  await owner.emulateMedia({ forcedColors: 'active' });
  await owner.locator('#theme-scene').waitFor({ state: 'hidden' });
  await owner.emulateMedia({ forcedColors: 'none' });
  await owner.locator('#theme-scene').waitFor({ state: 'visible' });
  proof.forcedColors = true;
  await owner.emulateMedia({ reducedMotion: 'no-preference' });
  await owner.evaluate(() => window.scrollTo(0, 0));
  await owner.mouse.move(4, 100);
  await owner.waitForTimeout(1400);
  const buttonBefore = await signature('#theme-fragments');
  await owner.locator('#source-form .button').hover();
  await owner.waitForTimeout(140);
  assert.notEqual(await signature('#theme-fragments'), buttonBefore);
  const afterimage = await signature('#theme-fragments');
  await owner.waitForTimeout(180);
  assert.notEqual(await signature('#theme-fragments'), afterimage);
  await owner.waitForTimeout(1300);
  const settledButton = await signature('#theme-fragments');
  await owner.waitForTimeout(250);
  assert.equal(await signature('#theme-fragments'), settledButton);
  proof.buttonMaterialAfterimage = true;
  await owner.locator('.daylight-members > summary').click();
  await owner.locator('#members').hover();
  const frame = owner.locator('.daylight-members .members-card');
  await owner.waitForTimeout(140);
  assert.notEqual(await signature('#theme-fragments'), buttonBefore);
  assert.equal(await frame.evaluate((e) => getComputedStyle(e, '::before').pointerEvents), 'none');
  assert.equal(
    await owner.locator('#theme-fragments').evaluate((e) => getComputedStyle(e).pointerEvents),
    'none',
  );
  // Real rendered decoration must never cover the player, including its controls.
  const protectedPixels = await owner.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#theme-fragments')!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const context = canvas.getContext('2d')!;
    for (const selector of ['#player-shell', '#source-url', '#chat-input']) {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      const yEnd = Math.min(innerHeight, r.bottom);
      for (let y = Math.max(0, r.top); y < yEnd; y += 7)
        for (let x = Math.max(0, r.left); x < Math.min(innerWidth, r.right); x += 7)
          if (context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data[3])
            return false;
    }
    return true;
  });
  assert.equal(protectedPixels, true);
  proof.materialEdgesAndVideoExclusion = true;
  await owner.locator('.daylight-members > summary').click();
  assert.equal(
    await owner.locator('#theme-scene').evaluate((e) => getComputedStyle(e).pointerEvents),
    'none',
  );
  await owner.locator('#page-fullscreen').click();
  await owner.waitForFunction(() => document.body.classList.contains('page-cinema'));
  assert.equal(await owner.locator('#theme-fragments').isVisible(), false);
  assert.equal(await owner.locator('#theme-scene').isVisible(), false);
  assert.equal(
    await owner.evaluate(
      () => document.querySelector('#video') === (window as any).__appearancePlayer,
    ),
    true,
  );
  await owner.keyboard.press('Escape');
  proof.fullscreenPreserved = true;
  await owner.locator('#appearance-button').click();
  await owner.locator('input[name="appearance"][value="glitch"]').focus();
  await owner.keyboard.press('ArrowLeft');
  assert.equal(await theme(owner), 'classic');
  await owner.keyboard.press('ArrowRight');
  assert.equal(await theme(owner), 'glitch');
  proof.keyboardSelection = true;
  await owner.locator('#appearance-random').click();
  assert.match(await owner.locator('#appearance-status').innerText(), /随机分配/);
  assert.equal(await owner.evaluate(() => localStorage.getItem('videosreeeen.appearance')), null);
  await close(owner);
  await owner.reload();
  const reloaded = await theme(owner);
  await owner.reload();
  assert.equal(await theme(owner), reloaded);
  proof.returnToRandom = true;
  const blockedContext = await context(1);
  await blockedContext.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('videosreeeen.appearance'))
        throw new DOMException('blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('videosreeeen.appearance'))
        throw new DOMException('blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  const blocked = await blockedContext.newPage();
  await blocked.goto(origin);
  await select(blocked, 'classic');
  await close(blocked);
  proof.storageBlockedStillUsable = true;
  const linkedContext = await context(0);
  const linked = await linkedContext.newPage();
  await linked.goto(origin + '?skin=glitch');
  assert.equal(await theme(linked), 'glitch');
  assert.equal(new URL(linked.url()).searchParams.has('skin'), false);
  await linked.reload();
  assert.equal(await theme(linked), 'glitch');
  await linkedContext.close();
  proof.skinLinkAndRememberedChoice = true;
  assert.deepEqual(failures, []);
  proof.passed = true;
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await writeFile(
    `.local/appearance${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
  await browser.close();
  source.closeAllConnections();
  source.close();
  app.close();
}
