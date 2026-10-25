import type { Page } from 'playwright';

export async function playbackSettings(page: Page, open = true) {
  if (
    (await page.locator('#player-settings').evaluate((e) => (e as HTMLDetailsElement).open)) !==
    open
  )
    await page.locator('#player-settings > summary').click();
}

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

export async function choosePlayback(page: Page, mode: 'screen' | 'link' | 'file') {
  await page.locator('#choose-' + mode).click();
}

export async function selectSource(page: Page, url: string, provideScreen = false) {
  await choosePlayback(page, 'link');
  await page.locator('#source-url').fill(url);
  await page.locator('#source-form button').click();
  if (provideScreen) await page.locator('#link-use-screen').click();
}
