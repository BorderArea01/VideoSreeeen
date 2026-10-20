import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

// Observe only the official player's normal anonymous requests. No account
// cookies, trial parameters, forged entitlements or third-party parsers.
const urls = process.argv.slice(2);
const mobile = process.env.VS_BILI_MOBILE === '1';
const embedded = process.env.VS_BILI_EMBED === '1';
assert.ok(!(mobile && embedded), 'Choose one official page variant per run');
if (!urls.length) urls.push('https://www.bilibili.com/video/BV13Aa66LEAW/');
for (const value of urls)
  assert.match(value, /^https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]+\/?$/);
await mkdir('.local', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  ...(process.env.VS_PROXY_URL ? { proxy: { server: process.env.VS_PROXY_URL } } : {}),
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: any = {
  checkedAt: new Date().toISOString(),
  anonymous: true,
  officialPlayerOnly: true,
  network: process.env.VS_PROXY_URL ? 'explicit-proxy' : 'system-default',
  viewportProfile: embedded
    ? 'official embedded player'
    : mobile
      ? 'Pixel 7 / official mobile page'
      : 'desktop browser',
  videos: [],
};
try {
  for (const url of urls) {
    const context = await browser.newContext(
      mobile ? devices['Pixel 7'] : { viewport: { width: 1280, height: 900 } },
    );
    const page = await context.newPage();
    const result: any = { url, playResponses: [] };
    proof.videos.push(result);
    const responses = new Set<Promise<void>>();
    page.on('response', (response) => {
      const address = new URL(response.url());
      if (address.hostname !== 'api.bilibili.com' || !address.pathname.endsWith('/playurl')) return;
      const task = (async () => {
        const entry: any = { endpoint: address.pathname, httpStatus: response.status() };
        result.playResponses.push(entry);
        try {
          const body = await response.json();
          const data = body.data ?? body.result;
          Object.assign(entry, {
            code: body.code,
            quality: data?.quality,
            preview: data?.is_preview,
            returnedVideoTracks: data?.dash?.video?.map((v: any) => ({
              quality: v.id,
              width: v.width,
              height: v.height,
              codec: v.codecs,
            })),
            advertisedFormats: data?.support_formats?.map((v: any) => ({
              quality: v.quality,
              label: v.new_description ?? v.display_desc,
              needLogin: v.need_login,
              needVip: v.need_vip,
            })),
          });
        } catch {
          entry.unreadable = true;
        }
      })();
      responses.add(task);
      void task.finally(() => responses.delete(task));
    });
    try {
      const address = embedded
        ? `https://player.bilibili.com/player.html?bvid=${new URL(url).pathname.split('/')[2]}&autoplay=0&muted=1`
        : mobile
          ? url.replace('www.', 'm.')
          : url;
      const navigation = await page.goto(address, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      result.pageStatus = navigation?.status();
      await page.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return v && v.readyState >= 2 && v.videoWidth > 0;
        },
        {},
        { timeout: 45000 },
      );
      await page
        .locator('video')
        .first()
        .evaluate((element) => {
          const video = element as HTMLVideoElement;
          video.muted = true;
          void video.play().catch(() => {});
        });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('video')].some(
            (video) => video.getVideoPlaybackQuality().totalVideoFrames > 3,
          ),
        {},
        { timeout: 15000 },
      );
      result.decoded = await page
        .locator('video')
        .first()
        .evaluate((element) => {
          const v = element as HTMLVideoElement;
          return {
            width: v.videoWidth,
            height: v.videoHeight,
            frames: v.getVideoPlaybackQuality().totalVideoFrames,
            duration: v.duration,
          };
        });
      const quality = page.locator('.bpx-player-ctrl-quality');
      if (await quality.isVisible()) {
        await quality.hover();
        await page.waitForTimeout(500);
        result.qualityMenu = (await quality.innerText()).slice(0, 1200);
      }
      result.hasAccountSession = (await context.cookies()).some((c) => c.name === 'SESSDATA');
      assert.equal(result.hasAccountSession, false);
      await page.screenshot({ path: `.local/bilibili-quality-${proof.videos.length}.png` });
      result.observationComplete = true;
    } catch (cause: any) {
      result.error = cause.message.split('\n')[0];
      result.observationComplete = false;
    } finally {
      await Promise.allSettled([...responses]);
      await context.close();
    }
    // Signed CDN URLs and original API responses are never persisted.
    console.log(JSON.stringify(result));
  }
} finally {
  await browser.close();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/bilibili-quality-evidence.json', JSON.stringify(proof, null, 2));
  await writeFile(
    `.local/bilibili-quality-${embedded ? 'embed' : mobile ? 'mobile' : 'desktop'}-evidence.json`,
    JSON.stringify(proof, null, 2),
  );
}
if (proof.videos.some((v: any) => !v.observationComplete)) process.exitCode = 1;
