import { choosePlayback, configureRoomServer, openRoom, closeInvitation } from './room-ui';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir, writeFile, access, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const dir = resolve('.local/screenshots');
await mkdir(dir, { recursive: true });
const evidence: Record<string, unknown> = {};
const profile = await mkdtemp(resolve('.local/package-check-'));
const app = await electron.launch({
  executablePath: resolve('artifacts/windows/win-unpacked/VideoSreeeen.exe'),
  args: ['--user-data-dir=' + profile, '--mute-audio'],
  timeout: 30000,
});
let local = '';
let previousSettings: Record<string, string> | undefined;
try {
  const page = await app.firstWindow();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  previousSettings = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#platform').filter({ hasText: 'Windows 客户端' }).waitFor();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('packaged browser:', message.text().slice(0, 300));
  });
  assert.ok(page.url().startsWith('file:'));
  await page.locator('#web-entry').waitFor();
  await app.evaluate(({ shell }) => {
    (globalThis as any).__openExternal = shell.openExternal;
    shell.openExternal = async (url) => {
      (globalThis as any).__webEntryURL = url;
    };
  });
  await page.locator('#web-entry').click();
  assert.equal(
    await app.evaluate(() => (globalThis as any).__webEntryURL),
    'https://videosreeeen.pages.dev/',
  );
  await app.evaluate(({ shell }) => {
    shell.openExternal = (globalThis as any).__openExternal;
  });
  evidence.webEntryButton = true;
  const info = await page.evaluate(() => window.desktop!.call('serverInfo'));
  assert.ok(info?.local);
  local = info.local;
  const health = (await (await fetch(info.local + '/healthz')).json()) as any;
  assert.equal(health.app, 'videosreeeen');
  assert.equal(await page.locator('#server-input').inputValue(), 'https://videosreeeen.pages.dev');
  await configureRoomServer(page, info.share);
  await openRoom(page);
  await page.locator('#name-input').fill('便携版验收');

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
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.3);
  await page.locator('#play-button').click();
  await page.locator('#cache-options').evaluate((e) => ((e as HTMLDetailsElement).open = true));
  await page.locator('#mode-toggle').click();
  await page.locator('#cache-button').click();
  await page.waitForFunction(
    () => document.querySelector('video')!.getAttribute('src')?.startsWith('vs-cache:'),
    {},
    { timeout: 45000 },
  );
  await page.locator('#play-button').click();
  await page.waitForFunction(
    () => document.querySelector('#mode-description')!.textContent!.includes('本机应用缓存已清理'),
    {},
    { timeout: 20000 },
  );
  evidence.packagedBlockCachePlaybackAndCleanup = true;
  evidence.packagedApp = {
    fileOrigin: true,
    embeddedServer: health.ok,
    createdRoom: true,
    videoPlayed: true,
  };
  await page.locator('#leave-button').click();
  await page.evaluate(() => localStorage.clear());
  await page.screenshot({ path: resolve(dir, 'windows-packaged.png') });
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: resolve(dir, 'windows-package-failure.png') });
  console.log('Packaged dialog:', await page.locator('#dialog-error').textContent());
  throw error;
} finally {
  if (previousSettings)
    await (
      await app.firstWindow()
    )
      .evaluate((settings) => {
        localStorage.clear();
        for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, value);
      }, previousSettings)
      .catch(() => {});
  await app.close();
}
await assert.rejects(fetch(local + '/healthz'));
evidence.embeddedServerStopped = true;
console.log('Packaged Windows application and embedded server passed');
// Also launch the delivered portable wrapper. It extracts its own runtime and
// exits after capturing a real window, without requiring Node/npm on the user PC.
const portable = resolve('artifacts/windows/VideoSreeeen 0.4.1.exe');
await access(portable);
const screenshot = resolve(dir, 'windows-portable.png');
await new Promise<void>((resolveDone, reject) => {
  const child = spawn(portable, ['--user-data-dir=' + profile + '-portable', '--mute-audio'], {
    env: { ...process.env, VS_SMOKE_OUTPUT: screenshot },
    windowsHide: true,
    stdio: 'ignore',
  });
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('便携启动器验收超过 45 秒'));
  }, 45000);
  child.once('error', (e) => {
    clearTimeout(timer);
    reject(e);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolveDone();
    else reject(new Error('便携启动器退出码 ' + code));
  });
});
await access(screenshot);
evidence.portableLauncher = 'launched, captured and exited';
await writeFile(resolve('.local/package-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
