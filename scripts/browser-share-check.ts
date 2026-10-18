import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation } from './room-ui';

// Capture only this test's isolated tab, never the user's desktop or other apps.
const title = `VideoSreeeen-test-${crypto.randomUUID()}`;
const movie = await readFile('.local/flower.mp4');
const source = createServer((req, res) => {
  if (req.url === '/movie.mp4') {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = Number(range?.[1] ?? 0);
    const end = Math.min(movie.length - 1, range?.[2] ? Number(range[2]) : movie.length - 1);
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${movie.length}` } : {}),
    });
    res.end(movie.subarray(start, end + 1));
  } else {
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(
        `<!doctype html><title>${title}</title><video controls loop playsinline src="/movie.mp4" style="width:100%;height:90vh"></video>`,
      );
  }
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl =
  process.env.VS_SITE_URL || `http://127.0.0.1:${(source.address() as any).port}/watch`;
const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: false,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--js-flags=--max-old-space-size=256',
    `--auto-select-tab-capture-source-by-title=${title}`,
  ],
});
const errors: string[] = [];
const evidence: Record<string, unknown> = {
  origin,
  source: process.env.VS_SITE_URL ? 'user-reported-site' : 'local-fixture',
  actualTabCapture: false,
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await context.newPage(),
    guest = await context.newPage();
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  await guest.addInitScript(() => {
    (window as any).__pcs = [];
    window.RTCPeerConnection = class extends RTCPeerConnection {
      constructor(config?: RTCConfiguration) {
        super(config);
        (window as any).__pcs.push(this);
      }
    };
  });
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('浏览器提供画面');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('直接观看');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  const began = Date.now();
  await host.locator('#source-url').fill(sourceUrl);
  await host.locator('#source-form button').click();
  await guest.locator('#browser-title').filter({ hasText: '选择播放方式' }).waitFor();
  evidence.choiceShownMs = Date.now() - began;
  assert.equal(await host.locator('#play-button').isEnabled(), false);
  // Reject one picker request, then use the unchanged real API for successful capture.
  await host.evaluate(() => {
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = () => {
      navigator.mediaDevices.getDisplayMedia = real;
      return Promise.reject(new DOMException('Test cancellation', 'NotAllowedError'));
    };
  });
  await host.locator('#browser-share-tab').click();
  await host.locator('#toast').filter({ hasText: '共享未开始' }).waitFor();
  assert.equal(await host.locator('#browser-share-tab').isEnabled(), true);
  assert.equal(await guest.locator('#browser-hint').isVisible(), true);
  evidence.cancelKeepsRoomAndAllowsRetry = true;
  const popup = host.waitForEvent('popup');
  await host.locator('#browser-open-site').click();
  const original = await popup;
  await original.waitForLoadState('domcontentloaded');
  assert.equal(new URL(original.url()).pathname, new URL(sourceUrl).pathname);
  // The test title selects only the popup we opened, including for a real site.
  await original.evaluate((title) => {
    document.title = title;
  }, title);
  await original.waitForFunction(
    () => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2),
    {},
    { timeout: 60000 },
  );
  await original
    .locator('video')
    .first()
    .evaluate((v) => (v as HTMLVideoElement).play());
  await original.waitForFunction(() =>
    [...document.querySelectorAll('video')].some(
      (v) => !v.paused && v.currentTime > 0.3 && v.videoWidth > 0,
    ),
  );
  evidence.sourcePlayback = await original
    .locator('video')
    .first()
    .evaluate((v) => {
      const video = v as HTMLVideoElement;
      return {
        time: video.currentTime,
        paused: video.paused,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    });
  await host.bringToFront();
  await host.locator('#browser-share-tab').click();
  await guest.locator('#browser-hint').waitFor({ state: 'hidden', timeout: 25000 });
  await guest.waitForFunction(
    () => !!document.querySelector<HTMLVideoElement>('#video')?.srcObject,
    {},
    { timeout: 25000 },
  );
  await guest.bringToFront();
  await guest.locator('#play-button').click();
  await guest.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > 10 && !v.paused;
    },
    {},
    { timeout: 20000 },
  );
  const sample = await guest.locator('#video').evaluate((v) => {
    const video = v as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
      tracks: (video.srcObject as MediaStream).getTracks().map((t) => t.kind),
    };
  });
  assert.ok(sample.tracks.includes('video'));
  assert.ok(sample.tracks.includes('audio'), 'Tab audio must be shared');
  const stats = await guest.evaluate(async () => {
    const received = [];
    for (const pc of (window as any).__pcs as RTCPeerConnection[])
      for (const s of (await pc.getStats()).values())
        if (s.type === 'inbound-rtp')
          received.push({
            kind: s.kind,
            bytes: s.bytesReceived,
            frames: s.framesDecoded,
            samples: s.totalSamplesReceived,
          });
    return received;
  });
  assert.ok(stats.some((s) => s.kind === 'video' && s.frames > 10 && s.bytes > 0));
  assert.ok(stats.some((s) => s.kind === 'audio' && s.bytes > 0));
  assert.equal(await guest.locator('#seek').isEnabled(), false);
  assert.equal(await guest.locator('#rate').isEnabled(), false);
  evidence.actualTabCapture = true;
  evidence.received = { sample, stats };
  await mkdir('.local/screenshots', { recursive: true });
  await guest.screenshot({ path: '.local/screenshots/browser-tab-share.png', fullPage: true });
  await host.bringToFront();
  await host.locator('#stop-broadcast').click();
  await guest.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')?.srcObject);
  evidence.stopCleanup = true;
  // A browser without screen capture must offer supported alternatives immediately.
  await guest.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      value: undefined,
      configurable: true,
    }),
  );
  await host.locator('#source-url').fill(sourceUrl);
  await host.locator('#source-form button').click();
  await guest.locator('#browser-title').filter({ hasText: '选择播放方式' }).waitFor();
  assert.equal(await guest.locator('#browser-share-tab').isVisible(), false);
  assert.equal(await guest.locator('#browser-local-video').isVisible(), true);
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await guest.screenshot({ path: '.local/screenshots/browser-source-mobile.png', fullPage: true });
  evidence.noCaptureAlternatives = true;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
  await app?.close();
  await new Promise<void>((resolve) => source.close(() => resolve()));
  await writeFile(
    process.env.VS_SITE_URL
      ? '.local/browser-share-site-evidence.json'
      : '.local/browser-share-evidence.json',
    JSON.stringify(evidence, null, 2),
  );
}
