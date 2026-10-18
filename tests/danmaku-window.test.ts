import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

test('Windows 弹幕窗口加载期间关闭，迟到的旧评论不能重新出现', async () => {
  let ready!: () => void;
  const loaded = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const scripts: string[] = [];
  class Window {
    webContents = {
      executeJavaScript: async (code: string) => {
        scripts.push(code);
      },
      setWindowOpenHandler() {},
      on() {},
    };
    setIgnoreMouseEvents() {}
    setBounds() {}
    showInactive() {}
    hide() {}
    isDestroyed() {
      return false;
    }
    loadFile() {
      return loaded;
    }
  }
  const module = { exports: undefined as any };
  runInNewContext(readFileSync('desktop/danmaku.cjs', 'utf8'), {
    module,
    __dirname: path.resolve('desktop'),
    require: (name: string) => (name === 'electron' ? { BrowserWindow: Window } : path),
  });
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 450 }),
  });
  const overlay = new module.exports(owner);
  overlay.update({ x: 0, y: 0, width: 800, height: 450, hidden: false });
  const first = overlay.push({ enabled: true, messages: [{ text: 'old' }] });
  overlay.clear();
  ready();
  await first;
  assert.equal(
    scripts.some((code) => code.includes('.push(')),
    false,
  );
  await overlay.push({ enabled: true, messages: [{ text: 'fresh' }] });
  assert.ok(scripts.some((code) => code.includes('fresh')));
});
