import type { MediaInput } from '../shared/protocol';

export function supportsBilibiliExtension(version: unknown) {
  if (typeof version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return major! > 0 || minor! > 1 || (minor === 1 && patch! >= 2);
}
export class BilibiliExtensionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class BilibiliExtension {
  private pending = new Map<string, { done: (value: any) => void; fail: (error: Error) => void }>();
  constructor() {
    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== 'videosreeeen-source-response'
      )
        return;
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      const result = event.data.result;
      if (result?.error) pending.fail(new BilibiliExtensionError(result.code, result.error));
      else pending.done(result);
    });
  }
  async call(action: 'ping' | 'resolve' | 'next', url?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    return new Promise<any>((done, fail) => {
      const end = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      const abort = () => {
        end();
        window.postMessage(
          { channel: 'videosreeeen-source-request', id, action: 'cancel' },
          location.origin,
        );
        fail(new DOMException('已取消取源', 'AbortError'));
      };
      const timer = window.setTimeout(
        () => {
          end();
          window.postMessage(
            { channel: 'videosreeeen-source-request', id, action: 'cancel' },
            location.origin,
          );
          fail(
            new BilibiliExtensionError(
              action === 'ping' ? 'MISSING' : 'TIMEOUT',
              action === 'ping'
                ? '请在电脑浏览器安装视频源助手，安装后刷新本页。观众无需安装。'
                : 'B 站取源超时，请检查扩展后重试',
            ),
          );
        },
        action === 'ping' ? 900 : 14000,
      );
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        done: (v) => {
          end();
          done(v);
        },
        fail: (e) => {
          end();
          fail(e);
        },
      });
      window.postMessage(
        { channel: 'videosreeeen-source-request', id, action, url },
        location.origin,
      );
    });
  }
  async resolve(media: MediaInput, signal: AbortSignal): Promise<MediaInput> {
    const helper = await this.call('ping', undefined, signal);
    if (!supportsBilibiliExtension(helper?.version))
      throw new BilibiliExtensionError(
        'UPDATE_REQUIRED',
        '请更新视频源助手至 0.1.2 或更新版本，在扩展管理页重新加载后刷新放映厅。观众无需安装。',
      );
    const result = (await this.call('resolve', media.url, signal)).media;
    if (
      !result?.source?.bilibiliDirect ||
      result.provider !== 'bilibili' ||
      result.url !== media.url
    )
      throw new Error('B 站扩展未返回当前视频的高清源');
    return result;
  }
}
