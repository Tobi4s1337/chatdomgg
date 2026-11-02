import type { PierAlmanacStatus } from '@chatdom/shared';
import { itemPortrait, portraitPixels } from '../bag/portrait';

/* The fish on each page, drawn from its real voxel model as the bag draws it, then finished for paper: a coloured
   plate for a caught fish, a pool of ink for one that lives here unseen, a pencil sketch for one only caught elsewhere.
   Finished art is cached by fish, state and size; every canvas on a page copies from it. */

export type PlateTint = 'fresh' | 'sea' | 'legends';
const INK = '#2b2431', INK_SOFT = 'rgba(70, 60, 82, 0.55)', GRAPHITE = 'rgba(74, 70, 78, 0.85)';
const WASH: Readonly<Record<PlateTint, readonly [number, number, number]>> = { fresh: [118, 160, 148], sea: [104, 142, 176], legends: [214, 172, 92] };
const MAX_ART = 64;

const art = new Map<string, Promise<HTMLCanvasElement>>();

function canvas(width: number, height: number): HTMLCanvasElement {
  const made = document.createElement('canvas');
  made.width = Math.max(1, Math.round(width));
  made.height = Math.max(1, Math.round(height));
  return made;
}

/** The part of the render that is not clear, with a hair of margin. */
function opaqueCrop(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
  const probe = canvas(width, height), ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! < 10) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.035) + 2;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = canvas(maxX - minX + 1, maxY - minY + 1);
  out.getContext('2d')!.drawImage(probe, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** The fish's shape filled with one colour. */
function mask(shape: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const out = canvas(shape.width, shape.height), ctx = out.getContext('2d')!;
  ctx.drawImage(shape, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Engraver's hatching over the shape: fine diagonal lines, a little uneven, as if cut by hand. */
function hatch(ctx: CanvasRenderingContext2D, width: number, height: number, gap: number, colour: string, line: number, seed: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  hatchLines(ctx, width, height, gap, colour, line, seed);
  ctx.restore();
}

function hatchLines(ctx: CanvasRenderingContext2D, width: number, height: number, gap: number, colour: string, line: number, seed: number): void {
  let state = seed >>> 0 || 7;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  for (let x = -height; x < width + height; x += gap) {
    ctx.lineWidth = line * (0.75 + random() * 0.5);
    ctx.beginPath();
    const wobble = (random() - 0.5) * gap * 0.4;
    ctx.moveTo(x + wobble, height + 2);
    ctx.lineTo(x + height * 0.9 + wobble, -2);
    ctx.stroke();
  }
  ctx.restore();
}

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** A pool of ink: the fish is here, in the dark water, and nobody has seen it yet. */
function inkSilhouette(shape: HTMLCanvasElement, seed: number, scale: number): HTMLCanvasElement {
  const out = mask(shape, INK), ctx = out.getContext('2d')!;
  // A lighter wash along the back and the belly, so the shape reads as a body rather than a hole.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const light = ctx.createLinearGradient(0, 0, 0, out.height);
  light.addColorStop(0, 'rgba(120, 104, 140, 0.32)'); light.addColorStop(0.45, 'rgba(60, 50, 72, 0)'); light.addColorStop(1, 'rgba(20, 14, 24, 0.25)');
  ctx.fillStyle = light; ctx.fillRect(0, 0, out.width, out.height);
  ctx.restore();
  hatch(ctx, out.width, out.height, 3.6 * scale, 'rgba(160, 142, 178, 0.3)', 0.8 * scale, seed);
  return out;
}

/** A pencil sketch: an outline drawn twice, a little loose, and light hatching inside. */
function pencilSketch(shape: HTMLCanvasElement, seed: number, scale: number): HTMLCanvasElement {
  const solid = mask(shape, '#000');
  const out = canvas(shape.width, shape.height), ctx = out.getContext('2d')!;
  const ring = (radius: number, alpha: number, dx: number, dy: number) => {
    const edge = canvas(shape.width, shape.height), e = edge.getContext('2d')!;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      e.drawImage(solid, Math.cos(a) * radius + dx, Math.sin(a) * radius + dy);
    }
    e.globalCompositeOperation = 'destination-out';
    e.drawImage(solid, dx * 0.5, dy * 0.5);
    e.globalCompositeOperation = 'source-in';
    e.fillStyle = GRAPHITE;
    e.fillRect(0, 0, edge.width, edge.height);
    ctx.globalAlpha = alpha;
    ctx.drawImage(edge, 0, 0);
    ctx.globalAlpha = 1;
  };
  ring(1.3 * scale, 0.85, 0, 0);
  ring(1 * scale, 0.35, 1.4 * scale, -1 * scale);
  // Light hatching, kept inside the shape: lines on clear paper, then cut to the fish.
  const inside = canvas(shape.width, shape.height), i = inside.getContext('2d')!;
  i.fillStyle = 'rgba(120, 104, 84, 0.06)';
  i.fillRect(0, 0, inside.width, inside.height);
  hatchLines(i, inside.width, inside.height, 5.4 * scale, 'rgba(78, 72, 84, 0.42)', 0.8 * scale, seed);
  i.globalCompositeOperation = 'destination-in';
  i.drawImage(solid, 0, 0);
  ctx.drawImage(inside, 0, 0);
  return out;
}

/** Finished art for one fish, state and pixel size. Rejects when the render cannot be made. */
export function plateArt(defId: string, status: PierAlmanacStatus, size: number): Promise<HTMLCanvasElement> {
  const pixels = portraitPixels(size), key = `${defId}|${status}|${pixels}`;
  const cached = art.get(key);
  if (cached) return cached;
  const job = itemPortrait(defId, size).then(bitmap => {
    const shape = opaqueCrop(bitmap, bitmap.width, bitmap.height);
    if (!shape) throw new Error('This fish could not be drawn.');
    const scale = Math.max(1, pixels / 360);
    if (status === 'caught') return shape;
    return status === 'waiting' ? inkSilhouette(shape, seedOf(defId), scale) : pencilSketch(shape, seedOf(defId), scale);
  });
  art.set(key, job);
  job.catch(() => { if (art.get(key) === job) art.delete(key); });
  while (art.size > MAX_ART) art.delete(art.keys().next().value!);
  return job;
}

/** A watercolour wash laid on the paper before the fish: soft, uneven, tinted by the water it lives in. */
function wash(ctx: CanvasRenderingContext2D, width: number, height: number, tint: PlateTint, status: PierAlmanacStatus, seed: number): void {
  if (status === 'elsewhere') return;
  let state = seed || 3;
  const random = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
  const [r, g, b] = status === 'waiting' ? [62, 70, 96] as const : WASH[tint];
  const strength = status === 'waiting' ? 0.12 : 0.3;
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const x = width * (0.22 + random() * 0.56), y = height * (0.42 + random() * 0.3);
    const rx = width * (0.18 + random() * 0.2), ry = height * (0.12 + random() * 0.12);
    ctx.setTransform(1, 0, 0, ry / rx, 0, 0);
    const blob = ctx.createRadialGradient(x, y * rx / ry, 0, x, y * rx / ry, rx);
    const a = strength * (0.5 + random() * 0.5);
    blob.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`);
    blob.addColorStop(0.62, `rgba(${r}, ${g}, ${b}, ${(a * 0.55).toFixed(3)})`);
    blob.addColorStop(0.86, `rgba(${r}, ${g}, ${b}, ${(a * 0.14).toFixed(3)})`);
    blob.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height * rx / ry);
  }
  ctx.restore();
  // A few horizontal strokes of water under the fish, laid with a dry brush.
  ctx.save();
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${status === 'waiting' ? 0.16 : 0.28})`;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const y = height * (0.8 + i * 0.035) + (random() - 0.5) * 4, x0 = width * (0.14 + random() * 0.2), x1 = width * (0.62 + random() * 0.24);
    ctx.lineWidth = 1 + random() * 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo((x0 + x1) / 2, y - 2 - random() * 3, x1, y + (random() - 0.5) * 2); ctx.stroke();
  }
  ctx.restore();
}

export interface PaintOptions {
  readonly tint: PlateTint;
  /** Paper around the fish, as a share of the smaller side. */
  readonly margin?: number;
  /** Lay a wash under the fish (plates); thumbnails sit on the bare page. */
  readonly wash?: boolean;
}

/**
 * Paints a fish into `target` at its CSS size. Resolves true once drawn; false leaves the canvas clear and marks
 * `data-art="none"`, so a page shows its designed empty frame rather than a broken picture.
 */
export async function paintFish(target: HTMLCanvasElement, defId: string, status: PierAlmanacStatus, cssWidth: number, cssHeight: number, options: PaintOptions): Promise<boolean> {
  const dpr = Math.min(2.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(cssWidth * dpr)), height = Math.max(1, Math.round(cssHeight * dpr));
  target.dataset.art = 'pending';
  const token = `${defId}|${status}|${width}x${height}`;
  target.dataset.artFor = token;
  // A long fish fills a square render only across: ask for a render as wide as the space it will fill.
  const request = Math.min(1024 / dpr, Math.max(48, cssWidth * 1.06));
  try {
    const finished = await plateArt(defId, status, request);
    if (target.dataset.artFor !== token) return false;
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const ctx = target.getContext('2d');
    if (!ctx) throw new Error('No paper to draw on.');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (options.wash) wash(ctx, width, height, options.tint, status, seedOf(defId));
    const margin = Math.min(width, height) * (options.margin ?? 0.08);
    const fit = Math.min((width - margin * 2) / finished.width, (height - margin * 2) / finished.height);
    const w = finished.width * fit, h = finished.height * fit;
    const x = (width - w) / 2, y = (height - h) / 2 - (options.wash ? height * 0.02 : 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (status === 'caught') {
      ctx.shadowColor = 'rgba(52, 34, 22, 0.28)';
      ctx.shadowBlur = Math.max(2, h * 0.05);
      ctx.shadowOffsetY = Math.max(1, h * 0.035);
    } else if (status === 'waiting') {
      ctx.shadowColor = INK_SOFT;
      ctx.shadowBlur = Math.max(1, h * 0.03);
    }
    ctx.drawImage(finished, x, y, w, h);
    target.dataset.art = 'drawn';
    return true;
  } catch {
    if (target.dataset.artFor === token) {
      target.width = width; target.height = height;
      target.getContext('2d')?.clearRect(0, 0, width, height);
      target.dataset.art = 'none';
    }
    return false;
  }
}
