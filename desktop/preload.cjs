const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set([
  'serverInfo',
  'danmaku',
  'openBrowser',
  'openSite',
  'closeSite',
  'siteBounds',
  'sampleSite',
  'nextEpisode',
  'applySite',
  'cacheStart',
  'cacheClear',
  'cacheIO',
  'cacheLocation',
  'chooseCacheLocation',
  'captureSite',
  'endCapture',
  'update',
]);
contextBridge.exposeInMainWorld('desktop', {
  call(method, payload) {
    if (!allowed.has(method)) return Promise.reject(new Error('Unsupported command'));
    return ipcRenderer.invoke('native', method, payload);
  },
  onEvent(callback) {
    ipcRenderer.on('native-event', (_event, type, data) => callback({ type, data }));
  },
});
