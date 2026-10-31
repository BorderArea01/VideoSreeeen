import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, choosePlayback } from './room-ui';

// This test loads our actual packaged extension in an isolated browser profile.
// Only synthetic site metadata and generated clips are used. No real account.
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin = 'http://127.0.0.1:' + (app.server.address() as any).port;
await mkdir('.local/screenshots', { recursive: true });
const profile = await mkdtemp(resolve('.local/extension-check-'));
const extension = resolve('artifacts/browser-extension');
const hostContext = await chromium.launchPersistentContext(profile, {
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--disable-extensions-except=' + extension,
    '--load-extension=' + extension,
    '--mute-audio',
    '--js-flags=--max-old-space-size=128',
  ],
});
const viewerBrowser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--disable-extensions', '--mute-audio', '--js-flags=--max-old-space-size=96'],
});
const proof: any = {
  checkedAt: new Date().toISOString(),
  syntheticSite: true,
  syntheticMedia: true,
  realAccount: false,
  actualExtensionLoaded: false,
  viewerHasExtension: false,
};
const pageUrl = 'https://www.bilibili.com/video/BV1R6xN66Exx/';
const deadline = Math.floor(Date.now() / 1000) + 3600;
const track = (kind: string) =>
  `https://fixture.mcdn.bilivideo.cn/public/${kind}.m4s?deadline=${deadline}`;
