import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, devices, type Route } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Real API/CDN and a mobile browser profile on Windows. Fault injection is
// confined to this test viewer; this is not Android device/network evidence.
const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const original = 'https://next.xifanacg.com/anime/3434/play/203799?source=AL';
const cc0 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const endpoint = 'https://api.xifanacg.com/functions/v1/issue-web-playback';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=96',
  ],
});
const proof: Record<string, any> = {
  origin,
  original,
  mobileProfile: 'Pixel 7',
  realAndroidDevice: false,
  videoProxy: false,
};
try {
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext(devices['Pixel 7']);
  if (app)
    for (const context of [ownerContext, viewerContext])
      await context.route(origin + '/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
      });
  const owner = await ownerContext.newPage(),
    viewer = await viewerContext.newPage();
  let latest: any;
  const commands: string[] = [],
    errors: string[] = [];
  for (const page of [owner, viewer]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (socket) => {
      socket.on('framereceived', (event) => {
        try {
          const m = JSON.parse(String(event.payload));
          if (m.room) latest = m.room;
        } catch {}
      });
      if (page === viewer)
        socket.on('framesent', (event) => {
          try {
            const m = JSON.parse(String(event.payload));
            if (['media', 'control'].includes(m.type)) commands.push(m.type);
          } catch {}
        });
    });
  }
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('本机恢复提供者');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  await selectSource(owner, original);
  await owner.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    {},
    { timeout: 30000 },
  );
  const blocked = 'https://play.xfvod.pro:8088/**';
  await viewer.route(blocked, (route) => route.abort('failed'));
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('手机视口故障观众');
  await viewer.locator('#join-button').click();
  await viewer.locator('#retry-video').waitFor();
  await mkdir('.local/screenshots', { recursive: true });
  await viewer.screenshot({
    path: '.local/screenshots/local-playback-error-mobile.png',
    fullPage: true,
  });
  assert.equal(
    await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  assert.equal(await viewer.locator('#play-button').isVisible(), false);
  const mediaId = latest.media.id,
    revision = latest.playback.revision;
  await viewer.locator('#retry-video').click();
  await viewer.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('#retry-video')!.disabled,
  );
  assert.equal(await viewer.locator('#browser-hint').isVisible(), true);
  await viewer.locator('#copy-playback-diagnostics').click();
  await viewer.locator('#video-diagnostics-output').waitFor();
  const diagnostic = JSON.parse(await viewer.locator('#video-diagnostics-output').inputValue());
  assert.equal(diagnostic.player.transport, 'direct');
  assert.equal(diagnostic.player.error.code, 4);
  assert.equal(diagnostic.player.source.port, '8088');
  assert.doesNotMatch(JSON.stringify(diagnostic), /\/S\/|\.mp4|qrcode_key|SESSDATA/);
  await viewer.locator('[data-close="settings-dialog"]').first().click();
  await viewer.unroute(blocked);
  await viewer.locator('#retry-video').click();
  await viewer.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2 &&
      document.querySelector('#browser-hint')!.hasAttribute('hidden'),
    {},
    { timeout: 30000 },
  );
  assert.equal(latest.media.id, mediaId);
  assert.equal(latest.playback.revision, revision);
  assert.deepEqual(commands, []);
  await owner.locator('#play-button').click();
  await viewer.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
        .totalVideoFrames > 12,
    {},
    { timeout: 20000 },
  );
  proof.failedRetryThenRecovery = true;
  proof.retryKeepsRoomMediaAndPlaybackRevision = true;
  proof.diagnostics = {
    error: diagnostic.player.error,
    source: diagnostic.player.source,
    transport: diagnostic.player.transport,
    codecs: diagnostic.player.codecs,
  };
  // Break this viewer again, then hold just its refresh. A real room media
  // replacement must abort that refresh and prevent stale video restoration.
  await viewer.route(blocked, (route) => route.abort('failed'));
  await viewer.locator('#video').evaluate((v: HTMLVideoElement) => v.load());
  await viewer.locator('#retry-video').waitFor();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    requested = new Promise<void>((r) => (started = r));
  await viewer.route(endpoint, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.continue();
      return;
    }
    started();
    await gate;
    await route.abort().catch(() => {});
  });
  await viewer.locator('#retry-video').click();
  await requested;
  await viewer.unroute(blocked);
  await selectSource(owner, cc0);
  await viewer.waitForFunction(
    (url) => document.querySelector<HTMLVideoElement>('#video')!.currentSrc === url,
    cc0,
    { timeout: 20000 },
  );
  release();
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  assert.equal(latest.media.url, cc0);
  assert.equal(await viewer.locator('#browser-hint').isVisible(), false);
  assert.deepEqual(commands, []);
  proof.mediaChangeCancelsLocalRetry = true;
  proof.errors = errors;
  assert.deepEqual(errors, []);
  await mkdir('.local/screenshots', { recursive: true });
  await viewer.screenshot({
    path: '.local/screenshots/local-playback-retry-mobile.png',
    fullPage: true,
  });
  await owner.locator('#leave-button').click();
  await viewer.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} finally {
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/playback-retry-evidence.json', JSON.stringify(proof, null, 2));
}
