import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BLOCK_SIZE } from '../shared/cache-plan';
import { mp4Bootstrap, partOffsets } from '../shared/cache-parts';
import { cacheTimeline } from '../shared/cache-timeline';

const profile = await mkdtemp(resolve('.local/cache-location-profile-'));
const selected = await mkdtemp(resolve('.local/cache-location-drive-'));
const file = await readFile('.local/flower.mp4');
const bootstrap = await mp4Bootstrap(file.length, async (offset) =>
  file.subarray(offset, offset + BLOCK_SIZE),
);
const args = ['desktop/main.cjs', '--user-data-dir=' + profile, '--mute-audio'];
let app = await electron.launch({ args, timeout: 30000 });
const proof: any = { at: new Date().toISOString(), packaged: false, production: false };
try {
  let page = await app.firstWindow();
  await page.locator('#platform').filter({ hasText: 'Windows 客户端' }).waitFor();
  const before = await page.evaluate(() => window.desktop!.call('cacheLocation'));
  assert.match(before.path, /^D:\\VideoSreeeen-cache\\[a-f0-9]{16}$/i);
  proof.defaultD = true;
  await writeFile(resolve(selected, 'user-file.txt'), 'do not remove');
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, selected);
  const chosen = await page.evaluate(() => window.desktop!.call('chooseCacheLocation'));
  assert.ok(chosen.path.startsWith(selected));
  proof.realDirectoryChanged = true;
  const jobId = randomUUID();
  await page.evaluate(
    ({ jobId, size }) =>
      window.desktop!.call('cacheIO', {
        action: 'init',
        jobId,
        entry: 'video.mp4',
        progressive: true,
        files: [{ name: 'video.mp4', size }],
      }),
    { jobId, size: file.length },
  );
  const offsets = [...new Set([...bootstrap, ...partOffsets(file.length, 1, 3)])];
  const put = async (offset: number) =>
    page.evaluate((p) => window.desktop!.call('cacheIO', p), {
      action: 'put',
      jobId,
      name: 'video.mp4',
      offset,
      data: file.subarray(offset, Math.min(file.length, offset + BLOCK_SIZE)).toString('base64'),
    });
  for (const offset of offsets) await put(offset);
  assert.ok(offsets.length < Math.ceil(file.length / BLOCK_SIZE));
  await page.evaluate((job) => {
    const video = document.querySelector<HTMLVideoElement>('#video')!;
    video.src = `vs-cache://${job}/video.mp4`;
    video.muted = true;
    video.hidden = false;
    void video.play();
  }, jobId);
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return v.currentTime > 0.25 && v.videoWidth > 0;
  });
  proof.partialDecode = await page.locator('#video').evaluate((v: HTMLVideoElement) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    position: v.currentTime,
    frames: v.getVideoPlaybackQuality().totalVideoFrames,
  }));
  for (let offset = 0; offset < file.length; offset += BLOCK_SIZE)
    if (!offsets.includes(offset)) await put(offset);
  const complete = await page.evaluate(
    (jobId) => window.desktop!.call('cacheIO', { action: 'finish', jobId }),
    jobId,
  );
  assert.equal(complete.state, 'ready');
  await page.evaluate(async (jobId) => {
    const v = document.querySelector('video')!;
    v.pause();
    v.removeAttribute('src');
    v.load();
    await window.desktop!.call('cacheClear', { jobId });
  }, jobId);
  const slidingFile = await readFile('.local/cache-window-fixture.mp4');
  const layout = await cacheTimeline(slidingFile.length, 3, async (offset) =>
    slidingFile.subarray(offset, offset + BLOCK_SIZE),
  );
  const slidingId = randomUUID();
  await page.evaluate((p) => window.desktop!.call('cacheIO', p), {
    action: 'init',
    jobId: slidingId,
    entry: 'video.mp4',
    progressive: true,
    sliding: true,
    files: [{ name: 'video.mp4', size: slidingFile.length }],
  });
  for (let offset = 0; offset < slidingFile.length; offset += BLOCK_SIZE)
    await page.evaluate((p) => window.desktop!.call('cacheIO', p), {
      action: 'put',
      jobId: slidingId,
      name: 'video.mp4',
      offset,
      data: slidingFile.subarray(offset, offset + BLOCK_SIZE).toString('base64'),
    });
  await page.evaluate(async (job) => {
    const video = document.querySelector<HTMLVideoElement>('#video')!;
    video.muted = true;
    video.src = `vs-cache://${job}/video.mp4`;
    video.currentTime = 6.5;
    await video.play();
  }, slidingId);
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return v.currentTime > 6.5 && v.videoWidth === 640 && !v.paused;
  });
  const deleted = partOffsets(slidingFile.length, 1, 3).filter(
    (offset) => !layout.protected.includes(offset),
  );
  const freed = await page.evaluate((p) => window.desktop!.call('cacheIO', p), {
    action: 'drop',
    jobId: slidingId,
    name: 'video.mp4',
    offsets: deleted,
  });
  assert.equal(freed, deleted.length * BLOCK_SIZE);
  await page.evaluate(() => {
    document.querySelector<HTMLVideoElement>('#video')!.currentTime = 7;
  });
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    return v.currentTime > 7.2 && !v.paused && v.videoWidth === 640;
  });
  let unavailable = false;
  try {
    await page.evaluate((p) => window.desktop!.call('cacheIO', p), {
      action: 'get',
      jobId: slidingId,
      name: 'video.mp4',
      offset: deleted[0],
    });
  } catch {
    unavailable = true;
  }
  assert.ok(unavailable);
  await page.evaluate(async (job) => {
    const v = document.querySelector<HTMLVideoElement>('#video')!;
    v.pause();
    v.removeAttribute('src');
    v.load();
    await window.desktop!.call('cacheClear', { jobId: job });
  }, slidingId);
  proof.slidingBlocks = {
    actualNativePlayback: true,
    safeDeletionBytes: freed,
    retainedSeekContinues: true,
    removedReadRejected: true,
  };
  await app.close();
  assert.equal(await readFile(resolve(selected, 'user-file.txt'), 'utf8'), 'do not remove');
  app = await electron.launch({ args, timeout: 30000 });
  page = await app.firstWindow();
  await page.locator('#platform').filter({ hasText: 'Windows 客户端' }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.desktop!.call('cacheLocation'))).path,
    chosen.path,
  );
  proof.rememberedAfterRestart = true;
  proof.preservedUserFile = true;
  proof.passed = true;
} catch (cause) {
  proof.error = String(cause);
  proof.passed = false;
  throw cause;
} finally {
  await app.close().catch(() => {});
  await mkdir('.local', { recursive: true });
  await writeFile('.local/cache-location-native-evidence.json', JSON.stringify(proof, null, 2));
}
