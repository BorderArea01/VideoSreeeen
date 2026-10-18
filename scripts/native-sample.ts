import type { Page } from 'playwright';
import type { Sample } from '../client/native';

// Playwright waitForFunction treats a Promise as truthy. Native IPC must be
// awaited outside that predicate, otherwise an unavailable player can pass.
export async function waitForNativeSample(
  page: Page,
  predicate: (sample: Sample) => boolean,
  timeout = 30000,
): Promise<Sample> {
  const deadline = performance.now() + timeout;
  do {
    const sample: Sample = await page.evaluate(() => window.desktop!.call('sampleSite'));
    if (predicate(sample)) return sample;
    await page.waitForTimeout(150);
  } while (performance.now() < deadline);
  throw new Error('等待客户端播放器状态超时');
}
