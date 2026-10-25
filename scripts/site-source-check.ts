import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, _electron as electron, type Route } from 'playwright';
import { createApp } from '../server/index';
import {
  closeInvitation,
  selectSource,
  choosePlayback,
  playbackSettings,
  configureRoomServer,
} from './room-ui';

const site = process.argv[2] || 'https://www.mgnacg.com/bangumi/193-3-17/';
const xifan = new URL(site).hostname === 'next.xifanacg.com';
const bilibili = new URL(site).hostname === 'www.bilibili.com';
const nativeBili = process.env.VS_NATIVE_BILI === '1';
assert.ok(!nativeBili || bilibili, 'Native public source mode is only for Bilibili');
const provider = xifan ? 'xifan' : bilibili ? 'bilibili' : 'mgn';
const sourceCode = new URL(site).searchParams.get('source');
const xifanSourceId = new Map([
  ['AL', 1],
  ['xfy2', 5],
  ['xfxf1', 4],
]).get(sourceCode!);
const expectedCdn = xifan
  ? sourceCode === 'xfxf1'
    ? 'apn.moedot.net'
    : 'play.xfvod.pro'
  : 'r2.jzacg.com';
if (xifan) assert.ok(xifanSourceId, 'The test needs an observed original-site source ID');
const directMedia = process.env.VS_TEST_DIRECT_MEDIA === '1';
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
  sourceHttpProxy: !!app && !directMedia,
  localConfigUsesDirectCdn: !!app && directMedia,
  network: process.env.VS_TEST_PROXY ? 'explicit-test-proxy' : 'system-default',
  isolatedViewerStorage: true,
  nativeBili,
};
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  if (nativeBili) {
    await mkdir('.local', { recursive: true });
    const profile = await mkdtemp(resolve('.local/bili-web-native-'));
    const entry = join(profile, 'entry.cjs');
    await writeFile(
      entry,
      `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(resolve('desktop/main.cjs'))});`,
    );
    desktop = await electron.launch({
      ...(process.env.VS_PACKAGED_EXE ? { executablePath: process.env.VS_PACKAGED_EXE } : {}),
      args: [
        ...(process.env.VS_PACKAGED_EXE ? [] : [entry]),
        '--user-data-dir=' + profile,
        '--mute-audio',
        ...(process.env.VS_TEST_PROXY ? ['--proxy-server=' + process.env.VS_TEST_PROXY] : []),
      ],
      env: { ...process.env, VS_DEV_URL: process.env.VS_PACKAGED_EXE ? '' : origin },
    });
    desktop.process().on('exit', (code, signal) => {
      proof.nativeExit = { code, signal };
    });
  }
  const context = desktop
    ? desktop.context()
    : await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  if (app && directMedia)
    for (const currentContext of [context, guestContext])
      await currentContext.route(origin + '/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
      });
  const host = desktop ? await desktop.firstWindow() : await context.newPage(),
    guest = await guestContext.newPage();
  if (desktop)
    await desktop.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.setBackgroundThrottling(false);
        win.hide();
      }
    });
  const errors: string[] = [],
    commands: string[] = [],
    serverErrors: string[] = [];
  const mediaResponses: Record<string, unknown>[] = [];
  proof.mediaResponses = mediaResponses;
  const controls: Record<string, unknown>[] = [];
  proof.controls = controls;
  let latest: any,
    metadataStatus = 0;
  const timeline: Record<string, unknown>[] = [];
  proof.timeline = timeline;
  for (const page of [host, guest]) {
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'media' || mediaResponses.length >= 40) return;
      const headers = response.headers();
      mediaResponses.push({
        client: page === host ? 'host' : 'guest',
        host: new URL(response.url()).host,
        status: response.status(),
        fromServiceWorker: response.fromServiceWorker(),
        range: response.request().headers().range,
        contentRange: headers['content-range'],
        contentType: headers['content-type'],
      });
    });
    await page.addInitScript(() => {
      (window as any).__playbackEvents = [];
      for (const name of ['seeking', 'seeked', 'waiting', 'playing', 'stalled', 'error'])
        document.addEventListener(
          name,
          (event) => {
            const video = event.target as HTMLVideoElement;
            if (video.id !== 'video') return;
            const events = (window as any).__playbackEvents;
            events.push({
              event: name,
              at: performance.now(),
              time: video.currentTime,
              ready: video.readyState,
              paused: video.paused,
            });
            if (events.length > 24) events.shift();
          },
          true,
        );
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) => {
      socket.on('framesent', (event) => {
        if (typeof event.payload === 'string') {
          try {
            const m = JSON.parse(event.payload);
            if (m.type === 'media') commands.push(m.media.title);
            if (m.type === 'control')
              controls.push({ client: page === host ? 'host' : 'guest', action: m.action });
          } catch {}
        }
      });
      if (page === host)
        socket.on('framereceived', (event) => {
          if (typeof event.payload === 'string') {
            try {
              const m = JSON.parse(event.payload);
              if (m.room) {
                const changed =
                  latest?.media?.id !== m.room.media?.id ||
                  latest?.playback?.revision !== m.room.playback.revision;
                latest = m.room;
                if (changed && timeline.length < 40)
                  timeline.push({
                    media: commands.length,
                    revision: latest.playback.revision,
                    paused: latest.playback.paused,
                    intent: latest.playback.intent,
                  });
              }
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
  if (!desktop) await host.goto(origin);
  else {
    await host.locator('#hero-create').waitFor();
    await configureRoomServer(host, origin);
  }
  await host.locator('#hero-create').click();
  await host
    .locator('#name-input')
    .fill(`${xifan ? '稀饭' : bilibili ? 'B站' : '蜜柑'}共同播放验证`);
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
  if (xifan && sourceCode === 'xfxf1') {
    for (const page of [host, guest])
      await page.waitForFunction(() =>
        navigator.serviceWorker.controller?.scriptURL.endsWith('/public-video-sw.js'),
      );
    proof.publicVideoWorkerControlsBothClients = true;
  }
  if (!nativeBili) assert.equal(metadataStatus, 200);
  else {
    assert.equal(metadataStatus, 0, 'Windows must resolve on this PC, not on Cloudflare');
    assert.equal(await host.locator('#native-stage').isVisible(), false);
    assert.equal(await host.locator('#bili-login-button').isVisible(), false);
    assert.equal(await host.locator('#extract-button').isVisible(), false);
    assert.equal(latest.media.source.bilibiliHtml5, true);
    proof.hostLocalMetadata = true;
  }
  assert.equal(latest.media.url, site);
  assert.equal(latest.media.provider, provider);
  assert.ok(latest.media.source);
  assert.equal(latest.media.broadcast, undefined);
  try {
    for (const page of [host, guest])
      await page.waitForFunction(
        () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
        {},
        { timeout: 30000 },
      );
  } catch (cause) {
    proof.initialPlayers = [];
    for (const page of [host, guest])
      proof.initialPlayers.push(
        await page.locator('#video').evaluate((el) => {
          const v = el as HTMLVideoElement;
          return {
            readyState: v.readyState,
            network: v.networkState,
            error: v.error?.code,
            hidden: v.hidden,
            paused: v.paused,
          };
        }),
      );
    throw cause;
  }
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
    element.dispatchEvent(new Event('change'));
  });
  for (const page of [host, guest]) {
    await page.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.currentTime >= 30 && !v.seeking && !v.paused;
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
  if (sourceCode === 'xfxf1' || bilibili) {
    const sample = async () => {
      const samples = [];
      for (const page of [host, guest])
        samples.push(
          await page.locator('#video').evaluate((el) => {
            const v = el as HTMLVideoElement;
            return { time: v.currentTime, frames: v.getVideoPlaybackQuality().totalVideoFrames };
          }),
        );
      return samples;
    };
    const before = await sample();
    await host.waitForTimeout(10000);
    const after = await sample();
    for (let i = 0; i < after.length; i++) {
      assert.ok(after[i]!.time - before[i]!.time >= 8, 'Playback stalled during the watch window');
      assert.ok(after[i]!.frames - before[i]!.frames > 100);
    }
    proof.continuousPlayback = { windowMs: 10000, before, after };
  }
  if (process.env.VS_TEST_RECOVERY) {
    // Context-level offline also affects media fetched by its service worker.
    await guestContext.setOffline(true);
    try {
      await host.locator('#seek').evaluate((el) => {
        (el as HTMLInputElement).value = '300';
        el.dispatchEvent(new Event('change'));
      });
      await guest.waitForTimeout(3500);
    } finally {
      await guestContext.setOffline(false);
    }
    await guest.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return !v.paused && !v.seeking && v.currentTime > 300;
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
    proof.interruptedViewerNetworkResumesWithoutRoomPause = true;
  }
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  await guest.locator('#seek').evaluate((element) => {
    (element as HTMLInputElement).value = '5';
    element.dispatchEvent(new Event('change'));
  });
  for (const page of [host, guest])
    await page.waitForFunction(
      () => Math.abs(document.querySelector<HTMLVideoElement>('#video')!.currentTime - 5) < 0.25,
    );
  await playbackSettings(host);
  await host.locator('#rate').selectOption('1.25');
  await playbackSettings(host, false);
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.playbackRate === 1.25,
    );
  assert.equal(latest.playback.paused, true);
  assert.equal(latest.playback.position, 5);
  assert.equal(latest.playback.rate, 1.25);
  proof.authoritativeControls = { paused: true, position: 5, rate: 1.25 };
  if (bilibili) {
    const mediaId = latest.media.id,
      epoch = latest.epoch,
      before = commands.length,
      controlCount = controls.length;
    await guest.locator('#video').evaluate((v) => {
      Object.defineProperty(v, 'error', { configurable: true, value: { code: 2 } });
      v.dispatchEvent(new Event('error'));
      delete (v as any).error;
    });
    await guest.locator('#retry-video').click();
    await guest.locator('#retry-video').waitFor({ state: 'hidden' });
    assert.equal(latest.media.id, mediaId);
    assert.equal(latest.epoch, epoch);
    assert.equal(commands.length, before);
    assert.equal(controls.length, controlCount);
    proof.localRetryDoesNotChangeRoom = true;
    proof.hasAccountSession = [];
    for (const ctx of [context, guestContext])
      proof.hasAccountSession.push((await ctx.cookies()).some((c) => c.name === 'SESSDATA'));
    assert.deepEqual(proof.hasAccountSession, [false, false]);
  }
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
    if (bilibili) assert.ok(player.width > 0 && player.height > 0);
    else assert.equal(player.width, 1920);
    assert.equal(player.stream, false);
    assert.ok(player.audioBytes > 0);
    if (process.env.VS_PUBLIC_URL || directMedia) {
      if (bilibili) assert.match(player.host, /^[a-z0-9-]+\.bilivideo\.com$/);
      else assert.equal(player.host, expectedCdn);
    }
  }
  await mkdir('.local/screenshots', { recursive: true });
  if (desktop)
    await desktop.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.showInactive();
    });
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
  // Browser metadata failure/cancellation is checked separately. The native
  // path uses cancellable privileged IPC, never this HTTP metadata endpoint.
  if (!nativeBili) {
    const reply = (video = latest.media.source.video) =>
      xifan
        ? {
            ok: true,
            anime_id: Number(new URL(site).pathname.split('/')[2]),
            episode_id: Number(new URL(site).pathname.split('/')[4]),
            expires_at: Date.now() / 1000 + 60,
            candidates: [
              {
                source_id: xifanSourceId,
                source_code: sourceCode,
                url: video,
              },
            ],
          }
        : {
            media: { ...latest.media, title: '迟到结果不应发布', source: { kind: 'file', video } },
          };
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
    const broken = `https://${expectedCdn}/verification-unavailable.mp4`;
    await context.route(broken, (route) => route.abort());
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
  } else {
    const cancelled = await host.evaluate(async (url) => {
      const id = crypto.randomUUID();
      const request = window.desktop!.call('publicBilibili', { action: 'resolve', id, url }).then(
        () => false,
        () => true,
      );
      await window.desktop!.call('publicBilibili', { action: 'cancel', id });
      return request;
    }, site);
    assert.equal(cancelled, true);
    await assert.rejects(
      host.evaluate(() =>
        window.desktop!.call('publicBilibili', {
          action: 'resolve',
          id: crypto.randomUUID(),
          url: 'https://127.0.0.1/private',
        }),
      ),
    );
    assert.equal(commands.length, before);
    proof.nativeCancellationAndRestrictedUrls = true;
    const previous = latest.media.id;
    await selectSource(host, site);
    await host.locator('#source-form[aria-busy="true"]').waitFor();
    await choosePlayback(host, 'file');
    await host.waitForTimeout(1000);
    assert.equal(latest.media.id, previous);
    assert.equal(commands.length, before);
    proof.nativeCancelledUiKeepsMedia = true;
    await choosePlayback(host, 'link');
  }
  if (process.env.VS_TEST_NEXT) {
    const unchanged = latest.media.id,
      mediaCommands = commands.length;
    let started!: () => void, finish!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const metadata = '**/resolve-source/**';
    const delayNext = async (route: Route) => {
      if (route.request().postDataJSON()?.action !== 'next') {
        await route.continue();
        return;
      }
      started();
      await delayed;
      await route
        .fulfill({
          json: {
            next: {
              url: 'https://next.xifanacg.com/anime/151/play/1987?source=xfy2',
              title: '迟到的下一集',
            },
          },
        })
        .catch(() => {});
    };
    await host.route(metadata, delayNext);
    await host.locator('#next-episode').click();
    await requested;
    await choosePlayback(host, 'file');
    finish();
    await host.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('#next-episode')!.disabled,
    );
    await host.unroute(metadata, delayNext);
    assert.equal(latest.media.id, unchanged);
    assert.equal(commands.length, mediaCommands);
    proof.cancelledNextKeepsMedia = true;
    await choosePlayback(host, 'link');
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
          return v.readyState >= 2 && v.videoWidth > 0 && !v.paused && v.currentTime > 0.5;
        },
        {},
        { timeout: 30000 },
      );
    proof.nextEpisode = { url: latest.media.url, decodedOnBothClients: true };
    assert.equal(latest.playback.position, 0, 'The new episode starts from its beginning');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  proof.errors = errors;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} catch (cause) {
  proof.failure = { message: cause instanceof Error ? cause.message : 'test failed', players: [] };
  for (const context of browser.contexts())
    for (const page of context.pages())
      proof.failure.players.push(
        await page
          .evaluate(() => {
            const v = document.querySelector<HTMLVideoElement>('#video');
            return v
              ? {
                  time: v.currentTime,
                  ready: v.readyState,
                  paused: v.paused,
                  seeking: v.seeking,
                  error: v.error?.code,
                  frames: v.getVideoPlaybackQuality().totalVideoFrames,
                  events: (window as any).__playbackEvents,
                }
              : null;
          })
          .catch(() => null),
      );
  console.log(JSON.stringify(proof));
  throw cause;
} finally {
  await desktop?.close();
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  const evidenceName = nativeBili
    ? 'bilibili-native-web'
    : xifan
      ? `xifan-${sourceCode}`
      : provider;
  await writeFile(`.local/${evidenceName}-playback-evidence.json`, JSON.stringify(proof, null, 2));
}
