import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation } from './room-ui';

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
    ? { proxy: { server: process.env.VS_TEST_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const proof: any = {
  at: new Date().toISOString(),
  production: !!process.env.VS_PUBLIC_URL,
  realPhone: false,
  controls: [],
  widths: [],
};
try {
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  await context.addInitScript(() => localStorage.setItem('videosreeeen.appearance', 'glitch'));
  const page = await context.newPage();
  const errors: string[] = [],
    operations: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (s) =>
    s.on('framesent', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (['media', 'control', 'mode', 'cache', 'unshare'].includes(m.type))
          operations.push(m.type);
      } catch {}
    }),
  );
  await page.goto(origin);
  await page.locator('#hero-create').click();
  await page.locator('#name-input').fill('天光按钮验收');
  await page.locator('#create-button').click();
  await closeInvitation(page);
  await page.evaluate(() => document.fonts.ready);
  const inspect = async () => {
    const styles = await page.locator('button, a.button').evaluateAll((nodes) =>
      nodes
        .filter((n) => n.checkVisibility() && !n.closest('.player-shell') && !n.matches('.switch'))
        .map((n) => {
          const s = getComputedStyle(n);
          return {
            id: n.id || n.getAttribute('data-close') || n.textContent?.trim().slice(0, 15),
            radius: s.borderRadius,
            border: s.borderWidth,
            background: s.backgroundColor,
            color: s.color,
          };
        }),
    );
    assert.ok(styles.length > 5);
    for (const style of styles) assert.equal(style.radius, '6px', JSON.stringify(style));
    proof.controls.push(...styles);
  };
  await page.mouse.move(1, 1);
  await page.waitForTimeout(160);
  await inspect();
  const primary = ['#source-form .button', '#choose-link', '#send-button'];
  for (const selector of primary) {
    assert.equal(
      await page.locator(selector).evaluate((n) => getComputedStyle(n).backgroundColor),
      'rgb(0, 83, 230)',
      selector,
    );
    await page.locator(selector).hover();
    await page.waitForTimeout(180);
    assert.equal(
      await page.locator(selector).evaluate((n) => getComputedStyle(n).backgroundColor),
      'rgb(0, 71, 202)',
      selector,
    );
    await page.mouse.move(1, 1);
    await page.waitForTimeout(160);
  }
  await page.locator('.daylight-voice > summary').click();
  await inspect();
  assert.equal(
    await page.locator('#voice-join').evaluate((n) => getComputedStyle(n).backgroundColor),
    'rgb(0, 83, 230)',
  );
  await page.locator('.daylight-voice > summary').click();
  await page.locator('#invite-button').click();
  await inspect();
  await closeInvitation(page);
  await page.locator('#appearance-button').click();
  await inspect();
  for (const [value, name] of [
    ['glitch', '天光断层'],
    ['signal', '紫电噪讯'],
  ]) {
    const choice = page.locator(`.theme-choice:has(input[value="${value}"])`);
    assert.equal((await choice.locator('.theme-choice-name').innerText()).trim(), name);
    assert.equal(await choice.locator('.theme-choice-name small').count(), 0);
  }
  await page.keyboard.press('Tab');
  await page.locator('#appearance-random').focus();
  assert.equal(
    await page.locator('#appearance-random').evaluate((n) => getComputedStyle(n).outlineWidth),
    '2px',
  );
  for (const width of [1536, 850, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    proof.widths.push(width);
    await mkdir('.local/screenshots', { recursive: true });
    if (width === 1536)
      await page
        .locator('#settings-dialog')
        .screenshot({ path: '.local/screenshots/daylight-controls-settings.png' });
  }
  await page.locator('[data-close="settings-dialog"]').first().click();
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page
    .locator('#playback-picker')
    .screenshot({ path: '.local/screenshots/daylight-controls-panel.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(operations, []);
  proof.noRoomOperations = true;
  proof.passed = true;
  await page.locator('#leave-button').click();
} catch (error) {
  proof.error = String(error);
  proof.passed = false;
  throw error;
} finally {
  await browser.close();
  await app?.close();
  proof.browserClosed = true;
  await writeFile(
    `.local/daylight-controls-${process.env.VS_PUBLIC_URL ? 'public' : 'local'}-evidence.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: proof.passed,
      controls: proof.controls.length,
      widths: proof.widths,
      error: proof.error,
    }),
  );
}
