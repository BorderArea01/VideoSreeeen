(() => {
  const profiles = {
    A: {
      name: '云隙细切',
      subtitle: 'B1 / 云白面板 · 短促细切',
      character: 'FINE CLOUD CUTS',
      background: '晴空中细密的短切片在经过处展开，留出完整的视频区域。',
      surface: '云白面板 90% 不透明，外围约 8% 细切，主体与文字完整。',
      button: '短而细的边缘错位，低幅度收束。',
      seed: 37.8,
      palette: ['#e4f5ff', '#f1faff', '#c5e1f1', '#a7ccdf'],
      accent: '#316f9e',
      density: 8,
      backgroundCount: 20,
      band: 5,
      motion: 0.38,
      duration: 1050,
      group: 1,
    },
    B: {
      name: '浮云叠片',
      subtitle: 'B2 / 云白面板 · 薄片悬浮',
      character: 'FLOATING LAYERS',
      background: '几片较宽的云层带着惯性上下错开，不侵入视频画面。',
      surface: '云白面板 90% 不透明，外围约 8% 以宽薄片轻轻分离。',
      button: '两三组薄片延迟浮起后合拢，保留清楚轮廓。',
      seed: 96.2,
      palette: ['#eef7fd', '#ffffff', '#d3e5ef', '#acc9dc'],
      accent: '#3e7296',
      density: 13,
      backgroundCount: 12,
      band: 11,
      motion: 0.46,
      duration: 1450,
      group: 3,
    },
    C: {
      name: '冰蓝拖影',
      subtitle: 'B3 / 冰蓝面板 · 横向熔合',
      character: 'ICY DATA TRAILS',
      background: '少量云层像素拉成细长拖影，轻微青蓝色偏。',
      surface: '冰蓝面板 90% 不透明，外围约 8% 保留更长、更淡的熔合尾迹。',
      button: '边缘短暂拉长后缓慢回收，文字不移动。',
      seed: 57.9,
      palette: ['#dff3fa', '#edfaff', '#b8dfeb', '#91bfd3'],
      accent: '#2d738e',
      density: 7,
      backgroundCount: 18,
      band: 6,
      motion: 0.4,
      duration: 1550,
      group: 1,
    },
    D: {
      name: '晴空散页',
      subtitle: 'B4 / 淡紫云白 · 成组错层',
      character: 'SCATTERED CLOUD SHEETS',
      background: '疏密交错的宽窄云片分组移动，零散像素在外侧散开。',
      surface: '淡紫云白面板 90% 不透明，外围约 8% 成组错开，碎块更稀疏。',
      button: '边缘小组错帧、轻微上浮，然后各自归位。',
      seed: 18.5,
      palette: ['#e9effc', '#f6f8ff', '#ccd9ed', '#adbddd'],
      accent: '#586f9a',
      density: 11,
      backgroundCount: 14,
      band: 8,
      motion: 0.44,
      duration: 1250,
      group: 2,
    },
  };
  const root = document.documentElement;
  const canvas = document.getElementById('sky');
  const base = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const bctx = base.getContext('2d', { alpha: false });
  const image = new Image();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const noise = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  let variant = 'A',
    width = 1,
    height = 1,
    scale = 1,
    frame = 0,
    lastFrame = 0;
  let impulses = [],
    lastSpawn = -Infinity,
    previous = { x: 0, y: 0, t: 0 };
  const pieces = [],
    cues = new Set();
  const EDGE_AREA = 0.08;
  const VIDEO_CLEARANCE = 12;
  const isEmbed = new URLSearchParams(location.search).has('embed');
  if (isEmbed)
    for (const s of ['.review-bar', '.design-notes', 'footer'])
      document.querySelector(s).hidden = true;
  function later(fn, delay) {
    const id = setTimeout(() => {
      cues.delete(id);
      fn();
    }, delay);
    cues.add(id);
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    scale = Math.min(
      devicePixelRatio || 1,
      1.2,
      Math.sqrt(1_400_000 / Math.max(1, box.width * box.height)),
    );
    width = canvas.width = base.width = Math.max(1, Math.round(box.width * scale));
    height = canvas.height = base.height = Math.max(1, Math.round(box.height * scale));
    bctx.fillStyle = '#479bd1';
    bctx.fillRect(0, 0, width, height);
    if (image.complete && image.naturalWidth) {
      const fit = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      bctx.drawImage(
        image,
        (width - image.naturalWidth * fit) / 2,
        (height - image.naturalHeight * fit) / 2,
        image.naturalWidth * fit,
        image.naturalHeight * fit,
      );
    }
    for (const p of pieces) fitPiece(p);
    paint(performance.now());
  }
  function blit(c, sx, sy, sw, sh, dx, dy, dw, dh) {
    sx = clamp(sx, 0, width - 1);
    sy = clamp(sy, 0, height - 1);
    sw = clamp(sw, 1, width - sx);
    sh = clamp(sh, 1, height - sy);
    if (dw > 0 && dh > 0) c.drawImage(base, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  // Fixed corruption is cut from the actual photograph, not drawn as border dots.
  function tear(c, x, y, seed, energy, age = 0) {
    const style = profiles[variant],
      count = style.backgroundCount;
    seed += style.seed;
    for (let i = 0; i < count; i++) {
      const r = noise(seed + i * 3),
        sign = i % 3 === 0 ? -1 : 1;
      const sh = (2 + r * style.band) * scale;
      const sy = clamp(y + (i - count / 2) * style.band * scale, 0, height - sh);
      const length = (45 + noise(i + seed + 5) * 160) * scale * (0.7 + energy * 0.3);
      const sx = clamp(x - length * 0.35 + sign * r * 50 * scale, 0, width - 1);
      const slide = sign * (8 + r * 45) * energy * scale * style.motion;
      const stretch = variant === 'A' || variant === 'C';
      c.globalAlpha = clamp((0.58 + r * 0.35) * energy, 0, 1);
      blit(
        c,
        sx,
        sy,
        stretch ? 3 + r * 22 : length,
        sh,
        sx + slide,
        sy + (variant === 'B' ? Math.sin(i) * age * 18 * scale : 0),
        length,
        sh,
      );
      if (i % 5 === 0) {
        c.fillStyle = i % 2 ? '#ff7795' : '#8cefff';
        c.globalAlpha = 0.15 * energy;
        c.fillRect(sx + slide + 3 * scale, sy, length * 0.7, Math.max(1, sh * 0.15));
      }
      if (i % 4 === 0) {
        const size = (4 + r * 9) * scale;
        const px = sx + slide + length + (12 + age * 55) * scale;
        blit(c, sx, sy, 10, 10, px, sy - (8 + age * 20) * scale, size, size);
      }
    }
    c.globalAlpha = 1;
  }
  function paint(now) {
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);
    // Decoration never paints inside the video or its 12px clearance, even behind it.
    const film = document.querySelector('.screen').getBoundingClientRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(
      (film.left - VIDEO_CLEARANCE) * scale,
      (film.top - VIDEO_CLEARANCE) * scale,
      (film.width + VIDEO_CLEARANCE * 2) * scale,
      (film.height + VIDEO_CLEARANCE * 2) * scale,
    );
    ctx.clip('evenodd');
    tear(ctx, width * 0.015, height * 0.22, 13, 0.83);
    tear(ctx, width * 0.85, height * 0.64, 31, 0.87);
    tear(ctx, width * 0.46, height * 0.9, 64, 0.6);
    if (!reduced.matches)
      for (const p of impulses) {
        const age = (now - p.t) / 1800;
        if (age < 0 || age > 1) continue;
        const e = Math.sin(Math.PI * Math.min(1, age * 1.65)) * (1 - age * 0.65) * p.amp;
        tear(ctx, p.x + p.dx * age * 45 * scale, p.y, p.seed, Math.max(0, e), age);
      }
    ctx.restore();
  }
  function spawn(x, y, vx = 0, vy = 0, force = false) {
    if (reduced.matches) return;
    const now = performance.now();
    if (!force && (now - lastSpawn < 125 || Math.hypot(vx, vy) < 0.12)) return;
    lastSpawn = now;
    impulses.push({
      x: x * scale,
      y: y * scale,
      t: now + 60,
      amp: clamp(Math.hypot(vx, vy) * 0.6 + 0.6, 0.6, 1.7),
      dx: clamp(vx, -1, 1),
      seed: Math.random() * 80,
    });
    if (impulses.length > 5) impulses.shift();
    wake();
  }
  // Only an 8% perimeter band may break. The center and text backings stay intact.
  // Hit targets and accessible text remain real DOM, independent of decoration.
  function fitPiece(p) {
    const b = p.el.getBoundingClientRect();
    p.w = b.width;
    p.h = b.height;
    p.protected = [];
    const walker = document.createTreeWalker(p.el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('.fractured') !== p.el) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        if (r.width && r.height)
          p.protected.push({
            x: r.left - b.left - 4,
            y: r.top - b.top - 2,
            w: r.width + 8,
            h: r.height + 4,
          });
      range.detach();
    }
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    p.c.width = Math.ceil((p.w + 96) * dpr);
    p.c.height = Math.ceil((p.h + 80) * dpr);
    p.c.style.width = `${p.w + 96}px`;
    p.c.style.height = `${p.h + 80}px`;
    const film = document.querySelector('.screen').getBoundingClientRect();
    const canvasBox = p.c.getBoundingClientRect();
    p.videoCut = {
      x: film.left - canvasBox.left - VIDEO_CLEARANCE,
      y: film.top - canvasBox.top - VIDEO_CLEARANCE,
      w: film.width + VIDEO_CLEARANCE * 2,
      h: film.height + VIDEO_CLEARANCE * 2,
    };
    p.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPiece(p, 0, 0);
  }
  function drawPiece(p, energy, phase) {
    const { g, w, h, button } = p;
    if (w < 1 || h < 1) return;
    g.clearRect(0, 0, w + 96, h + 80);
    const light = true,
      primary = p.el.classList.contains('primary');
    const style = profiles[variant],
      palette = style.palette,
      accent = style.accent;
    const density = style.density;
    const strips = button ? 13 : Math.max(22, Math.min(46, Math.round(h / density)));
    const seed = p.seed + style.seed;
    const heights = Array.from({ length: strips }, (_, i) => 0.5 + noise(seed + i * 2.7) * 1.8);
    const total = heights.reduce((a, b) => a + b, 0);
    let cursor = 0;
    const power = style.motion * (0.25 + energy);
    g.save();
    g.translate(48, 40);
    const body = primary
      ? accent
      : button
        ? light
          ? p.el.classList.contains('active')
            ? '#c0dcec'
            : '#d4e9f5'
          : p.el.classList.contains('active')
            ? '#315c76'
            : '#1d3b53'
        : palette[0];
    g.globalAlpha = 1;
    g.fillStyle = body;
    g.fillRect(0, 0, w, h);
    const edge = (w + h - Math.sqrt((w + h) ** 2 - 4 * EDGE_AREA * w * h)) / 4;
    const edgeX = edge,
      edgeY = edge;
    g.save();
    g.beginPath();
    g.rect(-48, -40, w + 96, h + 80);
    g.rect(edgeX, edgeY, w - edgeX * 2, h - edgeY * 2);
    g.clip('evenodd');
    g.clearRect(-48, -40, w + 96, h + 80);
    for (let i = 0; i < strips; i++) {
      const r = noise(seed + i * 1.7),
        sign = i % 2 ? 1 : -1;
      const group = Math.floor(i / style.group);
      const fault = i % 7 === 1 || i % 7 === 2 || i % 11 === 6;
      const shear =
        energy *
        Math.sin(group * 1.7 + phase * 5 + (p.burstSeed || 0)) *
        (button ? 3 : 9) *
        style.motion *
        (p.dir || 1);
      const shift =
        Math.sin(group * 4.3 + seed) * (button ? 11 : 29) * power * (fault ? 1 : 0.18) +
        (fault ? shear : 0);
      const inset = i < 2 || i > strips - 3 ? 3 + r * 7 : r * 2;
      const gap = fault ? (button ? 0.5 : 1.8) + energy * 0.5 : -0.3;
      const stripHeight = (heights[i] / total) * h;
      const yy = cursor + (style.group > 1 && fault ? sign * energy * 1.5 : 0);
      cursor += stripHeight;
      const hh = Math.max(0.8, stripHeight - gap),
        tail = (i % 6 === 1 ? (button ? 4 : variant === 'C' ? 28 : 16) : 0) * power;
      g.globalAlpha = 1;
      g.fillStyle = button ? body : palette[fault && i % 3 === 1 ? 1 : 0];
      g.fillRect(inset + shift, yy, w - inset * 2 + tail, hh);
      if ((!button && i % 5 === 1) || (button && i % 5 === 3)) {
        g.globalAlpha = primary ? 0.22 : light ? 0.25 : 0.32;
        blit(
          g,
          width * noise(seed + i),
          height * noise(i + seed + 2),
          variant === 'C' ? 2 : 14,
          6,
          shift + inset,
          yy,
          w * (0.35 + r * 0.65) + tail,
          hh,
        );
      }
      if (i % 6 === 1 || i % 11 === 4) {
        g.globalAlpha = 0.28;
        g.fillStyle = i % 2 ? '#ef86a6' : '#8cf3ff';
        g.fillRect(shift + inset + sign * 3, yy + hh - 1, w * (0.45 + r * 0.4), 0.8);
      }
      if (variant === 'C' && fault && !primary) {
        const smear = g.createLinearGradient(w * 0.2, 0, w * 0.9, 0);
        smear.addColorStop(0, '#7db6dd00');
        smear.addColorStop(0.45, '#7d9ecb');
        smear.addColorStop(0.67, '#b08ea7');
        smear.addColorStop(1, '#699ac000');
        g.globalAlpha = 0.24 + energy * 0.1;
        g.fillStyle = smear;
        g.fillRect(shift + w * 0.2, yy, w * 0.8 + tail, hh);
      }
      if (i % (button ? 6 : 8) === 2) {
        const side = i % 3 ? 1 : -1,
          distance = (button ? 3 : 5) + r * 4 + energy * (4 + r * 5);
        const px = side > 0 ? w + distance : -distance - (button ? 4 : 8);
        const pw = button ? 2 + r * 4 : 4 + r * 8,
          py = yy + sign * (2 + energy * 3);
        g.globalAlpha = 0.7 - energy * 0.08;
        g.fillStyle = primary ? accent : palette[2];
        g.fillRect(px, py, pw, Math.max(2, hh * 0.6));
        if (!button && i % 2 === 0) {
          g.globalAlpha = 0.8;
          blit(
            g,
            width * r,
            height * r,
            9,
            9,
            px + side * 4,
            py - 4 - phase * 3,
            3 + r * 3,
            3 + r * 3,
          );
        }
      }
    }
    g.restore();
    // Protect text even when a label sits in the outer band (e.g. a panel heading).
    g.globalAlpha = 1;
    g.fillStyle = body;
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    for (const r of p.protected || []) g.fillRect(r.x, r.y, r.w, r.h);
    g.restore();
    g.restore();
    // Clear overhang from every card/button, regardless of DOM stacking order.
    const cut = p.videoCut;
    if (cut)
      g.clearRect(
        Math.floor(cut.x),
        Math.floor(cut.y),
        Math.ceil(cut.x + cut.w) - Math.floor(cut.x),
        Math.ceil(cut.y + cut.h) - Math.floor(cut.y),
      );
    g.globalAlpha = 1;
    p.c.dataset.fragments = String(strips);
    p.c.dataset.energy = energy.toFixed(3);
    p.c.dataset.edgeRatio = String(EDGE_AREA);
  }
  function feedback(p) {
    if (reduced.matches || !p) return;
    p.t = performance.now();
    p.duration = profiles[variant].duration;
    p.force = clamp(Math.hypot(previous.vx || 0, previous.vy || 0) * 0.2 + 0.8, 0.8, 1.3);
    p.burstSeed = Math.random() * 12;
    p.dir = previous.vx < 0 ? -1 : 1;
    p.c.dataset.active = 'true';
    wake();
  }
  function wake() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    if (document.hidden || reduced.matches) return;
    if (now - lastFrame > 32) {
      lastFrame = now;
      impulses = impulses.filter((p) => now - p.t < 1800);
      paint(now);
      for (const p of pieces)
        if (p.t) {
          const age = clamp((now - p.t) / p.duration, 0, 1);
          const e = Math.sin(Math.PI * Math.pow(age, 0.55)) * (1 - age * 0.5) * p.force;
          drawPiece(p, e, age);
          if (age === 1) {
            p.t = 0;
            p.c.dataset.active = 'false';
          }
        }
    }
    if (impulses.length || pieces.some((p) => p.t)) wake();
  }
  function cancelAll() {
    for (const id of cues) clearTimeout(id);
    cues.clear();
    impulses = [];
    cancelAnimationFrame(frame);
    frame = 0;
    for (const p of pieces) {
      p.t = 0;
      p.c.dataset.active = 'false';
      drawPiece(p, 0, 0);
    }
  }
  for (const [i, el] of [
    ...document.querySelectorAll('.surface:not(.screen),.action,.mode'),
  ].entries()) {
    const c = document.createElement('canvas');
    c.className = 'fracture-canvas';
    c.setAttribute('aria-hidden', 'true');
    el.prepend(c);
    const p = {
      el,
      c,
      g: c.getContext('2d'),
      button: el.matches('button'),
      seed: i * 9.32,
      t: 0,
      w: 0,
      h: 0,
    };
    pieces.push(p);
    el.classList.add('fractured');
    el.addEventListener('pointerenter', () => feedback(p));
    el.addEventListener('pointerdown', () => feedback(p));
    el.addEventListener('pointermove', () => {
      if (
        Math.hypot(previous.vx || 0, previous.vy || 0) > 0.4 &&
        (!p.t || performance.now() - p.t > 750)
      )
        feedback(p);
    });
    if (p.button)
      el.addEventListener('click', () => {
        feedback(p);
        if (el.type !== 'submit') {
          const notice = document.getElementById('notice');
          notice.hidden = false;
          clearTimeout(notice.timer);
          notice.timer = setTimeout(() => (notice.hidden = true), 1800);
        }
      });
  }
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const p = pieces.find((x) => x.el === entry.target);
      if (p) fitPiece(p);
    }
  });
  for (const p of pieces) observer.observe(p.el);
  function selectVariant() {
    variant = Object.hasOwn(profiles, location.hash.slice(1).toUpperCase())
      ? location.hash.slice(1).toUpperCase()
      : 'A';
    root.dataset.variant = variant;
    cancelAll();
    const p = profiles[variant];
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--panel', p.palette[0]);
    document.getElementById('direction-title').textContent = p.name;
    document.getElementById('direction-subtitle').textContent = p.subtitle;
    document.getElementById('notes-title').textContent =
      `B${Object.keys(profiles).indexOf(variant) + 1} / ${p.name}`;
    document.getElementById('character').textContent = p.character;
    document.getElementById('chapter').textContent = String(
      Object.keys(profiles).indexOf(variant) + 1,
    ).padStart(2, '0');
    for (const type of ['background', 'surface', 'button'])
      document.getElementById('note-' + type).textContent = p[type];
    for (const a of document.querySelectorAll('nav a'))
      a.setAttribute('aria-current', String(a.hash === '#' + variant));
    resize();
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' || reduced.matches) return;
      const now = performance.now(),
        dt = Math.max(8, now - previous.t),
        vx = (e.clientX - previous.x) / dt,
        vy = (e.clientY - previous.y) / dt;
      if (previous.t && now - previous.t < 140 && !e.target.closest('.screen,.review-bar'))
        spawn(e.clientX, e.clientY, vx, vy);
      previous = { x: e.clientX, y: e.clientY, t: now, vx, vy };
    },
    { passive: true },
  );
  document.getElementById('demonstrate').onclick = () => {
    cancelAll();
    [
      [0.08, 0.27],
      [0.33, 0.5],
      [0.69, 0.24],
      [0.94, 0.65],
    ].forEach(([x, y], i) =>
      later(() => spawn(innerWidth * x, innerHeight * y, 1.4, 0.2, true), i * 150),
    );
    for (const p of pieces)
      if (p.el.closest('.source,.members,.voice,.chat,.top-actions'))
        later(() => feedback(p), p.button ? 340 : 150);
  };
  document.getElementById('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    const el = document.createElement('div');
    el.className = 'message mine';
    const text = document.createElement('p');
    text.textContent = input.value;
    el.append(text);
    const messages = document.getElementById('chat-messages');
    messages.append(el);
    while (messages.children.length > 8) messages.firstElementChild.remove();
    input.value = '';
    messages.scrollTop = messages.scrollHeight;
    const chatPiece = pieces.find((p) => p.el.matches('.chat'));
    if (chatPiece) fitPiece(chatPiece);
  };
  window.addEventListener('hashchange', selectVariant);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  reduced.addEventListener('change', () => {
    cancelAll();
    resize();
    document.getElementById('motion-status').textContent = reduced.matches
      ? '减少动态效果已启用 · 保留静态破碎造型'
      : '动态交互已启用';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAll();
    else resize();
  });
  image.onload = resize;
  image.src = 'sky.webp';
  selectVariant();
})();
