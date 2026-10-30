import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Fresh profiles, generated media, synthetic microphone. Never touches a user room.
const bytes = await readFile('.local/cache-window-fixture.mp4');
const source = createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ''),
    start = Number(range?.[1] ?? 0),
    end = Math.min(bytes.length - 1, range?.[2] ? Number(range[2]) : bytes.length - 1);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/mp4');
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  res.end(bytes.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
const movieUrl = process.env.VS_PUBLIC_URL
  ? 'https://moderation-fixture.videosreeeen.test/fixture.mp4'
  : `http://127.0.0.1:${(source.address() as any).port}/fixture.mp4`;
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
  isolated: true,
  syntheticMicrophoneOnly: true,
  production: !!process.env.VS_PUBLIC_URL,
};
try {
  const pages = [];
  const errors: string[] = [];
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    if (process.env.VS_PUBLIC_URL)
      await context.route(movieUrl, (route) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? ''),
          start = Number(range?.[1] ?? 0),
          end = Math.min(bytes.length - 1, range?.[2] ? Number(range[2]) : bytes.length - 1);
        return route.fulfill({
          status: range ? 206 : 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': String(end - start + 1),
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
          },
          body: bytes.subarray(start, end + 1),
        });
      });
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
    });
    await context.addInitScript(
      `window.__tracks = []; navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(), oscillator = ctx.createOscillator(), destination = ctx.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start(); window.__tracks.push(...destination.stream.getTracks()); return destination.stream; };`,
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    pages.push(page);
  }
  const [a, b, c] = pages as [
    (typeof pages)[number],
    (typeof pages)[number],
    (typeof pages)[number],
  ];
  await a.goto(origin);
  await a.locator('#hero-create').click();
  await a.locator('#name-input').fill('放映者');
  await a.locator('#create-button').click();
  await a.locator('#invite-dialog').waitFor();
  const invite = await a.locator('#invite-link').inputValue();
  await closeInvitation(a);
  for (const [page, name] of [
    [b, '观众乙'],
    [c, '观众丙'],
  ] as const) {
    await page.goto(invite);
    await page.locator('#name-input').fill(name);
    await page.locator('#join-button').click();
  }
  await a.locator('#member-count').filter({ hasText: '3' }).waitFor();
  await selectSource(a, movieUrl);
  await a.locator('#video').waitFor({ state: 'visible' });
  await a.locator('#play-button').click();
  await a.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.3,
  );
  await c.locator('#voice-join').click();
  await c.waitForFunction(
    () => JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!).ready,
  );
  await c.locator('#voice-mic').click();
  await c.waitForFunction(() =>
    (window as any).__tracks.some((t: MediaStreamTrack) => t.readyState === 'live'),
  );
  const height = await a.locator('#chat-panel').evaluate((e) => e.clientHeight);
  await a.getByRole('button', { name: '票选移出 观众丙', exact: true }).click();
  await a.locator('#kick-vote').waitFor();
  await b.locator('#kick-vote').waitFor();
  assert.equal(await c.locator('#kick-vote-yes').isDisabled(), true);
  assert.equal(await a.locator('#chat-panel').evaluate((e) => e.clientHeight), height);
  await a.locator('#chat-input').fill('投票期间仍可聊天');
  await a.locator('#send-button').click();
  await b.locator('#chat-messages').filter({ hasText: '投票期间仍可聊天' }).waitFor();
  const before = await a.locator('#video').evaluate((v: HTMLVideoElement) => v.currentTime);
  await a.screenshot({ path: '.local/screenshots/moderation.png', fullPage: true });
  await a.locator('#chat-panel').screenshot({ path: '.local/screenshots/room-vote.png' });
  await a.setViewportSize({ width: 390, height: 950 });
  assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await a.locator('#kick-vote-yes').isVisible());
  const mobilePanel = await a.locator('#chat-panel').boundingBox(),
    mobileSend = await a.locator('#send-button').boundingBox();
  assert.ok(
    mobilePanel &&
      mobileSend &&
      mobileSend.y + mobileSend.height <= mobilePanel.y + mobilePanel.height,
    'Poll must not push the mobile composer outside its fixed panel',
  );
  await a.locator('#chat-panel').screenshot({ path: '.local/screenshots/room-vote-mobile.png' });
  await a.setViewportSize({ width: 1440, height: 1080 });
  await b.locator('#kick-vote-yes').click();
  await a.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await c.waitForFunction(() =>
    (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'),
  );
  await c.locator('#hero-create').waitFor();
  await a.waitForTimeout(1200);
  for (const page of [a, b])
    assert.ok(
      await page
        .locator('#video')
        .evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0 && v.videoWidth > 0),
    );
  assert.ok((await a.locator('#video').evaluate((v: HTMLVideoElement) => v.currentTime)) > before);
  assert.equal(await a.locator('#kick-vote').isVisible(), false);
  assert.deepEqual(errors, []);
  Object.assign(proof, {
    passed: true,
    majorityKick: true,
    targetMicrophoneReleased: true,
    remainingVideoContinues: true,
    fixedChatHeight: true,
    chatWhileVoting: true,
  });
} catch (error) {
  proof.error = String(error);
  throw error;
} finally {
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/moderation${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
  await browser.close();
  source.closeAllConnections();
  source.close();
  await app.close();
}
