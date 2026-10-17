const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

module.exports = function updates(notify) {
  let state = {
    state: 'idle',
    version: app.getVersion(),
    installed: app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE,
  };
  const set = (value) => {
    state = { ...state, ...value };
    notify('update', state);
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: '' }));
  autoUpdater.on('update-available', (info) => set({ state: 'available', next: info.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'current' }));
  autoUpdater.on('download-progress', (progress) =>
    set({ state: 'downloading', progress: progress.percent }),
  );
  autoUpdater.on('update-downloaded', () => set({ state: 'ready' }));
  autoUpdater.on('error', (error) => set({ state: 'error', message: error.message.slice(0, 200) }));
  let checking = null,
    downloading = null;
  return async (action) => {
    if (action === 'status') return state;
    if (!state.installed)
      return {
        ...state,
        state: 'portable',
        message: '请先使用 Windows 安装版，此后可在应用内更新，保留本机设置。',
      };
    if (action === 'check') {
      if (!checking) checking = autoUpdater.checkForUpdates().finally(() => (checking = null));
      await checking;
    } else if (action === 'download') {
      if (!['available', 'downloading'].includes(state.state)) throw new Error('请先检查更新');
      if (!downloading)
        downloading = autoUpdater.downloadUpdate().finally(() => (downloading = null));
      await downloading;
    } else if (action === 'install') {
      if (state.state !== 'ready') throw new Error('更新尚未下载完成');
      autoUpdater.quitAndInstall(true, true);
    } else throw new Error('未知更新操作');
    return state;
  };
};
