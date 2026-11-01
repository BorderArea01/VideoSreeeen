import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, playbackSettings } from './room-ui';

const scenario = process.env.VS_BOOST_SCENARIO || 'normal';
assert.ok(['normal', 'unsupported', 'failure'].includes(scenario));
const bytes = await readFile('.local/cache-window-fixture.mp4');
await mkdir('.local/screenshots', { recursive: true });
const source = createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(bytes.length - 1, range?.[2] ? Number(range[2]) : bytes.length - 1);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', end - start + 1);
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  }
  res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const movie = process.env.VS_PUBLIC_URL
  ? 'https://boost-fixture.videosreeeen.test/movie.mp4'
  : `http://127.0.0.1:${(source.address() as any).port}/movie.mp4`;
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
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
});
const proof: Record<string, any> = {
  at: new Date().toISOString(),
  origin,
  scenario,
  syntheticAudioOnly: true,
  physicalOutputMuted: true,
  realPhone: false,
};
const errors: string[] = [],
  commands: string[] = [];
const volume = async (page: Page, percent: number) => {
  await page.locator('#video-volume').evaluate((el, value) => {
    (el as HTMLInputElement).value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, percent);
};
const rms = async (page: Page) => {
  await page.waitForTimeout(180);
  return page.evaluate<number>(
    `(() => { const a=window.__movieAnalyser||window.__boostAnalysers.at(-1); if(!a)return 0;const b=new Float32Array(a.fftSize);a.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length); })()`,
  );
};
try {
  const contexts = [await browser.newContext(), await browser.newContext()];
  for (const [index, context] of contexts.entries()) {
    await context.addInitScript(`(() => {
      Object.defineProperty(window,'showDirectoryPicker',{value:undefined});
      localStorage.setItem('videosreeeen.appearance','classic');
      window.__boostContexts=[];window.__boostAnalysers=[];window.__boostGains=[];window.__boostTracks=[];window.__elementBindings=0;window.__micCalls=0;
      const capture=HTMLMediaElement.prototype.captureStream;
      if(${JSON.stringify(scenario)}==='unsupported' && ${index}===1) HTMLMediaElement.prototype.captureStream=undefined;
      else if(capture) HTMLMediaElement.prototype.captureStream=function(){const s=capture.call(this);window.__boostTracks.push(...s.getTracks());return s;};
      const Original=window.AudioContext;
      window.AudioContext=class extends Original {
        constructor(...args){super(...args);window.__boostContexts.push(this);}
        createMediaElementSource(...args){window.__elementBindings++;return super.createMediaElementSource(...args);}
        createMediaStreamSource(...args){if(${JSON.stringify(scenario)}==='failure' && ${index}===1)throw new Error('isolated injected graph failure');return super.createMediaStreamSource(...args);}
        createGain(){const n=super.createGain();window.__boostGains.push(n);return n;}
        createDynamicsCompressor(){const n=super.createDynamicsCompressor(),a=this.createAnalyser();n.connect(a);window.__boostAnalysers.push(a);return n;}
      };
      navigator.mediaDevices.getUserMedia=async()=>{
        window.__micCalls++;if(!window.__allowSyntheticMic)throw new Error('No real microphone in this test');
        const c=window.__syntheticMic=new Original(),o=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();
        o.frequency.value=660;g.gain.value=.15;o.connect(g).connect(d);o.start();await c.resume();window.__syntheticTracks=d.stream.getTracks();return d.stream;
      };
    })()`);
    await context.route(origin + '/config', async (route) => {
      const r = await route.fetch();
      await route.fulfill({
        response: r,
        json: { ...(await r.json()), mediaRelay: false, p2p: false },
      });
    });
    if (app)
      await context.route(origin + '/cache-plan/**', async (route) => {
        const r = await route.fetch(),
          plan = await r.json();
        for (const f of plan.files) {
          f.url = f.directUrl;
          delete f.directUrl;
        }
        await route.fulfill({ response: r, json: plan });
      });
    if (process.env.VS_PUBLIC_URL)
      await context.route(movie, (route) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? ''),
          start = Number(range?.[1] ?? 0),
          end = Math.min(bytes.length - 1, range?.[2] ? Number(range[2]) : bytes.length - 1);
        return route.fulfill({
          status: range ? 206 : 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range',
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
          },
          body:
            route.request().method() === 'HEAD' ? Buffer.alloc(0) : bytes.subarray(start, end + 1),
        });
      });
  }
  const owner = await contexts[0].newPage(),
    viewer = await contexts[1].newPage();
  for (const p of [owner, viewer]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('websocket', (s) =>
      s.on('framesent', (e) => {
        try {
          const m = JSON.parse(String(e.payload));
          if (['control', 'media', 'mode', 'unshare'].includes(m.type)) commands.push(m.type);
        } catch {}
      }),
    );
  }
  await owner.goto(origin + '/?skin=classic');
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('音量增强隔离测试');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('独立音量观众');
  await viewer.locator('#join-button').click();
  await selectSource(owner, movie);
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  assert.equal(await viewer.locator('#video-volume').getAttribute('max'), '100');
  await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
  await owner.locator('#mode-toggle').click();
  for (const p of [owner, viewer]) {
    await p.locator('#cache-button').click();
    await p
      .locator('#cache-title')
      .filter({ hasText: '本机已准备好' })
      .waitFor({ state: 'attached', timeout: 30000 });
  }
  await owner
    .locator('#mode-description')
    .filter({ hasText: '大家都已准备好' })
    .waitFor({ state: 'attached' });
  assert.match((await viewer.locator('#video').getAttribute('src')) ?? '', /^blob:/);
  await owner.locator('#play-button').click();
  await viewer.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.2,
  );
  const stable = commands.length;
  if (scenario === 'normal') {
    assert.equal(await viewer.locator('#video-volume').getAttribute('max'), '200');
    await volume(viewer, 150);
    await viewer.locator('#video-volume-note[data-boost="active"]').waitFor({ state: 'attached' });
    const at150 = await rms(viewer);
    await volume(viewer, 200);
    const at200 = await rms(viewer);
    assert.ok(at150 > 0.05);
    assert.ok(at200 / at150 > 1.25 && at200 / at150 < 1.42);
    assert.equal(await viewer.locator('#video-volume-value').textContent(), '200%');
    assert.equal(await owner.locator('#video-volume').inputValue(), '100');
    await viewer.locator('#live-sound').click();
    assert.ok((await rms(viewer)) < 0.001);
    await viewer.locator('#live-sound').click();
    assert.ok((await rms(viewer)) > 0.1);
    assert.equal(commands.length, stable, 'Volume and mute must not change the room');
    proof.amplitude = { at150, at200, ratio: at200 / at150, muteAndUnmute: true };
    await playbackSettings(viewer);
    await viewer
      .locator('.player-settings-panel')
      .screenshot({ path: '.local/screenshots/movie-boost-settings.png' });
    await playbackSettings(viewer, false);
    await viewer.locator('#seek').evaluate((e) => {
      (e as HTMLInputElement).value = '2';
      e.dispatchEvent(new Event('change'));
    });
    await viewer.waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.currentTime >= 2 && !v.seeking && !v.paused;
    });
    assert.ok((await rms(viewer)) > 0.1);
    proof.seekKeepsSound = true;
    await viewer.evaluate(
      'window.__movieAnalyser=window.__boostAnalysers.at(-1);window.__movieGain=window.__boostGains.at(-1)',
    );
    await owner.evaluate('window.__allowSyntheticMic=true');
    for (const p of [owner, viewer]) {
      await p.locator('#voice-join').click();
      await p.waitForFunction(
        () => JSON.parse(document.querySelector<HTMLElement>('#voice-panel')!.dataset.voice!).ready,
      );
    }
    await owner.locator('#voice-mic').click();
    await viewer.waitForFunction(
      () => Math.abs(document.querySelector<HTMLVideoElement>('#video')!.volume - 0.5) < 0.01,
    );
    const speaking = await rms(viewer);
    assert.ok(
      speaking / at200 > 0.15 && speaking / at200 < 0.35,
      'Received real synthetic voice must duck boosted movie output',
    );
    await volume(viewer, 160);
    await viewer.waitForFunction(
      () => Math.abs(document.querySelector<HTMLVideoElement>('#video')!.volume - 0.4) < 0.01,
    );
    await owner.locator('#voice-mic').click();
    await viewer.waitForFunction('window.__movieGain.gain.value > 1.59');
    const restored = await rms(viewer);
    assert.ok(restored / at200 > 0.7 && restored / at200 < 0.9);
    for (const p of [owner, viewer]) await p.locator('#voice-leave').click();
    await owner.evaluate('window.__syntheticMic.close()');
    assert.equal(
      await owner.evaluate('window.__syntheticTracks.every(t=>t.readyState==="ended")'),
      true,
    );
    await viewer.evaluate('window.__movieAnalyser=null');
    proof.boostedVoicePriority = {
      speakingRms: speaking,
      restoredRms: restored,
      manualChangeDuringSpeech: true,
      syntheticMicrophoneReleased: true,
    };
    // Returning below 100% disposes captured tracks and the audio context.
    await volume(viewer, 80);
    await viewer.waitForFunction(
      `window.__boostContexts.every(c=>c.state==='closed')&&window.__boostTracks.every(t=>t.readyState==='ended')`,
    );
    assert.equal(
      await viewer.locator('#video').evaluate((v) => (v as HTMLVideoElement).muted),
      false,
    );
    await volume(viewer, 200);
    await viewer.locator('#video-volume-note[data-boost="active"]').waitFor({ state: 'attached' });
  } else {
    await volume(viewer, 200);
    await viewer.waitForFunction(
      () => document.querySelector<HTMLInputElement>('#video-volume')!.max === '100',
    );
    assert.equal(
      await viewer.locator('#video').evaluate((v) => (v as HTMLVideoElement).muted),
      false,
    );
    assert.equal(commands.length, stable);
    proof.safeFallback = true;
  }
  await owner.locator('#cache-options').evaluate((e: HTMLDetailsElement) => (e.open = true));
  await owner.locator('#mode-toggle').click();
  await viewer.waitForFunction(() =>
    document.querySelector<HTMLVideoElement>('#video')!.currentSrc.startsWith('http'),
  );
  await viewer.waitForFunction(
    `window.__boostContexts.every(c=>c.state==='closed')&&window.__boostTracks.every(t=>t.readyState==='ended')`,
  );
  assert.equal(await viewer.locator('#video-volume').getAttribute('max'), '100');
  await viewer.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return v.readyState >= 2 && !v.muted;
  });
  assert.equal(
    await viewer.locator('#video').evaluate((v) => (v as HTMLVideoElement).muted),
    false,
  );
  await owner.locator('#play-button').click();
  const before = await viewer
    .locator('#video')
    .evaluate((v) => (v as any).webkitAudioDecodedByteCount);
  await viewer.waitForFunction(
    (before) =>
      (document.querySelector('#video') as any).webkitAudioDecodedByteCount > before + 1000,
    before,
  );
  proof.remoteSourceAfterBoostStillHasSound = true;
  proof.resources = await viewer.evaluate(
    `({contexts:window.__boostContexts.length,allClosed:window.__boostContexts.every(c=>c.state==='closed'),tracksEnded:window.__boostTracks.every(t=>t.readyState==='ended'),permanentElementBindings:window.__elementBindings,microphoneRequests:window.__micCalls})`,
  );
  assert.equal(proof.resources.permanentElementBindings, 0);
  assert.equal(proof.resources.microphoneRequests, 0);
  assert.deepEqual(errors, []);
  proof.errors = errors;
  proof.passed = true;
  await viewer.locator('#leave-button').click();
  await owner.locator('#leave-button').click();
} finally {
  await browser.close();
  await app?.close();
  await new Promise<void>((r) => source.close(() => r()));
  proof.cleanup = true;
  await writeFile(
    `.local/movie-boost-${scenario}${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
}
console.log(JSON.stringify(proof, null, 2));
