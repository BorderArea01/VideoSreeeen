(() => {
  const profiles = {
    A: {
      name: '晴空断层',
      subtitle: '保留故障感，放缓发生方式。',
      character: '平衡 · 克制的故障',
      background: '扫过后留下宽幅断层，在原处展开、缓慢消散。快速扫过更明显。',
      surface: '整面材质掠过柔光，伴随一层短暂错位；外框保持完整。',
      button: '根据进入方向与速度，表面短促错位，再柔和归位。',
    },
    B: {
      name: '云层浮玻璃',
      subtitle: '像光穿过玻璃，轻盈而有分量。',
      character: '舒适 · 推荐长时间观看',
      background: '云层有惯性位移，经过的区域产生柔和折射，水波留在经过处。',
      surface: '整张玻璃的光影与厚度一起变化，柔光延迟扩散。',
      button: '光从进入处铺开，按钮有柔软的按压与回弹。',
    },
    C: {
      name: '胶片回声',
      subtitle: '留下一点光，安静地回到画面。',
      character: '安静 · 电影感',
      background: '经过后延迟出现宽幅追踪带，像胶片曝光的余韵，缓慢退场。',
      surface: '哑光面板出现温暖的整面曝光与残影，弱化发光边框。',
      button: '短按压、长余光；动作有轻微延迟，不循环抖动。',
    },
    D: {
      name: '棱镜折面',
      subtitle: '用大块空间与折面，表达数字感。',
      character: '鲜明 · 层次更强',
      background: '附近的大块几何折面依次响应，再按自身惯性展开归位。',
      surface: '整面层叠、斜向折光与阴影共同响应，不使用碎点轮廓。',
      button: '三块宽条表面按不同节奏分离、重合，文字保持完整。',
    },
  };
  const root = document.documentElement;
  const canvas = document.getElementById('sky');
  const base = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const bctx = base.getContext('2d', { alpha: false });
  const image = new Image();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let variant = 'A',
    width = 1,
    height = 1,
    scale = 1,
    frame = 0,
    lastFrame = 0;
  let impulses = [],
    springs = [],
    lastSpawn = -Infinity;
  let previous = { x: 0, y: 0, t: 0 },
    drift = { x: 0, y: 0, vx: 0, vy: 0 };
  const colors = ['#a7e3ff', '#e5f4ff', '#d3b38a', '#bcc9ff'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const current = () => profiles[variant];
  const isEmbed = new URLSearchParams(location.search).has('embed');
  if (isEmbed) {
    document.querySelector('.review-bar').hidden = true;
    document.querySelector('.design-notes').hidden = true;
    document.querySelector('footer').hidden = true;
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
    const g = bctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, '#447db0');
    g.addColorStop(1, '#b4d5e9');
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, width, height);
    if (image.complete && image.naturalWidth) {
      const fit = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      bctx.save();
      bctx.filter =
        variant === 'C'
          ? 'saturate(.48) brightness(.65)'
          : variant === 'D'
            ? 'saturate(.65) brightness(.51)'
            : 'none';
      bctx.drawImage(
        image,
        (width - image.naturalWidth * fit) / 2,
        (height - image.naturalHeight * fit) / 2,
        image.naturalWidth * fit,
        image.naturalHeight * fit,
      );
      bctx.restore();
    }
    bctx.fillStyle =
      variant === 'A'
        ? '#0b36523d'
        : variant === 'B'
          ? '#e7f6ff24'
          : variant === 'C'
            ? '#14202d40'
            : '#14214740';
    bctx.fillRect(0, 0, width, height);
    paint(performance.now());
  }
  function spawn(x, y, vx = 0, vy = 0, force = false) {
    if (reduced.matches) return;
    const now = performance.now();
    if (!force && now - lastSpawn < 110) return;
    const speed = Math.hypot(vx, vy);
    if (!force && speed < 0.12) return;
    lastSpawn = now;
    const size = variant === 'D' ? 150 : variant === 'A' ? 90 : 45;
    impulses.push({
      x: (Math.round(x / size) * size + Math.sin(x * 0.1) * 13) * scale,
      y: (Math.round(y / size) * size + Math.cos(y * 0.1) * 12) * scale,
      t: now + 50 + Math.random() * 70,
      amp: clamp(speed * 0.65 + 0.4, 0.4, 1.6),
      dx: clamp(vx, -1.5, 1.5),
      dy: clamp(vy, -1.5, 1.5),
      seed: Math.random() * 9,
    });
    if (impulses.length > 6) impulses.shift();
    drift.vx += clamp(vx, -2, 2) * 0.35;
    drift.vy += clamp(vy, -2, 2) * 0.25;
    wake();
  }
  function wake() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function paint(now) {
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);
    if (reduced.matches) return;
    if (variant === 'B' && Math.abs(drift.x) + Math.abs(drift.y) > 0.1) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(base, drift.x * scale, drift.y * scale, width, height);
      ctx.restore();
    }
    for (const p of impulses) {
      const age = (now - p.t) / 1900;
      if (age < 0 || age > 1) continue;
      const envelope = Math.sin(Math.PI * age) * Math.pow(1 - age, 0.7) * p.amp;
      if (variant === 'A') {
        const spread = (120 + ease(age) * 480) * scale;
        for (let i = 0; i < 5; i++) {
          const sy = clamp(p.y + (i - 2) * 14 * scale, 0, height - 8 * scale);
          const sh = (4 + (i % 2) * 7) * scale;
          const sw = Math.min(width, spread * (1 - i * 0.09));
          const sx = clamp(p.x - sw * 0.5 + p.dx * age * 40 * scale, 0, Math.max(0, width - sw));
          const shift = Math.sin(age * 5 + i * 0.9 + p.seed) * 14 * envelope * scale;
          ctx.globalAlpha = 0.2 * envelope;
          ctx.drawImage(base, sx, sy, sw, sh, sx + shift, sy, sw, sh);
          ctx.fillStyle = i % 3 === 0 ? '#d2aed0' : '#b8e5ed';
          ctx.globalAlpha = 0.035 * envelope;
          ctx.fillRect(sx + shift, sy, sw, sh);
        }
      } else if (variant === 'B') {
        const radius = (35 + ease(age) * 175) * scale;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(p.x + p.dx * age * 12 * scale, p.y, radius, radius * 0.72, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = 0.2 * envelope;
        const zoom = 1 + 0.035 * envelope;
        ctx.drawImage(base, -p.x * (zoom - 1), -p.y * (zoom - 1), width * zoom, height * zoom);
        const light = ctx.createRadialGradient(p.x, p.y, radius * 0.7, p.x, p.y, radius);
        light.addColorStop(0, '#eaffff00');
        light.addColorStop(0.7, '#eaffff22');
        light.addColorStop(1, '#eaffff00');
        ctx.globalAlpha = 0.4 * envelope;
        ctx.fillStyle = light;
        ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
        ctx.restore();
      } else if (variant === 'C') {
        const y = clamp(p.y + Math.sin(age * 3) * 16 * scale, 0, height - 35 * scale);
        const sw = Math.min(width, Math.max(280 * scale, width * 0.8)),
          sx = clamp(p.x - sw * 0.55 + age * 45 * scale, 0, width - sw);
        ctx.globalAlpha = 0.16 * envelope;
        ctx.drawImage(base, sx, y, sw, 28 * scale, sx + 8 * envelope * scale, y, sw, 28 * scale);
        const g = ctx.createLinearGradient(0, y, 0, y + 32 * scale);
        g.addColorStop(0, '#f3cb8c00');
        g.addColorStop(0.5, '#f3cb8c18');
        g.addColorStop(1, '#f3cb8c00');
        ctx.globalAlpha = envelope * 0.75;
        ctx.fillStyle = g;
        ctx.fillRect(sx, y, sw, 32 * scale);
      } else {
        for (let i = 0; i < 4; i++) {
          const cell = 145 * scale,
            px = p.x + ((i % 2) - 0.5) * cell,
            py = p.y + (Math.floor(i / 2) - 0.5) * cell;
          const delay = i * 0.075,
            phase = clamp((age - delay) / (1 - delay), 0, 1),
            energy = Math.sin(phase * Math.PI) * Math.pow(1 - phase, 0.5) * p.amp;
          if (!energy) continue;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(px - cell * 0.45, py - cell * 0.33);
          ctx.lineTo(px + cell * 0.5, py - cell * 0.5);
          ctx.lineTo(px + cell * 0.35, py + cell * 0.5);
          ctx.lineTo(px - cell * 0.5, py + cell * 0.2);
          ctx.closePath();
          ctx.clip();
          ctx.globalAlpha = 0.35 * energy;
          ctx.drawImage(
            base,
            (i % 2 ? 1 : -1) * 13 * energy * scale,
            Math.sin(phase * 4) * 7 * energy * scale,
            width,
            height,
          );
          ctx.fillStyle = i % 2 ? '#9ea2f2' : '#8bc4e7';
          ctx.globalAlpha = 0.04 * energy;
          ctx.fillRect(px - cell, py - cell, cell * 2, cell * 2);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  function tick(now) {
    frame = 0;
    if (document.hidden || reduced.matches) return;
    if (now - lastFrame > 32) {
      lastFrame = now;
      drift.vx += -drift.x * 0.035;
      drift.vy += -drift.y * 0.035;
      drift.vx *= 0.89;
      drift.vy *= 0.89;
      drift.x = clamp(drift.x + drift.vx, -6, 6);
      drift.y = clamp(drift.y + drift.vy, -4, 4);
      impulses = impulses.filter((p) => now - p.t < 1900);
      for (const s of springs) {
        s.vx += (s.tx - s.x) * 0.12;
        s.vy += (s.ty - s.y) * 0.12;
        s.vx *= 0.72;
        s.vy *= 0.72;
        s.x += s.vx;
        s.y += s.vy;
        s.material.style.setProperty('translate', `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`);
      }
      paint(now);
    }
    const unsettled = springs.some(
      (s) => Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) + Math.abs(s.vx) + Math.abs(s.vy) > 0.08,
    );
    if (
      impulses.length ||
      Math.abs(drift.x) + Math.abs(drift.y) + Math.abs(drift.vx) + Math.abs(drift.vy) > 0.12 ||
      unsettled
    )
      wake();
    else {
      drift = { x: 0, y: 0, vx: 0, vy: 0 };
      paint(now);
    }
  }
  const animations = new Set();
  const cues = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => {
      cues.delete(id);
      fn();
    }, ms);
    cues.add(id);
  }
  function animate(element, frames, options) {
    if (reduced.matches) return;
    const animation = element.animate(frames, { fill: 'none', ...options });
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  }
  function cancelAll() {
    for (const id of cues) clearTimeout(id);
    cues.clear();
    for (const a of animations) a.cancel();
    animations.clear();
    for (const s of springs) {
      s.tx = s.ty = s.vx = s.vy = s.x = s.y = 0;
      s.material.style.translate = '0 0';
    }
  }
  function materialFeedback(element, event, button = false) {
    if (reduced.matches) return;
    const material = element.querySelector(button ? '.button-material' : '.material');
    if (!material) return;
    const box = element.getBoundingClientRect();
    const ratio = event ? clamp((event.clientX - box.left) / box.width, 0, 1) : 0.3;
    const dir = ratio < 0.5 ? 1 : -1;
    const velocity = clamp(Math.hypot(previous.vx || 0, previous.vy || 0), 0.25, 1.5);
    const duration =
      (variant === 'B' ? 1150 : variant === 'C' ? 1300 : variant === 'D' ? 850 : 1050) /
      (1 + velocity * 0.17);
    for (const a of material.getAnimations()) a.cancel();
    const max = button ? 0.65 : 0.3;
    if (variant === 'A') {
      animate(
        material,
        [
          { opacity: 0, transform: `translateX(${-dir * 25}%)` },
          { opacity: max, transform: `translateX(${dir * 3}%)`, offset: 0.42 },
          { opacity: 0, transform: `translateX(${dir * 32}%)` },
        ],
        { duration, easing: 'cubic-bezier(.2,.65,.2,1)' },
      );
    } else if (variant === 'B') {
      material.style.transformOrigin = `${ratio * 100}% 50%`;
      animate(
        material,
        [
          { opacity: 0, transform: `translateX(${-dir * 12}%) scale(.6)` },
          { opacity: max * 0.8, transform: 'translateX(0) scale(1.05)', offset: 0.55 },
          { opacity: 0, transform: `translateX(${dir * 8}%) scale(1.2)` },
        ],
        { duration, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    } else if (variant === 'C') {
      animate(
        material,
        [
          { opacity: 0, transform: `translateX(${-dir * 35}%)` },
          { opacity: max * 0.7, transform: 'translateX(0)', offset: 0.5 },
          { opacity: 0, transform: `translateX(${dir * 22}%)` },
        ],
        { duration, delay: 70, easing: 'cubic-bezier(.25,.45,.3,1)' },
      );
    } else {
      animate(
        material,
        [
          { opacity: 0, transform: `translateX(${-dir * 30}%) skewX(-5deg)` },
          { opacity: max, transform: `translateX(${dir * 4}%) skewX(2deg)`, offset: 0.35 },
          { opacity: 0, transform: `translateX(${dir * 24}%) skewX(0)` },
        ],
        { duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
      if (button)
        for (const [i, part] of element.querySelectorAll('.stratum').entries())
          animate(
            part,
            [
              { transform: 'translateX(0)' },
              {
                transform: `translateX(${(i % 2 ? -1 : 1) * dir * (3 + velocity * 5)}px)`,
                offset: 0.28,
              },
              { transform: 'translateX(0)' },
            ],
            { duration: 400 + i * 110, delay: i * 24, easing: 'cubic-bezier(.16,1,.3,1)' },
          );
    }
    if (!button && element.dataset.kind !== 'player') {
      const shadow = getComputedStyle(element).boxShadow;
      animate(
        element,
        [
          { boxShadow: shadow },
          {
            boxShadow: `0 20px 45px ${variant === 'B' ? '#0b487f35' : '#020e2f5c'},inset 0 0 38px ${variant === 'C' ? '#d9bc8b0b' : '#b5e5ff0a'}`,
            offset: 0.45,
          },
          { boxShadow: shadow },
        ],
        { duration: duration * 1.2, easing: 'ease-out' },
      );
    }
  }
  for (const surface of document.querySelectorAll('.surface'))
    surface.addEventListener('pointerenter', (e) => materialFeedback(surface, e));
  for (const button of document.querySelectorAll('.action')) {
    button.insertAdjacentHTML(
      'afterbegin',
      '<i class="button-material" aria-hidden="true"></i><i class="stratum s0" aria-hidden="true"></i><i class="stratum s1" aria-hidden="true"></i><i class="stratum s2" aria-hidden="true"></i>',
    );
    const spring = {
      material: button.querySelector('.button-material'),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
    };
    springs.push(spring);
    button.addEventListener('pointerenter', (e) => materialFeedback(button, e, true));
    button.addEventListener('pointermove', (e) => {
      if (reduced.matches) return;
      const b = button.getBoundingClientRect();
      spring.tx = clamp((e.clientX - b.left - b.width / 2) * 0.1, -5, 5);
      spring.ty = clamp((e.clientY - b.top - b.height / 2) * 0.12, -2, 2);
      wake();
    });
    button.addEventListener('pointerleave', () => {
      spring.tx = spring.ty = 0;
      wake();
    });
    button.addEventListener('pointerdown', () =>
      animate(
        button,
        [{ scale: '1' }, { scale: variant === 'B' ? '.965' : '.982' }, { scale: '1' }],
        { duration: variant === 'B' ? 420 : 270, easing: 'cubic-bezier(.2,.8,.2,1)' },
      ),
    );
    button.addEventListener('click', (e) => {
      materialFeedback(button, e, true);
      if (button.type !== 'submit') {
        const notice = document.getElementById('notice');
        notice.hidden = false;
        clearTimeout(notice.timer);
        notice.timer = setTimeout(() => (notice.hidden = true), 1800);
      }
    });
  }
  // Only D exposes the three broad button layers. Other directions use material lighting.
  function selectVariant() {
    variant = Object.hasOwn(profiles, location.hash.slice(1).toUpperCase())
      ? location.hash.slice(1).toUpperCase()
      : 'A';
    root.dataset.variant = variant;
    cancelAll();
    impulses = [];
    drift = { x: 0, y: 0, vx: 0, vy: 0 };
    const p = current();
    document.getElementById('direction-title').textContent = p.name;
    document.getElementById('direction-subtitle').textContent = p.subtitle;
    document.getElementById('notes-title').textContent = `${variant} / ${p.name}`;
    document.getElementById('character').textContent = p.character;
    document.getElementById('chapter').textContent = String(
      Object.keys(profiles).indexOf(variant) + 1,
    ).padStart(2, '0');
    for (const type of ['background', 'surface', 'button'])
      document.getElementById('note-' + type).textContent = p[type];
    for (const link of document.querySelectorAll('nav a'))
      link.setAttribute('aria-current', String(link.hash === '#' + variant));
    for (const layer of document.querySelectorAll('.stratum'))
      layer.hidden = variant !== 'D' || !layer.parentElement.classList.contains('primary');
    resize();
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' || reduced.matches) return;
      const now = performance.now(),
        dt = Math.max(8, now - previous.t);
      const vx = (e.clientX - previous.x) / dt,
        vy = (e.clientY - previous.y) / dt;
      if (previous.t && now - previous.t < 140 && !e.target.closest('.screen,.review-bar'))
        spawn(e.clientX, e.clientY, vx, vy);
      previous = { x: e.clientX, y: e.clientY, t: now, vx, vy };
    },
    { passive: true },
  );
  document.getElementById('demonstrate').onclick = () => {
    for (const id of cues) clearTimeout(id);
    cues.clear();
    const path = [
      [0.12, 0.28],
      [0.35, 0.4],
      [0.64, 0.3],
      [0.9, 0.45],
    ];
    path.forEach(([x, y], i) =>
      later(() => spawn(innerWidth * x, innerHeight * y, 1.1, 0.2, true), i * 160),
    );
    const surface = document.querySelector('.source'),
      button = document.querySelector('.voice .primary');
    later(() => materialFeedback(surface, null), 250);
    later(() => materialFeedback(document.querySelector('.members'), null), 170);
    later(() => materialFeedback(document.querySelector('.voice'), null), 400);
    later(() => materialFeedback(document.querySelector('.chat'), null), 550);
    later(() => materialFeedback(button, null, true), 600);
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
    impulses = [];
    cancelAnimationFrame(frame);
    frame = 0;
    resize();
    document.getElementById('motion-status').textContent = reduced.matches
      ? '减少动态效果已启用'
      : '动态交互已启用';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      cancelAll();
      impulses = [];
    } else resize();
  });
  image.onload = resize;
  image.src = 'sky.webp';
  selectVariant();
  document.getElementById('motion-status').textContent = reduced.matches
    ? '减少动态效果已启用'
    : '动态交互已启用';
})();
