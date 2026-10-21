/** Per-speaker bounded jitter queue. Brief gaps wait for the original samples. */
export class VoiceBuffer {
  private frames = new Map<number, Float32Array>();
  private expected = -1;
  private offset = 0;
  private started = false;
  private waiting = 0;
  private lastArrival = -1;
  private previousBatch = -1;
  private jitter = 0;
  target = 6;
  underruns = 0;
  resets = 0;
  played = 0;
  energy = 0;
  muted = false;
  push(sequence: number, samples: Float32Array, now: number) {
    if (samples.length !== 960 || !samples.every(Number.isFinite)) return;
    if (this.lastArrival >= 0 && now - this.lastArrival > 1.2) {
      this.frames.clear();
      this.expected = -1;
      this.started = false;
      this.offset = 0;
      this.waiting = 0;
      this.resets++;
    }
    if (this.expected < 0) this.expected = sequence;
    if (sequence < this.expected) return;
    if (sequence % 4 === 0 && this.previousBatch >= 0) {
      this.jitter += (Math.abs(now - this.previousBatch - 0.08) - this.jitter) / 8;
      this.target = Math.min(20, Math.max(this.target, Math.ceil(6 + this.jitter * 150)));
    }
    if (sequence % 4 === 0) this.previousBatch = now;
    this.lastArrival = now;
    this.frames.set(sequence, samples);
    if (this.frames.size > 50 || sequence - this.expected > 60) {
      this.expected = Math.max(this.expected, sequence - this.target + 1);
      for (const id of this.frames.keys()) if (id < this.expected) this.frames.delete(id);
      this.offset = 0;
      this.started = false;
      this.waiting = 0;
      this.resets++;
    }
  }
  get queuedMs() {
    return this.frames.size * 20;
  }
  render(out: Float32Array) {
    this.energy = 0;
    if (!this.started) {
      if (this.frames.size < this.target) {
        this.waiting += out.length;
        // A short final utterance must not wait forever for additional packets.
        if (!this.frames.size || this.waiting < this.target * 960) return;
      }
      this.started = true;
      this.waiting = 0;
    }
    const speed =
      this.frames.size > this.target + 3 ? 1.015 : this.frames.size < this.target - 2 ? 0.99 : 1;
    for (let i = 0; i < out.length; i++) {
      const frame = this.frames.get(this.expected);
      if (!frame) {
        this.waiting++;
        if (this.waiting === 1) {
          this.underruns++;
          this.target = Math.min(20, this.target + 2);
        }
        if (!this.frames.size) {
          // Refill this speaker's queue instead of chopping every arriving batch.
          // Keep expected/offset: short jitter must not skip the delayed word.
          this.started = false;
          break;
        }
        if (this.waiting > 5760 && this.frames.size) {
          this.expected = Math.min(...this.frames.keys());
          this.offset = 0;
          this.waiting = 0;
          this.resets++;
        }
        continue;
      }
      this.waiting = 0;
      const index = Math.floor(this.offset),
        fraction = this.offset - index;
      const x = frame[index] * (1 - fraction) + frame[Math.min(959, index + 1)] * fraction;
      if (!this.muted) out[i] += x;
      this.energy += x * x;
      this.played++;
      this.offset += speed;
      if (this.offset >= 960) {
        this.offset -= 960;
        this.frames.delete(this.expected++);
      }
    }
    this.energy = Math.sqrt(this.energy / out.length);
  }
}
