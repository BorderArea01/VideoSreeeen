export const glitchLifetime = 840;
export type GlitchBurst = {
  seed: number;
  elapsed: number;
  dx: number;
  samples: Map<string, HTMLCanvasElement>;
  travel?: number;
  size?: number;
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

/** A bounded high-detail material atlas, with an exact RGB inverse beside it.
 * Only our own photo and theme surface are sampled; never video or page pixels. */
function edgeMaterial(
  sky: HTMLCanvasElement,
  scale: number,
  burst: GlitchBurst,
  x: number,
  y: number,
  width: number,
  height: number,
  inside: number,
  left: boolean,
  surface: string,
) {
  const key = ['edge-pair', x, y, width, height, inside, left, surface].join(':');
  const cached = burst.samples.get(key);
  if (cached) return cached;
  const ratio = Math.min(scale, 1.5);
  const w = Math.max(1, Math.ceil(width * ratio)),
    h = Math.max(1, Math.ceil(height * ratio));
  const plate = document.createElement('canvas');
  plate.width = w * 2;
  plate.height = h;
  const p = plate.getContext('2d', { willReadFrequently: true })!;
  const rx = w / width,
    ry = h / height;
  const sx = Math.max(0, x),
    sy = Math.max(0, y);
  const sw = Math.max(0, Math.min(x + width, sky.width / scale) - sx);
  const sh = Math.max(0, Math.min(y + height, sky.height / scale) - sy);
  if (sw && sh)
    p.drawImage(
      sky,
      sx * scale,
      sy * scale,
      sw * scale,
      sh * scale,
      (sx - x) * rx,
      (sy - y) * ry,
      sw * rx,
      sh * ry,
    );
  p.fillStyle = surface === 'rgba(0, 0, 0, 0)' ? '#f5f7fbeb' : surface;
  p.fillRect(left ? w - inside * rx : 0, 0, inside * rx, h);
  const image = p.getImageData(0, 0, w, h),
    pixels = image.data;
  // Sparse one-pixel rows undergo real luminance sorting. Most photo rows retain
  // native detail instead of stretching the old 96 px sample into broad slabs.
  for (let row = 3; row < h; row += 7) {
    const seam = left ? w - inside * rx : inside * rx;
    const from = Math.max(0, Math.floor(seam - 26 * rx));
    const to = Math.min(w, Math.ceil(seam + 74 * rx));
    for (let col = from; col < to; col += 24) {
      const colors: number[][] = [];
      for (let k = col; k < Math.min(to, col + 24); k++) {
        const o = (row * w + k) * 4;
        colors.push([pixels[o]!, pixels[o + 1]!, pixels[o + 2]!, pixels[o + 3]!]);
      }
      const direction = row % 2 ? 1 : -1;
      colors.sort(
        (a, b) =>
          direction *
          ((a[0]! - b[0]!) * 0.2126 + (a[1]! - b[1]!) * 0.7152 + (a[2]! - b[2]!) * 0.0722),
      );
      colors.forEach((color, k) => pixels.set(color, (row * w + col + k) * 4));
    }
  }
  p.putImageData(image, 0, 0);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i]!;
    pixels[i + 1] = 255 - pixels[i + 1]!;
    pixels[i + 2] = 255 - pixels[i + 2]!;
  }
  p.putImageData(image, w, 0);
  if (burst.samples.size >= 4) burst.samples.delete(burst.samples.keys().next().value!);
  burst.samples.set(key, plate);
  return plate;
}

