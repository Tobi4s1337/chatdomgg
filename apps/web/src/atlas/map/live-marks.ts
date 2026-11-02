import { GRAPHITE, INK, LAND, VERMILION, VERMILION_DEEP, rgba } from './theme';

/**
 * The painted marks of the live layer, drawn once into canvases: watercolour blots for the wash, the pennants of the
 * five live classes on their standard, the bare standard of an offline holding, and the pencil flag of a small live
 * channel. Shapes are seeded, so every load paints the same marks.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const BLOT_SIZE = 128;
export const BLOT_VARIANTS = 4;

/** Smooth value noise on a small lattice, for the mottling of a wash as it dries unevenly. */
function valueNoise(random: () => number, cells: number): (x: number, y: number) => number {
  const grid = Array.from({ length: (cells + 1) * (cells + 1) }, () => random());
  const at = (i: number, j: number) => grid[j * (cells + 1) + i]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = Math.min(cells - 1e-6, Math.max(0, x * cells));
    const fy = Math.min(cells - 1e-6, Math.max(0, y * cells));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = smooth(fx - i);
    const v = smooth(fy - j);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

/**
 * One watercolour blot as white pigment density in alpha: an irregular rim from several harmonics (a brush never
 * leaves a circle), a paler body mottled where the water dried unevenly, pigment pooled darker at the drying edge,
 * granulation in the paper's tooth, and a soft bleed outside the rim.
 */
export function paintBlot(ctx: CanvasRenderingContext2D, variant: number): void {
  const size = BLOT_SIZE;
  const c = size / 2;
  const random = rng(0x5eed + variant * 7919);
  const harmonics = Array.from({ length: 6 }, (_, k) => ({ k: k + 2, a: (0.05 + random() * 0.11) / (1 + k * 0.45), p: random() * Math.PI * 2 }));
  const radius = (angle: number) => 1 + harmonics.reduce((sum, h) => sum + h.a * Math.sin(h.k * angle + h.p), 0);
  const mottle = valueNoise(random, 5);
  const fine = valueNoise(random, 14);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const noise = new Float32Array(size * size);
  for (let i = 0; i < noise.length; i++) noise[i] = random();
  const rim = c * 0.8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      // The rim wanders a little more with fine noise, so the edge reads as a drying tide line, not a vector.
      const edge = rim * radius(Math.atan2(dy, dx)) * (0.96 + 0.08 * fine(x / size, y / size));
      const d = Math.hypot(dx, dy) / edge;
      let alpha: number;
      if (d >= 1.14) alpha = 0;
      else if (d >= 1) alpha = 0.26 * (1 - (d - 1) / 0.14) ** 2; // bleed
      else {
        const pool = Math.max(0, (d - 0.78) / 0.22);
        alpha = 0.4 + 0.26 * mottle(x / size, y / size) + 0.34 * pool * pool;
      }
      const grain = (noise[y * size + x]! + noise[((y * 7 + x * 3) % size) * size + ((x * 5 + y) % size)]!) / 2;
      alpha *= 0.84 + 0.26 * grain;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The density stain for world distance: a soft, round deposit with no rim, so thousands of them run together into
 * one field of pigment whose depth follows how many are on air, the way a wash pools where a brush lingered.
 */
export function paintDensity(ctx: CanvasRenderingContext2D): void {
  const size = BLOT_SIZE;
  const c = size / 2;
  const random = rng(0xde45);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      const t = Math.max(0, 1 - d);
      // Smooth falloff with a broad body; a whisper of grain keeps it paper, not airbrush.
      const alpha = t * t * (3 - 2 * t) * (0.92 + 0.08 * random());
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Pennant lengths in CSS px for live classes 1–4 (class 1 also flies a second, shorter one below). */
export const PENNANT_LENGTH = [0, 26, 22, 16, 11] as const;
/** Standard height above the shield, in CSS px. */
export const STAFF = 20;
export const PENCIL_STAFF = 12;

export interface StandardImage { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number }

function canvasFor(width: number, height: number, pixelRatio: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(pixelRatio, pixelRatio);
  return [canvas, ctx];
}

function pennantPath(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, depth: number, swallow: boolean, wave: number): void {
  const tipY = y + depth * 0.5 + wave * 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + length * 0.35, y - wave * 0.9, x + length * 0.62, y + depth * 0.2 + wave, x + length, tipY - (swallow ? depth * 0.22 : 0.15));
  if (swallow) ctx.lineTo(x + length * 0.8, tipY + 0.1);
  ctx.lineTo(x + length, tipY + (swallow ? depth * 0.22 : 0.15));
  ctx.bezierCurveTo(x + length * 0.62, y + depth * 0.8 + wave, x + length * 0.35, y + depth - wave * 0.9, x, y + depth);
  ctx.closePath();
}

function cloth(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, depth: number, swallow: boolean, wave: number): void {
  pennantPath(ctx, x, y, length, depth, swallow, wave);
  const gradient = ctx.createLinearGradient(x, 0, x + length, 0);
  gradient.addColorStop(0, VERMILION_DEEP);
  gradient.addColorStop(1, VERMILION);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = rgba(INK, 0.82);
  ctx.lineWidth = 0.7;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function staff(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, bottom);
  ctx.lineTo(x, top + 1.6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, top + 1.2, 1.25, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A holding's standard: bare when offline (class 0), or flying the pennant of its live class. The anchor is the
 * foot of the staff, which stands on the top of the shield.
 */
export function standardImage(liveClass: number, variant: number, pixelRatio: number): StandardImage {
  const length = PENNANT_LENGTH[liveClass as 1] ?? 0;
  const width = 4 + Math.max(length, 2) + 3;
  const height = STAFF + 2;
  const [canvas, ctx] = canvasFor(width, height, pixelRatio);
  const x = 3;
  staff(ctx, x, 1, height, rgba(INK, liveClass ? 0.95 : 0.72), liveClass ? 1.1 : 0.9);
  if (liveClass >= 1 && liveClass <= 4) {
    const wave = [0.9, -0.7, 1.2][variant % 3]!;
    const depth = liveClass === 1 ? 6.2 : liveClass === 2 ? 5.6 : liveClass === 3 ? 4.8 : 4;
    cloth(ctx, x + 0.4, 3.2, length, depth, liveClass <= 2, wave);
    if (liveClass === 1) cloth(ctx, x + 0.4, 3.2 + depth + 1.8, length * 0.72, depth * 0.85, true, -wave);
  }
  return { canvas, width, height, anchorX: x / width, anchorY: 1 };
}

/**
 * The pencil flag of a small live channel (class 5, or a dab): a graphite staff and a small notched flag holding a
 * touch of the same wash. Pencil, not ink: it has no land yet.
 */
export function pencilFlagImage(pixelRatio: number, options: { scale?: number; live?: boolean } = {}): StandardImage {
  const k = options.scale ?? 1;
  const live = options.live ?? true;
  const base = PENCIL_STAFF + 2;
  const width = Math.ceil(13 * k);
  const height = Math.ceil(base * k);
  const [canvas, ctx] = canvasFor(width, height, pixelRatio);
  ctx.scale(k, k);
  const x = 2.5;
  ctx.strokeStyle = rgba(GRAPHITE, 0.9);
  ctx.lineWidth = 0.85;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, base - 0.5);
  ctx.lineTo(x, 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, 1.6);
  ctx.lineTo(x + 8.4, 2.2);
  ctx.lineTo(x + 6.4, 4.4);
  ctx.lineTo(x + 8.4, 6.6);
  ctx.lineTo(x, 7);
  ctx.closePath();
  // A touch of wash inside a graphite outline, with two strokes of hatching: drawn, not yet inked. Off the air it
  // keeps the paper's own colour under the hatching.
  ctx.fillStyle = live ? rgba(VERMILION, 0.3) : rgba(LAND, 0.92);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(GRAPHITE, 0.55);
  ctx.lineWidth = 0.5;
  for (let hatch = 0; hatch < 4; hatch++) {
    ctx.beginPath();
    ctx.moveTo(x + hatch * 2.6 - 1, 7.4);
    ctx.lineTo(x + hatch * 2.6 + 4, 1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = rgba(GRAPHITE, 0.95);
  ctx.lineWidth = 0.75;
  ctx.stroke();
  return { canvas, width, height, anchorX: (x * k) / width, anchorY: 1 };
}
