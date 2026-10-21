import { VoiceBuffer } from './voice-buffer';
declare const AudioWorkletProcessor: { new (): { port: MessagePort } };
declare function registerProcessor(name: string, processor: unknown): void;
declare const currentTime: number;
declare const sampleRate: number;

class Capture extends AudioWorkletProcessor {
  private samples = new Float32Array(960);
  private offset = 0;
  private pending = 0;
  private overloaded = false;
  constructor() {
    super();
    this.port.onmessage = () => {
      this.pending = Math.max(0, this.pending - 1);
    };
  }
  process(inputs: Float32Array[][]) {
    const mono = inputs[0]?.[0];
    if (mono)
      for (const x of mono) {
        this.samples[this.offset++] = x;
        if (this.offset === 960) {
          if (this.pending < 12 && !this.overloaded) {
            this.pending++;
            this.port.postMessage(this.samples, [this.samples.buffer]);
          } else if (!this.overloaded) {
            this.overloaded = true;
            this.port.postMessage({ type: 'overload' });
          }
          this.samples = new Float32Array(960);
          this.offset = 0;
        }
      }
    return true;
  }
}
class Playout extends AudioWorkletProcessor {
  private peers = new Map<string, VoiceBuffer>();
  private tick = 0;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'clear') this.peers.clear();
      if (data.type === 'roster')
        for (const key of this.peers.keys()) if (!data.ids.includes(key)) this.peers.delete(key);
      if (data.type === 'frame') {
        let peer = this.peers.get(data.id);
        if (!peer && this.peers.size < 8) {
          peer = new VoiceBuffer();
          this.peers.set(data.id, peer);
        }
        peer?.push(data.sequence, data.samples, currentTime);
      }
      if (data.type === 'mute') {
        const peer = this.peers.get(data.id);
        if (peer) peer.muted = data.muted;
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    for (const peer of this.peers.values()) peer.render(out);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]);
    this.tick += out.length;
    if (this.tick >= sampleRate / 4) {
      this.tick = 0;
      this.port.postMessage(
        [...this.peers].map(([id, p]) => ({
          id,
          queuedMs: p.queuedMs,
          underruns: p.underruns,
          resets: p.resets,
          played: p.played,
          level: p.energy,
        })),
      );
    }
    return true;
  }
}
registerProcessor('vs-voice-capture', Capture);
registerProcessor('vs-voice-playout', Playout);
