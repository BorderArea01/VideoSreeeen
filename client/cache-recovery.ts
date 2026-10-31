/** Transient transfer failures only; range/content validation stays fatal. */
export class CacheTransferError extends Error {}

export function cacheWait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One suspended operation keeps its caller's verified blocks and hash state. */
export class CacheRecovery {
  private retries = new Set<() => void>();
  get waiting() {
    return this.retries.size > 0;
  }
  resume() {
    const pending = [...this.retries];
    if (!pending.length) return false;
    this.retries.clear();
    for (const run of pending) run();
    return true;
  }
  async run<T>(
    task: () => Promise<T>,
    signal: AbortSignal,
    paused: (note: string) => void,
    resumed: () => void,
  ): Promise<T> {
    for (;;) {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          return await task();
        } catch (cause) {
          signal.throwIfAborted();
          const io =
            cause instanceof DOMException &&
            ['NotAllowedError', 'NoModificationAllowedError', 'QuotaExceededError'].includes(
              cause.name,
            );
          if (!(cause instanceof CacheTransferError) && !io) throw cause;
          const automatic =
            cause instanceof CacheTransferError ||
            (cause instanceof DOMException && cause.name === 'NoModificationAllowedError');
          if (automatic && attempt < 2) {
            await cacheWait(400 * (attempt + 1), signal);
            continue;
          }
          const note =
            cause instanceof DOMException
              ? cause.name === 'QuotaExceededError'
                ? '磁盘空间不足，已保留完成的缓存；释放空间后继续。'
                : cause.name === 'NotAllowedError'
                  ? '缓存目录需要重新允许写入，已保留完成的缓存。'
                  : '缓存文件暂被占用，已保留完成的缓存；可稍后继续。'
              : '下载暂时中断，已保留完成的缓存；网络恢复后可继续。';
          await new Promise<void>((resolve, reject) => {
            const retry = () => {
              signal.removeEventListener('abort', abort);
              resolve();
            };
            const abort = () => {
              this.retries.delete(retry);
              reject(signal.reason);
            };
            this.retries.add(retry);
            signal.addEventListener('abort', abort, { once: true });
            paused(note);
          });
          signal.throwIfAborted();
          resumed();
          break;
        }
      }
    }
  }
}
