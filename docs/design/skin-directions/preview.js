(() => {
  const profiles = {
    A: {
      name: '像素断流',
      subtitle: '横向排序 / 蓝天被拉成数据流',
      character: 'PIXEL SORTING',
      background: '照片被抽成细密横向像素流；扫过后断层在原处扩张、拉长、散去。',
      surface: '深蓝容器本体切成不等高碎条，间隙透出天空，侧边悬浮脱落块。',
      button: '十余层横切片交错拉伸，青蓝与淡红通道轻微分离。',
    },
    B: {
      name: '悬浮碎层',
      subtitle: '悬空切片 / 云白结构解体',
      character: 'SUSPENDED FRAGMENTS',
      background: '云层断成水平长片，带着独立惯性散开，保留晴空与自然日光。',
      surface: '云白实体切为多层悬浮薄片；断口、长条和离体碎块同时可见。',
      button: '白蓝条带依次崩开，向上下错层漂移后重组。',
    },
    C: {
      name: '数据熔合',
      subtitle: '帧间拖影 / 数字文件损坏',
      character: 'DATAMOSH',
      background: '局部像素被重复拉伸、黏连成宽幅拖影，旧画面像损坏帧一样滞留。',
      surface: '墨蓝面板撕成条带，局部内容材质被抽长，青紫熔合残影穿过本体。',
      button: '碎条先拉成长尾、相互熔接，再回到可辨认的按钮轮廓。',
    },
    D: {
      name: '错帧崩解',
      subtitle: '水平撕裂 / 碎片离轨',
      character: 'FRAME RUPTURE',
      background: '宽窄交错的断帧横贯天空，碎块沿不同方向脱离，带轻微 RGB 偏移。',
      surface: '深色容器大范围错层；多组横条从本体滑脱，留出参差断口。',
      button: '成组碎层错帧跳开，离体像素短暂悬浮，最后收束。',
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
    const count = variant === 'A' ? 32 : variant === 'B' ? 16 : variant === 'C' ? 25 : 23;
    for (let i = 0; i < count; i++) {
      const r = noise(seed + i * 3),
        sign = i % 3 === 0 ? -1 : 1;
      const sh = (variant === 'B' ? 5 + r * 15 : 2 + r * 8) * scale;
      const sy = clamp(y + (i - count / 2) * (variant === 'B' ? 10 : 5) * scale, 0, height - sh);
      const length = (80 + noise(i + seed + 5) * 260) * scale * (0.7 + energy * 0.5);
      const sx = clamp(x - length * 0.35 + sign * r * 50 * scale, 0, width - 1);
      const slide = sign * (12 + r * (variant === 'D' ? 100 : 65)) * energy * scale;
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
    tear(ctx, width * 0.015, height * 0.22, 13, 0.83);
    tear(ctx, width * 0.85, height * 0.64, 31, 0.87);
    tear(ctx, width * 0.46, height * 0.9, 64, 0.6);
    if (reduced.matches) return;
    for (const p of impulses) {
      const age = (now - p.t) / 1800;
      if (age < 0 || age > 1) continue;
      const e = Math.sin(Math.PI * Math.min(1, age * 1.65)) * (1 - age * 0.65) * p.amp;
      tear(ctx, p.x + p.dx * age * 45 * scale, p.y, p.seed, Math.max(0, e), age);
    }
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
  // The panel has no rectangular CSS fill: its body is separated, transparent slices.
  // Hit targets and accessible text remain real DOM, independent of the visual pieces.
  function fitPiece(p) {
    const b = p.el.getBoundingClientRect();
    p.w = b.width;
    p.h = b.height;
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    p.c.width = Math.ceil((p.w + 96) * dpr);
    p.c.height = Math.ceil((p.h + 80) * dpr);
    p.c.style.width = `${p.w + 96}px`;
    p.c.style.height = `${p.h + 80}px`;
    p.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPiece(p, 0, 0);
  }
  function drawPiece(p, energy, phase) {
    const { g, w, h, button } = p;
    if (w < 1 || h < 1) return;
    g.clearRect(0, 0, w + 96, h + 80);
    const light = variant === 'B',
      primary = p.el.classList.contains('primary');
    const palette = light
      ? ['#e4f5ff', '#f1faff', '#c5e1f1', '#a7ccdf']
      : variant === 'C'
        ? ['#192d42', '#3b415a', '#40506b', '#746b83']
        : variant === 'D'
          ? ['#101e35', '#172d44', '#1c354d', '#24435b']
          : ['#102d47', '#163d59', '#214e6a', '#325f7d'];
    const accent = light ? '#316f9e' : variant === 'C' ? '#b8c2eb' : '#b2e9fa';
    const density = variant === 'A' ? 5 : variant === 'B' ? 11 : variant === 'D' ? 9 : 7;
    const strips = button ? 13 : Math.max(22, Math.min(46, Math.round(h / density)));
    const seed = p.seed + variant.charCodeAt(0) * 3;
    const heights = Array.from({ length: strips }, (_, i) => 0.5 + noise(seed + i * 2.7) * 1.8);
    const total = heights.reduce((a, b) => a + b, 0);
    let cursor = 0;
    const power = (variant === 'D' ? 1.2 : variant === 'B' ? 0.9 : 1) * (0.32 + energy);
    g.save();
    g.translate(48, 40);
    for (let i = 0; i < strips; i++) {
      const r = noise(seed + i * 1.7),
        sign = i % 2 ? 1 : -1;
      const group = variant === 'D' ? Math.floor(i / 3) : i;
      const fault = i % 7 === 1 || i % 7 === 2 || i % 11 === 6;
      const shear =
        energy *
        Math.sin(group * 1.7 + phase * 5 + (p.burstSeed || 0)) *
        (button ? 5 : 18) *
        (p.dir || 1);
      const shift =
        Math.sin(group * 4.3 + seed) * (button ? 11 : 29) * power * (fault ? 1 : 0.18) +
        (fault ? shear : 0);
      const inset = i < 2 || i > strips - 3 ? 7 + r * 12 : r * 3;
      const gap = fault ? (button ? 0.7 : 2.4) + energy * 1.1 : -0.3;
      const stripHeight = (heights[i] / total) * h;
      const yy = cursor + (variant === 'B' && fault ? sign * energy * 3 : 0);
      cursor += stripHeight;
      const hh = Math.max(0.8, stripHeight - gap),
        tail = (i % 6 === 1 ? (button ? 8 : variant === 'C' ? 58 : 37) : 0) * power;
      g.globalAlpha = 1;
      g.fillStyle = primary ? accent : palette[fault && i % 3 === 1 ? 1 : 0];
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
      if (i % (button ? 4 : 5) === 2) {
        const side = i % 3 ? 1 : -1,
          distance = (button ? 6 : 12) + r * 12 + energy * (15 + r * 15);
        const px = side > 0 ? w + distance : -distance - (button ? 7 : 15);
        const pw = button ? 3 + r * 8 : 8 + r * 21,
          py = yy + sign * (3 + energy * 8);
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
            px + side * 9,
            py - 9 - phase * 6,
            5 + r * 6,
            5 + r * 6,
          );
        }
      }
    }
    g.restore();
    g.globalAlpha = 1;
    p.c.dataset.fragments = String(strips);
    p.c.dataset.energy = energy.toFixed(3);
  }
  function feedback(p) {
    if (reduced.matches || !p) return;
    p.t = performance.now();
    p.duration = variant === 'C' ? 1550 : variant === 'B' ? 1350 : 1100;
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
    document.getElementById('direction-title').textContent = p.name;
    document.getElementById('direction-subtitle').textContent = p.subtitle;
    document.getElementById('notes-title').textContent = `${variant} / ${p.name}`;
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
