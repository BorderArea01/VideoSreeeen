// Retain a bounded WebM initialization segment plus media starting at a
// video keyframe cluster. Parse EBML boundaries, never search encoded bytes.
const MAX = 8 * 1024 * 1024;
function integer(bytes: Uint8Array, at: number, id = false) {
  if (at >= bytes.length || !bytes[at]) return null;
  let width = 1,
    mask = 128;
  while (!(bytes[at] & mask) && width < 8) {
    width++;
    mask >>= 1;
  }
  if ((id && width > 4) || at + width > bytes.length) return null;
  let value = BigInt(id ? bytes[at] : bytes[at] & (mask - 1));
  let unknown = !id && (bytes[at] & (mask - 1)) === mask - 1;
  for (let i = 1; i < width; i++) {
    value = (value << 8n) | BigInt(bytes[at + i]);
    unknown &&= bytes[at + i] === 255;
  }
  return { width, value: Number(value), unknown };
}
function header(bytes: Uint8Array, at: number) {
  const id = integer(bytes, at, true);
  if (!id) return null;
  const size = integer(bytes, at + id.width);
  if (!size) return null;
  return { id: id.value, head: id.width + size.width, size: size.value, unknown: size.unknown };
}
function videoTrack(bytes: Uint8Array) {
  let video = -1;
  for (let at = 0; at < bytes.length;) {
    const entry = header(bytes, at);
    if (!entry || entry.unknown || entry.size > bytes.length - at - entry.head) return video;
    if (entry.id === 0xae) {
      let number = -1,
        type = -1;
      for (let pos = at + entry.head; pos < at + entry.head + entry.size;) {
        const field = header(bytes, pos);
        if (!field || field.unknown || field.size > bytes.length - pos - field.head) break;
        if (field.id === 0xd7 || field.id === 0x83) {
          let value = 0;
          for (const byte of bytes.subarray(pos + field.head, pos + field.head + field.size))
            value = value * 256 + byte;
          if (field.id === 0xd7) number = value;
          else type = value;
        }
        pos += field.head + field.size;
      }
      if (type === 1) video = number;
    }
    at += entry.head + entry.size;
  }
  return video;
}
function groupKeyframe(bytes: Uint8Array, video: number) {
  let track = -1,
    reference = false;
  for (let at = 0; at < bytes.length;) {
    const field = header(bytes, at);
    if (!field || field.unknown || field.size > bytes.length - at - field.head) return false;
    if (field.id === 0xa1) track = integer(bytes, at + field.head)?.value ?? -1;
    if (field.id === 0xfb) reference = true;
    at += field.head + field.size;
  }
  return track === video && !reference;
}
export class WebMWindow {
  private pending = new Uint8Array(0);
  private parsed = 0;
  private received = 0;
  private segment = false;
  private cluster = -1;
  private clusterEnd = Infinity;
  private video = -1;
  private key = -1;
  private init?: Uint8Array;
  private chunks: Array<{ at: number; bytes: Uint8Array }> = [];
  private retained = 0;
  private invalid = false;
  push(bytes: Uint8Array) {
    if (this.invalid) return;
    this.chunks.push({ at: this.received, bytes });
    this.received += bytes.length;
    this.retained += bytes.length;
    const pending = new Uint8Array(this.pending.length + bytes.length);
    pending.set(this.pending);
    pending.set(bytes, this.pending.length);
    this.pending = pending;
    let cursor = 0;
    while (cursor < pending.length) {
      if (this.parsed + cursor >= this.clusterEnd) this.cluster = -1;
      const h = header(pending, cursor);
      if (!h) break;
      const absolute = this.parsed + cursor;
      if (h.id === 0x18538067) {
        this.segment = true;
        cursor += h.head;
        continue;
      }
      if (this.segment && h.id === 0x1f43b675) {
        if (!this.init) {
          if (absolute > 256 * 1024) {
            this.invalid = true;
            break;
          }
          this.init = this.slice(0, absolute);
        }
        this.cluster = absolute;
        this.clusterEnd = h.unknown ? Infinity : absolute + h.head + h.size;
        cursor += h.head;
        continue;
      }
      if (h.unknown || h.size > MAX) {
        this.invalid = true;
        break;
      }
      if (h.head + h.size > pending.length - cursor) break;
      const payload = pending.subarray(cursor + h.head, cursor + h.head + h.size);
      if (this.segment && h.id === 0x1654ae6b) this.video = videoTrack(payload);
      if (this.cluster >= 0 && h.id === 0xa3) {
        const track = integer(payload, 0);
        if (
          track?.value === this.video &&
          payload.length > track.width + 2 &&
          payload[track.width + 2] & 128
        )
          this.key = this.cluster;
      }
      if (this.cluster >= 0 && h.id === 0xa0 && groupKeyframe(payload, this.video))
        this.key = this.cluster;
      cursor += h.head + h.size;
    }
    this.parsed += cursor;
    this.pending = pending.slice(cursor);
    if (this.key >= 0) {
      while (this.chunks.length && this.chunks[0].at + this.chunks[0].bytes.length <= this.key)
        this.retained -= this.chunks.shift()!.bytes.length;
    }
    if (this.retained > MAX || this.pending.length > MAX) {
      this.invalid = true;
      this.chunks = [];
      this.pending = new Uint8Array(0);
    }
  }
  private slice(start: number, end: number) {
    const output = new Uint8Array(end - start);
    let offset = 0;
    for (const chunk of this.chunks) {
      const from = Math.max(start, chunk.at),
        to = Math.min(end, chunk.at + chunk.bytes.length);
      if (to > from) {
        output.set(chunk.bytes.subarray(from - chunk.at, to - chunk.at), offset);
        offset += to - from;
      }
    }
    return output;
  }
  bootstrap() {
    if (this.invalid || !this.init || this.key < 0 || this.key < (this.chunks[0]?.at ?? 0))
      return null;
    return [this.init, this.slice(this.key, this.received)];
  }
  unavailable() {
    return this.invalid;
  }
}
