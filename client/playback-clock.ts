/** Bound the playback epoch by request/response intervals, not RTT midpoints.
 * A delayed request or response can make RTT/2 wrong by seconds. Intersecting
 * recent intervals retains the established timeline unless a sample proves it
 * lies outside the possible epoch. This does not change the displayed RTT.
 */
export class PlaybackClock {
  private key = '';
  private anchor = 0;
  private samples: { low: number; high: number; at: number; rtt: number }[] = [];
  private recentRtts: number[] = [];
  reset() {
    this.key = '';
    // Retain the last epoch while a reconnect is pending; the next adopted
    // revision reinitializes it. Offline UI must not jump to process uptime.
    this.samples = [];
    this.recentRtts = [];
  }
  adopt(key: string, ageMs: number, now: number) {
    // Chat, membership and repeated snapshots cannot restart the same revision.
    if (key === this.key) return;
    this.key = key;
    this.samples = [];
    const bestRtt = this.recentRtts.length ? Math.min(...this.recentRtts) : 0;
    this.anchor = now - Math.max(0, ageMs) - bestRtt / 2;
  }
  calibrate(key: string, ageMs: number, rtt: number, now: number) {
    if (
      key !== this.key ||
      ![ageMs, rtt, now].every(Number.isFinite) ||
      ageMs < 0 ||
      rtt < 0 ||
      rtt >= 15000
    )
      return false;
    // Server Date.now() is millisecond-quantized; allow rounding at both ends.
    const sample = { low: now - rtt - ageMs - 2, high: now - ageMs + 2, at: now, rtt };
    const recent = this.samples.filter((s) => now - s.at <= 60000).slice(-11);
    const low = Math.max(sample.low, ...recent.map((s) => s.low));
    const high = Math.min(sample.high, ...recent.map((s) => s.high));
    if (low > high) return false;
    this.samples = [...recent, sample];
    this.recentRtts.push(rtt);
    if (this.recentRtts.length > 12) this.recentRtts.shift();
    this.anchor = Math.max(low, Math.min(high, this.anchor));
    return true;
  }
  elapsed(now: number) {
    return Math.max(0, now - this.anchor);
  }
  diagnostics(now: number) {
    const recent = this.samples.filter((s) => now - s.at <= 60000);
    return {
      samples: recent.length,
      uncertaintyMs: recent.length
        ? Math.max(
            0,
            Math.min(...recent.map((s) => s.high)) - Math.max(...recent.map((s) => s.low)),
          )
        : null,
    };
  }
}
