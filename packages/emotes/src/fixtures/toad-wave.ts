import { KingdomIdSchema } from '../deps';
import { createSha256 } from '../sha256';
import type { DecodedEmote, EmoteSource } from '../types';

/**
 * SIMULATED fixture: "Toad Wave", an original emote drawn for this module, not taken from any
 * channel. It is deliberately asymmetric so orientation mistakes show: the open eye is on the
 * viewer's left, the wink and the tilted crown on the right, and the waving arm on the right
 * leaves a clear gap beside the head. Opaque near-black outlines sit on fully transparent black.
 *
 * Painted from signed distances with 4×4 supersampling at Twitch's 112 px size, using only
 * correctly rounded arithmetic (no trigonometry), so the raster and its hash match everywhere.
 */
export const TOAD_WAVE_SIZE = 112;

export type Sdf = (x: number, y: number) => number;
export type Rgb = readonly [number, number, number];
export interface Layer { sdf: Sdf; fill: Rgb; outline?: number }

export const OUTLINE: Rgb = [28, 24, 32];
// Math.hypot may differ by an ulp between engines; sqrt is correctly rounded everywhere.
export const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const circle = (cx: number, cy: number, r: number): Sdf => (x, y) => length(x - cx, y - cy) - r;
export const ellipse = (cx: number, cy: number, rx: number, ry: number): Sdf => (x, y) => (length((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
export const capsule = (ax: number, ay: number, bx: number, by: number, r: number): Sdf => (x, y) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return length(px - dx * t, py - dy * t) - r;
};
/** A band along a circle, kept on one side of a line (no angles needed). */
export const arc = (cx: number, cy: number, radius: number, thickness: number, keep: (x: number, y: number) => boolean): Sdf => (x, y) =>
  keep(x, y) ? Math.abs(length(x - cx, y - cy) - radius) - thickness / 2 : 99;
export const polygon = (points: readonly (readonly [number, number])[]): Sdf => (x, y) => {
  let inside = false, best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, length(x - xi - dx * t, y - yi - dy * t));
  }
  return inside ? -best : best;
};
export const union = (...shapes: Sdf[]): Sdf => (x, y) => {
  let best = Infinity;
  for (const shape of shapes) best = Math.min(best, shape(x, y));
  return best;
};
export const intersect = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), b(x, y));

// The crown is tilted 16° clockwise about its base centre: cos and sin written out exactly.
const COS = .9612616959383189, SIN = .27563735581699916;
const tilt = (points: readonly (readonly [number, number])[], cx: number, cy: number): [number, number][] =>
  points.map(([x, y]) => [cx + (x - cx) * COS - (y - cy) * SIN, cy + (x - cx) * SIN + (y - cy) * COS]);

export const GREEN: Rgb = [116, 178, 74], DEEP_GREEN: Rgb = [78, 132, 62], BELLY: Rgb = [236, 222, 162];
export const head = ellipse(48, 70, 37, 30);
export const leftBump = circle(30, 42, 15), rightBump = circle(64, 40, 14);
const arm = capsule(78, 84, 98, 46, 6.5), hand = union(circle(99, 38, 8.5), circle(93, 28, 3.6), circle(100, 26, 3.8), circle(107, 31, 3.4));
export const crown = polygon(tilt([[52, 26], [52, 12], [58, 19], [64, 8], [70, 19], [76, 12], [76, 26]], 64, 26));

