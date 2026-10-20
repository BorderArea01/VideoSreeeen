import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Real media and WSS, with delayed pong replies only in this test viewer.
// The room's RTT challenge messages and displayed member RTT are not rewritten.
const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const expectOld = process.env.VS_EXPECT_CLOCK_JUMPS === '1';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [
    '--mute-audio',
    '--disable-extensions',
    '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=96',
  ],
});
const timers = new Set<ReturnType<typeof setTimeout>>();
const proof: Record<string, any> = {
  origin,
  delayedPongMs: 4000,
  realMedia: true,
  realAndroidDevice: false,
  expectOld,
};
const movie = 'https://media.w3.org/2010/05/sintel/trailer.mp4';
proof.media = movie;
try {
  const a = await browser.newContext(),
    b = await browser.newContext(devices['Pixel 7']);
  if (app)
    for (const context of [a, b])
      await context.route(origin + '/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
      });
  let jitter = false,
    pong = 0;
  await b.routeWebSocket('**/ws?*', (socket) => {
    const upstream = socket.connectToServer();
    upstream.onMessage((message) => {
      let hold = false;
      if (typeof message === 'string')
        try {
          const m = JSON.parse(message);
          hold = jitter && m.type === 'pong' && ++pong % 2 === 1;
        } catch {}
      if (hold) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          try {
            socket.send(message);
          } catch {}
        }, 4000);
        timers.add(timer);
      } else socket.send(message);
    });
    socket.onMessage((message) => upstream.send(message));
  });
  const owner = await a.newPage(),
    viewer = await b.newPage();
  await viewer.addInitScript({
    content: `(() => {
    window.__clockSeeks=[]; window.__targetJumps=[]; window.__clockObserve=false;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...descriptor,set(value){if(this.id==='video'){let ahead=0;for(let i=0;i<this.buffered.length;i++)if(this.buffered.start(i)<=this.currentTime&&this.buffered.end(i)>this.currentTime)ahead=this.buffered.end(i)-this.currentTime;window.__clockSeeks.push({from:this.currentTime,to:value,at:performance.now(),ahead});}descriptor.set.call(this,value);}});
    let previous=null;
    setInterval(()=>{const value=Number(document.querySelector('#seek')?.value);const at=performance.now();if(window.__clockObserve&&previous){const jump=value-previous.value-(at-previous.at)/1000;if(Math.abs(jump)>1)window.__targetJumps.push({jump,from:previous.value,to:value});}previous={value,at};},100);
  })();`,
  });
  const errors: string[] = [];
  for (const p of [owner, viewer]) p.on('pageerror', (e) => errors.push(e.message));
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('校时抖动验证');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  await viewer.goto(invite);
  await viewer.locator('#name-input').fill('延迟心跳观众');
  await viewer.locator('#join-button').click();
  await owner.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await selectSource(owner, movie);
  for (const p of [owner, viewer])
    await p.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return v.readyState >= 2;
      },
      {},
      { timeout: 45000 },
    );
  await owner.locator('#play-button').click();
  for (const p of [owner, viewer])
    await p.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        let ahead = 0;
        for (let i = 0; i < v.buffered.length; i++)
          if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) > v.currentTime)
            ahead = v.buffered.end(i) - v.currentTime;
        return ahead >= 10 && v.getVideoPlaybackQuality().totalVideoFrames > 12;
      },
      {},
      { timeout: 30000 },
    );
  await viewer.evaluate(() => {
    (window as any).__clockSeeks = [];
    (window as any).__clockObserve = true;
  });
  jitter = true;
  for (let i = 0; i < 5; i++) {
    await owner.waitForTimeout(5000);
    // A same-revision state update must not take the latest high RTT as an
    // excuse to move the playback epoch either.
    await owner.locator('#chat-input').fill('校时观察 ' + (i + 1));
    await owner.locator('#send-button').click();
  }
  jitter = false;
  await viewer.evaluate(() => {
    (window as any).__clockObserve = false;
  });
  proof.seeks = await viewer.evaluate(() => (window as any).__clockSeeks);
  proof.targetJumps = await viewer.evaluate(() => (window as any).__targetJumps);
  proof.players = [];
  for (const p of [owner, viewer])
    proof.players.push(
      await p.locator('#video').evaluate((v: HTMLVideoElement) => ({
        time: v.currentTime,
        frames: v.getVideoPlaybackQuality().totalVideoFrames,
        rate: v.playbackRate,
        width: v.videoWidth,
        ready: v.readyState,
      })),
    );
  if (expectOld)
    assert.ok(
      proof.seeks.length >= 2 && proof.targetJumps.length >= 2,
      'Old midpoint clock should reproduce repeated automatic seeks',
    );
  else {
    assert.deepEqual(
      proof.targetJumps,
      [],
      'Delay-only telemetry and chat must not jump the authoritative projection',
    );
    assert.deepEqual(
      proof.seeks.filter((s: any) => s.to < s.from || s.ahead >= 10),
      [],
      'No backward or adequately buffered hard seeks',
    );
    assert.ok(Math.abs(proof.players[0].time - proof.players[1].time) < 0.6);
    const decodedBefore = await Promise.all(
      [owner, viewer].map((p) =>
        p
          .locator('#video')
          .evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames),
      ),
    );
    await owner.locator('#seek').evaluate((element) => {
      (element as HTMLInputElement).value = '45';
      element.dispatchEvent(new Event('change'));
    });
    for (const [index, p] of [owner, viewer].entries())
      await p.waitForFunction(
        (before) => {
          const v = document.querySelector<HTMLVideoElement>('#video')!;
          return (
            Math.abs(v.currentTime - 45) < 1 &&
            !v.seeking &&
            v.readyState >= 2 &&
            v.getVideoPlaybackQuality().totalVideoFrames > before + 5
          );
        },
        decodedBefore[index],
        { timeout: 15000 },
      );
    proof.explicitSeekImmediate = true;
  }
  proof.errors = errors;
  assert.deepEqual(errors, []);
  await owner.locator('#leave-button').click();
  await viewer.locator('#leave-button').click();
  console.log(JSON.stringify(proof));
} finally {
  for (const t of timers) clearTimeout(t);
  await browser.close();
  await app?.close();
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/playback-clock-' + (expectOld ? 'before' : 'after') + '.json',
    JSON.stringify(proof, null, 2),
  );
}
