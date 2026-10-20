import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../client/playback-clock';

test('非对称 4 秒心跳延迟不再令同一播放版本前后跳 2 秒', () => {
  const clock = new PlaybackClock();
  clock.adopt('room:media:1:2', 40, 100);
  assert.equal(clock.calibrate('room:media:1:2', 1050, 100, 1100), true);
  const before = clock.elapsed(10000);
  // Reply waited four seconds; RTT midpoint used to move the epoch by 2s.
  assert.equal(clock.calibrate('room:media:1:2', 6000, 4000, 10000), true);
  assert.equal(clock.elapsed(10000), before);
  // The opposite asymmetry can only tighten the existing small uncertainty.
  const second = clock.elapsed(15000);
  assert.equal(clock.calibrate('room:media:1:2', 15000, 4000, 15000), true);
  assert.ok(Math.abs(clock.elapsed(15000) - second) <= 100);
});

test('同版本聊天快照不重置时钟，手动拖动新版本仍立即采用', () => {
  const clock = new PlaybackClock();
  clock.adopt('room:media:1:2', 0, 1000);
  clock.calibrate('room:media:1:2', 1050, 100, 2100);
  const before = clock.elapsed(10000);
  clock.adopt('room:media:1:2', 6000, 10000);
  assert.equal(clock.elapsed(10000), before);
  clock.adopt('room:media:1:3', 0, 11000);
  assert.equal(clock.elapsed(11000), 50);
  assert.equal(clock.calibrate('room:media:1:2', 20000, 20, 20000), false);
  assert.equal(clock.elapsed(11000), 50);
});

test('矛盾、无效或旧代次样本不能污染时钟，断线重连可重建', () => {
  const clock = new PlaybackClock();
  clock.adopt('a', 0, 0);
  clock.calibrate('a', 1050, 100, 1100);
  const before = clock.elapsed(5000);
  for (const [key, age, rtt] of [
    ['old', 100, 50],
    ['a', NaN, 20],
    ['a', 100, -1],
    ['a', 0, 10],
  ] as const)
    assert.equal(clock.calibrate(key, age, rtt, 5000), false);
  assert.equal(clock.elapsed(5000), before);
  clock.reset();
  assert.equal(clock.elapsed(5000), before);
  clock.adopt('new', 50, 6000);
  assert.equal(clock.elapsed(6000), 50);
});
