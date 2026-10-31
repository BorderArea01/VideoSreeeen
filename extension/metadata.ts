import { allowedAccountBilibiliMetadata } from '../shared/bilibili';

// View metadata includes the entire UGC collection, even for a single-part
// video. Keep that bounded separately from login and playback responses.
const limits: Record<string, { bytes: number; label: string }> = {
  '/x/web-interface/nav': { bytes: 64 * 1024, label: '登录状态' },
  '/x/web-interface/view': { bytes: 8 * 1024 * 1024, label: '视频信息' },
  '/x/player/playurl': { bytes: 512 * 1024, label: '播放信息' },
};

export async function readBilibiliMetadata(response: Response, url: string, signal: AbortSignal) {
  if (!allowedAccountBilibiliMetadata(url)) throw new Error('B 站接口不在取源范围内');
  const limit = limits[new URL(url).pathname]!;
  if (!response.body) throw new Error('B 站响应为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const tooLarge = () => new Error(`B 站${limit.label}响应超过安全大小限制`);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > limit.bytes) throw tooLarge();
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limit.bytes) throw tooLarge();
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
