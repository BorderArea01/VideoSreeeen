import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource, playbackSettings, waitForTheme } from './room-ui';

await mkdir('.local/screenshots', { recursive: true });
const data = await readFile('.local/sintel-trailer.mp4').catch(async () => {
  const response = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4', {
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile('.local/sintel-trailer.mp4', bytes);
  return bytes;
});
const source = createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ''),
    start = Number(range?.[1] ?? 0),
    end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', end - start + 1);
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const app = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || `http://127.0.0.1:${(app!.server.address() as any).port}`;
const movie = process.env.VS_PUBLIC_URL
  ? 'https://focus-fixture.videosreeeen.test/movie.mp4'
  : `http://127.0.0.1:${(source.address() as any).port}/movie.mp4`;
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
const proof: Record<string, any> = {
  at: new Date().toISOString(),
  origin,
  realPhone: false,
  physicalOutputMuted: true,
  cases: [],
};
const idle = (p: Page) =>
  p.waitForFunction(
    () => document.querySelector('#player-shell')!.classList.contains('player-idle'),
    undefined,
    { timeout: 2500 },
  );
const hidden = (p: Page) =>
  p.locator('#player-shell').evaluate((e) => e.classList.contains('player-idle'));
try {
  for (const theme of ['classic', 'glitch', 'signal']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (app)
      await context.route(origin + '/config', async (route) => {
        const r = await route.fetch();
        await route.fulfill({ response: r, json: { ...(await r.json()), mediaRelay: false } });
      });
    if (process.env.VS_PUBLIC_URL)
      await context.route(movie, (route) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? ''),
          start = Number(range?.[1] ?? 0),
          end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
        return route.fulfill({
          status: range ? 206 : 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
          },
          body: data.subarray(start, end + 1),
        });
      });
    const page = await context.newPage(),
      commands: string[] = [],
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (s) =>
      s.on('framesent', (e) => {
        try {
          const m = JSON.parse(String(e.payload));
          if (['media', 'control', 'mode', 'unshare'].includes(m.type)) commands.push(m.type);
        } catch {}
      }),
    );
    await page.goto(origin + '/?skin=' + theme);
    await waitForTheme(page, theme);
    await page.locator('#hero-create').click();
    await page.locator('#name-input').fill('全屏焦点隔离验收');
    await page.locator('#create-button').click();
    await closeInvitation(page);
    await selectSource(page, movie);
    await page.waitForFunction(
      () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
    );
    await page.locator('#play-button').click();
    await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')!.paused);
    await page.evaluate(
      `window.__focusVideo=document.querySelector('#video');window.__focusLoads=0;window.__focusVideo.addEventListener('loadstart',()=>window.__focusLoads++);`,
    );
    for (const mode of ['page', 'system']) {
      await page.locator('#seek').evaluate((e) => {
        (e as HTMLInputElement).value = '0';
        e.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(
        () => document.querySelector<HTMLVideoElement>('#video')!.currentTime < 3,
      );
      const sample: Record<string, any> = { theme, mode };
      proof.cases.push(sample);
      if (mode === 'page') await page.locator('#page-fullscreen').click();
      else {
        await page.locator('#fullscreen').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.fullscreenElement?.id === 'player-shell');
      }
      const before = commands.length;
      await idle(page);
      sample.entryHides = true;
      await page.locator('#fullscreen').evaluate((e) => (e as HTMLElement).focus());
      sample.programmaticFocusKeepsHidden = await hidden(page);
      assert.equal(
        sample.programmaticFocusKeepsHidden,
        true,
        'Restored fullscreen-button focus must not reveal the controls',
      );
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.transport')!).opacity === '0',
      );
      sample.controlsActuallyInvisible = true;
      if (mode === 'page')
        await page.screenshot({ path: `.local/screenshots/fullscreen-focus-${theme}.png` });
      await page.keyboard.press('Shift');
      assert.equal(
        await hidden(page),
        true,
        'Modifier keys must not reveal controls or pin their focus',
      );
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.locator('#fullscreen').evaluate((e) => {
        (e as HTMLElement).blur();
        (e as HTMLElement).focus();
      });
      assert.equal(await hidden(page), true, 'Window focus restoration must not reveal controls');
      sample.focusRestoreKeepsHidden = true;
      await page.mouse.move(400, 300);
      await idle(page);
      await page.mouse.move(400, 300);
      assert.equal(
        await hidden(page),
        true,
        'A zero-distance pointer event must not wake the controls',
      );
      sample.stationaryPointerKeepsHidden = true;
      await page.mouse.move(410, 310);
      assert.equal(await hidden(page), false);
      sample.realMovementWakes = true;
      await idle(page);
      await page.locator('#fullscreen').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await hidden(page), false);
      assert.equal(
        await page.evaluate(() => !!document.activeElement?.closest('.transport')),
        true,
      );
      await page.waitForTimeout(1300);
      assert.equal(await hidden(page), false);
      sample.keyboardNavigationKeepsVisible = true;
      await page.locator('#player-settings > summary').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        () => document.querySelector<HTMLDetailsElement>('#player-settings')!.open,
      );
      await page.keyboard.press('Escape');
      await idle(page);
      sample.escapeFromSettingsDoesNotPinFocus = true;
      assert.equal(
        commands.length,
        before,
        'Focus and fullscreen changes must not send room operations',
      );
      sample.noRoomOperationsFromFocus = true;
      await page.mouse.move(420, 320);
      await page.locator('#play-button').click();
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#video')!.paused);
      await page.waitForTimeout(1300);
      assert.equal(await hidden(page), false);
      sample.pausedKeepsControls = true;
      await page.locator('#play-button').click();
      // Public room operations need a server acknowledgement before playback
      // resumes; that network round trip is separate from the idle deadline.
      await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')!.paused);
      await idle(page);
      if (mode === 'page') {
        await page.mouse.move(430, 330);
        await page.locator('#page-fullscreen').click();
      } else await page.evaluate(() => document.exitFullscreen());
      assert.equal(await hidden(page), false);
      assert.equal(
        await page.evaluate(
          `window.__focusVideo===document.querySelector('#video')&&window.__focusLoads===0`,
        ),
        true,
      );
      sample.samePlayerNoReload = true;
    }
    assert.deepEqual(errors, []);
    await page.locator('#leave-button').click();
    await context.close();
  }
  proof.passed = true;
} finally {
  await browser.close();
  await app?.close();
  await new Promise<void>((r) => source.close(() => r()));
  proof.cleanup = true;
  await writeFile(
    process.env.VS_FOCUS_EVIDENCE ||
      `.local/fullscreen-focus${process.env.VS_PUBLIC_URL ? '-public' : ''}-evidence.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
}
console.log(JSON.stringify(proof, null, 2));
