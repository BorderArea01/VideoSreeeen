import { createHash } from 'node:crypto';
import type { MediaInput } from '../shared/protocol';
import type { Rooms } from './rooms';

class SiteSourceError extends Error {}

type TextFetch = (url: string, signal: AbortSignal) => Promise<Response>;
const PAGE = /^\/bangumi\/(\d+)-(\d+)-(\d+)\/$/;
const PARSER = 'https://play.mknacg.top:8585/cloudplay/ccxl.php';
export const SITE_METADATA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 VideoSreeeen/0.4',
  Accept: 'text/html,application/javascript;q=0.9,*/*;q=0.1',
};
export function mgnPage(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    !['www.mgnacg.com', 'mgnacg.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !PAGE.test(url.pathname)
  )
    throw new SiteSourceError('当前页面识别支持蜜柑番剧播放页；其他网站可使用客户端或共享画面');
  return new URL(url.pathname, 'https://www.mgnacg.com');
}
export function allowedSiteMetadata(raw: string) {
  const url = new URL(raw);
  return (
    !url.username &&
    !url.password &&
    url.protocol === 'https:' &&
    ((url.hostname === 'www.mgnacg.com' &&
      !url.port &&
      (PAGE.test(url.pathname) || url.pathname === '/static/js/playerconfig.js')) ||
      (url.origin + url.pathname === PARSER && /^\?url=[A-Za-z0-9%+\/=]{1,8192}$/.test(url.search)))
  );
}
async function smallText(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal?: AbortSignal,
) {
  if (!body) throw new SiteSourceError('响应内容为空');
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new SiteSourceError('识别响应超过大小限制');
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}
// Only parse JSON assignments. Never evaluate source scripts on the server.
export function assignedJson(text: string, name: string): any {
  const found = new RegExp(
    '\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*\\{',
  ).exec(text);
  if (!found) throw new SiteSourceError('原站播放器配置尚未识别');
  const start = found.index + found[0].lastIndexOf('{');
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new SiteSourceError('原站播放器配置不完整');
}
export async function mgnPublicSource(html: string): Promise<string> {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((m) => [m[1]!.toLowerCase(), m[3]!]),
    ),
  );
  const order = tags.find((t) => t.charset?.toLowerCase() === 'utf-8')?.id?.replace(/^now_/, '');
  const letters = tags.find((t) => t.name === 'viewport')?.id?.replace(/^now_/, '');
  const encoded = /\bvar\s+config\s*=\s*\{[\s\S]*?"url"\s*:\s*("(?:[^"\\]|\\.){1,8192}")/.exec(
    html,
  )?.[1];
  if (
    !order ||
    !/^[0-9]{10}$/.test(order) ||
    new Set(order).size !== 10 ||
    !letters ||
    !/^[A-Za-z0-9]{10}$/.test(letters) ||
    !encoded
  )
    throw new SiteSourceError('这条蜜柑线路的播放器格式暂不支持');
  // These are the public per-response values used by the original player's
  // normal URL decoding. No login, cookie, paid access or media DRM is bypassed.
  const seed = [...order]
    .map((digit, index) => ({ digit: Number(digit), letter: letters[index] }))
    .sort((a, b) => a.digit - b.digit)
    .map((item) => item.letter)
    .join('');
  const digest = createHash('md5')
    .update(seed + 'Mknacg123321')
    .digest('hex');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(digest.slice(16)),
    'AES-CBC',
    false,
    ['decrypt'],
  );
  const decoded = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(digest.slice(0, 16)) },
    key,
    Uint8Array.from(Buffer.from(JSON.parse(encoded), 'base64')),
  );
  const raw = new TextDecoder().decode(decoded).trim();
  const url = new URL(raw);
  if (
    raw.length > 4096 ||
    url.protocol !== 'https:' ||
    url.hostname !== 'r2.jzacg.com' ||
    url.port ||
    url.username ||
    url.password ||
    !/\.(mp4|webm|m3u8)$/i.test(url.pathname)
  )
    throw new SiteSourceError('这条蜜柑线路的视频源暂不支持');
  return url.href;
}
export async function resolveMgnPage(
  raw: string,
  fetchText: TextFetch,
  signal: AbortSignal,
): Promise<MediaInput> {
  const page = mgnPage(raw),
    match = PAGE.exec(page.pathname)!;
  const read = async (url: string) => {
    if (!allowedSiteMetadata(url)) throw new SiteSourceError('原站解析地址不在适配范围内');
    const response = await fetchText(url, signal);
    if (!response.ok) {
      await response.body?.cancel();
      const stage =
        url === page.href
          ? '播放页'
          : new URL(url).pathname.endsWith('playerconfig.js')
            ? '播放器配置'
            : '解析器';
      throw new SiteSourceError(
        `房间服务读取原站${stage}失败（HTTP ${response.status}），请稍后重试`,
      );
    }
    return smallText(response.body, 512 * 1024, signal);
  };
  const [html, configuration] = await Promise.all([
    read(page.href),
    read('https://www.mgnacg.com/static/js/playerconfig.js'),
  ]);
  const player = assignedJson(html, 'player_aaaa');
  if (
    String(player.id) !== match[1] ||
    String(player.sid) !== match[2] ||
    String(player.nid) !== match[3] ||
    player.points !== 0 ||
    player.trysee !== 0
  )
    throw new SiteSourceError('此页面的播放权限或配置需要在原站处理');
  const list = assignedJson(configuration, 'MacPlayerConfig.player_list');
  const prefix = list[player.from]?.parse;
  if (
    prefix !== PARSER + '?url=' ||
    typeof player.url !== 'string' ||
    !/^[A-Za-z0-9%+\/=]{1,8192}$/.test(player.url)
  )
    throw new SiteSourceError('当前仅适配蜜柑的存储线路；其他线路请使用客户端或共享画面');
  const video = await mgnPublicSource(await read(prefix + player.url));
  const title =
    /<title>([^<]{1,400})<\/title>/i
      .exec(html)?.[1]
      ?.replace(/-橘子动漫$/, '')
      .replace(/&amp;/g, '&') || '蜜柑视频';
  return {
    url: page.href,
    title: title.slice(0, 200),
    provider: 'mgn',
    source: { kind: /\.m3u8$/i.test(new URL(video).pathname) ? 'hls' : 'file', video },
  };
}

