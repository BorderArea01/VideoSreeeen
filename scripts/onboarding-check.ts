import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { configureRoomServer, openRoom, closeInvitation } from './room-ui';

const apps = [createApp(), createApp()];
for (const app of apps) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
}
const [origin, other] = apps.map((app) => `http://127.0.0.1:${(app.server.address() as any).port}`);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
const failures: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const first = await context.newPage(),
    second = await context.newPage();
  for (const page of [first, second]) page.on('pageerror', (e) => failures.push(e.message));
  await first.goto(origin!);
  await first.locator('#hero-create').click();
  assert.equal(await first.locator('#server-input').isVisible(), false);
  assert.equal(await first.locator('#invite-input').isVisible(), false);
  await first.locator('#name-input').fill('放映员');
  await first.locator('#create-button').click();
  await first.locator('#invite-dialog').waitFor();
  const invite = await first.locator('#invite-link').inputValue();
  assert.equal(new URL(invite).origin, origin);
  assert.ok(new URL(invite).hash.length > 30);
  // Clipboard permissions are not guaranteed, especially inside native WebViews.
  await first.evaluate(
    "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText() { return Promise.reject(new Error('denied')); } } })",
  );
  await first.locator('#copy-link').click();
  await first.locator('#invite-feedback').filter({ hasText: '已选中' }).waitFor();
  assert.equal(
    await first.locator('#invite-link').evaluate((e) => (e as HTMLInputElement).selectionEnd),
    invite.length,
  );
  await mkdir(resolve('.local/screenshots'), { recursive: true });
  await first.screenshot({
    path: resolve('.local/screenshots/invitation.png'),
    mask: [first.locator('#invite-link')],
  });
  await closeInvitation(first);
  await second.goto(invite);
  await second.locator('#room-dialog').waitFor();
  assert.equal(await second.locator('#join-tab').getAttribute('aria-pressed'), 'true');
  await second.locator('#dialog-close').click();
  await configureRoomServer(second, other!);
  await second.reload();
  await second.locator('#room-dialog').waitFor();
  assert.equal(await second.locator('#invite-input').inputValue(), invite);
  await openRoom(second, 'join');
  await second.locator('#name-input').fill('远方的朋友');
  // A complete invitation overrides the default server without overwriting it.
  const invalid = invite.replace(/.$/, '!');
  await second.locator('#invite-input').fill(invalid);
  await second.locator('#join-button').click();
  await second.locator('#dialog-error').filter({ hasText: '完整邀请' }).waitFor();
  assert.equal(await second.locator('#join-button').isEnabled(), true);
  await second.locator('#invite-input').fill(invite);
  await second.locator('#join-button').click();
  await second.locator('#connection.online').waitFor();
  assert.equal(await second.evaluate(() => localStorage.getItem('server')), other);
  assert.equal(new URL(second.url()).hash, new URL(invite).hash);
  await first.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await second.locator('#chat-input').fill('打开邀请就能加入 🍿');
  await second.locator('#send-button').click();
  await first.getByText('打开邀请就能加入 🍿', { exact: true }).waitFor();
  // Changing next-room preferences must not affect an existing session's invitation.
  await configureRoomServer(first, other!);
  await first.locator('#invite-button').click();
  assert.equal(await first.locator('#invite-link').inputValue(), invite);
  await closeInvitation(first);
  const activeRoom = [...apps[0]!.rooms.rooms.values()][0]!;
  const seat = [...activeRoom.members.values()].find((s) => s.name === '放映员')!;
  seat.socket!.close(1012, 'onboarding reconnect check');
  await first.locator('#connection:not(.online)').waitFor();
  await first.locator('#connection.online').waitFor();
  assert.equal(apps[1]!.rooms.rooms.size, 0);
  assert.equal(activeRoom.members.size, 2);
  await first.screenshot({
    path: resolve('.local/screenshots/onboarding-desktop.png'),
    fullPage: true,
  });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.locator('#settings-button').click();
  assert.equal(
    await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await second.screenshot({
    path: resolve('.local/screenshots/onboarding-mobile.png'),
    fullPage: true,
  });
  await second.locator('[data-close="settings-dialog"]').first().click();
  await second.locator('#leave-button').click();
  await first.locator('#leave-button').click();
  assert.equal(await second.locator('#sync-status').textContent(), '等待加入房间');
  await second.screenshot({
    path: resolve('.local/screenshots/onboarding-mobile-lobby.png'),
    fullPage: true,
  });
  const joinBounds = await second.locator('#hero-join').boundingBox(),
    stageBounds = await second.locator('#stage').boundingBox();
  assert.ok(
    joinBounds &&
      stageBounds &&
      joinBounds.y + joinBounds.height <= stageBounds.y + stageBounds.height,
  );
  await second.locator('#hero-join').click();
  await second.locator('#join-button').waitFor();
  await second.locator('#dialog-close').click();
  assert.deepEqual(failures, []);
  await writeFile(
    resolve('.local/onboarding-evidence.json'),
    JSON.stringify(
      {
        firstRunWithoutServer: true,
        automaticInvitation: true,
        clipboardFallback: true,
        deepLinkJoin: true,
        invalidInviteRetry: true,
        inviteServerOverride: true,
        serverPreferencePreserved: true,
        activeRoomPreserved: true,
        reconnectUsesActiveServer: true,
        mobileWidth: 390,
        chat: true,
        pageErrors: failures,
      },
      null,
      2,
    ),
  );
  console.log(
    'Onboarding: create, auto invitation, clipboard fallback, deep link, retry, server preferences, chat and mobile passed.',
  );
} finally {
  await browser.close();
  for (const app of apps) await app.close();
}
