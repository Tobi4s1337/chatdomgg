/**
 * Seeded noise for the grand land: 2D simplex (Gustavson's formulation), fBm, ridged multifractal
 * (Musgrave) and integer hashes. Pure functions over a permutation built from one seed.
 */
import { hashString, mix32 } from './hash';
export { hashString, mix32 };

/** Hash of an integer cell, in [0, 1). */
export function hash2(x: number, z: number, seed: number): number {
  return mix32(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ seed) / 4294967296;
}
export function hash3(x: number, y: number, z: number, seed: number): number {
  return mix32(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x1b873593) ^ Math.imul(z | 0, 0x165667b1) ^ seed) / 4294967296;
}

/** A small seeded generator for sequential draws (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071]);
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

export interface Noise2 {
  /** Simplex noise in roughly [-1, 1]. */
  (x: number, z: number): number;
}

export function simplex2(seed: number): Noise2 {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const draw = rng(seed);
  for (let i = 255; i > 0; i--) { const j = Math.floor(draw() * (i + 1)); const t = p[i]!; p[i] = p[j]!; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const permMod = new Uint8Array(512);
  for (let i = 0; i < 512; i++) permMod[i] = (perm[i]! % 12) * 2;
  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = permMod[ii + perm[jj]!]!; t0 *= t0; n += t0 * t0 * (GRAD[g]! * x0 + GRAD[g + 1]! * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = permMod[ii + i1 + perm[jj + j1]!]!; t1 *= t1; n += t1 * t1 * (GRAD[g]! * x1 + GRAD[g + 1]! * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = permMod[ii + 1 + perm[jj + 1]!]!; t2 *= t2; n += t2 * t2 * (GRAD[g]! * x2 + GRAD[g + 1]! * y2); }
    return 70 * n;
  };
}

export function fbm(noise: Noise2, x: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 17.3, z * freq - o * 9.1);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal: sharp crests, each octave weighted by the last. Returns about 0..1. */
export function ridged(noise: Noise2, x: number, z: number, octaves: number, lacunarity = 2.0, gain = 0.5, offset = 1): number {
  let sum = 0, freq = 1, amp = 0.5, weight = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = offset - Math.abs(noise(x * freq + o * 31.7, z * freq + o * 11.3));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    freq *= lacunarity; amp *= gain;
  }
  return sum / norm;
}

/** Worley F1 distance and the cell's own hash: groves, plots and stacks. */
export function cellular(x: number, z: number, seed: number): { distance: number; id: number; second: number } {
  const xi = Math.floor(x), zi = Math.floor(z);
  let best = 9, second = 9, id = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cz = zi + dz;
    const px = cx + hash2(cx, cz, seed), pz = cz + hash2(cx, cz, seed ^ 0x9e3779b9);
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < best) { second = best; best = d; id = mix32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed); }
    else if (d < second) second = d;
  }
  return { distance: Math.sqrt(best), id, second: Math.sqrt(second) };
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
