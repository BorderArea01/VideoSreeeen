import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
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
const evidence: Record<string, any> = { origin, syntheticOnly: true };
const errors: string[] = [];
const identities = new Map<Page, string[]>();
const sent = new Map<Page, string[]>();
async function page() {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  identities.set(page, []);
  sent.set(page, []);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    socket.on('framereceived', (e) => {
      if (typeof e.payload === 'string') {
        const m = JSON.parse(e.payload);
        if (m.type === 'welcome') identities.get(page)!.push(m.memberId);
      }
    });
    socket.on('framesent', (e) => {
      if (typeof e.payload === 'string') sent.get(page)!.push(JSON.parse(e.payload).type);
    });
  });
  return page;
}
async function online(page: Page, count: number) {
  await page.locator('#connection.online').waitFor();
  await page.waitForFunction(
    (n) => document.querySelectorAll('#members .member').length === n,
    count,
  );
}
try {
  const host = await page(),
    guest = await page();
  await host.goto(origin);
  await host.locator('#hero-create').click();
  await host.locator('#name-input').fill('刷新房主');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('刷新观众');
  await guest.locator('#join-button').click();
  await online(host, 2);
  await online(guest, 2);
  const originalHost = identities.get(host)![0],
    originalGuest = identities.get(guest)![0];
  for (let i = 0; i < 3; i++) {
    await host.reload();
    await online(host, 2);
    await online(guest, 2);
    assert.equal(identities.get(host)!.at(-1), originalHost);
    assert.equal(await host.locator('#room-dialog').isVisible(), false);
    await host.waitForFunction(() =>
      [...document.querySelectorAll('#members .member-info small')].every(
        (e) => e.textContent === '在线',
      ),
    );
  }
  await guest.reload();
  await online(guest, 2);
  await online(host, 2);
  assert.equal(identities.get(guest)!.at(-1), originalGuest);
  assert.equal(await guest.locator('#room-dialog').isVisible(), false);
  let dropped = false;
  await host.evaluate(() => localStorage.setItem('server', 'https://not-room.example'));
  await host.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    if (!dropped) {
      dropped = true;
      socket.close({ code: 1012, reason: 'fixture reconnect before welcome' });
    } else socket.connectToServer();
  });
  await host.reload();
  await online(host, 2);
  await online(guest, 2);
  assert.equal(dropped, true);
  assert.equal(
    await host
      .locator('#members .member')
      .filter({ hasText: '（我）' })
      .locator('.latency')
      .getAttribute('data-member'),
    originalHost,
  );
  const saved = await guest.evaluate(() => sessionStorage.getItem('vs-room-session'));
  assert.ok(saved);
  const copied = await page();
  await copied.addInitScript((raw) => sessionStorage.setItem('vs-room-session', raw!), saved);
  await copied.goto(invite);
  await copied.locator('#room-dialog').waitFor();
  assert.equal(await copied.locator('#connection.online').count(), 0);
  await copied.locator('#name-input').fill('刷新观众');
  await copied.locator('#join-button').click();
  await online(host, 3);
  await online(copied, 3);
  assert.notEqual(identities.get(copied)![0], originalGuest);
  assert.equal(
    await guest.locator('#connection.online').count(),
    1,
    'New tab never takes over an active member',
  );
  await copied.locator('#leave-button').click();
  await online(host, 2);
  await guest.locator('#leave-button').click();
  await online(host, 1);
  assert.equal(await guest.evaluate(() => sessionStorage.getItem('vs-room-session')), null);
  await guest.reload();
  await guest.locator('#room-dialog').waitFor();
  assert.equal(await guest.locator('#connection.online').count(), 0);
  const rejected = await page();
  await rejected.goto(origin);
  await rejected.evaluate((raw) => {
    const record = JSON.parse(raw!);
    record.invite = 'ZZZ234:' + 'a'.repeat(32);
    sessionStorage.setItem('vs-room-session', JSON.stringify(record));
  }, saved);
  await rejected.reload();
  await rejected.locator('#room-dialog').waitFor();
  await rejected.locator('#dialog-error').filter({ hasText: '房间' }).waitFor();
  assert.equal(await rejected.evaluate(() => sessionStorage.getItem('vs-room-session')), null);
  assert.equal(sent.get(rejected)!.includes('create'), false);
  assert.equal(sent.get(host)!.filter((t) => t === 'create').length, 1);
  evidence.recovery = {
    hostReloads: 3,
    guestReload: true,
    identityPreserved: true,
    duplicateSeats: false,
    freshTabSeparateIdentity: true,
    explicitLeaveClears: true,
    expiredRoomDoesNotCreate: true,
    transientRestoreRetry: true,
    activeServerPreserved: true,
  };
  evidence.errors = errors;
  assert.deepEqual(errors, []);
  await host.locator('#leave-button').click();
  console.log(JSON.stringify(evidence));
} finally {
  await mkdir('.local', { recursive: true });
  await writeFile(
    `.local/session-refresh-${app ? 'local' : 'public'}-evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  await app?.close();
}
