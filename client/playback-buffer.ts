/** Explicit seeks and initial joining may load a new region. Automatic catch-up
 * must land in playable data instead of repeatedly restarting a stalled fetch. */
export function canSeekPlayback(
  video: HTMLVideoElement,
  target: number,
  explicit: boolean,
  paused: boolean,
) {
  if (explicit) return true;
  if (video.seeking || video.readyState < 3) return false;
  if (paused) return true;
  if (target <= video.currentTime) return false;
  const end = Number.isFinite(video.duration)
    ? Math.min(video.duration, target + 0.5 * video.playbackRate)
    : target + 0.5 * video.playbackRate;
  for (let i = 0; i < video.buffered.length; i++)
    if (video.buffered.start(i) <= target && video.buffered.end(i) >= end) return true;
  return false;
}
