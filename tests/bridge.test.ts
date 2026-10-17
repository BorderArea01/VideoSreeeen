import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
test('原站桥接：持续同步不吞掉新的手动操作，远端跟随不产生回声', () => {
  let now = 5000;
  const listeners = new Map<string, () => void>(),
    gestures = new Map<string, () => void>();
  const video = {
    duration: 120,
    currentTime: 10,
    paused: true,
    playbackRate: 1,
    seeking: false,
    clientWidth: 640,
    clientHeight: 360,
    currentSrc: 'https://example.com/movie.mp4',
    addEventListener: (key: string, fn: () => void) => listeners.set(key, fn),
    play() {
      this.paused = false;
      listeners.get('play')?.();
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      listeners.get('pause')?.();
    },
  };
  const win: any = {};
  runInNewContext(readFileSync(new URL('../shared/page-bridge.js', import.meta.url), 'utf8'), {
    window: win,
    document: {
      querySelectorAll: (query: string) => (query === 'video' ? [video] : []),
      addEventListener: (key: string, fn: () => void) => gestures.set(key, fn),
      title: 'fixture',
    },
    location: { href: 'https://example.com/' },
    performance: { now: () => now },
    WeakSet,
    Number,
    Math,
    atob,
  });
  assert.equal(win.__VS.sample().seq, 0);
  win.__VS.apply({ position: 10, paused: false, rate: 1 });
  assert.equal(video.paused, false);
  assert.equal(win.__VS.sample().seq, 0);
  now += 20;
  gestures.get('pointerdown')!();
  video.pause();
  assert.equal(win.__VS.sample().action, 'pause');
  assert.equal(win.__VS.sample().seq, 1);
  win.__VS.apply({ position: 10, paused: false, rate: 1 });
  assert.equal(video.paused, true, '新手动操作上报前不能被轮询覆盖');
  now += 2000;
  win.__VS.apply({ position: 10, paused: false, rate: 1 });
  assert.equal(video.paused, false);
  assert.equal(win.__VS.sample().seq, 1);
});
