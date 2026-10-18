import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation } from './room-ui';
import { readRelayPacket } from '../shared/broadcast-relay';

// No camera/mic or user screen: generated frames and inaudible test audio only.
// Force WebRTC to have no possible candidate; media must use the real relay.
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
    '--renderer-process-limit=1',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const evidence: Record<string, any> = { origin, directBlocked: true, generatedSource: true };
const debugBytes: Buffer[] = [],
  lateBytes: Buffer[] = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as any).__pcs = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super({ ...config, iceServers: [], iceTransportPolicy: 'relay' });
        (window as any).__pcs.push(this);
      }
    };
  });
  const host = await context.newPage(),
    guest = await context.newPage();
  if (process.env.VS_RELAY_DEBUG)
    host.on('websocket', (socket) =>
      socket.on('framesent', (event) => {
        if (!socket.url().includes('/broadcast-relay') || typeof event.payload === 'string') return;
        const packet = readRelayPacket(new Uint8Array(event.payload));
        if (packet && debugBytes.reduce((size, bytes) => size + bytes.length, 0) < 8 * 1024 * 1024)
          debugBytes.push(Buffer.from(packet.bytes));
      }),
    );
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  await host.addInitScript(() => {
    (window as any).__encoderCount = 0;
    window.MediaRecorder = class extends MediaRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        (window as any).__encoderCount++;
        (window as any).__encoderOptions = options;
      }
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const drawing = canvas.getContext('2d')!;
      let frame = 0;
      const animation = {
        render() {
          drawing.fillStyle = frame++ % 2 ? '#e09040' : '#2080c0';
          drawing.fillRect(0, 0, 1280, 720);
          drawing.fillStyle = '#fff';
          drawing.font = '24px sans-serif';
          for (let x = 0; x < 1280; x += 32) drawing.fillRect(x, (frame * 5) % 720, 10, 180);
          drawing.fillText(String(frame), 30, 30);
        },
      };
      animation.render();
      const timer = setInterval(() => animation.render(), 80);
      const stream = canvas.captureStream(12);
      const audio = new AudioContext(),
        output = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = 220;
      oscillator.connect(output);
      oscillator.start();
      void audio.resume();
      stream.addTrack(output.stream.getAudioTracks()[0]);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        clearInterval(timer);
        oscillator.stop();
        void audio.close();
      });
      (window as any).__sourceStream = stream;
      return stream;
    };
  });
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('备用通道测试');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('阻断直连观众');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  const began = Date.now();
  await host.locator('#broadcast-screen').click();
  await host.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.videoWidth === 1280,
  );
  await guest.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        !!video.getAttribute('src')?.startsWith('blob:') &&
        !video.srcObject &&
        video.videoWidth === 1280 &&
        video.getVideoPlaybackQuality().totalVideoFrames > 12
      );
    },
    {},
    { timeout: 65000 },
  );
  evidence.firstPlaybackMs = Date.now() - began;
  assert.ok(evidence.firstPlaybackMs < 15000, 'Primary transport must not wait for failed ICE');
  evidence.encoder = await host.evaluate(() => (window as any).__encoderOptions);
  assert.equal(evidence.encoder.videoBitsPerSecond, 4_500_000);
  evidence.player = await guest.locator('#video').evaluate((element) => {
    const video = element as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
      paused: video.paused,
      audioBytes: (video as any).webkitAudioDecodedByteCount,
    };
  });
  assert.equal(evidence.player.paused, false);
  assert.ok(evidence.player.audioBytes > 0, 'Actual audio decoding required');
  const before = evidence.player.frames;
  await guest.waitForFunction(
    (before) =>
      document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
        .totalVideoFrames >
      before + 12,
    before,
  );
  evidence.peers = await guest.evaluate(async () => {
    const states = [];
    for (const pc of (window as any).__pcs as RTCPeerConnection[]) {
      const stats = [...(await pc.getStats()).values()];
      states.push({
        state: pc.connectionState,
        receivedBytes: stats
          .filter((s) => s.type === 'inbound-rtp')
          .reduce((n, s) => n + (s.bytesReceived ?? 0), 0),
      });
    }
    return states;
  });
  assert.equal(evidence.peers.length, 0, 'Primary video must not start parallel WebRTC encoders');
  assert.ok(evidence.peers.every((pc: any) => pc.state !== 'connected' && pc.receivedBytes === 0));
  await guest.locator('#live-status').filter({ hasText: '正在接收视频' }).waitFor();
  await guest.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          (window as any).__diagnostic = text;
        },
      },
    });
  });
  await guest.locator('#settings-button').click();
  await guest.locator('#video-diagnostics summary').click();
  await guest.locator('#copy-video-diagnostics').click();
  await guest.locator('#video-diagnostics-status').filter({ hasText: '已复制' }).waitFor();
  const diagnostic = JSON.parse(await guest.locator('#video-diagnostics-output').inputValue());
  assert.equal(diagnostic.fallback.state, 'receiving');
  assert.ok(diagnostic.fallback.bytes > 0);
  evidence.fallback = diagnostic.fallback;
  await guest.locator('[data-close="settings-dialog"]').first().click();
  await mkdir('.local/screenshots', { recursive: true });
  await guest.screenshot({ path: '.local/screenshots/broadcast-relay.png', fullPage: true });
  const currentSource = await guest
    .locator('#video')
    .evaluate((video) => (video as HTMLVideoElement).currentSrc);
  const encoderCount = await host.evaluate(() => (window as any).__encoderCount);
  const late = await context.newPage();
  if (process.env.VS_RELAY_DEBUG)
    late.on('websocket', (socket) =>
      socket.on('framereceived', (event) => {
        if (!socket.url().includes('/broadcast-relay') || typeof event.payload === 'string') return;
        const packet = readRelayPacket(new Uint8Array(event.payload));
        if (packet && lateBytes.reduce((size, bytes) => size + bytes.length, 0) < 8 * 1024 * 1024)
          lateBytes.push(Buffer.from(packet.bytes));
      }),
    );
  late.on('pageerror', (error) => errors.push(error.message));
  await late.goto(invite);
  await late.locator('#name-input').fill('新观众');
  await late.locator('#join-button').click();
  try {
    await late.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return (
          v.videoWidth === 1280 && !v.paused && v.getVideoPlaybackQuality().totalVideoFrames > 5
        );
      },
      {},
      { timeout: 30000 },
    );
  } catch (error) {
    evidence.lateFailure = await late.locator('#video').evaluate((element) => {
      const video = element as HTMLVideoElement;
      return {
        width: video.videoWidth,
        readyState: video.readyState,
        time: video.currentTime,
        paused: video.paused,
        error: video.error?.message,
        ranges: Array.from({ length: video.buffered.length }, (_, i) => [
          video.buffered.start(i),
          video.buffered.end(i),
        ]),
        status: document.querySelector('#live-status')?.textContent,
      };
    });
    throw error;
  }
  assert.equal(await host.evaluate(() => (window as any).__encoderCount), encoderCount);
  assert.equal(
    await guest.locator('#video').evaluate((video) => (video as HTMLVideoElement).currentSrc),
    currentSource,
  );
  await late.locator('#leave-button').click();
  await late.close();
  assert.equal(await host.evaluate(() => (window as any).__encoderCount), encoderCount);
  evidence.joinLeaveWithoutRestart = true;
  evidence.continuity = await guest.evaluate(async () => {
    const video = document.querySelector<HTMLVideoElement>('#video')!;
    const samples = [];
    let last = video.getVideoPlaybackQuality().totalVideoFrames;
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const frames = video.getVideoPlaybackQuality().totalVideoFrames;
      samples.push({ decoded: frames - last, paused: video.paused });
      last = frames;
    }
    return samples;
  });
  assert.ok(evidence.continuity.every((sample: any) => sample.decoded > 0 && !sample.paused));
  await host.screenshot({
    path: '.local/screenshots/broadcast-primary-provider.png',
    fullPage: true,
  });
  await host.locator('#broadcast-quality').selectOption('smooth');
  await host.waitForFunction(
    () => (window as any).__encoderOptions.videoBitsPerSecond === 1_800_000,
  );
  await guest.waitForFunction(
    (previous) => {
      const video = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        video.currentSrc !== previous &&
        video.videoWidth === 1280 &&
        !video.paused &&
        video.getVideoPlaybackQuality().totalVideoFrames > 12
      );
    },
    currentSource,
    { timeout: 30000 },
  );
  evidence.qualityChange = { videoBitsPerSecond: 1_800_000, playbackResumed: true };
  // A new receiver requires a fresh container header, not stale cached chunks.
  await guest.reload();
  await guest.locator('#name-input').fill('重新加入观众');
  await guest.locator('#join-button').click();
  await guest.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return (
        v.videoWidth === 1280 && v.getVideoPlaybackQuality().totalVideoFrames > 12 && !v.srcObject
      );
    },
    {},
    { timeout: 65000 },
  );
  evidence.lateJoin = true;
  await host.locator('#stop-broadcast').click();
  await guest.locator('#welcome').waitFor();
  await guest.waitForFunction(
    () => !document.querySelector<HTMLVideoElement>('#video')!.getAttribute('src'),
  );
  assert.equal(
    await host.evaluate(() =>
      (window as any).__sourceStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
    true,
  );
  evidence.stopCleanup = true;
  await host.locator('#leave-button').click();
  await guest.locator('#leave-button').click();
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
  await app?.close();
  await writeFile('.local/broadcast-relay-evidence.json', JSON.stringify(evidence, null, 2));
  if (process.env.VS_RELAY_DEBUG) {
    await writeFile('.local/relay-source.webm', Buffer.concat(debugBytes));
    await writeFile('.local/relay-late.webm', Buffer.concat(lateBytes));
  }
}
