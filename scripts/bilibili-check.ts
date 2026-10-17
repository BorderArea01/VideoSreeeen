import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { createApp } from '../server/index';
import { configureRoomServer, openRoom, closeInvitation } from './room-ui';

// Public user-reported video; never store its media URLs, responses or bytes in the repository.
const source = 'https://www.bilibili.com/video/BV13Aa66LEAW/';
const local = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (local) {
  local.server.listen(0, '127.0.0.1');
  await once(local.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL ?? `http://127.0.0.1:${(local!.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
const evidence: Record<string, any> = { version: '0.3.1', origin, source };
try {
  desktop = await electron.launch({
    args: ['desktop/main.cjs', '--mute-audio'],
    env: { ...process.env, VS_DEV_URL: origin },
    timeout: 30000,
  });
  const seed = await desktop.firstWindow(),
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    receiver = await context.newPage();
  let invite = '',
    state: any;
  const failures: string[] = [];
  for (const page of [seed, receiver]) page.on('pageerror', (e) => failures.push(e.message));
  seed.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      try {
        const m = JSON.parse(String(event.payload));
        if (m.type === 'welcome') invite = origin + '/#' + m.room.invite;
        if (m.room) state = m.room;
      } catch {}
    }),
  );
  await configureRoomServer(seed, origin);
  await openRoom(seed);
  await seed.locator('#name-input').fill('原站客户端');
  await seed.locator('#create-button').click();
  await closeInvitation(seed);
  await receiver.goto(invite);
  await openRoom(receiver, 'join');
  await receiver.locator('#name-input').fill('网页成员');
  await receiver.locator('#join-button').click();
  await receiver.locator('#connection.online').waitFor();
  await seed.locator('#source-url').fill(source);
  await seed.locator('#source-form button').click();
  // No click on the extraction button: the real native player must attach its source automatically.
  await receiver.locator('#mode-toggle:not([disabled])').waitFor({ timeout: 45000 });
  assert.ok(state.media.source);
  evidence.automaticSource = {
    kind: state.media.source.kind,
    duration: state.media.duration,
    videoPort: new URL(state.media.source.video).port,
    audioPort: state.media.source.audio ? new URL(state.media.source.audio).port : undefined,
  };
  const original = await seed.evaluate(() => window.desktop!.call('sampleSite'));
  assert.equal(original.available, true, 'Native member keeps the original player after sharing');
  evidence.nativeOriginalPlayerPreserved = true;
  await receiver.waitForFunction(
    () =>
      document.querySelector('video')!.readyState >= 2 ||
      !document.querySelector('#browser-hint')!.hasAttribute('hidden'),
    {},
    { timeout: 20000 },
  );
  evidence.browserDirect = {
    readyState: await receiver.locator('video').evaluate((v) => (v as HTMLVideoElement).readyState),
    fallbackVisible: await receiver.locator('#browser-cache').isVisible(),
  };
  if (evidence.browserDirect.readyState < 2) {
    assert.equal(evidence.browserDirect.fallbackVisible, true);
    await receiver.locator('#browser-cache').click();
  } else await receiver.locator('#mode-toggle').click();
  await seed.locator('#cache-button:not([disabled])').click();
  await seed.waitForFunction(
    () => document.querySelector('#cache-title')!.textContent === '本机已准备好',
    {},
    { timeout: 90000 },
  );
  evidence.nativeCache = await seed.locator('#cache-description').textContent();
  const media = state.media.source;
  const urls = [media.video, media.audio].filter(Boolean).map((s: string) => new URL(s));
  let blocked = 0;
  await receiver.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.startsWith('/media/') ||
      urls.some((u) => u.origin === url.origin && u.pathname === url.pathname)
    ) {
      blocked++;
      return route.abort();
    }
    return route.continue();
  });
  await receiver.locator('#cache-button:not([disabled])').click();
  await receiver.waitForFunction(
    () => document.querySelector('#cache-title')!.textContent === '本机已准备好',
    {},
    { timeout: 60000 },
  );
  const description = await receiver.locator('#cache-description').textContent();
  assert.match(description!, /源站 0\.0 MiB/);
  await receiver.waitForFunction(
    () => document.querySelector('video')!.readyState >= 2,
    {},
    { timeout: 15000 },
  );
  await receiver.locator('#play-button').click();
  await receiver.waitForFunction(() => document.querySelector('video')!.currentTime > 1);
  await receiver.locator('#play-button').click();
  await receiver.waitForFunction(() => document.querySelector('video')!.paused);
  const a = await seed.locator('video').evaluate((node) => {
      const v = node as HTMLVideoElement;
      return { time: v.currentTime, paused: v.paused, duration: v.duration };
    }),
    b = await receiver.locator('video').evaluate((v) => ({
      time: (v as HTMLVideoElement).currentTime,
      paused: (v as HTMLVideoElement).paused,
      duration: (v as HTMLVideoElement).duration,
      audioTime: document.querySelector('audio')!.currentTime,
    }));
  assert.ok(a.time > 0 && b.time > 1 && Math.abs(a.time - b.time) < 1);
  assert.ok(Math.abs(b.time - b.audioTime) < 0.5, 'DASH audio follows video');
  evidence.cachedPlayback = { description, blockedOriginRequests: blocked, windows: a, browser: b };
  await mkdir('.local/screenshots', { recursive: true });
  await receiver.screenshot({
    path: resolve('.local/screenshots/bilibili-cached-browser.png'),
    fullPage: true,
  });
  // Use the genuine media duration and natural ended events to verify the shared cleanup barrier.
  await receiver.locator('#seek').evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, b.duration - 0.8);
  // Wait for the server's seek acknowledgement before issuing the next
  // revision-based command; public RTT is longer than the local test's RTT.
  await receiver.waitForFunction(() => {
    const v = document.querySelector('video')!;
    return v.paused && v.currentTime > v.duration - 1.4;
  });
  await receiver.locator('#play-button').click();
  for (const page of [seed, receiver])
    await page.waitForFunction(
      () =>
        document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
      {},
      { timeout: 20000 },
    );
  evidence.cleanup = true;
  assert.deepEqual(failures, []);
  evidence.pageErrors = failures;
  await seed.locator('#leave-button').click();
  await receiver.locator('#leave-button').click();
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await desktop?.close();
  await browser.close();
  await local?.close();
  await writeFile('.local/bilibili-evidence.json', JSON.stringify(evidence, null, 2));
}
