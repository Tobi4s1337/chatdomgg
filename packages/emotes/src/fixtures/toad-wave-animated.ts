import { sha256Hex } from '../sha256';
import type { EmoteSource } from '../types';
import { encodeGif, type GifFrameSpec } from './gif-encode';
import {
  arc, capsule, circle, DETAILS, GREEN, head, leftBump, OUTLINE, rightBump, SIMULATED_KINGDOM, TOAD_WAVE_SIZE, union,
  type Layer, type Rgb,
} from './toad-wave';

/**
 * SIMULATED fixture: "toadWave", animated. The same original toad as the still fixture, drawn for
 * this module and not taken from any channel. It rests with its arm tucked away, then raises a hand
 * and waves, blinking its open eye once. Encoded as a real GIF89a the way chat GIFs usually are:
 * a full first frame, then small patches restored with disposal 3, a transparent index for unchanged
 * pixels, varied delays and one zero delay, so the fixture exercises the real decoder end to end.
 *
 * Painted with 4×4 samples per pixel, keeping the majority colour and a hard alpha edge (GIF has
 * one-bit transparency), using only correctly rounded arithmetic, so the bytes and their hash match
 * on every engine.
 */

/** Wave poses: rotation of the arm about the shoulder, written out exactly (0°, −9°, −18°). */
const POSES = {
  up: [1, 0],
  mid: [.9876883405951378, -.15643446504023087],
  high: [.9510565162951535, -.3090169943749474],
} as const;
type Pose = keyof typeof POSES | 'rest';

/** The animation: pose, blink and delay in centiseconds. The last delay is zero on purpose. */
export const TOAD_WAVE_FRAMES: readonly { pose: Pose; blink: boolean; delayCs: number }[] = [
  { pose: 'rest', blink: false, delayCs: 48 },
  { pose: 'up', blink: false, delayCs: 9 },
  { pose: 'mid', blink: false, delayCs: 9 },
  { pose: 'high', blink: false, delayCs: 11 },
  { pose: 'mid', blink: true, delayCs: 12 },
  { pose: 'up', blink: false, delayCs: 9 },
  { pose: 'mid', blink: false, delayCs: 9 },
  { pose: 'high', blink: false, delayCs: 0 },
];

const SHOULDER = [78, 84] as const;
const rotate = (pose: keyof typeof POSES, x: number, y: number): [number, number] => {
  const [c, s] = POSES[pose], dx = x - SHOULDER[0], dy = y - SHOULDER[1];
  return [SHOULDER[0] + dx * c - dy * s, SHOULDER[1] + dx * s + dy * c];
};

function silhouette(pose: Pose): Layer[] {
  const body: Layer[] = [
    { sdf: leftBump, fill: GREEN, outline: 2.6 }, { sdf: rightBump, fill: GREEN, outline: 2.6 }, { sdf: head, fill: GREEN, outline: 2.6 },
  ];
  if (pose === 'rest') return body;
  const at = (x: number, y: number) => rotate(pose, x, y);
  const [ex, ey] = at(98, 46), [hx, hy] = at(99, 38), [f1x, f1y] = at(93, 28), [f2x, f2y] = at(100, 26), [f3x, f3y] = at(107, 31);
  return [
    { sdf: capsule(SHOULDER[0], SHOULDER[1], ex, ey, 6.5), fill: GREEN, outline: 2.6 },
    { sdf: union(circle(hx, hy, 8.5), circle(f1x, f1y, 3.6), circle(f2x, f2y, 3.8), circle(f3x, f3y, 3.4)), fill: GREEN, outline: 2.6 },
    ...body,
  ];
}

/** The open eye (sclera, pupil, highlight) closes into a happy arc for the blink. */
const OPEN_EYE = new Set([2, 3, 4]);
const BLINK: Layer = { sdf: arc(30, 47, 8, 3.4, (_x, y) => y < 46), fill: OUTLINE };

function sample(layers: { silhouette: Layer[]; details: Layer[] }, x: number, y: number): Rgb | null {
  let colour: Rgb | null = null;
  for (const layer of layers.silhouette) if (layer.sdf(x, y) < (layer.outline ?? 0)) colour = OUTLINE;
  for (const layer of layers.silhouette) if (layer.sdf(x, y) < 0) colour = layer.fill;
  for (const layer of layers.details) {
    const distance = layer.sdf(x, y);
    if (layer.outline && distance < layer.outline && distance >= 0 && colour) colour = OUTLINE;
    if (distance < 0) colour = layer.fill;
  }
  return colour;
}

