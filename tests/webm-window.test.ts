import test from 'node:test';
import assert from 'node:assert/strict';
import { WebMWindow } from '../server/webm-window';
import { init, cluster, element } from './webm.fixture';

test('WebM 按 EBML 边界保留初始化与近期关键帧，编码载荷中的假 Cluster 不被误识别', () => {
  const window = new WebMWindow();
  const first = cluster(1),
    delta = cluster(2, false),
    latest = cluster(3);
  const stream = Buffer.concat([init, first, delta, latest]);
  for (const byte of stream) window.push(new Uint8Array([byte]));
  assert.deepEqual(
    window.bootstrap()?.map((bytes) => Buffer.from(bytes)),
    [init, latest],
  );
  assert.equal(window.unavailable(), false);
});

test('尚无视频关键帧时不发送无法解码的中途片段，超限时清空有界历史', () => {
  const window = new WebMWindow();
  window.push(Buffer.concat([init, cluster(1, false)]));
  assert.equal(window.bootstrap(), null);
  window.push(new Uint8Array(9 * 1024 * 1024));
  assert.equal(window.bootstrap(), null);
  assert.equal(window.unavailable(), true);
});

test('Chrome MediaRecorder 的 BlockGroup 无 ReferenceBlock 表示视频关键帧', () => {
  const key = element('1f43b675', element('a0', element('a1', [129, 0, 0, 0, 1, 2, 3])));
  const dependent = element(
    '1f43b675',
    element('a0', Buffer.concat([element('a1', [129, 0, 0, 0, 1, 2, 3]), element('fb', [255])])),
  );
  const window = new WebMWindow();
  window.push(Buffer.concat([init, key, dependent]));
  assert.deepEqual(
    window.bootstrap()?.map((bytes) => Buffer.from(bytes)),
    [init, Buffer.concat([key, dependent])],
  );
});
