let preparing: Promise<void> | undefined;
let checkedForUpdate = false;

/** Avoid Chromium's conditional partial-cache resume on this redirecting CDN.
 * The service worker forwards the original opaque media response without reading
 * it. It neither proxies through our server nor stores a copy of the movie. */
export async function preparePublicVideo(url: string, signal?: AbortSignal) {
  if (new URL(url, location.href).origin !== 'https://apn.moedot.net') return;
  signal?.throwIfAborted();
  const failure = () => new Error('这条线路的视频连接未能就绪，请刷新页面重试或使用原站');
  if (!window.isSecureContext || !('serviceWorker' in navigator)) throw failure();
  const workers = navigator.serviceWorker;
  const script = new URL('/public-video-sw.js', location.href).href;
  if (workers.controller?.scriptURL === script) {
    if (!checkedForUpdate) {
      checkedForUpdate = true;
      void workers.register(script, { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
    return;
  }
  if (!preparing) {
    preparing = new Promise<void>((resolve, reject) => {
      const dispose = () => {
        clearTimeout(timeout);
        workers.removeEventListener('controllerchange', changed);
      };
      const changed = () => {
        if (workers.controller?.scriptURL !== script) return;
        dispose();
        resolve();
      };
      const timeout = setTimeout(() => {
        dispose();
        reject(failure());
      }, 8000);
      workers.addEventListener('controllerchange', changed);
      void workers.register(script, { scope: '/', updateViaCache: 'none' }).then(changed, () => {
        dispose();
        reject(failure());
      });
    }).finally(() => {
      preparing = undefined;
    });
  }
  let aborted: (() => void) | undefined;
  try {
    await Promise.race([
      preparing,
      new Promise<never>((_, reject) => {
        aborted = () => reject(signal?.reason);
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
      }),
    ]);
    signal?.throwIfAborted();
  } finally {
    if (aborted) signal?.removeEventListener('abort', aborted);
  }
}
