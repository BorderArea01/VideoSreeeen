/* GPL-3.0-only. Trusted local renderer; chat is always rendered as plain text. */
(() => {
  if (window.__VS_Danmaku) return;
  let root, host, timer, observer;
  let enabled = true,
    queue = [],
    slots = [];
  const active = new Set();
  let viewport = '';
  const clear = () => {
    clearTimeout(timer);
    queue = [];
    slots = [];
    for (const item of active) {
      item.animation.cancel();
      item.node.remove();
    }
    active.clear();
  };
  const resize = () => {
    let width = host.clientWidth,
      height = host.clientHeight;
    const video = host.querySelector('video');
    if (video?.videoWidth && video.videoHeight) {
      const aspect = video.videoWidth / video.videoHeight;
      if (width / height > aspect) width = height * aspect;
      else height = width / aspect;
    }
    const signature = `${host.clientWidth}:${host.clientHeight}:${width}:${height}`;
    if (viewport === signature) return;
    viewport = signature;
    clear();
    Object.assign(root.style, {
      inset: 'auto',
      left: (host.clientWidth - width) / 2 + 'px',
      top: (host.clientHeight - height) / 2 + 'px',
      width: width + 'px',
      height: height + 'px',
    });
  };
  const mount = (target) => {
    if (host === target && root?.isConnected) return;
    clear();
    observer?.disconnect();
    root?.remove();
    host = target;
    root = document.createElement('div');
    root.className = 'danmaku-layer';
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '20',
    });
    host.append(root);
    viewport = '';
    resize();
    if (window.ResizeObserver) {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    }
  };
  const textOf = (value) => {
    const text = value.replace(/[\r\n\t]+/g, ' ').trim();
    const chars =
      typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
            (s) => s.segment,
          )
        : Array.from(text);
    return chars.slice(0, 80).join('') + (chars.length > 80 ? '…' : '');
  };
  const drain = () => {
    clearTimeout(timer);
    if (!enabled || !root?.isConnected || document.hidden) {
      clear();
      return;
    }
    const now = performance.now(),
      width = root.clientWidth,
      height = root.clientHeight;
    if (width < 100 || height < 60) {
      clear();
      return;
    }
    const count = Math.max(1, Math.min(5, Math.floor((height * 0.44) / 32)));
    slots.length = count;
    queue = queue.filter((item) => now - item.at < 4000);
    while (queue.length && active.size < 24) {
      const lane = Array.from({ length: count }, (_, i) => i).find((i) => (slots[i] ?? 0) <= now);
      if (lane === undefined) break;
      const item = queue.shift(),
        node = document.createElement('span');
      node.className = 'danmaku-item';
      node.textContent = item.text;
      Object.assign(node.style, {
        position: 'absolute',
        left: '0',
        top: 12 + lane * 32 + 'px',
        whiteSpace: 'pre',
        font: `600 ${width < 500 ? 18 : 22}px system-ui, "Segoe UI Emoji", sans-serif`,
        color: '#fff',
        textShadow: '0 1px 3px #000, 1px 0 2px #000, -1px 0 2px #000',
        willChange: 'transform',
      });
      root.append(node);
      const size = node.getBoundingClientRect().width,
        speed = width / 7 + 60;
      slots[lane] = now + ((size + 48) / speed) * 1000;
      const animation = node.animate(
        [{ transform: `translateX(${width}px)` }, { transform: `translateX(${-size}px)` }],
        { duration: ((width + size) / speed) * 1000, easing: 'linear', fill: 'forwards' },
      );
      const entry = { node, animation };
      active.add(entry);
      animation.onfinish = () => {
        active.delete(entry);
        node.remove();
      };
    }
    if (queue.length)
      timer = setTimeout(drain, Math.min(250, Math.max(30, Math.min(...slots) - now)));
  };
  window.__VS_Danmaku = {
    push(messages, target = document.body) {
      if (!enabled || document.hidden || !Array.isArray(messages)) return;
      mount(target);
      resize();
      for (const item of messages.slice(-20)) {
        if (typeof item?.text !== 'string') continue;
        const text = textOf(item.text.slice(0, 4000));
        if (text) queue.push({ text, at: performance.now() });
      }
      queue = queue.slice(-20);
      drain();
    },
    clear,
    enable(value) {
      enabled = !!value;
      if (!enabled) clear();
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });
})();
