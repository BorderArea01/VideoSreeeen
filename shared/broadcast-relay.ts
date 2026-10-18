// A separate, bounded live-media channel. Room/chat sockets never carry video.
export const RELAY_PACKET = 64 * 1024;
export const RELAY_WINDOW = 2 * 1024 * 1024;
export const RELAY_VIDEO_BITRATE = 4_500_000;
export const RELAY_AUDIO_BITRATE = 128_000;
export const RELAY_CHUNK_MS = 200;
export const RELAY_VIEWERS = 4;
export const RELAY_MIMES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
] as const;
export type RelayMime = (typeof RELAY_MIMES)[number];
export interface RelayHello {
  type: 'hello';
  code: string;
  member: string;
  secret: string;
  media: string;
  epoch: number;
  formats: RelayMime[];
}
export interface RelayStart {
  type: 'start';
  session: string;
  mime: RelayMime;
}
export function relayPacket(session: string, sequence: number, bytes: Uint8Array) {
  const packet = new Uint8Array(20 + bytes.byteLength);
  for (let i = 0; i < 16; i++) packet[i] = parseInt(session.slice(i * 2, i * 2 + 2), 16);
  new DataView(packet.buffer).setUint32(16, sequence);
  packet.set(bytes, 20);
  return packet;
}
export function readRelayPacket(packet: Uint8Array) {
  if (packet.byteLength <= 20 || packet.byteLength > RELAY_PACKET + 20) return null;
  const session = [...packet.subarray(0, 16)].map((n) => n.toString(16).padStart(2, '0')).join('');
  const sequence = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(16);
  return { session, sequence, bytes: packet.subarray(20) };
}
