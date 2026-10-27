import type { MediaInput } from '../shared/protocol';
import { preparePublicVideo } from './public-video';

// Published by the site's own browser client. This is its public application
// identifier, not a user session, secret key, or our room credential.
const XIFAN_PUBLIC_KEY = 'sb_publishable_OBIVAWACIX6lPXrO98_z24_HcsmalkA';
const XIFAN_ENDPOINT = 'https://api.xifanacg.com/functions/v1/issue-web-playback';
// Source codes and IDs observed in the original site's public player.
const XIFAN_SOURCES = new Map<string, { id: number; origins: string[] }>([
  ['xfy2', { id: 5, origins: ['https://play.xfvod.pro', 'https://play.xfvod.pro:8088'] }],
  ['AL', { id: 1, origins: ['https://play.xfvod.pro', 'https://play.xfvod.pro:8088'] }],
  ['xfxf1', { id: 4, origins: ['https://apn.moedot.net'] }],
]);

export async function resolveXifanPage(
  media: MediaInput,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MediaInput> {
  const page = new URL(media.url);
  const match = /^\/anime\/([1-9]\d{0,8})\/play\/([1-9]\d{0,8})\/?$/.exec(page.pathname);
  const sourceCode = page.searchParams.get('source') ?? '';
  const source = XIFAN_SOURCES.get(sourceCode);
  if (
    page.origin !== 'https://next.xifanacg.com' ||
    page.username ||
    page.password ||
    !match ||
    !source ||
    page.searchParams.getAll('source').length !== 1
  )
    throw new Error(
      '当前支持稀饭 xfy2 / AL / xfxf1 线路；此链接的线路暂未适配，可使用客户端或共享画面',
    );
  const response = await fetcher(XIFAN_ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { apikey: XIFAN_PUBLIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'fallback',
      episode_id: Number(match[2]),
      source_id: source.id,
    }),
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
        (item: any) => item?.source_id === source.id && item.source_code === sourceCode,
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
    !source.origins.includes(video.origin) ||
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
  if (!media.source || !['file', 'dash'].includes(media.source.kind)) return;
  await preparePublicVideo(media.source.video, signal);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const audio = media.source.audio ? document.createElement('audio') : null;
  if (audio) {
    audio.muted = true;
    audio.preload = 'auto';
  }
  const cleanup = new AbortController();
  const loading = AbortSignal.any([signal, cleanup.signal]);
  try {
    const load = (element: HTMLMediaElement, src: string) =>
      new Promise<void>((resolve, reject) => {
        const stop = () => done(loading.reason);
        loading.addEventListener('abort', stop, { once: true });
        const done = (error?: Error) => {
          loading.removeEventListener('abort', stop);
          element.onloadeddata = element.onerror = null;
          error ? reject(error) : resolve();
        };
        element.onloadeddata = () =>
          done(
            element === video && !video.videoWidth
              ? new Error('视频未解码出画面，当前视频未替换')
              : media.duration &&
                  Number.isFinite(element.duration) &&
                  Math.abs(element.duration - media.duration) > 2
                ? new Error('音视频实际时长与原影片不符，当前视频未替换')
                : undefined,
          );
        element.onerror = () =>
          done(new Error('已识别视频地址，但当前浏览器加载失败；当前视频未替换，可使用共享画面'));
        if (loading.aborted) {
          done(loading.reason);
          return;
        }
        element.src = src;
        element.load();
      });
    await Promise.all([
      load(video, media.source.video),
      ...(audio ? [load(audio, media.source.audio!)] : []),
    ]);
  } finally {
    cleanup.abort(new DOMException('首帧检查已结束', 'AbortError'));
    for (const element of [video, audio])
      if (element) {
        element.onloadeddata = null;
        element.onerror = null;
        element.removeAttribute('src');
        element.load();
      }
  }
}
