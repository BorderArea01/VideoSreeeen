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
    readyState: 4,
    buffered: { length: 1, start: () => 0, end: () => 120 },
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
  now += 20;
  gestures.get('pointerdown')!();
  video.currentTime = 33;
  listeners.get('seeked')!();
  now += 2000;
  win.__VS.apply({ position: 10, paused: true, rate: 1 });
  assert.equal(win.__VS.sample().position, 10);
  assert.equal(win.__VS.sample().actionPosition, 33, '采样延迟不能把真实拖动替换成后来的纠偏位置');
  video.paused = false;
  video.currentTime = 33;
  win.__VS.apply({ position: 10, paused: false, rate: 1 });
  assert.equal(video.currentTime, 33, '跟随不能自动回退');
  video.buffered.end = () => 40;
  win.__VS.apply({ position: 80, paused: false, rate: 1 });
  assert.equal(video.currentTime, 33, '不能自动跳进未缓冲区域');
});
test('B站视频源使用原站提供的 HTTPS 常规端口备源和兼容音轨', () => {
  const win: any = {
    __playinfo__: {
      data: {
        dash: {
          video: [
            {
              codecs: 'avc1.64001F',
              height: 480,
              baseUrl: 'https://edge.example:4483/video.m4s',
              backupUrl: ['https://cdn.example/video.m4s'],
            },
          ],
          audio: [
            { codecs: 'opus', bandwidth: 999, baseUrl: 'https://cdn.example/unsupported.m4s' },
            {
              codecs: 'mp4a.40.2',
              bandwidth: 100,
              baseUrl: 'https://edge.example:8082/audio.m4s',
              backupUrl: ['https://cdn.example/audio.m4s'],
            },
          ],
        },
      },
    },
  };
  const video = {
    currentSrc: 'blob:fixture',
    duration: 164,
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    clientWidth: 640,
    clientHeight: 360,
    addEventListener() {},
  };
  runInNewContext(readFileSync(new URL('../shared/page-bridge.js', import.meta.url), 'utf8'), {
    window: win,
    document: {
      querySelectorAll: (q: string) => (q === 'video' ? [video] : []),
      addEventListener() {},
      title: 'fixture',
    },
    location: { href: 'https://www.bilibili.com/video/BV13Aa66LEAW/' },
    performance: { now: () => 5000 },
    WeakSet,
    Number,
    Math,
    URL,
    atob,
  });
  const source = win.__VS.sample().source;
  assert.equal(source.kind, 'dash');
  assert.equal(source.video, 'https://cdn.example/video.m4s');
  assert.equal(source.audio, 'https://cdn.example/audio.m4s');
});

test('新版 B 站在清除旧全局数据后读取正在播放的轨道，不拆坏签名中的逗号', () => {
  const urls = [
    'https://cdn.example/video.m4s?issued=a,b,c',
    'https://cdn.example/audio.m4s?issued=d,e,f',
  ];
  const win: any = { player: { getMediaInfo: () => ({ playUrl: urls.join(',') }) } };
  const video = {
    currentSrc: 'blob:actual-player',
    duration: 164,
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    clientWidth: 640,
    clientHeight: 360,
    addEventListener() {},
  };
  runInNewContext(readFileSync(new URL('../shared/page-bridge.js', import.meta.url), 'utf8'), {
    window: win,
    document: {
      querySelectorAll: (q: string) => (q === 'video' ? [video] : []),
      addEventListener() {},
      title: 'fixture',
    },
    location: { href: 'https://www.bilibili.com/video/BV13Aa66LEAW/' },
    performance: { now: () => 5000 },
    WeakSet,
    Number,
    Math,
    URL,
    atob,
  });
  let source = win.__VS.sample().source;
  assert.equal(source.kind, 'dash');
  assert.equal(source.video, urls[0]);
  assert.equal(source.audio, urls[1]);
  win.player.getMediaInfo = () => ({ playUrl: 'https://user:secret@cdn.example/a.m4s,' + urls[1] });
  assert.equal(win.__VS.sample().source, null);
  win.player.getMediaInfo = () => {
    throw new Error('not initialized');
  };
  assert.equal(win.__VS.sample().available, true);
  assert.equal(win.__VS.sample().source, null);
});
