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
import {
  browserCacheNetwork,
  cacheRequest,
  checkBrowserCacheSize,
  downloadWholeTrack,
  RangeMetadataUnavailable,
} from './cache-network';
import { BrowserDiskCache } from './disk-cache';
import { cacheDirectory } from './cache-location';
import { cacheStream } from './cache-stream';
import { mp4Bootstrap, partOffsets, type CacheParts } from '../shared/cache-parts';

const PREFIX = 'videosreeeen-';
export class DeviceCache {
  private controller: AbortController | null = null;
  private browserName = '';
  private objectUrls: string[] = [];
  private peerBytes = 0;
  private sourceBytes = 0;
  private disk: BrowserDiskCache | null = null;
  private sequential = new Set<string>();
  private parts: CacheParts = 1;
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
    const result = await browserCacheNetwork(action, url, signal, offset, length);
    if (typeof result === 'object' && 'sequential' in result && result.sequential)
      this.sequential.add(url);
    return result instanceof Uint8Array ? encode(result) : result;
  }
  async start(
    jobId: string,
    server: string,
    planPath: string,
    source: Source,
    parts: CacheParts = 1,
  ) {
    await this.clear();
    this.jobId = jobId;
    this.parts = parts;
    this.controller = new AbortController();
    this.peerBytes = 0;
    this.sourceBytes = 0;
    const signal = this.controller.signal;
    try {
      await this.download(jobId, server, planPath, source, signal);
    } catch (cause) {
      // Failure during planning/probing must clean up too, without clearing a
      // later job that replaced this one while a response was in flight.
      if (this.controller?.signal === signal) await this.clear();
      throw cause;
    }
  }
  private async download(
    jobId: string,
    server: string,
    planPath: string,
    source: Source,
    signal: AbortSignal,
  ) {
    let plan: CachePlan;
    const response = await cacheRequest(
      new URL(planPath, server),
      AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      {},
      'plan',
    );
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
      if (this.parts > 1) throw new Error('HLS 暂使用完整缓存，请选择完整下载后播放');
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
    const disk = this.disk;
    const cacheKey = (file: number, offset: number) =>
      new URL(`/__cache__/${jobId}/${files![file]!.name}/${offset}`, location.origin).href;
    const read = async (file: number, offset: number) =>
      isNative
        ? decode(
            await nativeCall('cacheIO', { action: 'get', jobId, name: files![file]!.name, offset }),
          )
        : disk
          ? disk.get(files![file]!.name, offset)
          : new Uint8Array(await (await browser!.match(cacheKey(file, offset)))!.arrayBuffer());
    await this.peers.start(files, read);
    if (this.parts > 1) {
      await this.downloadParts(jobId, files, urls, plan, signal, read, disk);
      return;
    }
    let bytes = 0,
      ordinal = 0;
    for (let file = 0; file < files.length; file++) {
      const f = files[file]!;
      const complete = new Set<number>();
      const store = async (offset: number, data: Uint8Array) => {
        signal.throwIfAborted();
        if (data.length !== Math.min(BLOCK_SIZE, f.size - offset)) throw new Error('分块长度不符');
        const hash = await hexDigest(data);
        signal.throwIfAborted();
        if (isNative)
          await nativeCall('cacheIO', {
            action: 'put',
            jobId,
            name: f.name,
            offset,
            data: encode(data),
          });
        else if (disk) await disk.put(f.name, offset, data);
        else
          await browser!.put(cacheKey(file, offset), new Response(data as Uint8Array<ArrayBuffer>));
        signal.throwIfAborted();
        this.peers.announce(file, offset, hash);
        if (!complete.has(offset)) {
          bytes += data.length;
          complete.add(offset);
        }
        this.progress({
          state: 'downloading',
          jobId,
          progress: bytes / total,
          bytes,
          peerBytes: this.peerBytes,
          sourceBytes: this.sourceBytes,
        });
      };
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
          let whole = false;
          for (const url of urls[file]!)
            try {
              if (!isNative && this.sequential.has(url)) throw new RangeMetadataUnavailable();
              data = decode(
                await this.network('fetch', jobId, url, plan.referer, block.offset, length),
              );
              break;
            } catch (e) {
              signal.throwIfAborted();
              if (e instanceof RangeMetadataUnavailable) {
                try {
                  await downloadWholeTrack(url, f.size, signal, async (offset, part) => {
                    this.sourceBytes += part.length;
                    await store(offset, part);
                  });
                  whole = true;
                  break;
                } catch (cause) {
                  signal.throwIfAborted();
                  failure = cause;
                  continue;
                }
              }
              failure = e;
            }
          if (whole) break;
          if (data) this.sourceBytes += data.length;
          else {
            data = await this.peers.get(file, block.offset, 8000);
            if (!data) throw failure ?? new Error('无法从成员或视频源获取分块');
            this.peerBytes += data.length;
          }
        }
        await store(block.offset, data);
      }
    }
    signal.throwIfAborted();
    let ready: NativeCache;
    if (isNative) ready = await nativeCall('cacheIO', { action: 'finish', jobId });
    else if (disk) {
      const external = !!cacheDirectory();
      const fingerprint = await disk.finish(!external);
      signal.throwIfAborted();
      const local = external
        ? await cacheStream(
            jobId,
            files,
            async (name, offset) =>
              read(
                files!.findIndex((f) => f.name === name),
                offset,
              ),
            signal,
          )
        : undefined;
      const entry = local ? local(plan.entry) : URL.createObjectURL(await disk.file(plan.entry));
      if (!local) this.objectUrls.push(entry);
      const audio = plan.audio
        ? local
          ? local(plan.audio)
          : URL.createObjectURL(await disk.file(plan.audio))
        : undefined;
      if (audio && !local) this.objectUrls.push(audio);
      ready = {
        state: 'ready',
        jobId,
        progress: 1,
        bytes,
        fingerprint,
        entry,
        ...(audio ? { audio } : {}),
      };
    } else {
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
  }
  private async downloadParts(
    jobId: string,
    files: FileInfo[],
    urls: string[][],
    plan: CachePlan,
    signal: AbortSignal,
    read: (file: number, offset: number) => Promise<Uint8Array>,
    disk: BrowserDiskCache | null,
  ) {
    if (!isNative && !disk) throw new Error('此浏览器暂不支持磁盘分段缓存');
    if (window.VSNative)
      throw new Error('当前 Android 客户端请使用完整缓存，或使用新版网页分段缓存');
    const complete = files.map(() => new Map<number, string>());
    const pending = new Map<string, Promise<Uint8Array>>();
    const whole = new Map<number, { done: Promise<void>; failed?: unknown }>();
    let bytes = 0;
    const total = files.reduce((n, f) => n + f.size, 0);
    const fingerprints: string[] = [];
    const report = (entry?: string, audio?: string) =>
      this.progress({
        state: 'downloading',
        jobId,
        progress: bytes / total,
        bytes,
        peerBytes: this.peerBytes,
        sourceBytes: this.sourceBytes,
        parts: [...fingerprints],
        ...(entry ? { entry } : {}),
        ...(audio ? { audio } : {}),
      });
    const store = async (index: number, offset: number, data: Uint8Array) => {
      const file = files[index]!;
      if (data.length !== Math.min(BLOCK_SIZE, file.size - offset))
        throw new Error('缓存分块长度不符');
      signal.throwIfAborted();
      if (complete[index]!.has(offset)) return;
      const hash = await hexDigest(data);
      if (isNative)
        await nativeCall('cacheIO', {
          action: 'put',
          jobId,
          name: file.name,
          offset,
          data: encode(data),
        });
      else await disk!.put(file.name, offset, data);
      signal.throwIfAborted();
      complete[index]!.set(offset, hash);
      bytes += data.length;
      this.peers.announce(index, offset, hash);
      report();
    };
    const ensure = (index: number, offset: number): Promise<Uint8Array> => {
      signal.throwIfAborted();
      if (complete[index]!.has(offset)) return read(index, offset);
      const key = index + ':' + offset;
      if (pending.has(key)) return pending.get(key)!;
      const task = (async () => {
        const file = files[index]!,
          length = Math.min(BLOCK_SIZE, file.size - offset);
        let data = await this.peers.get(index, offset, 100);
        if (data) this.peerBytes += data.length;
        else {
          let failure: unknown;
          for (const url of urls[index]!) {
            try {
              if (this.sequential.has(url)) throw new RangeMetadataUnavailable();
              data = decode(await this.network('fetch', jobId, url, plan.referer, offset, length));
              break;
            } catch (cause) {
              signal.throwIfAborted();
              failure = cause;
              if (!isNative && cause instanceof RangeMetadataUnavailable) {
                if (!whole.has(index)) {
                  const task = { done: Promise.resolve(), failed: undefined as unknown };
                  task.done = downloadWholeTrack(url, file.size, signal, async (p, chunk) => {
                    this.sourceBytes += chunk.length;
                    await store(index, p, chunk);
                  }).catch((error) => {
                    task.failed = error;
                    throw error;
                  });
                  void task.done.catch(() => {});
                  whole.set(index, task);
                }
                const deadline = Date.now() + 30000;
                while (!complete[index]!.has(offset)) {
                  signal.throwIfAborted();
                  if (whole.get(index)!.failed) throw whole.get(index)!.failed;
                  if (Date.now() > deadline) throw new Error('等待顺序下载超时，请选择完整缓存');
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                return read(index, offset);
              }
            }
          }
          if (!data)
            throw failure instanceof RangeMetadataUnavailable
              ? new Error('源站未公开可靠的分块范围，请改用完整缓存')
              : (failure ?? new Error('缓存分块下载失败'));
          this.sourceBytes += data.length;
        }
        await store(index, offset, data);
        return data;
      })().finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    };
    const localUrl = isNative
      ? (name: string) => `vs-cache://${jobId}/${name}`
      : await cacheStream(
          jobId,
          files,
          async (name, offset, requestSignal) => {
            const index = files.findIndex((f) => f.name === name),
              deadline = Date.now() + 28000;
            while (!complete[index]?.has(offset)) {
              signal.throwIfAborted();
              requestSignal.throwIfAborted();
              if (Date.now() > deadline) throw new Error('等待后续缓存超时，请重试本机缓存');
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            signal.throwIfAborted();
            return read(index, offset);
          },
          signal,
        );
    const bootstrap: number[][] = [];
    for (let i = 0; i < files.length; i++) {
      bootstrap[i] = await mp4Bootstrap(files[i]!.size, (offset) => ensure(i, offset));
      for (const offset of bootstrap[i]!) await ensure(i, offset);
    }
    for (let part = 1; part <= this.parts; part++) {
      const hashes: unknown[] = [];
      for (let i = 0; i < files.length; i++) {
        for (const offset of partOffsets(files[i]!.size, part, this.parts)) await ensure(i, offset);
        const offsets = [
          ...new Set([
            ...bootstrap[i]!,
            ...Array.from({ length: part }, (_, p) =>
              partOffsets(files[i]!.size, p + 1, this.parts),
            ).flat(),
          ]),
        ].sort((a, b) => a - b);
        hashes.push([
          files[i]!.name,
          files[i]!.size,
          offsets.map((offset) => [offset, complete[i]!.get(offset)]),
        ]);
      }
      fingerprints.push(await hexDigest(new TextEncoder().encode(JSON.stringify(hashes))));
      signal.throwIfAborted();
      report(
        part === 1 ? localUrl(plan.entry) : undefined,
        part === 1 && plan.audio ? localUrl(plan.audio) : undefined,
      );
    }
    await Promise.all([...whole.values()].map((task) => task.done));
    const ready = isNative
      ? await nativeCall('cacheIO', { action: 'finish', jobId })
      : {
          fingerprint: await disk!.finish(false),
        };
    signal.throwIfAborted();
    this.progress({
      state: 'ready',
      jobId,
      progress: 1,
      bytes,
      fingerprint: ready.fingerprint,
      parts: fingerprints,
      peerBytes: this.peerBytes,
      sourceBytes: this.sourceBytes,
    });
  }
  private async prepare(jobId: string, plan: CachePlan, files: FileInfo[]) {
    if (isNative) {
      await nativeCall('cacheIO', {
        action: 'init',
        jobId,
        entry: plan.entry,
        ...(plan.audio ? { audio: plan.audio } : {}),
        files,
        progressive: this.parts > 1,
      });
      return null;
    }
    if (!window.isSecureContext || !('caches' in window))
      throw new Error('浏览器完整缓存需要 HTTPS');
    const large =
      files.reduce((n, f) => n + f.size, 0) > 128 * 1024 ** 2 ||
      files.some((f) => f.size > 96 * 1024 ** 2);
    if (large && !BrowserDiskCache.supported()) checkBrowserCacheSize(files);
    const external = !!cacheDirectory();
    const estimate = external ? {} : await navigator.storage.estimate(),
      total = files.reduce((n, f) => n + f.size, 0);
    if (
      !external &&
      (estimate.quota ?? 0) - (estimate.usage ?? 0) < total + (large ? 256 : 32) * 1024 ** 2
    )
      throw new Error('浏览器可用存储不足');
    if (large || external || this.parts > 1) {
      this.disk = await BrowserDiskCache.create(jobId, files, this.controller!.signal);
      return null;
    }
    this.browserName = PREFIX + Date.now() + '-' + jobId;
    return caches.open(this.browserName);
  }
  async clear() {
    this.controller?.abort();
    this.controller = null;
    this.sequential.clear();
    this.peers.resetCache();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    const previous = this.jobId,
      name = this.browserName;
    this.jobId = '';
    this.browserName = '';
    const disk = this.disk;
    this.disk = null;
    if (disk) await disk.clear();
    if (isNative && previous) await nativeCall('cacheClear', { jobId: previous });
    if (name && 'caches' in window) await caches.delete(name);
  }
  async sweep() {
    if (!isNative) await BrowserDiskCache.sweep();
    if (!isNative && 'caches' in window)
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX)) {
          const created = Number(key.slice(PREFIX.length).split('-')[0]);
          if (Number.isFinite(created) && Date.now() - created > 24 * 60 * 60 * 1000)
            await caches.delete(key);
        }
  }
}
