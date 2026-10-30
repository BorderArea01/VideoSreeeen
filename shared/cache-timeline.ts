import { BLOCK_SIZE } from './cache-plan';
import { partEnd, type CacheParts } from './cache-parts';

type Box = { type: string; start: number; end: number; body: Uint8Array };
const failure = () => new Error('当前视频缺少可靠的播放索引，不能安全分批清理；请选择完整缓存');
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const result: Box[] = [];
  while (start < end) {
    if (start + 8 > end || result.length > 4096) throw failure();
    const v = view(bytes);
    let size = v.getUint32(start),
      header = 8;
    if (size === 1) {
      if (start + 16 > end) throw failure();
      size = Number(v.getBigUint64(start + 8));
      header = 16;
    }
    if (!size) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw failure();
    result.push({
      type: String.fromCharCode(...bytes.subarray(start + 4, start + 8)),
      start,
      end: start + size,
      body: bytes.subarray(start + header, start + size),
    });
    start += size;
  }
  return result;
}
const child = (box: Box, type: string) => boxes(box.body).find((b) => b.type === type);
const required = (box: Box | undefined) => {
  if (!box) throw failure();
  return box;
};
function table(box: Box, width: number) {
  const v = view(box.body);
  if (v.byteLength < 8) throw failure();
  const count = v.getUint32(4);
  if (count > 1000000 || 8 + count * width > v.byteLength) throw failure();
  return { v, count };
}
function timescale(box: Box) {
  const v = view(box.body),
    offset = box.body[0] === 1 ? 20 : 12;
  if (v.byteLength < offset + 4) throw failure();
  const scale = v.getUint32(offset);
  if (!scale || scale > 1000000000) throw failure();
  return scale;
}
export interface CacheTimeline {
  duration: number;
  /** Upper playable bound after each completed byte batch. */
  upper: number[];
  /** Safe seek start after removing that many byte batches. */
  lower: number[];
  protected: number[];
}

