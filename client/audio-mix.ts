/** An audio level gate, not speech recognition. Hold through short word gaps. */
export class VoiceActivity {
  private loudMs = 0;
  private quietMs = 0;
  active = false;
  update(rms: number, elapsedMs: number) {
    const loud = Number.isFinite(rms) && rms >= (this.active ? 0.008 : 0.015);
    this.loudMs = loud ? this.loudMs + elapsedMs : 0;
    this.quietMs = loud ? 0 : this.quietMs + elapsedMs;
    if (this.loudMs >= 40) this.active = true;
    if (this.quietMs >= 350) this.active = false;
    return this.active;
  }
  reset() {
    this.loudMs = this.quietMs = 0;
    this.active = false;
  }
}

/** User volume and temporary ducking have independent ownership. */
export class MovieSound {
  level = 1;
  muted = false;
  private lastLevel = 1;
  private factor = 1;
  private target = 1;
  private frame = 0;
  constructor(private changed: (gain: number, muted: boolean) => void) {
    try {
      const saved = localStorage.getItem('vs-video-volume');
      const value = saved === null ? 1 : Number(saved);
      if (Number.isFinite(value) && value >= 0 && value <= 1) this.level = value;
      if (this.level > 0) this.lastLevel = this.level;
    } catch {
      /* Private browsing still permits session volume. */
    }
  }
  get effective() {
    return this.level * this.factor;
  }
  setLevel(value: number) {
    if (!Number.isFinite(value)) return;
    this.level = Math.max(0, Math.min(1, value));
    this.muted = false;
    if (this.level > 0) this.lastLevel = this.level;
    try {
      localStorage.setItem('vs-video-volume', String(this.level));
    } catch {}
    this.apply();
  }
  toggleMute(unlock = false) {
    this.muted = unlock ? false : !(this.muted || this.level === 0);
    if (!this.muted && this.level === 0) this.setLevel(this.lastLevel);
    this.apply();
  }
  apply() {
    this.changed(this.effective, this.muted || this.level === 0);
  }
  settle() {
    cancelAnimationFrame(this.frame);
    this.factor = this.target;
    this.apply();
  }
  voice(active: boolean) {
    const target = active ? 0.25 : 1;
    if (target === this.target) return;
    this.target = target;
    cancelAnimationFrame(this.frame);
    if (typeof document !== 'undefined' && document.hidden) {
      this.settle();
      return;
    }
    const start = performance.now(),
      from = this.factor;
    const duration = active ? 100 : 600;
    const tick = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      this.factor = progress === 1 ? target : from + (target - from) * progress;
      this.apply();
      if (progress < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
