/** loadedmetadata/loadeddata alone can precede the first composited frame.
 * Keep source changes cancellable and never accept a callback from an old load. */
export function waitForFirstVideoFrame(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let callback = 0,
      disposed = false;
    const dispose = () => {
      disposed = true;
      if (callback) video.cancelVideoFrameCallback?.(callback);
      for (const name of ['loadeddata', 'canplay', 'seeked'])
        video.removeEventListener(name, check);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const done = () => {
      if (disposed || signal.aborted) return;
      dispose();
      resolve();
    };
    const failed = () => {
      if (!video.error) return;
      dispose();
      reject(new Error('本机视频未能解码首帧'));
    };
    const aborted = () => {
      dispose();
      reject(signal.reason);
    };
    const check = () => {
      if (disposed) return;
      if (typeof video.requestVideoFrameCallback !== 'function') {
        if (video.readyState >= 2 && !video.seeking && video.videoWidth > 0) done();
        return;
      }
      if (callback) return;
      callback = video.requestVideoFrameCallback(() => {
        callback = 0;
        if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0) done();
        else check();
      });
    };
    for (const name of ['loadeddata', 'canplay', 'seeked']) video.addEventListener(name, check);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else if (video.error) failed();
    else check();
  });
}

export const NEXT_START_WAIT_MS = 8000;
export function nextStartReady(
  members: Array<{ online: boolean; playbackReady?: boolean }>,
  elapsed: number,
) {
  return (
    elapsed >= NEXT_START_WAIT_MS ||
    members.every((member) => !member.online || member.playbackReady !== false)
  );
}
