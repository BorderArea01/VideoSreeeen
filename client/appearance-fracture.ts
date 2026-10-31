export const glitchLifetime = 840;
export type GlitchBurst = {
  seed: number;
  elapsed: number;
  dx: number;
  samples: Map<string, HTMLCanvasElement>;
};
const hash = (n: number) => {
  const value = Math.sin(n * 91.713 + 17.1) * 43758.5453;
  return value - Math.floor(value);
};
const beats = [0, 55, 135, 215, 275, 365, 435, 535, 625, 725];
const packet = (elapsed: number) => {
  let index = 0;
  while (index + 1 < beats.length && elapsed >= beats[index + 1]!) index++;
  return index;
};
const quiet = (beat: number) => beat === 3 || beat === 6 || beat === 9;
const density = (elapsed: number) =>
  elapsed < 210 ? 1 : elapsed < 420 ? 0.84 : elapsed < 630 ? 0.53 : 0.24;

/** Only our same-origin sky is sampled. No DOM capture, video or stored cloud atlas. */
function sortedField(
  sky: HTMLCanvasElement,
  scale: number,
  burst: GlitchBurst,
  x: number,
  y: number,
  width: number,
  height: number,
  surface = '',
) {
  const key = [Math.round(x), Math.round(y), Math.round(width), Math.round(height), surface].join(
    ':',
  );
  const cached = burst.samples.get(key);
  if (cached) return cached;
  const field = document.createElement('canvas');
  field.width = 96;
  field.height = 48;
  const ctx = field.getContext('2d', { willReadFrequently: true })!;
  const sx = Math.max(0, Math.min(sky.width - 1, x * scale));
  const sy = Math.max(0, Math.min(sky.height - 1, y * scale));
  ctx.drawImage(
    sky,
    sx,
    sy,
    Math.max(1, Math.min(sky.width - sx, width * scale)),
    Math.max(1, Math.min(sky.height - sy, height * scale)),
    0,
    0,
    96,
    48,
  );
  if (surface) {
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, 30, 48);
  }
  const image = ctx.getImageData(0, 0, 96, 48);
  const pixels = image.data;
  // Actual bounded horizontal luminance sorting. Photographic content comes from
  // this interaction's coordinates, so cloud/sky detail changes with the source.
  for (let row = 0; row < 48; row++) {
    const run = 16 + Math.floor(hash(row + burst.seed) * 24);
    for (let start = 0; start < 96; start += run) {
      const colors: number[][] = [];
      for (let col = start; col < Math.min(96, start + run); col++) {
        const offset = (row * 96 + col) * 4;
        colors.push([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, 255]);
      }
      const direction = row % 3 === 0 ? -1 : 1;
      colors.sort(
        (a, b) =>
          direction *
          ((a[0]! - b[0]!) * 0.2126 + (a[1]! - b[1]!) * 0.7152 + (a[2]! - b[2]!) * 0.0722),
      );
      colors.forEach((color, col) => pixels.set(color, (row * 96 + start + col) * 4));
    }
  }
  const sorted = pixels.slice();
  for (let row = 0; row < 48; row += 4)
    for (let col = 1; col < 95; col++) {
      const offset = (row * 96 + col) * 4;
      pixels[offset] = sorted[offset + 4]!;
      pixels[offset + 2] = sorted[offset - 2]!;
    }
  ctx.putImageData(image, 0, 0);
  if (burst.samples.size >= 4) burst.samples.delete(burst.samples.keys().next().value!);
  burst.samples.set(key, field);
  return field;
}

