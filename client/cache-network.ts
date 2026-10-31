import { CacheTransferError } from './cache-recovery';
const MiB = 1024 ** 2;
export class RangeMetadataUnavailable extends Error {}

export function checkBrowserCacheSize(files: { size: number }[]) {
  const total = files.reduce((n, file) => n + file.size, 0);
  if (total > 128 * MiB || files.some((file) => file.size > 96 * MiB))
    throw new Error(
      `视频共 ${(total / MiB).toFixed(1)} MiB，超过网页缓存容量（单轨 96 MiB、合计 128 MiB）。请返回边播边看；全员使用客户端时可缓存更大的视频。`,
    );
}

/** Fetch independently of a prior <video> response lacking Vary: Origin. */
export async function cacheRequest(
  url: string | URL,
  signal: AbortSignal,
  init: RequestInit = {},
  stage: 'source' | 'plan' = 'source',
  fetcher: typeof fetch = fetch,
) {
  try {
    return await fetcher(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
  } catch (cause) {
    if (signal.aborted && signal.reason?.name === 'TimeoutError')
      throw new CacheTransferError(
        stage === 'plan' ? '读取房间缓存计划超时，请重试。' : '视频缓存下载超时，请重试。',
      );
    signal.throwIfAborted();
    // Fetch intentionally conceals the difference between CORS and network
    // failures. Never publish a raw exception containing a signed source URL.
    throw new CacheTransferError(
      stage === 'plan'
        ? '无法读取房间缓存计划，请检查房间连接后重试。'
        : '无法下载视频：可能是网络中断或源站未允许网页跨域下载。可以重试，或返回边播边看。',
      { cause },
    );
  }
}

export async function browserCacheNetwork(
  action: 'probe' | 'fetch' | 'text',
  url: string,
  parent: AbortSignal,
  offset = 0,
  length = 1,
  fetcher: typeof fetch = fetch,
): Promise<{ size: number; sequential?: boolean } | Uint8Array | string> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)]);
  try {
    const response = await cacheRequest(
      url,
      signal,
      { headers: action === 'text' ? {} : { Range: `bytes=${offset}-${offset + length - 1}` } },
      'source',
      fetcher,
    );
    const rawRange = response.headers.get('content-range');
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(rawRange ?? '');
    try {
      if (!response.ok)
        throw new (
          response.status === 408 || response.status === 429 || response.status >= 500
            ? CacheTransferError
            : Error
        )(`视频源拒绝缓存下载（HTTP ${response.status}），请重新识别视频或返回边播边看。`);
      if (action !== 'text') {
        if (response.status !== 206)
          throw new Error('源站不支持分块下载，请返回边播边看或使用客户端。');
        if (rawRange === null) {
          if (action !== 'probe')
            throw new RangeMetadataUnavailable('源站未向网页公开分块范围，改为校验完整响应。');
          // Content-Length on a range is only the block length. HEAD can expose
          // the full size, so oversized movies receive the correct capacity
          // error before any download. It does not waive range verification.
          await response.body?.cancel();
          const head = await cacheRequest(url, signal, { method: 'HEAD' }, 'source', fetcher);
          try {
            const size = Number(head.headers.get('content-length'));
            if (head.status === 200 && Number.isSafeInteger(size) && size > 0)
              return { size, sequential: true };
            throw new Error('源站未向网页公开视频大小，无法完整缓存；请返回边播边看或使用客户端。');
          } finally {
            await head.body?.cancel();
          }
        }
        if (
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) !== offset + length - 1 ||
          !Number.isSafeInteger(Number(match[3])) ||
          Number(match[3]) <= Number(match[2])
        )
          throw new Error('视频源返回的分块范围无效，缓存未完成。');
      }
      if (!response.body) throw new Error('视频源没有返回下载内容。');
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let size = 0;
      const max = action === 'text' ? 2 * MiB : length;
      try {
        while (true) {
          const part = await reader.read();
          signal.throwIfAborted();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > max) throw new Error('下载超过分块上限，缓存未完成。');
          parts.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (action !== 'text' && size !== max) throw new Error('分块未完整下载，请重试缓存。');
      if (action === 'probe') return { size: Number(match![3]) };
      const data = new Uint8Array(size);
      let n = 0;
      for (const part of parts) {
        data.set(part, n);
        n += part.byteLength;
      }
      return action === 'text' ? new TextDecoder().decode(data) : data;
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  } catch (cause) {
    parent.throwIfAborted();
    if (signal.aborted) throw new CacheTransferError('视频缓存下载超时，请检查网络后重试。');
    if (cause instanceof TypeError)
      throw new CacheTransferError('视频缓存下载中断，请重试，或返回边播边看。');
    throw cause;
  }
}

/** A complete CORS-readable response needs no exposed Content-Range. Bytes
 * are split into bounded blocks and committed before reading further. */
export async function downloadWholeTrack(
  url: string,
  size: number,
  parent: AbortSignal,
  put: (offset: number, data: Uint8Array) => Promise<void>,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('下载超时', 'TimeoutError')), 30000);
  };
  reset();
  let response: Response | undefined;
  try {
    response = await cacheRequest(url, signal, {}, 'source', fetcher);
    if (response.status === 408 || response.status === 429 || response.status >= 500)
      throw new CacheTransferError('视频源暂时无法提供下载，请稍后继续。');
    if (
      response.status !== 200 ||
      Number(response.headers.get('content-length')) !== size ||
      !response.body
    )
      throw new Error('视频完整响应与预计大小不符，缓存未完成。');
    const reader = response.body.getReader();
    const blockSize = 256 * 1024;
    let offset = 0,
      used = 0,
      block = new Uint8Array(Math.min(blockSize, size));
    try {
      while (true) {
        reset();
        const { value, done } = await reader.read();
        clearTimeout(timer!);
        signal.throwIfAborted();
        if (done) break;
        if (offset + used + value.length > size)
          throw new Error('视频下载超过预计大小，缓存未完成。');
        let n = 0;
        while (n < value.length) {
          signal.throwIfAborted();
          const count = Math.min(value.length - n, block.length - used);
          block.set(value.subarray(n, n + count), used);
          used += count;
          n += count;
          if (used === block.length) {
            await put(offset, block);
            offset += used;
            used = 0;
            block = new Uint8Array(Math.min(blockSize, size - offset));
          }
        }
      }
      if (offset !== size || used) throw new CacheTransferError('视频未完整下载，请重试缓存。');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (cause) {
    parent.throwIfAborted();
    if (controller.signal.aborted) throw new CacheTransferError('视频缓存下载超时，请重试。');
    if (cause instanceof TypeError) throw new CacheTransferError('视频完整下载中断，请重试缓存。');
    throw cause;
  } finally {
    clearTimeout(timer!);
    await response?.body?.cancel().catch(() => {});
  }
}
