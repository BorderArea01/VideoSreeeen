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
  if (typeof address !== 'string' || address.length > 8192) throw new Error('B 站播放地址无效');
  const video = new URL(address);
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
  return {
    url: page.href,
    provider: 'bilibili',
    title: `${String(data.title || bvid)}${data.pages.length > 1 ? ` · P${part}` : ''}`.slice(
      0,
      200,
    ),
    source: { kind: 'file', video: video.href, bilibiliHtml5: true },
    duration: selected.duration,
  };
}

// Only the native provider calls this with its isolated original-site session.
// No cookie values enter this resolver, its result, or the room protocol.
export function allowedAccountBilibiliMetadata(raw: string) {
  const url = new URL(raw);
  return (
    allowedBilibiliMetadata(url) ||
    (url.origin === 'https://api.bilibili.com' &&
      !url.username &&
      !url.password &&
      ((url.pathname === '/x/web-interface/nav' && !url.search) ||
        (url.pathname === '/x/player/playurl' &&
          /^\?bvid=BV[A-Za-z0-9]{10}&cid=[1-9]\d{0,15}&qn=80&fnval=16$/.test(url.search))))
  );
}

function accountTrack(track: any, type: 'video' | 'audio') {
  if (track?.is_drm || track?.drm_tech_type || track?.drm) return null;
  const addresses = [
    track?.baseUrl ?? track?.base_url,
    ...(track?.backupUrl ?? track?.backup_url ?? []),
  ];
  for (const value of addresses) {
    if (typeof value !== 'string' || value.length > 8192) continue;
    try {
      const u = new URL(value),
        deadline = Number(u.searchParams.get('deadline'));
      const regular = /^[a-z0-9-]+\.bilivideo\.com$/.test(u.hostname);
      const mcdn = /^[a-z0-9-]+\.mcdn\.bilivideo\.cn$/.test(u.hostname);
      if (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        ((regular && !u.port) || (mcdn && (!u.port || u.port === '4483'))) &&
        /\.(m4s|mp4|m4a)$/i.test(u.pathname) &&
        Number.isFinite(deadline) &&
        deadline * 1000 > Date.now() + 30000 &&
        (type === 'video' ? /^avc1\./.test(track.codecs) : /^mp4a\./.test(track.codecs))
      )
        return value;
    } catch {}
  }
  return null;
}

export async function resolveAccountBilibiliPage(
  raw: string,
  read: (url: string) => Promise<string>,
): Promise<MediaInput> {
  bilibiliPage(raw);
  const nav = JSON.parse(await read('https://api.bilibili.com/x/web-interface/nav'));
  if (nav.code !== 0 || nav.data?.isLogin !== true)
    throw Object.assign(new Error('B 站高清取源需要房主在本机登录，观众无需登录'), {
      code: 'BILIBILI_LOGIN_REQUIRED',
    });
  const { page, bvid, part, data } = await publicInfo(raw, read);
  if (data.is_upower_exclusive || data.rights?.is_upower_exclusive)
    throw new Error('B 站此视频的访问权限需要在原站处理');
  const selected = data.pages?.find((p: any) => p.page === part);
  if (
    !Number.isSafeInteger(selected?.cid) ||
    selected.cid <= 0 ||
    !Number.isFinite(selected.duration) ||
    selected.duration <= 0
  )
    throw new Error('B 站没有返回当前分 P 的完整播放信息');
  const body = JSON.parse(
    await read(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${selected.cid}&qn=80&fnval=16`,
    ),
  );
  const stream = body.data;
  if (
    body.code !== 0 ||
    !stream ||
    stream.is_preview ||
    stream.is_drm ||
    (stream.cid !== undefined && String(stream.cid) !== String(selected.cid)) ||
    !Number.isFinite(stream.timelength) ||
    Math.abs(stream.timelength / 1000 - selected.duration) > 2 ||
    !Array.isArray(stream.dash?.video) ||
    !Array.isArray(stream.dash?.audio) ||
    (stream.dash.duration !== undefined && Math.abs(stream.dash.duration - selected.duration) > 2)
  )
    throw new Error('B 站没有向当前账号返回完整的可播放音视频，请在原站检查权限后重试');
  const videos = stream.dash.video
    .filter(
      (v: any) =>
        Number.isInteger(v.height) &&
        v.height >= 720 &&
        v.height <= 1080 &&
        Number.isInteger(v.width) &&
        v.width > 0 &&
        v.width <= 7680,
    )
    .sort((a: any, b: any) => b.height - a.height || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  const video = videos.map((v: any) => accountTrack(v, 'video')).find(Boolean);
  const audio = [...stream.dash.audio]
    .sort((a: any, b: any) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
    .map((a: any) => accountTrack(a, 'audio'))
    .find(Boolean);
  if (!video || !audio)
    throw new Error(
      'B 站未返回可供网页播放的 720p / 1080p AVC 与 AAC 轨道；可在高级选项手动选择游客兼容源',
    );
  return {
    url: page.href,
    provider: 'bilibili',
    duration: selected.duration,
    title: `${String(data.title || bvid)}${data.pages.length > 1 ? ` · P${part}` : ''}`.slice(
      0,
      200,
    ),
    source: { kind: 'dash', video, audio, bilibiliDirect: true },
  };
}
