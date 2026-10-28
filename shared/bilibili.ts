import type { MediaInput } from './protocol';
import { nextEpisode } from './episodes';

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

async function publicInfo(raw: string, read: (url: string) => Promise<string>) {
  const page = bilibiliPage(raw);
  const bvid = page.pathname.split('/')[2]!;
  const part = Number(page.searchParams.get('p') || 1);
  const info = JSON.parse(await read(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
  const data = info.data;
  if (info.code !== 0 || data?.bvid !== bvid || data?.rights?.pay === 1)
    throw new Error('B 站未提供此视频的可用信息，请在原站检查访问权限');
  return { page, bvid, part, data };
}

export async function nextBilibiliPage(raw: string, read: (url: string) => Promise<string>) {
  const { page, part, data } = await publicInfo(raw, read);
  const next = Array.isArray(data.pages) ? data.pages.find((p: any) => p.page === part + 1) : null;
  return next
    ? nextEpisode(page.href, `${page.pathname}?p=${next.page}`, String(next.part || '下一分 P'))
    : null;
}

export function allowedAccountBilibiliMetadata(raw: string) {
  const url = new URL(raw);
  return (
    url.origin === 'https://api.bilibili.com' &&
    !url.username &&
    !url.password &&
    ((url.pathname === '/x/web-interface/view' && /^\?bvid=BV[A-Za-z0-9]{10}$/.test(url.search)) ||
      (url.pathname === '/x/web-interface/nav' && !url.search) ||
      (url.pathname === '/x/player/playurl' &&
        /^\?bvid=BV[A-Za-z0-9]{10}&cid=[1-9]\d{0,15}&qn=80&fnval=16&platform=html5&high_quality=1$/.test(
          url.search,
        )))
  );
}

function accountTrack(track: any, type: 'video' | 'audio') {
  if (track?.is_drm || track?.drm_tech_type || track?.drm) return null;
  const addresses = [
    track?.baseUrl ?? track?.base_url,
    ...(track?.backupUrl ?? track?.backup_url ?? []),
  ].sort((a, b) => {
    // Prefer an original MCDN URL when provided. This route has independent
    // browser playback evidence; keep every signed URL exactly as returned.
    const mcdn = (value: unknown) =>
      typeof value === 'string' &&
      /^https:\/\/[a-z0-9-]+\.mcdn\.bilivideo\.cn(?::(?:4483|8082))?\//.test(value);
    return Number(mcdn(b)) - Number(mcdn(a));
  });
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
        ((regular && !u.port) || (mcdn && ['', '4483', '8082'].includes(u.port))) &&
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
    throw Object.assign(
      new Error('B 站高清取源需要当前浏览器已登录；请在 B 站登录后回到这里重试，观众无需登录'),
      {
        code: 'BILIBILI_LOGIN_REQUIRED',
      },
    );
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
      // Request the normal authenticated HTML5 DASH route. Desktop-route
      // signatures can reject other browser pages even for the same video.
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${selected.cid}&qn=80&fnval=16&platform=html5&high_quality=1`,
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
      'B 站未向当前账号返回完整的 720p / 1080p AVC 与 AAC 轨道，请在原站检查可用画质',
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
