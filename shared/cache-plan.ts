import type { Source } from './protocol';

export interface CacheFile {
  name: string;
  url?: string;
  directUrl?: string;
  content?: string;
}
export interface CachePlan {
  files: CacheFile[];
  entry: string;
  audio?: string;
  kind: 'file' | 'hls' | 'dash';
  referer?: string;
}
export const BLOCK_SIZE = 256 * 1024;
export const MAX_CACHE = 4 * 1024 ** 3;
export const validName = (name: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(name) &&
  !name.includes('..') &&
  name !== 'complete.json';
export function validatePlan(plan: CachePlan) {
  if (!plan || !Array.isArray(plan.files) || !plan.files.length || plan.files.length > 12002)
    throw new Error('缓存计划无效');
  const names = new Set<string>();
  for (const f of plan.files) {
    if (!validName(f.name) || names.has(f.name) || (!f.url && typeof f.content !== 'string'))
      throw new Error('缓存文件无效');
    if (f.content && new TextEncoder().encode(f.content).length > 2 * 1024 ** 2)
      throw new Error('播放列表过大');
    names.add(f.name);
  }
  if (!names.has(plan.entry) || (plan.audio && !names.has(plan.audio)))
    throw new Error('缓存入口无效');
}
export function directPlan(source: Source): CachePlan {
  if (source.kind === 'hls') throw new Error('HLS 需要客户端先解析完整播放列表');
  return {
    kind: source.kind,
    entry: 'video.mp4',
    referer: source.referer,
    ...(source.audio ? { audio: 'audio.m4a' } : {}),
    files: [
      { name: 'video.mp4', url: source.video },
      ...(source.audio ? [{ name: 'audio.m4a', url: source.audio }] : []),
    ],
  };
}

export function hlsLines(value: string) {
  const lines = value
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('媒体源没有返回有效 HLS 播放列表');
  if (lines.some((l) => l.startsWith('#EXT-X-KEY:') && !/METHOD=NONE(?:,|$)/.test(l)))
    throw new Error('当前共同缓存不支持加密 HLS');
  if (lines.some((l) => /^#EXT-X-(BYTERANGE|SESSION-KEY)/.test(l)))
    throw new Error('当前共同缓存不支持字节范围或加密播放列表');
  return lines;
}
export function hlsVariants(lines: string[], base: string) {
  return lines.flatMap((l, i) =>
    l.startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] && !lines[i + 1]!.startsWith('#')
      ? [
          {
            url: new URL(lines[i + 1]!, base).href,
            bandwidth: Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] ?? 0),
            audio: /AUDIO="([^"]+)"/.exec(l)?.[1],
          },
        ]
      : [],
  );
}

export async function buildHlsPlan(
  source: Source,
  load: (url: string) => Promise<string>,
): Promise<CachePlan> {
  const files: CacheFile[] = [];
  const first = hlsLines(await load(source.video));
  const variants = hlsVariants(first, source.video).sort((a, b) => b.bandwidth - a.bandwidth);
  const chosen = variants.find((v) => v.bandwidth <= 8000000) ?? variants.at(-1);
  const videoUrl = chosen?.url ?? source.video;
  const audioLine =
    chosen?.audio &&
    first.find(
      (l) =>
        l.startsWith('#EXT-X-MEDIA:') &&
        l.includes(`GROUP-ID="${chosen.audio}"`) &&
        /TYPE=AUDIO/.test(l) &&
        /URI="/.test(l),
    );
  const audioUrl = audioLine
    ? new URL(/URI="([^"]+)"/.exec(audioLine)![1]!, source.video).href
    : null;
  const playlist = async (url: string, name: string, prefix: string) => {
    const lines = hlsLines(await load(url));
    if (!lines.includes('#EXT-X-ENDLIST'))
      throw new Error('共同缓存仅支持完整点播视频，不能缓存直播或未结束列表');
    if (hlsVariants(lines, url).length) throw new Error('播放列表嵌套过深');
    let index = 0;
    const asset = (relative: string) => {
      if (files.length >= 12000) throw new Error('视频分片数量超过限制');
      const absolute = new URL(relative, url).href;
      const local = `${prefix}-${index++}.bin`;
      files.push({ name: local, url: absolute });
      return local;
    };
    const body = lines
      .map((l) =>
        !l || l.startsWith('#')
          ? l.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${asset(uri)}"`)
          : asset(l),
      )
      .join('\n');
    files.push({ name, content: body });
  };
  await playlist(videoUrl, 'video.m3u8', 'v');
  if (audioUrl) {
    await playlist(audioUrl, 'audio.m3u8', 'a');
    files.push({
      name: 'index.m3u8',
      content:
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,AUDIO="audio"\nvideo.m3u8\n',
    });
  }
  return {
    kind: 'hls',
    entry: audioUrl ? 'index.m3u8' : 'video.m3u8',
    referer: source.referer,
    files,
  };
}
