type CapturableMedia = HTMLMediaElement & { captureStream?: () => MediaStream };

export function movieLimiter(context: AudioContext) {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  return limiter;
}

/** Capture only origin-clean playback into a disposable local audio graph.
 * Never permanently bind the shared player with createMediaElementSource:
 * its next movie may be a non-CORS remote source. */
export class MovieBoost {
  private element: CapturableMedia | null = null;
  private key = '';
  private object: HTMLMediaElement['srcObject'] = null;
  private binding?: AbortController;
  private graphEvents?: AbortController;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private blocked = false;
  private pending = false;
  private queued = false;
  constructor(private changed: () => void) {}
  bind(element: HTMLMediaElement | null, key: string) {
    if (
      this.element === element &&
      this.key === key &&
      this.object === (element?.srcObject ?? null)
    )
      return;
    this.binding?.abort();
    this.release();
    this.element = element;
    this.key = key;
    this.object = element?.srcObject ?? null;
    this.blocked = false;
    if (!element) return;
    const binding = (this.binding = new AbortController());
    for (const event of ['loadeddata', 'playing', 'emptied', 'ended'])
      element.addEventListener(
        event,
        () => {
          if (event === 'emptied' || event === 'ended') this.release();
          this.notify();
        },
        { signal: binding.signal },
      );
  }
  get maximum() {
    const element = this.element;
    if (!element || this.blocked || typeof AudioContext === 'undefined' || !element.captureStream)
      return 1;
    if (element.srcObject instanceof MediaStream) return 2;
    try {
      const url = new URL(element.getAttribute('src') || '', location.href);
      // Local cache/MSE blobs and this application's own resources only.
      // This does not change crossOrigin or probe a third-party signed URL.
      return element.getAttribute('src') && url.origin === location.origin ? 2 : 1;
    } catch {
      return 1;
    }
  }
  get active() {
    const tracks = this.stream?.getAudioTracks();
    return (
      this.context?.state === 'running' &&
      !!tracks?.length &&
      tracks.every((track) => track.readyState === 'live' && !track.muted)
    );
  }
  get state() {
    return this.maximum === 1
      ? 'unsupported'
      : this.active
        ? 'active'
        : this.context
          ? 'pending'
          : 'available';
  }
  private notify() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.changed();
    });
  }
  unlock() {
    const context = this.context;
    if (!context || context.state !== 'suspended' || this.pending) return;
    this.pending = true;
    void context
      .resume()
      .catch(() => {
        if (this.context === context) {
          this.blocked = true;
          this.release();
        }
      })
      .finally(() => {
        if (this.context === context) this.pending = false;
        this.notify();
      });
  }
  apply(level: number, muted: boolean, wanted: boolean) {
    if (!wanted || this.maximum === 1) {
      this.release();
      return false;
    }
    const element = this.element!;
    if (!this.context && !muted && element.readyState >= 2 && !element.ended) {
      try {
        const stream = (this.stream = element.captureStream!());
        // These are newly captured tracks, never tracks owned by room voice
        // or by a publisher's original sharing stream.
        stream.getVideoTracks().forEach((track) => track.stop());
        const tracks = stream.getAudioTracks();
        if (!tracks.length) {
          this.release();
          if (!element.paused) this.blocked = true;
          return false;
        }
        const context = (this.context = new AudioContext());
        const events = (this.graphEvents = new AbortController());
        for (const track of tracks)
          for (const event of ['mute', 'unmute', 'ended'])
            track.addEventListener(
              event,
              () => {
                if (event === 'ended') this.release();
                this.notify();
              },
              { signal: events.signal },
            );
        context.addEventListener('statechange', () => this.notify(), { signal: events.signal });
        this.source = context.createMediaStreamSource(new MediaStream(tracks));
        this.gain = context.createGain();
        this.gain.gain.value = muted ? 0 : level;
        const limiter = (this.limiter = movieLimiter(context));
        this.source.connect(this.gain).connect(limiter).connect(context.destination);
        this.unlock();
      } catch {
        this.blocked = true;
        this.release();
        this.notify();
      }
    }
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(muted ? 0 : level, this.context.currentTime, 0.01);
    // Keep native playback audible until the graph is actually running and
    // its captured audio is accessible. A suspension returns to native sound.
    return this.active;
  }
  private release() {
    this.graphEvents?.abort();
    this.graphEvents = undefined;
    this.source?.disconnect();
    this.gain?.disconnect();
    this.limiter?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.source = this.gain = this.limiter = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.pending = false;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  reset() {
    this.binding?.abort();
    this.binding = undefined;
    this.release();
    this.element = null;
    this.key = '';
    this.object = null;
    this.blocked = false;
  }
}
