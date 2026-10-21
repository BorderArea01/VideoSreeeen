/// <reference types="vite/client" />
import workletUrl from './voice-worklet.ts?worker&url';
import type { Snapshot } from '../shared/protocol';
import {
  bytesUuid,
  decodeVoicePcm,
  encodeVoicePcm,
  readVoicePacket,
  voicePacket,
  type VoiceCodec,
  type VoicePeer,
} from '../shared/voice';

const codecs = globalThis as any;
const opusConfig = {
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 1,
  bitrate: 24000,
  opus: { application: 'voip', signal: 'voice', frameDuration: 20000, usedtx: false },
};
/** Explicit opt-in room voice; microphone samples never enter the room/chat connection. */
export class RoomVoice {
  private room: Snapshot | null = null;
  private me = '';
  private secret = '';
  private server = '';
  private socket?: WebSocket;
  private context?: AudioContext;
  private playout?: AudioWorkletNode;
  private gain?: GainNode;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private silent?: GainNode;
  private stream?: MediaStream;
  private encoder?: any;
  private decoders = new Map<string, { decoder: any; sequence: number[] }>();
  private peers: VoicePeer[] = [];
  private metrics: any[] = [];
  private codec: VoiceCodec = 'mulaw16';
  private opus = false;
  private session = '';
  private sequence = 0;
  private batch: Uint8Array[] = [];
  private batchFirst = 0;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private joined = false;
  private ready = false;
  private busy = false;
  private generation = 0;
  private micGeneration = 0;
  private received = 0;
  private sent = 0;
  private ack = -1;
  private lastAck = -1;
  private lastPong = 0;
  private state = '未加入';
  private outputMuted = false;
  private mutedPeers = new Set<string>();
  private panel: HTMLElement;
  private joinButton: HTMLButtonElement;
  private micButton: HTMLButtonElement;
  private soundButton: HTMLButtonElement;
  private exitButton: HTMLButtonElement;
  private status: HTMLElement;
  private list: HTMLElement;
  constructor(before: HTMLElement) {
    this.panel = document.createElement('section');
    this.panel.className = 'voice-card';
    this.panel.id = 'voice-panel';
    this.panel.innerHTML = `<div class="section-heading"><span>房间语音</span><span title="独立语音通道，不保存录音。使用耳机可减少回声；短时抖动会增加本机缓冲，严重断网仍会中断。服务器可处理语音数据，非端到端加密。">ⓘ</span></div><div id="voice-status" class="voice-status" role="status"></div><div class="voice-actions"><button id="voice-join" class="soft-button">加入语音</button><button id="voice-mic" class="soft-button" hidden>开麦</button><button id="voice-sound" class="outline-button" hidden>静音接收</button><button id="voice-leave" class="outline-button" hidden>退出</button></div><div id="voice-members" class="voice-members"></div><label id="voice-volume-label" class="voice-volume" hidden>语音音量<input id="voice-volume" type="range" min="0" max="100" value="80" aria-label="语音音量"></label>`;
    before.before(this.panel);
    const get = <T extends HTMLElement>(id: string) => this.panel.querySelector<T>('#' + id)!;
    this.joinButton = get('voice-join');
    this.micButton = get('voice-mic');
    this.soundButton = get('voice-sound');
    this.exitButton = get('voice-leave');
    this.status = get('voice-status');
    this.list = get('voice-members');
    this.joinButton.onclick = () => void this.join();
    this.micButton.onclick = () => void this.microphone();
    this.soundButton.onclick = () => {
      if (this.context?.state === 'suspended') {
        void this.context.resume().then(() => {
          this.state = '已连接';
          this.render();
        });
      } else this.outputMuted = !this.outputMuted;
      this.volume();
      this.render();
    };
    this.exitButton.onclick = () => this.leave();
    get<HTMLInputElement>('voice-volume').oninput = () => this.volume();
    this.render();
  }
  configure(room: Snapshot | null, me: string, secret: string, server: string) {
    if (
      this.room &&
      (!room || room.code !== this.room.code || me !== this.me || server !== this.server)
    )
      this.leave();
    this.room = room;
    this.me = me;
    this.secret = secret;
    this.server = server;
    this.render();
  }
  private volume() {
    if (this.gain)
      this.gain.gain.value = this.outputMuted
        ? 0
        : Number((this.panel.querySelector('#voice-volume') as HTMLInputElement).value) / 100;
  }
  private async join() {
    if (!this.room || this.busy || this.joined) return;
    const generation = ++this.generation;
    this.busy = true;
    this.state = '正在连接';
    this.render();
    try {
      if (!globalThis.AudioContext || !globalThis.AudioWorkletNode || !isSecureContext)
        throw new Error('语音需要支持 AudioWorklet 的 HTTPS 浏览器');
      const context = (this.context = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive',
      }));
      await context.resume();
      const config = await fetch(new URL('/config', this.server), {
        signal: AbortSignal.timeout(8000),
      });
      if (!config.ok || !(await config.json()).voice) throw new Error('当前房间服务器尚未启用语音');
      if (context.sampleRate !== 48000)
        throw new Error('当前音频设备不支持 48 kHz，请更换浏览器或设备');
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== this.generation) return;
      this.playout = new AudioWorkletNode(context, 'vs-voice-playout', {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      this.gain = context.createGain();
      this.volume();
      this.playout.connect(this.gain).connect(context.destination);
      this.playout.port.onmessage = ({ data }) => {
        this.metrics = data;
        this.render();
      };
      context.onstatechange = () => {
        if (!this.joined || this.context !== context) return;
        if (context.state !== 'running') {
          this.stopMicrophone();
          this.control({ type: 'mute', muted: true });
          this.clearDecoders();
          this.state = '声音已暂停，点击恢复声音';
        } else this.state = this.ready ? '已连接' : '正在连接';
        this.render();
      };
      this.opus = false;
      if (codecs.AudioEncoder && codecs.AudioDecoder) {
        try {
          this.opus =
            (await codecs.AudioEncoder.isConfigSupported(opusConfig)).supported &&
            (
              await codecs.AudioDecoder.isConfigSupported({
                codec: 'opus',
                sampleRate: 48000,
                numberOfChannels: 1,
              })
            ).supported;
        } catch {
          /* Compatibility PCM remains available. */
        }
      }
      if (generation !== this.generation) return;
      this.joined = true;
      this.open();
      this.timer = setInterval(() => {
        if (!this.ready) return;
        if (Date.now() - this.lastPong > 15000) {
          this.socket?.close(4001, 'voice timeout');
          return;
        }
        if (this.ack > this.lastAck) {
          this.control({ type: 'ack', sequence: this.ack });
          this.lastAck = this.ack;
        }
      }, 250);
    } catch (e) {
      if (generation === this.generation) {
        this.leave();
        this.state = e instanceof Error ? e.message : '语音不可用';
      }
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }
  private open() {
    if (!this.joined || !this.room) return;
    this.clearDecoders();
    this.ready = false;
    this.batch = [];
    this.sequence = 0;
    this.ack = this.lastAck = -1;
    this.session = crypto.randomUUID();
    this.state = '正在连接';
    this.render();
    const url = new URL('/voice', this.server);
    url.protocol = url.protocol.replace('http', 'ws');
    url.searchParams.set('room', this.room.code);
    const socket = (this.socket = new WebSocket(url));
    socket.binaryType = 'arraybuffer';
    const timeout = setTimeout(() => {
      if (!this.ready && this.socket === socket) socket.close(4001, 'voice connect timeout');
    }, 12000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.control({
        type: 'hello',
        code: this.room!.code,
        member: this.me,
        secret: this.secret,
        session: this.session,
        opus: this.opus,
      });
    };
    let pingAt = 0;
    const heartbeat = setInterval(() => {
      if (this.socket !== socket || !this.ready) return;
      if (Date.now() - pingAt >= 5000) {
        pingAt = Date.now();
        this.control({ type: 'ping' });
      }
    }, 1000);
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;
      try {
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
          if (msg.type === 'pong') this.lastPong = Date.now();
          if (msg.type === 'roster') {
            this.ready = true;
            this.lastPong = Date.now();
            this.peers = msg.peers;
            if (this.codec !== msg.codec) {
              this.codec = msg.codec;
              this.batch = [];
              this.closeEncoder();
              this.clearDecoders();
            }
            const active = new Set(this.peers.map((p) => p.id + ':' + p.session));
            for (const [key, value] of this.decoders)
              if (!active.has(key)) {
                value.decoder.close();
                this.decoders.delete(key);
              }
            this.playout?.port.postMessage({ type: 'roster', ids: [...active] });
            // Reconnection begins listen-only. Mic is never reopened without a click.
            this.state = this.context?.state === 'running' ? '已连接' : '声音已暂停，点击恢复声音';
            this.render();
          }
          return;
        }
        const bytes = new Uint8Array(data);
        if (bytes.length < 45) return;
        this.ack = new DataView(data).getUint32(0);
        const sender = bytesUuid(bytes.subarray(4, 20)),
          packet = readVoicePacket(bytes.subarray(20));
        if (
          !packet ||
          packet.codec !== this.codec ||
          !this.peers.some((p) => p.id === sender && p.session === packet.session)
        )
          return;
        const key = sender + ':' + packet.session;
        if (this.context?.state !== 'running') return;
        this.received += bytes.length;
        for (let i = 0; i < packet.frames.length; i++) {
          const sequence = packet.sequence + i,
            frame = packet.frames[i];
          if (packet.codec === 'mulaw16') this.play(key, sequence, decodeVoicePcm(frame));
          else {
            let value = this.decoders.get(key);
            if (!value) {
              const pending: number[] = [];
              const decoder = new codecs.AudioDecoder({
                output: (audio: any) => {
                  try {
                    const samples = new Float32Array(audio.numberOfFrames);
                    audio.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
                    const seq = pending.shift();
                    if (seq !== undefined && this.decoders.get(key)?.decoder === decoder)
                      this.play(key, seq, samples);
                  } finally {
                    audio.close();
                  }
                },
                error: () => {
                  this.state = '语音解码中断，请重新加入';
                  this.render();
                },
              });
              decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
              value = { decoder, sequence: pending };
              this.decoders.set(key, value);
            }
            if (value.decoder.decodeQueueSize > 50) {
              this.socket?.close(4001, 'voice decoder overloaded');
              return;
            }
            value.sequence.push(sequence);
            value.decoder.decode(
              new codecs.EncodedAudioChunk({
                type: 'key',
                timestamp: sequence * 20000,
                data: frame,
              }),
            );
          }
        }
      } catch {
        this.socket?.close(4001, 'voice decoding failed');
      }
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.ready = false;
      this.stopMicrophone();
      this.clearDecoders();
      this.peers = [];
      if (!this.joined) return;
      if ([4003, 4009].includes(event.code)) {
        this.leave();
        this.state = event.code === 4009 ? '语音最多 8 人' : '语音身份已失效，请重新加入房间';
      } else {
        this.state = '语音已断开，正在重连（麦克风已关闭）';
        this.retry = setTimeout(() => this.open(), 1500 + Math.random() * 500);
      }
      this.render();
    };
  }
  private play(id: string, sequence: number, samples: Float32Array) {
    if (this.context?.state !== 'running') return;
    this.playout?.port.postMessage({ type: 'frame', id, sequence, samples }, [samples.buffer]);
    if (this.mutedPeers.has(id.split(':')[0]))
      this.playout?.port.postMessage({ type: 'mute', id, muted: true });
  }
  private control(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }
  private closeEncoder() {
    try {
      this.encoder?.close();
    } catch {}
    this.encoder = undefined;
  }
  private clearDecoders() {
    for (const { decoder } of this.decoders.values())
      try {
        decoder.close();
      } catch {}
    this.decoders.clear();
    this.playout?.port.postMessage({ type: 'clear' });
    this.metrics = [];
  }
  private sendFrame(frame: Uint8Array) {
    if (!this.ready || !this.stream || this.socket?.readyState !== WebSocket.OPEN) return;
    if (!this.batch.length) this.batchFirst = this.sequence;
    this.batch.push(frame);
    this.sequence++;
    if (this.batch.length < 4) return;
    const packet = voicePacket(this.session, this.batchFirst, this.codec, this.batch);
    this.batch = [];
    // TCP cannot remove bytes already queued. Restart instead of replaying stale speech.
    if (this.socket.bufferedAmount > 16384) {
      this.socket.close(4001, 'voice uplink congested');
      this.stopMicrophone();
      return;
    }
    this.socket.send(packet);
    this.sent += packet.length;
  }
  private async microphone() {
    if (this.stream) {
      this.stopMicrophone();
      this.control({ type: 'mute', muted: true });
      this.render();
      return;
    }
    if (!this.ready || this.busy || !this.context) return;
    if (this.context.state !== 'running') await this.context.resume();
    if (!this.ready || !this.context || !this.joined) return;
    const generation = ++this.micGeneration;
    this.busy = true;
    this.render();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== this.micGeneration || !this.joined || !this.ready) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(this.context, 'vs-voice-capture');
      this.silent = this.context.createGain();
      this.silent.gain.value = 0;
      this.source.connect(this.capture).connect(this.silent).connect(this.context.destination);
      let timestamp = 0;
      this.capture.port.onmessage = ({ data }: MessageEvent<Float32Array | { type: string }>) => {
        this.capture?.port.postMessage('ack');
        if (!(data instanceof Float32Array)) {
          this.socket?.close(4001, 'voice capture overloaded');
          this.stopMicrophone();
          return;
        }
        if (!this.ready || !this.stream) return;
        if (this.codec === 'mulaw16') this.sendFrame(encodeVoicePcm(data));
        else {
          if (!this.encoder) {
            const encoder = new codecs.AudioEncoder({
              output: (chunk: any) => {
                if (this.encoder !== encoder || this.codec !== 'opus') return;
                const bytes = new Uint8Array(chunk.byteLength);
                chunk.copyTo(bytes);
                this.sendFrame(bytes);
              },
              error: () => {
                this.stopMicrophone();
                this.control({ type: 'mute', muted: true });
                this.state = '麦克风编码失败，请重新开麦';
                this.render();
              },
            });
            encoder.configure(opusConfig);
            this.encoder = encoder;
          }
          if (this.encoder.encodeQueueSize > 12) {
            this.socket?.close(4001, 'voice encoder overloaded');
            this.stopMicrophone();
            return;
          }
          const audio = new codecs.AudioData({
            format: 'f32-planar',
            sampleRate: 48000,
            numberOfFrames: 960,
            numberOfChannels: 1,
            timestamp,
            data,
          });
          this.encoder.encode(audio);
          audio.close();
          timestamp += 20000;
        }
      };
      stream.getAudioTracks()[0].onended = () => {
        this.stopMicrophone();
        this.control({ type: 'mute', muted: true });
        this.render();
      };
      this.control({ type: 'mute', muted: false });
      this.state = '已连接';
    } catch (e) {
      if (generation !== this.micGeneration) return;
      this.stopMicrophone();
      this.busy = false;
      this.control({ type: 'mute', muted: true });
      this.state =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? '麦克风未获授权，可继续收听'
          : '无法启用麦克风，可继续收听';
    } finally {
      if (generation === this.micGeneration) this.busy = false;
      this.render();
    }
  }
  private stopMicrophone() {
    this.busy = false;
    this.micGeneration++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    this.capture = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.silent?.disconnect();
    this.silent = undefined;
    this.closeEncoder();
    this.batch = [];
  }
  leave() {
    this.generation++;
    this.micGeneration++;
    this.joined = false;
    this.busy = false;
    this.ready = false;
    clearTimeout(this.retry);
    clearInterval(this.timer);
    this.stopMicrophone();
    this.clearDecoders();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'voice left');
    this.playout?.disconnect();
    this.playout = undefined;
    this.gain?.disconnect();
    this.gain = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.peers = [];
    this.state = '未加入';
    this.render();
  }
  private render() {
    this.joinButton.hidden = this.joined;
    this.joinButton.disabled = !this.room || this.busy;
    this.micButton.hidden = this.soundButton.hidden = this.exitButton.hidden = !this.joined;
    this.micButton.disabled = !this.ready || this.busy;
    this.micButton.textContent = this.stream ? '关闭麦克风' : '开麦';
    this.micButton.classList.toggle('active', !!this.stream);
    this.soundButton.textContent =
      this.context?.state === 'suspended' ? '恢复声音' : this.outputMuted ? '恢复接收' : '静音接收';
    this.status.textContent =
      this.state +
      (this.ready
        ? ` · ${this.peers.length}/8 人 · ${this.codec === 'opus' ? 'Opus' : '兼容音频'}`
        : '');
    this.panel.querySelector<HTMLElement>('#voice-volume-label')!.hidden = !this.joined;
    this.panel.dataset.voice = JSON.stringify({
      joined: this.joined,
      ready: this.ready,
      mic: !!this.stream,
      codec: this.codec,
      sent: this.sent,
      received: this.received,
      peers: this.peers.length,
      metrics: this.metrics,
    });
    this.list.replaceChildren(
      ...this.peers.map((peer) => {
        const row = document.createElement('button');
        row.className = 'voice-peer';
        const metric = this.metrics.find((m) => m.id === peer.id + ':' + peer.session);
        const name = this.room?.members.find((m) => m.id === peer.id)?.name ?? '成员';
        row.textContent = `${peer.id === this.me ? '我' : name} · ${peer.muted ? '未开麦' : metric?.level > 0.012 ? '正在说话' : '已开麦'}${this.mutedPeers.has(peer.id) ? ' · 本机已静音' : ''}`;
        row.disabled = peer.id === this.me;
        row.title = '点击只在本机静音此成员';
        row.onclick = () => {
          if (this.mutedPeers.has(peer.id)) this.mutedPeers.delete(peer.id);
          else this.mutedPeers.add(peer.id);
          this.playout?.port.postMessage({
            type: 'mute',
            id: peer.id + ':' + peer.session,
            muted: this.mutedPeers.has(peer.id),
          });
          this.render();
        };
        return row;
      }),
    );
  }
}
