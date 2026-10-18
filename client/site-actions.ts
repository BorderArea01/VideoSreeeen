type SiteEvent = { available: boolean; frame?: string; seq?: number; action?: string | null };

// Observe idle samples as well as actions, so establishing a frame's baseline
// cannot consume its first real user gesture. Never replay a frame's old event.
export class SiteActions {
  private frame: string | null = null;
  private sequence = -1;
  reset() {
    this.frame = null;
    this.sequence = -1;
  }
  accept(sample: SiteEvent) {
    if (!sample.available || !Number.isSafeInteger(sample.seq) || sample.seq! < 0) return false;
    const frame = sample.frame ?? '';
    if (frame !== this.frame || sample.seq! < this.sequence) {
      this.frame = frame;
      this.sequence = sample.seq!;
      return false;
    }
    if (!sample.action || sample.seq! <= this.sequence) return false;
    this.sequence = sample.seq!;
    return true;
  }
}