const SILHOUETTE: readonly Layer[] = [
  { sdf: arm, fill: GREEN, outline: 2.6 }, { sdf: hand, fill: GREEN, outline: 2.6 },
  { sdf: leftBump, fill: GREEN, outline: 2.6 }, { sdf: rightBump, fill: GREEN, outline: 2.6 }, { sdf: head, fill: GREEN, outline: 2.6 },
];
export const DETAILS: readonly Layer[] = [
  // Darker back of the head, then the pale belly that reads the face from a distance.
  { sdf: intersect(head, ellipse(52, 48, 40, 14)), fill: DEEP_GREEN },
  { sdf: intersect(head, ellipse(46, 90, 27, 15)), fill: BELLY },
  // Open eye on the viewer's left: sclera, pupil looking toward the wave, highlight.
  { sdf: circle(30, 43, 10), fill: [246, 240, 226], outline: 2 },
  { sdf: circle(33, 45, 5.6), fill: OUTLINE },
  { sdf: circle(35, 42.5, 1.9), fill: [255, 255, 255] },
  // The wink: a happy closed eye.
  { sdf: arc(64, 46, 7, 3.4, (_x, y) => y < 45), fill: OUTLINE },
  // Lopsided grin rising toward the waving side, with the tongue poking out on the right.
  { sdf: arc(46, 58, 24, 3.4, (x, y) => y > 70 && x > 26 && x < 68), fill: OUTLINE },
  { sdf: intersect(ellipse(62, 82, 7, 6.5), (x, y) => 78.6 - y), fill: [222, 108, 118], outline: 2 },
  // One rosy cheek under the open eye.
  { sdf: ellipse(20, 66, 6, 3.6), fill: [222, 134, 126] },
  // Tilted crown over the wink, with one garnet.
  { sdf: crown, fill: [236, 190, 72], outline: 2.4 },
  { sdf: circle(65, 20.5, 2.6), fill: [176, 52, 58] },
];

function sample(x: number, y: number): Rgb | null {
  let colour: Rgb | null = null;
  for (const layer of SILHOUETTE) if (layer.sdf(x, y) < (layer.outline ?? 0)) colour = OUTLINE;
  for (const layer of SILHOUETTE) if (layer.sdf(x, y) < 0) colour = layer.fill;
  for (const layer of DETAILS) {
    const distance = layer.sdf(x, y);
    if (layer.outline && distance < layer.outline && distance >= 0 && colour) colour = OUTLINE;
    if (distance < 0) colour = layer.fill;
  }
  return colour;
}

let painted: { rgba: Uint8Array; hash: string } | undefined;

/** The painted raster is pure, so it is drawn once per realm and every caller gets its own copy. */
function toadWave(): { rgba: Uint8Array; hash: string } {
  if (!painted) {
    const rgba = drawToadWave();
    painted = { rgba, hash: simulatedRasterHash(TOAD_WAVE_SIZE, TOAD_WAVE_SIZE, [rgba]) };
  }
  return painted;
}

export function paintToadWave(): Uint8Array {
  return toadWave().rgba.slice();
}

function drawToadWave(): Uint8Array {
  const size = TOAD_WAVE_SIZE, rgba = new Uint8Array(size * size * 4), grid = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let hits = 0, r = 0, g = 0, b = 0;
    for (let sy = 0; sy < grid; sy++) for (let sx = 0; sx < grid; sx++) {
      const colour = sample(px + (sx + .5) / grid, py + (sy + .5) / grid);
      if (!colour) continue;
      hits++; r += colour[0]; g += colour[1]; b += colour[2];
    }
    if (!hits) continue; // Transparent black: alpha zero, never an opaque black pixel.
    const offset = (px + py * size) * 4;
    rgba[offset] = Math.round(r / hits); rgba[offset + 1] = Math.round(g / hits); rgba[offset + 2] = Math.round(b / hits);
    rgba[offset + 3] = Math.round(hits * 255 / (grid * grid));
  }
  return rgba;
}

/** Hash of a simulated raster: there are no fetched bytes, so the canonical RGBA stands in. */
export function simulatedRasterHash(width: number, height: number, frames: readonly Uint8Array[]): string {
  const hash = createSha256();
  hash.update(new TextEncoder().encode(`chatdom-simulated-raster|${width}x${height}|${frames.length}|`));
  for (const frame of frames) hash.update(frame);
  return hash.hex();
}

export const SIMULATED_KINGDOM = KingdomIdSchema.parse('900000001');

export function toadWaveFixture(): { source: EmoteSource; decoded: DecodedEmote } {
  const { hash } = toadWave(), rgba = paintToadWave();
  return {
    source: {
      id: 'twitch.simulated-toadwave', provider: 'twitch', providerId: 'simulated-toadwave', kingdomId: SIMULATED_KINGDOM,
      name: 'toadWave', origin: 'simulated', sourceHash: hash, rendition: 'png',
    },
    decoded: { width: TOAD_WAVE_SIZE, height: TOAD_WAVE_SIZE, frames: [{ rgba, durationMs: 0 }] },
  };
}
