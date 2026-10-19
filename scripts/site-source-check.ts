import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Route } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, choosePlayback } from './room-ui';

const site = process.argv[2] || 'https://www.mgnacg.com/bangumi/193-3-17/';
const xifan = new URL(site).hostname === 'next.xifanacg.com';
const provider = xifan ? 'xifan' : 'mgn';
const metadataRoute = xifan
  ? 'https://api.xifanacg.com/functions/v1/issue-web-playback'
  : '**/resolve-source/**';
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
  network: process.env.VS_TEST_PROXY ? 'explicit-test-proxy' : 'system-default',
  isolatedViewerStorage: true,
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const host = await context.newPage(),
    guest = await guestContext.newPage();
  const errors: string[] = [],
    commands: string[] = [],
    serverErrors: string[] = [];
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
              if (m.type === 'error') serverErrors.push(m.code);
            } catch {}
          }
        });
    });
  }
  host.on('response', (response) => {
    if (response.url().includes(xifan ? '/functions/v1/issue-web-playback' : '/resolve-source/'))
      metadataStatus = response.status();
  });
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill(`${xifan ? '稀饭' : '蜜柑'}共同播放验证`);
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
  assert.equal(latest.media.provider, provider);
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
  // A seek while playing must continue decoding without a pause/play workaround.
  await guest.locator('#seek').evaluate((element) => {
    (element as HTMLInputElement).value = '30';
  });
  await guest.locator('#seek').dispatchEvent('change');
  for (const page of [host, guest]) {
    await page.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.currentTime >= 30 && v.currentTime < 36 && !v.seeking && !v.paused;
    });
    const before = await page
      .locator('#video')
      .evaluate((el) => (el as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
    await page.waitForFunction(
      (before) => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return v.getVideoPlaybackQuality().totalVideoFrames > before + 15 && !v.paused;
      },
      before,
      { timeout: 20000 },
    );
  }
  proof.playingSeekContinuesDecoding = true;
  if (process.env.VS_TEST_RECOVERY) {
    const network = await guestContext.newCDPSession(guest);
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    try {
      await host.locator('#seek').evaluate((el) => {
        (el as HTMLInputElement).value = '300';
        el.dispatchEvent(new Event('change'));
      });
      await guest.waitForTimeout(3500);
    } finally {
      await network.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    }
    await guest.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return !v.paused && !v.seeking && v.currentTime > 300 && v.currentTime < 325;
      },
      {},
      { timeout: 25000 },
    );
    const frames = await guest
      .locator('#video')
      .evaluate((el) => (el as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
    await guest.waitForFunction(
      (frames) =>
        document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
          .totalVideoFrames >
        frames + 15,
      frames,
      { timeout: 15000 },
    );
    await network.detach();
    proof.interruptedViewerNetworkResumesWithoutRoomPause = true;
  }
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  await guest.locator('#seek').evaluate((element) => {
    (element as HTMLInputElement).value = '5';
  });
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
  assert.equal(latest.playback.paused, true);
  assert.equal(latest.playback.position, 5);
  assert.equal(latest.playback.rate, 1.25);
  proof.authoritativeControls = { paused: true, position: 5, rate: 1.25 };
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
    if (process.env.VS_PUBLIC_URL)
      assert.equal(player.host, xifan ? 'play.xfvod.pro' : 'r2.jzacg.com');
  }
  await mkdir('.local/screenshots', { recursive: true });
  await host
    .locator('#playback-picker')
    .screenshot({ path: `.local/screenshots/${provider}-common-picker.png` });
  await guest.screenshot({
    path: `.local/screenshots/${provider}-common-playback.png`,
    fullPage: true,
  });
  // Delay just the metadata reply, then cancel by choosing a different input
  // panel. A late reply must not replace the video that is already playing.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = commands.length;
  const reply = (video = latest.media.source.video) =>
    xifan
      ? {
          ok: true,
          anime_id: 151,
          episode_id: 1986,
          expires_at: Date.now() / 1000 + 60,
          candidates: [{ source_id: 5, source_code: 'xfy2', url: video }],
        }
      : { media: { ...latest.media, title: '迟到结果不应发布', source: { kind: 'file', video } } };
  const cors: Record<string, string> = xifan
    ? {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'apikey,content-type',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      }
    : {};
  const intercept = (handler: (route: Route) => Promise<unknown>) =>
    host.route(metadataRoute, (route) =>
      xifan && route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors })
        : handler(route),
    );
  await intercept(async (route) => {
    await gate;
    await route.fulfill({ headers: cors, json: reply() }).catch(() => {});
  });
  await selectSource(host, site);
  await host.locator('#source-form[aria-busy="true"]').waitFor();
  await choosePlayback(host, 'file');
  release();
  await host.unroute(metadataRoute);
  await choosePlayback(host, 'link');
  await intercept((route) =>
    route.fulfill({ status: 422, headers: cors, json: { error: '此线路暂未识别' } }),
  );
  await selectSource(host, site);
  await host
    .locator('#link-error')
    .filter({ hasText: xifan ? 'HTTP 422' : '此线路暂未识别' })
    .waitFor();
  assert.equal(commands.length, before);
  assert.notEqual(latest.media.title, '迟到结果不应发布');
  proof.cancellationAndFailureKeepMedia = true;
  await host.unroute(metadataRoute);
  const broken = xifan
    ? 'https://play.xfvod.pro/verification-unavailable.mp4'
    : 'https://r2.jzacg.com/verification-unavailable.mp4';
  await host.route(broken, (route) => route.abort());
  await intercept((route) => route.fulfill({ headers: cors, json: reply(broken) }));
  await selectSource(host, site);
  await host
    .locator('#link-error')
    .filter({ hasText: '已识别视频地址，但当前浏览器加载失败' })
    .waitFor();
  assert.equal(
    commands.length,
    before,
    'An HTTP 200 metadata reply with unplayable video must not replace the movie',
  );
  proof.unplayableResultNotPublished = true;
  await host.unroute(metadataRoute);
  if (process.env.VS_TEST_NEXT) {
    await host.locator('#play-button').click();
    const playingDeadline = Date.now() + 15000;
    while (latest.playback.paused) {
      assert.ok(Date.now() < playingDeadline);
      await host.waitForTimeout(100);
    }
    const previous = latest.media.id;
    await host.locator('#next-episode').click();
    await host.waitForFunction(
      (previous) =>
        !document.querySelector<HTMLButtonElement>('#next-episode')!.disabled &&
        document.querySelector<HTMLInputElement>('#source-url')!.value !== previous,
      site,
      { timeout: 30000 },
    );
    const until = Date.now() + 45000;
    while (latest.media.id === previous) {
      assert.ok(Date.now() < until, 'Real next episode did not replace the current media');
      await host.waitForTimeout(100);
    }
    assert.notEqual(latest.media.url, site);
    for (const page of [host, guest])
      await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#video')!;
          return (
            v.readyState >= 2 &&
            v.videoWidth > 0 &&
            !v.paused &&
            v.currentTime > 0.5 &&
            v.currentTime < 10
          );
        },
        {},
        { timeout: 30000 },
      );
    proof.nextEpisode = { url: latest.media.url, decodedOnBothClients: true };
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  proof.errors = errors;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} finally {
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  await writeFile(`.local/${provider}-playback-evidence.json`, JSON.stringify(proof, null, 2));
}
