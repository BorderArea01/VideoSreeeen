const { BrowserWindow, session } = require('electron');

const partition = 'persist:sites';
function isBilibili(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))
    );
  } catch {
    return false;
  }
}

module.exports = function siteAccount(parent, refreshed) {
  let window;
  return function open() {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    const account = new BrowserWindow({
      parent,
      width: 1120,
      height: 760,
      autoHideMenuBar: true,
      title: 'B 站登录 · 登录后关闭此窗口返回观影',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window = account;
    account.webContents.setWindowOpenHandler(({ url }) => {
      if (isBilibili(url)) void account.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    const navigate = (event, url) => {
      if (!isBilibili(url)) event.preventDefault();
    };
    account.webContents.on('will-navigate', navigate);
    account.webContents.on('will-redirect', navigate);
    account.on('closed', () => {
      window = null;
      // The normal site session owns credentials. Never return cookies over IPC.
      void session
        .fromPartition(partition)
        .cookies.flushStore()
        .then(refreshed)
        .catch(() => {});
    });
    void account.loadURL('https://passport.bilibili.com/login').catch(() => {
      if (!account.isDestroyed()) account.setTitle('B 站登录页面加载失败，请关闭后重试');
    });
  };
};
