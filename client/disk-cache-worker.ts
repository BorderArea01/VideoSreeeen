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
globalThis.onmessage = (event: MessageEvent) => {
  const { id, action, ...p } = event.data;
  chain = chain.then(async () => {
    try {
      let value: unknown;
      if (action === 'init') {
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
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('videosreeeen-disk', { create: true });
        const directory = await root.getDirectoryHandle(p.directory, { create: true });
        for (const f of p.files) {
          if (
            !validName(f.name) ||
            !Number.isSafeInteger(f.size) ||
            f.size < 1 ||
            files.has(f.name)
          )
            throw new Error('磁盘缓存文件无效');
          const handle = await directory.getFileHandle(f.name, { create: true });
          if (typeof (handle as any).createSyncAccessHandle !== 'function')
            throw new Error('此浏览器暂不支持磁盘缓存，请更新浏览器或使用客户端。');
          const access = await (
            handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<Access> }
          ).createSyncAccessHandle();
          files.set(f.name, { size: f.size, handle, access, blocks: new Set() });
        }
      } else if (action === 'finish') {
        const hashes: string[] = [];
        const buffer = new Uint8Array(BLOCK_SIZE);
        for (const f of files.values()) {
          if (!f.access || f.blocks.size !== Math.ceil(f.size / BLOCK_SIZE))
            throw new Error('磁盘缓存尚未完整');
          f.access.flush();
          const hash = sha256.create();
          for (let offset = 0; offset < f.size; offset += BLOCK_SIZE) {
            const part = buffer.subarray(0, Math.min(BLOCK_SIZE, f.size - offset));
            if (f.access.read(part, { at: offset }) !== part.length)
              throw new Error('磁盘缓存读取不完整');
            hash.update(part);
          }
          hashes.push(hex(hash.digest()));
        }
        for (const f of files.values()) {
          f.access!.close();
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
            !f.access ||
            data.length !== length ||
            f.access.write(data, { at: p.offset }) !== length
          )
            throw new Error('磁盘分块写入不完整');
          f.blocks.add(p.offset);
        } else if (action === 'get' && f.blocks.has(p.offset)) {
          if (f.access) {
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