/** Stepwise scan corruption, packet loss and reordered rows. Never elastic easing. */
export function fractureEdge(
  ctx: CanvasRenderingContext2D,
  sky: HTMLCanvasElement,
  scale: number,
  burst: GlitchBurst,
  edge: {
    box: DOMRect;
    compact: boolean;
    impact: number;
    blue: boolean;
    left?: boolean;
    surface: string;
  },
) {
  if (burst.elapsed < 0 || burst.elapsed >= glitchLifetime) return;
  const { box: r, compact, impact, blue, left = false, surface } = edge;
  const step = packet(burst.elapsed),
    seed = burst.seed;
  if (quiet(step)) return;
  const activeHeight = Math.min(r.height, compact ? r.height : 330);
  const top =
    r.top + Math.max(0, Math.min(r.height - activeHeight, r.height * impact - activeHeight * 0.5));
  const anchor = left ? r.left : r.right;
  const inside = Math.min(compact ? 26 : 68, r.width * 0.16);
  const reach = compact ? 88 : 178;
  const field = sortedField(sky, scale, burst, anchor - 70, top, 210, activeHeight, surface);
  const rows = compact ? 8 : Math.min(42, Math.max(12, Math.round(activeHeight / 7.5)));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // A narrow misregistered silhouette precedes the broken packets, like the
  // supplied button reference. It never translates the actual control or card.
  for (let rim = 0; rim < 3; rim++) {
    const ry = top + activeHeight * (0.08 + rim * 0.3);
    const rh = Math.max(2, activeHeight * (compact ? 0.18 : 0.12));
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = '#4bd8ef';
    ctx.fillRect(anchor + (left ? -4 : 2), ry, 3, rh);
    ctx.fillStyle = '#ed7599';
    ctx.fillRect(anchor + (left ? 1 : -2), ry + 2, 2, rh * 0.7);
  }
  for (let j = 0; j < rows; j++) {
    const n = seed + j * 19;
    // Drop whole packets as the burst expires; no shrinking or springing back.
    if (hash(n + 4) > density(burst.elapsed)) continue;
    const group = Math.floor(j / 5);
    const glitch = hash(seed + group * 41 + step * 23);
    const y = top + ((j + hash(n + 70) * 0.65) / rows) * activeHeight;
    const h = Math.max(
      1,
      (activeHeight / rows) * (j % 8 === 0 ? 2.6 : j % 5 === 0 ? 1.8 : 0.25 + hash(n + 2) * 0.8),
    );
    const depth = Math.round(4 + hash(n + 3) * Math.max(0, inside - 4));
    const length = Math.round(15 + hash(n + 8) ** 1.5 * reach + Math.floor(glitch * 5) * 9);
    const x = left ? anchor - length : anchor - depth;
    const width = length + depth;
    ctx.globalAlpha = burst.elapsed < 630 ? 0.97 : 0.64;
    // Erode a small part of the real perimeter by revealing its current backdrop.
    if (j % 3 === 0) {
      const rootX = left ? anchor : anchor - depth;
      if (compact) {
        ctx.fillStyle = '#f5f7fb';
        ctx.fillRect(rootX, y, depth, h);
      } else {
        const sx = Math.max(0, Math.min(sky.width - 1, rootX * scale));
        const sy = Math.max(0, Math.min(sky.height - 1, y * scale));
        ctx.drawImage(
          sky,
          sx,
          sy,
          Math.max(1, Math.min(sky.width - sx, depth * scale)),
          Math.max(1, Math.min(sky.height - sy, h * scale)),
          rootX,
          y,
          depth,
          h,
        );
      }
    }
    // Dark decode-loss plates, original surface packets and live sorted photo rows
    // interleave densely; nested slices give broad slabs an irregular torn contour.
    const kind = j % 7;
    if (kind === 0 || kind === 3) {
      ctx.fillStyle = kind === 0 ? '#07264c' : blue ? '#0053e6' : '#0750aa';
      ctx.fillRect(x, y, width * (0.6 + glitch * 0.25), h);
    } else if (kind === 1 || kind === 5) {
      ctx.fillStyle = surface;
      ctx.fillRect(x, y, width, h);
    } else {
      const sampleX = Math.floor(hash(n + step * 7) * 65);
      const sampleY = (j * 7 + step * (group % 2 ? 5 : 2)) % 48;
      ctx.drawImage(field, sampleX, sampleY, 8 + Math.floor(hash(n + 33) * 22), 1, x, y, width, h);
    }
    if (j % 4 === 0) {
      ctx.fillStyle = blue ? '#e8f5ff' : '#f5f7fb';
      ctx.fillRect(left ? anchor - length * 0.7 : anchor - 2, y + h, length * 0.7, 1 + (j % 3));
    }
    if (j % 13 === 0) {
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = j % 2 ? '#e56c7c' : '#48cdff';
      ctx.fillRect(x + width * 0.68 + 3, y - 1, width * 0.2, 1);
      // Detached decode blocks jump on the same packet clock, then disappear.
      const drift = 10 + Math.floor(glitch * 6) * 5;
      ctx.fillStyle = j % 2 ? '#edf6ff' : '#0750aa';
      ctx.fillRect(
        left ? anchor - length - drift : anchor + length + drift,
        y + Math.floor(hash(n + step) * 4) * 3,
        4 + hash(n + 11) * 12,
        2 + (j % 4),
      );
    }
  }
  ctx.restore();
}

