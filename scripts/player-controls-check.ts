import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, playbackSettings } from './room-ui';

// Public test film, no physical audio output or user device access.
const movie = await readFile('.local/sintel-trailer.mp4').catch(async () => {
  const response = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4');
  assert.ok(response.ok);
  return Buffer.from(await response.arrayBuffer());
});
const segments: Buffer[] = [];
for (let i = 0; i < 2; i++) {
  const path = `.local/player-hls-${i}.ts`;
  segments.push(
    await readFile(path).catch(async () => {
      const { stdout } = await promisify(execFile)(
        'curl.exe',
        [
          ...(process.env.VS_TEST_PROXY ? ['--proxy', process.env.VS_TEST_PROXY] : []),
          '--fail',
          '--silent',
          '--show-error',
          '--max-time',
          '20',
          `https://test-streams.mux.dev/x36xhzz/url_2/url_${526 + i}/193039199_mp4_h264_aac_ld_7.ts`,
        ],
        { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
      );
      await writeFile(path, stdout);
      return stdout;
    }),
  );
}
const source = createServer((req, res) => {
  if (req.url === '/preview.m3u8') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n/0.ts\n#EXTINF:10,\n/1.ts\n#EXT-X-ENDLIST\n',
    );
    return;
  }
  if (req.url === '/0.ts' || req.url === '/1.ts') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'video/mp2t');
    res.end(segments[Number(req.url[1])]);
    return;
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(movie.length - 1, range?.[2] ? Number(range[2]) : movie.length - 1);
  // Intentionally no CORS headers: previews must display without canvas pixel extraction.
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  if (start > end) {
    res.writeHead(416).end();
    return;
  }
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${movie.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  res.end(movie.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl = `http://127.0.0.1:${(source.address() as any).port}/movie.mp4`;
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
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--js-flags=--max-old-space-size=96',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const evidence: Record<string, any> = {
  origin,
  syntheticUsersOnly: true,
  physicalAudioMuted: true,
  noCorsSource: true,
};
const controls: any[] = [],
  errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  if (app)
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
    });
  const host = await context.newPage(),
    guest = await context.newPage();
  for (const page of [host, guest]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname !== '/ws') return;
      ws.on('framesent', (e) => {
        if (typeof e.payload === 'string') {
          const m = JSON.parse(e.payload);
          if (m.type === 'control') controls.push(m);
        }
      });
    });
  }
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('播放器验收');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('同步观众');
  await guest.locator('#join-button').click();
  await selectSource(host, sourceUrl);
  for (const page of [host, guest])
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
  const seekTo = async (position: number) => {
    await host.locator('#seek').fill(String(position));
    await host.locator('#seek').dispatchEvent('change');
    await atBoth(position);
  };
  async function atBoth(position: number) {
    for (const page of [host, guest])
      await page.waitForFunction((target) => {
        const video = document.querySelector<HTMLVideoElement>('#video')!;
        return !video.seeking && Math.abs(video.currentTime - target) < 0.4;
      }, position);
  }
  await seekTo(12);
  await host.locator('#seek').scrollIntoViewIfNeeded();
  const rect = (await host.locator('#seek').boundingBox())!;
  const duration = await host.locator('#video').evaluate((v) => (v as HTMLVideoElement).duration);
  let count = controls.length;
  await host.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height / 2);
  await host.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#seek-picture')!;
    return getComputedStyle(v).visibility === 'visible' && v.readyState >= 2 && v.videoWidth > 0;
  });
  evidence.preview = await host.locator('#seek-picture').evaluate((v) => {
    const video = v as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      time: video.currentTime,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
      paused: video.paused,
      muted: video.muted,
    };
  });
  assert.ok(
    evidence.preview.time > 15 &&
      evidence.preview.frames > 0 &&
      evidence.preview.paused &&
      evidence.preview.muted,
  );
  await atBoth(12);
  assert.equal(controls.length, count, 'Hover must not seek the room');
  await host.screenshot({ path: '.local/player-preview.png' });
  const x = rect.x + rect.width * 0.5,
    y = rect.y + rect.height / 2;
  await host.mouse.move(x, y);
  await host.mouse.down();
  const initial = Number(await host.locator('#seek').inputValue());
  await host.mouse.move(x, y - 115, { steps: 5 });
  assert.equal(
    Number(await host.locator('#seek').inputValue()),
    initial,
    'Changing precision cannot jump the target',
  );
  await host.mouse.move(x + 80, y - 115, { steps: 4 });
  const fine = Number(await host.locator('#seek').inputValue());
  assert.ok(Math.abs(fine - initial - (80 * duration) / (rect.width - 14) / 10) < 0.2);
  await atBoth(12);
  assert.equal(controls.length, count);
  await host.locator('#seek-preview-hint').filter({ hasText: '1/10' }).waitFor();
  await host.waitForFunction(
    () => getComputedStyle(document.getElementById('seek-picture')!).visibility === 'visible',
  );
  await host.screenshot({ path: '.local/player-fine-seek.png' });
  await host.mouse.up();
  await atBoth(fine);
  assert.equal(controls.length, count + 1, 'Release commits exactly one seek');
  evidence.fineSeek = { initial, fine, exactlyOneCommand: true, bothActualPlayersFollow: true };
  count = controls.length;
  await host.mouse.move(x, y);
  await host.mouse.down();
  await host.mouse.move(x + 40, y - 170);
  await host.keyboard.press('Escape');
  await host.mouse.up();
  assert.equal(controls.length, count, 'Canceled gesture must not seek');
  await playbackSettings(host);
  await host.locator('#skip-step').selectOption('30');
  await playbackSettings(host, false);
  assert.equal(controls.length, count, 'Preset choice is local');
  await seekTo(5);
  await host.locator('#skip-forward').click();
  await atBoth(35);
  await host.locator('#skip-back').click();
  await atBoth(5);
  await playbackSettings(host);
  await host.locator('#skip-step').selectOption('90');
  await playbackSettings(host, false);
  await host.locator('#skip-back').click();
  await atBoth(0);
  await host.locator('#skip-forward').click();
  await atBoth(duration);
  await seekTo(10);
  await host.bringToFront();
  evidence.skip = {
    presets: [10, 30, 60, 90],
    forwardAndBack: true,
    clampedToDuration: true,
    localPreference: true,
  };
  await host.locator('#page-fullscreen').click();
  await host.locator('#play-button').click();
  await host.mouse.move(400, 300);
  const hideStarted = Date.now();
  await host.waitForFunction(
    () => document.getElementById('player-shell')!.classList.contains('player-idle'),
    undefined,
    { timeout: 6000 },
  );
  assert.equal(await host.locator('#video').evaluate((v) => getComputedStyle(v).cursor), 'none');
  const hideElapsedMs = Date.now() - hideStarted;
  assert.ok(hideElapsedMs < 1900, 'Fullscreen controls hide promptly');
  assert.equal(
    await host.locator('.transport').evaluate((v) => getComputedStyle(v).pointerEvents),
    'none',
  );
  await host.mouse.move(410, 310);
  assert.equal(
    await host.locator('#player-shell').evaluate((v) => v.classList.contains('player-idle')),
    false,
  );
  await host.locator('#play-button').click();
  await host.mouse.move(400, 300);
  await host.waitForTimeout(2800);
  assert.equal(
    await host.locator('#player-shell').evaluate((v) => v.classList.contains('player-idle')),
    false,
    'Paused playback keeps controls',
  );
  await host.keyboard.press('Escape');
  await host.locator('#fullscreen').click();
  await host.waitForFunction(() => document.fullscreenElement?.id === 'player-shell');
  assert.equal(await host.locator('#skip-forward').isVisible(), true);
  await host.locator('#play-button').click();
  // Staying over the clicked control must no longer keep the whole bar visible forever.
  await host.waitForFunction(
    () => document.getElementById('player-shell')!.classList.contains('player-idle'),
    undefined,
    { timeout: 6000 },
  );
  await host.mouse.move(420, 320);
  await host.evaluate(() => document.exitFullscreen());
  assert.equal(
    await host.locator('#player-shell').evaluate((v) => v.classList.contains('player-idle')),
    false,
  );
  evidence.fullscreen = {
    pageAndSystemIdleHide: true,
    cursorNone: true,
    movementRestores: true,
    pausedKeepsControls: true,
    controlsInsideSystemFullscreen: true,
    hideElapsedMs,
    stationaryOverControlHides: true,
  };
  await host.setViewportSize({ width: 390, height: 844 });
  await host.locator('#page-fullscreen').click();
  for (const id of [
    'seek',
    'skip-forward',
    'skip-back',
    'player-settings',
    'page-fullscreen',
    'fullscreen',
  ]) {
    const b = (await host.locator('#' + id).boundingBox())!;
    assert.ok(
      b && b.x >= 0 && b.x + b.width <= 391 && b.y + b.height <= 845,
      id + ' fits narrow fullscreen',
    );
  }
  await host.mouse.move(190, 810);
  await host.screenshot({ path: '.local/player-controls-mobile.png' });
  await playbackSettings(host);
  for (const id of ['video-volume', 'skip-step', 'rate']) {
    const b = (await host.locator('#' + id).boundingBox())!;
    assert.ok(b && b.x >= 0 && b.x + b.width <= 391 && b.y + b.height <= 845);
  }
  await host.screenshot({ path: '.local/player-settings-mobile.png' });
  await playbackSettings(host, false);
  await host.keyboard.press('Escape');
  if (!(await host.locator('#video').evaluate((v) => (v as HTMLVideoElement).paused))) {
    await host.locator('#play-button').click();
    await host.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
  }
  await seekTo(10);
  await host.locator('#seek').scrollIntoViewIfNeeded();
  const touchRect = (await host.locator('#seek').boundingBox())!;
  const touch = await context.newCDPSession(host);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  count = controls.length;
  const tx = touchRect.x + touchRect.width * 0.4,
    ty = touchRect.y + touchRect.height / 2;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: tx, y: ty, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: tx, y: ty - 120, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: tx + 50, y: ty - 120, id: 1 }],
  });
  const touchExpected = ((tx - touchRect.x - 7 + 50 / 10) * duration) / (touchRect.width - 14);
  await host.waitForFunction(
    (expected) =>
      Math.abs(Number(document.querySelector<HTMLInputElement>('#seek')!.value) - expected) < 0.15,
    touchExpected,
  );
  const touchValue = Number(await host.locator('#seek').inputValue());
  evidence.touchAttempt = { touchValue, before: count };
  assert.equal(controls.length, count);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await host.waitForTimeout(300);
  evidence.touchAttempt.after = controls
    .slice(count)
    .map((m) => ({ action: m.action, position: m.position }));
  await atBoth(touchValue);
  assert.equal(controls.length, count + 1);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  evidence.touch = {
    emulatedPointerCapture: true,
    upwardFineSeek: true,
    releaseExactlyOneCommand: true,
    realPhoneVerified: false,
  };
  await selectSource(host, sourceUrl.replace('/movie.mp4', '/preview.m3u8'));
  await host.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return v.readyState >= 2 && v.videoWidth === 320;
  });
  await host.locator('#seek').scrollIntoViewIfNeeded();
  const hlsRect = (await host.locator('#seek').boundingBox())!;
  await host.mouse.move(hlsRect.x + hlsRect.width * 0.7, hlsRect.y + hlsRect.height / 2);
  await host.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#seek-picture')!;
    return (
      v.videoWidth === 320 &&
      v.currentTime >= 12 &&
      v.readyState >= 2 &&
      getComputedStyle(v).visibility === 'visible'
    );
  });
  evidence.hlsPreview = await host.locator('#seek-picture').evaluate((v) => ({
    width: (v as HTMLVideoElement).videoWidth,
    time: (v as HTMLVideoElement).currentTime,
  }));
  await host.mouse.move(10, 10);
  await host.waitForFunction(
    () => !document.getElementById('seek-picture')!.getAttribute('src'),
    undefined,
    { timeout: 5000 },
  );
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  evidence.ok = true;
  console.log(JSON.stringify(evidence));
} catch (error) {
  for (const page of browser.contexts().flatMap((c) => c.pages())) {
    console.error(
      JSON.stringify(
        await page
          .evaluate(() => ({
            fullscreen: document.fullscreenElement?.id,
            visibility: document.visibilityState,
            toast: document.getElementById('toast')?.textContent,
            idle: document.getElementById('player-shell')?.classList.contains('player-idle'),
            position: document.querySelector<HTMLVideoElement>('#video')?.currentTime,
            paused: document.querySelector<HTMLVideoElement>('#video')?.paused,
            seek: document.querySelector<HTMLInputElement>('#seek')?.value,
          }))
          .catch(() => ({})),
      ),
    );
  }
  console.error(
    JSON.stringify({
      evidence,
      controls: controls.slice(-3).map((m) => ({ action: m.action, position: m.position })),
    }),
  );
  throw error;
} finally {
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/player-controls-${app ? 'local' : 'public'}-evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  await app?.close();
  await new Promise<void>((resolve) => source.close(() => resolve()));
}
