import { checkChatCollapse } from './sidebar-checks';
import { choosePlayback, configureRoomServer, openRoom, closeInvitation } from './room-ui';
import { chromium, _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp } from '../server/index';

const output = resolve('.local/screenshots');
await mkdir(output, { recursive: true });
const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
const failures: string[] = [],
  evidence: Record<string, unknown> = {};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const first = await context.newPage();
  first.on('pageerror', (e) => failures.push(e.message));
  await first.goto(origin);
  await first.screenshot({ path: resolve(output, 'desktop-lobby.png'), fullPage: true });
  await configureRoomServer(first, origin);
  await openRoom(first);
  await first.locator('#name-input').fill('今晚的放映员');
  await first.locator('#create-button').click();
  await closeInvitation(first);
  await first.locator('#connection.online').waitFor();
  const room = [...app.rooms.rooms.values()][0]!;
  const invite = `${origin}/#${room.code}:${room.token}`;
  const second = await context.newPage();
  second.on('pageerror', (e) => failures.push(e.message));
  await second.goto(invite);
  await openRoom(second, 'join');
  await second.locator('#name-input').fill('远方的朋友');
  await second.locator('#join-button').click();
  await second.locator('#connection.online').waitFor();
  await first.locator('#member-count').filter({ hasText: '2' }).waitFor();
  await first.locator('#chat-input').fill('距离很远，故事很近。🍿');
  await first.locator('#send-button').click();
  await second
    .locator('#chat-messages')
    .getByText('距离很远，故事很近。🍿', { exact: true })
    .waitFor();
  await second.locator('#chat-input').fill('<img src=x onerror=alert(1)>');
  await second.locator('#send-button').click();
  await first
    .locator('#chat-messages')
    .getByText('<img src=x onerror=alert(1)>', { exact: true })
    .waitFor();
  assert.equal(await first.locator('.bubble img').count(), 0);
  const image = Buffer.concat([
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    Buffer.alloc(2 * 1024 * 1024),
  ]);
  await first
    .locator('#image-input')
    .setInputFiles({ name: 'hello.gif', mimeType: 'image/gif', buffer: image });
  await second.locator('.bubble img').waitFor();
  await second.locator('.bubble img').click();
  await second.locator('#image-dialog').waitFor();
  assert.ok(
    await second.locator('#image-full').evaluate((e) => (e as HTMLImageElement).naturalWidth > 0),
  );
  await second.locator('[data-close="image-dialog"]').click();
  evidence.chatImageBytes = image.length;
  await first.locator('#emoji-button').click();
  await first.getByRole('button', { name: '🍿', exact: true }).click();
  assert.equal(await first.locator('#chat-input').inputValue(), '🍿');
  evidence.chatCollapse = await checkChatCollapse(first);
  await first.screenshot({ path: resolve(output, 'desktop-room.png'), fullPage: true });
  // Real public CC0 video: verifies that the production relay and real decoders work.
  await choosePlayback(first, 'link');
  await first
    .locator('#source-url')
    .fill('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  await first.locator('#source-form button').click();
  await first.waitForFunction(
    () => {
      const v = document.querySelector('video')!;
      return v.readyState >= 2 && Number.isFinite(v.duration);
    },
    {},
    { timeout: 45000 },
  );
  await second.waitForFunction(
    () => document.querySelector('video')!.readyState >= 2,
    {},
    { timeout: 45000 },
  );
  await first.locator('#play-button').click();
  await second.waitForFunction(
    () => document.querySelector('video')!.currentTime > 0.6,
    {},
    { timeout: 15000 },
  );
  await second.locator('#play-button').click();
  await first.waitForFunction(() => document.querySelector('video')!.paused);
  evidence.sharedPlayback = {
    first: await first.locator('video').evaluate((v) => ({
      time: (v as HTMLVideoElement).currentTime,
      paused: (v as HTMLVideoElement).paused,
      duration: (v as HTMLVideoElement).duration,
    })),
    second: await second.locator('video').evaluate((v) => ({
      time: (v as HTMLVideoElement).currentTime,
      paused: (v as HTMLVideoElement).paused,
      duration: (v as HTMLVideoElement).duration,
    })),
  };
  await first.locator('#cache-options').evaluate((e) => ((e as HTMLDetailsElement).open = true));
  await first.locator('#mode-toggle').click();
  await first.locator('#cache-button').click();
  await second.locator('#cache-button').click();
  await first.waitForFunction(
    () => document.querySelector('#mode-description')!.textContent!.includes('大家都已准备好'),
    {},
    { timeout: 60000 },
  );
  assert.ok((await first.locator('video').getAttribute('src'))?.startsWith('blob:'));
  assert.ok((await second.locator('video').getAttribute('src'))?.startsWith('blob:'));
  const members = [...room.members.values()];
  assert.equal(members[0]!.cache.fingerprint, members[1]!.cache.fingerprint);
  evidence.completeCache = {
    bytes: members.map((s) => s.cache.bytes),
    fingerprint: members[0]!.cache.fingerprint,
  };
  await first.locator('#play-button').click();
  await first.waitForFunction(() => document.querySelector('video')!.currentTime > 0.3);
  await first.waitForFunction(
    () => !document.querySelector('video')!.getAttribute('src'),
    {},
    { timeout: 20000 },
  );
  evidence.autoCleanup = room.cleaned;
  assert.ok(room.cleaned);
  await first.waitForFunction(async () =>
    (await caches.keys()).every((key) => !key.startsWith('videosreeeen-')),
  );
  evidence.browserCacheStorageEmpty = true;
  await second.close();
  await first.setViewportSize({ width: 390, height: 844 });
  evidence.mobileChatCollapse = await checkChatCollapse(first);
  await first.screenshot({ path: resolve(output, 'mobile-room.png'), fullPage: true });
  assert.ok(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await context.close();
  assert.deepEqual(failures, []);
  evidence.browser = 'passed';
  await writeFile(resolve('.local/ui-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('Browser playback, complete cache and cleanup passed');
} finally {
  await browser.close();
}

// Use the actual Windows shell, with audio muted. No other app is controlled.
try {
  const desktop = await electron.launch({
    args: ['desktop/main.cjs', '--mute-audio'],
    env: { ...process.env, VS_DEV_URL: origin },
    timeout: 30000,
  });
  try {
    const page = await desktop.firstWindow();
    await page.locator('#platform').filter({ hasText: 'Windows 客户端' }).waitFor();
    await page.screenshot({ path: resolve(output, 'windows-native.png') });
    await configureRoomServer(page, origin);
    await openRoom(page);
    await page.locator('#name-input').fill('Windows 原生缓存验收');
    await page.locator('#create-button').click();
    await closeInvitation(page);
    await page.locator('#connection.online').waitFor();
    await choosePlayback(page, 'link');
    await page
      .locator('#source-url')
      .fill('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
    await page.locator('#source-form button').click();
    await page.waitForFunction(
      () => document.querySelector('video')!.readyState >= 2,
      {},
      { timeout: 30000 },
    );
    await page.locator('#cache-options').evaluate((e) => ((e as HTMLDetailsElement).open = true));
    await page.locator('#mode-toggle').click();
    await page.locator('#cache-button').click();
    await page.waitForFunction(
      () => document.querySelector('video')!.getAttribute('src')?.startsWith('vs-cache:'),
      {},
      { timeout: 30000 },
    );
    await page.waitForFunction(() =>
      document.querySelector('#mode-description')!.textContent!.includes('大家都已准备好'),
    );
    await page.locator('#play-button').click();
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.3);
    await page.waitForFunction(
      () => !document.querySelector('video')!.getAttribute('src'),
      {},
      { timeout: 20000 },
    );
    await page.waitForFunction(() =>
      document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
    );
    const cacheRoot = join(
      await desktop.evaluate(({ app }) => app.getPath('userData')),
      'cache',
      'media',
    );
    assert.deepEqual(await readdir(cacheRoot), []);
    evidence.windowsCacheDirectoryEmpty = true;
    evidence.windowsNativeDiskCache = 'downloaded, played from disk, automatically cleared';
    console.log('Windows native disk cache passed');
    const fixture = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body>Ready<iframe src="/pending"></iframe></body></html>');
      }
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const fixtureUrl = `http://127.0.0.1:${(fixture.address() as any).port}`;
    try {
      const start = Date.now();
      await page.evaluate((url) => window.desktop!.call('openSite', { url }), fixtureUrl);
      assert.ok(Date.now() - start < 5000);
      evidence.domReadyWithPendingIframe = true;
    } finally {
      await page.evaluate(() => window.desktop!.call('closeSite'));
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
    const sites = [
      ['bilibili', 'https://www.bilibili.com/video/BV1KQp565ENm/'],
      ['xifan', 'https://next.xifanacg.com/anime/151/play/1985?source=xfy2'],
      ['mgn', 'https://www.mgnacg.com/bangumi/193-2-16/'],
    ];
    const results = [];
    for (const [provider, url] of sites) {
      console.log('Checking native site:', provider);
      try {
        await page.evaluate(async (url) => {
          await (window as any).desktop.call('openSite', { url });
          await (window as any).desktop.call('siteBounds', {
            x: 20,
            y: 150,
            width: 900,
            height: 520,
            viewportWidth: innerWidth,
          });
        }, url);
        await page.waitForTimeout(7000);
        const sample = await page.evaluate(() => window.desktop!.call('sampleSite'));
        results.push({
          provider,
          status: 'loaded',
          sample: {
            available: sample.available,
            title: sample.title,
            duration: sample.duration,
            sourceKind: sample.source?.kind,
            sourceExtension: sample.source?.video
              ? new URL(sample.source.video).pathname.split('.').at(-1)?.slice(-12)
              : null,
          },
        });
      } catch (e) {
        results.push({ provider, status: 'blocked', error: String(e).slice(0, 200) });
      }
      await page.evaluate(() => window.desktop!.call('closeSite'));
    }
    evidence.nativeSites = results;
    evidence.windowsShell = 'passed';
  } finally {
    await desktop.close();
  }
} finally {
  await app.close();
}
await writeFile(resolve('.local/ui-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
