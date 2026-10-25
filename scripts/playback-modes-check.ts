import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { choosePlayback, closeInvitation, selectSource, playbackSettings } from './room-ui';

const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const source = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--js-flags=--max-old-space-size=96',
    '--renderer-process-limit=1',
  ],
});
const evidence: Record<string, any> = { origin, source, generatedUsersOnly: true };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const host = await context.newPage(),
    guest = await context.newPage();
  const errors: string[] = [],
    commands: string[] = [];
  for (const page of [host, guest]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) =>
      socket.on('framesent', (event) => {
        if (typeof event.payload !== 'string') return;
        try {
          const message = JSON.parse(event.payload);
          if (message.type === 'control' || message.type === 'media') commands.push(message.type);
        } catch {}
      }),
    );
  }
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('直链共同播放');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('独立播放观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  assert.equal(await host.locator('#link-choice').isVisible(), true);
  assert.equal(await host.locator('#source-form').isVisible(), true);
  assert.equal(await host.locator('#screen-choice').isVisible(), false);
  await selectSource(host, source);
  for (const page of [host, guest])
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0;
      },
      {},
      { timeout: 45000 },
    );
  await guest.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return !v.paused && v.currentTime > 0.4 && v.getVideoPlaybackQuality().totalVideoFrames > 3;
    });
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  await guest.locator('#seek').fill('1');
  await guest.locator('#seek').dispatchEvent('change');
  for (const page of [host, guest])
    await page.waitForFunction(
      () => Math.abs(document.querySelector<HTMLVideoElement>('#video')!.currentTime - 1) < 0.2,
    );
  await playbackSettings(host);
  await host.locator('#rate').selectOption('1.25');
  await playbackSettings(host, false);
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.playbackRate === 1.25,
    );
  evidence.players = [];
  for (const page of [host, guest])
    evidence.players.push(
      await page.locator('#video').evaluate((element) => {
        const v = element as HTMLVideoElement;
        return {
          source: v.currentSrc,
          stream: !!v.srcObject,
          paused: v.paused,
          time: v.currentTime,
          rate: v.playbackRate,
          width: v.videoWidth,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
        };
      }),
    );
  if (process.env.VS_PUBLIC_URL)
    for (const player of evidence.players)
      assert.equal(
        player.source,
        source,
        'Each browser must load the original video without re-encoding or server relay',
      );
  const before = commands.length;
  for (const mode of ['screen', 'file', 'link'] as const) {
    await choosePlayback(host, mode);
    assert.equal(await host.locator('#' + mode + '-choice').isVisible(), true);
  }
  assert.equal(
    commands.length,
    before,
    'Picking a panel must not replace or pause the current video',
  );
  await host.locator('#choose-link').focus();
  await host.keyboard.press('Home');
  assert.equal(await host.locator('#choose-link').getAttribute('aria-selected'), 'true');
  await host.keyboard.press('End');
  assert.equal(await host.locator('#choose-file').getAttribute('aria-selected'), 'true');
  await choosePlayback(host, 'link');
  await host.locator('#source-url').fill('https://unsupported.example/video/1');
  await host.locator('#source-form button').click();
  await host.locator('#link-error').filter({ hasText: '原站页面' }).waitFor();
  assert.equal(
    commands.length,
    before,
    'Unsupported site input must not replace the working source',
  );
  assert.equal(await host.locator('#provide-dialog').isVisible(), false);
  assert.equal(await host.locator('#current-playback').textContent(), '当前：共同播放');
  await mkdir('.local/screenshots', { recursive: true });
  await host.locator('#source-url').fill(source);
  for (const mode of ['screen', 'link', 'file'] as const) {
    await choosePlayback(host, mode);
    await host
      .locator('#playback-picker')
      .screenshot({ path: `.local/screenshots/modes-${mode}.png` });
  }
  await choosePlayback(guest, 'link');
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await guest
    .locator('#playback-picker')
    .screenshot({ path: '.local/screenshots/modes-mobile.png' });
  assert.deepEqual(errors, []);
  evidence.controls = {
    playPauseBothDirections: true,
    seekActualVideo: true,
    rateActualVideo: true,
    modeSelectionKeepsMedia: true,
    unsupportedPageKeepsMedia: true,
    keyboardTabs: true,
    mobileFits: true,
  };
  evidence.errors = errors;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/playback-modes-evidence.json', JSON.stringify(evidence, null, 2));
}