/** Authenticated metadata only. Video still loads directly from the original CDN. */
export class RoomSources {
  private busy = new Set<string>();
  private attempts = new Map<string, number>();
  constructor(
    private rooms: Rooms,
    private fetchText: TextFetch = (url, signal) =>
      fetch(url, {
        signal,
        redirect: 'manual',
        headers: SITE_METADATA_HEADERS,
      }),
  ) {}
  async handle(request: Request) {
    const path = new URL(request.url).pathname;
    const code = /^\/resolve-source\/([A-HJ-NP-Z2-9]{6})$/.exec(path)?.[1] ?? '';
    const member = request.headers.get('X-Member-Id') ?? '',
      secret = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const reply = (value: unknown, status = 200) =>
      Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!this.rooms.memberAccess(code, member, secret))
      return reply({ error: '请先加入房间' }, 401);
    if (this.busy.has(code)) return reply({ error: '房间正在识别视频，请稍候' }, 409);
    const identity = code + ':' + member;
    if (Date.now() - (this.attempts.get(identity) ?? 0) < 4000)
      return reply({ error: '请稍候再重试识别' }, 429);
    this.busy.add(code);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
    try {
      const body = JSON.parse(await smallText(request.body, 4096, signal));
      if (typeof body.url !== 'string') return reply({ error: '请提供播放页面地址' }, 400);
      const url = mgnPage(body.url);
      this.attempts.set(identity, Date.now());
      if (this.attempts.size > 256) this.attempts.delete(this.attempts.keys().next().value!);
      const media = await resolveMgnPage(url.href, this.fetchText, signal);
      if (!this.rooms.memberAccess(code, member, secret))
        return reply({ error: '已离开房间，识别结果未使用' }, 401);
      return reply({ media });
    } catch (cause) {
      return reply(
        {
          error: signal.aborted
            ? signal.reason?.name === 'TimeoutError'
              ? '原站响应超时（12 秒），请重试或使用共享画面'
              : '已取消识别'
            : cause instanceof SiteSourceError
              ? cause.message
              : '视频源暂未识别，请重试或使用共享画面',
        },
        422,
      );
    } finally {
      this.busy.delete(code);
    }
  }
}
