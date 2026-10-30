import type { FileInfo } from './peers';
import { cacheDirectory, authorizeCacheDirectory } from './cache-location';

const ROOT = 'videosreeeen-disk';
export class BrowserDiskCache {
  private worker: Worker;
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private release = () => {};
  private parent?: FileSystemDirectoryHandle;
  private constructor(private directory: string) {
    this.worker = new Worker(new URL('./disk-cache-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.value);
    };
    this.worker.onerror = () => {
      this.closed = true;
      this.worker.terminate();
      this.rejectAll(new Error('浏览器磁盘缓存进程失败，请重试。'));
    };
  }
  static supported() {
    return !!navigator.storage?.getDirectory && typeof Worker !== 'undefined' && !!navigator.locks;
  }
  static async create(jobId: string, files: FileInfo[], signal: AbortSignal) {
    await authorizeCacheDirectory();
    const store = new BrowserDiskCache(`${Date.now()}-${jobId}`);
    store.parent = cacheDirectory();
    const stop = () => {
      void store.clear().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request(ROOT + ':' + store.directory, async () => {
            await new Promise<void>((release) => {
              store.release = release;
              resolve();
            });
          })
          .catch(reject);
      });
      signal.throwIfAborted();
      await store.call('init', { directory: store.directory, files, parent: store.parent });
      signal.throwIfAborted();
      return store;
    } catch (cause) {
      await store.clear();
      throw cause;
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
  private rejectAll(error: Error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  private call(
    action: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<any> {
    if (this.closed) return Promise.reject(new DOMException('缓存已取消', 'AbortError'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, action, ...payload }, transfer);
    });
  }
  async put(name: string, offset: number, data: Uint8Array) {
    const copy = data.slice().buffer;
    await this.call('put', { name, offset, data: copy }, [copy]);
  }
  async get(name: string, offset: number): Promise<Uint8Array> {
    return new Uint8Array(await this.call('get', { name, offset }));
  }
  async finish(assemble = true): Promise<string> {
    return this.call('finish', { assemble });
  }
  async file(name: string) {
    if (this.closed) throw new DOMException('缓存已取消', 'AbortError');
    const root = await (this.parent ?? (await navigator.storage.getDirectory())).getDirectoryHandle(
      ROOT,
    );
    return (await (await root.getDirectoryHandle(this.directory)).getFileHandle(name)).getFile();
  }
  async clear() {
    this.closed = true;
    this.worker.terminate();
    this.rejectAll(new DOMException('缓存已取消', 'AbortError'));
    try {
      const root = await (
        this.parent ?? (await navigator.storage.getDirectory())
      ).getDirectoryHandle(ROOT);
      await root.removeEntry(this.directory, { recursive: true });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
    } finally {
      this.release();
    }
  }
  static async sweep() {
    if (!this.supported()) return;
    const parents: Array<{ handle: FileSystemDirectoryHandle; external: boolean }> = [
      { handle: await navigator.storage.getDirectory(), external: false },
    ];
    const selected = cacheDirectory();
    if (selected && (await selected.queryPermission({ mode: 'readwrite' })) === 'granted')
      parents.push({ handle: selected, external: true });
    for (const parent of parents) {
      let root: FileSystemDirectoryHandle;
      try {
        root = await parent.handle.getDirectoryHandle(ROOT);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'NotFoundError') continue;
        throw cause;
      }
      for await (const name of (
        root as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }
      ).keys()) {
        if (
          !/^\d+-[a-zA-Z0-9-]{1,80}$/.test(name) ||
          Date.now() - Number(name.split('-')[0]) < 24 * 60 * 60 * 1000
        )
          continue;
        await navigator.locks.request(ROOT + ':' + name, { ifAvailable: true }, async (lock) => {
          if (!lock) return;
          if (parent.external) {
            try {
              const directory = await root.getDirectoryHandle(name);
              const owner = JSON.parse(
                await (
                  await (await directory.getFileHandle('videosreeeen-owner.json')).getFile()
                ).text(),
              );
              if (owner.app !== 'videosreeeen-disk-v1' || owner.directory !== name) return;
            } catch {
              return;
            }
          }
          await root.removeEntry(name, { recursive: true });
        });
      }
    }
  }
}
