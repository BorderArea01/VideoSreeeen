import { BLOCK_SIZE } from '../shared/cache-plan';
import type { FileInfo } from './peers';

/** Local disk reads only. No remote URL, account or room credential enters this bridge. */
export async function cacheStream(
  jobId: string,
  files: FileInfo[],
  read: (name: string, offset: number, signal: AbortSignal) => Promise<Uint8Array>,
  signal: AbortSignal,
) {
  const workers = navigator.serviceWorker;
  if (!window.isSecureContext || !workers) throw new Error('分段缓存需要 HTTPS 和新版浏览器');
  const receive = (event: MessageEvent) => {
    const port = event.ports[0],
      p = event.data;
    if (
      !port ||
      p?.type !== 'vs-disk-read' ||
      p.job !== jobId ||
      event.source !== workers.controller
    )
      return;
    const file = files.find((f) => f.name === p.name);
    if (!file) {
      port.postMessage({ error: true });
      port.close();
      return;
    }
    port.postMessage({ size: file.size, block: BLOCK_SIZE });
    const request = new AbortController();
    const stop = () => {
      request.abort();
      signal.removeEventListener('abort', abort);
      port.close();
    };
    const abort = () => {
      port.postMessage({ error: true });
      stop();
    };
    let busy = false;
    port.onmessage = ({ data }) => {
      if (data?.cancel) {
        stop();
        return;
      }
      if (
        busy ||
        signal.aborted ||
        !Number.isSafeInteger(data?.offset) ||
        data.offset < 0 ||
        data.offset % BLOCK_SIZE ||
        data.offset >= file.size
      ) {
        port.postMessage({ error: true });
        stop();
        return;
      }
      busy = true;
      void read(file.name, data.offset, request.signal)
        .then((bytes) => {
          if (signal.aborted || request.signal.aborted)
            throw signal.reason ?? request.signal.reason;
          const buffer = bytes.slice().buffer;
          port.postMessage({ bytes: buffer }, [buffer]);
        })
        .catch(() => {
          port.postMessage({ error: true });
          stop();
        })
        .finally(() => {
          busy = false;
        });
    };
    signal.addEventListener('abort', abort, { once: true });
  };
  workers.addEventListener('message', receive);
  signal.addEventListener('abort', () => workers.removeEventListener('message', receive), {
    once: true,
  });
  await workers.register('/public-video-sw.js', { scope: '/', updateViaCache: 'none' });
  await workers.ready;
  if (!workers.controller)
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        if (workers.controller) {
          clearTimeout(timer);
          workers.removeEventListener('controllerchange', ready);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        workers.removeEventListener('controllerchange', ready);
        reject(new Error('本机缓存播放通道未就绪，请刷新重试'));
      }, 8000);
      workers.addEventListener('controllerchange', ready);
      ready();
    });
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('缓存播放组件需要刷新页面后更新'));
    }, 8000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      data.version === 1 ? resolve() : reject(new Error('缓存播放组件版本不兼容'));
    };
    workers.controller!.postMessage({ type: 'vs-disk-probe' }, [channel.port2]);
  });
  return (name: string) => new URL(`/__vs_disk__/${jobId}/${name}`, location.origin).href;
}
