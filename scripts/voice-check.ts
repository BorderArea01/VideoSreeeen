import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Only generated streams in isolated browser contexts; never opens a real microphone.
let movie: Buffer;
try {
  movie = await readFile('.local/sintel-trailer.mp4');
} catch {
  const response = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4');
  assert.ok(response.ok);
  movie = Buffer.from(await response.arrayBuffer());
}
const source = createServer((req, res) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ''),
    start = Number(match?.[1] ?? 0),
    end = Math.min(movie.length - 1, match?.[2] ? Number(match[2]) : movie.length - 1);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  if (start > end) {
    res.writeHead(416).end();
    return;
  }
  if (match) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${movie.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  res.end(movie.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const movieUrl = `http://127.0.0.1:${(source.address() as any).port}/sintel.mp4`;
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
const evidence: Record<string, any> = { origin, syntheticOnly: true, physicalOutputMuted: true };
const errors: string[] = [],
  controls: string[] = [];
async function makePage(index: number) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  if (app)
    await context.route(origin + '/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
    });
  // Raw JS avoids transpiler helpers in page-scope functions. No samples are recorded.
  await context.addInitScript(`(() => {
    window.__micCalls = 0; window.__tracks = []; window.__voiceSockets = []; window.__lag = false;
    const Socket = WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url, protocols) { super(url, protocols); this.isVoice = new URL(url).pathname === '/voice'; if (this.isVoice) window.__voiceSockets.push(this); }
      set onmessage(callback) {
        if (!this.isVoice) { super.onmessage = callback; return; }
        let next = 0;
        super.addEventListener('message', event => {
          if (typeof event.data === 'string' || !window.__lag) { callback.call(this, event); return; }
          const now = performance.now(), delay = Math.floor(now / 1800) % 2 === 0 ? 180 : 0;
          next = Math.max(next, now + delay);
          setTimeout(() => callback.call(this, event), Math.max(0, next - now));
        });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__micCalls++;
      if (window.__denyMic) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      const context = new AudioContext({ sampleRate: 48000 }); await context.resume();
      const oscillator = context.createOscillator(); oscillator.frequency.value = ${440 + index * 220};
      const gain = context.createGain(); gain.gain.value = .15;
      const destination = context.createMediaStreamDestination(); oscillator.connect(gain).connect(destination); oscillator.start();
      window.__tracks.push(...destination.stream.getTracks());
      if (window.__delayMic) await new Promise(resolve => setTimeout(resolve, 800));
      destination.stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); context.close(); }; });
      return destination.stream;
    };
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(context, name, options) { super(context, name, options); if (name === 'vs-voice-playout') { const analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0; this.connect(analyser); window.__analyser = analyser; } }
    };
    ${index === 2 ? 'window.AudioEncoder = undefined;' : ''}
  })();`);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        const msg = JSON.parse(event.payload);
        if (['control', 'media', 'mode', 'cache'].includes(msg.type)) controls.push(msg.type);
      }
    });
  });
  return page;
}
async function status(page: Page) {
  return JSON.parse((await page.locator('#voice-panel').getAttribute('data-voice'))!);
}
async function ready(page: Page, peers: number) {
  await page.waitForFunction((n) => {
    const d = JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!);
    return d.ready && d.peers === n;
  }, peers);
}
async function audio(page: Page, speakers: number) {
  await page.waitForFunction(
    (n) => {
      const d = JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!);
      return d.metrics.filter((p: any) => p.played > 48000 && p.level > 0.025).length === n;
    },
    speakers,
    { timeout: 20000 },
  );
}
try {
  const host = await makePage(0),
    guest = await makePage(1),
    compatibility = await makePage(2);
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('语音验收 A');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  for (const [page, name] of [
    [guest, '语音验收 B'],
    [compatibility, '兼容收听 C'],
  ] as const) {
    await page.goto(invite);
    await page.locator('#name-input').fill(name);
    await page.locator('#join-button').click();
  }
  await host.locator('#member-count').filter({ hasText: '3' }).waitFor();
  await selectSource(host, movieUrl);
  await host.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 3,
  );
  await host.locator('#play-button').click();
  for (const page of [host, guest, compatibility])
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>('#video')!.getVideoPlaybackQuality()
          .totalVideoFrames > 10,
    );
  controls.length = 0;
  for (const page of [host, guest]) await page.locator('#voice-join').click();
  await ready(host, 2);
  await ready(guest, 2);
  assert.equal(
    await host.evaluate('window.__micCalls'),
    0,
    'Listen-only never requests microphone',
  );
  assert.equal((await status(host)).codec, 'opus');
  for (const page of [host, guest]) await page.locator('#voice-mic').click();
  await audio(host, 1);
  await audio(guest, 1);
  evidence.opus = [await status(host), await status(guest)];
  // One listener's short jitter must not stall or reconnect other members.
  await guest.evaluate('window.__lag = true');
  await new Promise((resolve) => setTimeout(resolve, 6500));
  await audio(guest, 1);
  evidence.jitter = [await status(host), await status(guest)];
  assert.ok(evidence.jitter[0].metrics[0].played > evidence.opus[0].metrics[0].played + 4 * 48000);
  assert.ok(evidence.jitter[1].metrics[0].played > evidence.opus[1].metrics[0].played + 4 * 48000);
  assert.ok(evidence.jitter[1].metrics[0].queuedMs <= 1000);
  await guest.evaluate('window.__lag = false');
  await compatibility.locator('#voice-join').click();
  await ready(host, 3);
  await ready(compatibility, 3);
  await compatibility.evaluate('window.__denyMic = true');
  await compatibility.locator('#voice-mic').click();
  await compatibility.locator('#voice-status').filter({ hasText: '麦克风未获授权' }).waitFor();
  assert.equal((await status(compatibility)).mic, false);
  assert.equal((await status(compatibility)).ready, true);
  await compatibility.evaluate('window.__denyMic = false');
  await compatibility.locator('#voice-mic').click();
  for (const page of [host, guest, compatibility]) await audio(page, 2);
  evidence.compatibility = [await status(host), await status(guest), await status(compatibility)];
  evidence.movies = await Promise.all(
    [host, guest, compatibility].map((page) =>
      page.locator('#video').evaluate((e) => {
        const v = e as HTMLVideoElement;
        return {
          position: v.currentTime,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
          paused: v.paused,
        };
      }),
    ),
  );
  assert.ok(
    evidence.movies.every((m: any) => !m.paused && m.frames > 100),
    'Movie decoding must continue during simultaneous voice',
  );
  assert.ok(evidence.compatibility.every((s: any) => s.codec === 'mulaw16'));
  const spectrum = await host.evaluate<number[]>(
    `(() => { const a = window.__analyser, v = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(v); return [660,880].map(f => Math.max(...v.slice(Math.floor((f-35)*a.fftSize/48000), Math.ceil((f+35)*a.fftSize/48000)))); })()`,
  );
  evidence.mixedToneDb = spectrum;
  assert.ok(
    spectrum.every((db: number) => db > -35),
    'Both simultaneous speakers must reach the actual mixed audio output',
  );
  await host.screenshot({ path: '.local/voice-room.png', fullPage: true });
  await host.locator('#voice-panel').screenshot({ path: '.local/voice-card.png' });
  // Receive mute is local, never a playback operation.
  await guest.locator('#voice-sound').click();
  await guest.locator('#voice-sound').click();
  await compatibility.locator('#voice-mic').click();
  assert.equal(
    await compatibility.evaluate('window.__tracks.every(t => t.readyState === "ended")'),
    true,
  );
  await compatibility.locator('#voice-leave').click();
  await ready(host, 2);
  assert.equal((await status(host)).codec, 'opus');
  await audio(host, 1);
  // Force a reconnect. Consent is not reused to reopen the microphone.
  await guest.evaluate('window.__voiceSockets.at(-1).close(4001, "synthetic outage")');
  await guest.waitForFunction(
    () =>
      JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!).ready &&
      (window as any).__voiceSockets.length > 1,
  );
  assert.equal((await status(guest)).mic, false);
  assert.equal(await guest.evaluate('window.__tracks.every(t => t.readyState === "ended")'), true);
  await audio(guest, 1);
  evidence.reconnect = await status(guest);
  await guest.evaluate('window.__delayMic = true');
  await guest.locator('#voice-mic').click();
  await guest.locator('#voice-leave').click();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(
    await guest.evaluate('window.__tracks.every(t => t.readyState === "ended")'),
    true,
    'Late permission response is disposed after leave',
  );
  await host.locator('#voice-leave').click();
  assert.equal(await host.evaluate('window.__tracks.every(t => t.readyState === "ended")'), true);
  assert.deepEqual(controls, []);
  assert.deepEqual(errors, []);
  evidence.micReleased = true;
  evidence.playbackControls = controls;
  evidence.errors = errors;
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/voice-${app ? 'local' : 'public'}-evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      ok: true,
      origin,
      opus: true,
      jitter180ms: true,
      threeSimultaneousSpeakers: true,
      compatibility: true,
      reconnectListenOnly: true,
      mixedToneDb: spectrum,
      microphoneReleased: true,
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ evidence, errors }));
  throw e;
} finally {
  await browser.close();
  await app?.close();
  await new Promise<void>((resolve) => source.close(() => resolve()));
}
