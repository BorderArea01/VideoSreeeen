import { z } from 'zod';
import { readVoicePacket, uuidBytes, VOICE_LIMIT, type VoiceHello } from '../shared/voice';
import type { Rooms } from './rooms';
import type { RelaySocket } from './broadcast-relay';
const hello = z.object({
  type: z.literal('hello'),
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  member: z.string().uuid(),
  secret: z.string().min(1).max(100),
  session: z.string().uuid(),
  opus: z.boolean(),
});
interface Client {
  auth?: VoiceHello;
  muted: boolean;
  seen: number;
  tick: number;
  tokens: number;
  sequence: number;
  delivery: number;
  ack: number;
  pending: Map<number, { at: number; bytes: number }>;
  bytes: number;
  controls: number;
  controlTick: number;
  frames: number;
}
/** Live, room-authorized fanout. No audio is saved or mixed into the room protocol. */
export class VoiceRelay {
  private clients = new Map<RelaySocket, Client>();
  constructor(
    private rooms: Rooms,
    private now = () => Date.now(),
  ) {}
  connect(socket: RelaySocket) {
    if (!this.clients.has(socket))
      this.clients.set(socket, {
        muted: true,
        seen: this.now(),
        tick: this.now(),
        tokens: 65536,
        sequence: -1,
        delivery: 0,
        ack: -1,
        pending: new Map(),
        bytes: 0,
        controls: 30,
        controlTick: this.now(),
        frames: 100,
      });
  }
  private valid(c: Client) {
    return c.auth && this.rooms.memberAccess(c.auth.code, c.auth.member, c.auth.secret);
  }
  private group(code: string) {
    return [...this.clients].filter(
      ([s, c]) => s.readyState === 1 && c.auth?.code === code && this.valid(c),
    );
  }
  private send(s: RelaySocket, data: unknown) {
    if (s.readyState === 1) s.send(JSON.stringify(data));
  }
  private roster(code: string) {
    const group = this.group(code),
      codec = group.every(([, c]) => c.auth!.opus) ? 'opus' : 'mulaw16';
    const peers = group.map(([, c]) => ({
      id: c.auth!.member,
      session: c.auth!.session,
      muted: c.muted,
    }));
    for (const [s] of group) this.send(s, { type: 'roster', codec, peers });
  }
  private fail(s: RelaySocket, reason: string, code = 4002) {
    s.close(code, reason);
    this.close(s);
  }
  message(socket: RelaySocket, raw: string | Uint8Array) {
    const c = this.clients.get(socket);
    if (!c) return;
    const now = this.now();
    c.seen = now;
    if (typeof raw === 'string') {
      c.controls = Math.min(30, c.controls + (now - c.controlTick) * 0.012);
      c.controlTick = now;
      if (raw.length > 1024 || --c.controls < 0) return this.fail(socket, 'voice rate limit');
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'hello' && !c.auth) {
          const auth = hello.parse(msg);
          if (!this.rooms.memberAccess(auth.code, auth.member, auth.secret))
            return this.fail(socket, 'voice denied', 4003);
          for (const [s, old] of this.clients)
            if (s !== socket && old.auth?.code === auth.code && old.auth.member === auth.member)
              this.fail(s, 'voice replaced', 4001);
          if (this.group(auth.code).length >= VOICE_LIMIT)
            return this.fail(socket, 'voice full', 4009);
          c.auth = auth;
          this.roster(auth.code);
          return;
        }
        if (!this.valid(c)) return this.fail(socket, 'voice membership expired', 4003);
        if (msg.type === 'mute' && typeof msg.muted === 'boolean') {
          c.muted = msg.muted;
          this.roster(c.auth!.code);
        } else if (
          msg.type === 'ack' &&
          Number.isInteger(msg.sequence) &&
          msg.sequence >= c.ack &&
          msg.sequence < c.delivery
        ) {
          c.ack = msg.sequence;
          for (const [id, p] of c.pending)
            if (id <= c.ack) {
              c.bytes -= p.bytes;
              c.pending.delete(id);
            }
        } else if (msg.type === 'ping') this.send(socket, { type: 'pong' });
        else return this.fail(socket, 'invalid voice control');
      } catch {
        this.fail(socket, 'invalid voice control');
      }
      return;
    }
    if (!this.valid(c) || c.muted) return this.fail(socket, 'voice not enabled', 4003);
    const packet = readVoicePacket(raw);
    c.tokens = Math.min(65536, c.tokens + (now - c.tick) * 32);
    c.frames = Math.min(100, c.frames + (now - c.tick) * 0.055);
    c.tick = now;
    if (
      !packet ||
      (c.tokens -= raw.length + 128) < 0 ||
      (c.frames -= packet.frames.length) < 0 ||
      packet.session !== c.auth!.session ||
      packet.sequence <= c.sequence
    )
      return this.fail(socket, 'invalid voice packet');
    c.sequence = packet.sequence + packet.frames.length - 1;
    const group = this.group(c.auth!.code);
    const codec = group.every(([, other]) => other.auth!.opus) ? 'opus' : 'mulaw16';
    if (packet.codec !== codec) return; // Frames already encoded during a roster change are obsolete.
    for (const [s, receiver] of group) {
      if (s === socket) continue;
      const oldest = receiver.pending.values().next().value;
      if (
        receiver.bytes > 65536 ||
        receiver.pending.size >= 64 ||
        (s.bufferedAmount ?? 0) > 65536 ||
        (oldest && now - oldest.at > 1800)
      ) {
        this.fail(s, 'voice receiver too slow', 4001);
        continue;
      }
      const out = new Uint8Array(raw.length + 20),
        id = receiver.delivery++;
      new DataView(out.buffer).setUint32(0, id);
      out.set(uuidBytes(c.auth!.member), 4);
      out.set(raw, 20);
      receiver.pending.set(id, { at: now, bytes: out.length });
      receiver.bytes += out.length;
      s.send(out);
    }
  }
  close(socket: RelaySocket) {
    const code = this.clients.get(socket)?.auth?.code;
    this.clients.delete(socket);
    if (code) this.roster(code);
  }
  sweep() {
    for (const [s, c] of this.clients)
      if ((c.auth && !this.valid(c)) || this.now() - c.seen > 15000)
        this.fail(s, 'voice expired', 4003);
  }
}
