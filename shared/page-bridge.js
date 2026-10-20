/* GPL-3.0-only. Runs in untrusted site frames; contains no app or room secrets. */
(() => {
  if (window.__VS) return;
  let muteUntil = 0,
    mutedGesture = 0,
    lastGesture = -10000,
    seq = 0,
    action = null,
    actionPosition,
    actionRate,
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
  let focused = null;
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
  const trackUrl = (track) => {
    const urls = [
      track.baseUrl || track.base_url || track.url,
      ...(track.backupUrl || track.backup_url || []),
    ].filter((v) => typeof v === 'string' && /^https?:\/\//.test(v));
    // Use a URL supplied by the original player, preferring ordinary HTTPS
    // endpoints that can also be fetched by browsers and the Node relay.
    return (
      urls.find((v) => {
        try {
          const u = new URL(v);
          return u.protocol === 'https:' && !u.port;
        } catch {
          return false;
        }
      }) ||
      urls.find((v) => v.startsWith('https:')) ||
      urls[0]
    );
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
      const compatibleAudio = dash.audio.filter((a) => (a.codecs || '').startsWith('mp4a'));
      const a = [...(compatibleAudio.length ? compatibleAudio : dash.audio)].sort(
        (a, b) => b.bandwidth - a.bandwidth,
      )[0];
      return {
        kind: 'dash',
        video: trackUrl(v),
        audio: trackUrl(a),
        referer: location.href,
      };
    }
    if (data?.durl?.length === 1)
      return { kind: 'file', video: trackUrl(data.durl[0]), referer: location.href };
    // Current Bilibili players clear __playinfo__ after loading. Their public
    // read-only API exposes the tracks that are actually playing instead.
    // Signed URL queries can contain commas: only split before another URL.
    try {
      if (/^https:\/\/(?:www\.)?bilibili\.com\//i.test(location.href)) {
        const raw = window.player?.getMediaInfo?.().playUrl;
        const tracks = typeof raw === 'string' ? raw.split(/,(?=https?:\/\/)/) : [];
        if (
          tracks.length === 2 &&
          tracks.every((value) => {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
          })
        )
          return { kind: 'dash', video: tracks[0], audio: tracks[1], referer: location.href };
      }
    } catch {}
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
    focus(enabled) {
      if (!enabled) {
        if (focused) {
          for (const [node, style] of focused.styles) {
            if (style === null) node.removeAttribute('style');
            else node.setAttribute('style', style);
          }
          focused.video.controls = focused.controls;
          focused = null;
        }
        return true;
      }
      if (focused) return true;
      const video = current();
      if (!video) return false;
      const target =
        video.closest('.bpx-player-container,.dplayer,.video-js,.xgplayer,.art-video-player') ||
        video;
      const styles = new Map();
      const set = (node, values) => {
        if (!styles.has(node)) styles.set(node, node.getAttribute('style'));
        for (const [key, value] of Object.entries(values))
          node.style.setProperty(key, value, 'important');
      };
      for (let node = target; node?.parentElement; node = node.parentElement) {
        for (const sibling of node.parentElement.children)
          if (sibling !== node) set(sibling, { visibility: 'hidden' });
        set(node.parentElement, {
          transform: 'none',
          filter: 'none',
          perspective: 'none',
          contain: 'none',
          overflow: 'visible',
          visibility: 'visible',
        });
      }
      set(document.documentElement, { overflow: 'hidden' });
      set(target, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        'max-width': 'none',
        'max-height': 'none',
        'z-index': '2147483647',
        'object-fit': 'contain',
        background: '#000',
        visibility: 'visible',
        display: 'block',
      });
      focused = { video, controls: video.controls, styles };
      if (target === video) video.controls = true;
      return true;
    },
    nextEpisode() {
      const page = new URL(location.href);
      if (page.hostname === 'next.xifanacg.com') {
        for (const script of document.scripts) {
          const text = script.textContent.replace(/\\"/g, '"');
          const match = /"nextHref"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch {}
          }
        }
      } else if (['www.mgnacg.com', 'mgnacg.com'].includes(page.hostname)) {
        return window.player_aaaa?.link_next || null;
      } else if (page.hostname === 'www.bilibili.com') {
        const pages = window.__INITIAL_STATE__?.videoData?.pages;
        if (Array.isArray(pages)) {
          const index = pages.findIndex(
            (part) => part.page === Number(page.searchParams.get('p') || 1),
          );
          if (index >= 0 && pages[index + 1]) return page.pathname + '?p=' + pages[index + 1].page;
        }
      }
      return null;
    },
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
              actionPosition = video.currentTime;
              actionRate = video.playbackRate;
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
        readyState: video.readyState,
        frames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
        source: source(video),
        action,
        actionPosition,
        actionRate,
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
      let bufferedTarget = false;
      for (let i = 0; i < video.buffered.length; i++)
        if (
          video.buffered.start(i) <= state.position &&
          video.buffered.end(i) >= Math.min(video.duration, state.position + 0.5 * state.rate)
        )
          bufferedTarget = true;
      if (
        state.seek ||
        (video.readyState >= 3 &&
          (state.paused
            ? Math.abs(delta) > 0.12
            : delta > 1.2 * Math.max(1, state.rate) && bufferedTarget))
      )
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
