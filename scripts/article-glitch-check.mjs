import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const source = resolve('docs/design/article-glitch');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let file = resolve(source, '.' + pathname);
    if (file !== source && !file.startsWith(source + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (pathname === '/sky.png') file = resolve('client/assets/themes/daylight-sky.png');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const local = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.VS_ARTICLE_PREVIEW_URL?.replace(/\/$/, '') || local;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--disable-extensions', '--mute-audio', '--js-flags=--max-old-space-size=96'],
  ...(process.env.VS_TEST_PROXY
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: '127.0.0.1,localhost' } }
    : {}),
});
const evidence = {
  at: new Date().toISOString(),
  origin,
  staticDesignOnly: true,
  realPhone: false,
  variants: {},
};
const errors = [],
  requests = [];
try {
  await mkdir('.local/screenshots', { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1030 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.route(
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    (route) => route.fulfill({ path: resolve('.local/flower.mp4'), contentType: 'video/mp4' }),
  );
  for (const scheme of ['a', 'b', 'c', 'd']) {
    await page.goto(`${origin}/?scheme=${scheme}`, { waitUntil: 'networkidle' });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1150);
    assert.equal(await page.locator('html').getAttribute('data-scheme'), scheme);
    assert.equal(
      await page.locator(`[data-choice=${scheme}]`).getAttribute('aria-current'),
      'page',
    );
    assert.equal(
      await page.locator('canvas').count(),
      0,
      'Fresh design cannot use the rejected Canvas engine',
    );
    if (origin === local) {
      await page.screenshot({
        path: resolve(source, `${scheme}.jpg`),
        type: 'jpeg',
        quality: 88,
        fullPage: true,
      });
    }
    const button = page.locator('.primary');
    await button.hover();
    await page.waitForTimeout(100);
    const active = await button.evaluate((el) => {
      const copy = el.querySelector('.control-copy');
      const s = copy ? getComputedStyle(copy) : getComputedStyle(el, '::after');
      return {
        name: s.animationName,
        easing: s.animationTimingFunction,
        duration: s.animationDuration,
        text: copy?.textContent ?? s.content,
        clip: s.clipPath,
        transform: s.transform,
        pointerEvents: s.pointerEvents,
      };
    });
    assert.equal(active.name, 'control-cut');
    assert.equal(active.easing, 'steps(2)');
    assert.equal(active.pointerEvents, 'none');
    assert.ok(active.text.includes('同步此链接'));
    await page.screenshot({ path: resolve(`.local/screenshots/article-${scheme}-active.png`) });
    await page.waitForTimeout(1100);
    assert.equal(
      await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      ),
      0,
      'Finite motion must stop while hovered',
    );
    const frame = await page.locator('.conversation').boundingBox();
    await page.mouse.move(frame.x + frame.width - 4, frame.y + frame.height / 3);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('.conversation').evaluate((el) => el.classList.contains('is-glitching')),
      true,
    );
    const filmZ = await page.evaluate(() => ({
      surface: +getComputedStyle(document.querySelector('.video-surface')).zIndex,
      effect: +getComputedStyle(document.querySelector('.film-frame .edge-copy')).zIndex,
    }));
    assert.ok(filmZ.surface > filmZ.effect, 'All video pixels above decorative fragments');
    await page.mouse.move(9, 270);
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('.sky').evaluate((el) => el.classList.contains('is-glitching')),
      true,
    );
    await page.waitForTimeout(1150);
    assert.equal(
      await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      ),
      0,
    );
    await page.getByRole('tab', { name: '共享画面' }).click();
    await page.getByRole('tab', { name: '共享画面' }).press('ArrowRight');
    assert.equal(await page.locator('[data-mode=file]').getAttribute('aria-selected'), 'true');
    await page.locator('.message-form input').fill('<img src=x> 本机 👋');
    await page.locator('.message-form button').click();
    assert.equal(await page.locator('.messages img').count(), 0);
    assert.ok((await page.locator('.messages').innerText()).includes('<img src=x> 本机 👋'));
    const initialChatHeight = await page.locator('.conversation').evaluate((el) => el.clientHeight);
    await page.locator('.messages').evaluate((el) => {
      for (let i = 0; i < 25; i++) el.append(el.firstElementChild.cloneNode(true));
    });
    const log = await page
      .locator('.messages')
      .evaluate((el) => ({ height: el.clientHeight, total: el.scrollHeight }));
    assert.ok(log.total > log.height);
    assert.equal(
      await page.locator('.conversation').evaluate((el) => el.clientHeight),
      initialChatHeight,
      'Chat history cannot grow the panel',
    );
    await page.locator('.chat-toggle').click();
    assert.equal(await page.locator('.conversation').isVisible(), false);
    await page.locator('.chat-toggle').click();
    await page.locator('.voice-preview').click();
    assert.equal(await page.locator('.voice-panel').isVisible(), true);
    await page.locator('.source-form').evaluate((el) => el.requestSubmit());
    assert.ok((await page.locator('.toast').innerText()).includes('独立设计预览'));
    await page.locator('.load-film').click();
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
    });
    evidence.variants[scheme] = {
      button: active,
      video: await page
        .locator('video')
        .evaluate((v) => ({ width: v.videoWidth, height: v.videoHeight, paused: v.paused })),
      palettes: await page.evaluate(() => ({
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
        panel: getComputedStyle(document.documentElement).getPropertyValue('--panel'),
      })),
    };
    await page.locator('.motion-toggle').click();
    await page.locator('.primary').hover();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `No horizontal overflow for ${scheme} at ${width}`,
      );
      assert.ok(await page.locator('.chat-body').evaluate((el) => el.clientHeight <= 400));
    }
    await page.screenshot({
      path: resolve(`.local/screenshots/article-${scheme}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1030 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.motion-toggle').click();
    await page.locator('.primary').hover();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  assert.equal(new Set(Object.values(evidence.variants).map((v) => v.palettes.accent)).size, 4);
  assert.equal(
    requests.some((url) => /^(wss?|https?):.*\/(ws|voice|broadcast-relay)(\?|$)/.test(url)),
    false,
  );
  assert.deepEqual(errors, []);
  await page.goto(`${origin}/board.html`, { waitUntil: 'networkidle' });
  assert.equal(
    await page
      .locator('.card img')
      .evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0)),
    true,
  );
  await page.setViewportSize({ width: 1760, height: 1515 });
  await page.screenshot({
    path:
      origin === local
        ? resolve(source, 'overview.jpg')
        : resolve('.local/screenshots/article-overview-public.jpg'),
    type: 'jpeg',
    quality: 92,
    fullPage: true,
  });
  await context.close();
  await writeFile('.local/article-glitch-verification.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