/** Fine original/inverse scan fragments. Discrete data beats, no elastic motion. */
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
    exclusions?: DOMRect[];
  },
) {
  if (burst.elapsed < 0 || burst.elapsed >= glitchLifetime) return;
  const { box: r, compact, impact, left = false, surface } = edge;
  const step = packet(burst.elapsed),
    seed = burst.seed;
  if (quiet(step)) return;
  const travel = burst.travel ?? 1,
    size = burst.size ?? 1;
  const activeHeight = Math.min(r.height, compact ? r.height : 330 * size);
  const top =
    r.top + Math.max(0, Math.min(r.height - activeHeight, r.height * impact - activeHeight * 0.5));
  const anchor = left ? r.left : r.right,
    direction = left ? -1 : 1;
  const inside = Math.min(compact ? 26 : 68, r.width * 0.16) * Math.min(1, size);
  const reach = (compact ? 76 : 164) * travel;
  const origin = left ? anchor - reach : anchor - inside;
  const width = inside + reach;
  const plate = edgeMaterial(
    sky,
    scale,
    burst,
    origin,
    top,
    width,
    activeHeight,
    inside,
    left,
    surface,
  );
  const half = plate.width / 2,
    rx = half / width,
    ry = plate.height / activeHeight;
  const rows = Math.max(10, Math.round(activeHeight / (compact ? 2.15 : 2.8)));
  const pitch = activeHeight / rows;
  const draw = (
    x: number,
    y: number,
    w: number,
    h: number,
    shift: number,
    inverse = false,
    sourceOffset = 0,
    sampleAt?: number,
  ) => {
    // Shorten each fragment before protected UI with an unequal, porous tail.
    // Avoid painting long strips and then erasing them along a common hard wall.
    let end = x + shift + w;
    let begin = x + shift;
    for (const obstacle of edge.exclusions ?? []) {
      if (y + h <= obstacle.top - 10 || y >= obstacle.bottom + 10) continue;
      const slack = 2 + hash(seed + Math.floor(y) * 7 + step * 11) * 10;
      if (begin < obstacle.left - 10 && end > obstacle.left - 10)
        end = Math.min(end, obstacle.left - 10 - slack);
      if (end > obstacle.right + 10 && begin < obstacle.right + 10)
        begin = Math.max(begin, obstacle.right + 10 + slack);
      if (begin >= obstacle.left - 10 && end <= obstacle.right + 10) return;
    }
    if (end - begin < 1) return;
    const trim = begin - (x + shift);
    x += trim;
    w = end - begin;
    const sx = Math.max(
      0,
      Math.min(width - w, sampleAt === undefined ? x - origin : sampleAt + trim),
    );
    const sy = Math.max(0, Math.min(activeHeight - h, y - top + sourceOffset));
    ctx.drawImage(
      plate,
      (inverse ? half : 0) + sx * rx,
      sy * ry,
      Math.max(0.5, w * rx),
      Math.max(0.5, h * ry),
      x + shift,
      y,
      w,
      h,
    );
  };
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // Keep every inward fragment within the perimeter's outer 16%.
  ctx.beginPath();
  ctx.rect(left ? anchor - reach - 24 : anchor - inside, top, width + 24, activeHeight);
  ctx.clip();
  for (let j = 0; j < rows; j++) {
    const n = seed + j * 19;
    if (hash(n + 4) > density(burst.elapsed) || hash(n + 12) < 0.2) continue;
    const group = Math.floor(j / 7);
    const beat = hash(seed + group * 43 + step * 29);
    const y = Math.round(top + j * pitch + hash(n + 70) * 1.8);
    const h = Math.min(
      activeHeight - (y - top),
      Math.max(1, (j % 23 === 0 ? 5 : j % 9 === 0 ? 3 : 1 + Math.floor(hash(n + 2) * 2)) * size),
    );
    if (h <= 0) continue;
    const depth = Math.min(inside, 2 + hash(n + 3) * inside);
    const length = 5 + hash(n + 8) ** 1.7 * (reach - 16) + Math.floor(beat * 3) * 4;
    const run = Math.min(width, depth + length);
    const x = left ? anchor - length : anchor - depth;
    const shift = direction * (Math.floor(beat * 7) - 3) * 6 * travel;
    const reorder =
      j % 4 === 0
        ? Math.floor(hash(seed + group * 17 + step * 7) * Math.max(1, activeHeight - 5)) - (y - top)
        : (Math.floor(hash(n + step * 7) * 7) - 3) * 3;
    // Exchange the two sides of the seam: photo fragments intrude into the
    // light perimeter while displaced surface fragments extend over the photo.
    // A nearly aligned copy would disappear against its own backdrop and leave
    // only the black inverse visible, creating a regular barcode.
    const photoAt = left ? Math.max(0, reach - run - 8) : inside + 4;
    const sourceAt = j % 3 === 0 ? photoAt : undefined;
    ctx.globalAlpha = burst.elapsed < 630 ? 1 : 0.62;
    // Small gaps and unequal starts make an eroded contour rather than a ladder
    // of broad rectangles. The original material keeps photographic detail.
    if (j % 5 === 0 && run > 30) {
      const cut = run * (0.3 + hash(n + 5) * 0.3),
        gap = 2 + hash(n + 6) * 5;
      draw(x, y, cut, h, shift, false, reorder, sourceAt);
      draw(
        x + cut + gap,
        y,
        Math.max(1, run - cut - gap),
        h,
        shift,
        false,
        reorder,
        sourceAt === undefined ? undefined : sourceAt + cut + gap,
      );
    } else draw(x, y, run, h, shift, false, reorder, sourceAt);
    // The exact inverse of that same photo/surface travels in the opposite
    // direction; use short, mostly one-pixel counterstrips instead of fat neon bars.
    if (j % 7 === 0 || (j % 11 === 0 && h > 1)) {
      const counter = Math.min(run, 5 + hash(n + 11) * (compact ? 18 : 32));
      const cx = left ? anchor - counter * 0.65 : anchor - Math.min(depth, counter * 0.65);
      draw(
        cx,
        y + (j % 2 ? 0 : 1),
        counter,
        j % 14 === 0 ? 2 : 1,
        -shift - direction * (2 + Math.floor(beat * 3) * 2),
        true,
        reorder,
        j % 2 ? undefined : photoAt,
      );
    }
    if (j % 11 === 0) {
      const tail = 3 + hash(n + 31) * 9;
      const tx = anchor + direction * (length + 4 + Math.floor(beat * 4) * 3);
      draw(tx, y + 1, tail, 1, -shift, j % 22 === 0, reorder);
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
  ctx.translate(x, y);
  ctx.scale(burst.travel ?? 1, burst.size ?? 1);
  ctx.translate(-x, -y);
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
