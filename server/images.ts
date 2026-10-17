import type { Rooms } from './rooms';

export const IMAGE_LIMIT = 20 * 1024 * 1024;
const ROOM_LIMIT = 64 * 1024 * 1024,
  BLOCK = 64 * 1024;
export interface ImageMeta {
  id: string;
  room: string;
  type: string;
  size: number;
  ready: boolean;
  at: number;
}
export interface ImageStorage {
  list(): Promise<ImageMeta[]>;
  meta(value: ImageMeta): Promise<void>;
  put(id: string, index: number, value: Uint8Array): Promise<void>;
  get(id: string, index: number): Promise<Uint8Array | undefined>;
  delete(value: ImageMeta): Promise<void>;
}
export function imageType(data: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (data.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => data[i] === b))
    return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get('Content-Length')) > IMAGE_LIMIT)
    throw new Error('图片不能超过 20 MiB');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('没有收到图片');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > IMAGE_LIMIT) throw new Error('图片不能超过 20 MiB');
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/** Binary HTTP attachments, never base64 snapshots or room WebSocket payloads. */
export class RoomImages {
  private busy = false;
  constructor(
    private rooms: Rooms,
    private storage: ImageStorage,
    private persist: () => Promise<void> = async () => {},
  ) {}
  async handle(request: Request): Promise<Response> {
    const parts = new URL(request.url).pathname.split('/'),
      code = parts[2],
      id = parts[3];
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code) || parts.length > (id ? 4 : 3))
      return new Response('Not found', { status: 404 });
    if (request.method === 'POST' && !id) {
      const secret = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      const access = this.rooms.memberAccess(
        code,
        request.headers.get('X-Member-Id') ?? '',
        secret,
      );
      if (!access) return new Response('请重新加入房间', { status: 403 });
      if (this.busy) return new Response('正在处理图片，请稍后重试', { status: 429 });
      this.busy = true;
      let pending: ImageMeta | undefined;
      try {
        await this.sweep();
        const data = await boundedBody(request),
          type = imageType(data);
        if (!type) return new Response('支持 PNG、JPEG、GIF、WebP 图片', { status: 415 });
        const all = await this.storage.list();
        const bytes = all.filter((x) => x.room === code).reduce((n, x) => n + x.size, 0);
        if (bytes + data.length > ROOM_LIMIT)
          return new Response('本房间图片已达 64 MiB，请稍后重试或创建新房间', { status: 413 });
        if (all.reduce((n, x) => n + x.size, 0) + data.length > 128 * 1024 * 1024)
          return new Response('图片存储暂满，请稍后重试', { status: 507 });
        pending = {
          id: crypto.randomUUID(),
          room: code,
          type,
          size: data.length,
          ready: false,
          at: Date.now(),
        };
        await this.storage.meta(pending);
        for (let offset = 0; offset < data.length; offset += BLOCK)
          await this.storage.put(pending.id, offset / BLOCK, data.slice(offset, offset + BLOCK));
        // Authenticate again after upload; an old session must not post after leaving.
        if (!this.rooms.memberAccess(code, access.seat.id, secret)) throw new Error('已离开房间');
        pending.ready = true;
        await this.storage.meta(pending);
        this.rooms.addImage(access.room, access.seat, { id: pending.id, type, size: data.length });
        await this.persist();
        const result = Response.json({ id: pending.id }, { status: 201 });
        pending = undefined;
        await this.sweep();
        return result;
      } catch (e) {
        if (pending) await this.storage.delete(pending);
        return new Response(e instanceof Error ? e.message : '图片发送失败', { status: 400 });
      } finally {
        this.busy = false;
      }
    }
    if (!['GET', 'HEAD'].includes(request.method) || !id || !/^[a-f0-9-]{36}$/.test(id))
      return new Response('Not found', { status: 404 });
    const room = this.rooms.rooms.get(code);
    const image = room?.chat.find((x) => x.imageFile?.id === id)?.imageFile;
    const meta = (await this.storage.list()).find((x) => x.id === id && x.room === code && x.ready);
    if (!image || !meta) return new Response('图片已过期', { status: 404 });
    let index = 0;
    const store = this.storage;
    const body =
      request.method === 'HEAD'
        ? null
        : new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (index * BLOCK >= meta.size) {
                controller.close();
                return;
              }
              const block = await store.get(id, index++);
              if (!block) {
                controller.error(new Error('图片数据不完整'));
                return;
              }
              controller.enqueue(block);
            },
          });
    return new Response(body, {
      headers: {
        'Content-Type': meta.type,
        'Content-Length': String(meta.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  async sweep() {
    for (const meta of await this.storage.list()) {
      const referenced = this.rooms.rooms
        .get(meta.room)
        ?.chat.some((c) => c.imageFile?.id === meta.id);
      if (!referenced && (meta.ready || Date.now() - meta.at > 120000))
        await this.storage.delete(meta);
    }
  }
}
