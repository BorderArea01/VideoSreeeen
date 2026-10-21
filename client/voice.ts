/// <reference types="vite/client" />
import workletUrl from './voice-worklet.ts?worker&url';
import type { Snapshot } from '../shared/protocol';
import { icon } from './icons';
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
  private inputSelect: HTMLSelectElement;
  private outputSelect: HTMLSelectElement;
  private deviceNote: HTMLElement;
  private devices: MediaDeviceInfo[] = [];
  private inputId = '';
  private outputId = '';
  private deviceRefresh = 0;
  private outputRequest = 0;
  private outputTask: Promise<void> = Promise.resolve();
  private changingOutput = false;
  private deviceNotice = '';
  private deviceNoticeKind?: 'input' | 'output';
  constructor(before: HTMLElement) {
    this.panel = document.createElement('section');
    this.panel.className = 'members-card voice-card';
    this.panel.id = 'voice-panel';
    this.panel.innerHTML = `<div class="section-heading"><span>${icon('mic', 18)} 房间语音 <b id="voice-count" hidden></b></span><span class="voice-help" tabindex="0" title="独立语音通道，不保存录音。使用耳机可减少回声；短时抖动会增加本机缓冲，严重断网仍会中断。服务器可处理语音数据，非端到端加密。" aria-label="语音说明：不保存录音，使用耳机可减少回声。服务器可处理语音数据，非端到端加密。">${icon('info', 15)}</span></div><div id="voice-status" class="voice-status" role="status"></div><div class="voice-actions"><button id="voice-join" class="button accent" type="button">${icon('mic', 16)} 加入语音</button><button id="voice-mic" class="button soft" type="button" hidden>开麦</button><button id="voice-sound" class="icon-button" type="button" hidden></button><button id="voice-leave" class="icon-button" type="button" title="退出语音" aria-label="退出语音" hidden>${icon('exit', 17)}</button></div><div id="voice-members" class="voice-members"></div><label id="voice-volume-label" class="voice-volume" hidden><span>语音音量</span><input id="voice-volume" type="range" min="0" max="100" value="80" aria-label="语音音量"></label><details id="voice-devices" class="advanced voice-devices"><summary><span>${icon('settings', 15)} 音频设备</span>${icon('chevron', 14)}</summary><div class="voice-device-fields"><label>麦克风<select id="voice-input" aria-label="语音输入设备"></select></label><label>扬声器 / 耳机<select id="voice-output" aria-label="语音输出设备"></select></label></div><button id="voice-devices-refresh" class="text-button" type="button">${icon('signal', 12)} 刷新设备</button><p id="voice-device-note" role="status"></p></details>`;
    before.before(this.panel);
    const get = <T extends HTMLElement>(id: string) => this.panel.querySelector<T>('#' + id)!;
    this.joinButton = get('voice-join');
    this.micButton = get('voice-mic');
    this.soundButton = get('voice-sound');
    this.exitButton = get('voice-leave');
    this.status = get('voice-status');
    this.list = get('voice-members');
    this.inputSelect = get('voice-input');
    this.outputSelect = get('voice-output');
    this.deviceNote = get('voice-device-note');
    try {
      this.inputId = localStorage.getItem('vs-voice-input') ?? '';
      this.outputId = localStorage.getItem('vs-voice-output') ?? '';
    } catch {
      /* Session-only choices still work. */
    }
    this.inputSelect.onchange = () => void this.chooseInput(this.inputSelect.value);
    this.outputSelect.onchange = () => void this.chooseOutput(this.outputSelect.value);
    get('voice-devices-refresh').onclick = () => void this.refreshDevices();
    get<HTMLDetailsElement>('voice-devices').ontoggle = () => {
      if (get<HTMLDetailsElement>('voice-devices').open) void this.refreshDevices();
    };
    navigator.mediaDevices?.addEventListener('devicechange', () => void this.refreshDevices(true));
    this.deviceOptions();
    this.joinButton.onclick = () => void this.join();
    this.micButton.onclick = () => void this.microphone();
    this.soundButton.onclick = () => {
      if (this.context?.state === 'suspended') {
        void this.context.resume().then(() => {
          this.state = '已连接';
          this.render();
        });
      } else {
        this.outputMuted = !this.outputMuted;
        this.state = this.outputMuted ? '接收已静音' : '已连接';
        if (!this.outputMuted) this.clearNotice('output');
      }
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
  private saveDevice(kind: 'input' | 'output', id: string) {
    try {
      localStorage.setItem('vs-voice-' + kind, id);
    } catch {
      /* Private browsing may disallow storage. */
    }
  }
  private notice(kind: 'input' | 'output', message: string) {
    this.deviceNoticeKind = kind;
    this.deviceNotice = message;
    return message;
  }
  private clearNotice(kind: 'input' | 'output') {
    if (this.deviceNoticeKind === kind) {
      this.deviceNotice = '';
      this.deviceNoticeKind = undefined;
    }
  }
  private outputSupported() {
    return typeof (globalThis.AudioContext?.prototype as any)?.setSinkId === 'function';
  }
  private deviceOptions() {
    for (const [select, kind, id] of [
      [this.inputSelect, 'audioinput', this.inputId],
      [this.outputSelect, 'audiooutput', this.outputId],
    ] as const) {
      const options = [new Option('系统默认', '')];
      let index = 0;
      for (const device of this.devices)
        if (
          device.kind === kind &&
          device.deviceId &&
          device.deviceId !== 'default' &&
          !options.some((o) => o.value === device.deviceId)
        )
          options.push(
            new Option(
              device.label || `${kind === 'audioinput' ? '麦克风' : '输出设备'} ${++index}`,
              device.deviceId,
            ),
          );
      if (id && !options.some((o) => o.value === id))
        options.push(new Option('上次选择的设备（待授权或连接）', id));
      if (
        kind === 'audiooutput' &&
        this.outputSupported() &&
        typeof (navigator.mediaDevices as any)?.selectAudioOutput === 'function'
      )
        options.push(new Option('选择其他输出设备…', '@choose'));
      select.replaceChildren(...options);
      select.value = id;
    }
    this.outputSelect.disabled =
      !this.outputSupported() || this.changingOutput || (this.busy && !this.joined);
    if (!this.outputSupported()) {
      this.outputSelect.replaceChildren(new Option('跟随系统默认输出', ''));
      this.deviceNote.textContent = '当前浏览器不能单独指定语音输出，请在系统中切换扬声器或耳机。';
    } else
      this.deviceNote.textContent =
        this.deviceNotice ||
        (this.devices.some((d) => d.kind === 'audioinput' && d.label)
          ? '只影响房间语音；视频声音仍使用播放器的输出。'
          : '首次开麦授权后会显示更多设备名称；未列出的输出也可通过系统切换。');
  }
  private async refreshDevices(changed = false) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const request = ++this.deviceRefresh;
    try {
      const next = await navigator.mediaDevices.enumerateDevices();
      if (request !== this.deviceRefresh) return;
      const removed = (kind: MediaDeviceKind, id: string) =>
        changed &&
        id &&
        this.devices.some((d) => d.kind === kind && d.deviceId === id) &&
        !next.some((d) => d.kind === kind && d.deviceId === id);
      if (removed('audioinput', this.inputId)) {
        this.inputId = '';
        this.saveDevice('input', '');
        this.stopMicrophone();
        this.control({ type: 'mute', muted: true });
        this.state = this.notice('input', '输入设备已断开，请重新选择并开麦');
      }
      if (removed('audiooutput', this.outputId)) {
        this.outputMuted = true;
        this.volume();
        await this.chooseOutput('', true);
        if (request !== this.deviceRefresh) return;
        this.state = this.notice('output', '输出设备已断开，语音已静音；请确认设备后恢复接收');
      }
      this.devices = next;
      this.deviceOptions();
      this.render();
    } catch {
      if (request === this.deviceRefresh)
        this.deviceNote.textContent = '无法读取设备列表，请检查浏览器权限后刷新。';
    }
  }
  private async chooseInput(id: string) {
    const previous = this.inputId;
    if (id === previous) return;
    if (!this.stream) {
      this.inputId = id;
      this.saveDevice('input', id);
      this.clearNotice('input');
      this.deviceOptions();
      return;
    }
    const current = this.stream,
      context = this.context,
      generation = ++this.micGeneration;
    this.busy = true;
    this.render();
    let replacement: MediaStream | undefined;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: this.inputConstraints(id),
      });
      if (
        generation !== this.micGeneration ||
        !this.ready ||
        !context ||
        this.context !== context ||
        this.stream !== current ||
        !this.capture
      ) {
        replacement.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!replacement.getAudioTracks().some((t) => t.readyState === 'live'))
        throw new Error('Input unavailable');
      const source = context.createMediaStreamSource(replacement);
      source.connect(this.capture);
      this.source?.disconnect();
      this.source = source;
      this.stream = replacement;
      this.watchMicrophone(replacement);
      current.getTracks().forEach((t) => t.stop());
      this.inputId = id;
      this.saveDevice('input', id);
      this.clearNotice('input');
      this.state = '已切换输入设备';
      void this.refreshDevices();
    } catch {
      replacement?.getTracks().forEach((t) => t.stop());
      if (generation === this.micGeneration) {
        this.inputId = previous;
        this.state = '输入切换失败，继续使用原麦克风';
      }
    } finally {
      if (generation === this.micGeneration) this.busy = false;
      this.deviceOptions();
      this.render();
    }
  }
  private inputConstraints(id = this.inputId): MediaTrackConstraints {
    return {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(id ? { deviceId: { exact: id } } : {}),
    };
  }
  private watchMicrophone(stream: MediaStream) {
    stream.getAudioTracks()[0].onended = () => {
      if (this.stream !== stream) return;
      this.stopMicrophone();
      this.control({ type: 'mute', muted: true });
      this.state = this.notice('input', '麦克风已断开，请检查设备并重新开麦');
      this.render();
      void this.refreshDevices();
    };
  }
  private async chooseOutput(id: string, keepMuted = false): Promise<boolean> {
    const request = ++this.outputRequest,
      generation = this.generation;
    if (!this.outputSupported()) {
      this.outputId = '';
      this.deviceOptions();
      return false;
    }
    this.changingOutput = true;
    this.deviceOptions();
    let applied = false;
    try {
      if (id === '@choose') {
        // Keep the native picker in the user gesture. Never request microphone access here.
        const device = await (navigator.mediaDevices as any).selectAudioOutput();
        if (request !== this.outputRequest || generation !== this.generation) return false;
        id = device.deviceId;
        this.devices = [
          ...this.devices.filter((d) => !(d.kind === 'audiooutput' && d.deviceId === id)),
          device,
        ];
      }
      this.outputTask = this.outputTask
        .catch(() => {})
        .then(async () => {
          if (request !== this.outputRequest || generation !== this.generation) return;
          const context = this.context;
          if (context) await (context as any).setSinkId(id);
          if (
            request !== this.outputRequest ||
            generation !== this.generation ||
            this.context !== context
          )
            return;
          this.outputId = id;
          this.saveDevice('output', id);
          this.clearNotice('output');
          applied = true;
          if (!keepMuted) this.state = this.joined ? '已切换语音输出' : '已选择语音输出';
        });
      await this.outputTask;
      return applied;
    } catch (e) {
      if (request === this.outputRequest && generation === this.generation)
        this.state =
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? '未获得输出设备权限，保留原输出；可先开麦授权后重试'
            : '输出切换失败，保留原输出设备';
      return false;
    } finally {
      if (request === this.outputRequest) this.changingOutput = false;
      this.deviceOptions();
      this.render();
    }
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
      if (generation !== this.generation) return;
      if (this.outputSupported() && this.outputId) {
        const request = this.outputRequest + 1;
        const applied = await this.chooseOutput(this.outputId, true);
        if (generation !== this.generation) return;
        if (!applied && request === this.outputRequest) {
          this.outputId = '';
          this.saveDevice('output', '');
          this.outputMuted = true;
          await this.chooseOutput('', true);
          if (generation !== this.generation) return;
          this.notice('output', '上次输出设备不可用，已改用系统默认并静音；请重新选择。');
        }
      }
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
        if (this.changingOutput) return;
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
      void this.refreshDevices();
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
            const firstRoster = !this.ready;
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
            if (firstRoster)
              this.state =
                this.context?.state === 'running' ? '已连接' : '声音已暂停，点击恢复声音';
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
      this.state = '麦克风已关闭';
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
        audio: this.inputConstraints(),
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
      this.watchMicrophone(stream);
      this.clearNotice('input');
      void this.refreshDevices();
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
          : e instanceof DOMException && ['NotFoundError', 'OverconstrainedError'].includes(e.name)
            ? '所选麦克风不可用，请在音频设备中重选'
            : '无法启用麦克风，可继续收听';
    } finally {
      if (generation === this.micGeneration) this.busy = false;
      this.deviceOptions();
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
    this.outputRequest++;
    this.outputTask = Promise.resolve();
    this.changingOutput = false;
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
    this.micButton.disabled = !this.ready || (this.busy && !this.stream);
    this.inputSelect.disabled = this.busy;
    this.outputSelect.disabled =
      !this.outputSupported() || this.changingOutput || (this.busy && !this.joined);
    this.action(
      this.micButton,
      this.stream ? '关闭麦克风' : '开麦',
      this.stream ? 'mic' : 'mic-off',
    );
    this.micButton.setAttribute('aria-pressed', String(!!this.stream));
    this.micButton.classList.toggle('active', !!this.stream);
    this.action(
      this.soundButton,
      this.context?.state === 'suspended' ? '恢复声音' : this.outputMuted ? '恢复接收' : '静音接收',
      this.outputMuted ? 'volume-off' : 'volume',
      true,
    );
    this.soundButton.setAttribute('aria-pressed', String(this.outputMuted));
    this.soundButton.classList.toggle('is-muted', this.outputMuted);
    if (this.status.textContent !== this.state) this.status.textContent = this.state;
    this.status.title = this.ready
      ? `${this.peers.length}/8 人 · ${this.codec === 'opus' ? 'Opus' : '兼容音频'}`
      : '';
    const count = this.panel.querySelector<HTMLElement>('#voice-count')!;
    count.hidden = !this.ready;
    count.textContent = String(this.peers.length);
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
    const existing = new Map(
      [...this.list.querySelectorAll<HTMLButtonElement>('.voice-peer')].map((row) => [
        row.dataset.member!,
        row,
      ]),
    );
    const rows = this.peers.map((peer) => {
      const row = existing.get(peer.id) ?? document.createElement('button');
      row.className = 'voice-peer member';
      row.dataset.member = peer.id;
      if (!row.firstChild)
        row.innerHTML = `<span class="avatar"></span><span class="member-info"><strong></strong><small></small></span><span class="voice-member-state" aria-hidden="true"></span>`;
      const metric = this.metrics.find((m) => m.id === peer.id + ':' + peer.session);
      const name = this.room?.members.find((m) => m.id === peer.id)?.name ?? '成员';
      const label = peer.id === this.me ? '我' : name;
      const locallyMuted = this.mutedPeers.has(peer.id);
      const speaking = !peer.muted && metric?.level > 0.012;
      const state = locallyMuted
        ? '本机已静音'
        : peer.muted
          ? '未开麦'
          : speaking
            ? '正在说话'
            : '已开麦';
      row.querySelector('.avatar')!.textContent = [...label][0];
      row.querySelector('strong')!.textContent = label;
      row.querySelector('small')!.textContent = state;
      row.classList.toggle('voice-peer-speaking', speaking && !locallyMuted);
      const mark = locallyMuted
        ? 'volume-off'
        : peer.muted
          ? 'mic-off'
          : speaking
            ? 'signal'
            : 'mic';
      const indicator = row.querySelector<HTMLElement>('.voice-member-state')!;
      if (indicator.dataset.icon !== mark) {
        indicator.dataset.icon = mark;
        indicator.innerHTML = icon(mark, 14);
      }
      row.setAttribute('aria-label', `${label}，${state}`);
      row.setAttribute('aria-pressed', String(locallyMuted));
      row.disabled = peer.id === this.me;
      row.title =
        peer.id === this.me
          ? '使用上方按钮控制麦克风'
          : locallyMuted
            ? '恢复接收此成员的语音'
            : '只在本机静音此成员';
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
    });
    for (const [id, row] of existing) if (!this.peers.some((peer) => peer.id === id)) row.remove();
    rows.forEach((row, index) => {
      if (this.list.children[index] !== row)
        this.list.insertBefore(row, this.list.children[index] ?? null);
    });
  }
  private action(button: HTMLButtonElement, label: string, name: string, compact = false) {
    if (button.dataset.label === label && button.dataset.icon === name) return;
    button.dataset.label = label;
    button.dataset.icon = name;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon(name, 16) + (compact ? '' : `<span>${label}</span>`);
  }
}
