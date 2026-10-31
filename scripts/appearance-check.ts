import { checkChatCollapse, checkRoomPopovers } from './sidebar-checks';
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
  target: process.env.VS_PUBLIC_URL || 'local',
  realPhone: false,
};
async function context(roll: number) {
  const result = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await result.addInitScript((value) => {
    // Fixed only in isolated visual fixtures, never in the real application.
    Math.random = () => (window as any).__glitchRoll ?? 0.25;
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
async function edgeTones(page: Page, r: { x: number; y: number; width: number; height: number }) {
  return page.evaluate((r) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#theme-fragments')!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const x = Math.max(0, Math.ceil((r.x + r.width + 1) * scale));
    const y = Math.max(0, Math.ceil(r.y * scale));
    const w = Math.min(canvas.width - x, Math.floor(70 * scale));
    const h = Math.min(canvas.height - y, Math.floor(r.height * scale));
    if (w < 1 || h < 1) return { dark: 0, light: 0 };
    const pixels = canvas.getContext('2d')!.getImageData(x, y, w, h).data;
    let dark = 0,
      light = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 100) continue;
      if (pixels[i]! < 80 && pixels[i + 1]! < 115 && pixels[i + 2]! < 155) dark++;
      if (pixels[i]! > 175 && pixels[i + 1]! > 175 && pixels[i + 2]! > 175) light++;
    }
    return { dark, light };
  }, r);
}
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
  const edgeHome = await owner.locator('#chat-panel').boundingBox();
  assert.ok(edgeHome);
  await owner.mouse.move(4, 100);
  await owner.waitForTimeout(1100);
  assert.deepEqual(await edgeTones(owner, edgeHome), { dark: 0, light: 0 });
  await owner.mouse.move(edgeHome.x + edgeHome.width - 7, edgeHome.y + edgeHome.height * 0.5);
  await owner.waitForTimeout(110);
  const homeTones = await edgeTones(owner, edgeHome);
  assert.ok(homeTones.dark > 30 && homeTones.light > 30, JSON.stringify(homeTones));
  proof.chatCollapse = await checkChatCollapse(owner);
  await checkRoomPopovers(owner);
  await owner.mouse.move(4, 100);
  await owner.waitForTimeout(1100);
  assert.deepEqual(await edgeTones(owner, edgeHome), { dark: 0, light: 0 });
  proof.idleHasNoFrozenGlitch = true;
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
  if (!process.env.VS_PUBLIC_URL) {
    await owner.screenshot({ path: 'docs/screenshots/glitch-art.png' });
    await owner.mouse.move(25, 530);
    await owner.waitForTimeout(60);
    const chat = composition['#chat-panel'];
    await owner.mouse.move(chat.right - 8, chat.top + chat.height * 0.52);
    await owner.waitForTimeout(60);
    await owner.locator('#source-form .button').hover();
    await owner.waitForTimeout(100);
    await owner.screenshot({ path: 'docs/screenshots/glitch-art-active.png' });
  }
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
  assert.equal(settled, still);
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
    const photo = await owner.locator('#theme-photo').evaluate((e: HTMLImageElement) => {
      const r = e.getBoundingClientRect();
      return {
        loaded: e.complete && e.naturalWidth >= 1536,
        width: r.width,
        height: r.height,
        fit: getComputedStyle(e).objectFit,
      };
    });
    assert.equal(photo.loaded, true);
    assert.equal(photo.fit, 'cover');
    assert.ok(photo.width >= size.width - 1 && photo.height >= size.height - 1);
  }
  await owner.setViewportSize({ width: 1440, height: 1000 });
  const cdp = await glitchContext.newCDPSession(owner);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
  await owner.screenshot({ path: '.local/screenshots/theme-zoom.png' });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  proof.backgroundResizesAndZooms = true;
  assert.equal(await owner.locator('.daylight-edition').count(), 0);
  const heading = await owner.locator('.brand').evaluate((e) => ({
    color: getComputedStyle(e).color,
    plate: getComputedStyle(e, '::before').backgroundImage,
  }));
  assert.equal(heading.color, 'rgb(7, 43, 88)');
  assert.match(heading.plate, /linear-gradient/);
  proof.cleanPhotoAndReadableBrand = true;
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
  const labelSlices = await owner.locator('#source-form .button').evaluate((button) => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest('svg')) continue;
      const text = node.textContent.trim();
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const r = range.getBoundingClientRect();
      const canvas = document.querySelector<HTMLCanvasElement>('#theme-fragments')!;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const pixels = canvas
        .getContext('2d')!
        .getImageData(
          Math.floor(r.left * scale),
          Math.floor(r.top * scale),
          Math.ceil(r.width * scale),
          Math.ceil(r.height * scale),
        );
      const rows = new Set<number>();
      let channels = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const data = pixels.data;
        if (!data[i + 3]) continue;
        rows.add(Math.floor(i / 4 / pixels.width));
        if (
          (data[i]! < 150 && data[i + 1]! > 140 && data[i + 2]! > 150) ||
          (data[i]! > 150 && data[i + 1]! < 170 && data[i + 2]! > 90)
        )
          channels++;
      }
      const buttonRect = button.getBoundingClientRect();
      const glyph = button.querySelector('svg');
      const pseudo = getComputedStyle(button, '::after');
      const iw = Number.parseFloat(pseudo.width),
        ih = Number.parseFloat(pseudo.height);
      const icon = glyph
        ? glyph.getBoundingClientRect()
        : {
            left: r.left - (Number.parseFloat(getComputedStyle(button).columnGap) || 0) - iw,
            top: buttonRect.top + (buttonRect.height - ih) / 2,
            width: iw,
            height: ih,
          };
      const iconPixels = canvas
        .getContext('2d')!
        .getImageData(
          Math.floor(icon.left * scale),
          Math.floor(icon.top * scale),
          Math.ceil(icon.width * scale),
          Math.ceil(icon.height * scale),
        );
      const iconRows = new Set<number>();
      let iconGlyphPixels = 0;
      for (let i = 0; i < iconPixels.data.length; i += 4)
        if (iconPixels.data[i + 3]) {
          iconRows.add(Math.floor(icon.top * scale) + Math.floor(i / 4 / iconPixels.width));
          if (
            iconPixels.data[i]! > 180 &&
            iconPixels.data[i + 1]! > 180 &&
            iconPixels.data[i + 2]! > 180
          )
            iconGlyphPixels++;
        }
      const sharedRows = [...rows].filter((row) =>
        iconRows.has(Math.floor(r.top * scale) + row),
      ).length;
      return {
        text,
        changedRows: rows.size,
        height: pixels.height,
        channels,
        iconRows: iconRows.size,
        iconGlyphPixels,
        sharedRows,
      };
    }
    return null;
  });
  assert.ok(labelSlices && labelSlices.channels > 2, JSON.stringify(labelSlices));
  assert.ok(
    labelSlices.changedRows > 0 && labelSlices.changedRows <= labelSlices.height * 0.35,
    JSON.stringify(labelSlices),
  );
  assert.equal(await owner.locator('#source-form .button').innerText(), labelSlices.text);
  assert.ok(
    labelSlices.iconRows > 0 && labelSlices.sharedRows > 0 && labelSlices.iconGlyphPixels > 0,
    JSON.stringify(labelSlices),
  );
  proof.referenceLabelSlices = labelSlices;
  const afterimage = await signature('#theme-fragments');
  await owner.waitForTimeout(180);
  assert.notEqual(await signature('#theme-fragments'), afterimage);
  await owner.waitForTimeout(1300);
  const settledButton = await signature('#theme-fragments');
  assert.equal(settledButton, buttonBefore);
  await owner.waitForTimeout(250);
  assert.equal(await signature('#theme-fragments'), settledButton);
  proof.buttonMaterialAfterimage = true;
  // A rejected hover stays rejected for this entire entry, even after moving.
  await owner.evaluate(() => ((window as any).__glitchRoll = 0.5));
  await owner.locator('#source-url').hover();
  await owner.waitForTimeout(1200);
  const quietCanvas = await signature('#theme-fragments');
  await owner.locator('#choose-file').hover();
  await owner.waitForTimeout(155);
  assert.equal(await signature('#theme-fragments'), quietCanvas);
  await owner.evaluate(() => ((window as any).__glitchRoll = 0.1));
  const fileButton = await owner.locator('#choose-file').boundingBox();
  assert.ok(fileButton);
  await owner.mouse.move(
    fileButton.x + fileButton.width * 0.6,
    fileButton.y + fileButton.height * 0.5,
  );
  await owner.waitForTimeout(155);
  assert.equal(await signature('#theme-fragments'), quietCanvas);
  await owner.locator('#source-url').hover();
  await owner.locator('#choose-file').hover();
  await owner.waitForTimeout(155);
  assert.notEqual(await signature('#theme-fragments'), quietCanvas);
  proof.hoverChance = {
    rejectedAtHalf: true,
    noRerollWithinControl: true,
    reentryCanTrigger: true,
  };
  await owner.evaluate(() => delete (window as any).__glitchRoll);
  await owner.locator('#source-url').hover();
  await owner.waitForTimeout(1200);
  await owner.locator('#choose-file').hover();
  await owner.waitForTimeout(155);
  const fragmentTails = await owner.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#theme-fragments')!;
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const r = document.getElementById('choose-file')!.getBoundingClientRect();
    const input = document.getElementById('source-url')!.getBoundingClientRect();
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const tails = new Set<number>();
    let pixels = 0,
      inputPixels = 0;
    for (let y = Math.ceil(r.top * ratio); y < Math.floor(r.bottom * ratio); y++) {
      let end = -1;
      for (let x = Math.ceil(r.right * ratio); x < Math.floor(input.left * ratio); x++) {
        if (data[(y * canvas.width + x) * 4 + 3]! > 80) {
          end = x;
          pixels++;
        }
      }
      if (end >= 0) tails.add(end);
    }
    for (let y = Math.ceil(input.top * ratio); y < Math.floor(input.bottom * ratio); y++)
      for (let x = Math.ceil(input.left * ratio); x < Math.floor(input.right * ratio); x++)
        if (data[(y * canvas.width + x) * 4 + 3]! > 0) inputPixels++;
    return { pixels, differentEnds: tails.size, inputPixels };
  });
  assert.ok(fragmentTails.pixels > 15, JSON.stringify(fragmentTails));
  assert.ok(
    fragmentTails.differentEnds >= 3,
    'Fragment tails must not end at one flat clipping wall',
  );
  assert.equal(fragmentTails.inputPixels, 0);
  proof.fileButtonFragmentTails = fragmentTails;
  await owner.screenshot({
    path: '.local/screenshots/daylight-file-button.png',
    clip: {
      x: Math.max(0, fileButton.x - 8),
      y: Math.max(0, fileButton.y - 12),
      width: Math.min(340, owner.viewportSize()!.width - fileButton.x + 8),
      height: fileButton.height + 24,
    },
  });
  const unifiedControls: Record<string, unknown> = {};
  for (const selector of [
    '#sidebar-invite',
    '#choose-link',
    '#choose-file',
    '.daylight-voice > summary',
    '#settings-button',
    '#send-button',
    '#chat-collapse',
  ]) {
    await owner.mouse.move(4, 100);
    await owner.waitForTimeout(1000);
    const before = await owner.locator(selector).boundingBox();
    assert.ok(before, 'Control should be visible: ' + selector);
    await owner.locator(selector).hover();
    await owner.waitForTimeout(155);
    const pixels = await owner.locator(selector).evaluate((control) => {
      const r = control.getBoundingClientRect();
      const canvas = document.querySelector<HTMLCanvasElement>('#theme-fragments')!;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.max(0, Math.floor(r.left * scale)),
          Math.max(0, Math.floor(r.top * scale)),
          Math.max(1, Math.floor(r.width * scale)),
          Math.max(1, Math.floor(r.height * scale)),
        ).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 80) opaque++;
      return opaque;
    });
    assert.ok(pixels > 10, 'Missing live data slices on ' + selector);
    const after = await owner.locator(selector).boundingBox();
    assert.deepEqual(after, before, 'Decoration must not move the real control');
    unifiedControls[selector] = { pixels, stableBounds: true };
    await owner.screenshot({
      path: '.local/screenshots/daylight-control-' + selector.replace(/[^a-z0-9-]/gi, '') + '.png',
    });
  }
  proof.unifiedControls = unifiedControls;
  // Sweep the upper-right chat edge beside the invitation action. The old header
  // rectangle erased this whole band, causing the user's clean corner cutout.
  await owner.mouse.move(4, 100);
  await owner.waitForTimeout(1100);
  const chatCorner = await owner.locator('#chat-panel').boundingBox();
  assert.ok(chatCorner);
  await owner.mouse.move(chatCorner.x + chatCorner.width - 3, chatCorner.y + 12);
  await owner.waitForTimeout(100);
  const cornerInk = await owner
    .locator('#theme-fragments')
    .evaluate((canvas: HTMLCanvasElement) => {
      const r = document.getElementById('chat-panel')!.getBoundingClientRect();
      const header = document.getElementById('chat-heading')!.getBoundingClientRect();
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const x = Math.floor((r.right - 12) * scale),
        y = Math.floor((r.top + 2) * scale);
      const data = canvas
        .getContext('2d')!
        .getImageData(x, y, Math.ceil(12 * scale), Math.ceil((header.height - 4) * scale)).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 80) count++;
      return count;
    });
  assert.ok(cornerInk > 10, 'Chat header must not rectangularly erase the corner fracture');
  proof.chatCornerFracturePixels = cornerInk;
  await owner.screenshot({ path: '.local/screenshots/daylight-chat-corner.png' });
  await owner.screenshot({
    path: '.local/screenshots/daylight-fine-edge.png',
    clip: {
      x: Math.max(0, chatCorner.x + chatCorner.width - 75),
      y: Math.max(0, chatCorner.y),
      width: Math.min(
        230,
        owner.viewportSize()!.width - Math.max(0, chatCorner.x + chatCorner.width - 75),
      ),
      height: Math.min(330, owner.viewportSize()!.height - Math.max(0, chatCorner.y)),
    },
  });
  const originalPhoto = await owner.locator('#theme-photo').getAttribute('src');
  assert.ok(originalPhoto);
  await owner.evaluate(async () => {
    const plate = document.createElement('canvas');
    plate.width = 96;
    plate.height = 64;
    const ctx = plate.getContext('2d')!;
    ctx.fillStyle = 'rgb(245, 160, 24)';
    ctx.fillRect(0, 0, 96, 64);
    const image = document.querySelector<HTMLImageElement>('#theme-photo')!;
    image.src = plate.toDataURL();
    await image.decode();
  });
  await owner.waitForTimeout(100);
  await owner.mouse.move(4, 100);
  await owner.locator('#source-form .button').hover();
  await owner.waitForTimeout(110);
  const liveSample = await owner
    .locator('#theme-fragments')
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let gold = 0,
        inverse = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i]! > 220 &&
          pixels[i + 1]! > 120 &&
          pixels[i + 1]! < 190 &&
          pixels[i + 2]! < 65 &&
          pixels[i + 3]! > 160
        )
          gold++;
        // Exact RGB inverse of this fixture's (245,160,24), not a blue accent.
        if (
          Math.abs(pixels[i]! - 10) <= 1 &&
          Math.abs(pixels[i + 1]! - 95) <= 1 &&
          Math.abs(pixels[i + 2]! - 231) <= 1 &&
          pixels[i + 3]! > 160
        )
          inverse++;
      }
      return { gold, inverse };
    });
  assert.ok(
    liveSample.gold > 40,
    'Fragments must sample the actual current photo, not a cloud atlas',
  );
  assert.ok(
    liveSample.inverse > 20,
    'Counterstrips must contain the exact RGB inverse of that material',
  );
  await owner.locator('#theme-photo').evaluate(async (image: HTMLImageElement, src) => {
    image.src = src;
    await image.decode();
  }, originalPhoto);
  assert.equal(
    await owner.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => e.name.includes('daylight-fracture')),
    ),
    false,
  );
  proof.liveSourceSampling = {
    goldPixels: liveSample.gold,
    inversePixels: liveSample.inverse,
    noBakedCloudTexture: true,
  };
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
  await owner.locator('#theme-photo').waitFor({ state: 'visible' });
  await owner.locator('#theme-scene').waitFor({ state: 'visible' });
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
  await linkedContext.unrouteAll({ behavior: 'wait' });
  await linkedContext.close();
  proof.skinLinkAndRememberedChoice = true;
  assert.deepEqual(failures, []);
  proof.checksPassed = true;
} finally {
  try {
    for (const context of browser.contexts()) {
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    await browser.close();
    proof.cleanup = true;
  } finally {
    proof.passed = proof.checksPassed === true && proof.cleanup === true;
    await writeFile(
      `.local/appearance${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
      JSON.stringify(proof, null, 2),
    );
    source.closeAllConnections();
    source.close();
    app.close();
  }
}
console.log(JSON.stringify(proof, null, 2));
