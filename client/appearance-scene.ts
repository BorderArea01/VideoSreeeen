import skyUrl from './assets/themes/daylight-sky.webp';

type Wake = {
  x: number;
  y: number;
  dx: number;
  at: number;
  seed: number;
  box?: DOMRect;
  blue?: boolean;
  target?: HTMLElement;
};
const materialSelector =
  '.source-card, .members-card, .chat-panel, .cache-options, .top-actions .button, .source-card .button, .welcome .button, .send-button';
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Decorative photo/material only. Never reads video pixels, captures input, or sends coordinates. */
export class GlitchScene {
  private canvas = document.createElement('canvas');
  private fragments = document.createElement('canvas');
  private base = document.createElement('canvas');
  private image = new Image();
  private context = this.canvas.getContext('2d', { alpha: false })!;
  private ink = this.fragments.getContext('2d')!;
  private active = false;
  private frame = 0;
  private dirty = true;
  private scale = 1;
  private lastPaint = 0;
  private lastPointer = { x: 0, y: 0, at: -Infinity };
  private wakes: Wake[] = [];
  private nodes: HTMLElement[] = [];
  private materialLayout = '';
  private hadMotion = false;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private contrast = matchMedia('(forced-colors: active)');
  constructor() {
    this.canvas.id = 'theme-scene';
    this.fragments.id = 'theme-fragments';
    for (const canvas of [this.canvas, this.fragments]) canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.canvas);
    document.body.append(this.fragments);
    this.image.onload = () => this.resize();
    this.image.src = skyUrl;
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('scroll', this.invalidate);
    window.addEventListener('scroll', this.invalidate, { passive: true, capture: true });
    new MutationObserver((records) => {
      const layout = records.filter((r) => {
        if (r.target === this.canvas || r.target === this.fragments) return false;
        const element = r.target instanceof Element ? r.target : r.target.parentElement;
        return !element?.closest('.player-shell, .chat-messages, .members, .voice-members');
      });
      if (!layout.length) return;
      if (layout.some((r) => r.type === 'childList'))
        this.nodes = Array.from(document.querySelectorAll<HTMLElement>(materialSelector)).slice(
          0,
          80,
        );
      this.invalidate();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    new ResizeObserver(this.invalidate).observe(document.body);
    for (const event of ['visibilitychange', 'fullscreenchange', 'cinemachange']) {
      document.addEventListener(event, () => {
        this.wakes = [];
        this.resize();
      });
    }
    this.motion.addEventListener('change', () => {
      this.wakes = [];
      this.materialLayout = '';
      this.invalidate();
    });
    this.contrast.addEventListener('change', () => this.resize());
    document.addEventListener('pointermove', this.pointer, { passive: true });
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', () => this.resize());
  }
  setActive(active: boolean) {
    this.active = active;
    this.wakes = [];
    this.stop();
    if (active) {
      this.nodes = Array.from(document.querySelectorAll<HTMLElement>(materialSelector)).slice(
        0,
        80,
      );
      this.resize();
    } else {
      this.canvas.hidden = this.fragments.hidden = true;
      this.canvas.width =
        this.canvas.height =
        this.base.width =
        this.base.height =
        this.fragments.width =
        this.fragments.height =
          1;
    }
  }
  private suspended() {
    return (
      !this.active ||
      document.hidden ||
      this.contrast.matches ||
      document.body.classList.contains('page-cinema') ||
      !!document.fullscreenElement
    );
  }
  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  private invalidate = () => {
    this.dirty = true;
    if (this.active && !this.frame) this.frame = requestAnimationFrame(this.tick);
  };
  private resize() {
    this.stop();
    this.materialLayout = '';
    const suspended = this.suspended();
    this.canvas.hidden = this.fragments.hidden = suspended;
    if (suspended) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.scale = Math.min(
      devicePixelRatio || 1,
      1.5,
      Math.sqrt(2_400_000 / Math.max(1, bounds.width * bounds.height)),
    );
    const width = Math.max(1, Math.round(bounds.width * this.scale));
    const height = Math.max(1, Math.round(bounds.height * this.scale));
    for (const canvas of [this.canvas, this.base, this.fragments]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const base = this.base.getContext('2d', { alpha: false })!;
    base.fillStyle = '#1669cf';
    base.fillRect(0, 0, width, height);
    if (this.image.complete && this.image.naturalWidth) {
      const fit = Math.max(width / this.image.naturalWidth, height / this.image.naturalHeight);
      const w = this.image.naturalWidth * fit,
        h = this.image.naturalHeight * fit;
      base.drawImage(this.image, (width - w) / 2, (height - h) / 2, w, h);
    }
    this.invalidate();
  }
  private pointer = (event: PointerEvent) => {
    if (this.suspended() || this.motion.matches || event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('.player-shell, dialog, input, textarea, select')) return;
    const now = performance.now();
    if (now - this.lastPointer.at < 75) return;
    const dx = Math.max(-50, Math.min(50, event.clientX - this.lastPointer.x));
    const node = target.closest<HTMLElement>(materialSelector);
    this.wakes.push({
      x: event.clientX,
      y: event.clientY,
      dx,
      at: now,
      seed: now % 997,
      box: node?.getBoundingClientRect(),
      blue: !!node?.matches('.accent, .send-button'),
      target: node ?? undefined,
    });
    this.wakes = this.wakes.slice(-8);
    this.lastPointer = { x: event.clientX, y: event.clientY, at: now };
    this.invalidate();
  };
  private tick = (now: number) => {
    this.frame = 0;
    if (this.suspended()) {
      this.canvas.hidden = this.fragments.hidden = true;
      return;
    }
    const hadWakes = this.wakes.length > 0;
    this.wakes = this.wakes.filter((w) => now - w.at < 1100);
    if (this.dirty || now - this.lastPaint > 32 || (hadWakes && !this.wakes.length)) {
      this.paint(now);
      this.lastPaint = now;
      this.dirty = false;
    }
    // A finite afterimage, no idle animation loop or persistent cursor attachment.
    if (this.wakes.length) this.frame = requestAnimationFrame(this.tick);
  };
  private paint(now: number) {
    const visible = this.nodes.flatMap((node, i) => {
      if (
        !node.isConnected ||
        !node.checkVisibility() ||
        node.closest('[hidden], dialog, .player-shell')
      )
        return [];
      const r = node.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.width < 20 || r.height < 12) return [];
      return [{ node, i, r }];
    });
    const protectedRects = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.player-shell, dialog[open], .daylight-voice > summary, input:not([type="range"]), textarea',
      ),
    )
      .filter((e) => e.checkVisibility())
      .map((e) => e.getBoundingClientRect());
    const layout = JSON.stringify([
      visible.map(({ node, i, r }) => [
        i,
        node.matches('.accent, .send-button'),
        r.x,
        r.y,
        r.width,
        r.height,
      ]),
      protectedRects.map((r) => [r.x, r.y, r.width, r.height]),
    ]);
    // Ignore clock/chat text updates when all material bounds are unchanged.
    // Static edges need no repaint; this also avoids repeated subpixel rasterization.
    if (layout === this.materialLayout && !this.wakes.length && !this.hadMotion) return;
    this.materialLayout = layout;
    this.hadMotion = this.wakes.length > 0;
    const ctx = this.context,
      ink = this.ink;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.base, 0, 0);
    ink.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ink.clearRect(0, 0, this.fragments.width / this.scale, this.fragments.height / this.scale);
    const vw = this.fragments.width / this.scale,
      vh = this.fragments.height / this.scale;
    for (const { node, i, r } of visible) {
      const blue = node.matches('.accent, .send-button');
      const button = node.matches('button');
      const wake = this.motion.matches
        ? undefined
        : [...this.wakes].reverse().find((w) => w.target === node);
      const age = wake ? Math.min(1, (now - wake.at) / 1100) : 1;
      const energy = wake ? Math.sin(age * Math.PI) * (1 - age) : 0;
      for (let j = 0; j < (button ? 37 : 63); j++) {
        const seed = i * 79 + j * 11;
        // Irregular groups of tears rather than a uniformly toothed frame.
        const cluster = j % 3 === 0 ? 0.16 : j % 3 === 1 ? 0.58 : 0.88;
        const y =
          r.top + r.height * Math.max(0.02, Math.min(0.98, cluster + (noise(seed) - 0.5) * 0.3));
        const w = 8 + noise(seed + 2) ** 2 * (button ? 90 : 100);
        const h = 0.7 + noise(seed + 5) * (button ? 3 : 4);
        this.sliver(
          ink,
          r.right -
            (button ? 16 : 13) +
            noise(seed + 6) * 24 +
            energy * Math.sin(seed + age * 13) * 26,
          y + energy * Math.sin(seed + age * 7) * 2,
          w,
          h,
          blue,
          seed,
          0.94,
        );
      }
      if (!button)
        for (let j = 0; j < 5; j++) {
          const seed = i * 37 + j * 19;
          this.sliver(
            ink,
            r.left - 4 - noise(seed) * 13,
            r.top + r.height * noise(seed + 2),
            8 + noise(seed + 3) * 12,
            2 + noise(seed + 1) * 3,
            false,
            seed,
            0.7,
          );
        }
    }
    if (!this.motion.matches)
      for (const wake of this.wakes) {
        const age = Math.min(1, (now - wake.at) / 1100),
          life = (1 - age) ** 2;
        if (wake.box) {
          const r = wake.box;
          for (let j = 0; j < 15; j++) {
            const seed = wake.seed + j * 23;
            const y = r.top + r.height * noise(seed) - age * (8 + noise(seed + 2) * 22);
            const x = r.right - 2 + age * (12 + noise(seed + 3) * 45) + wake.dx * age * 0.25;
            this.sliver(
              ink,
              x,
              y,
              6 + noise(seed + 1) * 35 * (1 - age * 0.55),
              2 + noise(seed + 5) * 4,
              !!wake.blue,
              seed,
              life,
            );
          }
        } else
          for (let j = 0; j < 12; j++) {
            const seed = wake.seed + j * 17;
            const w = Math.min(vw * 0.32, 30 + noise(seed) * 190),
              h = 2 + noise(seed + 1) * 7;
            const x = Math.max(0, Math.min(vw - w, wake.x - w / 2 + (noise(seed + 2) - 0.5) * 140));
            const y = Math.max(0, Math.min(vh - h, wake.y + (noise(seed + 3) - 0.5) * 180));
            ctx.globalAlpha = life * 0.85;
            ctx.drawImage(
              this.base,
              x * this.scale,
              y * this.scale,
              w * this.scale,
              h * this.scale,
              (x + age * wake.dx * 1.4 + Math.sin(age * 5 + j) * age * 24) * this.scale,
              (y - age * 14) * this.scale,
              w * this.scale * (1 + age * 0.2),
              h * this.scale,
            );
          }
      }
    ctx.globalAlpha = 1;
    // Clip every frame away from the real movie and controls, including floating panels.
    for (const r of protectedRects) {
      ink.clearRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20);
    }
    // Adjacent labels are readable even when a fractured edge stretches toward them.
    for (const button of document.querySelectorAll<HTMLElement>('button')) {
      if (!button.checkVisibility()) continue;
      const r = button.getBoundingClientRect();
      ink.clearRect(r.left + 5, r.top + 3, Math.max(0, r.width - 10), Math.max(0, r.height - 6));
    }
  }
  private sliver(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    blue: boolean,
    seed: number,
    alpha: number,
  ) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = blue ? '#0053e6' : '#f5f7fb';
    ctx.fillRect(x, y, w, h);
    if (noise(seed + 9) > (blue ? 0.86 : 0.48)) {
      const sx = Math.max(0, Math.min(this.base.width - 1, x * this.scale));
      const sy = Math.max(0, Math.min(this.base.height - 1, y * this.scale));
      ctx.drawImage(
        this.base,
        sx,
        sy,
        Math.max(1, Math.min(w, this.base.width - sx)),
        1,
        x + 2,
        y,
        w,
        h,
      );
    }
    if (noise(seed + 7) > 0.8) {
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = '#ed695a';
      ctx.fillRect(x + 3, y + h, w * 0.7, 0.8);
    }
    if (noise(seed + 11) > 0.92) {
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = blue ? '#31a9e8' : '#e7f6ff';
      ctx.fillRect(x + w + 5, y - 6, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
}
