import skyUrl from './assets/themes/glitch-sky.webp';

/** Local decorative canvas. Never samples media, captures input, or sends coordinates. */
export class GlitchScene {
  private canvas = document.createElement('canvas');
  private base = document.createElement('canvas');
  private image = new Image();
  private context = this.canvas.getContext('2d', { alpha: false });
  private active = false;
  private frame = 0;
  private width = 1;
  private height = 1;
  private lastPaint = 0;
  private pointer = { x: -1000, y: -1000, dx: 0, at: -Infinity };
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private contrast = matchMedia('(forced-colors: active)');
  constructor() {
    this.canvas.id = 'theme-scene';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.canvas);
    this.image.onload = () => this.resize();
    this.image.src = skyUrl;
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.stop();
      if (!document.hidden) this.resize();
    });
    document.addEventListener('fullscreenchange', () => this.resize());
    this.motion.addEventListener('change', () => {
      this.pointer.at = -Infinity;
      this.stop();
      this.paint(performance.now());
    });
    this.contrast.addEventListener('change', () => {
      this.pointer.at = -Infinity;
      this.stop();
      this.resize();
    });
    document.addEventListener(
      'pointermove',
      (event) => {
        if (
          !this.active ||
          this.motion.matches ||
          this.contrast.matches ||
          document.hidden ||
          event.pointerType === 'touch'
        )
          return;
        if (document.body.classList.contains('page-cinema') || document.fullscreenElement) return;
        if ((event.target as Element)?.closest('.player-shell')) return;
        const bounds = this.canvas.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) * this.width) / bounds.width;
        const y = ((event.clientY - bounds.top) * this.height) / bounds.height;
        this.pointer = {
          x,
          y,
          dx: Math.max(-24, Math.min(24, x - this.pointer.x)),
          at: performance.now(),
        };
        if (!this.frame) this.frame = requestAnimationFrame(this.tick);
      },
      { passive: true },
    );
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', () => this.resize());
  }
  setActive(active: boolean) {
    this.active = active;
    this.canvas.hidden = !active;
    this.pointer.at = -Infinity;
    this.stop();
    if (active) this.resize();
    else {
      // Release backing stores while the original theme is in use.
      this.canvas.width = this.base.width = 1;
      this.canvas.height = this.base.height = 1;
    }
  }
  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  private resize() {
    if (!this.active || document.hidden || !this.context || this.contrast.matches) return;
    if (document.body.classList.contains('page-cinema') || document.fullscreenElement) {
      this.stop();
      return;
    }
    const bounds = this.canvas.getBoundingClientRect();
    const scale = Math.min(
      devicePixelRatio || 1,
      1.5,
      Math.sqrt(2_400_000 / Math.max(1, bounds.width * bounds.height)),
    );
    this.width = Math.max(1, Math.round(bounds.width * scale));
    this.height = Math.max(1, Math.round(bounds.height * scale));
    this.canvas.width = this.base.width = this.width;
    this.canvas.height = this.base.height = this.height;
    const base = this.base.getContext('2d', { alpha: false })!;
    const sky = base.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, '#287ccd');
    sky.addColorStop(0.55, '#50b5ed');
    sky.addColorStop(1, '#d7f4ff');
    base.fillStyle = sky;
    base.fillRect(0, 0, this.width, this.height);
    if (this.image.complete && this.image.naturalWidth) {
      const fit = Math.max(
        this.width / this.image.naturalWidth,
        this.height / this.image.naturalHeight,
      );
      const width = this.image.naturalWidth * fit,
        height = this.image.naturalHeight * fit;
      base.drawImage(
        this.image,
        (this.width - width) / 2,
        (this.height - height) / 2,
        width,
        height,
      );
    }
    this.paint(performance.now());
  }
  private tick = (now: number) => {
    this.frame = 0;
    if (!this.active || document.hidden || this.motion.matches) return;
    if (document.body.classList.contains('page-cinema') || document.fullscreenElement) {
      this.pointer.at = -Infinity;
      this.paint(now);
      return;
    }
    // At most 30 fps, only for a short interaction tail. No idle render loop.
    if (now - this.lastPaint > 32) {
      this.paint(now);
      this.lastPaint = now;
    }
    if (now - this.pointer.at < 1100) this.frame = requestAnimationFrame(this.tick);
    else this.paint(now);
  };
  private paint(now: number) {
    if (!this.active || !this.context || document.hidden) return;
    const ctx = this.context;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.base, 0, 0);
    const life = this.motion.matches ? 0 : Math.max(0, 1 - (now - this.pointer.at) / 1100);
    if (!life) return;
    const { x, y, dx } = this.pointer;
    const phase = now / 120;
    // Copy small bands of this theme's own photographic base, never the video or DOM.
    for (let i = 0; i < 18; i++) {
      const sy = Math.max(0, Math.min(this.height - 6, y + Math.sin(i * 7.1) * 150));
      const height = 1 + (i % 4);
      const width = Math.min(this.width * 0.75, 60 + ((i * 47) % 430));
      const sx = Math.max(0, Math.min(this.width - width, x - width / 2));
      const shift = (Math.sin(phase + i * 3.7) * 26 + dx * 1.4) * life;
      ctx.globalAlpha = life * 0.8;
      ctx.drawImage(this.base, sx, sy, width, height, sx + shift, sy, width, height);
      ctx.globalAlpha = life * 0.32;
      ctx.fillStyle = i % 3 ? '#87f7ff' : '#fa86df';
      ctx.fillRect(sx + shift, sy + height, width, 1);
    }
    for (let i = 0; i < 24; i++) {
      const age = 1 - life;
      const px = x + Math.sin(i * 8.2) * (30 + age * 160) + dx * life;
      const py = y + Math.cos(i * 5.4) * 70 - age * (20 + i * 4);
      const size = 2 + (i % 4);
      ctx.globalAlpha = life * (0.35 + (i % 3) * 0.2);
      ctx.fillStyle = ['#bff7ff', '#66eaff', '#ed9be5'][i % 3]!;
      ctx.fillRect(px, py, size * (i % 5 === 0 ? 4 : 1), size);
    }
    ctx.globalAlpha = 1;
  }
}
