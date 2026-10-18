import {
  RELAY_MIMES,
  readRelayPacket,
  RELAY_WINDOW,
  RELAY_VIEWERS,
  type RelayHello,
  type RelayStart,
} from '../shared/broadcast-relay';
import type { Rooms } from './rooms';
import { z } from 'zod';

const relayHello = z.object({
  type: z.literal('hello'),
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  member: z.string().uuid(),
  secret: z.string().min(1).max(100),
  media: z.string().min(1).max(100),
  epoch: z.number().int().nonnegative(),
  formats: z.array(z.enum(RELAY_MIMES)).min(1).max(RELAY_MIMES.length),
});
const relayStart = z.object({
  type: z.literal('start'),
  session: z.string().regex(/^[0-9a-f]{32}$/),
  mime: z.enum(RELAY_MIMES),
});

export interface RelaySocket {
  readyState: number;
  bufferedAmount?: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}
interface Client {
  auth?: RelayHello;
  opened: number;
  seen: number;
  pending: Map<number, number>;
  bytes: number;
  ack: number;
  tokens: number;
  tick: number;
  controls: number;
  controlTick: number;
}
interface Stream {
  publisher: RelaySocket;
  start: RelayStart;
  sequence: number;
}

/** Ephemeral live bytes only: no files, media persistence, or room-state writes. */
export class BroadcastRelay {
  private clients = new Map<RelaySocket, Client>();
  private streams = new Map<string, Stream>();
  constructor(
    private rooms: Rooms,
    private now = () => Date.now(),
  ) {}
  connect(socket: RelaySocket, auth?: RelayHello) {
    if (this.clients.has(socket)) return;
    const now = this.now();
    this.clients.set(socket, {
      auth,
      opened: now,
      seen: now,
      pending: new Map(),
      bytes: 0,
      ack: -1,
      tokens: 1024 * 1024,
      tick: now,
      controls: 40,
      controlTick: now,
    });
  }
  restored() {
    for (const [socket, client] of this.clients)
      if (client.auth && this.access(client.auth)?.publisher) this.need(socket, client.auth);
  }
  private access(auth: RelayHello) {
    const access = this.rooms.memberAccess(auth.code, auth.member, auth.secret);
    const room = access?.room;
    if (
      !room ||
      room.mode !== 'stream' ||
      room.cleaned ||
      room.media?.id !== auth.media ||
      room.epoch !== auth.epoch ||
      !room.media.broadcast
    )
      return null;
    if (!room.members.get(room.media.broadcast.host)?.online) return null;
    return { publisher: room.media.broadcast.host === auth.member };
  }
  private viewers(auth: RelayHello) {
    return [...this.clients].filter(
      ([, c]) =>
        c.auth?.code === auth.code &&
        c.auth.media === auth.media &&
        c.auth.epoch === auth.epoch &&
        this.access(c.auth)?.publisher === false,
    );
  }
  private send(socket: RelaySocket, data: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(data));
  }
  private need(socket: RelaySocket, auth: RelayHello) {
    const viewers = this.viewers(auth);
    this.send(socket, { type: 'need', formats: viewers.map(([, c]) => c.auth!.formats) });
  }
  private refresh(auth: RelayHello) {
    for (const [socket, c] of this.clients)
      if (c.auth?.code === auth.code && this.access(c.auth)?.publisher) this.need(socket, c.auth);
  }
  message(socket: RelaySocket, raw: string | Uint8Array): RelayHello | undefined {
    const c = this.clients.get(socket);
    if (!c) return;
    c.seen = this.now();
    try {
      if (typeof raw === 'string') {
        c.controls = Math.min(40, c.controls + (this.now() - c.controlTick) * 0.02);
        c.controlTick = this.now();
        if (c.controls < 1) throw new Error('media control rate limit');
        c.controls--;
        if (raw.length > 4096) throw new Error('message too large');
        const data = JSON.parse(raw);
        if (!c.auth) {
          const auth = relayHello.parse(data),
            access = this.access(auth);
          if (!access) throw new Error('room authorization expired');
          if (
            [...this.clients.values()].some(
              (other) =>
                other !== c && other.auth?.code === auth.code && other.auth.member === auth.member,
            )
          )
            throw new Error('duplicate media connection');
          if (!access.publisher && this.viewers(auth).length >= RELAY_VIEWERS)
            throw new Error('relay viewer limit');
          c.auth = auth;
          this.send(socket, { type: 'ready', publisher: access.publisher });
          this.refresh(auth);
          return auth;
        }
        const access = this.access(c.auth);
        if (!access) throw new Error('room authorization expired');
        if (data.type === 'ping') this.send(socket, { type: 'pong' });
        else if (data.type === 'start' && access.publisher) {
          const start = relayStart.parse(data);
          const viewers = this.viewers(c.auth);
          if (!viewers.length || viewers.some(([, v]) => !v.auth!.formats.includes(start.mime)))
            throw new Error('unsupported media format');
          this.streams.set(c.auth.code, { publisher: socket, start, sequence: 0 });
          for (const [viewer, v] of viewers) {
            v.pending.clear();
            v.bytes = 0;
            v.ack = -1;
            this.send(viewer, start);
          }
        } else if (data.type === 'ack' && !access.publisher) {
          const stream = this.streams.get(c.auth.code);
          if (
            !stream ||
            stream.start.session !== data.session ||
            !Number.isInteger(data.sequence) ||
            data.sequence < c.ack ||
            data.sequence >= stream.sequence
          )
            return;
          for (const [sequence, bytes] of c.pending)
            if (sequence <= data.sequence) {
              c.pending.delete(sequence);
              c.bytes -= bytes;
            }
          c.ack = data.sequence;
        } else if (data.type === 'restart' && !access.publisher) this.refresh(c.auth);
        else throw new Error('unexpected media message');
      } else {
        if (!c.auth || !this.access(c.auth)?.publisher) throw new Error('not a media publisher');
        const packet = readRelayPacket(raw);
        if (!packet) throw new Error('invalid media packet');
        const stream = this.streams.get(c.auth.code);
        if (!stream) {
          this.need(socket, c.auth);
          return;
        }
        if (stream.publisher !== socket || packet.session !== stream.start.session) return; // Old asynchronous encoder output.
        if (packet.sequence !== stream.sequence) throw new Error('media sequence gap');
        c.tokens = Math.min(1024 * 1024, c.tokens + (this.now() - c.tick) * 256);
        c.tick = this.now();
        c.tokens -= raw.byteLength;
        if (c.tokens < 0) throw new Error('media bitrate limit');
        stream.sequence++;
        for (const [viewer, v] of this.viewers(c.auth)) {
          if (
            v.bytes + raw.byteLength > RELAY_WINDOW ||
            (viewer.bufferedAmount ?? 0) > RELAY_WINDOW
          ) {
            this.drop(viewer, 'slow media receiver');
            continue;
          }
          v.pending.set(packet.sequence, raw.byteLength);
          v.bytes += raw.byteLength;
          if (viewer.readyState === 1) viewer.send(raw);
        }
      }
    } catch {
      this.drop(socket, 'media channel unavailable');
    }
    return c.auth;
  }
  close(socket: RelaySocket) {
    const c = this.clients.get(socket);
    this.clients.delete(socket);
    if (!c?.auth) return;
    const stream = this.streams.get(c.auth.code);
    if (stream?.publisher === socket) {
      this.streams.delete(c.auth.code);
      for (const [viewer] of this.viewers(c.auth)) this.send(viewer, { type: 'end' });
    } else this.refresh(c.auth);
  }
  private drop(socket: RelaySocket, reason: string) {
    this.close(socket);
    socket.close(4003, reason);
  }
  sweep() {
    for (const [socket, c] of this.clients)
      if ((c.auth && !this.access(c.auth)) || this.now() - c.seen > (c.auth ? 30000 : 10000))
        this.drop(socket, 'media session expired');
  }
}
