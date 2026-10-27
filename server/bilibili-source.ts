import type { MediaInput } from '../shared/protocol';
import { nextEpisode } from '../shared/episodes';

// Public UGC HTML5 playback only: no account cookies, app credentials, trial
// flags, video relay or modification of the CDN's signed URLs.
export function bilibiliPage(raw: string) {
  const page = new URL(raw);
  if (
    page.origin !== 'https://www.bilibili.com' ||
    page.username ||
    page.password ||
    !/^\/video\/BV[A-Za-z0-9]{10}\/$/.test(page.pathname) ||
    (page.search && !/^\?p=[1-9]\d{0,4}$/.test(page.search))
  )
    throw new Error('仅支持 B 站公开 BV 视频页面');
  return page;
}

export function allowedBilibiliMetadata(url: URL) {
  if (url.origin !== 'https://api.bilibili.com' || url.username || url.password) return false;
  return (
    (url.pathname === '/x/web-interface/view' && /^\?bvid=BV[A-Za-z0-9]{10}$/.test(url.search)) ||
    (url.pathname === '/x/player/playurl' &&
      /^\?bvid=BV[A-Za-z0-9]{10}&cid=[1-9]\d{0,15}&qn=32&platform=html5$/.test(url.search))
  );
}

/** The only CDN shape the guest HTML5 path is allowed to publish to a room. */
export function bilibiliVideoHref(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('B 站播放地址无效');
  let video: URL;
  try {
    video = new URL(raw);
  } catch {
    throw new Error('B 站播放地址无效');
  }
  const deadline = Number(video.searchParams.get('deadline'));
  if (
    video.protocol !== 'https:' ||
    video.port ||
    video.username ||
    video.password ||
    !/^[a-z0-9-]+\.bilivideo\.com$/.test(video.hostname) ||
    !/\.mp4$/i.test(video.pathname) ||
    !Number.isFinite(deadline) ||
    deadline * 1000 <= Date.now() + 30000
  )
    throw new Error('B 站公开视频地址已过期或来源暂不支持，请重试');
  return video.href;
}

async function publicInfo(raw: string, read: (url: string) => Promise<string>) {
  const page = bilibiliPage(raw);
  const bvid = page.pathname.split('/')[2]!;
  const part = Number(page.searchParams.get('p') || 1);
  const info = JSON.parse(await read(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
  const data = info.data;
  if (info.code !== 0 || data?.bvid !== bvid || data?.rights?.pay === 1)
    throw new Error('B 站未向游客提供此视频；请使用客户端登录或选择共享画面');
  return { page, bvid, part, data };
}

export async function nextBilibiliPage(raw: string, read: (url: string) => Promise<string>) {
  const { page, part, data } = await publicInfo(raw, read);
  const next = Array.isArray(data.pages) ? data.pages.find((p: any) => p.page === part + 1) : null;
  return next
    ? nextEpisode(page.href, `${page.pathname}?p=${next.page}`, String(next.part || '下一分 P'))
    : null;
}

export async function resolveBilibiliPage(
  raw: string,
  read: (url: string) => Promise<string>,
): Promise<MediaInput> {
  const { page, bvid, part, data } = await publicInfo(raw, read);
  const selected = Array.isArray(data.pages) ? data.pages.find((p: any) => p.page === part) : null;
  if (
    !selected ||
    !Number.isSafeInteger(selected.cid) ||
    selected.cid <= 0 ||
    !Number.isFinite(selected.duration) ||
    selected.duration <= 0
  )
    throw new Error('B 站没有返回此分 P 的公开播放信息');
  const response = JSON.parse(
    await read(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${selected.cid}&qn=32&platform=html5`,
    ),
  );
  const stream = response.data;
  if (
    response.code !== 0 ||
    !stream ||
    stream.is_preview ||
    stream.is_drm ||
    stream.format !== 'mp4' ||
    ![16, 32].includes(stream.quality) ||
    !Array.isArray(stream.durl) ||
    stream.durl.length !== 1 ||
    !Number.isFinite(stream.timelength) ||
    Math.abs(stream.timelength / 1000 - selected.duration) > 2
  )
    throw new Error('B 站没有返回可供游客完整观看的 MP4；可使用客户端或共享画面');
  const address = stream.durl[0]?.url;
  const video = bilibiliVideoHref(address);
  return {
    url: page.href,
    provider: 'bilibili',
    title: `${String(data.title || bvid)}${data.pages.length > 1 ? ` · P${part}` : ''}`.slice(
      0,
      200,
    ),
    source: { kind: 'file', video, bilibiliHtml5: true },
    duration: selected.duration,
  };
}
