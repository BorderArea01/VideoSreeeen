import test from 'node:test';
import assert from 'node:assert/strict';
import { MovieSound, VoiceActivity } from '../client/audio-mix';

test('人声音量门限忽略低电平噪声，跨字词停顿保持，结束后恢复', () => {
  const gate = new VoiceActivity();
  for (let i = 0; i < 100; i++) assert.equal(gate.update(0.004, 20), false);
  assert.equal(gate.update(0.05, 20), false);
  assert.equal(gate.update(0.05, 20), true);
  for (let i = 0; i < 10; i++) assert.equal(gate.update(0, 20), true);
  assert.equal(gate.update(0.01, 20), true);
  for (let i = 0; i < 17; i++) assert.equal(gate.update(0, 20), true);
  assert.equal(gate.update(0, 20), false);
  gate.update(0.05, 40);
  gate.reset();
  assert.equal(gate.active, false);
});

test('视频避让保留最新手动音量，静音不会被恢复覆盖；交叠渐变可取消', () => {
  const saved = new Map<string, string>();
  let now = 0,
    serial = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const previous = [
    'localStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'performance',
  ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperties(globalThis, {
    localStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => saved.set(key, value),
      },
    },
    performance: { configurable: true, value: { now: () => now } },
    requestAnimationFrame: {
      configurable: true,
      value: (fn: FrameRequestCallback) => {
        frames.set(++serial, fn);
        return serial;
      },
    },
    cancelAnimationFrame: { configurable: true, value: (id: number) => frames.delete(id) },
  });
  const tick = (ms: number) => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(now));
  };
  try {
    let output = { gain: 1, muted: false };
    const sound = new MovieSound((gain, muted) => {
      output = { gain, muted };
    });
    sound.setLevel(0.8);
    sound.voice(true);
    tick(100);
    assert.equal(output.gain, 0.2);
    sound.setLevel(0.4);
    assert.equal(output.gain, 0.1);
    sound.toggleMute();
    sound.voice(false);
    tick(600);
    assert.equal(output.gain, 0.4);
    assert.equal(output.muted, true);
    sound.toggleMute();
    assert.equal(output.muted, false);
    sound.voice(true);
    tick(40);
    sound.voice(false);
    tick(50);
    sound.voice(true);
    tick(100);
    assert.equal(sound.effective, 0.1);
    assert.equal(frames.size, 0);
    sound.setLevel(0);
    sound.toggleMute();
    assert.equal(sound.level, 0.4);
    sound.setLevel(NaN);
    assert.equal(sound.level, 0.4);
    assert.equal(new MovieSound(() => {}).level, 0.4);
    sound.voice(false);
    sound.settle();
    assert.equal(sound.effective, 0.4, '后台不依赖暂停的动画帧恢复音量');
    assert.equal(frames.size, 0);
  } finally {
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});
