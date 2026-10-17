/* GPL-3.0-only. Runs in untrusted site frames; contains no app or room secrets. */
(() => {
  if (window.__VS) return;
  let muteUntil = 0,
    mutedGesture = 0,
    lastGesture = -10000,
    seq = 0,
    action = null,
    catchingUp = false;
  const bound = new WeakSet();
  const videoList = (root = document) => {
    const videos = [...root.querySelectorAll('video')];
    for (const node of root.querySelectorAll('*'))
      if (node.shadowRoot) videos.push(...videoList(node.shadowRoot));
    return videos;
  };
  let cachedVideo = null,
    lastScan = 0;
  const current = () => {
    const now = performance.now();
    if (cachedVideo?.isConnected && now - lastScan < 1500) return cachedVideo;
    lastScan = now;
    cachedVideo = videoList()
      .filter((v) => Number.isFinite(v.duration) && v.duration > 1)
      .sort(
        (a, b) =>
          b.clientWidth * b.clientHeight +
          b.duration -
          (a.clientWidth * a.clientHeight + a.duration),
      )[0];
    return cachedVideo;
  };
  for (const event of ['pointerdown', 'keydown', 'touchstart'])
    document.addEventListener(
      event,
      () => {
        lastGesture = performance.now();
      },
      { capture: true, passive: true },
    );
  function source(video) {
    const direct = video.currentSrc || video.src;
    if (/^https?:/.test(direct))
      return {
        kind: /\.m3u8(?:\?|$)/i.test(direct) ? 'hls' : 'file',
        video: direct,
        referer: location.href,
      };
    const data = window.__playinfo__?.data;
    const dash = data?.dash;
    if (dash?.video?.length && dash?.audio?.length) {
      const v =
        [...dash.video]
          .filter((v) => (v.codecs || '').startsWith('avc'))
          .sort((a, b) => b.height - a.height)
          .find((v) => v.height <= 1080) || dash.video[0];
      const a = [...dash.audio].sort((a, b) => b.bandwidth - a.bandwidth)[0];
      return {
        kind: 'dash',
        video: v.baseUrl || v.base_url,
        audio: a.baseUrl || a.base_url,
        referer: location.href,
      };
    }
    if (data?.durl?.length === 1)
      return { kind: 'file', video: data.durl[0].url, referer: location.href };
    try {
      const player = window.player_aaaa;
      let raw = player?.url;
      if (player?.encrypt === 2) raw = decodeURIComponent(atob(raw));
      else if (player?.encrypt === 1) raw = decodeURIComponent(raw);
      if (/^https?:/.test(raw) && /\.(m3u8|mp4)(?:\?|$)/i.test(raw))
        return { kind: /\.m3u8/i.test(raw) ? 'hls' : 'file', video: raw, referer: location.href };
    } catch {}
    return null;
  }
  window.__VS = {
    sample() {
      const video = current();
      if (!video) return { available: false, title: document.title };
      if (!bound.has(video)) {
        bound.add(video);
        for (const [event, intent] of [
          ['play', 'play'],
          ['pause', 'pause'],
          ['seeked', 'seek'],
          ['ratechange', 'rate'],
        ])
          video.addEventListener(event, () => {
            if (
              (performance.now() > muteUntil || lastGesture > mutedGesture) &&
              performance.now() - lastGesture < 1600
            ) {
              seq++;
              action = intent;
            }
          });
        video.addEventListener('ended', () => {
          seq++;
          action = 'ended';
        });
      }
      return {
        available: true,
        title: document.title,
        position: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        rate: video.playbackRate,
        source: source(video),
        action,
        seq,
        frame: location.href,
      };
    },
    apply(state) {
      const video = current();
      if (!video) return;
      // A new gesture owns the local player until its event has been reported.
      // Continuous reconciliation must never keep manual controls permanently muted.
      if (performance.now() - lastGesture < 1000 || video.seeking) return;
      muteUntil = performance.now() + 800;
      mutedGesture = lastGesture;
      const delta = state.position - video.currentTime;
      if (state.seek || Math.abs(delta) > (state.paused ? 0.12 : 1.2 * Math.max(1, state.rate)))
        video.currentTime = Math.max(0, Math.min(state.position, video.duration || state.position));
      catchingUp = !state.paused && Math.abs(delta) > (catchingUp ? 0.06 : 0.3);
      const rate = catchingUp ? state.rate * (1 + Math.sign(delta) * 0.06) : state.rate;
      if (Math.abs(video.playbackRate - rate) > 0.001)
        video.playbackRate = Math.min(4, Math.max(0.25, rate));
      if (state.paused && !video.paused) video.pause();
      if (!state.paused && video.paused) video.play().catch(() => {});
    },
  };
  if (window.VSProbe) {
    window.VSProbe.onmessage = (e) => {
      try {
        window.__VS.apply(JSON.parse(e.data));
      } catch {}
    };
    setInterval(() => {
      try {
        window.VSProbe.postMessage(JSON.stringify(window.__VS.sample()));
      } catch {}
    }, 700);
  }
})();