/** Paints one pose into palette indices; index 0 is transparent. Colours join `palette` in first-seen order. */
function paintIndices(pose: Pose, blink: boolean, palette: Rgb[]): Uint8Array {
  const size = TOAD_WAVE_SIZE, grid = 4, out = new Uint8Array(size * size);
  const layers = { silhouette: silhouette(pose), details: blink ? [...DETAILS.filter((_, i) => !OPEN_EYE.has(i)), BLINK] : [...DETAILS] };
  const indexOf = (colour: Rgb): number => {
    let index = palette.findIndex(c => c[0] === colour[0] && c[1] === colour[1] && c[2] === colour[2]);
    if (index < 0) { palette.push(colour); index = palette.length - 1; }
    return index + 1;
  };
  const votes = new Map<number, number>();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    votes.clear();
    let hits = 0;
    for (let sy = 0; sy < grid; sy++) for (let sx = 0; sx < grid; sx++) {
      const colour = sample(layers, px + (sx + .5) / grid, py + (sy + .5) / grid);
      if (!colour) continue;
      hits++;
      const index = indexOf(colour);
      votes.set(index, (votes.get(index) ?? 0) + 1);
    }
    if (hits * 2 < grid * grid) continue;
    let best = 0, count = -1;
    for (const [index, n] of votes) if (n > count || (n === count && index < best)) { best = index; count = n; }
    out[px + py * size] = best;
  }
  return out;
}

let encoded: { bytes: Uint8Array; hash: string } | undefined;

/** The fixture's GIF bytes, built once per realm; callers get their own copy. */
export function toadWaveGifBytes(): Uint8Array {
  if (!encoded) {
    const palette: Rgb[] = [];
    const frames = TOAD_WAVE_FRAMES.map(frame => paintIndices(frame.pose, frame.blink, palette));
    const size = TOAD_WAVE_SIZE, base = frames[0]!, specs: GifFrameSpec[] = [];
    specs.push({ left: 0, top: 0, width: size, height: size, indices: base, delayCs: TOAD_WAVE_FRAMES[0]!.delayCs, disposal: 1, transparent: 0 });
    // Every later frame only adds to or recolours the resting toad, so it is a patch over the
    // changed rectangle, drawn with "unchanged" as transparent and restored afterwards (disposal 3).
    for (let f = 1; f < frames.length; f++) {
      const indices = frames[f]!;
      let minX = size, minY = size, maxX = -1, maxY = -1;
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] === base[i]) continue;
        if (!indices[i]) throw new Error('The animated fixture must only add to the resting pose.');
        const x = i % size, y = (i - x) / size;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const width = maxX - minX + 1, height = maxY - minY + 1, patch = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = minX + x + (minY + y) * size;
        patch[x + y * width] = indices[i] === base[i] ? 0 : indices[i]!;
      }
      specs.push({ left: minX, top: minY, width, height, indices: patch, delayCs: TOAD_WAVE_FRAMES[f]!.delayCs, disposal: 3, transparent: 0, interlaced: f === 3 });
    }
    const flat = new Uint8Array((palette.length + 1) * 3);
    palette.forEach((colour, i) => flat.set(colour, (i + 1) * 3));
    const bytes = encodeGif({ width: size, height: size, palette: flat, frames: specs });
    encoded = { bytes, hash: sha256Hex(bytes) };
  }
  return encoded.bytes.slice();
}

/** The fixture as a catalogue source: a real GIF rendition, hashed from its bytes. */
export function toadWaveAnimatedFixture(): { source: EmoteSource; bytes: Uint8Array } {
  const bytes = toadWaveGifBytes();
  return {
    source: {
      id: 'twitch.simulated-toadwave-animated', provider: 'twitch', providerId: 'simulated-toadwave-animated', kingdomId: SIMULATED_KINGDOM,
      name: 'toadWave', origin: 'simulated', sourceHash: encoded!.hash, rendition: 'gif',
    },
    bytes,
  };
}
