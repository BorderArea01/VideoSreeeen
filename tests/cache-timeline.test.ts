import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheTimeline } from '../shared/cache-timeline';
import { BLOCK_SIZE } from '../shared/cache-plan';

const u32 = (...values: number[]) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
};
const box = (name: string, ...data: Uint8Array[]) => {
  const bytes = Buffer.concat(data);
  return Buffer.concat([u32(bytes.length + 8), Buffer.from(name), bytes]);
};
function fixture() {
  const samples = 120,
    sampleSize = 32768;
  const header = box('ftyp', Buffer.from('isom0000'));
  const makeMovie = (offset: number) => {
    const table = box(
      'stbl',
      box('stsz', u32(0, sampleSize, samples)),
      box(
        'stco',
        u32(0, samples, ...Array.from({ length: samples }, (_, i) => offset + i * sampleSize)),
      ),
      box('stsc', u32(0, 1, 1, 1, 1)),
      box('stts', u32(0, 1, samples, 1000)),
      box('stss', u32(0, 12, ...Array.from({ length: 12 }, (_, i) => 1 + i * 10))),
    );
    const media = box(
      'mdia',
      box('mdhd', u32(0, 0, 0, 10000)),
      box('hdlr', u32(0, 0), Buffer.from('vide')),
      box('minf', table),
    );
    return box('moov', box('mvhd', u32(0, 0, 0, 1000)), box('trak', media));
  };
  const movie = makeMovie(header.length + makeMovie(0).length + 8);
  return Buffer.concat([header, movie, box('mdat', Buffer.alloc(samples * sampleSize))]);
}
test('MP4 按真实样本时间和关键帧计算已缓存窗口，不能用文件比例冒充播放时长', async () => {
  const data = fixture();
  let readBytes = 0;
  const timeline = await cacheTimeline(data.length, 3, async (offset) => {
    const b = data.subarray(offset, offset + BLOCK_SIZE);
    readBytes += b.length;
    return b;
  });
  assert.equal(timeline.duration, 12);
  assert.ok(readBytes < data.length / 2);
  assert.ok(timeline.upper[1]! > 2 && timeline.upper[1]! < 5);
  assert.ok(timeline.lower[1]! >= timeline.upper[1]!);
  assert.ok(Number.isInteger(timeline.lower[1]!), 'Seek boundary must retain a decoding keyframe');
  assert.deepEqual(timeline.protected, [0]);
});
test('无时间索引或畸形的 MP4 拒绝逐段清理，不能猜测播放边界', async () => {
  for (const data of [Buffer.alloc(16), box('moov', box('mvhd', u32(0, 0, 0, 1000)))])
    await assert.rejects(
      cacheTimeline(data.length, 3, async (offset) => data.subarray(offset, offset + BLOCK_SIZE)),
      /可靠.*索引/,
    );
});
test('DASH 使用原始 sidx 的时间、范围和随机访问点，拒绝层级索引或未知关键帧', async () => {
  const movie = box('moov', box('mvex'));
  const referenceSize = 400000;
  const index = (sap = 0x90000000, reference = referenceSize) =>
    box(
      'sidx',
      u32(
        0,
        1,
        1000,
        0,
        0,
        3,
        reference,
        4000,
        sap,
        referenceSize,
        4000,
        sap,
        referenceSize,
        4000,
        sap,
      ),
    );
  const build = (sidx: Buffer) =>
    Buffer.concat([
      movie,
      sidx,
      ...Array.from({ length: 3 }, () => box('moof', Buffer.alloc(referenceSize - 8))),
    ]);
  const data = build(index());
  const timeline = await cacheTimeline(data.length, 3, async (offset) =>
    data.subarray(offset, offset + BLOCK_SIZE),
  );
  assert.equal(timeline.duration, 12);
  assert.equal(timeline.upper[1], 4);
  for (const invalid of [build(index(0)), build(index(0x90000000, 0x80000000 + referenceSize))])
    await assert.rejects(
      cacheTimeline(invalid.length, 3, async (offset) =>
        invalid.subarray(offset, offset + BLOCK_SIZE),
      ),
      /可靠.*索引/,
    );
});
