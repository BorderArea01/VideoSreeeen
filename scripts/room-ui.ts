import type { Page } from 'playwright';

export async function configureRoomServer(page: Page, origin: string) {
  await page.locator('#settings-button').click();
  if (!(await page.locator('#connection-details').evaluate((e) => (e as HTMLDetailsElement).open)))
    await page.locator('#connection-details > summary').click();
  await page.locator('#server-input').fill(origin);
  await page.locator('#settings-form button[type=submit]').click();
  await page.locator('#settings-status').filter({ hasText: '已保存' }).waitFor();
  await page.locator('[data-close="settings-dialog"]').first().click();
}

export async function openRoom(page: Page, intent: 'create' | 'join' = 'create') {
  if (!(await page.locator('#room-dialog').isVisible())) await page.locator('#room-button').click();
  await page.locator(`#${intent}-tab`).click();
}

export async function closeInvitation(page: Page) {
  await page.locator('#invite-dialog').waitFor();
  await page.locator('[data-close="invite-dialog"]').last().click();
}
