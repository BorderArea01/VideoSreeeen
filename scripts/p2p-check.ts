import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, _electron as electron, type Page } from 'playwright';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// A single browser/context. The desktop shell is opened only for the cross-client case.
await mkdir('.local/screenshots', { recursive: true });
const videoPath = resolve('.local/flower.mp4');
let data: Buffer;
try {
  data = await readFile(videoPath);
} catch {
  const r = await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert.ok(r.ok);
  data = Buffer.from(await r.arrayBuffer());
  await writeFile(videoPath, data);
}
let rejectSource = false;
let sourcePayload = 0;
const source = createServer((request, response) => {
  if (rejectSource) {
    response.writeHead(503).end('Source disabled for P2P verification');
    return;
  }
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range,Content-Length');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', 'video/mp4');
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const start = Number(range?.[1] ?? 0),
    end = Math.min(data.length - 1, range?.[2] ? Number(range[2]) : data.length - 1);
  if (start > end) {
    response.writeHead(416).end();
    return;
  }
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  }
  response.setHeader('Content-Length', end - start + 1);
  if (range && end - start + 1 > 1) sourcePayload += end - start + 1;
  response.end(data.subarray(start, end + 1));
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl = `http://127.0.0.1:${(source.address() as any).port}/flower.mp4`;
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'videosreeeen-test',
    scriptPath: '.local/worker-build/index.js',
    modules: true,
    compatibilityDate: '2026-10-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { ROOMS: { className: 'WatchRoom', useSQLite: true } },
    assets: {
      directory: 'dist',
      binding: 'ASSETS',
      routerConfig: { has_user_worker: true },
      run_worker_first: ['/ws', '/healthz', '/config', '/cache-plan/*', '/media/*'],
    },
    bindings: { ICE_SERVERS: '[]' },
    port: 0,
    host: '127.0.0.1',
  }),
);
const origin = (await runtime.ready).origin;
console.log('Local Workers runtime ready:', origin);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const failures: string[] = [],
  evidence: Record<string, unknown> = {};
const invites = new WeakMap<Page, string>();
function observe(page: Page) {
  page.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      try {
        const m = JSON.parse(String(event.payload));
        if (m.type === 'welcome') invites.set(page, origin + '/#' + m.room.invite);
      } catch {}
    }),
  );
}
async function create(page: Page, name: string) {
  observe(page);
  await page.goto(origin);
  await page.locator('#room-button').click();
  await page.locator('#name-input').fill(name);
  await page.locator('#server-input').fill(origin);
  await page.locator('#create-button').click();
  await page
    .locator('#connection.online')
    .waitFor({ timeout: 15000 })
    .catch(async (e) => {
      console.log(
        'Connection failure:',
        await page.locator('#dialog-error').textContent(),
        await page.locator('#toast').textContent(),
      );
      throw e;
    });
}
async function join(page: Page, invite: string, name: string) {
  if (!(await page.evaluate(() => !!window.desktop))) await page.goto(invite);
  await page.locator('#room-button').click();
  await page.locator('#name-input').fill(name);
  await page.locator('#server-input').fill(origin);
  await page.locator('#invite-input').fill(invite);
  await page.locator('#join-button').click();
  await page.locator('#connection.online').waitFor();
}
const ready = (page: Page) =>
  page.waitForFunction(
    () => document.querySelector('#cache-title')!.textContent === '本机已准备好',
    {},
    { timeout: 45000 },
  );
async function share(page: Page) {
  await page.locator('#source-url').fill(sourceUrl);
  await page.locator('#source-form button').click();
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await page.locator('#mode-toggle').click();
}
async function invite(page: Page) {
  const value = invites.get(page);
  assert.ok(value, 'Welcome invite was received');
  return value;
}

