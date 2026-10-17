import type { MediaInput } from './protocol';
export function describeUrl(raw: string): MediaInput {
  const url = new URL(raw.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请输入 HTTP/HTTPS 视频地址');
  const host = url.hostname.toLowerCase();
  if (host === 'www.bilibili.com' || host === 'bilibili.com' || host === 'm.bilibili.com') {
    const match = /^\/video\/(BV[A-Za-z0-9]+)\/?$/.exec(url.pathname);
    if (!match) throw new Error('当前 B 站入口支持 /video/BV… 页面');
    const part = url.searchParams.get('p');
    return {
      url: `https://www.bilibili.com/video/${match[1]}/${part && /^\d+$/.test(part) ? '?p=' + part : ''}`,
      title: match[1] + (part ? ` · P${part}` : ''),
      provider: 'bilibili',
    };
  }
  if (host === 'next.xifanacg.com')
    return { url: url.href, title: '喜番 · 待识别片名', provider: 'xifan' };
  if (host === 'www.mgnacg.com' || host === 'mgnacg.com')
    return { url: url.href, title: '蜜柑 · 待识别片名', provider: 'mgn' };
  if (/\.(mp4|webm|m4v|m3u8)(\?|$)/i.test(url.href))
    return {
      url: url.href,
      title: decodeURIComponent(url.pathname.split('/').at(-1) || '共享视频'),
      provider: 'direct',
      source: { kind: /\.m3u8/i.test(url.pathname) ? 'hls' : 'file', video: url.href },
    };
  return { url: url.href, title: host, provider: 'other' };
}
