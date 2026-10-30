import { BLOCK_SIZE } from './cache-plan';

export type CacheParts = 1 | 2 | 3;
export function partEnd(size: number, part: number, parts: CacheParts) {
  return Math.min(size, Math.ceil((Math.ceil(size / BLOCK_SIZE) * part) / parts) * BLOCK_SIZE);
}
export function partOffsets(size: number, part: number, parts: CacheParts) {
  const start = partEnd(size, part - 1, parts),
    end = partEnd(size, part, parts);
  return Array.from(
    { length: Math.ceil((end - start) / BLOCK_SIZE) },
    (_, i) => start + i * BLOCK_SIZE,
  );
}

/** Find MP4 initialization boxes without downloading the intervening mdat. */
export async function mp4Bootstrap(size: number, read: (offset: number) => Promise<Uint8Array>) {
  const needed = new Set<number>([0]);
  let offset = 0,
    boxes = 0,
    found = false;
  while (offset + 8 <= size && boxes++ < 1024) {
    const blockOffset = Math.floor(offset / BLOCK_SIZE) * BLOCK_SIZE;
    const block = await read(blockOffset);
    needed.add(blockOffset);
    let header = block.subarray(offset - blockOffset, offset - blockOffset + 16);
    if (header.length < Math.min(16, size - offset) && blockOffset + BLOCK_SIZE < size) {
      const next = await read(blockOffset + BLOCK_SIZE);
      needed.add(blockOffset + BLOCK_SIZE);
      header = new Uint8Array([...header, ...next.subarray(0, 16 - header.length)]);
    }
    if (header.length < 8) throw new Error('MP4 初始化信息不完整');
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let length = view.getUint32(0);
    const type = String.fromCharCode(...header.subarray(4, 8));
    if (length === 1) {
      if (header.length < 16) throw new Error('MP4 初始化信息不完整');
      length = Number(view.getBigUint64(8));
    } else if (length === 0) length = size - offset;
    if (!Number.isSafeInteger(length) || length < 8 || offset + length > size)
      throw new Error('当前文件不支持安全分段缓存，请选择完整缓存');
    if (type === 'moov' || type === 'ftyp' || type === 'sidx') {
      if (length > 32 * 1024 ** 2) throw new Error('MP4 初始化信息过大，请选择完整缓存');
      for (let p = blockOffset; p < offset + length; p += BLOCK_SIZE) needed.add(p);
    }
    if (type === 'moov') {
      found = true;
      break;
    }
    offset += length;
  }
  if (!found) throw new Error('此格式暂不支持分段缓存，请选择完整缓存');
  return [...needed].sort((a, b) => a - b);
}
