import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium, _electron as electron } from 'playwright';
import { createApp } from '../server/index';
import { openRoom, closeInvitation, configureRoomServer } from './room-ui';

const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app.server.address() as any).port}`;
const data = await readFile('.local/flower.mp4');
const source = createServer((req, res) => {
  if (req.url?.startsWith('/movie.mp4')) {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? ''),
      start = Number(range?.[1] ?? 0),
      end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
    });
    res.end(data.subarray(start, end + 1));
    return;
  }
  res
    .writeHead(200, { 'Content-Type': 'text/html' })
    .end(
      '<!doctype html><html><body style="background:#151519;margin:0;overflow:hidden"><video controls playsinline preload="auto" src="/movie.mp4" style="width:100vw;height:100vh"></video></body></html>',
    );
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl =
  process.env.VS_SITE_URL || `http://127.0.0.1:${(source.address() as any).port}/watch`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
const errors: string[] = [];
try {
  desktop = await electron.launch({
    executablePath: process.env.VS_PACKAGED_APP,
    args: process.env.VS_PACKAGED_APP ? ['--mute-audio'] : ['desktop/main.cjs', '--mute-audio'],
    env: { ...process.env, VS_DEV_URL: origin },
    timeout: 30000,
  });
  const host = await desktop.firstWindow(),
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    guest = await context.newPage();
  await guest.addInitScript(() => {
    (window as any).__pcs = [];
    window.RTCPeerConnection = class extends RTCPeerConnection {
      constructor(config?: RTCConfiguration) {
        super(config);
        (window as any).__pcs.push(this);
      }
    };
  });
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  await configureRoomServer(host, origin);
  await openRoom(host);
  await host.locator('#name-input').fill('画面提供者');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('无需登录的成员');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await host.locator('#source-url').fill(sourceUrl);
  await host.locator('#source-form button').click();
  await host.waitForFunction(
    async () => {
      try {
        return (await window.desktop!.call('sampleSite')).available;
      } catch {
        return false;
      }
    },
    {},
    { timeout: 60000 },
  );
  await host.locator('#broadcast-site').waitFor();
  await host.evaluate(() => {
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await original(options);
      (window as any).__captureSettings = stream
        .getTracks()
        .map((t) => ({ kind: t.kind, settings: t.getSettings() }));
      return stream;
    };
  });
  await host.locator('#broadcast-site').click();
  await guest
    .waitForFunction(
      () => !!document.querySelector<HTMLVideoElement>('#video')?.srcObject,
      {},
      { timeout: 25000 },
    )
    .catch(async (e) => {
      console.log(
        'Capture status:',
        await host.locator('#toast').textContent(),
        await host.locator('#broadcast-status').textContent(),
      );
      throw e;
    });
  await guest.locator('#play-button').click();
  await guest.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
        .totalVideoFrames > 30,
    {},
    { timeout: 25000 },
  );
  const sample = await guest.locator('#video').evaluate((e) => {
    const v = e as HTMLVideoElement;
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
      tracks: (v.srcObject as MediaStream).getTracks().map((t) => t.kind),
    };
  });
  const stats = await guest.evaluate(async () => {
    const rows: any[] = [];
    for (const pc of (window as any).__pcs)
      for (const row of (await pc.getStats()).values())
        if (row.type === 'inbound-rtp')
          rows.push({
            kind: row.kind,
            bytes: row.bytesReceived,
            framesDecoded: row.framesDecoded,
            totalAudioEnergy: row.totalAudioEnergy,
            totalSamplesReceived: row.totalSamplesReceived,
          });
    return rows;
  });
  assert.ok(sample.tracks.includes('audio'));
  assert.ok(sample.frames > 10);
  assert.ok(stats.some((x: any) => x.kind === 'audio' && x.bytes > 0));
  if (process.env.VS_SITE_URL) {
    await host.locator('#settings-button').click();
    await guest.waitForFunction(
      (frames) =>
        document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
          .totalVideoFrames >
        frames + 8,
      sample.frames,
      { timeout: 10000 },
    );
    await host.locator('[data-close="settings-dialog"]').first().click();
  }
  await guest.locator('#play-button').click();
  await host.waitForFunction(async () => (await window.desktop!.call('sampleSite')).paused);
  const nativeSourcePreserved = await host.evaluate(
    async () => (await window.desktop!.call('sampleSite')).available,
  );
  assert.ok(nativeSourcePreserved);
  await mkdir('.local/screenshots', { recursive: true });
  await guest.screenshot({ path: '.local/screenshots/site-broadcast.png', fullPage: true });
  await host.locator('#stop-broadcast').click();
  await guest.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')?.srcObject);
  await writeFile(
    '.local/site-broadcast-evidence.json',
    JSON.stringify(
      {
        source: process.env.VS_SITE_URL ? 'user-public-url' : 'local-cc0-fixture',
        sample,
        stats,
        nativeSourcePreserved,
        stopCleanup: true,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      sample,
      stats,
      capture: await host.evaluate(() => (window as any).__captureSettings),
      nativeSourcePreserved,
      stopCleanup: true,
    }),
  );
} finally {
  await desktop?.close();
  await browser.close();
  await app.close();
  await new Promise<void>((r) => source.close(() => r()));
}
