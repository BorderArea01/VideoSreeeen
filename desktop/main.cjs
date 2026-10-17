const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { DiskCache } = require('./cache.cjs');
const { BlockCache } = require('./blocks.cjs');
let blocks;
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vs-cache',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  },
]);
let win,
  site = null,
  cache,
  bridge,
  observed = [],
  sample = { available: false },
  localServer = null,
  serverInfo = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
const bounds = { x: 0, y: 0, width: 0, height: 0 };
const validUrl = (value) => {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw new Error('地址无效');
  return u.href;
};
function event(type, data) {
  if (win && !win.isDestroyed()) win.webContents.send('native-event', type, data);
}
async function closeSite() {
  if (site) {
    const old = site;
    site = null;
    win.contentView.removeChildView(old);
    old.webContents.close();
  }
  observed = [];
  sample = { available: false };
}
function frames() {
  return site?.webContents.mainFrame.framesInSubtree ?? [];
}
async function sampleSite() {
  if (!site) return sample;
  const list = await Promise.all(
    frames().map(async (frame) => {
      try {
        return await Promise.race([
          frame.executeJavaScript(bridge + ';window.__VS.sample()', true),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
      } catch {
        return null;
      }
    }),
  );
  const candidates = list.filter((s) => s?.available);
  const best = candidates.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
  if (best) {
    sample = best;
    if (!sample.source && observed.length) {
      const item = observed.findLast((item) => /\.(m3u8|mp4|webm)(\?|$)/i.test(item.url));
      if (item)
        sample.source = {
          kind: item.url.includes('.m3u8') ? 'hls' : 'file',
          video: item.url,
          referer: site.webContents.getURL(),
        };
    }
  }
  return sample;
}
async function openSite(url) {
  await closeSite();
  site = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:sites',
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  site.setBackgroundColor('#101014');
  win.contentView.addChildView(site);
  site.setBounds(bounds);
  site.webContents.setWindowOpenHandler(({ url: next }) => {
    try {
      void site.webContents.loadURL(validUrl(next));
    } catch {}
    return { action: 'deny' };
  });
  site.webContents.on('will-navigate', (e, next) => {
    try {
      validUrl(next);
    } catch {
      e.preventDefault();
    }
  });
  site.webContents.on('did-fail-load', (_e, code, description, _url, isMain) => {
    if (isMain && code !== -3) event('site-error', { message: '原站加载失败：' + description });
  });
  site.webContents.on('dom-ready', () => {
    void sampleSite();
  });
  const view = site;
  let timer;
  let domReady;
  try {
    await Promise.race([
      new Promise((resolve) => {
        domReady = resolve;
        view.webContents.once('dom-ready', domReady);
      }),
      view.webContents.loadURL(validUrl(url)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (!view.webContents.isDestroyed()) view.webContents.stop();
          reject(new Error('原站加载超过 20 秒，请检查网站网络或稍后重试'));
        }, 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (domReady && !view.webContents.isDestroyed())
      view.webContents.removeListener('dom-ready', domReady);
  }
  return {};
}
app.whenReady().then(async () => {
  if (!process.env.VS_DEV_URL) {
    const { createApp } = await import(
      pathToFileURL(path.join(__dirname, '../dist-server/index.mjs')).href
    );
    localServer = createApp();
    await new Promise((resolve, reject) => {
      localServer.server.once('error', (error) => {
        if (error.code === 'EADDRINUSE') localServer.server.listen(0, '0.0.0.0', resolve);
        else reject(error);
      });
      localServer.server.listen(8787, '0.0.0.0', resolve);
    });
    const port = localServer.server.address().port;
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal);
    const lan =
      addresses.find((a) => /^192\.168\./.test(a.address)) ||
      addresses.find((a) => /^10\./.test(a.address)) ||
      addresses[0];
    serverInfo = {
      local: `http://127.0.0.1:${port}`,
      share: lan ? `http://${lan.address}:${port}` : `http://127.0.0.1:${port}`,
    };
  }
  bridge = fs.readFileSync(path.join(__dirname, '../shared/page-bridge.js'), 'utf8');
  cache = new DiskCache(path.join(app.getPath('userData'), 'cache', 'media'), (data) =>
    event('cache', data),
  );
  await cache.init();
  blocks = new BlockCache(cache);
  protocol.handle('vs-cache', (req) => cache.response(req));
  const siteSession = session.fromPartition('persist:sites');
  siteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  siteSession.webRequest.onHeadersReceived((details, callback) => {
    const type =
      details.responseHeaders?.['content-type']?.[0] ||
      details.responseHeaders?.['Content-Type']?.[0] ||
      '';
    if (
      (/mpegurl|video\/mp4/i.test(type) || /\.(m3u8|mp4)(\?|$)/i.test(details.url)) &&
      /^https?:/.test(details.url)
    ) {
      observed.push({ url: details.url });
      observed = observed.slice(-30);
    }
    callback({ responseHeaders: details.responseHeaders });
  });
  win = new BrowserWindow({
    width: 1360,
    height: 990,
    minWidth: 760,
    minHeight: 650,
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    title: 'VideoSreeeen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  ipcMain.handle('native', async (e, method, data = {}) => {
    if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame)
      throw new Error('不允许的调用');
    switch (method) {
      case 'serverInfo':
        return serverInfo;
      case 'openBrowser':
        return shell.openExternal(validUrl(data.url));
      case 'openSite':
        return openSite(data.url);
      case 'closeSite':
        return closeSite();
      case 'sampleSite':
        return sampleSite();
      case 'siteBounds':
        if (site) {
          for (const key of ['x', 'y', 'width', 'height'])
            bounds[key] = Math.max(0, Math.min(10000, Math.round(Number(data[key]) || 0)));
          site.setBounds(data.hidden ? { x: 0, y: 0, width: 0, height: 0 } : bounds);
        }
        return {};
      case 'applySite': {
        const state = {
          position: Math.max(0, Number(data.position) || 0),
          rate: Math.min(4, Math.max(0.25, Number(data.rate) || 1)),
          paused: !!data.paused,
          seek: !!data.seek,
        };
        await Promise.all(
          frames().map(async (frame) => {
            try {
              await frame.executeJavaScript(
                bridge + ';window.__VS.apply(' + JSON.stringify(state) + ')',
              );
            } catch {}
          }),
        );
        return {};
      }
      case 'cacheStart':
        return cache.start(data);
      case 'cacheClear':
        blocks.cancel(data.jobId);
        return cache.clear(data.jobId);
      case 'cacheIO':
        return blocks.call(data);
      default:
        throw new Error('未知命令');
    }
  });
  if (process.env.VS_DEV_URL) await win.loadURL(process.env.VS_DEV_URL);
  else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  if (process.env.VS_SMOKE_OUTPUT) {
    setTimeout(async () => {
      try {
        await win.webContents
          .capturePage()
          .then((image) => fs.writeFileSync(process.env.VS_SMOKE_OUTPUT, image.toPNG()));
      } finally {
        app.quit();
      }
    }, 2500);
  }
});
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => {
  void (async () => {
    try {
      await cache?.stop();
      await localServer?.close();
    } finally {
      app.quit();
    }
  })();
});
