import { DurableObject } from 'cloudflare:workers';
import { Rooms, RoomError, type StoredRoom } from '../server/rooms';
import { clientMessageSchema, parseInvite, type Chat } from '../shared/protocol';
import { directPlan } from '../shared/cache-plan';
import { RoomImages, type ImageMeta } from '../server/images';
import { BroadcastRelay } from '../server/broadcast-relay';
import type { RelayHello } from '../shared/broadcast-relay';
import { RoomSources } from '../server/site-source';
import { startProbe, finishProbe } from '../server/latency';

interface Env {
  ROOMS: DurableObjectNamespace<WatchRoom>;
  ASSETS: Fetcher;
  ALLOWED_ORIGINS?: string;
  ICE_SERVERS?: string;
}
interface Connection {
  kind?: 'broadcast-relay';
  relayAuth?: RelayHello;
  memberId?: string;
  opened: number;
  seen: number;
  tokens: number;
  tick: number;
  invalid: number;
  nonce?: string;
  probeAt?: number;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function originAllowed(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  return (
    !origin ||
    origin === new URL(request.url).origin ||
    (env.ALLOWED_ORIGINS ?? 'https://videosreeeen.local,null,file://').split(',').includes(origin)
  );
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = request.headers.get('Origin');
    if (!originAllowed(request, env)) return new Response('Origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin ?? url.origin,
          'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Range,Authorization,X-Member-Id',
          Vary: 'Origin',
        },
      });
    let response: Response;
    if (url.pathname === '/healthz')
      response = json({
        ok: true,
        app: 'videosreeeen',
        runtime: 'cloudflare',
        version: '0.4.2',
        mediaRelay: false,
        broadcastRelay: true,
        p2p: true,
      });
    else if (url.pathname === '/config')
      response = json({
        mediaRelay: false,
        p2p: true,
        roomRouting: true,
        broadcastRelay: true,
        iceServers: JSON.parse(env.ICE_SERVERS ?? '[{"urls":"stun:stun.cloudflare.com:3478"}]'),
      });
    else if (url.pathname === '/ws' || url.pathname === '/broadcast-relay') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('WebSocket required', { status: 426 });
      const code = url.searchParams.get('room');
      if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code))
        return new Response('请更新客户端后重试', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    } else if (
      url.pathname.startsWith('/cache-plan/') ||
      url.pathname.startsWith('/images/') ||
      url.pathname.startsWith('/resolve-source/')
    ) {
      const code = url.pathname.split('/')[2];
      if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code))
        return new Response('Not found', { status: 404 });
      response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    } else if (url.pathname.startsWith('/media/'))
      response = new Response('此部署不转发视频，请使用直接视频源或客户端共同缓存', {
        status: 501,
      });
    else return env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  },
};