export function fractureSky(
  ctx: CanvasRenderingContext2D,
  sky: HTMLCanvasElement,
  scale: number,
  burst: GlitchBurst,
  x: number,
  y: number,
) {
  if (burst.elapsed < 0 || burst.elapsed >= glitchLifetime) return;
  const step = packet(burst.elapsed),
    seed = burst.seed;
  if (quiet(step)) return;
  const field = sortedField(sky, scale, burst, x - 110, y - 85, 220, 170);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = burst.elapsed < 630 ? 0.88 : 0.42;
  // Preserve photo structure in displaced layers before adding sorted-pixel tails.
  for (let layer = 0; layer < 3; layer++) {
    const n = seed + layer * 47;
    const sx = Math.max(0, Math.min(sky.width / scale - 1, x - 120 + hash(n) * 60));
    const sy = Math.max(0, Math.min(sky.height / scale - 1, y - 90 + hash(n + 2) * 170));
    const w = Math.min(120 + hash(n + 3) * 150, sky.width / scale - sx);
    const h = Math.min(layer === 0 ? 12 : 3 + hash(n + 4) * 5, sky.height / scale - sy);
    const shift = (step % 2 ? -1 : 1) * (8 + Math.floor(hash(n + step) * 4) * 6);
    ctx.drawImage(
      sky,
      sx * scale,
      sy * scale,
      w * scale,
      h * scale,
      sx + shift,
      sy + ((step % 3) - 1) * 2,
      w,
      h,
    );
  }
  for (let j = 0; j < 24; j++) {
    const n = seed + j * 13;
    if (hash(n) > density(burst.elapsed)) continue;
    const width = 20 + hash(n + 3) ** 1.7 * 205;
    const row = (j * 5 + step * 3) % 48;
    const offset =
      (Math.floor(hash(seed + Math.floor(j / 4) * 11 + step * 31) * 7) - 3) * 9 +
      Math.sign(burst.dx) * (step % 3) * 6;
    const px = x - width * 0.5 + (hash(n + 7) - 0.5) * 150 + offset;
    const py = y - 100 + (j / 24) * 200;
    ctx.drawImage(
      field,
      Math.floor(hash(n + 9) * 55),
      row,
      15 + hash(n + 1) * 24,
      1,
      px,
      py,
      width,
      j % 5 === 0 ? 8 : 1 + hash(n + 2) * 3,
    );
    if (j % 12 === 0) {
      ctx.fillStyle = '#092952';
      ctx.fillRect(px + offset, py, width * 0.35, 2);
    }
  }
  ctx.restore();
}

