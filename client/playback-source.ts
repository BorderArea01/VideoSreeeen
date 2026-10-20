/** A media error does not identify an HTTP status or prove a network restriction. */
export function describePlaybackError(code: number | null, timedOut = false) {
  if (timedOut)
    return { title: '视频加载超时', description: '本机尚未收到可播放的画面，可以重试连接视频源。' };
  if (code === 2)
    return { title: '视频下载中断', description: '本机到视频源的连接中断。重试只影响这台设备。' };
  if (code === 3)
    return {
      title: '视频解码失败',
      description: '此设备未能解码视频，可能与编码兼容性或视频数据有关。可重试或复制诊断。',
    };
  return {
    title: '视频未能加载',
    description: '可能是连接、源站响应或格式兼容问题。可重试本机视频，仍失败时复制诊断。',
  };
}

export function sourceDiagnostics(video: HTMLVideoElement, audio: HTMLAudioElement) {
  let source: { protocol: string; host?: string; port?: string } | null = null;
  try {
    const url = new URL(video.currentSrc || video.getAttribute('src') || '');
    source = { protocol: url.protocol };
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      source.host = /^(?:localhost|[\d.]+|\[.*\])$/.test(url.hostname) ? 'local' : url.hostname;
      source.port = url.port || (url.protocol === 'https:' ? '443' : '80');
    }
  } catch {}
  return {
    source,
    networkState: video.networkState,
    error: video.error
      ? { code: video.error.code, track: 'video' }
      : audio.error
        ? { code: audio.error.code, track: 'audio' }
        : null,
    codecs: {
      h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      hevc: video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.B0"'),
      aac: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    },
  };
}

export function waitForPlayable(video: HTMLMediaElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const dispose = () => {
      signal.removeEventListener('abort', aborted);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
    };
    const loaded = () => {
      dispose();
      resolve();
    };
    const failed = () => {
      dispose();
      reject(new Error('本机视频仍未能加载'));
    };
    const aborted = () => {
      dispose();
      reject(signal.reason);
    };
    signal.addEventListener('abort', aborted, { once: true });
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    if (signal.aborted) aborted();
    else if (video.error) failed();
    else if (video.readyState >= 2) loaded();
  });
}
