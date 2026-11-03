import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, waitForTheme } from './room-ui';

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
const proof: any = {
  at: new Date().toISOString(),
  origin,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  cases: [],
  realPhone: false,
};
try {
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator('#hero-create').click();
  await page.locator('#name-input').fill('统一布局隔离验收');
  await page.locator('#create-button').click();
  await closeInvitation(page);
  await page.evaluate(() => {
    (window as any).__layoutParents = new Map(
      [...document.querySelectorAll('*')].map((el) => [el, el.parentElement]),
    );
    (window as any).__layoutNodes = [
      ...document.querySelectorAll(
        '#video,#audio,#chat-panel,#voice-panel,#playback-picker,#sidebar-invite,.room-heading',
      ),
    ];
  });
  for (const width of [1440, 850, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    let baseline: any;
    for (const theme of ['classic', 'glitch', 'signal', 'classic']) {
      await page.locator('#appearance-button').click();
      await page.locator(`.theme-choice:has(input[value="${theme}"])`).click();
      await waitForTheme(page, theme);
      await page.locator('[data-close="settings-dialog"]').first().click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      const material = await page.evaluate(() => {
        const orb = getComputedStyle(document.querySelector('.scene-orb')!);
        const lines = document.querySelector('.scene-lines')!;
        const invite = document.querySelector<HTMLElement>('#sidebar-invite')!;
        const style = getComputedStyle(invite),
          box = invite.getBoundingClientRect();
        const icon = invite.querySelector('svg')!.getBoundingClientRect();
        return {
          orb: orb.opacity,
          lines: getComputedStyle(lines).backgroundImage,
          silhouette: getComputedStyle(lines, '::after').backgroundColor,
          padding: [style.paddingTop, style.paddingBottom],
          iconOffset: Math.abs(box.y + box.height / 2 - icon.y - icon.height / 2),
          headerBlocks: getComputedStyle(document.querySelector('.top-actions')!).backgroundColor,
          brandPlate: getComputedStyle(document.querySelector('.brand')!, '::before').content,
        };
      });
      assert.equal(material.padding[0], material.padding[1]);
      assert.ok(material.iconOffset <= 1, JSON.stringify(material));
      if (theme === 'classic') assert.equal(material.orb, '0.7');
      else {
        assert.equal(material.orb, '0');
        assert.equal(material.lines, 'none');
        assert.equal(material.silhouette, 'rgba(0, 0, 0, 0)');
      }
      if (theme === 'glitch') {
        assert.equal(material.headerBlocks, 'rgba(0, 0, 0, 0)');
        assert.equal(material.brandPlate, 'none');
      }
      const state = await page.evaluate(() => {
        const ids = [
          '.topbar',
          '.workspace',
          '.screen-column',
          '#sidebar',
          '.room-heading',
          '#playback-picker',
          '#voice-panel',
          '#chat-panel',
          '#sidebar-invite',
          '#choose-link',
          '#choose-screen',
          '#choose-file',
        ];
        const geometry = Object.fromEntries(
          ids.map((id) => {
            const el = document.querySelector<HTMLElement>(id)!;
            const style = getComputedStyle(el);
            return [
              id,
              {
                parentUnchanged: el.parentElement === (window as any).__layoutParents.get(el),
                display: style.display,
                grid: style.gridTemplateColumns,
                order: style.order,
                outOfFlow: ['fixed', 'absolute'].includes(style.position),
                visible: el.checkVisibility(),
                width: el.getBoundingClientRect().width,
              },
            ];
          }),
        );
        return {
          geometry,
          overflow: document.documentElement.scrollWidth > innerWidth,
          sameNodes: [
            ...document.querySelectorAll(
              '#video,#audio,#chat-panel,#voice-panel,#playback-picker,#sidebar-invite,.room-heading',
            ),
          ].every((el, i) => el === (window as any).__layoutNodes[i]),
          portals: document.querySelectorAll('.theme-voice,.theme-members,.theme-utilities').length,
        };
      });
      assert.ok(state.sameNodes);
      assert.equal(state.portals, 0);
      assert.equal(state.overflow, false, `${theme}: ${width}px overflow`);
      if (!baseline) baseline = state.geometry;
      for (const [id, actual] of Object.entries(state.geometry)) {
        const { width: actualWidth, ...placement } = actual as any;
        const { width: expectedWidth, ...expected } = baseline[id];
        assert.deepEqual(placement, expected, `${theme} ${width}px ${id} placement`);
        assert.ok(
          Math.abs(actualWidth - expectedWidth) <= 3,
          `${theme} ${width}px ${id} width changed`,
        );
      }
      await page.locator('#voice-join').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#voice-join').isVisible(), true);
      await page.locator('#sidebar-invite').click();
      await closeInvitation(page);
      if (width === 1440 || width === 390) {
        await page.evaluate(() => scrollTo(0, 0));
        await mkdir('.local/screenshots', { recursive: true });
        await page.screenshot({
          path: `.local/screenshots/unified-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      proof.cases.push({ width, theme, sameLayout: true, sameNodes: true, noOverflow: true });
    }
  }
  assert.deepEqual(errors, []);
  await page.locator('#leave-button').click();
  proof.passed = true;
} finally {
  await browser.close();
  await app?.close();
  proof.cleanup = true;
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/theme-layout-${process.env.VS_PUBLIC_URL ? 'public' : 'local'}.json`,
    JSON.stringify(proof, null, 2),
  );
}
console.log(JSON.stringify(proof));
