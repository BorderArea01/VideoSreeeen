import {
  BLOCK_SIZE,
  MAX_CACHE,
  buildHlsPlan,
  directPlan,
  validatePlan,
  type CachePlan,
} from '../shared/cache-plan';
import type { Source } from '../shared/protocol';
import { isNative, cacheNative, nativeCall, type NativeCache } from './native';
import { RoomPeers, decode, encode, hexDigest, type FileInfo } from './peers';

const PREFIX = 'videosreeeen-';
export class DeviceCache {
  private controller: AbortController | null = null;
  private browserName = '';
  private objectUrls: string[] = [];
  private peerBytes = 0;
  private sourceBytes = 0;
  jobId = '';
  constructor(
    private progress: (event: NativeCache) => void,
    private peers: RoomPeers,
  ) {}
  private async network(
    action: 'probe' | 'fetch' | 'text',
    jobId: string,
    url: string,
    referer?: string,
    offset = 0,
    length = 1,
  ): Promise<any> {
    const signal = this.controller!.signal;
    signal.throwIfAborted();
    if (isNative)
      return nativeCall('cacheIO', {
        action,
        jobId,
        url,
        ...(referer ? { referer } : {}),
        offset,
        length,
      });
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: action === 'text' ? {} : { Range: `bytes=${offset}-${offset + length - 1}` },
      credentials: 'omit',
    });
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    if (
      !response.ok ||
      (action !== 'text' &&
        (response.status !== 206 ||
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) !== offset + length - 1))
    ) {
      await response.body?.cancel();
      throw new Error('源站无法分块下载，浏览器还需要源站允许跨域访问');
    }
    const reader = response.body!.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    const max = action === 'text' ? 2 * 1024 ** 2 : length;
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error('下载超过分块上限');
      }
      parts.push(p.value);
    }
    if (action !== 'text' && size !== max) throw new Error('分块未完整下载');
    if (action === 'probe') return { size: Number(match![3]) };
    const data = new Uint8Array(size);
    let n = 0;
    for (const p of parts) {
      data.set(p, n);
      n += p.length;
    }
    return action === 'text' ? new TextDecoder().decode(data) : encode(data);
  }
  async start(jobId: string, server: string, planPath: string, source: Source) {
    await this.clear();
    this.jobId = jobId;
    this.controller = new AbortController();
    this.peerBytes = 0;
    this.sourceBytes = 0;
    const signal = this.controller.signal;
    let plan: CachePlan;
    const response = await fetch(new URL(planPath, server), { signal });
    if (response.ok) plan = (await response.json()) as CachePlan;
    else if (response.status === 501) {
      plan =
        source.kind === 'hls'
          ? await buildHlsPlan(source, async (url) =>
              this.network('text', jobId, url, source.referer),
            )
          : directPlan(source);
    } else throw new Error(await response.text());
    validatePlan(plan);
    for (const file of plan.files) if (file.url) file.url = new URL(file.url, server).href;
    signal.throwIfAborted();
    if (plan.kind === 'hls') {
      if (!isNative)
        throw new Error('浏览器暂不支持完整 HLS 缓存，请使用 Windows 或 Android 客户端');
      this.progress({
        state: 'downloading',
        jobId,
        progress: 0,
        bytes: 0,
        error: 'HLS 使用完整下载，MP4 / DASH 支持 P2P 互传',
      });
      await cacheNative(jobId, plan, server);
      return;
    }
    const urls = plan.files.map(
      (f) => [...new Set([f.directUrl, f.url].filter(Boolean))] as string[],
    );
    let files = await this.peers.suggestedFiles(plan.files.map((f) => f.name));
    if (!files) {
      files = [];
      try {
        for (let i = 0; i < plan.files.length; i++) {
          let info: FileInfo | undefined;
          for (const url of urls[i]!)
            try {
              const result = await this.network('probe', jobId, url, plan.referer);
              if (!Number.isSafeInteger(result.size) || result.size < 1 || result.size > MAX_CACHE)
                throw new Error('视频大小无效');
              info = { name: plan.files[i]!.name, size: result.size };
              urls[i] = [url, ...urls[i]!.filter((u) => u !== url)];
              break;
            } catch (e) {
              signal.throwIfAborted();
              if (url === urls[i]!.at(-1)) throw e;
            }
          if (!info) throw new Error('无法识别视频大小');
          files.push(info);
        }
      } catch (e) {
        signal.throwIfAborted();
        const offered = await this.peers.suggestedFiles(
          plan.files.map((f) => f.name),
          8000,
        );
        signal.throwIfAborted();
        if (offered) files = offered;
        else {
          if (!isNative) throw e;
          this.progress({
            state: 'downloading',
            jobId,
            bytes: 0,
            progress: 0,
            error: '此源无法分块，回退完整下载',
          });
          await cacheNative(jobId, plan, server);
          return;
        }
      }
    }
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_CACHE) throw new Error('视频超过 4 GiB 缓存上限');
    const browser = await this.prepare(jobId, plan, files);
    const cacheKey = (file: number, offset: number) =>
      new URL(`/__cache__/${jobId}/${files![file]!.name}/${offset}`, location.origin).href;
    const read = async (file: number, offset: number) =>
      isNative
        ? decode(
            await nativeCall('cacheIO', { action: 'get', jobId, name: files![file]!.name, offset }),
          )
        : new Uint8Array(await (await browser!.match(cacheKey(file, offset)))!.arrayBuffer());
    await this.peers.start(files, read);
    let bytes = 0,
      ordinal = 0;
    try {
      for (let file = 0; file < files.length; file++) {
        const f = files[file]!;
        const blocks = Array.from({ length: Math.ceil(f.size / BLOCK_SIZE) }, (_, i) => ({
          offset: i * BLOCK_SIZE,
          ordinal: ordinal++,
        }));
        const distribution = this.peers.distribution();
        blocks.sort(
          (a, b) =>
            (a.ordinal % distribution.count === distribution.index ? 0 : 1) -
              (b.ordinal % distribution.count === distribution.index ? 0 : 1) ||
            a.ordinal - b.ordinal,
        );
        for (const block of blocks) {
          signal.throwIfAborted();
          const length = Math.min(BLOCK_SIZE, f.size - block.offset);
          const preferred = block.ordinal % distribution.count === distribution.index;
          let data = await this.peers.get(
            file,
            block.offset,
            bytes === 0 ? 1500 : preferred ? 0 : 1600,
          );
          if (data) this.peerBytes += data.length;
          else {
            let failure: unknown;
            for (const url of urls[file]!)
              try {
                data = decode(
                  await this.network('fetch', jobId, url, plan.referer, block.offset, length),
                );
                break;
              } catch (e) {
                signal.throwIfAborted();
                failure = e;
              }
            if (data) this.sourceBytes += data.length;
            else {
              data = await this.peers.get(file, block.offset, 8000);
              if (!data) throw failure ?? new Error('无法从成员或视频源获取分块');
              this.peerBytes += data.length;
            }
          }
          signal.throwIfAborted();
          if (data.length !== length) throw new Error('分块长度不符');
          const hash = await hexDigest(data);
          if (isNative)
            await nativeCall('cacheIO', {
              action: 'put',
              jobId,
              name: f.name,
              offset: block.offset,
              data: encode(data),
            });
          else
            await browser!.put(
              cacheKey(file, block.offset),
              new Response(data as Uint8Array<ArrayBuffer>),
            );
          signal.throwIfAborted();
          this.peers.announce(file, block.offset, hash);
          bytes += length;
          this.progress({
            state: 'downloading',
            jobId,
            progress: bytes / total,
            bytes,
            peerBytes: this.peerBytes,
            sourceBytes: this.sourceBytes,
          });
        }
      }
      signal.throwIfAborted();
      let ready: NativeCache;
      if (isNative) ready = await nativeCall('cacheIO', { action: 'finish', jobId });
      else {
        const hashes: string[] = [],
          entries = new Map<string, string>();
        for (let file = 0; file < files.length; file++) {
          const f = files[file]!,
            data = new Uint8Array(f.size);
          for (let offset = 0; offset < f.size; offset += BLOCK_SIZE) {
            signal.throwIfAborted();
            data.set(await read(file, offset), offset);
          }
          hashes.push(await hexDigest(data));
          const url = URL.createObjectURL(
            new Blob([data], { type: f.name.endsWith('m4a') ? 'audio/mp4' : 'video/mp4' }),
          );
          this.objectUrls.push(url);
          entries.set(f.name, url);
        }
        ready = {
          state: 'ready',
          jobId,
          progress: 1,
          bytes,
          fingerprint: await hexDigest(new TextEncoder().encode(hashes.join('\n'))),
          entry: entries.get(plan.entry),
          audio: plan.audio ? entries.get(plan.audio) : undefined,
        };
      }
      signal.throwIfAborted();
      this.progress({ ...ready, peerBytes: this.peerBytes, sourceBytes: this.sourceBytes });
    } catch (e) {
      this.peers.resetCache();
      if (!signal.aborted) await this.clear();
      throw e;
    }
  }
  private async prepare(jobId: string, plan: CachePlan, files: FileInfo[]) {
    if (isNative) {
      await nativeCall('cacheIO', {
        action: 'init',
        jobId,
        entry: plan.entry,
        ...(plan.audio ? { audio: plan.audio } : {}),
        files,
      });
      return null;
    }
    if (!window.isSecureContext || !('caches' in window))
      throw new Error('浏览器完整缓存需要 HTTPS');
    const estimate = await navigator.storage.estimate(),
      total = files.reduce((n, f) => n + f.size, 0);
    if (total > 128 * 1024 ** 2 || files.some((f) => f.size > 96 * 1024 ** 2))
      throw new Error('此视频超过浏览器安全缓存容量，请使用客户端完整缓存');
    if ((estimate.quota ?? 0) - (estimate.usage ?? 0) < total + 32 * 1024 ** 2)
      throw new Error('浏览器可用存储不足');
    this.browserName = PREFIX + Date.now() + '-' + jobId;
    return caches.open(this.browserName);
  }
  async clear() {
    this.controller?.abort();
    this.controller = null;
    this.peers.resetCache();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    const previous = this.jobId,
      name = this.browserName;
    this.jobId = '';
    this.browserName = '';
    if (isNative && previous) await nativeCall('cacheClear', { jobId: previous });
    if (name && 'caches' in window) await caches.delete(name);
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
