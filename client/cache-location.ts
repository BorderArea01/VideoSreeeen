type Directory = FileSystemDirectoryHandle & {
  queryPermission(p: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(p: { mode: 'readwrite' }): Promise<PermissionState>;
};
let selected: Directory | undefined;
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('videosreeeen-settings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法保存缓存目录设置'));
  });
export const canChooseCacheDirectory = () =>
  typeof (window as any).showDirectoryPicker === 'function';
export async function loadCacheDirectory() {
  const db = await database();
  try {
    selected = await new Promise<Directory | undefined>((resolve, reject) => {
      const request = db
        .transaction('preferences')
        .objectStore('preferences')
        .get('cache-directory');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
  return selected;
}
export function cacheDirectory() {
  return selected;
}
export async function chooseCacheDirectory() {
  const handle = (await (window as any).showDirectoryPicker({
    id: 'videosreeeen-cache',
    mode: 'readwrite',
    ...(selected ? { startIn: selected } : {}),
  })) as Directory;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('preferences', 'readwrite');
      transaction.objectStore('preferences').put(handle, 'cache-directory');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    selected = handle;
  } finally {
    db.close();
  }
  return handle;
}
export async function authorizeCacheDirectory() {
  if (
    selected &&
    (await selected.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
    (await selected.requestPermission({ mode: 'readwrite' })) !== 'granted'
  )
    throw new Error('请重新选择缓存目录并允许写入；不会改用系统盘。');
}