/** One authoritative room per object, using hibernatable sockets and SQLite-backed storage. */
export class WatchRoom extends DurableObject<Env> {
  private rooms = new Rooms();
  private broadcastRelay = new BroadcastRelay(this.rooms);
  private sources = new RoomSources(this.rooms);
  private chatIds: string[] = [];
  private images = new RoomImages(
    this.rooms,
    {
      list: async () => [
        ...(await this.ctx.storage.list<ImageMeta>({ prefix: 'imgmeta:' })).values(),
      ],
      meta: async (value) => this.ctx.storage.put('imgmeta:' + value.id, value),
      put: async (id, index, value) => this.ctx.storage.put(`imgdata:${id}:${index}`, value),
      get: async (id, index) => this.ctx.storage.get<Uint8Array>(`imgdata:${id}:${index}`),
      delete: async (value) => {
        const keys = Array.from(
          { length: Math.ceil(value.size / 65536) },
          (_, i) => `imgdata:${value.id}:${i}`,
        );
        for (let i = 0; i < keys.length; i += 100)
          await this.ctx.storage.delete(keys.slice(i, i + 100));
        await this.ctx.storage.delete('imgmeta:' + value.id);
      },
    },
    () => this.save(),
  );
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<StoredRoom & { chatIds: string[] }>('room');
      if (!saved) return;
      this.chatIds = saved.chatIds ?? [];
      const chats = await ctx.storage.get<Chat>(this.chatIds.map((id) => 'chat:' + id));
      saved.chat = this.chatIds.flatMap((id) => chats.get('chat:' + id) ?? []);
      const sockets = new Map<string, WebSocket>();
      for (const socket of ctx.getWebSockets()) {
        const c = socket.deserializeAttachment() as Connection;
        if (!c?.kind && c?.memberId) sockets.set(c.memberId, socket);
      }
      this.rooms.restore(saved, sockets);
      for (const socket of ctx.getWebSockets()) {
        const c = socket.deserializeAttachment() as Connection;
        if (c?.kind === 'broadcast-relay') this.broadcastRelay.connect(socket, c.relayAuth);
      }
      this.broadcastRelay.restored();
    });
  }
  private get room() {
    return this.rooms.rooms.values().next().value;
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/resolve-source/')) return this.sources.handle(request);
    if (url.pathname.startsWith('/images/')) return this.images.handle(request);
    if (url.pathname.startsWith('/cache-plan/')) {
      const [, , code, secret] = url.pathname.split('/');
      const room = this.rooms.mediaAccess(code!, secret!);
      if (!room?.media?.source) return new Response('媒体不存在或邀请已失效', { status: 404 });
      if (room.media.source.kind === 'hls')
        return new Response('请在客户端解析完整 HLS 列表', { status: 501 });
      return json(directPlan(room.media.source));
    }
    if (this.ctx.getWebSockets().length >= 24)
      return new Response('房间连接数已满', { status: 429 });
    const code = url.searchParams.get('room');
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code))
      return new Response('Invalid room', { status: 400 });
    if (!(await this.ctx.storage.get('code'))) await this.ctx.storage.put('code', code);
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair);
    const now = Date.now();
    server.binaryType = 'arraybuffer';
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      ...(url.pathname === '/broadcast-relay' ? { kind: 'broadcast-relay' as const } : {}),
      opened: now,
      seen: now,
      tokens: 100,
      tick: now,
      invalid: 0,
    } satisfies Connection);
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const c = socket.deserializeAttachment() as Connection,
      now = Date.now();
    if (c.kind === 'broadcast-relay') {
      c.seen = now;
      this.broadcastRelay.connect(socket, c.relayAuth);
      c.relayAuth = this.broadcastRelay.message(
        socket,
        typeof raw === 'string' ? raw : new Uint8Array(raw),
      );
      socket.serializeAttachment(c);
      return;
    }
    if (typeof raw !== 'string' || raw.length > 400000) {
      socket.close(4002, 'invalid payload');
      return;
    }
    c.tokens = Math.min(100, c.tokens + (now - c.tick) * 0.02);
    c.tick = now;
    c.seen = now;
    if (c.tokens < 1) {
      socket.close(4008, 'rate limited');
      return;
    }
    c.tokens--;
    try {
      const parsed = clientMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        if (++c.invalid > 3) socket.close(4002, 'invalid payload');
        throw new RoomError('invalid', '消息格式不正确');
      }
      const msg = parsed.data;
      if (msg.type === 'create' || msg.type === 'join') {
        if (c.memberId) throw new RoomError('already_joined', '请先离开当前房间');
        let result;
        if (msg.type === 'create') {
          if (this.room) throw new RoomError('occupied', '房间地址已被使用，请重新创建');
          // The name was selected by the public router, not by a message body.
          const tags = await this.ctx.storage.get<string>('code');
          if (!tags) throw new RoomError('invalid', '房间路由尚未初始化');
          result = this.rooms.create(msg.name, socket, tags);
        } else {
          if (parseInvite(msg.invite)?.code !== this.room?.code)
            throw new RoomError('invalid_invite', '房间不存在或邀请不正确');
          result = this.rooms.join(msg.invite, msg.name, socket, msg.resume);
        }
        c.memberId = result.seat.id;
        result.seat.latencyEvents = msg.capabilities?.includes('latency-v1') === true;
        this.rooms.send(socket, {
          type: 'welcome',
          memberId: result.seat.id,
          resume: result.seat.resume,
          room: this.rooms.snapshot(result.room),
        });
        this.rooms.broadcast(result.room);
        const nonce = startProbe(c, now);
        if (nonce) this.rooms.send(socket, { type: 'probe', nonce });
      } else {
        const room = this.room,
          seat = c.memberId && room?.members.get(c.memberId);
        if (!room || !seat || seat.socket !== socket)
          throw new RoomError('not_in_room', '请先加入房间');
        if (msg.type === 'ping') {
          this.rooms.send(socket, {
            type: 'pong',
            sentAt: msg.sentAt,
            clock: this.rooms.clock(room),
          });
          const nonce = startProbe(c, now);
          if (nonce) this.rooms.send(socket, { type: 'probe', nonce });
        } else if (msg.type === 'probe') {
          const elapsed = finishProbe(c, msg.nonce, now);
          if (elapsed !== null) this.rooms.recordLatency(room, seat, socket, elapsed);
        } else if (msg.type === 'leave') {
          this.rooms.disconnect(room, seat, socket, true);
          c.memberId = undefined;
          socket.close(1000, 'left');
        } else this.rooms.act(room, seat, msg);
      }
      // Signaling is transient. Never store SDP or ICE candidates in room state.
      if (msg.type !== 'signal' && msg.type !== 'ping' && msg.type !== 'probe') await this.save();
    } catch (e) {
      this.rooms.send(socket, {
        type: 'error',
        code: e instanceof RoomError ? e.code : 'invalid',
        message: e instanceof RoomError ? e.message : '无法处理消息',
        ...(c.memberId && this.room ? { room: this.rooms.snapshot(this.room) } : {}),
      });
    }
    this.broadcastRelay.sweep();
    socket.serializeAttachment(c);
  }
  private async save() {
    const room = this.room;
    if (!room) {
      await this.ctx.storage.deleteAll();
      this.chatIds = [];
      return;
    }
    const saved = this.rooms.dump(room),
      ids = room.chat.map((c) => c.id);
    const writes: Record<string, unknown> = { room: { ...saved, chat: [], chatIds: ids } };
    for (const chat of room.chat)
      if (!this.chatIds.includes(chat.id)) writes['chat:' + chat.id] = chat;
    await this.ctx.storage.put(writes);
    const removed = this.chatIds.filter((id) => !ids.includes(id));
    if (removed.length) await this.ctx.storage.delete(removed.map((id) => 'chat:' + id));
    this.chatIds = ids;
  }
  private async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
  async webSocketClose(socket: WebSocket) {
    await this.disconnect(socket);
  }
  async webSocketError(socket: WebSocket) {
    await this.disconnect(socket);
  }
  private async disconnect(socket: WebSocket) {
    const c = socket.deserializeAttachment() as Connection,
      room = this.room,
      seat = c?.memberId && room?.members.get(c.memberId);
    if (c?.kind === 'broadcast-relay') {
      this.broadcastRelay.close(socket);
      socket.close(1000, 'closed');
      return;
    }
    if (room && seat) {
      this.rooms.disconnect(room, seat, socket);
      await this.save();
    }
    socket.close(1000, 'closed');
    await this.ensureAlarm();
  }
  async alarm() {
    for (const socket of this.ctx.getWebSockets()) {
      const c = socket.deserializeAttachment() as Connection;
      if (Date.now() - c.seen > (c.memberId ? 25000 : 15000)) {
        await this.disconnect(socket);
        socket.close(4000, 'heartbeat timeout');
      }
    }
    this.rooms.sweep();
    this.broadcastRelay.sweep();
    await this.images.sweep();
    await this.save();
    if (this.room || this.ctx.getWebSockets().length)
      await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
}
