import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function checkChatCollapse(page: Page) {
  const panel = page.locator('#chat-panel');
  const initial = await page.locator('#player-shell').boundingBox();
  assert.ok(initial);
  const draft = await page.locator('#chat-input').inputValue();
  await page.evaluate(() => {
    (window as any).__sidebarNodes = [
      'video',
      'audio',
      'chat-panel',
      'voice-panel',
      'chat-input',
    ].map((id) => document.getElementById(id));
  });
  // A click or an actual pointer sweep on the title no longer undocks anything.
  await page.locator('#chat-heading > div').first().click();
  assert.equal(await panel.evaluate((el) => el.classList.contains('floating')), false);
  assert.equal(await page.locator('#chat-dock, #chat-drag').count(), 0);
  await page.locator('#chat-collapse').click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.locator('#chat-restore').isVisible(), true);
  assert.equal(await page.locator('#chat-toggle').getAttribute('aria-expanded'), 'false');
  const expanded = await page.locator('#player-shell').boundingBox();
  assert.ok(expanded);
  if (page.viewportSize()!.width >= 1200)
    assert.ok(expanded.width > initial.width + 200, JSON.stringify({ initial, expanded }));
  await page.locator('#chat-restore').click();
  assert.equal(await panel.isVisible(), true);
  assert.equal(await page.locator('#chat-restore').isVisible(), false);
  assert.equal(await page.locator('#chat-input').inputValue(), draft);
  assert.equal(
    await page.evaluate(() =>
      ['video', 'audio', 'chat-panel', 'voice-panel', 'chat-input'].every(
        (id, i) => document.getElementById(id) === (window as any).__sidebarNodes[i],
      ),
    ),
    true,
  );
  const restored = await page.locator('#player-shell').boundingBox();
  assert.ok(restored);
  assert.ok(Math.abs(restored.width - initial.width) <= 1);
  return {
    initialWidth: initial.width,
    collapsedWidth: expanded.width,
    restoredWidth: restored.width,
  };
}

export async function checkRoomPopovers(page: Page) {
  async function foreground(selector: string) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box);
    assert.ok(
      box.x >= 11 && box.x + box.width <= page.viewportSize()!.width - 11,
      'Popover must fit the viewport: ' + JSON.stringify(box),
    );
    const failures = await page.locator(selector).evaluate((panel) => {
      const rect = panel.getBoundingClientRect(),
        failures: string[] = [];
      for (const dx of [0.1, 0.5, 0.9])
        for (const dy of [0.12, 0.3, 0.65]) {
          const x = rect.x + rect.width * dx,
            y = rect.y + rect.height * dy;
          if (y >= innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (!top || !panel.contains(top))
            failures.push(top?.id || top?.className?.toString() || 'none');
        }
      return failures;
    });
    assert.deepEqual(failures, [], 'Other controls paint over the open popover');
  }
  // Themes no longer create member/voice popovers. Both original cards remain
  // in the default sidebar and must stay visible and unobstructed.
  for (const selector of ['#voice-panel', '#sidebar > .members-card:not(.voice-card)']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await foreground(selector);
  }
  assert.equal(await page.locator('.theme-voice,.theme-members,.theme-utilities').count(), 0);
}
