import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, choosePlayback } from './room-ui';

const site = 'https://www.mgnacg.com/bangumi/193-3-17/';
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
  ...(process.env.VS_TEST_PROXY
    ? {
        proxy: {
          server: process.env.VS_TEST_PROXY,
          bypass: 'localhost,127.0.0.1,*.mgnacg.com,*.mknacg.top,*.jzacg.com',
        },
      }
    : {}),
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--js-flags=--max-old-space-size=96',
    '--renderer-process-limit=1',
  ],
});
const proof: Record<string, any> = {
  origin,
  page: site,
  realSite: true,
  screenCapture: false,
  sourceHttpProxy: !!app,
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const host = await context.newPage(),
    guest = await context.newPage();
  const errors: string[] = [],
    commands: string[] = [];
  let latest: any,
    metadataStatus = 0;
  for (const page of [host, guest]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) => {
      socket.on('framesent', (event) => {
        if (typeof event.payload === 'string') {
          try {
            const m = JSON.parse(event.payload);
            if (m.type === 'media') commands.push(m.media.title);
          } catch {}
        }
      });
      if (page === host)
        socket.on('framereceived', (event) => {
          if (typeof event.payload === 'string') {
            try {
              const m = JSON.parse(event.payload);
              if (m.room) latest = m.room;
            } catch {}
          }
        });
    });
  }
  host.on('response', (response) => {
    if (response.url().includes('/resolve-source/')) metadataStatus = response.status();
  });
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('蜜柑共同播放验证');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('原站源独立播放');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  const began = Date.now();
  await selectSource(host, site);
  try {
    await host
      .locator('#current-playback')
      .filter({ hasText: '当前：共同播放' })
      .waitFor({ timeout: 20000 });
  } catch (error) {
    proof.resolutionError = await host.locator('#link-error').textContent();
    proof.metadataStatus = metadataStatus;
    throw error;
  }
  proof.resolvedMs = Date.now() - began;
  assert.equal(metadataStatus, 200);
  assert.equal(latest.media.url, site);
  assert.equal(latest.media.provider, 'mgn');
  assert.ok(latest.media.source);
  assert.equal(latest.media.broadcast, undefined);
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
      {},
      { timeout: 30000 },
    );
  await guest.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
          .totalVideoFrames > 8,
      {},
      { timeout: 20000 },
    );
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  await guest.locator('#seek').fill('5');
  await guest.locator('#seek').dispatchEvent('change');
  for (const page of [host, guest])
    await page.waitForFunction(
      () => Math.abs(document.querySelector<HTMLVideoElement>('#video')!.currentTime - 5) < 0.25,
    );
  await host.locator('#rate').selectOption('1.25');
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.playbackRate === 1.25,
    );
  proof.players = [];
  for (const page of [host, guest])
    proof.players.push(
      await page.locator('#video').evaluate((element) => {
        const v = element as HTMLVideoElement;
        return {
          host: new URL(v.currentSrc).hostname,
          width: v.videoWidth,
          height: v.videoHeight,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
          audioBytes: (v as any).webkitAudioDecodedByteCount,
          duration: v.duration,
          time: v.currentTime,
          rate: v.playbackRate,
          paused: v.paused,
          stream: !!v.srcObject,
        };
      }),
    );
  for (const player of proof.players) {
    assert.equal(player.width, 1920);
    assert.equal(player.stream, false);
    assert.ok(player.audioBytes > 0);
    if (process.env.VS_PUBLIC_URL) assert.equal(player.host, 'r2.jzacg.com');
  }
  await mkdir('.local/screenshots', { recursive: true });
  await host
    .locator('#playback-picker')
    .screenshot({ path: '.local/screenshots/mgn-common-picker.png' });
  await guest.screenshot({ path: '.local/screenshots/mgn-common-playback.png', fullPage: true });
  // Delay just the metadata reply, then cancel by choosing a different input
  // panel. A late reply must not replace the video that is already playing.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = commands.length;
  await host.route('**/resolve-source/**', async (route) => {
    await gate;
    await route
      .fulfill({ json: { media: { ...latest.media, title: '迟到结果不应发布' } } })
      .catch(() => {});
  });
  await selectSource(host, site);
  await host.locator('#source-form[aria-busy="true"]').waitFor();
  await choosePlayback(host, 'file');
  release();
  await host.unroute('**/resolve-source/**');
  await choosePlayback(host, 'link');
  await host.route('**/resolve-source/**', (route) =>
    route.fulfill({ status: 422, json: { error: '此线路暂未识别' } }),
  );
  await selectSource(host, site);
  await host.locator('#link-error').filter({ hasText: '此线路暂未识别' }).waitFor();
  assert.equal(commands.length, before);
  assert.notEqual(latest.media.title, '迟到结果不应发布');
  proof.cancellationAndFailureKeepMedia = true;
  await host.unroute('**/resolve-source/**');
  assert.deepEqual(errors, []);
  proof.errors = errors;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} finally {
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/mgn-playback-evidence.json', JSON.stringify(proof, null, 2));
}
