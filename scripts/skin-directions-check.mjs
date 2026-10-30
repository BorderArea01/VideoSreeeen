import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('docs/design/skin-directions');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
};
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const path = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname),
    );
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const file = (await stat(path)).isDirectory() ? resolve(path, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const local = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.VS_SKIN_PREVIEW_URL?.replace(/\/$/, '') || local;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
  args: ['--disable-extensions', '--mute-audio', '--js-flags=--max-old-space-size=128'],
});
const evidence = {
  at: new Date().toISOString(),
  productionAppChanged: false,
  publicPreview: origin !== local,
  realPhone: false,
  variants: {},
};
const failures = [],
  requests = [];
try {
  await mkdir('.local/screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('request', (req) => requests.push(req.url()));
  const fingerprint = () =>
    page.locator('#sky').evaluate((c) => {
      const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let hash = 2166136261;
      for (let i = 0; i < p.length; i += 256) hash = Math.imul(hash ^ p[i], 16777619);
      return hash;
    });
  const protectedFingerprint = () =>
    page.evaluate(() => {
      const c = document.querySelector('#sky'),
        r = document.querySelector('.screen').getBoundingClientRect();
      const b = c.getBoundingClientRect(),
        scale = c.width / b.width;
      const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let hash = 2166136261;
      for (let y = Math.max(0, r.top + 2); y < Math.min(innerHeight, r.bottom - 2); y += 11)
        for (let x = r.left + 2; x < r.right - 2; x += 11) {
          const i = (Math.floor(y * scale) * c.width + Math.floor(x * scale)) * 4;
          for (let k = 0; k < 3; k++) hash = Math.imul(hash ^ p[i + k], 16777619);
        }
      return hash;
    });
  const videoGuard = () =>
    page.evaluate(() => {
      const film = document.querySelector('.screen').getBoundingClientRect();
      let samples = 0,
        unsafePixels = 0;
      for (const c of document.querySelectorAll('.fracture-canvas')) {
        const r = c.getBoundingClientRect();
        const left = Math.max(r.left, film.left - 12),
          top = Math.max(r.top, film.top - 12);
        const right = Math.min(r.right, film.right + 12),
          bottom = Math.min(r.bottom, film.bottom + 12);
        if (left >= right || top >= bottom) continue;
        const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const sx = c.width / r.width,
          sy = c.height / r.height;
        for (let y = top + 1; y < bottom - 1; y += 2)
          for (let x = left + 1; x < right - 1; x += 2) {
            samples++;
            if (
              pixels[
                (Math.floor((y - r.top) * sy) * c.width + Math.floor((x - r.left) * sx)) * 4 + 3
              ] !== 0
            )
              unsafePixels++;
          }
      }
      return { samples, unsafePixels };
    });
  await page.goto(origin + '/index.html');
  await page.waitForFunction(() => document.querySelector('#sky').width > 1);
  await page.waitForTimeout(300);
  for (const variant of ['A', 'B', 'C', 'D']) {
    await page.locator(`nav a[href="#${variant}"]`).click();
    assert.equal(await page.locator('html').getAttribute('data-variant'), variant);
    await page.mouse.move(2, 190);
    await page.waitForTimeout(2200);
    const before = await fingerprint();
    const protectedBefore = await protectedFingerprint();
    await page.locator('#demonstrate').click();
    await page.waitForTimeout(500);
    const during = await fingerprint();
    assert.notEqual(before, during, `${variant} background has no response`);
    assert.equal(
      await protectedFingerprint(),
      protectedBefore,
      `${variant} background distortion entered video`,
    );
    const guard = await videoGuard();
    assert.ok(
      guard.samples > 0 && guard.unsafePixels === 0,
      `${variant} fragments entered video: ${JSON.stringify(guard)}`,
    );
    assert.equal(
      await page.locator('.source > .fracture-canvas').evaluate((c) => getComputedStyle(c).opacity),
      '0.9',
    );
    assert.equal(await page.locator('.source').evaluate((c) => getComputedStyle(c).opacity), '1');
    const material = await page.locator('.source > .fracture-canvas').evaluate((c) => {
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const box = c.parentElement.getBoundingClientRect();
      const ratio = c.width / (box.width + 96);
      const edge =
        (box.width +
          box.height -
          Math.sqrt((box.width + box.height) ** 2 - 0.32 * box.width * box.height)) /
        4;
      let gaps = 0,
        coreSamples = 0,
        damagedCore = 0;
      const alpha = (x, y) =>
        pixels[(Math.floor(y * ratio) * c.width + Math.floor(x * ratio)) * 4 + 3];
      // Core remains opaque and continuous while the outer band breaks.
      for (let y = edge + 2; y < box.height - edge - 2; y += 3)
        for (let x = edge + 2; x < box.width - edge - 2; x += 9) {
          coreSamples++;
          if (alpha(48 + x, 40 + y) !== 255) damagedCore++;
        }
      for (let y = 0; y < box.height; y++) if (alpha(48 + 2, 40 + y) < 10) gaps++;
      return {
        active: c.dataset.active,
        fragments: Number(c.dataset.fragments),
        energy: Number(c.dataset.energy),
        gaps,
        coreSamples,
        damagedCore,
        intactAreaFraction:
          ((box.width - edge * 2) * (box.height - edge * 2)) / (box.width * box.height),
      };
    });
    assert.equal(material.active, 'true', `${variant} body fragments not animated`);
    assert.ok(material.fragments >= 22 && material.energy > 0.1);
    assert.ok(material.intactAreaFraction >= 0.919);
    assert.ok(
      material.gaps > 5 && material.coreSamples > 100 && material.damagedCore === 0,
      `${variant} breaks the core or lacks edge cuts: ${JSON.stringify(material)}`,
    );
    assert.equal(
      await page.locator('.source').evaluate((e) => getComputedStyle(e).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    await page.screenshot({ path: `.local/screenshots/skin-${variant}-motion.png` });
    await page.waitForTimeout(2500);
    const settled = await fingerprint();
    await page.waitForTimeout(200);
    assert.equal(await fingerprint(), settled, `${variant} did not settle`);
    // Each wake is stamped at a past location; moving the pointer creates a new wake.
    await page.mouse.move(10, 250);
    await page.mouse.move(45, 380, { steps: 5 });
    await page.waitForTimeout(350);
    assert.notEqual(await fingerprint(), settled, `${variant} pointer wake did not evolve`);
    const button = page.locator('.voice .primary');
    await button.hover();
    await page.waitForTimeout(100);
    assert.equal(
      await button
        .locator('.fracture-canvas')
        .evaluate((e) => e.dataset.active === 'true' && Number(e.dataset.fragments) >= 12),
      true,
    );
    await button.click();
    await page.locator('#notice').waitFor();
    await page.locator('#chat-input').fill(`仅本机交互预览 ${variant}`);
    await page.locator('.send').click();
    await page
      .locator('#chat-messages p')
      .filter({ hasText: `仅本机交互预览 ${variant}` })
      .waitFor();
    await page.waitForTimeout(2200);
    await page.mouse.move(2, 190);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `.local/screenshots/skin-${variant}.png`, fullPage: true });
    for (const width of [390, 320, 2000]) {
      await page.setViewportSize({ width, height: width === 2000 ? 1100 : 844 });
      await page.waitForTimeout(80);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
        console.log(
          await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .map((e) => ({
                tag: e.tagName,
                cls: e.className,
                left: e.getBoundingClientRect().left,
                right: e.getBoundingClientRect().right,
              }))
              .filter((x) => x.left < -0.5 || x.right > innerWidth + 0.5)
              .slice(0, 20),
          ),
        );
        await page.screenshot({ path: '.local/screenshots/skin-overflow.png', fullPage: true });
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${variant} overflow at ${width}`,
      );
      const canvas = await page.locator('#sky').boundingBox();
      assert.ok(canvas.width >= width - 1);
      const resizedGuard = await videoGuard();
      assert.equal(resizedGuard.unsafePixels, 0, `${variant} fragments overlap video at ${width}`);
      if (width === 390)
        await page.screenshot({
          path: `.local/screenshots/skin-${variant}-mobile.png`,
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#demonstrate').click();
    const reduced = await fingerprint();
    await page.waitForTimeout(700);
    assert.equal(await fingerprint(), reduced);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    evidence.variants[variant] = {
      liveBackground: true,
      surfaceFragments: material,
      videoGuard: guard,
      containerOpacity: 0.9,
      buttonFeedback: true,
      settles: true,
      reducedMotion: true,
      widths: [320, 390, 1440, 2000],
    };
  }
  await page.goto(origin + '/board.html');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('iframe').count(), 4);
  await page.locator('#play-all').click();
  await page.waitForTimeout(500);
  for (const frame of page.frames().slice(1)) {
    assert.equal(
      await frame.locator('.source > .fracture-canvas').getAttribute('data-active'),
      'true',
    );
  }
  await page.screenshot({ path: '.local/screenshots/skin-directions-board.png', fullPage: true });
  assert.deepEqual(failures, []);
  assert.ok(
    requests.every((url) => url.startsWith(origin)),
    'preview made an external or room request',
  );
  evidence.noRoomOrThirdPartyRequests = true;
  evidence.passed = true;
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await writeFile(
    `.local/skin-directions${origin === local ? '' : '-public'}-evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
