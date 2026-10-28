import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Real mode needs an explicit, freshly confirmed login by the user. No system
// browser profile, exported cookie, fake real login or saved media source.
const real = process.env.VS_BILI_WEB_REAL === '1';
let confirmed = false;
const key = '0123456789abcdef0123456789abcdef';
const deadline = Math.floor(Date.now() / 1000) + 3600;
const track = (name: string) =>
  'https://fixture.mcdn.bilivideo.cn/public/' + name + '.m4s?deadline=' + deadline;
const fixture = async (url: string) => {
  let body: unknown;
  const headers: Record<string, string> = {};
  if (url.includes('/generate'))
    body = {
      code: 0,
      data: {
        qrcode_key: key,
        url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=' + key,
      },
    };
  else if (url.includes('/poll?')) {
    body = { code: 0, data: { code: confirmed ? 0 : 86101 } };
    if (confirmed)
      headers['Set-Cookie'] =
        'SESSDATA=session_fixture; Domain=.bilibili.com; Path=/; Secure; HttpOnly';
  } else if (url.endsWith('/nav')) body = { code: 0, data: { isLogin: true } };
  else if (url.includes('/view?'))
    body = {
      code: 0,
      data: {
        bvid: 'BV1R6xN66Exx',
        rights: { pay: 0 },
        pages: [{ page: 1, cid: 123, duration: 70 }],
      },
    };
  else
    body = {
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
  return new Response(JSON.stringify(body), { headers });
};
const app = createApp({
  bilibiliWebTrial: true,
  ...(!real ? { bilibiliSessionFetch: fixture } : {}),
});
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin = 'http://127.0.0.1:' + (app.server.address() as any).port;
await mkdir('.local/screenshots', { recursive: true });
if (real) await writeFile('.local/bili-web-live-stage.json', JSON.stringify({ stage: 'starting' }));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: !real,
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=128'],
});
const proof: any = {
  checkedAt: new Date().toISOString(),
  realSite: real,
  loginConfirmed: false,
  syntheticLogin: !real,
  syntheticMedia: !real,
  nativeClient: false,
  isolatedProfiles: true,
  localValidationService: true,
  cloudDeploymentProven: false,
};
let stage = 'create-room';
let state: any;
try {
  const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const guest = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  if (!real)
    for (const page of [host, guest])
      for (const [url, file] of [
        [track('video'), 'native-hd-video.mp4'],
        [track('audio'), 'native-hd-audio.m4a'],
      ]) {
        await page.route(url!, async (route) => {
          const bytes = await readFile('.local/' + file);
          const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
          const start = range ? Number(range[1]) : 0;
          const end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
          await route.fulfill({
            status: range ? 206 : 200,
            contentType: file!.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
            headers: {
              'Accept-Ranges': 'bytes',
              ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
            },
            body: bytes.subarray(start, end + 1),
          });
        });
      }
  host.on('websocket', (socket) =>
    socket.on('framereceived', (e) => {
      try {
        const data = JSON.parse(String(e.payload));
        if (data.room) state = data.room;
      } catch {}
    }),
  );
  if (real)
    host.on('response', async (response) => {
      if (!/\/bili-web\/[^/]+\/poll$/.test(new URL(response.url()).pathname)) return;
      try {
        const result = await response.json();
        if (result.state === 'authorized') {
          proof.loginConfirmed = true;
          await writeFile(
            '.local/bili-web-live-stage.json',
            JSON.stringify({ stage: 'login-confirmed' }),
          );
        }
      } catch {}
    });
  await host.goto(origin);
  assert.equal(await host.evaluate(() => !!window.desktop), false);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('网页取源验证');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invitation = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invitation);
  await guest.locator('#name-input').fill('独立网页观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  stage = 'consent';
  await selectSource(host, 'https://www.bilibili.com/video/BV1R6xN66Exx/');
  await host.locator('#source-bili-login').waitFor();
  assert.equal(state.media, null);
  await host.locator('#source-bili-login').click();
  await host
    .locator('#bili-web-login')
    .screenshot({ path: '.local/screenshots/bili-web-consent.png' });
  await host.locator('#bili-web-start').click();
  stage = 'official-qr';
  await host.locator('#bili-web-qr svg').waitFor({ timeout: 20000 });
  if (real) {
    await host
      .locator('#bili-web-qr')
      .screenshot({ path: '.local/screenshots/bili-web-real-qr.png' });
    await writeFile(
      '.local/bili-web-live-stage.json',
      JSON.stringify({
        stage: 'awaiting-user-scan',
        origin,
        qr: '.local/screenshots/bili-web-real-qr.png',
      }),
    );
    console.log(JSON.stringify({ stage: 'awaiting-user-scan', officialBilibiliQr: true }));
  } else confirmed = true;
  stage = 'login-resume';
  await host
    .locator('#current-playback')
    .filter({ hasText: '当前：共同播放' })
    .waitFor({ timeout: real ? 180000 : 25000 });
  assert.equal(state.media.source.bilibiliDirect, true);
  proof.loginResumedOriginalLink = true;
  stage = 'play';
  await guest.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!,
          a = document.querySelector<HTMLAudioElement>('#audio')!;
        return (
          v.videoHeight >= 720 &&
          !v.paused &&
          v.getVideoPlaybackQuality().totalVideoFrames > 5 &&
          (a as any).webkitAudioDecodedByteCount > 0
        );
      },
      undefined,
      { timeout: 25000 },
    );
  stage = 'seek';
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
  for (const player of proof.players)
    assert.ok(player.position >= 32 && player.frames > 5 && player.audioBytes > 0);
  await host.locator('#play-button').click();
  for (const page of [host, guest])
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  const revision = state.revision,
    mediaId = state.media.id;
  stage = 'forget-session';
  await host.locator('#settings-button').click();
  await host
    .locator('#bili-web-settings')
    .evaluate((el) => ((el as HTMLDetailsElement).open = true));
  await host.locator('#bili-web-forget').click();
  await host.locator('[data-close="settings-dialog"]').first().click();
  await host.waitForTimeout(500);
  await selectSource(host, 'https://www.bilibili.com/video/BV1R6xN66Exx/');
  await host.locator('#source-bili-login').waitFor();
  assert.equal(state.revision, revision);
  assert.equal(state.media.id, mediaId);
  proof.forgotSessionWithoutChangingRoom = true;
  proof.passed = true;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
} catch (error: any) {
  proof.ui = [];
  for (const context of browser.contexts())
    for (const page of context.pages())
      proof.ui.push(
        await page
          .evaluate(() => ({
            login: document.querySelector('#bili-web-status')?.textContent,
            source: document.querySelector('#link-error')?.textContent,
          }))
          .catch(() => null),
      );
  proof.failedStage = stage;
  proof.errorName = error?.name;
  proof.error = String(error?.message)
    .split('\n')[0]
    .replace(/https?:\/\/[^\s"')]+/g, '[url]')
    .slice(0, 180);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  if (real) {
    await rm('.local/screenshots/bili-web-real-qr.png', { force: true });
    await writeFile(
      '.local/bili-web-live-stage.json',
      JSON.stringify({ stage: 'closed', passed: !!proof.passed }),
    );
  }
  proof.sessionServiceClosed = true;
  await writeFile(
    real ? '.local/bili-web-real-evidence.json' : '.local/bili-web-fixture-evidence.json',
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof));
}
