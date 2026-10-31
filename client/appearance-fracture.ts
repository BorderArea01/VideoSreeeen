type Edge = {
  box: DOMRect;
  compact: boolean;
  seed: number;
  age: number;
  impact: number;
  left?: boolean;
};

/** Photographic material belongs to the live edge, never to the background or movie. */
export function fractureEdge(
  ctx: CanvasRenderingContext2D,
  sky: HTMLCanvasElement,
  material: HTMLImageElement,
  scale: number,
  edge: Edge,
) {
  if (!material.complete || !material.naturalWidth) return;
  const { box: r, compact, seed, age, impact, left = false } = edge;
  const random = (n: number) => {
    const x = Math.sin(n * 91.713 + seed * 17.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const inside = Math.min(compact ? 25 : 64, r.width * 0.16);
  const width = compact ? 155 : 238;
  const height = left ? Math.min(100, r.height) : r.height;
  const top = left ? r.bottom - height : r.top;
  // Crop per owner so buttons retain chunky blocks instead of squeezing a whole card texture.
  const cropHeight = Math.min(material.naturalHeight, Math.max(compact ? 330 : 900, height * 2));
  const cropTop = random(7) * (material.naturalHeight - cropHeight);
  ctx.save();
  ctx.translate(left ? r.left : r.right, top);
  if (left) ctx.scale(-1, 1);
  const bandHeight = compact ? 2.5 : 8;
  for (let y = 0, band = 0; y < height; band++) {
    const h = Math.min(height - y, bandHeight * (0.55 + random(band + 21) * 1.4));
    const distance = Math.abs(y / height - impact);
    const wave =
      age >= 1
        ? 0
        : Math.sin(Math.max(0, Math.min(1, age * 1.5 - distance * 0.32)) * Math.PI) * (1 - age);
    const sy = cropTop + (y / height) * cropHeight;
    const sh = (h / height) * cropHeight;
    const stretch = 1 + wave * (0.2 + random(Math.floor(band / 3) + 51) * 0.44);
    const inset = inside * (0.54 + random(Math.floor(band / 3) + 91) * 0.46);
    // The root itself tears into offset packets, avoiding a straight pasted-on texture seam.
    ctx.save();
    ctx.translate(-inset, 0);
    if (compact) {
      ctx.fillStyle = '#f2f6fb';
      ctx.fillRect(0, y, inset, h);
    } else {
      const x = Math.max(0, left ? r.left : r.right - inset);
      const py = Math.max(0, top + y);
      const w = Math.min(inset, sky.width / scale - x);
      const ph = Math.min(h, sky.height / scale - py);
      if (w > 0 && ph > 0) {
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(sky, x * scale, py * scale, w * scale, ph * scale, x, py, w, ph);
        ctx.restore();
      }
    }
    // Root stays attached. Adjacent slices stretch as overlapping material packets.
    const fixed = 0.075;
    ctx.drawImage(material, 0, sy, material.naturalWidth * fixed, sh, 0, y, width * fixed, h);
    ctx.drawImage(
      material,
      material.naturalWidth * fixed,
      sy,
      material.naturalWidth * (1 - fixed),
      sh,
      width * fixed,
      y,
      width * (1 - fixed) * stretch,
      h,
    );
    ctx.restore();
    y += h;
  }
  ctx.restore();
}