/** An app-owned surface/text/icon plate; no DOM clones, external capture or media. */
function controlPlate(button: HTMLElement, burst: GlitchBurst, surface: string) {
  const box = button.getBoundingClientRect();
  const ratio = Math.min(2, devicePixelRatio || 1, 768 / box.width, 192 / box.height);
  const style = getComputedStyle(button);
  const key = [
    'control',
    button.id,
    box.width,
    box.height,
    surface,
    style.font,
    button.textContent,
  ].join(':');
  const cached = burst.samples.get(key);
  if (cached) return cached;
  const plate = document.createElement('canvas');
  plate.width = Math.ceil(box.width * ratio);
  plate.height = Math.ceil(box.height * ratio);
  const p = plate.getContext('2d')!;
  p.scale(ratio, ratio);
  p.fillStyle = surface;
  p.beginPath();
  if (button.matches('#source-form .button')) {
    p.moveTo(0, 0);
    p.lineTo(box.width, 0);
    p.lineTo(box.width, box.height);
    p.lineTo(10, box.height);
    p.lineTo(0, box.height - 10);
    p.closePath();
  } else
    p.roundRect(
      0,
      0,
      box.width,
      box.height,
      Math.min(10, Number.parseFloat(style.borderRadius) || 2),
    );
  p.fill();
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim() ?? '';
      return text &&
        text.length <= 40 &&
        node.parentElement?.checkVisibility() &&
        !node.parentElement.closest('svg, small, [aria-hidden="true"]')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node: Node | null;
  let firstLabel: DOMRect | undefined;
  while ((node = walker.nextNode())) {
    const text = node.textContent!.trim(),
      offset = node.textContent!.indexOf(text);
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + text.length);
    const r = range.getBoundingClientRect(),
      font = getComputedStyle(node.parentElement!);
    firstLabel ??= r;
    p.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
    p.textBaseline = 'middle';
    const x = r.left - box.left,
      y = r.top - box.top + r.height / 2;
    p.fillStyle = '#43deef';
    p.fillText(text, x + 2, y + 1);
    p.fillStyle = '#ed7097';
    p.fillText(text, x - 2, y - 1);
    p.fillStyle = font.color;
    p.fillText(text, x, y);
  }
  // The sync link glyph is our CSS mask rather than a DOM svg. Reuse its own
  // inline paths so it travels in the same surface/text packet.
  const pseudo = getComputedStyle(button, '::after');
  const mask = /^url\("(data:image\/svg\+xml,[\s\S]+)"\)$/.exec(pseudo.maskImage);
  if (firstLabel && button.matches('#source-form .button') && mask) {
    const vector = new DOMParser().parseFromString(
      decodeURIComponent(mask[1]!.split(',').slice(1).join(',')),
      'image/svg+xml',
    ).documentElement;
    const size = (vector.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number);
    const iw = Number.parseFloat(pseudo.width),
      ih = Number.parseFloat(pseudo.height);
    if (iw > 0 && ih > 0 && size[2]) {
      p.save();
      p.translate(
        firstLabel.left - box.left - (Number.parseFloat(style.columnGap) || 0) - iw,
        (box.height - ih) / 2,
      );
      p.scale(iw / size[2]!, ih / size[3]!);
      p.strokeStyle = style.color;
      p.lineWidth = Number(vector.getAttribute('stroke-width') || 2);
      p.lineCap = 'round';
      p.lineJoin = 'round';
      for (const path of vector.querySelectorAll('path[d]'))
        p.stroke(new Path2D(path.getAttribute('d')!));
      p.restore();
    }
  }
  for (const svg of button.querySelectorAll<SVGSVGElement>('svg[viewBox]')) {
    const r = svg.getBoundingClientRect(),
      view = svg.viewBox.baseVal;
    if (!r.width || !view.width) continue;
    p.save();
    p.translate(r.left - box.left, r.top - box.top);
    p.scale(r.width / view.width, r.height / view.height);
    p.lineWidth = Number(svg.getAttribute('stroke-width') || 1.7);
    p.lineCap = 'round';
    p.lineJoin = 'round';
    p.strokeStyle = getComputedStyle(svg).color;
    for (const shape of svg.querySelectorAll('path,circle,line,rect,polyline,polygon')) {
      const a = (name: string) => Number(shape.getAttribute(name) || 0);
      const path = new Path2D(shape.tagName === 'path' ? shape.getAttribute('d') || '' : '');
      if (shape.tagName === 'circle') path.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2);
      if (shape.tagName === 'rect') path.rect(a('x'), a('y'), a('width'), a('height'));
      if (shape.tagName === 'line') {
        path.moveTo(a('x1'), a('y1'));
        path.lineTo(a('x2'), a('y2'));
      }
      if (shape.tagName === 'polyline' || shape.tagName === 'polygon') {
        const points = (shape.getAttribute('points') || '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        for (let i = 0; i + 1 < points.length; i += 2) {
          if (i === 0) path.moveTo(points[i]!, points[i + 1]!);
          else path.lineTo(points[i]!, points[i + 1]!);
        }
        if (shape.tagName === 'polygon') path.closePath();
      }
      p.stroke(path);
    }
    p.restore();
  }
  if (burst.samples.size >= 4) burst.samples.delete(burst.samples.keys().next().value!);
  burst.samples.set(key, plate);
  return plate;
}

/** A single cropped control layer moves as a unit: surface, icon and lettering. */
export function fractureControl(
  ctx: CanvasRenderingContext2D,
  button: HTMLElement,
  burst: GlitchBurst,
  surface: string,
) {
  const beat = packet(burst.elapsed);
  if (burst.elapsed >= glitchLifetime || quiet(beat) || beat === 0) return;
  const box = button.getBoundingClientRect(),
    plate = controlPlate(button, burst, surface);
  const ratio = plate.width / box.width;
  const shift = Math.round(
    (beat % 2 ? -1 : 1) * Math.min(14, box.width * 0.07) * (0.6 + hash(burst.seed + beat) * 0.4),
  );
  const dy = ((beat % 3) - 1) * 2;
  const position = [0.14, 0.32, 0.46, 0.72, 0.6][beat % 5]!;
  const sourceY = Math.round(box.height * position);
  const height = Math.round(Math.min(7, Math.max(3, box.height * 0.12)));
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#43deef';
  ctx.fillRect(box.left + shift + 3, box.top + sourceY + dy, box.width, height);
  ctx.fillStyle = '#ed7097';
  ctx.fillRect(box.left + shift - 3, box.top + sourceY + dy, box.width, height);
  ctx.globalAlpha = 1;
  ctx.drawImage(
    plate,
    0,
    sourceY * ratio,
    plate.width,
    height * ratio,
    box.left + shift,
    box.top + sourceY + dy,
    box.width,
    height,
  );
  ctx.restore();
}
