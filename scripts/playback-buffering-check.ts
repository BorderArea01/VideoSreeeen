import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

await mkdir('.local', { recursive: true });
let data: Buffer;
try {
  data = await readFile('.local/sintel-trailer.mp4');
} catch {
  const response = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4');
  assert.ok(response.ok);
  data = Buffer.from(await response.arrayBuffer());
  await writeFile('.local/sintel-trailer.mp4', data);
}
const timers = new Set<ReturnType<typeof setTimeout>>();
let stalls = 0;
const source = createServer((req, res) => {
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  if (start > end) {
    res.writeHead(416).end();
    return;
  }
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  if (
    !req.headers['user-agent']?.includes('VS-Slow-Playback') ||
    start > data.length - 256 * 1024 ||
    end - start < 160 * 1024
  ) {
    res.end(data.subarray(start, end + 1));
    return;
  }
  const first = Math.min(end + 1, start + 160 * 1024);
  res.write(data.subarray(start, first));
  stalls++;
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (res.destroyed) return;
    const next = Math.min(end + 1, first + 32768);
    res.write(data.subarray(first, next));
    const finish = setTimeout(() => {
      timers.delete(finish);
      if (!res.destroyed) res.end(data.subarray(next, end + 1));
    }, 3000);
    timers.add(finish);
    res.on('close', () => {
      clearTimeout(finish);
      timers.delete(finish);
    });
  }, 8000);
  timers.add(timer);
  res.on('close', () => {
    clearTimeout(timer);
    timers.delete(timer);
  });
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const movie = `http://127.0.0.1:${(source.address() as any).port}/sintel.mp4`;
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
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: Record<string, any> = { origin, stallMs: 8000, realAndroidDevice: false };
try {
  const contexts = [
    await browser.newContext(),
    await browser.newContext(devices['Pixel 7']),
    await browser.newContext({ userAgent: 'Mozilla/5.0 VS-Slow-Playback' }),
  ];
  if (app)
    for (const context of contexts)
      await context.route(origin + '/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), mediaRelay: false } });
      });
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const commands: string[][] = [[], [], []],
    errors: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (s) =>
      s.on('framesent', (e) => {
        try {
          const m = JSON.parse(String(e.payload));
          if (['control', 'media'].includes(m.type)) commands[i].push(m.action ?? m.type);
        } catch {}
      }),
    );
    await page.addInitScript({
      content: `(()=>{window.__bufferEvents=[];window.__bufferSeeks=[];window.__observe=false;const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...d,set(value){if(this.id==='video'&&window.__observe)window.__bufferSeeks.push({from:this.currentTime,to:value,at:performance.now()});d.set.call(this,value);}});for(const event of ['waiting','playing','stalled'])document.addEventListener(event,e=>{if(e.target.id==='video'&&window.__observe)window.__bufferEvents.push({event,time:e.target.currentTime,at:performance.now()});},true);})();`,
    });
  }
  const [owner, healthy, slow] = pages;
  await owner.goto(origin);
  await owner.locator('#hero-create').click();
  await owner.locator('#name-input').fill('连续播放');
  await owner.locator('#create-button').click();
  await owner.locator('#invite-dialog').waitFor();
  const invite = await owner.locator('#invite-link').inputValue();
  await closeInvitation(owner);
  for (const [i, page] of [healthy, slow].entries()) {
    await page.goto(invite);
    await page.locator('#name-input').fill(i ? '缓冲观众' : '正常观众');
    await page.locator('#join-button').click();
  }
  await owner.locator('#member-count').filter({ hasText: '3' }).waitFor();
  await selectSource(owner, movie);
  for (const page of pages)
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
      {},
      { timeout: 30000 },
    );
  await owner.locator('#play-button').click();
  for (const page of pages)
    await page.evaluate(() => {
      (window as any).__observe = true;
    });
  await slow.waitForFunction(
    () => (window as any).__bufferEvents.some((e: any) => e.event === 'waiting'),
    {},
    { timeout: 15000 },
  );
  await slow.locator('#sync-status').filter({ hasText: '本机缓冲中' }).waitFor({ timeout: 3000 });
  proof.statusDuringStall = await slow.locator('#sync-status').textContent();
  await slow.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return !v.seeking && v.readyState >= 3 && v.currentTime > 9;
    },
    {},
    { timeout: 30000 },
  );
  await slow.waitForTimeout(2500);
  proof.players = [];
  for (const page of pages)
    proof.players.push(
      await page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return {
          time: v.currentTime,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
          events: (window as any).__bufferEvents,
          seeks: (window as any).__bufferSeeks,
        };
      }),
    );
  proof.commands = commands.map((v) => v.slice());
  proof.heldRequests = stalls;
  assert.ok(stalls > 0);
  assert.deepEqual(commands[1], []);
  assert.deepEqual(commands[2], []);
  for (const p of proof.players.slice(0, 2)) {
    assert.equal(p.seeks.length, 0);
    assert.equal(p.events.filter((e: any) => e.event === 'waiting').length, 0);
    assert.ok(p.frames > 150);
  }
  assert.ok(proof.players[2].events.some((e: any) => e.event === 'waiting'));
  assert.ok(proof.players[2].seeks.every((s: any) => s.to >= s.from));
  assert.ok(
    Math.abs(proof.players[2].time - proof.players[0].time) < 0.8,
    'Slow viewer must recover toward the unchanged room timeline',
  );
  // A real manual rewind still belongs to everyone, even from the slow member.
  await slow.locator('#seek').fill('4');
  await slow.locator('#seek').dispatchEvent('change');
  for (const page of pages)
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#video')!;
        return v.currentTime >= 4 && v.currentTime < 6 && !v.seeking;
      },
      {},
      { timeout: 15000 },
    );
  proof.explicitRewind = true;
  for (const page of pages) await page.locator('#leave-button').click();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(proof, null, 2));
} finally {
  for (const t of timers) clearTimeout(t);
  await browser.close();
  source.closeAllConnections();
  await new Promise<void>((r) => source.close(() => r()));
  if (app) await app.close();
  await writeFile('.local/playback-buffering-evidence.json', JSON.stringify(proof, null, 2));
}
