import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { createApp } from '../server/index';
import { configureRoomServer, closeInvitation, openRoom, selectSource } from './room-ui';
import { waitForNativeSample } from './native-sample';

// Real Windows original-site bridge, with a local page hosting a public CC0
// video. This validates the bridge, not third-party login/site compatibility.
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
const site = createServer((_req, res) =>
  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(
      '<!doctype html><title>原站同步样片</title><video controls playsinline preload="auto" style="width:100%;height:100%" src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"></video>',
    ),
);
site.listen(0, '127.0.0.1');
await once(site, 'listening');
const source = `http://127.0.0.1:${(site.address() as any).port}/watch`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
const evidence: Record<string, any> = { originalSite: 'local-cc0-page', actualWindowsBridge: true };
try {
  await mkdir('.local', { recursive: true });
  const profile = await mkdtemp(resolve('.local/native-sync-'));
  const entry = join(profile, 'entry.cjs');
  await writeFile(
    entry,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(resolve('desktop/main.cjs'))});`,
  );
  desktop = await electron.launch({
    ...(process.env.VS_PACKAGED_EXE ? { executablePath: process.env.VS_PACKAGED_EXE } : {}),
    args: [process.env.VS_PACKAGED_EXE ? '--user-data-dir=' + profile : entry, '--mute-audio'],
    env: { ...process.env, VS_DEV_URL: process.env.VS_PACKAGED_EXE ? '' : origin },
  });
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  evidence.packaged = !!process.env.VS_PACKAGED_EXE;
  const host = await desktop.firstWindow(),
    context = await browser.newContext(),
    guest = await context.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  await configureRoomServer(host, origin);
  await openRoom(host);
  await host.locator('#name-input').fill('Windows 原站共同播放');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('网页共同播放');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await selectSource(host, source);
  await waitForNativeSample(host, (s) => s.available, 45000);
  await guest.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    {},
    { timeout: 45000 },
  );
  await guest.locator('#play-button').click();
  await waitForNativeSample(host, (s) => s.available && !s.paused && (s.position ?? 0) > 0.3);
  await guest.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
        .totalVideoFrames > 3,
  );
  await guest.locator('#play-button').click();
  await waitForNativeSample(host, (s) => s.paused === true);
  await guest.locator('#seek').fill('1');
  await guest.locator('#seek').dispatchEvent('change');
  await waitForNativeSample(host, (s) => Math.abs((s.position ?? -1) - 1) < 0.2);
  await guest.locator('#rate').selectOption('1.5');
  await waitForNativeSample(host, (s) => s.rate === 1.5);
  evidence.stability = await host.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const s = await window.desktop!.call('sampleSite');
      samples.push({ paused: s.paused, time: s.position, rate: s.rate });
    }
    return samples;
  });
  evidence.room = [...app.rooms.rooms.values()][0]!.playback;
  assert.ok(
    evidence.stability.every((s: any) => s.paused && Math.abs(s.time - 1) < 0.2 && s.rate === 1.5),
    'Original player must keep the requested rate and position',
  );
  const sample = await host.evaluate(() => window.desktop!.call('sampleSite'));
  evidence.original = {
    available: sample.available,
    paused: sample.paused,
    time: sample.position,
    rate: sample.rate,
    duration: sample.duration,
  };
  evidence.viewer = await guest.locator('#video').evaluate((element) => {
    const v = element as HTMLVideoElement;
    return {
      paused: v.paused,
      time: v.currentTime,
      rate: v.playbackRate,
      width: v.videoWidth,
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
    };
  });
  assert.equal(
    [...app.rooms.rooms.values()][0]!.media?.broadcast,
    undefined,
    'Common playback must not capture or re-encode the original page',
  );
  assert.equal(await host.locator('#current-playback').textContent(), '当前：共同播放');
  await desktop.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow())!;
    main.show();
    main.focus();
  });
  const caption = '原站独立弹幕 🍿';
  await guest.locator('#chat-input').fill(caption);
  await guest.locator('#send-button').click();
  const until = Date.now() + 15000;
  let overlay: import('playwright').Page | undefined;
  while (!overlay) {
    overlay = desktop.windows().find((p) => p.url().endsWith('/shared/danmaku.html'));
    assert.ok(Date.now() < until, 'Native overlay did not open');
    if (!overlay) await host.waitForTimeout(100);
  }
  await overlay.waitForFunction((text) => {
    const el = [...document.querySelectorAll('.danmaku-item')].find((n) => n.textContent === text);
    return el && el.getBoundingClientRect().right < innerWidth - 20;
  }, caption);
  assert.equal(
    await desktop.evaluate(
      async ({ webContents }, input) => {
        const original = webContents.getAllWebContents().find((w) => w.getURL() === input.source)!;
        return original.executeJavaScript(
          'document.body.innerText.includes(' + JSON.stringify(input.caption) + ')',
        );
      },
      { source, caption },
    ),
    false,
  );
  await mkdir('.local/screenshots', { recursive: true });
  await overlay.screenshot({ path: '.local/screenshots/native-danmaku.png' });
  await host.locator('#danmaku-native-toggle').click();
  await overlay.waitForFunction(
    () => document.querySelectorAll('.danmaku-item').length === 0,
    {},
    { polling: 100 },
  );
  evidence.danmaku = {
    independentLocalWindow: true,
    originalPageContainsNoChat: true,
    toggleClears: true,
  };
  await mkdir('.local/screenshots', { recursive: true });
  await host.screenshot({ path: '.local/screenshots/native-common-playback.png', fullPage: true });
  // The native WebContentsView is a separate surface, absent from renderer-only
  // screenshots. Capture only our owned fixture's surface as additional proof.
  const sourceImage = await desktop.evaluate(async ({ webContents }, url) => {
    const source = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    return (await source.capturePage()).toPNG().toString('base64');
  }, source);
  await writeFile(
    '.local/screenshots/native-common-source.png',
    Buffer.from(sourceImage, 'base64'),
  );
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  console.log(JSON.stringify(evidence));
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
} finally {
  await desktop?.close();
  await browser.close();
  await app.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await writeFile('.local/native-sync-evidence.json', JSON.stringify(evidence, null, 2));
}
