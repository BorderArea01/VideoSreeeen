import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import type { Room, Rooms } from './rooms';

import { buildHlsPlan, directPlan, type CachePlan } from '../shared/cache-plan';
export type { CacheFile, CachePlan } from '../shared/cache-plan';
export { hlsLines, hlsVariants } from '../shared/cache-plan';
const MAX_TEXT = 2 * 1024 * 1024;
export function assertPublicAddress(address: string) {
  let ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress())
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  if (ip.range() !== 'unicast') throw new Error('禁止访问本机、内网和保留地址');
}
export async function publicTarget(raw: string, allowedPorts?: readonly string[]) {
  const url = new URL(raw);
  const ports =
    allowedPorts ??
    (url.origin === 'https://play.xfvod.pro:8088' ? ['8088'] : ['80', '443', '8080', '8443']);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !ports.includes(url.port))
  )
    throw new Error('不支持的媒体地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
    : await lookup(host, { all: true });
  if (!addresses.length) throw new Error('媒体域名无法解析');
  for (const record of addresses) assertPublicAddress(record.address);
  return { url, address: addresses.sort((a, b) => a.family - b.family)[0]! };
}
export async function requestPublic(
  raw: string,
  headers: Record<string, string> = {},
  redirects = 0,
  options: { allowedPorts?: readonly string[]; maxRedirects?: number; signal?: AbortSignal } = {},
): Promise<IncomingMessage> {
  if (redirects > (options.maxRedirects ?? 5)) throw new Error('媒体重定向过多');
  const { url, address } = await publicTarget(raw, options.allowedPorts);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 VideoSreeeen/0.1', ...headers },
        family: address.family,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        timeout: 20000,
        signal: options.signal,
      },
      resolve,
    );
    request.on('timeout', () => request.destroy(new Error('媒体源连接超时')));
    request.on('error', reject);
  });
  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location
  ) {
    response.destroy();
    return requestPublic(
      new URL(response.headers.location, raw).href,
      headers,
      redirects + 1,
      options,
    );
  }
  if (!response.statusCode || response.statusCode >= 400) {
    response.destroy();
    throw new Error(`媒体源返回 ${response.statusCode ?? '未知错误'}，请在客户端重新识别视频源`);
  }
  return response;
}
async function text(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > MAX_TEXT) {
      response.destroy();
      throw new Error('播放列表过大');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class MediaRelay {
  private registries = new Map<string, { mediaId: string; urls: Map<string, string> }>();
  constructor(private rooms: Rooms) {}
  private registry(room: Room) {
    let registry = this.registries.get(room.code);
    if (!registry || registry.mediaId !== room.media?.id) {
      registry = { mediaId: room.media?.id ?? '', urls: new Map() };
      this.registries.set(room.code, registry);
    }
    return registry;
  }
  private register(room: Room, raw: string) {
    const urls = this.registry(room).urls;
    if (urls.size >= 16000 && ![...urls.values()].includes(raw))
      throw new Error('媒体分片数量超过限制');
    const id = createHash('sha256').update(raw).digest('hex').slice(0, 24);
    urls.set(id, raw);
    return id;
  }
  private path(room: Room, id: string) {
    return `/media/${room.code}/${room.mediaToken}/${id}`;
  }
  private headers(room: Room): Record<string, string> {
    return room.media?.source?.referer ? { Referer: room.media.source.referer } : {};
  }
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const match = /^\/(media|cache-plan)\/([A-Z2-9]{6})\/([A-Za-z0-9_-]+)\/?([a-z0-9]*)$/.exec(
      pathname,
    );
    if (!match) return false;
    const [, mode, code, secret, slot] = match;
    const room = this.rooms.mediaAccess(code!, secret!);
    if (!room?.media?.source) {
      res.writeHead(404).end('媒体不存在或链接失效');
      return true;
    }
    if (mode === 'cache-plan') {
      const plan = await this.plan(room);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(plan));
      return true;
    }
    const source = room.media.source;
    if (source.bilibiliDirect) {
      res.writeHead(404).end('此视频由各端从原 CDN 加载');
      return true;
    }
    const raw =
      slot === 'video'
        ? source.video
        : slot === 'audio'
          ? source.audio
          : this.registry(room).urls.get(slot!);
    if (!raw) {
      res.writeHead(404).end();
      return true;
    }
    const headers: Record<string, string> = this.headers(room);
    if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range))
      headers.Range = req.headers.range;
    const upstream = await requestPublic(raw, headers);
    res.on('close', () => upstream.destroy());
    const type = String(upstream.headers['content-type'] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (/mpegurl/i.test(type) || /\.m3u8(?:\?|$)/i.test(raw)) {
      const body = await text(upstream);
      const rewritten = body
        .split(/\r?\n/)
        .map((line) => {
          if (!line.trim()) return line;
          if (!line.startsWith('#'))
            return this.path(room, this.register(room, new URL(line.trim(), raw).href));
          return line.replace(
            /URI="([^"]+)"/g,
            (_m, url: string) =>
              `URI="${this.path(room, this.register(room, new URL(url, raw).href))}"`,
          );
        })
        .join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(rewritten);
      return true;
    }
    if (/html|javascript|svg|xml/i.test(type)) {
      upstream.destroy();
      throw new Error('媒体源返回网页而非视频');
    }
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
      if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]!);
    res.statusCode = upstream.statusCode ?? 200;
    let count = 0;
    const limit = new Transform({
      transform(chunk, _encoding, done) {
        count += chunk.length;
        done(count > 4 * 1024 ** 3 ? new Error('单文件超过 4 GiB 上限') : null, chunk);
      },
    });
    await pipeline(upstream, limit, res);
    return true;
  }
  async plan(room: Room): Promise<CachePlan> {
    const source = room.media!.source!;
    if (source.bilibiliDirect) return directPlan(source);
    const plan =
      source.kind === 'hls'
        ? await buildHlsPlan(source, async (url) =>
            text(await requestPublic(url, this.headers(room))),
          )
        : directPlan(source);
    plan.referer = source.referer;
    for (const f of plan.files)
      if (f.url) {
        f.directUrl = f.url;
        f.url = this.path(room, this.register(room, f.url));
      }
    return plan;
  }

  sweep() {
    for (const code of this.registries.keys())
      if (!this.rooms.rooms.has(code)) this.registries.delete(code);
  }
}
