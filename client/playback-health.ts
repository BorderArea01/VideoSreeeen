/** Detect a stalled local decoder, independently of the room's playback state. */
export class PlaybackHealth {
  private position = -1;
  private frames = -1;
  private advancedAt = 0;
  private attempted = false;
  reset() {
    this.position = this.frames = -1;
    this.advancedAt = 0;
    this.attempted = false;
  }
  check(video: HTMLVideoElement, now = performance.now()) {
    const position = video.currentTime;
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
    if (frames > this.frames || (frames < 0 && Math.abs(position - this.position) > 0.05)) {
      this.position = position;
      this.frames = frames;
      this.advancedAt = now;
      this.attempted = false;
      return false;
    }
    if (
      video.ended ||
      video.seeking ||
      video.error ||
      this.attempted ||
      now - this.advancedAt < 6000
    )
      return false;
    let ahead = 0;
    for (let i = 0; i < video.buffered.length; i++)
      if (video.buffered.start(i) <= position + 0.1 && video.buffered.end(i) > position)
        ahead = Math.max(ahead, video.buffered.end(i) - position);
    // Do not restart a download that is still buffering normally. A decoder with
    // playable data (or an idle loader) can be nudged once without a room command.
    if (ahead < 0.25 && video.readyState < 3 && video.networkState === 2) return false;
    this.attempted = true;
    return true;
  }
}