/** Parse only bounded initialization/index bytes, never the full movie. */
export async function cacheTimeline(
  size: number,
  parts: CacheParts,
  read: (offset: number) => Promise<Uint8Array>,
): Promise<CacheTimeline> {
  const protectedBlocks = new Set<number>([0]);
  const get = async (start: number, length: number, protect = false) => {
    if (
      !Number.isSafeInteger(start) ||
      length < 0 ||
      length > 32 * 1024 ** 2 ||
      start + length > size
    )
      throw failure();
    const data = new Uint8Array(length);
    for (let p = Math.floor(start / BLOCK_SIZE) * BLOCK_SIZE; p < start + length; p += BLOCK_SIZE) {
      const block = await read(p);
      if (protect) protectedBlocks.add(p);
      const begin = Math.max(start, p),
        end = Math.min(start + length, p + block.length);
      if (end <= begin) throw failure();
      data.set(block.subarray(begin - p, end - p), begin - start);
    }
    return data;
  };
  let movie: Box | undefined,
    fragmented = false,
    offset = 0,
    count = 0;
  const indexes: Array<{ box: Box; end: number }> = [];
  while (offset + 8 <= size && count++ < 1024) {
    const header = await get(offset, Math.min(16, size - offset));
    const v = view(header);
    let length = v.getUint32(0),
      headerLength = 8;
    if (length === 1) {
      if (header.length < 16) throw failure();
      length = Number(v.getBigUint64(8));
      headerLength = 16;
    }
    if (!length) length = size - offset;
    if (!Number.isSafeInteger(length) || length < headerLength || offset + length > size)
      throw failure();
    const type = String.fromCharCode(...header.subarray(4, 8));
    if (['moov', 'sidx', 'ftyp'].includes(type)) {
      const data = await get(offset, length, true),
        box = boxes(data)[0]!;
      if (type === 'moov') {
        movie = box;
        fragmented = !!child(box, 'mvex');
      }
      if (type === 'sidx') indexes.push({ box, end: offset + length });
    }
    if (movie && (!fragmented || ((type === 'moof' || type === 'mdat') && indexes.length))) break;
    if (movie && fragmented && type === 'moof' && !indexes.length) throw failure();
    offset += length;
  }
  if (!movie) throw failure();
  const upper = Array(parts + 1).fill(Infinity) as number[],
    deletedUntil = Array(parts + 1).fill(0) as number[];
  const syncTracks: number[][] = [];
  let duration = 0,
    operations = 0,
    unitCount = 0;
  const group = (p: number) => {
    for (let i = 1; i <= parts; i++) if (p < partEnd(size, i, parts)) return i;
    throw failure();
  };
  const unit = (start: number, length: number, time: number, end: number) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      start < 0 ||
      start + length > size ||
      !Number.isFinite(time) ||
      !Number.isFinite(end) ||
      end < time ||
      ++unitCount > 1000000
    )
      throw failure();
    let need = 0,
      first = parts + 1;
    for (let p = Math.floor(start / BLOCK_SIZE) * BLOCK_SIZE; p < start + length; p += BLOCK_SIZE) {
      if (++operations > 5000000) throw failure();
      if (protectedBlocks.has(p)) continue;
      const batch = group(p);
      need = Math.max(need, batch);
      first = Math.min(first, batch);
    }
    for (let i = 0; i < need; i++) upper[i] = Math.min(upper[i], Math.max(0, time));
    for (let i = first; i <= parts; i++)
      deletedUntil[i] = Math.max(deletedUntil[i], Math.max(0, end));
    duration = Math.max(duration, end);
  };
  if (fragmented) {
    if (!indexes.length) throw failure();
    for (const { box, end } of indexes) {
      const v = view(box.body),
        version = box.body[0];
      if (![0, 1].includes(version!) || v.byteLength < (version ? 32 : 24)) throw failure();
      const scale = v.getUint32(8);
      if (!scale) throw failure();
      let time = (version ? Number(v.getBigUint64(12)) : v.getUint32(12)) / scale;
      const firstOffset = version ? Number(v.getBigUint64(20)) : v.getUint32(16);
      let at = end + firstOffset;
      const base = version ? 32 : 24,
        entries = v.getUint16(base - 2),
        sync: number[] = [];
      if (!Number.isSafeInteger(at) || entries > 16000 || base + entries * 12 > v.byteLength)
        throw failure();
      for (let i = 0; i < entries; i++) {
        const p = base + i * 12,
          reference = v.getUint32(p),
          length = reference & 0x7fffffff,
          delta = v.getUint32(p + 4) / scale,
          sap = v.getUint32(p + 8);
        if (reference >>> 31 || !delta || !(sap >>> 31) || ![1, 2].includes((sap >>> 28) & 7))
          throw failure();
        sync.push(time);
        unit(at, length, time, time + delta);
        at += length;
        time += delta;
      }
      syncTracks.push(sync);
    }
  } else {
    const movieScale = timescale(required(child(movie, 'mvhd')));
    let tracks = 0;
    for (const track of boxes(movie.body).filter((box) => box.type === 'trak')) {
      const media = required(child(track, 'mdia')),
        handler = required(child(media, 'hdlr'));
      const kind = String.fromCharCode(...handler.body.subarray(8, 12));
      if (!['vide', 'soun'].includes(kind)) continue;
      tracks++;
      const scale = timescale(required(child(media, 'mdhd'))),
        stbl = required(child(required(child(media, 'minf')), 'stbl'));
      let shift = 0;
      const edits = child(track, 'edts'),
        edit = edits && child(edits, 'elst');
      if (edit) {
        const version = edit.body[0],
          width = version === 1 ? 20 : 12,
          { v, count } = table(edit, width);
        let mediaEdit = false;
        for (let i = 0; i < count; i++) {
          const p = 8 + i * width,
            span = version === 1 ? Number(v.getBigUint64(p)) : v.getUint32(p),
            mediaTime = version === 1 ? Number(v.getBigInt64(p + 8)) : v.getInt32(p + 4);
          const rateAt = p + (version === 1 ? 16 : 8);
          if (v.getInt16(rateAt) !== 1 || v.getInt16(rateAt + 2) !== 0 || mediaEdit)
            throw failure();
          if (mediaTime === -1) shift += span / movieScale;
          else {
            if (mediaTime < 0) throw failure();
            shift -= mediaTime / scale;
            mediaEdit = true;
          }
        }
      }
      const sizes = required(child(stbl, 'stsz')),
        sv = view(sizes.body);
      if (sv.byteLength < 12) throw failure();
      const sampleSize = sv.getUint32(4),
        samples = sv.getUint32(8);
      if (!samples || samples > 1000000 || (!sampleSize && sv.byteLength < 12 + samples * 4))
        throw failure();
      const chunk64 = child(stbl, 'co64'),
        chunks = table(required(chunk64 ?? child(stbl, 'stco')), chunk64 ? 8 : 4);
      const map = table(required(child(stbl, 'stsc')), 12),
        timing = table(required(child(stbl, 'stts')), 8);
      const compositionBox = child(stbl, 'ctts'),
        composition = compositionBox ? table(compositionBox, 8) : undefined;
      const keyBox = child(stbl, 'stss'),
        keyTable = keyBox ? table(keyBox, 4) : undefined;
      const keys = keyTable
        ? new Set(Array.from({ length: keyTable.count }, (_, i) => keyTable.v.getUint32(8 + i * 4)))
        : undefined;
      if (!map.count || !timing.count || map.v.getUint32(8) !== 1) throw failure();
      const sync: number[] = [];
      let sample = 0,
        mapping = 0,
        row = 0,
        left = timing.v.getUint32(8),
        dts = 0,
        cRow = 0,
        cLeft = composition?.v.getUint32(8) ?? samples;
      let previousEnd = 0;
      for (let chunk = 1; chunk <= chunks.count; chunk++) {
        if (mapping + 1 < map.count && chunk >= map.v.getUint32(8 + (mapping + 1) * 12)) mapping++;
        const perChunk = map.v.getUint32(12 + mapping * 12);
        let at = chunk64
          ? Number(chunks.v.getBigUint64(8 + (chunk - 1) * 8))
          : chunks.v.getUint32(8 + (chunk - 1) * 4);
        if (!perChunk || at < previousEnd) throw failure();
        for (let i = 0; i < perChunk; i++) {
          if (sample >= samples) throw failure();
          if (!left) {
            row++;
            if (row >= timing.count) throw failure();
            left = timing.v.getUint32(8 + row * 8);
          }
          if (composition && !cLeft) {
            cRow++;
            if (cRow >= composition.count) throw failure();
            cLeft = composition.v.getUint32(8 + cRow * 8);
          }
          const delta = timing.v.getUint32(12 + row * 8),
            cts = composition
              ? compositionBox!.body[0] === 1
                ? composition.v.getInt32(12 + cRow * 8)
                : composition.v.getUint32(12 + cRow * 8)
              : 0;
          if (!delta || !left || !cLeft) throw failure();
          const length = sampleSize || sv.getUint32(12 + sample * 4),
            time = (dts + cts) / scale + shift;
          unit(at, length, time, time + delta / scale);
          if (kind === 'vide' && (!keys || keys.has(sample + 1))) sync.push(Math.max(0, time));
          at += length;
          dts += delta;
          sample++;
          left--;
          cLeft--;
        }
        previousEnd = at;
      }
      if (
        sample !== samples ||
        left ||
        row !== timing.count - 1 ||
        (composition && (cLeft || cRow !== composition.count - 1))
      )
        throw failure();
      if (kind === 'vide') {
        if (!sync.length) throw failure();
        syncTracks.push(sync.sort((a, b) => a - b));
      }
    }
    if (!tracks) throw failure();
  }
  if (!unitCount || !Number.isFinite(duration) || duration <= 0 || duration > 604800)
    throw failure();
  const lower = deletedUntil.map((end, part) =>
    part === 0
      ? 0
      : Math.min(
          duration,
          Math.max(
            end,
            ...syncTracks.map((keys) => keys.find((t) => t >= end - 0.0001) ?? duration),
          ),
        ),
  );
  return {
    duration,
    upper: upper.map((t) => Math.min(duration, t)),
    lower,
    protected: [...protectedBlocks].sort((a, b) => a - b),
  };
}
