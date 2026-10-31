import { sha256 } from '@noble/hashes/sha2.js';
import { BLOCK_SIZE, MAX_CACHE, validName } from '../shared/cache-plan';

interface Access {
  write(data: Uint8Array, options: { at: number }): number;
  read(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
const files = new Map<
  string,
  { size: number; handle: FileSystemFileHandle; access?: Access; blocks: Set<number> }
>();
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
let chain = Promise.resolve();
let external: FileSystemDirectoryHandle | undefined;
const deferred = new Map<string, number>();
async function drainDrops() {
  let bytes = 0;
  for (const [name, size] of [...deferred].slice(0, 256)) {
    try {
      await external!.removeEntry(name);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) continue;
    }
    deferred.delete(name);
    bytes += size;
  }
  return { bytes, pending: deferred.size };
}
async function externalBlock(name: string, offset: number, length: number) {
  const data = await (
    await (await external!.getFileHandle(name + '.' + offset + '.part')).getFile()
  ).arrayBuffer();
  if (data.byteLength !== length) throw new Error('磁盘缓存分块长度已变化，请重新缓存');
  return data;
}
globalThis.onmessage = (event: MessageEvent) => {
  const { id, action, ...p } = event.data;
  chain = chain.then(async () => {
    try {
      let value: unknown;
      if (action === 'close') {
        for (const f of files.values()) {
          try {
            f.access?.close();
          } catch {
            /* Termination still releases a failed handle. */
          } finally {
            f.access = undefined;
          }
        }
        files.clear();
        external = undefined;
        deferred.clear();
      } else if (action === 'retry-drops') {
        value = await drainDrops();
      } else if (action === 'init') {
        if (files.size || !/^\d+-[a-zA-Z0-9-]{1,80}$/.test(p.directory))
          throw new Error('磁盘缓存目录无效');
        if (
          !Array.isArray(p.files) ||
          !p.files.length ||
          p.files.length > 2 ||
          p.files.reduce((n: number, f: { size: number }) => n + f.size, 0) > MAX_CACHE
        )
          throw new Error('磁盘缓存计划无效');
        const root = await (
          p.parent ?? (await navigator.storage.getDirectory())
        ).getDirectoryHandle('videosreeeen-disk', { create: true });
        const directory = await root.getDirectoryHandle(p.directory, { create: true });
        if (p.parent) {
          external = directory;
          const marker = await (
            await directory.getFileHandle('videosreeeen-owner.json', { create: true })
          ).createWritable();
          await marker.write(
            JSON.stringify({ app: 'videosreeeen-disk-v1', directory: p.directory }),
          );
          await marker.close();
        }
        if (p.blocks) external = directory;
        for (const f of p.files) {
          if (
            !validName(f.name) ||
            !Number.isSafeInteger(f.size) ||
            f.size < 1 ||
            files.has(f.name)
          )
            throw new Error('磁盘缓存文件无效');
          const handle = await directory.getFileHandle(f.name, { create: true });
          if (!external && typeof (handle as any).createSyncAccessHandle !== 'function')
            throw new Error('此浏览器暂不支持磁盘缓存，请更新浏览器或使用客户端。');
          const access = external
            ? undefined
            : await (
                handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<Access> }
              ).createSyncAccessHandle();
          files.set(f.name, { size: f.size, handle, access, blocks: new Set() });
        }
      } else if (action === 'drop') {
        const f = files.get(p.name);
        if (
          !external ||
          !f ||
          !Array.isArray(p.offsets) ||
          p.offsets.length > 256 ||
          p.offsets.some(
            (offset: number) =>
              !Number.isSafeInteger(offset) ||
              offset < 0 ||
              offset % BLOCK_SIZE ||
              offset >= f.size,
          )
        )
          throw new Error('缓存清理范围无效');
        for (const offset of new Set<number>(p.offsets))
          if (f.blocks.has(offset)) {
            // Withdraw availability first. A locked watched file may remain on
            // disk, but can never be served or advertised as retained again.
            deferred.set(p.name + '.' + offset + '.part', Math.min(BLOCK_SIZE, f.size - offset));
            f.blocks.delete(offset);
          }
        value = await drainDrops();
      } else if (action === 'finish') {
        const hashes: string[] = [];
        const buffer = new Uint8Array(BLOCK_SIZE);
        for (const [name, f] of files) {
          if ((!f.access && !external) || f.blocks.size !== Math.ceil(f.size / BLOCK_SIZE))
            throw new Error('磁盘缓存尚未完整');
          f.access?.flush();
          const hash = sha256.create();
          const output =
            external && p.assemble !== false ? await f.handle.createWritable() : undefined;
          for (let offset = 0; offset < f.size; offset += BLOCK_SIZE) {
            const part = buffer.subarray(0, Math.min(BLOCK_SIZE, f.size - offset));
            if (external) part.set(new Uint8Array(await externalBlock(name, offset, part.length)));
            else if (f.access!.read(part, { at: offset }) !== part.length)
              throw new Error('磁盘缓存读取不完整');
            hash.update(part);
            if (output) await output.write(part as Uint8Array<ArrayBuffer>);
          }
          await output?.close();
          hashes.push(hex(hash.digest()));
        }
        for (const f of files.values()) {
          f.access?.close();
          f.access = undefined;
        }
        value = hex(sha256(new TextEncoder().encode(hashes.join('\n'))));
      } else {
        const f = files.get(p.name);
        if (
          !f ||
          !Number.isSafeInteger(p.offset) ||
          p.offset < 0 ||
          p.offset % BLOCK_SIZE ||
          p.offset >= f.size
        )
          throw new Error('磁盘分块地址无效');
        const length = Math.min(BLOCK_SIZE, f.size - p.offset);
        if (action === 'put') {
          const data = new Uint8Array(p.data);
          if (
            (!f.access && !external) ||
            data.length !== length ||
            (!external && f.access!.write(data, { at: p.offset }) !== length)
          )
            throw new Error('磁盘分块写入不完整');
          if (external) {
            const handle = await external.getFileHandle(p.name + '.' + p.offset + '.part', {
              create: true,
            });
            const output = await handle.createWritable();
            try {
              await output.write(data);
              await output.close();
            } catch (cause) {
              await output.abort().catch(() => {});
              throw cause;
            }
          }
          f.blocks.add(p.offset);
        } else if (action === 'get' && f.blocks.has(p.offset)) {
          if (external)
            value = await (
              await (await external.getFileHandle(p.name + '.' + p.offset + '.part')).getFile()
            ).arrayBuffer();
          else if (f.access) {
            const data = new Uint8Array(length);
            if (f.access.read(data, { at: p.offset }) !== length)
              throw new Error('磁盘分块读取不完整');
            value = data.buffer;
          } else
            value = await (
              await f.handle.getFile()
            )
              .slice(p.offset, p.offset + length)
              .arrayBuffer();
        } else throw new Error('磁盘分块不可用');
      }
      globalThis.postMessage(
        { id, value },
        { transfer: value instanceof ArrayBuffer ? [value] : [] },
      );
    } catch (cause) {
      globalThis.postMessage({
        id,
        errorName: cause instanceof DOMException ? cause.name : undefined,
        error:
          cause instanceof DOMException && cause.name === 'QuotaExceededError'
            ? '浏览器磁盘空间不足，缓存未完成。'
            : cause instanceof Error
              ? cause.message
              : '磁盘缓存失败',
      });
    }
  });
};
