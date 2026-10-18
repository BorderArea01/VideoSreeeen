import { BLOCK_SIZE, MAX_CACHE } from '../shared/cache-plan';
import type { ClientMessage, ServerMessage, Snapshot } from '../shared/protocol';

export const hexDigest = async (data: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
export const encode = (data: Uint8Array) => {
  let s = '';
  for (let i = 0; i < data.length; i += 8192)
    s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
};
export const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export interface FileInfo {
  name: string;
  size: number;
}
interface Have {
  file: number;
  offset: number;
  hash: string;
}
interface Pending {
  id: string;
  file: number;
  offset: number;
  hash: string;
  parts: string[];
  size: number;
  resolve: (data: Uint8Array | null) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Peer {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  have: Map<string, string>;
  key: string;
  pending?: Pending;
  candidates: RTCIceCandidateInit[];
  signals: Promise<void>;
  uploads: number;
  sending: Promise<void>;
}
const keyOf = (file: number, offset: number) => `${file}:${offset}`;

/** A private, room-scoped swarm. It never announces files to public trackers. */
export class RoomPeers {
  private peers = new Map<string, Peer>();
  private scope = '';
  private room: Snapshot | null = null;
  private me = '';
  private planKey = '';
  private files: FileInfo[] = [];
  private inventory = new Map<string, Have>();
  private read: ((file: number, offset: number) => Promise<Uint8Array>) | null = null;
  private configs: RTCIceServer[] = [];
  private enabled = false;
  private manifests = new Map<string, FileInfo[]>();
  uploaded = 0;
  constructor(private send: (message: ClientMessage) => boolean) {}
  setIceServers(servers: RTCIceServer[], enabled = true) {
    this.configs = servers;
    this.enabled = enabled;
    if (!enabled) this.close();
  }
  configure(room: Snapshot | null, me: string) {
    const scope =
      room?.mode === 'cache' && !room.finished && room.media
        ? `${room.media.id}:${room.epoch}`
        : '';
    if (scope !== this.scope || me !== this.me) {
      this.close();
      this.scope = scope;
      this.me = me;
    }
    this.room = room;
    if (!scope || !this.enabled || typeof RTCPeerConnection === 'undefined') return;
    const online = room!.members.filter((m) => m.online && m.id !== me).map((m) => m.id);
    for (const [id, p] of this.peers)
      if (!online.includes(id)) {
        this.dispose(p);
        this.peers.delete(id);
      }
    for (const id of online)
      if (!this.peers.has(id)) {
        const peer = this.create(id);
        if (me < id) {
          this.attach(id, peer, peer.pc.createDataChannel('cache', { ordered: true }));
          peer.signals = peer.pc
            .createOffer()
            .then(async (offer) => {
              await peer.pc.setLocalDescription(offer);
              this.signal(id, peer, { kind: 'description', type: 'offer', sdp: offer.sdp! });
            })
            .catch(() => this.dispose(peer));
        }
      }
  }
  private create(id: string) {
    const pc = new RTCPeerConnection({ iceServers: this.configs });
    const peer: Peer = {
      pc,
      have: new Map(),
      key: '',
      candidates: [],
      signals: Promise.resolve(),
      uploads: 0,
      sending: Promise.resolve(),
    };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.signal(id, peer, {
          kind: 'candidate',
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        });
    };
    pc.ondatachannel = (e) => {
      if (this.me > id && !peer.channel) this.attach(id, peer, e.channel);
      else e.channel.close();
    };
    pc.onconnectionstatechange = () => {
      if (['closed', 'failed'].includes(pc.connectionState)) this.dispose(peer);
    };
    return peer;
  }
  private signal(to: string, peer: Peer, data: Extract<ClientMessage, { type: 'signal' }>['data']) {
    if (this.room?.media && this.scope && this.peers.get(to) === peer)
      this.send({ type: 'signal', to, mediaId: this.room.media.id, epoch: this.room.epoch, data });
  }
  receive(message: Extract<ServerMessage, { type: 'signal' }>) {
    if (message.purpose === 'broadcast') return;
    if (!this.enabled) return;
    if (
      !this.room?.media ||
      message.mediaId !== this.room.media.id ||
      message.epoch !== this.room.epoch ||
      !this.scope ||
      !this.room.members.some((m) => m.online && m.id === message.from)
    )
      return;
    const peer = this.peers.get(message.from) ?? this.create(message.from);
    peer.signals = peer.signals
      .then(async () => {
        if (this.peers.get(message.from) !== peer) return;
        const d = message.data;
        if (d.kind === 'candidate') {
          const c = { candidate: d.candidate, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex };
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(c);
          else if (peer.candidates.length < 64) peer.candidates.push(c);
        } else {
          if ((d.type === 'offer') !== this.me > message.from) return;
          await peer.pc.setRemoteDescription({ type: d.type, sdp: d.sdp });
          for (const c of peer.candidates.splice(0)) await peer.pc.addIceCandidate(c);
          if (d.type === 'offer') {
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            this.signal(message.from, peer, {
              kind: 'description',
              type: 'answer',
              sdp: answer.sdp!,
            });
          }
        }
      })
      .catch(() => this.dispose(peer));
  }
  private attach(_id: string, p: Peer, channel: RTCDataChannel) {
    p.channel = channel;
    channel.onopen = () => this.hello(p);
    channel.onclose = () => this.resolve(p, null);
    channel.onerror = () => this.resolve(p, null);
    channel.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 32000) {
        channel.close();
        return;
      }
      try {
        this.message(p, JSON.parse(e.data));
      } catch {
        channel.close();
      }
    };
  }
  private emit(p: Peer, value: unknown) {
    if (p.channel?.readyState === 'open' && p.channel.bufferedAmount < 512 * 1024) {
      p.channel.send(JSON.stringify(value));
      return true;
    }
    return false;
  }
  private hello(p: Peer, reply = false) {
    if (!this.planKey) return;
    this.emit(p, { type: 'hello', key: this.planKey, files: this.files, reply });
    const have = [...this.inventory.values()];
    for (let i = 0; i < have.length; i += 64) {
      const batch = have.slice(i, i + 64);
      p.sending = p.sending
        .then(async () => {
          await this.drain(p);
          this.emit(p, { type: 'have', key: this.planKey, blocks: batch });
        })
        .catch(() => {});
    }
  }
  private message(p: Peer, m: any) {
    if (m.type === 'hello') {
      if (
        typeof m.key !== 'string' ||
        !/^[a-f0-9]{64}$/.test(m.key) ||
        !Array.isArray(m.files) ||
        m.files.length < 1 ||
        m.files.length > 2 ||
        m.files.some(
          (f: any) =>
            typeof f.name !== 'string' ||
            f.name.length > 81 ||
            !Number.isSafeInteger(f.size) ||
            f.size < 1,
        ) ||
        m.files.reduce((n: number, f: any) => n + f.size, 0) > MAX_CACHE
      )
        return;
      p.key = m.key;
      p.have.clear();
      if (!this.manifests.has(m.key) && this.manifests.size >= 16)
        this.manifests.delete(this.manifests.keys().next().value!);
      this.manifests.set(m.key, m.files);
      if (!m.reply) this.hello(p, true);
      return;
    }
    if (m.type === 'reset') {
      p.have.clear();
      return;
    }
    if (!this.planKey || m.key !== this.planKey || p.key !== this.planKey || !this.read) return;
    if (m.type === 'have' && Array.isArray(m.blocks) && m.blocks.length <= 64) {
      for (const h of m.blocks)
        if (
          this.validBlock(h.file, h.offset) &&
          typeof h.hash === 'string' &&
          /^[a-f0-9]{64}$/.test(h.hash)
        )
          p.have.set(keyOf(h.file, h.offset), h.hash);
    } else if (
      m.type === 'get' &&
      typeof m.id === 'string' &&
      m.id.length <= 40 &&
      this.validBlock(m.file, m.offset) &&
      p.uploads < 2
    ) {
      const h = this.inventory.get(keyOf(m.file, m.offset));
      if (!h) {
        this.emit(p, { type: 'miss', key: this.planKey, id: m.id });
        return;
      }
      const read = this.read,
        planKey = this.planKey;
      p.uploads++;
      p.sending = p.sending
        .then(async () => {
          const data = await read(m.file, m.offset);
          if (planKey !== this.planKey || data.length !== this.length(m.file, m.offset)) return;
          for (let i = 0; i < data.length; i += 12 * 1024) {
            await this.drain(p);
            if (
              !this.emit(p, {
                type: 'part',
                key: planKey,
                id: m.id,
                data: encode(data.subarray(i, i + 12 * 1024)),
              })
            )
              return;
          }
          await this.drain(p);
          this.emit(p, { type: 'end', key: planKey, id: m.id, hash: h.hash });
          this.uploaded += data.length;
        })
        .catch(() => {
          this.emit(p, { type: 'miss', key: planKey, id: m.id });
        })
        .finally(() => {
          p.uploads--;
        });
    } else if (p.pending && m.id === p.pending.id) {
      const pending = p.pending;
      if (
        m.type === 'part' &&
        typeof m.data === 'string' &&
        m.data.length > 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(m.data)
      ) {
        pending.size += m.data.length;
        if (pending.size > Math.ceil(BLOCK_SIZE / 3) * 4 + 128 || pending.parts.length >= 24) {
          this.resolve(p, null);
          return;
        }
        pending.parts.push(m.data);
      } else if (m.type === 'miss') this.resolve(p, null);
      else if (m.type === 'end') {
        // Decode each frame separately: every frame may contain base64 padding.
        const parts = pending.parts.map(decode),
          size = parts.reduce((n, v) => n + v.length, 0);
        if (size !== this.length(pending.file, pending.offset) || m.hash !== pending.hash) {
          this.resolve(p, null);
          return;
        }
        const data = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          data.set(part, offset);
          offset += part.length;
        }
        void hexDigest(data)
          .then((hash) => {
            if (p.pending === pending) this.resolve(p, hash === pending.hash ? data : null);
          })
          .catch(() => this.resolve(p, null));
      }
    }
  }
  private validBlock(file: number, offset: number) {
    return (
      Number.isInteger(file) &&
      file >= 0 &&
      file < this.files.length &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      offset % BLOCK_SIZE === 0 &&
      offset < this.files[file]!.size
    );
  }
  private length(file: number, offset: number) {
    return Math.min(BLOCK_SIZE, this.files[file]!.size - offset);
  }
  private async drain(p: Peer) {
    const until = Date.now() + 5000;
    while (
      p.channel?.readyState === 'open' &&
      p.channel.bufferedAmount > 128 * 1024 &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 20));
    if (p.channel?.readyState !== 'open' || p.channel.bufferedAmount > 128 * 1024)
      throw new Error('成员传输中断');
  }
  private resolve(p: Peer, data: Uint8Array | null) {
    if (p.pending) {
      const pending = p.pending;
      p.pending = undefined;
      clearTimeout(pending.timer);
      pending.resolve(data);
    }
  }
  async start(files: FileInfo[], read: (file: number, offset: number) => Promise<Uint8Array>) {
    this.inventory.clear();
    this.files = files;
    this.read = read;
    this.planKey = await hexDigest(new TextEncoder().encode(JSON.stringify(files)));
    for (const p of this.peers.values()) this.hello(p);
  }
  async suggestedFiles(names: string[], wait = 800): Promise<FileInfo[] | null> {
    if (!this.enabled) return null;
    const until = Date.now() + wait;
    do {
      for (const files of this.manifests.values())
        if (JSON.stringify(files.map((f) => f.name)) === JSON.stringify(names)) return files;
      await new Promise((r) => setTimeout(r, 80));
    } while (Date.now() < until && this.scope);
    return null;
  }
  announce(file: number, offset: number, hash: string) {
    const h = { file, offset, hash };
    this.inventory.set(keyOf(file, offset), h);
    for (const p of this.peers.values())
      this.emit(p, { type: 'have', key: this.planKey, blocks: [h] });
  }
  async get(file: number, offset: number, wait = 0): Promise<Uint8Array | null> {
    if (!this.enabled) return null;
    const scope = this.scope,
      until = Date.now() + wait;
    do {
      for (const p of this.peers.values()) {
        const hash = p.have.get(keyOf(file, offset));
        if (!hash || p.pending || p.channel?.readyState !== 'open') continue;
        const data = await new Promise<Uint8Array | null>((resolve) => {
          const id = crypto.randomUUID();
          const timer = setTimeout(() => this.resolve(p, null), 5000);
          p.pending = { id, file, offset, hash, parts: [], size: 0, resolve, timer };
          if (!this.emit(p, { type: 'get', key: this.planKey, id, file, offset }))
            this.resolve(p, null);
        });
        if (data) return data;
        p.have.delete(keyOf(file, offset));
      }
      if (Date.now() >= until) break;
      await new Promise((r) => setTimeout(r, 80));
    } while (scope === this.scope);
    return null;
  }
  distribution() {
    const ids = (
      this.room?.members
        .filter((m) => m.online && ['downloading', 'ready'].includes(m.cache.state))
        .map((m) => m.id) ?? [this.me]
    ).sort();
    return { index: Math.max(0, ids.indexOf(this.me)), count: Math.max(1, ids.length) };
  }
  resetCache() {
    for (const p of this.peers.values()) {
      this.emit(p, { type: 'reset' });
      this.resolve(p, null);
    }
    this.read = null;
    this.inventory.clear();
    this.files = [];
    this.planKey = '';
  }
  private dispose(p: Peer) {
    this.resolve(p, null);
    p.channel?.close();
    p.pc.close();
  }
  close() {
    for (const p of this.peers.values()) this.dispose(p);
    this.peers.clear();
    this.resetCache();
    this.manifests.clear();
    this.scope = '';
    this.room = null;
  }
}
