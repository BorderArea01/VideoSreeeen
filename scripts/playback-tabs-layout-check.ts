import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { choosePlayback, closeInvitation, selectSource, waitForTheme } from './room-ui';

const baseline = process.env.VS_LAYOUT_BASELINE === '1';
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
const proof: any = {
  at: new Date().toISOString(),
  production: !!process.env.VS_PUBLIC_URL,
  baseline,
  realPhone: false,
  rooms: 'isolated',
  cases: [],
};
const errors: string[] = [];
const commands: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1556, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('videosreeeen.appearance', 'signal'));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (['media', 'control', 'mode', 'unshare', 'cache'].includes(m.type))
          commands.push(m.type);
      } catch {}
    }),
  );
  await page.goto(origin);
  await page.locator('#hero-create').click();
  await page.locator('#name-input').fill('按钮布局验收');
  await page.locator('#create-button').click();
  await closeInvitation(page);
  await page.evaluate(() => document.fonts.ready);
  const measure = () =>
    page.locator('.playback-tabs').evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      buttons: [...el.querySelectorAll('button')].map((b) => {
        const box = b.getBoundingClientRect(),
          label = b.querySelector(':scope > span')!.getBoundingClientRect();
        return {
          height: box.height,
          contentFits:
            label.top >= box.top - 1 &&
            label.bottom <= box.bottom + 1 &&
            label.left >= box.left - 1 &&
            label.right <= box.right + 1,
        };
      }),
      pageFits: document.documentElement.scrollWidth <= innerWidth,
    }));
  for (const theme of ['signal', 'glitch', 'classic']) {
    await page.locator('#appearance-button').click();
    await page.locator(`.theme-choice:has(input[value="${theme}"])`).click();
    await waitForTheme(page,theme);
    await page.locator('[data-close="settings-dialog"]').first().click();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1556, 1920, 1200, 1160, 850, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await choosePlayback(page, 'link');
      await page.locator('#source-url').fill('');
      const normal = await measure();
      await selectSource(page, 'https://www.bilibili.com/video/BV1eYxy6UEMj/');
      await page.locator('#bili-extension-help').waitFor();
      const error = await measure();
      const modes = [];
      for (const mode of ['screen', 'file', 'link'] as const) {
        await choosePlayback(page, mode);
        modes.push({ mode, ...(await measure()) });
      }
      const result = { theme, width, normal, error, modes };
      proof.cases.push(result);
      if (width === 1556 && theme === 'signal') {
        await mkdir('.local/screenshots', { recursive: true });
        await page.locator('#playback-picker').screenshot({
          path: `.local/screenshots/playback-tabs-${baseline ? 'before' : 'after'}.png`,
        });
      }
      if (!baseline) {
        for (const state of [normal, error, ...modes]) {
          assert.ok(state.pageFits, JSON.stringify(result));
          for (let i = 0; i < 3; i++) {
            assert.ok(state.buttons[i]!.contentFits, JSON.stringify(result));
            assert.ok(
              Math.abs(state.buttons[i]!.height - normal.buttons[i]!.height) < 3,
              JSON.stringify(result),
            );
          }
        }
      }
    }
  }
  assert.deepEqual(commands, [], 'Presentation changes must not submit room operations');
  assert.deepEqual(errors, []);
  proof.noRoomOperations = true;
  proof.passed = true;
  await page.locator('#leave-button').click();
} catch (error) {
  proof.passed = false;
  proof.error = String(error);
  throw error;
} finally {
  await browser.close();
  await app?.close();
  proof.browserClosed = true;
  await writeFile(
    `.local/playback-tabs-${baseline ? 'baseline' : process.env.VS_PUBLIC_URL ? 'public' : 'local'}-evidence.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: proof.passed,
      cases: proof.cases.length,
      first: proof.cases[0],
      error: proof.error,
    }),
  );
}
