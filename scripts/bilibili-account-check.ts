import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, configureRoomServer, selectSource } from './room-ui';

// Supply a fresh authorized source on stdin, never a cookie or a saved raw
// response. Native login is synthetic. VS_BILI_SYNTHETIC_MEDIA uses generated
// clips; without it, the supplied original CDN streams are decoded directly.
let input = '';
for await (const bytes of process.stdin) {
  input += bytes;
  assert.ok(input.length <= 20000, 'Source fixture exceeds size limit');
}
const source = JSON.parse(input);
const syntheticMedia = process.env.VS_BILI_SYNTHETIC_MEDIA === '1';
assert.equal(source.loggedIn, true);
assert.equal(source.preview, false);
assert.equal(source.drm, false);
assert.equal(source.height, 1080);
assert.ok(source.url && source.audio && source.duration > 0);
const site = 'https://www.bilibili.com/video/BV1R6xN66Exx/';
const local = createApp();
local.server.listen(0, '127.0.0.1');
await once(local.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || 'http://127.0.0.1:' + (local.server.address() as any).port;
await mkdir('.local', { recursive: true });
const profile = await mkdtemp(resolve('.local/bili-account-native-'));
const entry = join(profile, 'entry.cjs');
await writeFile(
  entry,
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(resolve('desktop/main.cjs'))});`,
);
const proof: any = {
  checkedAt: new Date().toISOString(),
  nativeLoginSynthetic: true,
  realAuthorizedSource: !syntheticMedia,
  syntheticMedia,
  screenCapture: false,
  reencoded: false,
  isolatedProfiles: true,
  packaged: !!process.env.VS_PACKAGED_EXE,
  publicRoom: !!process.env.VS_PUBLIC_URL,
};
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let state: any;
let stage = 'launch';
try {
  app = await electron.launch({
    ...(process.env.VS_PACKAGED_EXE ? { executablePath: process.env.VS_PACKAGED_EXE } : {}),
    args: [
      ...(process.env.VS_PACKAGED_EXE ? [] : [entry]),
      '--user-data-dir=' + profile,
      '--mute-audio',
      ...(process.env.VS_TEST_PROXY ? ['--proxy-server=' + process.env.VS_TEST_PROXY] : []),
    ],
    env: { ...process.env, VS_DEV_URL: process.env.VS_PACKAGED_EXE ? '' : origin },
  });
  const host = await app.firstWindow();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  stage = 'native-fixture';
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.setBackgroundThrottling(false);
      w.hide();
    }
  });
  await app.evaluate(async ({ session }, data) => {
    const test: any = ((globalThis as any).__biliAccountCheck = {
      logged: false,
      requests: [],
      delay: 0,
      info: {
        code: 0,
        data: {
          bvid: 'BV1R6xN66Exx',
          title: 'B 站高清共同播放验收',
          rights: { pay: 0 },
          pages: [{ page: 1, cid: data.cid || 123, duration: Math.round(data.duration) }],
        },
      },
      play: {
        code: 0,
        data: {
          quality: 80,
          format: 'flv',
          timelength: data.duration * 1000,
          is_preview: false,
          is_drm: false,
          dash: {
            duration: data.duration,
            video: [
              {
                width: data.width,
                height: data.height,
                codecs: data.videoCodec,
                baseUrl: data.url,
              },
            ],
            audio: [{ codecs: data.audioCodec, baseUrl: data.audio, bandwidth: 128000 }],
          },
        },
      },
    });
    const native = session.fromPartition('persist:sites');
    native.protocol.handle('https', async (request) => {
      const u = new URL(request.url);
      if (u.hostname === 'api.bilibili.com') {
        test.requests.push(u.pathname);
        if (test.delay && u.pathname === '/x/player/playurl')
          await new Promise((r) => setTimeout(r, test.delay));
        const result =
          u.pathname === '/x/web-interface/nav'
            ? { code: 0, data: { isLogin: test.logged } }
            : u.pathname === '/x/web-interface/view'
              ? test.info
              : test.play;
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return native.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  }, source);
  stage = 'guest-launch';
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    ...(process.env.VS_TEST_PROXY ? { proxy: { server: process.env.VS_TEST_PROXY } } : {}),
    args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
  });
  const guest = await browser.newPage();
  if (syntheticMedia) {
    for (const context of [app.context(), guest.context()]) {
      for (const [url, file] of [
        [source.url, 'native-hd-video.mp4'],
        [source.audio, 'native-hd-audio.m4a'],
      ])
        await context.route(url, async (route) => {
          const bytes = await readFile(join('.local', file));
          const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
          const start = range ? Number(range[1]) : 0,
            end =
              range && range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
          await route.fulfill({
            status: range ? 206 : 200,
            contentType: file.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
            headers: {
              'Accept-Ranges': 'bytes',
              ...(range
                ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes.length }
                : {}),
            },
            body: bytes.subarray(start, end + 1),
          });
        });
    }
  }
  // Keep Node's ordinary media relay enabled: this source must explicitly use
  // the original CDN even with a self-hosted backend.
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.name));
  host.on('websocket', (socket) =>
    socket.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        if (m.room) state = m.room;
      } catch {}
    }),
  );
  stage = 'room-create';
  await configureRoomServer(host, origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('本机取源');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('独立网页观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  stage = 'login-required';
  await selectSource(host, site + '?spm_id_from=test');
  await host.locator('#source-bili-login').waitFor();
  assert.equal(state.media, null);
  assert.equal(await host.locator('#bili-source-quality').inputValue(), 'hd');
  if (process.env.VS_SCREENSHOT) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await host
      .locator('#site-source-options')
      .evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await host.locator('#link-choice').screenshot({ path: process.env.VS_SCREENSHOT });
  }
  proof.noSilentGuestFallback = true;
  const opened = app.waitForEvent('window');
  await host.locator('#source-bili-login').click();
  const account = await opened;
  await app.evaluate(() => {
    (globalThis as any).__biliAccountCheck.logged = true;
  });
  stage = 'login-resume';
  await account.close();
  await host
    .locator('#current-playback')
    .filter({ hasText: '当前：共同播放' })
    .waitFor({ timeout: 25000 });
  assert.equal(state.media.source.bilibiliDirect, true);
  assert.equal(state.media.url, site);
  assert.equal(await host.locator('#native-stage').isVisible(), false);
  proof.loginCloseResumedOriginalLink = true;
  const pages = [host, guest];
  for (const p of pages)
    await p.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
      undefined,
      { timeout: 20000 },
    );
  await guest.locator('#play-button').click();
  stage = 'real-decode';
  for (const p of pages)
    await p.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!,
          a = document.querySelector<HTMLAudioElement>('#audio')!;
        return (
          v.videoHeight === 1080 &&
          !v.paused &&
          v.getVideoPlaybackQuality().totalVideoFrames > 5 &&
          (a as any).webkitAudioDecodedByteCount > 0
        );
      },
      undefined,
      { timeout: 20000 },
    );
  stage = 'seek-while-playing';
  await guest.locator('#seek').evaluate((el) => {
    (el as HTMLInputElement).value = '30';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const p of pages)
    await p.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.currentTime >= 30 && !v.paused && !v.seeking;
    });
  await host.waitForTimeout(5000);
  proof.players = [];
  for (const p of pages)
    proof.players.push(
      await p.locator('#video').evaluate((v) => ({
        width: (v as HTMLVideoElement).videoWidth,
        height: (v as HTMLVideoElement).videoHeight,
        frames: (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames,
        audioBytes: (document.querySelector('#audio') as any).webkitAudioDecodedByteCount,
        position: (v as HTMLVideoElement).currentTime,
      })),
    );
  await host.locator('#play-button').click();
  for (const p of pages)
    await p.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  const revision = state.revision,
    mediaId = state.media.id;
  stage = 'audio-first-frame-failure';
  await host.route(source.audio, (route) => route.fulfill({ status: 403, body: '' }));
  await selectSource(host, site);
  await host.locator('#link-unavailable').waitFor();
  assert.equal(state.revision, revision);
  assert.equal(state.media.id, mediaId);
  await host.unroute(source.audio);
  proof.badAudioKeepsExistingMovie = true;
  stage = 'local-retry';
  await guest.locator('#retry-video').evaluate((el) => (el as HTMLButtonElement).click());
  await host.waitForTimeout(1200);
  assert.equal(state.revision, revision);
  assert.equal(state.media.id, mediaId);
  proof.viewerRetryDoesNotPublish = true;
  stage = 'cancel';
  await app.evaluate(() => {
    (globalThis as any).__biliAccountCheck.delay = 1500;
  });
  await selectSource(host, site);
  await host.waitForTimeout(150);
  await host.locator('#source-url').fill('https://example.org/changed.mp4');
  await host.waitForTimeout(1800);
  assert.equal(state.revision, revision);
  assert.equal(state.media.id, mediaId);
  proof.cancelKeepsExistingMovie = true;
  assert.deepEqual(errors, []);
  proof.passed = true;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
} catch (cause: any) {
  // Exception messages from browser actions can contain signed URLs.
  proof.failedStage = stage;
  proof.errorName = cause?.name;
  proof.error = String(cause?.message)
    .split('\n')[0]
    .replace(/https?:\/\/[^\s"')]+/g, '[redacted]')
    .slice(0, 200);
  proof.playback = state?.playback;
  proof.players = [];
  for (const context of [app?.context(), ...(browser?.contexts() ?? [])])
    if (context)
      for (const page of context.pages())
        proof.players.push(
          await page
            .evaluate(() => {
              const v = document.querySelector<HTMLVideoElement>('#video'),
                a = document.querySelector<HTMLAudioElement>('#audio');
              return v
                ? {
                    width: v.videoWidth,
                    height: v.videoHeight,
                    position: v.currentTime,
                    paused: v.paused,
                    seeking: v.seeking,
                    ready: v.readyState,
                    error: v.error?.code,
                    frames: v.getVideoPlaybackQuality().totalVideoFrames,
                    audio: {
                      position: a?.currentTime,
                      paused: a?.paused,
                      ready: a?.readyState,
                      error: a?.error?.code,
                      bytes: (a as any)?.webkitAudioDecodedByteCount,
                    },
                  }
                : null;
            })
            .catch(() => null),
        );
  if (app)
    proof.nativeRequests = await app
      .evaluate(() => (globalThis as any).__biliAccountCheck?.requests ?? [])
      .catch(() => []);
  process.exitCode = 1;
} finally {
  await app?.close();
  await browser?.close();
  await local.close();
  await writeFile('.local/bilibili-account-native-evidence.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
