import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackHealth } from '../client/playback-health';

function player() {
  let frames = 10;
  const video = {
    currentTime: 5,
    ended: false,
    seeking: false,
    error: null,
    readyState: 4,
    networkState: 1,
    buffered: { length: 1, start: () => 0, end: () => 20 },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }),
  };
  return {
    video: video as unknown as HTMLVideoElement,
    advance: () => {
      frames += 10;
    },
  };
}
test('有缓冲但停止出帧时只请求一次本机恢复，恢复出帧后重新观察', () => {
  const health = new PlaybackHealth(),
    { video, advance } = player();
  assert.equal(health.check(video, 0), false);
  assert.equal(health.check(video, 5999), false);
  assert.equal(health.check(video, 6000), true);
  assert.equal(health.check(video, 13000), false);
  advance();
  assert.equal(health.check(video, 14000), false);
  assert.equal(health.check(video, 20000), true);
  health.reset();
  assert.equal(health.check(video, 30000), false);
});
test('正常网络缓冲、拖动中和视频结束不反复重启加载', () => {
  const health = new PlaybackHealth(),
    { video } = player();
  health.check(video, 0);
  Object.assign(video, { seeking: true });
  assert.equal(health.check(video, 6000), false);
  Object.assign(video, { seeking: false, readyState: 1, networkState: 2, buffered: { length: 0 } });
  assert.equal(health.check(video, 12000), false);
  Object.assign(video, { ended: true, readyState: 4, networkState: 1 });
  assert.equal(health.check(video, 18000), false);
});
