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
  await context.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')!;
    const load = HTMLMediaElement.prototype.load;
    const events = { detachments: 0, repeatedBindings: 0, loadsWithStream: 0 };
    (window as any).__videoInputs = events;
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      ...descriptor,
      set(value) {
        if (this.id === 'video') {
          const previous = descriptor.get!.call(this);
          if (previous && value === null) events.detachments++;
          if (previous && value === previous) events.repeatedBindings++;
        }
        descriptor.set!.call(this, value);
      },
    });
    HTMLMediaElement.prototype.load = function () {
      if (this.id === 'video' && this.srcObject) events.loadsWithStream++;
      return load.call(this);
    };
  });
  const host = await context.newPage(),
    guest = await context.newPage();
  const roomEvents: unknown[] = [];
  host.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.room)
          roomEvents.push({
            type: message.type,
            revision: message.room.revision,
            broadcast: message.room.media?.broadcast?.kind,
          });
        else if (message.type === 'error')
          roomEvents.push({ type: message.type, message: message.message });
      } catch {}
    }),
  );
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  await host.addInitScript(() => {
    // Delay the real server acknowledgement without replacing capture or media.
    const queued: { socket: WebSocket; data: string }[] = [];
    (window as any).__holdScreenState = false;
    (window as any).__queuedScreenStates = () => queued.length;
    (window as any).__flushScreenStates = () => {
      (window as any).__holdScreenState = false;
      for (const { socket, data } of queued.splice(0))
        socket.dispatchEvent(new MessageEvent('message', { data }));
    };
    window.WebSocket = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (!(window as any).__holdScreenState || typeof event.data !== 'string') return;
          const message = JSON.parse(event.data);
          if (message.type === 'state' && message.room?.media?.broadcast?.kind === 'screen') {
            queued.push({ socket: this, data: event.data });
            event.stopImmediatePropagation();
          }
        });
      }
    };
  });
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
  await host.locator('#provide-dialog').waitFor();
  await guest.locator('#browser-title').filter({ hasText: '开始共享' }).waitFor();
  assert.equal(await guest.locator('#browser-open-site').isVisible(), false);
  assert.equal(await guest.locator('#browser-share-tab').isVisible(), false);
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
  await host.locator('#provide-status').filter({ hasText: '共享未开始' }).waitFor();
  assert.equal(await host.locator('#browser-share-tab').isEnabled(), true);
  assert.equal(await guest.locator('#browser-hint').isVisible(), true);
  evidence.cancelKeepsRoomAndAllowsRetry = true;
  await guest.locator('#leave-button').click();
  await host.locator('#member-count').filter({ hasText: '1' }).waitFor();
  const popup = host.waitForEvent('popup');
  await host.locator('#browser-open-site').click();
  assert.equal(
    await host.locator('#provide-status').textContent(),
    '尚未开始共享 · 返回后请完成第 2 步',
  );
  assert.equal(
    await host.locator('#video').evaluate((v) => !!(v as HTMLVideoElement).srcObject),
    false,
  );
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
  evidence.sourceTitleStillMatches = (await original.title()) === title;
  await original.evaluate((title) => {
    document.title = title;
  }, title);
  await host.evaluate(() => {
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    (window as any).__holdScreenState = true;
    (window as any).__captureState = 'requesting';
    navigator.mediaDevices.getDisplayMedia = (options) =>
      real(options).then(
        (stream) => {
          (window as any).__captureState = 'captured';
          (window as any).__captureTracks = stream.getTracks();
          return stream;
        },
        (error) => {
          (window as any).__captureState = error.name;
          throw error;
        },
      );
  });
  await host.bringToFront();
  await host.locator('#browser-share-tab').click();
  try {
    await host.locator('#provide-dialog').waitFor({ state: 'hidden', timeout: 25000 });
    await host.waitForFunction(
      () => {
        const video = document.querySelector<HTMLVideoElement>('#video')!;
        return (
          !!video.srcObject &&
          video.videoWidth > 0 &&
          !video.paused &&
          video.muted &&
          video.getVideoPlaybackQuality().totalVideoFrames > 10
        );
      },
      {},
      { timeout: 10000 },
    );
    await host.waitForFunction(() => (window as any).__queuedScreenStates() > 0);
    await host.locator('#live-status').filter({ hasText: '本机预览' }).waitFor();
    assert.equal(await host.locator('#browser-hint').isVisible(), false);
    assert.equal(await host.locator('#play-button').isEnabled(), false);
    evidence.previewBeforeRoomAcknowledgement = await host.locator('#video').evaluate((element) => {
      const video = element as HTMLVideoElement;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const context = canvas.getContext('2d')!;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlackSamples = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) nonBlackSamples++;
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames,
        nonBlackSamples,
      };
    });
    assert.ok(
      (evidence.previewBeforeRoomAcknowledgement as { nonBlackSamples: number }).nonBlackSamples >
        30,
      'Provider preview must contain an image, not only decoded black frames',
    );
    await mkdir('.local/screenshots', { recursive: true });
    await host.screenshot({
      path: '.local/screenshots/provider-preview-before-ack.png',
      fullPage: true,
    });
    await host.evaluate(() => {
      (window as any).__previewBeforeAck =
        document.querySelector<HTMLVideoElement>('#video')!.srcObject;
      (window as any).__flushScreenStates();
    });
    await host.locator('#live-status').filter({ hasText: '暂无观众' }).waitFor();
    assert.doesNotMatch((await host.locator('#provide-status').textContent()) ?? '', /未开始|尚未/);
    await host.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        video.videoWidth > 0 &&
        !video.paused &&
        video.getVideoPlaybackQuality().totalVideoFrames > 10
      );
    });
    evidence.publisherPreviewWithoutViewers = true;
    evidence.publisherInputContinuity = await host.evaluate(() => ({
      ...(window as any).__videoInputs,
      sameStream:
        document.querySelector<HTMLVideoElement>('#video')!.srcObject ===
        (window as any).__previewBeforeAck,
    }));
    assert.deepEqual(
      evidence.publisherInputContinuity,
      {
        detachments: 0,
        repeatedBindings: 0,
        loadsWithStream: 0,
        sameStream: true,
      },
      'Acknowledging the publisher must preserve the playing input',
    );
  } catch (error) {
    evidence.failure = {
      capture: await host.evaluate(() => (window as any).__captureState),
      toast: await host.locator('#toast').textContent(),
      sourceTitleMatches: (await original.title()) === title,
      roomEvents,
    };
    console.log(JSON.stringify(evidence.failure));
    throw error;
  }
  await guest.reload();
  await guest.locator('#name-input').fill('直接观看');
  await guest.locator('#join-button').click();
  await guest.waitForFunction(
    () => !!document.querySelector<HTMLVideoElement>('#video')?.srcObject,
    {},
    { timeout: 25000 },
  );
  await guest.bringToFront();
  if ((await guest.locator('#broadcast-status').textContent())?.includes('点击播放'))
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
  evidence.receiverInputContinuity = await guest.evaluate(() => (window as any).__videoInputs);
  assert.deepEqual(
    evidence.receiverInputContinuity,
    {
      detachments: 0,
      repeatedBindings: 0,
      loadsWithStream: 0,
    },
    'Audio and video track events must not rebind the same stream',
  );
  assert.equal(await guest.locator('#seek').isEnabled(), false);
  assert.equal(await guest.locator('#rate').isEnabled(), false);
  await host.locator('#live-status').filter({ hasText: '已连接 1 位观众' }).waitFor();
  assert.equal(
    await guest.locator('#broadcast-status').textContent(),
    await guest.locator('#live-status').textContent(),
  );
  evidence.actualTabCapture = true;
  evidence.received = { sample, stats };
  // Keep clipboard writes inside this isolated test page, not the user's OS clipboard.
  await guest.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          (window as any).__diagnosticClipboard = text;
        },
      },
    });
  });
  await guest.locator('#settings-button').click();
  await guest.locator('#video-diagnostics summary').click();
  await guest.locator('#copy-video-diagnostics').click();
  await guest.locator('#video-diagnostics-status').filter({ hasText: '已复制' }).waitFor();
  const diagnostic = JSON.parse(await guest.locator('#video-diagnostics-output').inputValue());
  assert.equal(diagnostic.role, 'viewer');
  assert.equal(diagnostic.connections[0].connection, 'connected');
  assert.ok(diagnostic.connections[0].media.some((media: any) => media.framesDecoded > 0));
  assert.equal(
    await guest.evaluate(() => (window as any).__diagnosticClipboard),
    await guest.locator('#video-diagnostics-output').inputValue(),
  );
  evidence.connectionDiagnostics = { role: diagnostic.role, actualMediaStats: true };
  await guest.locator('[data-close="settings-dialog"]').first().click();
  // Inject a connection state only for UI verification. Media above remains
  // real; this does not demonstrate a failure or recovery across actual NATs.
  await guest.evaluate(() => {
    const pc = (window as any).__pcs[0] as RTCPeerConnection;
    Object.defineProperty(pc, 'connectionState', { configurable: true, value: 'failed' });
    pc.dispatchEvent(new Event('connectionstatechange'));
  });
  await guest.locator('#live-status').filter({ hasText: '视频连接失败' }).waitFor();
  assert.doesNotMatch((await guest.locator('#provide-status').textContent()) ?? '', /未开始|尚未/);
  evidence.failureStatusUiSimulated = true;
  await guest.evaluate(() => {
    const pc = (window as any).__pcs[0] as RTCPeerConnection;
    Reflect.deleteProperty(pc, 'connectionState');
    pc.dispatchEvent(new Event('connectionstatechange'));
  });
  await guest.locator('#live-status').filter({ hasText: '正在接收' }).waitFor();
  await mkdir('.local/screenshots', { recursive: true });
  await guest.screenshot({ path: '.local/screenshots/browser-tab-share.png', fullPage: true });
  await host.bringToFront();
  await host.locator('#stop-broadcast').click();
  await guest.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')?.srcObject);
  assert.equal(
    await host.locator('#video').evaluate((v) => !!(v as HTMLVideoElement).srcObject),
    false,
  );
  assert.equal(
    await host.evaluate(() =>
      (window as any).__captureTracks.every(
        (track: MediaStreamTrack) => track.readyState === 'ended',
      ),
    ),
    true,
  );
  evidence.stopCleanup = true;
  // Track shutdown is immediate; wait for the server to accept unshare before
  // submitting another versioned media operation over the public connection.
  await host.locator('#welcome').waitFor();
  await guest.locator('#welcome').waitFor();
  // A browser without screen capture must offer supported alternatives immediately.
  await guest.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      value: undefined,
      configurable: true,
    }),
  );
  await host.locator('#source-url').fill(sourceUrl);
  await host.locator('#source-form button').click();
  await guest.locator('#browser-title').filter({ hasText: '开始共享' }).waitFor();
  await guest.locator('#browser-takeover').click();
  await guest.locator('#provide-dialog').waitFor();
  assert.equal(await guest.locator('#browser-share-tab').isVisible(), false);
  assert.equal(await guest.locator('#provide-local-video').isVisible(), true);
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await guest.screenshot({ path: '.local/screenshots/browser-source-mobile.png', fullPage: true });
  evidence.noCaptureAlternatives = true;
  await host.locator('[data-close="provide-dialog"]').click();
  await guest.locator('[data-close="provide-dialog"]').click();
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
