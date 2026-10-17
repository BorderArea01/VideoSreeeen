import type { CachePlan } from '../server/media';
import { isNative, cacheNative, nativeCall, type NativeCache } from './native';

const PREFIX = 'videosreeeen-';
export class DeviceCache {
  private controller: AbortController | null = null;
  private browserName = '';
  jobId = '';
  constructor(private progress: (event: NativeCache) => void) {}
  async start(jobId: string, server: string, planPath: string) {
    await this.clear();
    this.jobId = jobId;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const response = await fetch(new URL(planPath, server), { signal });
    if (!response.ok) throw new Error(await response.text());
    const plan = (await response.json()) as CachePlan;
    if (signal.aborted || jobId !== this.jobId) return;
    if (isNative) {
      await cacheNative(jobId, plan, server);
      return;
    }
    if (!window.isSecureContext || !('caches' in window))
      throw new Error('此浏览器的完整缓存需要 HTTPS；也可以使用客户端');
    if (plan.kind === 'hls')
      throw new Error(
        '浏览器暂不支持完整 HLS 缓存，请使用 Windows 或 Android 客户端；直连 MP4 可以缓存',
      );
    const estimate = await navigator.storage.estimate();
    const remaining = (estimate.quota ?? 0) - (estimate.usage ?? 0);
    if (remaining < 64 * 1024 ** 2) throw new Error('浏览器可用存储不足 64 MiB');
    this.browserName = PREFIX + Date.now() + '-' + jobId;
    const cache = await caches.open(this.browserName);
    let bytes = 0;
    const hashes: string[] = [];
    const urls = new Map<string, string>();
    try {
      for (let index = 0; index < plan.files.length; index++) {
        const file = plan.files[index]!;
        if (!file.url) throw new Error('不支持的缓存计划');
        const url = new URL(file.url, server).href;
        const request = await fetch(url, { signal });
        if (!request.ok) throw new Error('视频下载失败，请重新识别视频源');
        const length = Number(request.headers.get('content-length') ?? 0);
        // WebCrypto digest is not streaming. Keep the browser path explicitly small;
        // native clients are the full-size, stream-to-disk implementation.
        if (!length || length > Math.min(96 * 1024 ** 2, remaining / 2))
          throw new Error('此视频超过浏览器的安全缓存容量，请使用客户端完整缓存');
        const reader = request.body?.getReader();
        if (!reader) throw new Error('无法读取视频流');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > length || size > 96 * 1024 ** 2) {
            await reader.cancel();
            throw new Error('视频大小超过缓存限制');
          }
          chunks.push(part.value);
          this.progress({
            state: 'downloading',
            jobId,
            progress: (index + size / length) / plan.files.length,
            bytes: bytes + size,
          });
        }
        if (size !== length) throw new Error('视频未完整下载');
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        hashes.push([...digest].map((b) => b.toString(16).padStart(2, '0')).join(''));
        const key = new URL(`/__cache__/${jobId}/${file.name}`, location.origin).href;
        await cache.put(
          key,
          new Response(data, {
            headers: { 'Content-Type': file.name.endsWith('m4a') ? 'audio/mp4' : 'video/mp4' },
          }),
        );
        urls.set(file.name, key);
        bytes += size;
      }
      if (signal.aborted || jobId !== this.jobId) throw new Error('缓存已取消');
      const fp = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.join('\n'))),
      );
      const entryBlob = await (await cache.match(urls.get(plan.entry)!))!.blob();
      const entry = URL.createObjectURL(entryBlob);
      this.objectUrls.push(entry);
      let audio: string | undefined;
      if (plan.audio) {
        audio = URL.createObjectURL(await (await cache.match(urls.get(plan.audio)!))!.blob());
        this.objectUrls.push(audio);
      }
      this.progress({
        state: 'ready',
        jobId,
        bytes,
        progress: 1,
        fingerprint: [...fp].map((b) => b.toString(16).padStart(2, '0')).join(''),
        entry,
        audio,
      });
    } catch (error) {
      await caches.delete(this.browserName);
      throw error;
    }
  }
  private objectUrls: string[] = [];
  async clear() {
    this.controller?.abort();
    this.controller = null;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    const previous = this.jobId;
    this.jobId = '';
    if (isNative && previous) await nativeCall('cacheClear', { jobId: previous });
    if (this.browserName && 'caches' in window) await caches.delete(this.browserName);
    this.browserName = '';
  }
  async sweep() {
    if (!isNative && 'caches' in window)
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX)) {
          const created = Number(key.slice(PREFIX.length).split('-')[0]);
          if (Number.isFinite(created) && Date.now() - created > 24 * 60 * 60 * 1000)
            await caches.delete(key);
        }
  }
}
