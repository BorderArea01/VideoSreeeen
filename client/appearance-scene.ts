import skyUrl from './assets/themes/daylight-sky.png';
import { fractureControl, fractureEdge, fractureSky, glitchLifetime } from './appearance-fracture';
import { HoverGlitch } from './hover-glitch';

type Wake = {
  x: number;
  y: number;
  dx: number;
  at: number;
  seed: number;
  target?: HTMLElement;
  impact: number;
  travel: number;
  size: number;
  samples: Map<string, HTMLCanvasElement>;
};
const controlSelector = 'button, summary, a.button, [role="button"]';
const materialSelector =
  '.source-card, .members-card, .chat-panel, .cache-options[open], ' + controlSelector;
const excluded = '.player-shell, dialog, .chat-messages, .emoji-picker, .members, .voice-members';
function materials() {
  return Array.from(document.querySelectorAll<HTMLElement>(materialSelector))
    .filter((node) => !node.closest(excluded))
    .slice(0, 120);
}

/** Protect visible glyphs, not the rectangular header or summary around them. */
function readableContent(node: HTMLElement) {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  while ((text = walker.nextNode())) {
    const value = text.textContent?.trim();
    if (
      !value ||
      !text.parentElement?.checkVisibility() ||
      text.parentElement.closest('svg,[aria-hidden="true"],input,textarea')
    )
      continue;
    const start = text.textContent!.indexOf(value),
      range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + value.length);
    rects.push(...range.getClientRects());
  }
  for (const glyph of node.querySelectorAll('svg,.tiny-dot'))
    if (glyph.checkVisibility()) rects.push(glyph.getBoundingClientRect());
  return rects;
}

