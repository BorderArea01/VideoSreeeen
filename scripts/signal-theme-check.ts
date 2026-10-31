import { checkChatCollapse, checkRoomPopovers } from './sidebar-checks';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, waitForTheme } from './room-ui';

const { PNG } = createRequire(import.meta.url)(
  resolve('node_modules/playwright-core/lib/utilsBundle.js'),
);
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || 'http://127.0.0.1:' + (app.server.address() as any).port;
const video = await readFile('.local/flower.mp4');
const source = createServer((req, res) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(match?.[1] || 0),
    end = Math.min(video.length - 1, match?.[2] ? Number(match[2]) : video.length - 1);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', end - start + 1);
  if (match) {
    res.statusCode = 206;
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + video.length);
  }
  res.end(req.method === 'HEAD' ? undefined : video.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const movie = process.env.VS_PUBLIC_URL
  ? 'https://cache-fixture.videosreeeen.test/flower.mp4'
  : 'http://127.0.0.1:' + (source.address() as any).port + '/flower.mp4';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
});
const evidence: Record<string, any> = { at: new Date().toISOString(), origin, realPhone: false };
const errors: string[] = [],
  commands: string[] = [];
let watching = false;
async function context(roll: number) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  await ctx.addInitScript((roll) => {
    // Explicitly cover accepted/rejected entries without flaky visual fixtures.
    Math.random = () => (window as any).__glitchRoll ?? 0.25;
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = roll;
        return array;
      }
      return random(array);
    }) as typeof crypto.getRandomValues;
    try {
      localStorage.setItem('danmaku', 'off');
    } catch {
      /* The fixture also runs in opaque utility documents. */
    }
    (window as any).__micRequests = 0;
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {
        (window as any).__micRequests++;
        throw new Error('This visual verification must not open a microphone');
      };
  }, roll);
  await ctx.route(origin + '/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), mediaRelay: false, p2p: false },
    });
  });
  if (process.env.VS_PUBLIC_URL)
    await ctx.route(movie, (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  return ctx;
}
async function select(page: Page, value: string) {
  if (!(await page.locator('#settings-dialog').isVisible()))
    await page.locator('#appearance-button').click();
  await page.locator('.theme-choice:has(input[value="' + value + '"])').click();
  await waitForTheme(page,value);
  assert.equal(await waitForTheme(page), value);
  await page.locator('[data-close="settings-dialog"]').first().click();
  await page.evaluate(() => document.fonts.ready);
}
async function textFields(page: Page) {
  await page.locator('#source-url').scrollIntoViewIfNeeded();
  const spacing = await page.evaluate(() => {
    const input = document.getElementById('source-url')!;
    const icon = document.querySelector('#source-form .input-icon svg')!.getBoundingClientRect();
    const box = input.getBoundingClientRect();
    const message = document.querySelector<HTMLTextAreaElement>('#chat-input')!;
    const style = getComputedStyle(message);
    return {
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        parseFloat,
      ),
      lines:
        (message.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) /
        parseFloat(style.lineHeight),
      iconCenterDifference: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
      iconToTextGap: box.x + parseFloat(getComputedStyle(input).paddingLeft) - icon.right,
      clickReachesInput:
        document.elementFromPoint(icon.x + icon.width / 2, icon.y + icon.height / 2) === input,
    };
  });
  assert.ok(
    spacing.padding.every((n) => n >= 12),
    JSON.stringify(spacing),
  );
  assert.ok(spacing.lines >= 2, JSON.stringify(spacing));
  assert.ok(spacing.iconCenterDifference <= 1, JSON.stringify(spacing));
  assert.ok(spacing.iconToTextGap >= 10, JSON.stringify(spacing));
  assert.equal(spacing.clickReachesInput, true);
  return spacing;
}
try {
  await mkdir('.local/screenshots', { recursive: true });
  const host = await context(2),
    owner = await host.newPage();
  owner.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (!watching) return;
      try {
        const data = JSON.parse(String(payload));
        if (['control', 'media', 'mode', 'cache', 'unshare'].includes(data.type))
          commands.push(data.type);
      } catch {}
    }),
  );
  await owner.goto(origin);
  assert.equal(await waitForTheme(owner), 'signal');
  await owner.reload();
  assert.equal(await waitForTheme(owner), 'signal');
  const linkedContext = await context(0),
    linked = await linkedContext.newPage();
  await linked.goto(origin + '/?skin=signal');
  assert.equal(await waitForTheme(linked), 'signal');
  assert.equal(new URL(linked.url()).searchParams.has('skin'), false);
  await linked.reload();
  assert.equal(await waitForTheme(linked), 'signal');
  await linkedContext.unrouteAll({ behavior: 'wait' });
  await linkedContext.close();
  evidence.themeLinkAndPreference = true;
  assert.equal(await owner.locator('#theme-photo').count(), 0);
  await select(owner, 'signal');
  assert.equal(
    await owner.evaluate(() => localStorage.getItem('videosreeeen.appearance')),
    'signal',
  );
  await owner.mouse.move(740, 75);
  await owner.waitForTimeout(1100);
  await owner.mouse.move(800, 95, { steps: 6 });
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    false,
  );
  await owner.locator('#hero-create').hover();
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    false,
  );
  await owner.locator('#hero-create').click();
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    true,
  );
  await owner.waitForTimeout(1100);
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    false,
  );
  await owner.locator('#dialog-close').focus();
  await owner.keyboard.press('Enter');
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    true,
  );
  evidence.backgroundOnlyOnButtonActivation = true;
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('紫电验收');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  // The background uses all page buttons, independent of the decorative whitelist.
  await owner.waitForTimeout(1100);
  await owner.locator('#chat-toggle').click();
  assert.equal(
    await owner.locator('#signal-field').evaluate((el) => el.classList.contains('signal-active')),
    true,
  );
  await owner.locator('#chat-restore').click();
  const guest = await context(0),
    viewer = await guest.newPage();
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('隔离观众');
  await viewer.locator('#join-button').click();
  await owner.waitForFunction(() => document.getElementById('member-count')?.textContent === '2');
  await selectSource(owner, movie);
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await owner.locator('#play-button').click();
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.2,
  );
  await owner.evaluate(() => {
    (window as any).__player = document.getElementById('video');
    (window as any).__audio = document.getElementById('audio');
    (window as any).__voice = document.getElementById('voice-panel');
    (window as any).__loads = 0;
    document.getElementById('video')!.addEventListener('loadstart', () => {
      (window as any).__loads++;
    });
  });
  await owner.locator('.theme-voice > summary').click();
  await owner.locator('#voice-join').click();
  await owner.locator('#voice-mic').waitFor({ state: 'visible' });
  await owner.locator('.theme-voice > summary').click();
  watching = true;
  evidence.playingSidebar = await checkChatCollapse(owner);
  assert.equal(await owner.locator('#video').evaluate((v: HTMLVideoElement) => v.paused), false);
  await owner.locator('.theme-voice > summary').click();
  assert.equal(await owner.locator('#voice-mic').isVisible(), true);
  await owner.locator('.theme-voice > summary').click();
  for (const name of ['classic', 'glitch', 'signal']) await select(owner, name);
  watching = false;
  assert.deepEqual(commands, []);
  assert.equal(
    await owner.evaluate(
      () =>
        document.getElementById('video') === (window as any).__player &&
        document.getElementById('audio') === (window as any).__audio &&
        document.getElementById('voice-panel') === (window as any).__voice &&
        (window as any).__loads === 0,
    ),
    true,
  );
  assert.equal(await waitForTheme(viewer), 'classic');
  await owner.locator('.theme-voice > summary').click();
  assert.equal(await owner.locator('#voice-mic').isVisible(), true);
  await owner.locator('#voice-leave').click();
  await owner.locator('.theme-voice > summary').click();
  assert.equal(await owner.evaluate(() => (window as any).__micRequests), 0);
  await owner.locator('#chat-input').fill('C 主题真实房间聊天与播放。🟩');
  await owner.locator('#send-button').click();
  await viewer.locator('.bubble').filter({ hasText: 'C 主题真实房间聊天与播放。🟩' }).waitFor();
  if (!(await owner.locator('#video').evaluate((v: HTMLVideoElement) => v.paused)))
    await owner.locator('#play-button').click();
  await viewer.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  evidence.stateAndChat = {
    samePlayer: true,
    sameAudio: true,
    sameVoice: true,
    roomMutationsFromTheme: commands,
    microphoneRequests: 0,
    viewerTheme: 'classic',
  };
  evidence.typography = await owner.evaluate(async () => {
    await document.fonts.load('600 32px "Signal Tech"', 'VideoSreeeen');
    await document.fonts.load(
      '400 20px "Signal Tube"',
      '聊天内容，语音输入设备、缓存目录、网络波动与下一集。',
    );
    const styles = Object.fromEntries(
      [
        ['brand', '.brand > span:last-child'],
        ['chatTitle', '.chat-heading > div:first-child'],
        ['bubble', '.bubble'],
        ['transport', '.transport'],
        ['button', '#choose-link'],
        ['sourceInput', '#source-url'],
        ['chatInput', '#chat-input'],
        ['member', '.member-info strong'],
        ['settings', '#settings-title'],
        ['cache', '#cache-options > summary'],
      ].map(([name, selector]) => {
        const style = getComputedStyle(document.querySelector(selector!)!);
        return [name, { font: style.fontFamily, glow: style.textShadow }];
      }),
    );
    return {
      techLoaded: document.fonts.check('600 32px "Signal Tech"', 'VideoSreeeen'),
      tubeLoaded: document.fonts.check(
        '400 20px "Signal Tube"',
        '聊天内容，语音输入设备、缓存目录、网络波动与下一集。',
      ),
      ...styles,
      sources: performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('.woff2'))
        .map((e) => new URL(e.name).origin),
    };
  });
  assert.equal(evidence.typography.techLoaded, true);
  assert.equal(evidence.typography.tubeLoaded, true);
  assert.match(evidence.typography.brand.font, /Signal Tech/);
  assert.match(evidence.typography.chatTitle.font, /Signal Tube/);
  assert.notEqual(evidence.typography.brand.glow, 'none');
  assert.notEqual(evidence.typography.chatTitle.glow, 'none');
  assert.notEqual(evidence.typography.bubble.glow, 'none');
  for (const name of [
    'bubble',
    'transport',
    'button',
    'sourceInput',
    'chatInput',
    'member',
    'settings',
    'cache',
  ]) {
    assert.match(evidence.typography[name].font, /Signal Tech/);
    assert.match(evidence.typography[name].font, /Signal Tube/);
  }
  assert.equal(evidence.typography.transport.glow, 'none');
  assert.ok(evidence.typography.sources.length > 0);
  assert.ok(evidence.typography.sources.every((s: string) => s === origin));
  // Inspect actual rendered glyph providers, beyond a declared CSS font family.
  const cdp = await host.newCDPSession(owner);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const doc = await cdp.send('DOM.getDocument');
  const bubbleNode = await cdp.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '.bubble',
  });
  const glyphs = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: bubbleNode.nodeId });
  assert.ok(
    glyphs.fonts.some((f) => f.isCustomFont && /QingKe/i.test(f.familyName) && f.glyphCount >= 10),
    JSON.stringify(glyphs),
  );
  assert.ok(
    glyphs.fonts.some((f) => !f.isCustomFont && f.glyphCount > 0),
    'Emoji keeps its native fallback',
  );
  evidence.typography.renderedChatFonts = glyphs.fonts;
  await cdp.detach();
  evidence.textFields = { desktop: await textFields(owner) };
  await owner.locator('#chat-input').fill('第一行有留白\n第二行文字与表情 🟩');
  await owner.locator('#chat-input').evaluate((e: HTMLTextAreaElement) => {
    if (e.scrollHeight > e.clientHeight + 1)
      throw new Error('Two chat lines should fit inside padding');
  });
  await owner
    .locator('.chat-compose')
    .screenshot({ path: '.local/screenshots/signal-chat-input.png' });
  await owner.locator('#chat-input').fill('');
  await owner
    .locator('.chat-compose')
    .screenshot({ path: '.local/screenshots/signal-chat-placeholder.png' });
  const selectedURL = await owner.locator('#source-url').inputValue();
  await owner.locator('#source-url').fill('');
  await owner
    .locator('#source-form')
    .screenshot({ path: '.local/screenshots/signal-link-input.png' });
  await owner.locator('#source-url').fill(selectedURL);
  await owner.evaluate(() => ((window as any).__glitchRoll = 0.5));
  await owner.locator('#source-url').hover();
  await owner.waitForTimeout(1200);
  await owner.locator('#source-form button').hover();
  assert.equal(
    await owner
      .locator('#source-form button')
      .evaluate((e) => e.classList.contains('signal-active')),
    false,
  );
  await owner.evaluate(() => ((window as any).__glitchRoll = 0.1));
  const randomControl = await owner.locator('#source-form button').boundingBox();
  assert.ok(randomControl);
  await owner.mouse.move(
    randomControl.x + randomControl.width * 0.6,
    randomControl.y + randomControl.height * 0.5,
  );
  assert.equal(
    await owner
      .locator('#source-form button')
      .evaluate((e) => e.classList.contains('signal-active')),
    false,
  );
  await owner.locator('#source-url').hover();
  await owner.locator('#source-form button').hover();
  const variation = await owner.locator('#source-form button').evaluate((e) => ({
    active: e.classList.contains('signal-active'),
    travel: Number((e as HTMLElement).style.getPropertyValue('--signal-jump')),
    size: Number((e as HTMLElement).style.getPropertyValue('--signal-size')),
  }));
  assert.equal(variation.active, true);
  assert.ok(variation.travel >= 0.7 && variation.travel <= 1.3);
  assert.ok(variation.size >= 0.8 && variation.size <= 1.2);
  await owner.locator('#source-url').hover();
  await owner.waitForTimeout(1200);
  await owner.evaluate(() => ((window as any).__glitchRoll = 0.45));
  await owner.locator('#source-form button').hover();
  const changedVariation = await owner.locator('#source-form button').evaluate((e) => ({
    travel: Number((e as HTMLElement).style.getPropertyValue('--signal-jump')),
    size: Number((e as HTMLElement).style.getPropertyValue('--signal-size')),
  }));
  assert.notEqual(changedVariation.travel, variation.travel);
  assert.notEqual(changedVariation.size, variation.size);
  evidence.hoverChance = {
    rejectedAtHalf: true,
    noRerollWithinControl: true,
    variation,
    changedVariation,
  };
  await owner.evaluate(() => delete (window as any).__glitchRoll);
  await owner.mouse.move(0, 0);
  await owner.waitForTimeout(1200);
  await owner.locator('#source-form button').hover();
  await owner.waitForTimeout(90);
  evidence.button = await owner.locator('#source-form button .signal-copy').evaluate((el) => ({
    filter: getComputedStyle(el).filter,
    timing: getComputedStyle(el).animationTimingFunction,
    clip: getComputedStyle(el).clipPath,
    pointer: getComputedStyle(el).pointerEvents,
  }));
  assert.equal(evidence.button.filter, 'invert(1)');
  assert.equal(evidence.button.timing, 'steps(1)');
  assert.equal(evidence.button.pointer, 'none');
  await owner.waitForTimeout(1100);
  assert.equal(await owner.locator('.signal-active').count(), 0);
  await owner.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await owner.waitForTimeout(200);
  const panel = await owner.locator('#chat-panel').boundingBox();
  assert.ok(panel);
  const film = await owner.locator('#player-shell').boundingBox();
  assert.ok(film);
  assert.ok(Math.abs(panel.y - film.y) < 3);
  assert.ok(Math.abs(panel.height - film.height) < 3);
  evidence.composition = { film, panel };
  await owner.screenshot({ path: '.local/screenshots/signal-room.png', fullPage: true });
  if (!process.env.VS_PUBLIC_URL)
    await owner.screenshot({ path: 'docs/screenshots/signal-theme.png', fullPage: true });
  // Freeze decoded CC0 frame; only the decoration timeline advances in this proof.
  const stage = await owner.locator('#stage').boundingBox();
  assert.ok(stage);
  const clip = {
    x: Math.ceil(stage.x) + 1,
    y: Math.ceil(stage.y) + 1,
    width: Math.floor(stage.width) - 2,
    height: Math.floor(stage.height) - 2,
  };
  const base = PNG.sync.read(await owner.screenshot({ clip }));
  await owner.evaluate(() => {
    for (const el of document.querySelectorAll('.signal-control,.signal-panel,#signal-field'))
      el.classList.add('signal-active');
    (window as any).__animations = document
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName?.startsWith('signal-'));
    for (const a of (window as any).__animations) a.pause();
  });
  let difference = 0;
  for (let time = 0; time <= 900; time += 30) {
    await owner.evaluate((time) => {
      for (const a of (window as any).__animations) a.currentTime = time;
    }, time);
    const rendered = PNG.sync.read(await owner.screenshot({ clip }));
    for (let i = 0; i < base.data.length; i++)
      difference = Math.max(difference, Math.abs(rendered.data[i] - base.data[i]));
    assert.ok(difference <= 1, 'Decoration changed actual video frame at ' + time + ' ms');
    if (time === 90)
      await owner.screenshot({ path: '.local/screenshots/signal-active.png', fullPage: true });
  }
  await owner.evaluate(() => {
    for (const el of document.querySelectorAll('.signal-active'))
      el.classList.remove('signal-active');
    delete (window as any).__animations;
  });
  evidence.videoGuard = { samples: 31, maxChannelDifference: difference, tolerance: 1 };
  evidence.sidebar = {};
  watching = true;
  for (const theme of ['signal', 'glitch', 'classic']) {
    await select(owner, theme);
    evidence.sidebar[theme] = await checkChatCollapse(owner);
    if (theme !== 'classic') await checkRoomPopovers(owner);
  }
  await select(owner, 'signal');
  watching = false;
  assert.deepEqual(commands, []);
  await owner.locator('#page-fullscreen').click();
  await owner.waitForFunction(() => document.body.classList.contains('page-cinema'));
  assert.equal(await owner.locator('#signal-field').isVisible(), false);
  assert.equal(
    await owner.evaluate(() => document.getElementById('video') === (window as any).__player),
    true,
  );
  await owner.keyboard.press('Escape');
  await owner.locator('#chat-collapse').click();
  await owner.locator('#page-fullscreen').click();
  await owner.locator('#page-sidebar-toggle').click();
  assert.equal(await owner.locator('#chat-panel').isVisible(), true);
  await owner.locator('#chat-collapse').click();
  assert.equal(await owner.locator('#chat-panel').isVisible(), false);
  await owner.keyboard.press('Escape');
  assert.equal(await owner.locator('#chat-restore').isVisible(), true);
  await owner.locator('#chat-restore').click();
  await owner.locator('#player-shell').evaluate((el) => el.requestFullscreen());
  await owner.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await owner.locator('#signal-field').isVisible(), false);
  await owner.evaluate(() => document.exitFullscreen());
  for (const width of [390, 320]) {
    await owner.setViewportSize({ width, height: 844 });
    evidence.textFields[width] = await textFields(owner);
    assert.equal(
      await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await owner.evaluate(
        () =>
          document.querySelector('.room-heading')!.getBoundingClientRect().bottom <=
          document.getElementById('player-shell')!.getBoundingClientRect().top + 1,
      ),
      true,
      'Room heading stays above the video after fullscreen',
    );
    await checkChatCollapse(owner);
    await checkRoomPopovers(owner);
    await owner.locator('#appearance-button').click();
    assert.equal(await owner.locator('input[name=appearance]').count(), 3);
    await owner
      .locator('.appearance-settings')
      .screenshot({ path: '.local/screenshots/signal-picker-' + width + '.png' });
    await owner.locator('[data-close="settings-dialog"]').first().click();
    await owner.screenshot({ path: '.local/screenshots/signal-' + width + '.png', fullPage: true });
  }
  await owner.setViewportSize({ width: 1440, height: 1060 });
  await owner.emulateMedia({ reducedMotion: 'reduce' });
  await owner.locator('#source-form button').hover();
  assert.equal(
    await owner.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => (a as CSSAnimation).animationName?.startsWith('signal-')).length,
    ),
    0,
  );
  await owner.emulateMedia({ reducedMotion: 'no-preference' });
  await owner.emulateMedia({ forcedColors: 'active' });
  assert.equal(
    await owner.locator('.brand > span:last-child').evaluate((e) => getComputedStyle(e).textShadow),
    'none',
  );
  await owner.emulateMedia({ forcedColors: 'none' });
  await owner.reload();
  assert.equal(await waitForTheme(owner), 'signal');
  assert.deepEqual(errors, []);
  evidence.checksPassed = true;
} finally {
  try {
    for (const context of browser.contexts()) {
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    await browser.close();
    evidence.cleanup = true;
  } finally {
    evidence.passed = evidence.checksPassed === true && evidence.cleanup === true;
    await writeFile(
      '.local/signal-theme' + (process.env.VS_PUBLIC_URL ? '-public' : '') + '-evidence.json',
      JSON.stringify(evidence, null, 2),
    );
    source.closeAllConnections();
    source.close();
    app.close();
  }
}
console.log(JSON.stringify(evidence, null, 2));
