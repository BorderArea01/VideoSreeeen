import test from 'node:test';
import assert from 'node:assert/strict';
import { canSeekPlayback } from '../client/playback-buffer';
import { reconcile } from '../shared/sync';

test('自动纠偏不回退；落后时不跳进未缓冲区域，手动拖动仍允许重新加载', () => {
  assert.equal(reconcile(20, 10, 1, false).kind, 'rate');
  assert.equal(reconcile(20, 10, 1, false, true).kind, 'seek');
  const video = {
    currentTime: 10,
    readyState: 3,
    seeking: false,
    duration: 100,
    playbackRate: 1,
    buffered: { length: 1, start: () => 9, end: () => 13 },
  } as unknown as HTMLVideoElement;
  assert.equal(canSeekPlayback(video, 20, false, false), false);
  assert.equal(canSeekPlayback(video, 12, false, false), true);
  assert.equal(canSeekPlayback(video, 5, false, false), false);
  assert.equal(canSeekPlayback(video, 80, true, false), true);
  Object.assign(video, { seeking: true });
  assert.equal(canSeekPlayback(video, 12, false, false), false);
  Object.assign(video, { seeking: false });
  Object.assign(video, { readyState: 2 });
  assert.equal(canSeekPlayback(video, 12, false, false), false);
});
