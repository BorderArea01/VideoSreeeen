import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Only fixtures in fresh profiles; media bytes never enter the room connection.
const data = await readFile('.local/cache-window-fixture.mp4');
const expectOld = process.env.VS_NEXT_EXPECT_OLD === '1';
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--js-flags=--max-old-space-size=96',
  ],
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const proof: any = {
  at: new Date().toISOString(),
  production: !!process.env.VS_PUBLIC_URL,
  fixture: true,
  expectOld,
  realPhone: false,
};
const release: Array<() => void> = [];
let holdEpisode = 0,
  held = 0;
try {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = [],
    errors: string[] = [];
  let latest: any;
  for (const [index, context] of contexts.entries()) {
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), mediaRelay: false, p2p: false },
      });
    });
    await context.route('https://api.xifanacg.com/functions/v1/issue-web-playback', (route) => {
      const request = route.request().postDataJSON();
      return route.fulfill({
        json: {
          ok: true,
          anime_id: 3434,
          episode_id: request.episode_id,
          expires_at: Date.now() / 1000 + 3600,
          candidates: [
            {
              source_id: 1,
              source_code: 'AL',
              url: `https://play.xfvod.pro/next-fixture/${request.episode_id}.mp4`,
            },
          ],
        },
      });
    });
    await context.route(origin + '/resolve-source/**', (route) => {
      const request = route.request().postDataJSON(),
        url = new URL(request.url),
        episode = Number(url.pathname.split('/').at(-1));
      return route.fulfill({
        json: {
          next: {
            url: `https://next.xifanacg.com/anime/3434/play/${episode + 1}?source=AL`,
            title: '下一集测试',
          },
        },
      });
    });
    await context.route('https://play.xfvod.pro/next-fixture/**', async (route) => {
      const episode = Number(
        new URL(route.request().url()).pathname.split('/').at(-1)!.replace('.mp4', ''),
      );
      if (index === 2 && episode === holdEpisode) {
        held++;
        await new Promise<void>((resolve) => release.push(resolve));
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? ''),
        start = Number(range?.[1] ?? 0),
        end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
      await route
        .fulfill({
          status: range ? 206 : 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
            'Access-Control-Allow-Origin': '*',
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
          },
          body: data.subarray(start, end + 1),
        })
        .catch(() => {});
    });
    await context.addInitScript(`(() => {
      window.__firstFrames = {}; window.__starts = []; window.__seeks = [];
      const Socket = WebSocket;
      window.WebSocket = class extends Socket { constructor(url, protocols) { super(url, protocols); if (new URL(url).pathname === '/ws') this.addEventListener('message', event => {
        const m = JSON.parse(event.data); if (m.room?.media?.source && m.room.playback.intent === 'play' && !m.room.playback.paused) { const src = m.room.media.source.video; window.__starts.push({ src, ready: !!window.__firstFrames[src], at:performance.now() }); }
      }); } };
      document.addEventListener('DOMContentLoaded', () => {
        const video = document.querySelector('#video');
        const frame = (_, metadata) => { if (video.currentSrc && !window.__firstFrames[video.currentSrc]) window.__firstFrames[video.currentSrc] = { at:performance.now(), time:metadata.mediaTime }; video.requestVideoFrameCallback(frame); };
        video.requestVideoFrameCallback(frame);
        video.addEventListener('seeking', () => window.__seeks.push({ time:video.currentTime, src:video.currentSrc }));
      });
    })();`);
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => errors.push(e.message));
    if (index === 0)
      page.on('websocket', (socket) =>
        socket.on('framereceived', (event) => {
          try {
            const m = JSON.parse(String(event.payload));
            if (m.room) latest = m.room;
          } catch {}
        }),
      );
  }
  const [owner, fast, slow] = pages as [
    (typeof pages)[number],
    (typeof pages)[number],
    (typeof pages)[number],
  ];
  const until = async (predicate: () => boolean, timeout = 15000) => {
    const limit = Date.now() + timeout;
    while (!predicate()) {
      assert.ok(Date.now() < limit, 'State timeout');
      await owner.waitForTimeout(50);
    }
  };
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('切换者');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  for (const [index, page] of [fast, slow].entries()) {
    await page.goto(invite);
    await page.locator('#name-input').fill(index ? '冷加载观众' : '正常观众');
    await page.locator('#join-button').click();
  }
  await until(() => latest?.members.length === 3);
  await selectSource(owner, 'https://next.xifanacg.com/anime/3434/play/203799?source=AL');
  for (const page of pages)
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
  await owner.locator('#play-button').click();
  await until(() => !latest.playback.paused);
  const previous = latest.media.id;
  holdEpisode = 203800;
  await owner.locator('#next-episode').click();
  await until(() => latest.media.id !== previous && held > 0);
  await owner.waitForTimeout(1200);
  proof.whileAudienceCold = {
    paused: latest.playback.paused,
    position: latest.playback.position,
    audienceFrame: await slow.evaluate(
      '!!window.__firstFrames["https://play.xfvod.pro/next-fixture/203800.mp4"]',
    ),
  };
  if (expectOld) {
    assert.equal(latest.playback.paused, false);
    assert.equal(proof.whileAudienceCold.audienceFrame, false);
    proof.reproduced = true;
  } else {
    assert.equal(
      latest.playback.paused,
      true,
      'The shared clock must wait for next-episode first frames',
    );
    assert.equal(latest.playback.position, 0);
  }
  holdEpisode = 0;
  for (const done of release.splice(0)) done();
  for (const page of pages)
    await page.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        v.currentSrc.includes('203800.mp4') && v.currentTime > 0.35 && !v.paused && v.videoWidth > 0
      );
    });
  proof.startFrames = await Promise.all(
    pages.map((page) => page.evaluate('(window.__starts.filter(s=>s.src.includes("203800.mp4")))')),
  );
  if (!expectOld) {
    assert.ok(
      proof.startFrames.every((items: any[]) => items.length && items.every((s) => s.ready)),
    );
    await slow.screenshot({ path: '.local/screenshots/next-start.png', fullPage: true });
    // One unavailable viewer cannot hold everyone indefinitely; it stays local.
    holdEpisode = 203801;
    held = 0;
    const warm = latest.media.id;
    await owner.locator('#next-episode').click();
    await until(() => latest.media.id !== warm && held > 0);
    const began = Date.now();
    await until(() => !latest.playback.paused, 12000);
    const delay = Date.now() - began;
    assert.ok(delay >= 7000 && delay < 12000);
    assert.ok(
      await slow
        .locator('#video')
        .evaluate(
          (v: HTMLVideoElement) =>
            v.muted && v.currentTime === 0 && v.getVideoPlaybackQuality().totalVideoFrames === 0,
        ),
    );
    assert.equal(await slow.locator('#live-status').textContent(), '正在加载视频画面…');
    const version = latest.playback.revision;
    await owner.waitForTimeout(400);
    assert.equal(latest.playback.paused, false);
    assert.equal(latest.playback.revision, version);
    holdEpisode = 0;
    for (const done of release.splice(0)) done();
    await slow.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        !v.paused &&
        v.readyState >= 2 &&
        v.currentSrc.includes('203801.mp4') &&
        v.currentTime > 0.35
      );
    });
    proof.boundedWait = {
      elapsedMs: delay,
      slowViewerDoesNotPauseOthers: true,
      slowViewerRecovers: true,
    };
    // A manual pause while the next episode is loading must cancel autoplay.
    holdEpisode = 203802;
    held = 0;
    const before = latest.media.id;
    await owner.locator('#next-episode').click();
    await until(() => latest.media.id !== before && held > 0);
    await fast.locator('#play-button').click();
    await until(() => latest.playback.intent === 'play');
    await fast.locator('#play-button').click();
    await until(() => latest.playback.intent === 'pause');
    holdEpisode = 0;
    for (const done of release.splice(0)) done();
    await slow.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
    await owner.waitForTimeout(900);
    assert.equal(latest.playback.paused, true);
    proof.manualPauseCancelsStartup = true;
  }
  assert.deepEqual(errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = String(error);
  throw error;
} finally {
  holdEpisode = 0;
  for (const done of release.splice(0)) done();
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/next-start-${expectOld ? 'before' : process.env.VS_PUBLIC_URL ? 'public' : 'local'}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
  for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
  await app.close();
}
