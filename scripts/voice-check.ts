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
    window.__inputRequests = []; window.__sinkCalls = []; window.__removedOutput = false;
    const device = (kind, deviceId, label) => ({ kind, deviceId, label, groupId: 'fixture', toJSON() { return { kind, deviceId, label }; } });
    navigator.mediaDevices.enumerateDevices = async () => [
      device('audioinput', 'fixture-mic-a', window.__micCalls ? '测试麦克风 A' : ''),
      ...(!window.__removedInput ? [device('audioinput', 'fixture-mic-b', window.__micCalls ? '测试麦克风 B' : '')] : []),
      ...(!window.__removedOutput ? [device('audiooutput', 'fixture-headset', '测试耳机')] : []),
      device('audiooutput', 'fixture-speaker', '测试扬声器'),
    ];
    navigator.mediaDevices.selectAudioOutput = async () => device('audiooutput', 'fixture-headset', '测试耳机');
    const nativeSink = AudioContext.prototype.setSinkId;
    if (nativeSink) AudioContext.prototype.setSinkId = async function(id) {
      window.__sinkCalls.push(id);
      if (id === window.__failSink) throw new DOMException('Synthetic output denial', 'NotAllowedError');
      if (window.__sinkDelay) await new Promise(resolve => setTimeout(resolve, window.__sinkDelay));
      // Custom IDs are API fixtures, never real user hardware. Native default routing is exercised.
      await nativeSink.call(this, '');
    };
    const nativeGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function() { const gain = nativeGain.call(this); if (this === window.__voiceContext && !window.__voiceGain) window.__voiceGain = gain; return gain; };
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
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__micCalls++;
      const input = constraints.audio.deviceId?.exact || ''; window.__inputRequests.push(input);
      if (window.__denyMic) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      if (input === window.__failInput) throw new DOMException('Synthetic missing input', 'NotFoundError');
      const context = new AudioContext({ sampleRate: 48000 }); await context.resume();
      const oscillator = context.createOscillator(); oscillator.frequency.value = ${440 + index * 220} + (input === 'fixture-mic-b' ? 110 : 0);
      const gain = context.createGain(); gain.gain.value = .15;
      const destination = context.createMediaStreamDestination(); oscillator.connect(gain).connect(destination); oscillator.start();
      window.__tracks.push(...destination.stream.getTracks());
      if (window.__delayMic) await new Promise(resolve => setTimeout(resolve, 800));
      destination.stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); context.close(); }; });
      return destination.stream;
    };
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(context, name, options) { super(context, name, options); if (name === 'vs-voice-playout') { window.__voiceContext = context; window.__voiceGain = null; const analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0; this.connect(analyser); window.__analyser = analyser; } }
    };
    ${index === 2 ? 'window.AudioEncoder = undefined; Object.defineProperty(AudioContext.prototype, "setSinkId", { value: undefined, configurable: true });' : ''}
  })();`);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        if (/fixture-(?:mic|headset|speaker)/.test(event.payload))
          errors.push('Local audio device identity leaked to room socket');
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
  await host.locator('#voice-devices > summary').click();
  await host.locator('#voice-devices-refresh').click();
  assert.equal(
    await host.evaluate('window.__micCalls'),
    0,
    'Device refresh does not capture microphone',
  );
  assert.equal((await status(host)).codec, 'opus');
  for (const page of [host, guest]) await page.locator('#voice-mic').click();
  await audio(host, 1);
  await audio(guest, 1);
  evidence.opus = [await status(host), await status(guest)];
  // Swap the actual generated capture source; the remote decoder must receive its new frequency.
  await host.locator('#voice-input').selectOption('fixture-mic-b');
  await host.waitForFunction(
    () =>
      (window as any).__inputRequests.at(-1) === 'fixture-mic-b' &&
      (window as any).__tracks[0].readyState === 'ended',
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const switchedTone = await guest.evaluate<number>(
    `(() => { const a = window.__analyser, v = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(v); return Math.max(...v.slice(Math.floor(520*a.fftSize/48000), Math.ceil(580*a.fftSize/48000))); })()`,
  );
  assert.ok(switchedTone > -35, 'Remote playout must contain the replacement microphone tone');
  await host.evaluate('window.__failInput = "fixture-mic-a"');
  await host.locator('#voice-input').selectOption('fixture-mic-a');
  await host.locator('#voice-status').filter({ hasText: '继续使用原麦克风' }).waitFor();
  assert.equal(await host.locator('#voice-input').inputValue(), 'fixture-mic-b');
  assert.equal((await status(host)).mic, true);
  await host.evaluate('window.__failInput = undefined');
  const micCallsBeforeOutput = await host.evaluate('window.__micCalls');
  await host.locator('#voice-output').selectOption('@choose');
  await host.waitForFunction(() => (window as any).__sinkCalls.at(-1) === 'fixture-headset');
  await host.locator('#voice-output:not(:disabled)').waitFor();
  assert.equal(await host.locator('#voice-output').inputValue(), 'fixture-headset');
  await host.evaluate('window.__failSink = "fixture-speaker"');
  await host.locator('#voice-output').selectOption('fixture-speaker');
  await host.locator('#voice-status').filter({ hasText: '未获得输出设备权限' }).waitFor();
  assert.equal(await host.locator('#voice-output').inputValue(), 'fixture-headset');
  await host.evaluate(
    'window.__failSink = undefined; window.__removedOutput = true; navigator.mediaDevices.dispatchEvent(new Event("devicechange"))',
  );
  await host.locator('#voice-status').filter({ hasText: '输出设备已断开' }).waitFor();
  assert.equal(
    await host.evaluate('window.__voiceGain.gain.value'),
    0,
    'Output removal mutes before falling back',
  );
  assert.equal(await host.locator('#voice-output').inputValue(), '');
  assert.equal(
    await host.evaluate('window.__micCalls'),
    micCallsBeforeOutput,
    'Output switching never requests microphone',
  );
  await host.locator('#voice-sound').click();
  assert.ok(await host.evaluate('window.__voiceGain.gain.value > 0'));
  // Muting remains available while a replacement microphone permission is pending.
  await host.evaluate('window.__delayMic = true');
  await host.locator('#voice-input').selectOption('fixture-mic-a');
  await host.locator('#voice-mic').click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(await host.evaluate('window.__tracks.every(t => t.readyState === "ended")'), true);
  await host.evaluate('window.__delayMic = false');
  await host.locator('#voice-mic').click();
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!).mic &&
      !document.querySelector<HTMLSelectElement>('#voice-input')!.disabled,
  );
  await audio(guest, 1);
  await host.evaluate(
    'window.__removedInput = true; navigator.mediaDevices.dispatchEvent(new Event("devicechange"))',
  );
  await host.locator('#voice-device-note').filter({ hasText: '输入设备已断开' }).waitFor();
  assert.equal((await status(host)).mic, false);
  assert.equal(await host.evaluate('window.__tracks.every(t => t.readyState === "ended")'), true);
  assert.equal(await host.locator('#voice-input').inputValue(), '');
  await host.locator('#voice-mic').click();
  await audio(guest, 1);
  await host.waitForFunction(
    () => !document.querySelector('#voice-device-note')!.textContent!.includes('输入设备已断开'),
  );
  evidence.devices = {
    microphoneSwitched: true,
    remoteReplacementToneDb: switchedTone,
    failedInputPreserved: true,
    outputApiBoundary: true,
    nativeDefaultOutput: true,
    failedOutputPreserved: true,
    removedOutputMuted: true,
    removedInputStopped: true,
    pendingInputCanceled: true,
    physicalDeviceSwitchVerified: false,
  };
  // One listener's short jitter must not stall or reconnect other members.
  evidence.beforeJitter = [await status(host), await status(guest)];
  await guest.evaluate('window.__lag = true');
  await new Promise((resolve) => setTimeout(resolve, 6500));
  await audio(guest, 1);
  evidence.jitter = [await status(host), await status(guest)];
  assert.ok(
    evidence.jitter[0].metrics[0].played > evidence.beforeJitter[0].metrics[0].played + 4 * 48000,
  );
  assert.ok(
    evidence.jitter[1].metrics[0].played > evidence.beforeJitter[1].metrics[0].played + 4 * 48000,
  );
  assert.ok(evidence.jitter[1].metrics[0].queuedMs <= 1000);
  await guest.evaluate('window.__lag = false');
  await compatibility.locator('#voice-join').click();
  await ready(host, 3);
  await ready(compatibility, 3);
  await compatibility.locator('#voice-devices > summary').click();
  assert.equal(await compatibility.locator('#voice-output').isDisabled(), true);
  await compatibility
    .locator('#voice-device-note')
    .filter({ hasText: '不能单独指定语音输出' })
    .waitFor();
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
  // Repeated speaking updates must preserve focus on the member mute control.
  const peerControl = host.locator('.voice-peer:not(:disabled)').first();
  await peerControl.focus();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await peerControl.evaluate((e) => document.activeElement === e), true);
  await peerControl.click();
  assert.equal(await peerControl.getAttribute('aria-pressed'), 'true');
  await peerControl.click();
  for (const width of [820, 390]) {
    await host.setViewportSize({ width, height: 950 });
    await host.locator('#voice-panel').screenshot({ path: `.local/voice-card-${width}.png` });
    await host.screenshot({ path: `.local/voice-room-${width}.png`, fullPage: true });
    assert.ok(
      await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `No horizontal overflow at ${width}px`,
    );
    if (width === 820) {
      const voice = await host.locator('#voice-panel').boundingBox(),
        chat = await host.locator('#chat-panel').boundingBox();
      assert.ok(
        voice && chat && chat.x >= voice.x + voice.width,
        'Tablet keeps chat beside the members and voice cards',
      );
    }
  }
  await host.setViewportSize({ width: 1360, height: 1000 });
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
  await host.evaluate('window.__sinkDelay = 600');
  await host.locator('#voice-output').selectOption('fixture-speaker');
  await host.waitForFunction(() => (window as any).__sinkCalls.at(-1) === 'fixture-speaker');
  await host.locator('#voice-leave').click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(
    await host.evaluate('localStorage.getItem("vs-voice-output")'),
    '',
    'Late output completion cannot overwrite preference after leave',
  );
  await host.evaluate('window.__sinkDelay = 0');
  await host.locator('#voice-output').selectOption('fixture-speaker');
  await host.locator('#voice-status').filter({ hasText: '已选择语音输出' }).waitFor();
  await host.evaluate('window.__failSink = "fixture-speaker"');
  await host.locator('#voice-join').click();
  await ready(host, 1);
  await host.locator('#voice-device-note').filter({ hasText: '上次输出设备不可用' }).waitFor();
  assert.equal(await host.evaluate('window.__voiceGain.gain.value'), 0);
  assert.equal(await host.locator('#voice-output').inputValue(), '');
  assert.equal((await status(host)).mic, false);
  await host.evaluate('window.__failSink = undefined');
  await host.locator('#voice-output').selectOption('fixture-speaker');
  await host.locator('#voice-output:not(:disabled)').waitFor();
  await host.locator('#voice-sound').click();
  await host.locator('#voice-leave').click();
  const sinkCallsBeforeRestore = await host.evaluate<number>('window.__sinkCalls.length');
  await host.locator('#voice-join').click();
  await ready(host, 1);
  assert.ok((await host.evaluate<number>('window.__sinkCalls.length')) > sinkCallsBeforeRestore);
  assert.equal(await host.locator('#voice-output').inputValue(), 'fixture-speaker');
  assert.equal((await status(host)).mic, false);
  await host.locator('#voice-leave').click();
  evidence.devices.lateOutputCanceled = true;
  evidence.devices.savedOutputRestored = true;
  evidence.devices.failedSavedOutputMuted = true;
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
  const states = await Promise.all(
    browser
      .contexts()
      .flatMap((c) => c.pages())
      .map((page) =>
        page
          .locator('#voice-panel')
          .evaluate((panel) => ({
            voice: panel.getAttribute('data-voice'),
            note: panel.querySelector('#voice-device-note')?.textContent,
            input: panel.querySelector<HTMLSelectElement>('#voice-input')?.value,
            output: panel.querySelector<HTMLSelectElement>('#voice-output')?.value,
          }))
          .catch(() => null),
      ),
  );
  console.error(JSON.stringify({ deviceStates: states }));
  console.error(JSON.stringify({ evidence, errors }));
  throw e;
} finally {
  await browser.close();
  await app?.close();
  await new Promise<void>((resolve) => source.close(() => resolve()));
}
