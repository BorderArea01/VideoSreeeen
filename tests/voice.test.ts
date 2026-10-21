import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VoiceRelay } from '../server/voice';
import { Rooms } from '../server/rooms';
import {
  bytesUuid,
  voicePacket,
  readVoicePacket,
  encodeVoicePcm,
  decodeVoicePcm,
} from '../shared/voice';
import { VoiceBuffer } from '../client/voice-buffer';
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages: any[] = [];
  send(raw: string | Uint8Array) {
    this.messages.push(typeof raw === 'string' ? JSON.parse(raw) : raw.slice());
  }
  close() {
    this.readyState = 3;
  }
}
function fixture() {
  let now = 1000;
  const rooms = new Rooms(() => now),
    hub = new VoiceRelay(rooms, () => now);
  const { room, seat } = rooms.create('host', new Socket());
  const connect = (member = seat, opus = true) => {
    const s = new Socket(),
      auth = {
        type: 'hello',
        code: room.code,
        member: member.id,
        secret: member.resume,
        session: randomUUID(),
        opus,
      };
    hub.connect(s);
    hub.message(s, JSON.stringify(auth));
    return {
      s,
      auth,
      enable: () => hub.message(s, JSON.stringify({ type: 'mute', muted: false })),
      packet: (seq: number, codec: 'opus' | 'mulaw16' = 'opus') =>
        voicePacket(auth.session, seq, codec, [
          codec === 'opus' ? new Uint8Array([1, 2, 3]) : new Uint8Array(320),
        ]),
    };
  };
  const guest = () => rooms.join(`${room.code}:${room.token}`, 'guest', new Socket()).seat;
  return { rooms, room, seat, hub, connect, guest, advance: (ms: number) => (now += ms) };
}
test('voice authenticates, cannot impersonate sender or enter another room, never changes playback', () => {
  const f = fixture(),
    host = f.connect(),
    guest = f.connect(f.guest()),
    revision = f.room.revision;
  host.enable();
  f.hub.message(host.s, host.packet(0));
  const out = guest.s.messages.at(-1) as Uint8Array;
  assert.equal(bytesUuid(out.subarray(4, 20)), f.seat.id);
  assert.equal(readVoicePacket(out.subarray(20))?.sequence, 0);
  assert.equal(f.room.revision, revision);
  assert.equal(f.room.chat.length, 0);
  const bad = new Socket();
  f.hub.connect(bad);
  f.hub.message(bad, JSON.stringify({ ...host.auth, secret: 'wrong' }));
  assert.equal(bad.readyState, 3);
  const otherRoom = f.rooms.create('other room', new Socket()).room;
  const wrongRoom = new Socket();
  f.hub.connect(wrongRoom);
  f.hub.message(wrongRoom, JSON.stringify({ ...host.auth, code: otherRoom.code }));
  assert.equal(wrongRoom.readyState, 3, 'Membership credentials cannot cross rooms');
  f.hub.message(host.s, host.packet(0));
  assert.equal(host.s.readyState, 3, 'replay refused');
});
test('voice defaults muted; revocation and simultaneous eight-member limit', () => {
  const f = fixture(),
    host = f.connect();
  f.hub.message(host.s, host.packet(0));
  assert.equal(host.s.readyState, 3);
  const active = f.connect();
  active.enable();
  for (let i = 0; i < 7; i++) assert.equal(f.connect(f.guest()).s.readyState, 1);
  assert.equal(f.connect(f.guest()).s.readyState, 3);
  f.rooms.disconnect(f.room, f.seat, f.seat.socket!, true);
  f.hub.sweep();
  assert.equal(active.s.readyState, 3);
});
test('one slow receiver is removed without delaying other voice members; ACK bounds', () => {
  const f = fixture(),
    host = f.connect(),
    slow = f.connect(f.guest()),
    healthy = f.connect(f.guest());
  host.enable();
  for (let i = 0; i < 75; i++) {
    f.advance(20);
    f.hub.message(host.s, host.packet(i));
    const packet = healthy.s.messages.at(-1);
    if (packet instanceof Uint8Array && i % 10 === 0)
      f.hub.message(
        healthy.s,
        JSON.stringify({ type: 'ack', sequence: new DataView(packet.buffer).getUint32(0) }),
      );
  }
  assert.equal(slow.s.readyState, 3);
  assert.equal(healthy.s.readyState, 1);
  assert.equal(host.s.readyState, 1);
});
test('voice compatibility negotiation changes back, bounded payload and source rate', () => {
  const f = fixture(),
    host = f.connect(),
    guest = f.connect(f.guest(), false);
  host.enable();
  assert.equal(host.s.messages.at(-1).codec, 'mulaw16');
  f.hub.message(host.s, host.packet(0, 'mulaw16'));
  assert.ok(guest.s.messages.at(-1) instanceof Uint8Array);
  f.hub.close(guest.s);
  assert.equal(host.s.messages.at(-1).codec, 'opus');
  for (let i = 1; i < 150; i++) f.hub.message(host.s, host.packet(i));
  assert.equal(host.s.readyState, 3);
  assert.equal(readVoicePacket(new Uint8Array(4097)), null);
  const p = voicePacket(randomUUID(), 0, 'opus', [new Uint8Array([1])]);
  p[21] = 5;
  assert.equal(readVoicePacket(p), null);
});
test('16kHz compatibility audio retains signal and handles silence with bounded frames', () => {
  const pcm = Float32Array.from(
    { length: 960 },
    (_, i) => 0.2 * Math.sin((i * 2 * Math.PI * 440) / 48000),
  );
  const decoded = decodeVoicePcm(encodeVoicePcm(pcm));
  const error = Math.sqrt(decoded.reduce((sum, x, i) => sum + (x - pcm[i]) ** 2, 0) / 960);
  assert.ok(error < 0.02, String(error));
});
test('jitter buffer holds short gaps without skipping samples and bounds long outage', () => {
  const buffer = new VoiceBuffer(),
    frame = new Float32Array(960).fill(0.1);
  for (let i = 0; i < 8; i++) buffer.push(i, frame, i * 0.02);
  for (let i = 0; i < 80; i++) buffer.render(new Float32Array(128));
  const played = buffer.played;
  assert.ok(buffer.underruns > 0);
  for (let i = 8; i < 16; i++) buffer.push(i, frame, 0.3 + (i - 8) * 0.02);
  for (let i = 0; i < 160; i++) buffer.render(new Float32Array(128));
  assert.ok(buffer.played > played + 6000);
  assert.equal(buffer.resets, 0, 'brief gap preserves queued speech');
  for (let i = 100; i < 180; i++) buffer.push(i, frame, 3 + (i - 100) * 0.02);
  assert.ok(buffer.queuedMs <= 1000);
  assert.ok(buffer.resets > 0);
});
