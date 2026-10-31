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
  for (let j = 0; j < 38; j++) {
    const n = seed + j * 13;
    if (hash(n) > density(burst.elapsed)) continue;
    const width = 20 + hash(n + 3) ** 1.7 * 205;
    const row = (j * 5 + step * 3) % 48;
    const offset =
      (Math.floor(hash(seed + Math.floor(j / 4) * 11 + step * 31) * 7) - 3) * 9 +
      Math.sign(burst.dx) * (step % 3) * 6;
    const px = x - width * 0.5 + (hash(n + 7) - 0.5) * 150 + offset;
    const py = y - 100 + (j / 38) * 200;
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

/** Repaint at most two thin strips of an app-owned button label, never chat text. */
export function fractureLabel(
  ctx: CanvasRenderingContext2D,
  button: HTMLElement,
  burst: GlitchBurst,
  surface: string,
) {
  const beat = packet(burst.elapsed);
  if (burst.elapsed >= glitchLifetime || quiet(beat) || beat === 0) return;
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim() ?? '';
      return text &&
        text.length <= 40 &&
        !node.parentElement?.closest('svg, small, [aria-hidden="true"]')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const node = walker.nextNode();
  if (!node) return;
  const text = node.textContent!.trim();
  const offset = node.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + text.length);
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(node.parentElement!);
  const fontSize = Number.parseFloat(style.fontSize);
  const shift = (beat % 2 ? -1 : 1) * (2 + Math.floor(hash(burst.seed + beat) * 4));
  ctx.save();
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.textBaseline = 'middle';
  const bandHeight = Math.max(1, Math.min(2, fontSize * 0.1));
  for (let strip = 0; strip < (beat === 2 || beat === 4 ? 2 : 1); strip++) {
    const y = rect.top + rect.height * (strip ? 0.68 : 0.35 + (beat % 3) * 0.1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left - 6, y, rect.width + 12, bandHeight);
    ctx.clip();
    ctx.fillStyle = surface;
    ctx.fillRect(rect.left - 6, y, rect.width + 12, bandHeight);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#43deef';
    ctx.fillText(text, rect.left + shift + 2, rect.top + rect.height / 2);
    ctx.fillStyle = '#ed7097';
    ctx.fillText(text, rect.left + shift - 2, rect.top + rect.height / 2);
    ctx.fillStyle = style.color;
    ctx.fillText(text, rect.left + shift, rect.top + rect.height / 2);
    ctx.restore();
  }
  ctx.restore();
}
