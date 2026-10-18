const { BrowserWindow } = require('electron');
const path = require('node:path');

// An owned, click-through local window. Chat never enters a third-party DOM or
// the original-tab capture stream.
module.exports = class Danmaku {
  constructor(owner) {
    this.owner = owner;
    this.bounds = { x: 0, y: 0, width: 0, height: 0, hidden: true };
    this.enabled = true;
    this.generation = 0;
    for (const event of ['move', 'resize', 'focus', 'show', 'restore'])
      owner.on(event, () => this.layout());
    for (const event of ['blur', 'hide', 'minimize']) owner.on(event, () => this.hide());
    owner.on('enter-html-full-screen', () => {
      this.fullscreen = true;
      this.layout();
    });
    owner.on('leave-html-full-screen', () => {
      this.fullscreen = false;
      this.layout();
    });
    owner.on('closed', () => {
      if (this.window && !this.window.isDestroyed()) this.window.destroy();
    });
  }
  hide() {
    this.generation++;
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      void this.window.webContents
        .executeJavaScript('window.__VS_Danmaku?.clear()')
        .catch(() => {});
    }
  }
  update(bounds) {
    this.bounds = { ...bounds };
    this.layout();
  }
  visible() {
    return (
      this.enabled &&
      !this.bounds.hidden &&
      this.bounds.width > 0 &&
      this.bounds.height > 0 &&
      !this.owner.isDestroyed() &&
      this.owner.isVisible() &&
      !this.owner.isMinimized() &&
      this.owner.isFocused()
    );
  }
  layout() {
    if (!this.window || this.window.isDestroyed()) return;
    if (!this.visible()) {
      this.hide();
      return;
    }
    const content = this.owner.getContentBounds(),
      b = this.fullscreen
        ? { x: 0, y: 0, width: content.width, height: content.height }
        : this.bounds;
    this.window.setBounds({
      x: content.x + b.x,
      y: content.y + b.y,
      width: b.width,
      height: b.height,
    });
    this.window.showInactive();
  }
  async push(data) {
    this.enabled = !!data.enabled;
    if (data.clear) this.hide();
    if (!this.visible()) {
      this.hide();
      return;
    }
    const messages = Array.isArray(data.messages)
      ? data.messages
          .slice(-20)
          .filter((c) => typeof c?.text === 'string')
          .map((c) => ({ text: c.text.slice(0, 2000) }))
      : [];
    if (!messages.length) return;
    const generation = this.generation;
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        parent: this.owner,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      this.window.setIgnoreMouseEvents(true, { forward: true });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.window.webContents.on('will-navigate', (event) => event.preventDefault());
      this.ready = this.window.loadFile(path.join(__dirname, '../shared/danmaku.html'));
    }
    await this.ready;
    if (!this.visible() || generation !== this.generation) return;
    this.layout();
    await this.window.webContents.executeJavaScript(
      'window.__VS_Danmaku.push(' + JSON.stringify(messages) + ')',
    );
  }
  clear() {
    this.hide();
  }
};
