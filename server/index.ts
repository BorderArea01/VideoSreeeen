import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientMessageSchema } from '../shared/protocol';
import { RoomError, Rooms, type Room } from './rooms';
import { RoomImages, IMAGE_LIMIT } from './images';
import { ImageFiles } from './image-files';
import { once } from 'node:events';
import { MediaRelay } from './media';
import { BroadcastRelay } from './broadcast-relay';
import { VoiceRelay } from './voice';
import { RoomSources } from './site-source';
import { fetchSiteMetadata } from './site-fetch';
import { startProbe, finishProbe, type ProbeState } from './latency';
export function createApp(
  options: {
    now?: () => number;
    origins?: string[];
    broadcastRelay?: boolean;
  } = {},
) {
  const rooms = new Rooms(options.now);
  const imageFiles = new ImageFiles(),
    images = new RoomImages(rooms, imageFiles);
  const relay = new MediaRelay(rooms);
  const broadcastRelay = new BroadcastRelay(rooms);
  const voice = new VoiceRelay(rooms);
  const sources = new RoomSources(rooms, fetchSiteMetadata);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range,Authorization,X-Member-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (
      !['GET', 'HEAD'].includes(req.method ?? '') &&
      !(
        req.method === 'POST' &&
        (req.url?.startsWith('/images/') || req.url?.startsWith('/resolve-source/'))
      )
    ) {
      res.writeHead(405).end();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/resolve-source/')) {
        if (
          url.pathname.startsWith('/resolve-source/') &&
          Number(req.headers['content-length']) > 4096
        ) {
          req.resume();
          res.writeHead(413).end('识别请求过大');
          return;
        }
        if (req.method === 'POST' && Number(req.headers['content-length']) > IMAGE_LIMIT) {
          req.resume();
          res
            .writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
            .end('图片不能超过 20 MiB');
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (typeof value === 'string') headers.set(key, value);
        let drain = () => {};
        const body =
          req.method === 'POST'
            ? new ReadableStream<Uint8Array>(
                {
                  start(controller) {
                    req.pause();
                    const data = (chunk: Buffer) => {
                      controller.enqueue(chunk);
                      req.pause();
                    };
                    const end = () => controller.close(),
                      fail = (e: Error) => controller.error(e);
                    req.on('data', data);
                    req.once('end', end);
                    req.once('error', fail);
                    drain = () => {
                      req.off('data', data);
                      req.off('end', end);
                      req.off('error', fail);
                      if (!req.destroyed) req.resume();
                    };
                  },
                  pull() {
                    req.resume();
                  },
                  cancel() {
                    drain();
                  },
                },
                { highWaterMark: 0 },
              )
            : undefined;
        const controller = new AbortController();
        const aborted = () => controller.abort();
        res.once('close', aborted);
        const request = new Request(url, {
          method: req.method,
          headers,
          signal: controller.signal,
          ...(body ? { body, duplex: 'half' } : {}),
        } as RequestInit);
        let response: Response;
        try {
          response = url.pathname.startsWith('/images/')
            ? await images.handle(request)
            : await sources.handle(request);
        } finally {
          drain();
          res.off('close', aborted);
        }
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        if (response.body)
          for await (const chunk of response.body as any)
            if (!res.write(chunk)) await once(res, 'drain');
        res.end();
        return;
      }
      if (url.pathname === '/config') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            mediaRelay: true,
            broadcastRelay: options.broadcastRelay !== false,
            voice: true,
            p2p: true,
            iceServers: JSON.parse(
              process.env.ICE_SERVERS ?? '[{"urls":"stun:stun.cloudflare.com:3478"}]',
            ),
          }),
        );
        return;
      }
      if (url.pathname === '/healthz') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            app: 'videosreeeen',
            version: '0.4.6',
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
  const mediaSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 65556,
    perMessageDeflate: false,
  });
  const voiceSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (
      !['/ws', '/broadcast-relay', '/voice'].includes(path) ||
      !originAllowed(req.headers.origin, req.headers.host) ||
      (connections.get(ip) ?? 0) >= 32
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const handler =
      path === '/voice' ? voiceSockets : path === '/broadcast-relay' ? mediaSockets : wss;
    handler.handleUpgrade(req, socket, head, (ws) => {
      connections.set(ip, (connections.get(ip) ?? 0) + 1);
      ws.once('close', () => connections.set(ip, Math.max(0, (connections.get(ip) ?? 1) - 1)));
      handler.emit('connection', ws);
    });
  });
  voiceSockets.on('connection', (socket: WebSocket) => {
    voice.connect(socket);
    socket.on('message', (raw, binary) =>
      voice.message(socket, binary ? new Uint8Array(raw as Buffer) : String(raw)),
    );
    socket.on('close', () => voice.close(socket));
    socket.on('error', () => {});
  });
  mediaSockets.on('connection', (socket: WebSocket) => {
    broadcastRelay.connect(socket);
    socket.on('message', (raw, binary) =>
      broadcastRelay.message(socket, binary ? new Uint8Array(raw as Buffer) : String(raw)),
    );
    socket.on('close', () => broadcastRelay.close(socket));
    socket.on('error', () => {});
  });
  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let seat: ReturnType<Rooms['create']>['seat'] | null = null;
    let tokens = 100;
    let tick = Date.now();
    let invalid = 0;
    const probeState: ProbeState = {};
    const probe = () => {
      const nonce = startProbe(probeState, Date.now());
      if (nonce) rooms.send(ws, { type: 'probe', nonce });
    };
    let pong = true;
    const authTimeout = setTimeout(() => {
      if (!seat) ws.close(4000, 'join timeout');
    }, 15000);
    authTimeout.unref();
    ws.on('pong', () => {
      pong = true;
    });
    const heartbeat = setInterval(() => {
      if (!pong) {
        ws.terminate();
        return;
      }
      pong = false;
      ws.ping();
    }, 5000);
    heartbeat.unref();
    ws.on('message', (raw) => {
      const now = Date.now();
      tokens = Math.min(100, tokens + (now - tick) * 0.02);
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
          rooms.send(ws, {
            type: 'pong',
            sentAt: msg.sentAt,
            ...(room ? { clock: rooms.clock(room) } : {}),
          });
          if (room && seat) probe();
          return;
        }
        if (msg.type === 'probe') {
          const elapsed = finishProbe(probeState, msg.nonce, now);
          if (room && seat && elapsed !== null) rooms.recordLatency(room, seat, ws, elapsed);
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
          seat.latencyEvents = msg.capabilities?.includes('latency-v1') === true;
          probeState.nonce = undefined;
          probeState.probeAt = undefined;
          clearTimeout(authTimeout);
          rooms.send(ws, {
            type: 'welcome',
            memberId: seat.id,
            resume: seat.resume,
            room: rooms.snapshot(room),
          });
          rooms.broadcast(room);
          probe();
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
    broadcastRelay.sweep();
    voice.sweep();
    relay.sweep();
    void images.sweep().catch(() => {});
  }, 5000);
  sweeper.unref();
  const close = async () => {
    clearInterval(sweeper);
    for (const ws of wss.clients) ws.terminate();
    for (const ws of mediaSockets.clients) ws.terminate();
    for (const ws of voiceSockets.clients) ws.terminate();
    await new Promise<void>((resolve) => voiceSockets.close(() => resolve()));
    await new Promise<void>((resolve) => mediaSockets.close(() => resolve()));
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await imageFiles.close();
  };
  return { server, rooms, relay, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 8787);
  app.server.listen(port, process.env.HOST ?? '0.0.0.0', () =>
    console.log(`VideoSreeeen 0.4.6 listening on ${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
