import type { Snapshot } from '../shared/protocol';
import {
  RELAY_MIMES,
  RELAY_PACKET,
  RELAY_WINDOW,
  RELAY_VIDEO_BITRATE,
  RELAY_AUDIO_BITRATE,
  RELAY_CHUNK_MS,
  relayPacket,
  readRelayPacket,
  type RelayStart,
} from '../shared/broadcast-relay';

type State = 'idle' | 'connecting' | 'buffering' | 'receiving' | 'failed' | 'unsupported';
const mediaSourceClass = () =>
  ((globalThis as any).ManagedMediaSource as typeof MediaSource | undefined) ??
  globalThis.MediaSource;

/** Primary live transport, independent of WebRTC and the room/chat socket. */
export class BroadcastRelayClient {
  private scope = '';
  private socket?: WebSocket;
  private recorder?: MediaRecorder;
  private source?: MediaSource;
  private buffer?: SourceBuffer;
  private objectUrl = '';
  private queue: Array<{ session: string; sequence: number; bytes: Uint8Array }> = [];
  private queuedBytes = 0;
  private currentPacket?: { session: string; sequence: number; bytes: Uint8Array };
  private session = '';
  private expected = 0;
  private encodingGeneration = 0;
  private pendingEncoding = 0;
  private sequence = 0;
  private retryAt = 0;
  private buffering = true;
  private bufferTarget = 2.5;
  private lastAckAt = 0;
  private pendingAck?: { session: string; sequence: number };
  private stalls = 0;
  private room: Snapshot | null = null;
  private publisher = false;
  private local: MediaStream | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;
  private state: State = 'idle';
  private bytes = 0;
  private audiences = 0;
  private mime = '';
  private videoBitrate = RELAY_VIDEO_BITRATE;
  constructor(
    private video: HTMLVideoElement,
    private attach: (url: string | null) => void,
    private play: () => void,
    private changed: () => void,
  ) {
    video.addEventListener('waiting', () => {
      if (!this.active() || this.publisher || this.room?.playback.paused || this.buffering) return;
      this.stalls++;
      this.buffering = true;
      this.bufferTarget = Math.min(5, this.bufferTarget + 0.5);
      video.pause();
      this.state = 'buffering';
      this.changed();
    });
    video.addEventListener('canplay', () => this.playBuffered());
  }
  active() {
    return !!this.objectUrl;
  }
  setQuality(quality: string) {
    const bitrate =
      quality === 'smooth' ? 1_800_000 : quality === 'high' ? 6_000_000 : RELAY_VIDEO_BITRATE;
    if (bitrate === this.videoBitrate) return;
    this.videoBitrate = bitrate;
    if (this.publisher) this.send({ type: 'configure' });
  }
  diagnostics() {
    return {
      state: this.state,
      bytes: this.bytes,
      viewers: this.audiences,
      queuedBytes: this.queuedBytes,
      mime: this.mime || null,
      videoBitsPerSecond: this.publisher ? this.recorder?.videoBitsPerSecond : undefined,
      bufferTarget: this.bufferTarget,
      stalls: this.stalls,
      bufferedSeconds: this.buffer?.buffered.length
        ? Math.max(
            0,
            this.buffer.buffered.end(this.buffer.buffered.length - 1) - this.video.currentTime,
          )
        : 0,
    };
  }
  status() {
    if (this.publisher)
      return this.audiences
        ? `正在提供视频 · ${this.audiences} 位观众接入`
        : '正在提供视频 · 等待观众';
    if (this.state === 'receiving') return '正在接收视频';
    if (this.state === 'buffering') return '正在缓冲视频';
    if (this.state === 'connecting') return '正在连接视频通道';
    if (this.state === 'unsupported') return '当前浏览器不支持此视频格式';
    if (this.state === 'failed') return '视频通道暂不可用，正在重连';
    return '';
  }
  configure(
    room: Snapshot | null,
    me: string,
    secret: string,
    server: string,
    enabled: boolean,
    local: MediaStream | null,
    _directConnected = false,
  ) {
    const media = enabled && room?.mode === 'stream' && room.media?.broadcast ? room.media : null;
    const scope = media ? `${room!.code}:${media.id}:${room!.epoch}:${me}` : '';
    if (scope !== this.scope) {
      this.close();
      this.scope = scope;
      this.bytes = 0;
      this.stalls = 0;
      this.bufferTarget = 2.5;
    }
    this.room = room;
    this.publisher = media?.broadcast?.host === me;
    this.local = local;
    if (!media || !room || !secret) return;
    if (!room.members.some((m) => m.id === media.broadcast!.host && m.online)) {
      this.stopTransport();
      return;
    }
    // Keep a publisher control channel ready, but encode only on receiver demand.
    if (this.publisher && !local?.active) return;
    if (this.socket || Date.now() < this.retryAt) return;
    const Source = mediaSourceClass();
    const formats = RELAY_MIMES.filter((mime) =>
      this.publisher
        ? typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)
        : !!Source?.isTypeSupported(mime),
    );
    if (!formats.length) {
      this.state = 'unsupported';
      this.changed();
      return;
    }
    const socket = new WebSocket(
      server.replace(/^http/, 'ws') + '/broadcast-relay?room=' + room.code,
    );
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.state = 'connecting';
    this.changed();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(
        JSON.stringify({
          type: 'hello',
          code: room.code,
          member: me,
          secret,
          media: media.id,
          epoch: room.epoch,
          formats,
        }),
      );
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
      }, 10000);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'need' && this.publisher) this.encode(socket, message.formats);
          else if (message.type === 'audience' && this.publisher) {
            this.audiences = message.count;
            this.changed();
          } else if (message.type === 'start' && !this.publisher) this.decode(message);
          else if (message.type === 'end' && !this.publisher) {
            this.clearDecoder();
            this.state = 'buffering';
            this.changed();
          }
        } else if (!this.publisher && event.data instanceof ArrayBuffer)
          this.append(new Uint8Array(event.data));
      } catch {
        this.fail();
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) this.fail();
    };
    socket.onclose = () => {
      if (this.socket === socket) this.fail();
    };
  }
  private stopEncoder() {
    this.encodingGeneration++;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = undefined;
    this.pendingEncoding = 0;
  }
  private encode(socket: WebSocket, audiences: string[][]) {
    this.audiences = audiences.length;
    this.changed();
    if (!audiences.length || !this.local?.active) {
      this.stopEncoder();
      return;
    }
    const mime = RELAY_MIMES.find(
      (mime) =>
        MediaRecorder.isTypeSupported(mime) && audiences.every((formats) => formats.includes(mime)),
    );
    if (!mime) {
      this.state = 'unsupported';
      this.changed();
      socket.close(4003, 'unsupported media format');
      return;
    }
    this.stopEncoder();
    const session = crypto.randomUUID().replaceAll('-', '');
    const generation = this.encodingGeneration;
    this.sequence = 0;
    const recorder = new MediaRecorder(this.local, {
      mimeType: mime,
      videoBitsPerSecond: this.videoBitrate,
      audioBitsPerSecond: RELAY_AUDIO_BITRATE,
      videoKeyFrameIntervalDuration: 1000,
    } as MediaRecorderOptions);
    this.recorder = recorder;
    this.mime = mime;
    socket.send(JSON.stringify({ type: 'start', session, mime }));
    let pending = Promise.resolve();
    recorder.ondataavailable = (event) => {
      if (!event.data.size || generation !== this.encodingGeneration) return;
      this.pendingEncoding += event.data.size;
      if (this.pendingEncoding + socket.bufferedAmount > RELAY_WINDOW) {
        this.fail();
        return;
      }
      pending = pending
        .then(async () => {
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          if (
            this.socket !== socket ||
            generation !== this.encodingGeneration ||
            socket.readyState !== WebSocket.OPEN
          )
            return;
          for (let offset = 0; offset < bytes.length; offset += RELAY_PACKET)
            socket.send(
              relayPacket(session, this.sequence++, bytes.subarray(offset, offset + RELAY_PACKET)),
            );
          this.pendingEncoding -= event.data.size;
          this.bytes += bytes.length;
        })
        .catch(() => this.fail());
    };
    recorder.onerror = () => {
      if (this.recorder === recorder) this.fail();
    };
    recorder.start(RELAY_CHUNK_MS);
  }
  private decode(start: RelayStart) {
    if (!RELAY_MIMES.includes(start.mime) || !/^[0-9a-f]{32}$/.test(start.session))
      throw new Error('invalid stream');
    this.clearDecoder();
    const Source = mediaSourceClass();
    if (!Source?.isTypeSupported(start.mime)) throw new Error('unsupported media format');
    const source = new Source();
    this.source = source;
    this.session = start.session;
    this.expected = 0;
    this.mime = start.mime;
    this.state = 'buffering';
    this.buffering = true;
    this.changed();
    source.addEventListener(
      'sourceopen',
      () => {
        if (this.source !== source) return;
        try {
          const buffer = source.addSourceBuffer(start.mime);
          this.buffer = buffer;
          buffer.addEventListener('error', () => {
            if (this.source === source) this.fail();
          });
          buffer.addEventListener('updateend', () => {
            if (this.source !== source) return;
            if (this.currentPacket) {
              const packet = this.currentPacket;
              this.currentPacket = undefined;
              this.bytes += packet.bytes.length;
              this.pendingAck = { session: packet.session, sequence: packet.sequence };
              if (performance.now() - this.lastAckAt >= 200) {
                this.send({ type: 'ack', ...this.pendingAck });
                this.lastAckAt = performance.now();
                this.pendingAck = undefined;
              }
            }
            this.playBuffered();
            this.pump();
          });
          this.pump();
        } catch {
          this.fail();
        }
      },
      { once: true },
    );
    this.objectUrl = URL.createObjectURL(source);
    this.video.disableRemotePlayback = true;
    this.attach(this.objectUrl);
  }
  private playBuffered() {
    const ranges = this.buffer?.buffered;
    if (!this.active() || !ranges?.length || this.room?.playback.paused) return;
    const start = ranges.start(ranges.length - 1),
      end = ranges.end(ranges.length - 1);
    if (this.video.currentTime < start - 0.05) this.video.currentTime = Math.min(end, start + 0.05);
    if (this.buffering && end - this.video.currentTime < this.bufferTarget) {
      if (!this.video.paused) this.video.pause();
      return;
    }
    this.buffering = false;
    if (end - this.video.currentTime > 12)
      this.video.currentTime = Math.max(start, end - this.bufferTarget);
    if (this.video.readyState >= 2) {
      const ahead = end - this.video.currentTime;
      this.video.playbackRate =
        ahead > this.bufferTarget + 1 ? 1.03 : ahead < this.bufferTarget - 0.8 ? 0.98 : 1;
      this.state = 'receiving';
      if (this.video.paused) this.play();
      this.changed();
    }
  }
  resume() {
    this.playBuffered();
  }
  private append(raw: Uint8Array) {
    const packet = readRelayPacket(raw);
    if (!packet || packet.session !== this.session || !this.source) return;
    if (packet.sequence !== this.expected++) throw new Error('media sequence gap');
    if (this.queuedBytes + packet.bytes.length > RELAY_WINDOW) throw new Error('media queue full');
    this.queuedBytes += packet.bytes.length;
    this.queue.push(packet);
    this.pump();
  }
  private pump() {
    const buffer = this.buffer;
    if (!buffer || buffer.updating || this.source?.readyState !== 'open') return;
    try {
      if (buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        if (end - buffer.buffered.start(0) > 45) {
          // This is live fallback, including while paused: never retain a movie in memory.
          buffer.remove(0, end - 30);
          return;
        }
      }
      const packet = this.queue.shift();
      if (!packet) return;
      this.queuedBytes -= packet.bytes.length;
      this.currentPacket = packet;
      buffer.appendBuffer(packet.bytes.slice().buffer as ArrayBuffer);
    } catch {
      this.fail();
    }
  }
  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private clearDecoder() {
    this.source = undefined;
    this.buffer = undefined;
    this.queue = [];
    this.currentPacket = undefined;
    this.queuedBytes = 0;
    this.session = '';
    this.pendingAck = undefined;
    if (this.objectUrl) {
      this.attach(null);
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = '';
    }
  }
  private fail() {
    this.stopTransport();
    this.state = 'failed';
    this.retryAt = Date.now() + 10000;
    this.changed();
  }
  private stopTransport() {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.stopEncoder();
    this.clearDecoder();
    this.audiences = 0;
  }
  close() {
    this.stopTransport();
    this.scope = '';
    this.state = 'idle';
    this.retryAt = 0;
  }
}
