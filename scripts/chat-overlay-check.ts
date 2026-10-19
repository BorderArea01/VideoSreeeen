import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, choosePlayback } from './room-ui';

const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--js-flags=--max-old-space-size=96',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const proof: Record<string, any> = { origin, realServer: true, delayInjectedInTestOnly: true };
let holdProbes = false;
const timers = new Set<ReturnType<typeof setTimeout>>();
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 1080 } }),
    b = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const host = await a.newPage(),
    guest = await b.newPage();
  const ids: Record<string, string> = {},
    errors: string[] = [];
  const states: Record<string, any> = {};
  const serverErrors: Array<{ code: string; message: string }> = [];
  for (const [name, page, delay] of [
    ['host', host, 20],
    ['guest', guest, 160],
  ] as const) {
    page.on('pageerror', (e) => errors.push(e.message));
    await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
      const server = socket.connectToServer();
      server.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'welcome') ids[name] = msg.memberId;
        if (msg.room) states[name] = msg.room;
        if (msg.type === 'error') serverErrors.push({ code: msg.code, message: msg.message });
        socket.send(raw);
      });
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'probe') {
          if (holdProbes) return;
          const timer = setTimeout(() => {
            timers.delete(timer);
            server.send(raw);
          }, delay);
          timers.add(timer);
        } else server.send(raw);
      });
    });
  }
  const send = async (page: Page, text: string) => {
    await page.locator('#chat-input').fill(text);
    await page.locator('#send-button').click();
  };
  const confirmed = async (check: () => boolean) => {
    const until = Date.now() + 15000;
    while (!check()) {
      assert.ok(
        Date.now() < until,
        'Server acknowledgement timeout: ' + JSON.stringify(serverErrors),
      );
      await host.waitForTimeout(100);
    }
  };
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('弹幕提供者');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await send(host, '加入前的历史消息');
  await guest.goto(invite);
  await guest.locator('#name-input').fill('弹幕观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  const chatHeight = await guest.locator('#chat-panel').evaluate((el) => el.clientHeight);
  for (let i = 0; i < 24; i++) await send(host, `滚动记录 ${i}：固定高度的聊天室。`);
  await guest.locator('#chat-messages .bubble').filter({ hasText: '滚动记录 23：' }).waitFor();
  assert.equal(await guest.locator('#chat-panel').evaluate((el) => el.clientHeight), chatHeight);
  await guest.locator('#chat-messages').evaluate((el) => {
    el.scrollTop = 0;
  });
  await send(host, '查看历史时收到的新消息');
  await guest
    .locator('#chat-messages .bubble')
    .filter({ hasText: '查看历史时收到的新消息' })
    .waitFor();
  assert.equal(await guest.locator('#chat-messages').evaluate((el) => el.scrollTop), 0);
  assert.ok(
    await guest.locator('#chat-messages').evaluate((el) => el.scrollHeight > el.clientHeight),
  );
  proof.fixedChatAndHistoryScroll = true;
  await host.locator('#chat-input').fill('图片粘贴保留文字草稿');
  const pastedBytes = await host.locator('#chat-input').evaluate(async (input) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 768;
    const ctx = canvas.getContext('2d')!,
      pixels = ctx.createImageData(768, 768);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png'),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
    input.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
    return blob.size;
  });
  assert.ok(pastedBytes > 1024 * 1024);
  for (const page of [host, guest]) {
    await page.locator('#chat-messages').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('#chat-messages .bubble img');
      return img?.naturalWidth === 768;
    });
  }
  assert.equal(await host.locator('#chat-input').inputValue(), '图片粘贴保留文字草稿');
  await host.locator('#chat-input').fill('');
  proof.clipboardImage = { bytes: pastedBytes, decodedOnBothClients: true, draftPreserved: true };
  await mkdir('.local/screenshots', { recursive: true });
  await guest.locator('#sidebar').screenshot({ path: '.local/screenshots/chat-fixed-desktop.png' });
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await guest
      .locator('#chat-panel')
      .evaluate((el) => el.clientHeight >= 300 && el.clientHeight <= 420),
  );
  assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await guest
    .locator('#chat-panel')
    .screenshot({ path: '.local/screenshots/chat-fixed-mobile.png' });
  await guest.setViewportSize({ width: 1440, height: 1080 });
  assert.equal(await host.locator('#cache-options').isVisible(), false);
  await selectSource(
    host,
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  );
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
      {},
      { timeout: 30000 },
    );
  await guest.locator('#play-button').click();
  await confirmed(
    () => states.host?.playback.paused === false && states.guest?.playback.paused === false,
  );
  for (const page of [host, guest])
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
          .totalVideoFrames > 3,
    );
  await guest.locator('#play-button').click();
  await confirmed(
    () => states.host?.playback.paused === true && states.guest?.playback.paused === true,
  );
  assert.equal(await guest.locator('.danmaku-item').count(), 0);
  await host.locator('#cache-options > summary').click();
  assert.equal(await host.locator('#link-choice #cache-options').count(), 1);
  assert.equal(await host.locator('#mode-toggle').isEnabled(), true);
  await host.locator('#mode-toggle').click();
  await confirmed(() => states.host?.mode === 'cache' && states.guest?.mode === 'cache');
  await guest.locator('#cache-overlay').waitFor();
  await host.locator('#mode-toggle').click();
  await confirmed(() => states.host?.mode === 'stream' && states.guest?.mode === 'stream');
  await guest.locator('#cache-overlay').waitFor({ state: 'hidden' });
  await guest.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await choosePlayback(host, 'screen');
  assert.equal(await host.locator('#cache-options').isVisible(), false);
  await choosePlayback(host, 'link');
  proof.cacheNestedAndManual = true;
  await send(host, '实时文字与 Emoji 🍿');
  for (const page of [host, guest])
    await page.locator('.danmaku-item').filter({ hasText: '实时文字与 Emoji 🍿' }).waitFor();
  const item = guest.locator('.danmaku-item').filter({ hasText: '实时文字与 Emoji 🍿' });
  const before = await item.evaluate((el) => el.getBoundingClientRect().x);
  await guest.waitForTimeout(350);
  assert.ok((await item.evaluate((el) => el.getBoundingClientRect().x)) < before - 10);
  await guest.locator('#rate').selectOption('1.25');
  assert.equal(await item.count(), 1);
  await guest.locator('#chat-toggle').click();
  await send(host, '<img src=x onerror="window.injected=1"> 👨‍👩‍👧‍👦');
  await guest.locator('.danmaku-item').filter({ hasText: '<img src=x' }).waitFor();
  assert.equal(await guest.locator('.danmaku-layer img').count(), 0);
  await send(host, '聊天室已隐藏，弹幕仍显示 🍿');
  await guest.waitForFunction(() => {
    const el = [...document.querySelectorAll('.danmaku-item')].find(
      (el) => el.textContent === '聊天室已隐藏，弹幕仍显示 🍿',
    );
    return (
      el &&
      el.getBoundingClientRect().right <
        document.querySelector('#stage')!.getBoundingClientRect().right - 20
    );
  });
  await mkdir('.local/screenshots', { recursive: true });
  await guest.screenshot({ path: '.local/screenshots/chat-danmaku.png', fullPage: true });
  await guest.locator('#danmaku-toggle').evaluate((el) => (el as HTMLButtonElement).click());
  await send(host, '关闭期间不重放');
  await guest
    .locator('#chat-messages')
    .filter({ hasText: '关闭期间不重放' })
    .waitFor({ state: 'attached' });
  assert.equal(await guest.locator('.danmaku-item').count(), 0);
  await guest.locator('#danmaku-toggle').evaluate((el) => (el as HTMLButtonElement).click());
  assert.equal(await guest.locator('.danmaku-item').count(), 0);
  await guest.locator('#fullscreen').click();
  await guest.waitForFunction(() => document.fullscreenElement?.id === 'stage');
  await send(host, '全屏弹幕 🎬');
  await guest.locator('.danmaku-item').filter({ hasText: '全屏弹幕 🎬' }).waitFor();
  await guest.waitForFunction(() => {
    const el = [...document.querySelectorAll('.danmaku-item')].find(
      (el) => el.textContent === '全屏弹幕 🎬',
    );
    return el && el.getBoundingClientRect().right < innerWidth - 20;
  });
  assert.equal(
    await guest.evaluate(() =>
      document.fullscreenElement!.contains(document.querySelector('.danmaku-layer')),
    ),
    true,
  );
  await guest.screenshot({ path: '.local/screenshots/chat-danmaku-fullscreen.png' });
  await guest.evaluate(() => document.exitFullscreen());
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  proof.danmaku = {
    moves: true,
    emoji: true,
    historyNotReplayed: true,
    plainText: true,
    hiddenSidebar: true,
    toggle: true,
    fullscreen: true,
  };
  const deadline = Date.now() + 10000;
  while (true) {
    const rows = await Promise.all(
      [host, guest].map((page) =>
        page
          .locator('.latency[data-member]')
          .evaluateAll((nodes) =>
            Object.fromEntries(
              nodes.map((n) => [(n as HTMLElement).dataset.member, n.textContent]),
            ),
          ),
      ),
    );
    if (rows[0][ids.guest] === rows[1][ids.guest] && parseInt(String(rows[0][ids.guest])) >= 150) {
      proof.latencyRows = rows;
      break;
    }
    assert.ok(Date.now() < deadline, 'Canonical delayed RTT did not reach both clients');
    await guest.waitForTimeout(100);
  }
  await guest.waitForFunction((id) => {
    const own = document.querySelector<HTMLElement>(`.latency[data-member="${id}"]`)?.textContent;
    return own && own !== '—' && document.querySelector('#sync-status')!.textContent!.includes(own);
  }, ids.guest);
  holdProbes = true;
  await guest.waitForTimeout(16000);
  for (const page of [host, guest])
    assert.ok(
      (await page.locator('.latency[data-member]').allTextContents()).every(
        (value) => value === '—',
      ),
    );
  proof.expiredSamplesHidden = true;
  assert.deepEqual(errors, []);
  proof.errors = errors;
  proof.serverErrors = serverErrors;
  assert.deepEqual(serverErrors, []);
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} finally {
  for (const timer of timers) clearTimeout(timer);
  await browser.close();
  await app?.close();
  await writeFile('.local/chat-overlay-evidence.json', JSON.stringify(proof, null, 2));
}
