export type VoiceCodec = 'opus' | 'mulaw16';
export interface VoiceHello {
  type: 'hello';
  code: string;
  member: string;
  secret: string;
  session: string;
  opus: boolean;
}
export interface VoicePeer {
  id: string;
  session: string;
  muted: boolean;
}
export const VOICE_LIMIT = 8;
export const VOICE_PACKET_MAX = 4096;
export function uuidBytes(id: string) {
  return Uint8Array.from(id.replaceAll('-', '').match(/../g) ?? [], (x) => parseInt(x, 16));
}
export function bytesUuid(bytes: Uint8Array) {
  const h = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// 20 ms frames, batched up to 80 ms. No timestamps or client-selected sender IDs.
export function voicePacket(
  session: string,
  sequence: number,
  codec: VoiceCodec,
  frames: Uint8Array[],
) {
  const out = new Uint8Array(22 + frames.reduce((n, f) => n + 2 + f.length, 0));
  out.set(uuidBytes(session));
  new DataView(out.buffer).setUint32(16, sequence);
  out[20] = codec === 'opus' ? 1 : 2;
  out[21] = frames.length;
  let p = 22;
  for (const frame of frames) {
    new DataView(out.buffer).setUint16(p, frame.length);
    p += 2;
    out.set(frame, p);
    p += frame.length;
  }
  if (!readVoicePacket(out)) throw new Error('Invalid voice frame');
  return out;
}
export function readVoicePacket(bytes: Uint8Array) {
  if (
    bytes.length < 25 ||
    bytes.length > VOICE_PACKET_MAX ||
    ![1, 2].includes(bytes[20]) ||
    bytes[21] < 1 ||
    bytes[21] > 4
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 22;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < bytes[21]; i++) {
    if (p + 2 > bytes.length) return null;
    const n = view.getUint16(p);
    p += 2;
    if (!n || n > 1000 || p + n > bytes.length || (bytes[20] === 2 && n !== 320)) return null;
    frames.push(bytes.subarray(p, p + n));
    p += n;
  }
  if (p !== bytes.length) return null;
  return {
    session: bytesUuid(bytes.subarray(0, 16)),
    sequence: view.getUint32(16),
    codec: (bytes[20] === 1 ? 'opus' : 'mulaw16') as VoiceCodec,
    frames,
  };
}
/** Own logarithmic companding format, 16 kHz mono; not an interoperable G.711 claim. */
export function encodeVoicePcm(samples: Float32Array) {
  const out = new Uint8Array(320);
  for (let i = 0; i < 320; i++) {
    const x = Math.max(
      -1,
      Math.min(1, (samples[i * 3] + samples[i * 3 + 1] + samples[i * 3 + 2]) / 3),
    );
    out[i] = Math.round(
      ((Math.sign(x) * Math.log1p(255 * Math.abs(x))) / Math.log(256) + 1) * 127.5,
    );
  }
  return out;
}
export function decodeVoicePcm(bytes: Uint8Array) {
  const out = new Float32Array(960);
  const sample = (i: number) => {
    const x = bytes[Math.min(319, i)] / 127.5 - 1;
    return (Math.sign(x) * Math.expm1(Math.abs(x) * Math.log(256))) / 255;
  };
  for (let i = 0; i < 320; i++) {
    const a = sample(i),
      b = sample(i + 1);
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a + ((b - a) * j) / 3;
  }
  return out;
}
