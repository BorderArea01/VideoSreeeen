import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { waitForTheme } from './room-ui';

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
  ...(process.env.VS_TEST_PROXY ? { proxy: { server: process.env.VS_TEST_PROXY } } : {}),
});
const proof: Record<string, any> = {
  at: new Date().toISOString(),
  origin,
  cases: [],
  realPhone: false,
};
const errors: string[] = [];
try {
  for (const saved of [null, 'classic', 'glitch', 'signal', 'removed-theme']) {
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: saved
          ? [{ origin, localStorage: [{ name: 'videosreeeen.appearance', value: saved }] }]
          : [],
      },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const expected = saved === 'glitch' || saved === 'signal' ? saved : 'classic';
    await waitForTheme(page, expected);
    // A stale automatic session from the old release must not override a preference/default.
    await page.evaluate(() => sessionStorage.setItem('videosreeeen.appearance.session', 'signal'));
    await page.reload();
    await waitForTheme(page, expected);
    const tab = await context.newPage();
    await tab.goto(origin);
    await waitForTheme(tab, expected);
    const state = await context.storageState();
    await context.close();
    const reopened = await browser.newContext({ storageState: state });
    const next = await reopened.newPage();
    await next.goto(origin);
    await waitForTheme(next, expected);
    await reopened.close();
    proof.cases.push({ saved, expected, reload: true, newTab: true, restoredStorageContext: true });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = 1;
        return array;
      }
      return original(array);
    }) as typeof crypto.getRandomValues;
  });
  const page = await context.newPage();
  await page.goto(origin);
  await waitForTheme(page, 'classic');
  await page.locator('#appearance-button').click();
  await page.locator('#appearance-random').click();
  await waitForTheme(page, 'glitch');
  await page.waitForFunction(() => localStorage.getItem('videosreeeen.appearance') === 'glitch');
  await page.reload();
  await waitForTheme(page, 'glitch');
  const tab = await context.newPage();
  await tab.goto(origin);
  await waitForTheme(tab, 'glitch');
  await tab.close();
  await page.locator('#appearance-button').click();
  await page.locator('.theme-choice:has(input[value="classic"])').click();
  await waitForTheme(page, 'classic');
  await page.waitForFunction(() => localStorage.getItem('videosreeeen.appearance') === 'classic');
  await mkdir('.local/screenshots', { recursive: true });
  await page
    .locator('.appearance-settings')
    .screenshot({ path: '.local/screenshots/theme-preference.png' });
  await page.reload();
  await waitForTheme(page, 'classic');
  proof.randomOnlyOnRequestAndRemembered = true;
  proof.returnToClassicPersists = true;
  await context.close();
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  const privatePage = await blocked.newPage();
  await privatePage.goto(origin);
  await waitForTheme(privatePage, 'classic');
  await privatePage.locator('#appearance-button').click();
  await privatePage.locator('.theme-choice:has(input[value="signal"])').click();
  await waitForTheme(privatePage, 'signal');
  await blocked.close();
  proof.blockedStorageStillUsable = true;
  assert.deepEqual(errors, []);
  proof.passed = true;
} finally {
  await browser.close();
  await app?.close();
  proof.cleanup = true;
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/theme-preference-${process.env.VS_PUBLIC_URL ? 'public' : 'local'}.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
}
console.log(JSON.stringify(proof));