/** Decorative photo/material only. Never reads video pixels, captures input, or sends coordinates. */
export class GlitchScene {
  private canvas = document.createElement('canvas');
  private fragments = document.createElement('canvas');
  private base = document.createElement('canvas');
  private image = new Image();
  private context = this.canvas.getContext('2d')!;
  private ink = this.fragments.getContext('2d')!;
  private active = false;
  private frame = 0;
  private dirty = true;
  private scale = 1;
  private lastPaint = 0;
  private lastPointer: { x: number; y: number; at: number; target?: HTMLElement } = {
    x: 0,
    y: 0,
    at: -Infinity,
  };
  private wakes: Wake[] = [];
  private nodes: HTMLElement[] = [];
  private materialLayout = '';
  private hadMotion = false;
  private hover = new HoverGlitch();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private contrast = matchMedia('(forced-colors: active)');
  constructor() {
    this.canvas.id = 'theme-scene';
    this.fragments.id = 'theme-fragments';
    this.image.id = 'theme-photo';
    this.image.alt = '';
    this.image.setAttribute('aria-hidden', 'true');
    for (const canvas of [this.canvas, this.fragments]) canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.image, this.canvas);
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
      if (layout.some((r) => r.type === 'childList' || r.attributeName === 'open'))
        this.nodes = materials();
      this.invalidate();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    new ResizeObserver(this.invalidate).observe(document.body);
    for (const event of ['visibilitychange', 'fullscreenchange', 'cinemachange']) {
      document.addEventListener(
        event,
        () => {
          this.wakes = [];
          this.resize();
        },
        true,
      );
    }
    this.motion.addEventListener('change', () => {
      this.wakes = [];
      this.materialLayout = '';
      this.invalidate();
    });
    this.contrast.addEventListener('change', () => this.resize());
    document.addEventListener('pointermove', this.pointer, { passive: true });
    document.addEventListener('pointerleave', () => this.hover.reset());
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', () => this.resize());
  }
  setActive(active: boolean) {
    this.active = active;
    this.wakes = [];
    this.hover.reset();
    this.stop();
    if (active) {
      this.nodes = materials();
      this.resize();
    } else {
      this.image.hidden = this.canvas.hidden = this.fragments.hidden = true;
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
    this.wakes = [];
    this.materialLayout = '';
    const suspended = this.suspended();
    this.image.hidden = this.canvas.hidden = this.fragments.hidden = suspended;
    if (suspended) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.scale = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt(4_200_000 / Math.max(1, bounds.width * bounds.height)),
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
    if (!target || target.closest('.player-shell, dialog, input, textarea, select')) {
      this.hover.reset();
      return;
    }
    const now = performance.now();
    const dx = Math.max(-50, Math.min(50, event.clientX - this.lastPointer.x));
    const node =
      target.closest<HTMLElement>(materialSelector) ??
      this.nodes.find((element) => {
        if (!element.checkVisibility() || element.closest('dialog, [hidden], .player-shell'))
          return false;
        const r = element.getBoundingClientRect();
        return (
          event.clientY >= r.top - 15 &&
          event.clientY <= r.bottom + 15 &&
          Math.min(Math.abs(event.clientX - r.left), Math.abs(event.clientX - r.right)) < 24
        );
      });
    const box = node?.getBoundingClientRect();
    if (node?.matches(':disabled,[aria-disabled="true"]')) return;
    const variation = this.hover.enter(
      node ?? `sky:${Math.floor(event.clientX / 160)}:${Math.floor(event.clientY / 160)}`,
    );
    if (!variation.enabled) return;
    if (now - this.lastPointer.at < 75 && node === this.lastPointer.target) return;
    this.wakes.push({
      x: event.clientX,
      y: event.clientY,
      dx,
      at: now,
      seed: now % 997,
      target: node ?? undefined,
      impact: box ? Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) : 0.5,
      travel: variation.travel,
      size: variation.size,
      samples: new Map(),
    });
    this.wakes = this.wakes.slice(-8);
    this.lastPointer = { x: event.clientX, y: event.clientY, at: now, target: node };
    this.invalidate();
  };
  private tick = (now: number) => {
    this.frame = 0;
    if (this.suspended()) {
      this.image.hidden = this.canvas.hidden = this.fragments.hidden = true;
      return;
    }
    const hadWakes = this.wakes.length > 0;
    this.wakes = this.wakes.filter((w) => now - w.at < glitchLifetime);
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
        '.player-shell, dialog[open], .daylight-voice[open] > .voice-card, .daylight-members[open] > .members-card, input:not([type="range"]), textarea, select, .bubble, .message-meta',
      ),
    )
      .filter((e) => e.checkVisibility())
      .map((e) => e.getBoundingClientRect());
    const content = visible
      .filter(({ node }) => node.matches(controlSelector))
      .map(({ node }) => ({ node, rects: readableContent(node) }));
    const headerRects = Array.from(
      document.querySelectorAll<HTMLElement>('.chat-heading > div:first-child'),
    )
      .filter((node) => node.checkVisibility())
      .flatMap(readableContent);
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
    // Idle is a clean page, not a frozen glitch frame.
    if (layout === this.materialLayout && !this.wakes.length && !this.hadMotion) return;
    this.materialLayout = layout;
    this.hadMotion = this.wakes.length > 0;
    const ctx = this.context,
      ink = this.ink;
    const labels: { node: HTMLElement; wake: Wake; surface: string }[] = [];
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width / this.scale, this.canvas.height / this.scale);
    ink.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ink.clearRect(0, 0, this.fragments.width / this.scale, this.fragments.height / this.scale);
    for (const { node, r } of visible) {
      const compact = node.matches(controlSelector);
      const candidates = this.motion.matches
        ? []
        : [...this.wakes].reverse().filter((w) => w.target && node.contains(w.target));
      if (!candidates.length) continue;
      // Retain a second passed location, instead of fastening the whole fracture to the cursor.
      const packets = candidates
        .filter(
          (w, i) =>
            i === 0 ||
            Math.abs(w.impact - candidates[0]!.impact) > 0.26 ||
            Math.abs(w.x - candidates[0]!.x) > r.width * 0.35,
        )
        .slice(0, compact ? 1 : 2)
        .reverse();
      const blue = node.matches('.accent, .send-button');
      const cssSurface = getComputedStyle(node).backgroundColor;
      const pseudoSurface = getComputedStyle(node, '::before').backgroundColor;
      const surface =
        pseudoSurface !== 'rgba(0, 0, 0, 0)'
          ? pseudoSurface
          : cssSurface !== 'rgba(0, 0, 0, 0)'
            ? cssSurface
            : compact
              ? 'rgba(0, 0, 0, 0)'
              : '#f5f7fb';
      if (compact && !this.motion.matches) labels.push({ node, wake: candidates[0]!, surface });
      for (const wake of packets) {
        const edge = {
          box: r,
          compact,
          blue,
          surface,
          impact:
            node === wake.target
              ? wake.impact
              : Math.max(0, Math.min(1, (wake.y - r.top) / r.height)),
          left: !compact && node.matches('.source-card') && wake.x < r.left + r.width * 0.5,
          exclusions: protectedRects,
        };
        fractureEdge(ink, this.base, this.scale, { ...wake, elapsed: now - wake.at }, edge);
      }
    }
    if (!this.motion.matches)
      for (const wake of this.wakes) {
        if (wake.target) continue;
        fractureSky(
          ctx,
          this.base,
          this.scale,
          { ...wake, elapsed: now - wake.at },
          wake.x,
          wake.y,
        );
      }
    ctx.globalAlpha = 1;
    // Media, input and open popovers keep their complete safety windows.
    for (const r of protectedRects) {
      ink.clearRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20);
      ctx.clearRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20);
    }
    const eraseGlyphs = (rects: DOMRect[]) => {
      for (const r of rects) {
        ink.clearRect(r.left - 1, r.top - 1, r.width + 2, r.height + 2);
        ctx.clearRect(r.left - 1, r.top - 1, r.width + 2, r.height + 2);
      }
    };
    // Keep a readable core without punching a whole rectangular hole through the edge.
    for (const { rects } of content) eraseGlyphs(rects);
    eraseGlyphs(headerRects);
    for (const { node, wake, surface } of labels)
      fractureControl(ink, node, { ...wake, elapsed: now - wake.at }, surface, protectedRects);
    const animated = new Set(labels.map(({ node }) => node));
    for (const { node, rects } of content) if (!animated.has(node)) eraseGlyphs(rects);
    eraseGlyphs(headerRects);
    // Label slices are strictly decorative and obey the same protected areas.
    for (const r of protectedRects)
      ink.clearRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20);
  }
}
