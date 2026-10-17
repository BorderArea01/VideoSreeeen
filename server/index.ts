import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientMessageSchema } from '../shared/protocol';
import { RoomError, Rooms, type Room } from './rooms';
import { MediaRelay } from './media';

export function createApp(options: { now?: () => number; origins?: string[] } = {}) {
  const rooms = new Rooms(options.now);
  const relay = new MediaRelay(rooms);
  const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
  const allowed =
    options.origins ??
    (
      process.env.ALLOWED_ORIGINS ??
      'https://videosreeeen.local,http://localhost:5173,http://127.0.0.1:5173,null,file://'
    ).split(',');
  const originAllowed = (origin: string | undefined, host?: string) =>
    !origin ||
    allowed.includes(origin) ||
    origin === `http://${host}` ||
    origin === `https://${host}`;
  const connections = new Map<string, number>();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403).end('Origin not allowed');
      return;
    }
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(405).end();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            app: 'videosreeeen',
            version: '0.1.0',
            rooms: rooms.rooms.size,
          }),
        );
        return;
      }
      if (await relay.handle(req, res, url.pathname)) return;
      const path = resolve(
        root,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
      if (!path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) throw new Error('not a file');
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      };
      res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
      if (req.method === 'HEAD') res.end();
      else res.end(await readFile(path));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(
          req.url?.startsWith('/media') || req.url?.startsWith('/cache-plan') ? 502 : 404,
          { 'Content-Type': 'text/plain; charset=utf-8' },
        );
        res.end(e instanceof Error ? e.message : '请求失败');
      } else res.destroy();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 400000, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (
      req.url !== '/ws' ||
      !originAllowed(req.headers.origin, req.headers.host) ||
      (connections.get(ip) ?? 0) >= 24
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      connections.set(ip, (connections.get(ip) ?? 0) + 1);
      ws.once('close', () => connections.set(ip, Math.max(0, (connections.get(ip) ?? 1) - 1)));
      wss.emit('connection', ws);
    });
  });
  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let seat: ReturnType<Rooms['create']>['seat'] | null = null;
    let tokens = 20;
    let tick = Date.now();
    let invalid = 0;
    let pingAt = 0;
    let pong = true;
    const authTimeout = setTimeout(() => {
      if (!seat) ws.close(4000, 'join timeout');
    }, 15000);
    authTimeout.unref();
    ws.on('pong', () => {
      pong = true;
      if (seat && pingAt) {
        seat.rtt = Math.max(0, Date.now() - pingAt);
        if (room) rooms.broadcast(room);
      }
    });
    const heartbeat = setInterval(() => {
      if (!pong) {
        ws.terminate();
        return;
      }
      pong = false;
      pingAt = Date.now();
      ws.ping();
    }, 5000);
    heartbeat.unref();
    ws.on('message', (raw) => {
      const now = Date.now();
      tokens = Math.min(20, tokens + (now - tick) * 0.006);
      tick = now;
      if (tokens < 1) {
        ws.close(4008, 'rate limited');
        return;
      }
      tokens--;
      try {
        const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) {
          if (++invalid > 3) ws.close(4002, 'invalid payload');
          throw new RoomError('invalid', '消息格式不正确');
        }
        const msg = parsed.data;
        if (msg.type === 'ping') {
          rooms.send(ws, { type: 'pong', sentAt: msg.sentAt });
          return;
        }
        if (msg.type === 'create' || msg.type === 'join') {
          if (room && seat) rooms.disconnect(room, seat, ws, true);
          const result =
            msg.type === 'create'
              ? rooms.create(msg.name, ws)
              : rooms.join(msg.invite, msg.name, ws, msg.resume);
          room = result.room;
          seat = result.seat;
          clearTimeout(authTimeout);
          rooms.send(ws, {
            type: 'welcome',
            memberId: seat.id,
            resume: seat.resume,
            room: rooms.snapshot(room),
          });
          rooms.broadcast(room);
          return;
        }
        if (!room || !seat) throw new RoomError('not_in_room', '请先加入房间');
        if (msg.type === 'leave') {
          rooms.disconnect(room, seat, ws, true);
          room = null;
          seat = null;
          return;
        }
        rooms.act(room, seat, msg);
      } catch (e) {
        rooms.send(ws, {
          type: 'error',
          code: e instanceof RoomError ? e.code : 'invalid',
          message: e instanceof RoomError ? e.message : '无法处理消息',
          ...(room ? { room: rooms.snapshot(room) } : {}),
        });
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      clearInterval(heartbeat);
      if (room && seat) rooms.disconnect(room, seat, ws);
    });
    ws.on('error', () => {});
  });
  const sweeper = setInterval(() => {
    rooms.sweep();
    relay.sweep();
  }, 5000);
  sweeper.unref();
  const close = async () => {
    clearInterval(sweeper);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { server, rooms, relay, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 8787);
  app.server.listen(port, process.env.HOST ?? '0.0.0.0', () =>
    console.log(`VideoSreeeen 0.1.0 listening on ${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