let loggedIn = false;
let hold: Promise<void> | null = null;
let release = () => {};
let room: any;
let upstreamCalls = 0;
let sourceCommands = 0;
let oversizedView = false;
const viewMetadata = {
  code: 0,
  data: {
    bvid: 'BV1R6xN66Exx',
    title: 'B 站 · 大合集扩展共同播放',
    rights: { pay: 0 },
    pages: [
      { page: 1, cid: 123, duration: 70 },
      { page: 2, cid: 456, duration: 70 },
    ],
    ugc_season: {
      sections: [
        {
          episodes: Array.from({ length: 366 }, (_, id) => ({ id, title: '合集目录'.repeat(150) })),
        },
      ],
    },
  },
};
proof.largeViewBytes = Buffer.byteLength(JSON.stringify(viewMetadata));
assert.ok(proof.largeViewBytes > 512 * 1024);
try {
  const worker =
    hostContext.serviceWorkers()[0] ||
    (await hostContext.waitForEvent('serviceworker', { timeout: 15000 }));
  assert.ok(worker.url().startsWith('chrome-extension://'));
  proof.actualExtensionLoaded = true;
  proof.helperVersion = await worker.evaluate(
    () => (globalThis as any).chrome.runtime.getManifest().version,
  );
  assert.equal(proof.helperVersion, '0.1.2');
  await hostContext.addInitScript(() => localStorage.setItem('videosreeeen.appearance', 'classic'));
  await hostContext.route('https://api.bilibili.com/**', async (route) => {
    upstreamCalls++;
    const url = new URL(route.request().url());
    let data;
    if (url.pathname.endsWith('/nav'))
      data = { code: loggedIn ? 0 : -101, data: { isLogin: loggedIn } };
    else if (url.pathname.endsWith('/view')) {
      if (oversizedView) {
        await route.fulfill({
          body: ' '.repeat(8 * 1024 * 1024 + 1),
          contentType: 'application/json',
        });
        return;
      }
      data = viewMetadata;
    } else {
      if (hold) await hold;
      data = {
        code: 0,
        data: {
          timelength: 70000,
          dash: {
            duration: 70,
            video: [{ width: 1920, height: 1080, codecs: 'avc1.640032', baseUrl: track('video') }],
            audio: [{ codecs: 'mp4a.40.2', baseUrl: track('audio') }],
          },
        },
      };
    }
    await route.fulfill({ json: data }).catch(() => {});
  });
  const viewerContext = await viewerBrowser.newContext();
  for (const context of [hostContext, viewerContext])
    for (const [kind, file] of [
      ['video', 'native-hd-video.mp4'],
      ['audio', 'native-hd-audio.m4a'],
    ])
      await context.route(track(kind!), async (route) => {
        const bytes = await readFile('.local/' + file);
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
        await route.fulfill({
          status: range ? 206 : 200,
          contentType: kind === 'video' ? 'video/mp4' : 'audio/mp4',
          headers: {
            'Accept-Ranges': 'bytes',
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
          },
          body: bytes.subarray(start, end + 1),
        });
      });
  const host = await hostContext.newPage(),
    guest = await viewerContext.newPage();
  host.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      try {
        const result = JSON.parse(String(event.payload));
        if (result.room) room = result.room;
      } catch {}
    });
    socket.on('framesent', (event) => {
      try {
        if (JSON.parse(String(event.payload)).type === 'media') sourceCommands++;
      } catch {}
    });
  });
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('扩展取源验证');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('纯网页观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();

  await selectSource(guest, pageUrl);
  await guest.locator('#bili-extension-help').waitFor();
  assert.equal(upstreamCalls, 0);
  assert.equal(room.media, null);
  proof.missingExtensionKeepsMedia = true;
  await selectSource(host, pageUrl);
  await host.locator('#bili-browser-login').waitFor();
  assert.equal(room.media, null);
  assert.equal(upstreamCalls, 1);
  proof.missingLoginNeverRequestsVideo = true;
  assert.equal(
    await host
      .locator('[id*="qrcode"], #bili-web-login, #bili-source-quality, #source-bili-login')
      .count(),
    0,
  );
  loggedIn = true;
  await worker.evaluate(() => {
    const runtime = (globalThis as any).chrome.runtime;
    (globalThis as any).__vsOriginalManifest = runtime.getManifest;
    runtime.getManifest = () => ({ version: '0.1.1' });
  });
  const beforeOldHelper = upstreamCalls;
  await selectSource(host, pageUrl);
  await host.locator('#bili-extension-help').filter({ hasText: '更新视频源助手' }).waitFor();
  assert.equal(room.media, null);
  assert.equal(upstreamCalls, beforeOldHelper);
  proof.oldHelperRequiresUpdateBeforeSource = true;
  await worker.evaluate(() => {
    (globalThis as any).chrome.runtime.getManifest = (globalThis as any).__vsOriginalManifest;
    delete (globalThis as any).__vsOriginalManifest;
  });
  await selectSource(host, pageUrl);
  await host
    .locator('#current-playback')
    .filter({ hasText: '当前：共同播放' })
    .waitFor({ timeout: 25000 });
  assert.equal(room.media.source.bilibiliDirect, true);
  assert.ok(!JSON.stringify(room.media).includes('ugc_season'));
  assert.ok(Buffer.byteLength(JSON.stringify(room.media)) < 2048);
  proof.largeCollectionNotForwarded = true;
  await guest.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!,
          a = document.querySelector('#audio') as any;
        return (
          v.videoHeight === 1080 &&
          !v.paused &&
          v.getVideoPlaybackQuality().totalVideoFrames > 5 &&
          a.webkitAudioDecodedByteCount > 0
        );
      },
      undefined,
      { timeout: 25000 },
    );
  await guest.locator('#seek').evaluate((el) => {
    (el as HTMLInputElement).value = '30';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await host.waitForTimeout(5000);
  proof.players = [];
  for (const page of [host, guest])
    proof.players.push(
      await page.locator('#video').evaluate((el) => {
        const v = el as HTMLVideoElement;
        return {
          width: v.videoWidth,
          height: v.videoHeight,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
          position: v.currentTime,
          audioBytes: (document.querySelector('#audio') as any).webkitAudioDecodedByteCount,
        };
      }),
    );
  assert.ok(proof.players.every((p: any) => p.position >= 32 && p.frames > 5 && p.audioBytes > 0));
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  proof.playPauseSeek = true;
  const extensionId = new URL(worker.url()).hostname;
  const popup = await hostContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.setViewportSize({ width: 310, height: 310 });
  await popup.screenshot({ path: '.local/screenshots/source-helper-popup.png' });
  await popup.close();
  await host.locator('#next-episode').click();
  await host.waitForFunction(() =>
    document.querySelector('#room-title')?.textContent?.includes('P2'),
  );
  assert.equal(room.media.url, pageUrl + '?p=2');
  proof.nextPart = true;
  const before = sourceCommands,
    previous = room.media.id;
  oversizedView = true;
  await selectSource(host, pageUrl);
  await host
    .locator('#link-error')
    .filter({ hasText: 'B 站视频信息响应超过安全大小限制' })
    .waitFor();
  assert.equal(room.media.id, previous);
  assert.equal(sourceCommands, before);
  proof.oversizedResponseKeepsMedia = true;
  oversizedView = false;
  hold = new Promise<void>((done) => {
    release = done;
  });
  await selectSource(host, pageUrl);
  await host.locator('#source-form[aria-busy="true"]').waitFor();
  await choosePlayback(host, 'file');
  release();
  hold = null;
  await host.waitForTimeout(500);
  assert.equal(sourceCommands, before);
  assert.equal(room.media.id, previous);
  proof.cancelledSourceKeepsMedia = true;
  await choosePlayback(host, 'link');
  loggedIn = false;
  await selectSource(host, pageUrl);
  await host.locator('#bili-browser-login').waitFor();
  assert.equal(room.media.id, previous);
  assert.equal(sourceCommands, before);
  proof.loginExpiryKeepsMedia = true;
  await host.screenshot({
    path: '.local/screenshots/extension-common-playback.png',
    fullPage: true,
  });
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  proof.passed = true;
} catch (error: any) {
  proof.errorName = error.name;
  proof.error = String(error.message)
    .split('\n')[0]
    .replace(/https?:\/\/[^\s]+/g, '[url]')
    .slice(0, 180);
  process.exitCode = 1;
} finally {
  release();
  await hostContext.close();
  await viewerBrowser.close();
  await app.close();
  const localProfile = relative(resolve('.local'), profile);
  if (
    !localProfile.startsWith('extension-check-') ||
    localProfile.includes('..') ||
    localProfile.includes('/') ||
    localProfile.includes('\\')
  )
    throw new Error('Unexpected isolated profile path');
  await rm(profile, { recursive: true, force: true });
  proof.isolatedProfileRemoved = true;
  await writeFile('.local/extension-evidence.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
