import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { openRoom, closeInvitation } from './room-ui';

const app = createApp();
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--js-flags=--max-old-space-size=256', '--disable-extensions'],
});
const errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (process.env.VS_FORCE_CANVAS)
    await context.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'captureStream', {
        value: undefined,
        configurable: true,
      });
    });
  const host = await context.newPage(),
    guest = await context.newPage();
  if (process.env.VS_DENY_AUTOPLAY)
    await guest.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      let allowed = false;
      document.addEventListener(
        'pointerdown',
        (event) => {
          if ((event.target as Element)?.closest('#play-button')) allowed = true;
        },
        true,
      );
      HTMLMediaElement.prototype.play = function () {
        return this.id === 'video' && !allowed
          ? Promise.reject(new DOMException('User gesture required', 'NotAllowedError'))
          : original.call(this);
      };
    });
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  await host.goto(origin);
  await openRoom(host);
  await host.locator('#name-input').fill('文件提供者');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await guest.goto(invite);
  await guest.locator('#name-input').fill('直接接收');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  assert.equal(
    await host.locator('#cache-options').evaluate((e) => (e as HTMLDetailsElement).open),
    false,
  );
  await host.locator('#source-url').fill('https://www.bilibili.com/video/BV13Aa66LEAW/');
  await host.locator('#source-form button').click();
  await host.locator('#provide-dialog').waitFor();
  const choosing = host.waitForEvent('filechooser');
  await host.locator('#provide-local-video').click();
  await (await choosing).setFiles(resolve('.local/flower.mp4'));
  await guest.waitForFunction(
    () => !!document.querySelector<HTMLVideoElement>('#video')?.srcObject,
    {},
    { timeout: 25000 },
  );
  assert.equal([...app.rooms.rooms.values()][0]!.mode, 'stream');
  assert.equal([...app.rooms.rooms.values()][0]!.media?.broadcast?.kind, 'file');
  if (process.env.VS_DENY_AUTOPLAY) {
    await host.locator('#play-button').click();
    await guest.locator('#broadcast-status').filter({ hasText: '点击播放' }).waitFor();
  }
  await guest.locator('#play-button').click();
  if (process.env.VS_DENY_AUTOPLAY)
    assert.equal(
      [...app.rooms.rooms.values()][0]!.playback.paused,
      false,
      'Unlocking local audio must not pause the room',
    );
  await guest.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('#video')!;
      return v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > 10;
    },
    {},
    { timeout: 20000 },
  );
  await guest.locator('#play-button').click();
  await host.locator('#seek').evaluate((e) => {
    (e as HTMLInputElement).value = '2';
    e.dispatchEvent(new Event('change'));
  });
  await host.locator('#position').filter({ hasText: '00:02' }).waitFor();
  const sample = await guest.locator('#video').evaluate((e) => {
    const v = e as HTMLVideoElement;
    const stream = v.srcObject as MediaStream;
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
      tracks: stream.getTracks().map((t) => t.kind),
    };
  });
  assert.ok(sample.frames > 10);
  // A newly joined receiver must connect to the existing publisher.
  await guest.reload();
  await guest.locator('#name-input').fill('重新加入');
  await guest.locator('#join-button').click();
  await guest.waitForFunction(
    () => !!document.querySelector<HTMLVideoElement>('#video')?.srcObject,
    {},
    { timeout: 25000 },
  );
  await host.locator('#stop-broadcast').click();
  await guest.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#video')?.srcObject);
  assert.equal([...app.rooms.rooms.values()][0]!.media, null);
  await mkdir('.local/screenshots', { recursive: true });
  await host.screenshot({
    path: resolve('.local/screenshots/broadcast-desktop.png'),
    fullPage: true,
  });
  await host.setViewportSize({ width: 390, height: 844 });
  await host.screenshot({
    path: resolve('.local/screenshots/broadcast-mobile.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    process.env.VS_DENY_AUTOPLAY
      ? '.local/broadcast-autoplay-evidence.json'
      : process.env.VS_FORCE_CANVAS
        ? '.local/broadcast-canvas-evidence.json'
        : '.local/broadcast-evidence.json',
    JSON.stringify(
      {
        sample,
        capture: process.env.VS_FORCE_CANVAS ? 'canvas' : 'element',
        lateJoin: true,
        stopCleanup: true,
        defaultCache: false,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ sample, lateJoin: true, stopCleanup: true }));
} finally {
  await browser.close();
  await app.close();
}