try {
  const first = await context.newPage(),
    second = await context.newPage();
  for (const p of [first, second]) p.on('pageerror', (e) => failures.push(e.message));
  await create(first, '浏览器种子');
  await join(second, await invite(first), '仅从成员下载');
  await share(first);
  await first.locator('#cache-button').click();
  await ready(first);
  let blocked = 0;
  await second.route(sourceUrl, (route) => {
    blocked++;
    return route.abort();
  });
  await second.locator('#cache-button').click();
  await ready(second);
  const description = await second.locator('#cache-description').textContent();
  assert.match(description!, /源站 0\.0 MiB/);
  assert.match(description!, /从成员接收 1\.1 MiB/);
  assert.equal(blocked, 0);
  evidence.browserToBrowser = { description, blockedSourceRequests: blocked };
  await second.locator('#chat-input').fill('P2P 缓存完成 🍿');
  await second.locator('#send-button').click();
  await first.getByText('P2P 缓存完成 🍿', { exact: true }).waitFor();
  await second.screenshot({ path: resolve('.local/screenshots/p2p-browser.png'), fullPage: true });
  await first.locator('#play-button').click();
  await second.waitForFunction(() => document.querySelector('video')!.currentTime > 0.2);
  await first.waitForFunction(
    () => document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
    {},
    { timeout: 20000 },
  );
  await second.waitForFunction(async () =>
    (await caches.keys()).every((k) => !k.startsWith('videosreeeen-')),
  );
  evidence.browserCleanup = true;
  await second.unroute(sourceUrl);
  await first.locator('#cache-button').click();
  await first.locator('#cache-button').filter({ hasText: '开始本机缓存' }).waitFor();
  sourcePayload = 0;
  await first.locator('#cache-button').click();
  await second.locator('#cache-button').click();
  await ready(first);
  await ready(second);
  assert.ok(
    sourcePayload <= data.length + 256 * 1024,
    `Unexpected duplicate origin download: ${sourcePayload}`,
  );
  evidence.simultaneousDownload = { sourcePayloadBytes: sourcePayload, videoBytes: data.length };
  await first.locator('#play-button').click();
  await first.waitForFunction(
    () => document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
    {},
    { timeout: 20000 },
  );
  // Corrupt every outgoing data frame from the seeder: hash verification must
  // reject it and fetch the correct bytes from the independent HTTP source.
  await first.evaluate(() => {
    const original = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: any) {
      if (typeof data === 'string') {
        const m = JSON.parse(data);
        if (m.type === 'part' && m.data.length) {
          m.data = (m.data[0] === 'A' ? 'B' : 'A') + m.data.slice(1);
          data = JSON.stringify(m);
        }
      }
      (original as any).call(this, data);
    } as typeof original;
  });
  await first.locator('#cache-button').click();
  await first.locator('#cache-button').filter({ hasText: '开始本机缓存' }).waitFor();
  await first.locator('#cache-button').click();
  await ready(first);
  await second.locator('#cache-button').click();
  await ready(second);
  const recovered = await second.locator('#cache-description').textContent();
  assert.match(recovered!, /从成员接收 0\.0 MiB，源站 1\.1 MiB/);
  await second.waitForFunction(() =>
    document.querySelector('#mode-description')!.textContent!.includes('大家都已准备好'),
  );
  evidence.corruptPeerRejectedAndSourceFallback = true;
  await first.locator('#leave-button').click();
  await second.locator('#leave-button').click();
  await first.close();
  await second.close();
  const desktop = await electron.launch({
    args: ['desktop/main.cjs', '--mute-audio'],
    env: { ...process.env, VS_DEV_URL: origin },
    timeout: 30000,
  });
  try {
    const page = await desktop.firstWindow();
    page.on('pageerror', (e) => failures.push(e.message));
    await create(page, 'Windows 磁盘种子');
    const receiver = await context.newPage();
    await join(receiver, await invite(page), '浏览器接收 Windows 分块');
    await share(page);
    await page.locator('#cache-button').click();
    await receiver.route(sourceUrl, (route) => route.abort());
    await receiver.locator('#cache-button').click();
    await ready(page);
    await ready(receiver);
    assert.ok((await page.locator('video').getAttribute('src'))?.startsWith('vs-cache:'));
    const received = await receiver.locator('#cache-description').textContent();
    assert.match(received!, /源站 0\.0 MiB/);
    evidence.windowsToBrowser = { description: received };
    await page.screenshot({ path: resolve('.local/screenshots/p2p-windows.png') });
    // Seeder leaves. Receiver's completed local cache must survive, then clean up on end.
    await page.locator('#leave-button').click();
    await receiver.locator('#member-count').filter({ hasText: '1' }).waitFor();
    await receiver.locator('#play-button').click();
    await receiver.waitForFunction(
      () =>
        document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
      {},
      { timeout: 20000 },
    );
    evidence.seederLeaveAndCleanup = true;
    await receiver.close();
    // Reverse direction: write received browser blocks into the Windows disk cache.
    const browserSeed = await context.newPage();
    await create(browserSeed, '浏览器反向种子');
    await share(browserSeed);
    await browserSeed.locator('#cache-button').click();
    await ready(browserSeed);
    await join(page, await invite(browserSeed), 'Windows 中途加入接收端');
    rejectSource = true;
    await page.locator('#cache-button').click();
    await ready(page);
    const diskReceived = await page.locator('#cache-description').textContent();
    assert.match(diskReceived!, /源站 0\.0 MiB/);
    assert.ok((await page.locator('video').getAttribute('src'))?.startsWith('vs-cache:'));
    evidence.browserToWindows = { description: diskReceived };
    rejectSource = false;
    await page.locator('#leave-button').click();
    await browserSeed.locator('#leave-button').click();
    await browserSeed.close();
  } finally {
    await desktop.close();
  }
  assert.deepEqual(failures, []);
  await writeFile('.local/p2p-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await context.close();
  await browser.close();
  await runtime.dispose();
  source.closeAllConnections();
  await new Promise<void>((r) => source.close(() => r()));
}
