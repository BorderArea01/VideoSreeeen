import type { MediaInput } from '../shared/protocol';

// Published by the site's own browser client. This is its public application
// identifier, not a user session, secret key, or our room credential.
const XIFAN_PUBLIC_KEY = 'sb_publishable_OBIVAWACIX6lPXrO98_z24_HcsmalkA';
const XIFAN_ENDPOINT = 'https://api.xifanacg.com/functions/v1/issue-web-playback';
// Source codes and IDs observed in the original site's public player.
const XIFAN_SOURCES = new Map([
  ['xfy2', 5],
  ['AL', 1],
]);

export async function resolveXifanPage(
  media: MediaInput,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MediaInput> {
  const page = new URL(media.url);
  const match = /^\/anime\/([1-9]\d{0,8})\/play\/([1-9]\d{0,8})\/?$/.exec(page.pathname);
  const sourceCode = page.searchParams.get('source') ?? '';
  const sourceId = XIFAN_SOURCES.get(sourceCode);
  if (
    page.origin !== 'https://next.xifanacg.com' ||
    page.username ||
    page.password ||
    !match ||
    sourceId === undefined ||
    page.searchParams.getAll('source').length !== 1
  )
    throw new Error(
      '当前支持稀饭旧番主线 xfy2、新番主线 AL；此链接的线路暂未适配，可使用客户端或共享画面',
    );
  const response = await fetcher(XIFAN_ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { apikey: XIFAN_PUBLIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fallback', episode_id: Number(match[2]), source_id: sourceId }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 429
        ? '原站请求频繁，请稍后再试'
        : `稀饭播放接口读取失败（HTTP ${response.status}），请使用原站或共享画面`,
    );
  }
  if (!response.body) throw new Error('稀饭播放接口没有返回内容');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new Error('稀饭播放接口响应超过大小限制');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result.ok)
    throw new Error(
      result.error === 'rate_limited'
        ? '原站请求频繁，请稍后再试'
        : '原站没有向当前访客提供视频源，请使用原站或共享画面',
    );
  const candidate = Array.isArray(result.candidates)
    ? result.candidates.find(
        (item: any) => item?.source_id === sourceId && item.source_code === sourceCode,
      )
    : undefined;
  if (
    result.anime_id !== Number(match[1]) ||
    result.episode_id !== Number(match[2]) ||
    !candidate ||
    typeof candidate.url !== 'string' ||
    candidate.url.length > 8192 ||
    !Number.isFinite(result.expires_at) ||
    result.expires_at * 1000 <= Date.now()
  )
    throw new Error('原站返回的剧集或线路与链接不一致，识别结果未使用');
  const video = new URL(candidate.url);
  if (
    video.protocol !== 'https:' ||
    video.hostname !== 'play.xfvod.pro' ||
    !['', '8088'].includes(video.port) ||
    video.username ||
    video.password ||
    !/\.(mp4|webm)$/i.test(video.pathname)
  )
    throw new Error('这条稀饭线路的视频格式或来源暂不支持');
  return {
    url: page.href,
    title: '稀饭动漫',
    provider: 'xifan',
    source: { kind: 'file', video: video.href },
  };
}

/** Verify actual first-frame loading on this network before replacing a movie. */
export async function checkResolvedVideo(media: MediaInput, signal: AbortSignal) {
  if (media.source?.kind !== 'file' || media.source.audio) return;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      const done = (error?: Error) => {
        signal.removeEventListener('abort', stop);
        error ? reject(error) : resolve();
      };
      video.onloadeddata = () => done();
      video.onerror = () =>
        done(new Error('已识别视频地址，但当前浏览器加载失败；当前视频未替换，可使用共享画面'));
      if (signal.aborted) {
        done(signal.reason);
        return;
      }
      video.src = media.source!.video;
      video.load();
    });
  } finally {
    video.onloadeddata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
  }
}
