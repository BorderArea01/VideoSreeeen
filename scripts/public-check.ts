import { configureRoomServer, openRoom, closeInvitation } from './room-ui';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, _electron as electron } from 'playwright';

const origin = process.env.VS_PUBLIC_URL ?? 'https://videosreeeen.pages.dev';
const source = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const health = await fetch(origin + '/healthz');
assert.equal(health.status, 200);
assert.equal(((await health.json()) as any).runtime, 'cloudflare');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
const desktop = await electron.launch({
  args: ['desktop/main.cjs', '--mute-audio'],
  env: { ...process.env, VS_DEV_URL: origin },
  timeout: 30000,
});
const evidence: Record<string, unknown> = { origin, https: true, version: '0.4.0' },
  failures: string[] = [];
try {
  const seed = await desktop.firstWindow(),
    context = await browser.newContext({ viewport: { width: 1440, height: 1080 } }),
    receiver = await context.newPage();
  for (const page of [seed, receiver]) page.on('pageerror', (e) => failures.push(e.message));
  let invite = '';
  seed.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      try {
        const m = JSON.parse(String(event.payload));
        if (m.type === 'welcome') invite = origin + '/#' + m.room.invite;
      } catch {}
    }),
  );
  await configureRoomServer(seed, origin);
  await openRoom(seed);
  await seed.locator('#name-input').fill('公网 Windows 种子');
  await seed.locator('#create-button').click();
  await closeInvitation(seed);
  await seed.locator('#connection.online').waitFor();
  assert.ok(invite);
  await receiver.goto(invite);
  await openRoom(receiver, 'join');
  await receiver.locator('#name-input').fill('公网网页接收端');
  await receiver.locator('#join-button').click();
  await receiver.locator('#connection.online').waitFor();
  await seed.locator('#chat-input').fill('公网房间与 WSS 验证 🍿');
  await seed.locator('#send-button').click();
  await receiver.getByText('公网房间与 WSS 验证 🍿', { exact: true }).waitFor();
  evidence.wssAndChat = true;
  await seed.locator('#source-url').fill(source);
  await seed.locator('#source-form button').click();
  await seed.waitForFunction(
    () => document.querySelector('video')!.readyState >= 2,
    {},
    { timeout: 30000 },
  );
  await seed.locator('#cache-options').evaluate((e) => ((e as HTMLDetailsElement).open = true));
  await seed.locator('#mode-toggle').click();
  await seed.locator('#cache-button').click();
  await seed.waitForFunction(
    () => document.querySelector('#cache-title')!.textContent === '本机已准备好',
    {},
    { timeout: 45000 },
  );
  await receiver.route(source, (route) => route.abort());
  await receiver.locator('#cache-button').click();
  await receiver
    .waitForFunction(
      () => document.querySelector('#cache-title')!.textContent === '本机已准备好',
      {},
      { timeout: 45000 },
    )
    .catch(async (e) => {
      console.log(
        'Public receiver cache:',
        await receiver.locator('#cache-description').textContent(),
      );
      throw e;
    });
  const description = await receiver.locator('#cache-description').textContent();
  assert.match(description!, /从成员接收 1\.1 MiB，源站 0\.0 MiB/);
  evidence.p2pFromWindows = description;
  await mkdir('.local/screenshots', { recursive: true });
  await receiver.screenshot({ path: resolve('.local/screenshots/public-web.png'), fullPage: true });
  await seed.locator('#play-button').click();
  await receiver.waitForFunction(() => document.querySelector('video')!.currentTime > 0.3);
  await receiver.waitForFunction(
    () => document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
    {},
    { timeout: 20000 },
  );
  evidence.cachedPlaybackAndCleanup = true;
  await seed.locator('#leave-button').click();
  await receiver.locator('#leave-button').click();
  assert.deepEqual(failures, []);
  await writeFile('.local/public-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await context.close();
} finally {
  await desktop.close();
  await browser.close();
}
