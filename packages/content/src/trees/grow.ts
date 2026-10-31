import { MAT } from '../materials';
import { between, type Sculpt, type V3 } from './sculpt';

/** A unit direction from an azimuth (radians around +Y, 0 = +X) and an elevation above the horizon. */
export function heading(azimuth: number, elevation: number): V3 {
  const c = Math.cos(elevation);
  return [Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c];
}
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const normal = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export interface Bough {
  /** End point and the direction the wood was travelling when it got there. */
  end: V3; direction: V3;
  /** Every joint along the way, root first: where side shoots and clumps may sit. */
  joints: readonly V3[];
}

export interface BoughShape {
  segments: number;
  /** Per-segment pull toward the sky (positive) or the ground (negative), in direction units. */
  rise?: number;
  /** Per-segment seeded wander, in direction units: 0 is a straight pole, 0.3 an old gnarled limb. */
  wander?: number;
  /** Clamp so a drooping limb never digs into the ground. */
  floor?: number;
  /** 2 for heavy old wood drawn in whole 2-cell blocks. */
  grain?: 1 | 2;
}

/**
 * Draws a limb as a chain of tapered segments from `start` along `direction`. The bend comes from a seeded wander and
 * a steady rise or droop, so one seed always grows the same limb, and every segment shares its joint with the next:
 * the wood is one connected piece from trunk to tip.
 */
export function bough(s: Sculpt, r: () => number, start: V3, direction: V3, length: number, ra: number, rb: number, shape: BoughShape, material: number = MAT.bark): Bough {
  const { segments, rise = 0, wander = 0, floor = 2, grain = 1 } = shape;
  let at = start, d = normal(direction);
  const joints: V3[] = [start], step = length / segments;
  for (let i = 0; i < segments; i++) {
    d = normal([d[0] + between(r, -wander, wander), d[1] + rise + between(r, -wander, wander) * 0.5, d[2] + between(r, -wander, wander)]);
    let next = add(at, d, step);
    if (next[1] < floor) next = [next[0], floor, next[2]];
    s.limb(at, next, ra + (rb - ra) * (i / segments), ra + (rb - ra) * ((i + 1) / segments), material, grain);
    at = next; joints.push(at);
  }
  return { end: at, direction: d, joints };
}

/**
 * Buttress roots: short, flattened limbs that leave the trunk at ground level and dive under the turf. They make a
 * tree stand on the land rather than poke out of it, and keep the trunk's footprint broad at every detail level.
 */
export function roots(s: Sculpt, r: () => number, count: number, trunk: number, reach: number, material: number = MAT.bark, grain: 1 | 2 = 1): void {
  const turn = r() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2 + between(r, -0.35, 0.35), length = reach * between(r, 0.65, 1.1);
    const mid: V3 = [Math.cos(a) * length * 0.55, between(r, 1.6, 2.6), Math.sin(a) * length * 0.55];
    s.limb([Math.cos(a) * trunk * 0.4, trunk * 0.9, Math.sin(a) * trunk * 0.4], mid, trunk * 0.62, trunk * 0.42, material, grain);
    s.limb(mid, [Math.cos(a) * length, 0.4, Math.sin(a) * length], trunk * 0.42, trunk * 0.22, material, grain);
  }
}

/** A low-frequency 0..1 field over 6-cell patches: broad, deliberate material breaks instead of per-cell speckle. */
export function patch(seed: number, x: number, y: number, z: number, size = 6): number {
  let h = Math.imul(Math.floor(x / size) + 7919 * seed, 374761393) ^ Math.imul(Math.floor(y / size), 668265263) ^ Math.imul(Math.floor(z / size), 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paints the crown in light: foliage blocks open to the sky in the upper part of the crown take the sunlit tone, the
 * undersides keep the body tone, and the lowest, most sheltered blocks take the shade tone. Decisions are per 2-cell
 * block, so the breaks stay chunky at every detail level.
 */
export function shadeCrown(s: Sculpt, foliage: ReadonlySet<number>, tones: { lit: number; shade?: number }, crown: { base: number; top: number }, seed: number, litShare = 0.45): void {
  const litFrom = crown.base + (crown.top - crown.base) * (1 - litShare);
  for (let bz = 0; bz < s.d; bz += 2) for (let bx = 0; bx < s.w; bx += 2) {
    let covered = false;
    for (let by = s.h - 2; by >= 0; by -= 2) {
      const m = s.block(bx, by, bz);
      if (!m) continue;
      if (!foliage.has(m)) { covered = true; continue; }
      if (!covered && by >= litFrom && patch(seed, bx, by, bz, 8) > 0.12) tint(s, bx, by, bz, tones.lit, foliage);
      else if (covered && tones.shade !== undefined && by < crown.base + (crown.top - crown.base) * 0.3 && patch(seed + 1, bx, by, bz, 8) > 0.35) tint(s, bx, by, bz, tones.shade, foliage);
      covered = true;
    }
  }
}

/** Recolours the foliage cells of one 2-cell block; wood running through it keeps its bark. */
function tint(s: Sculpt, bx: number, by: number, bz: number, m: number, foliage: ReadonlySet<number>): void {
  for (let z = bz; z < bz + 2; z++) for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) if (foliage.has(s.get(x, y, z))) s.set(x, y, z, m);
}

/** Moss on the upper faces of old wood, in broad patches: the bark's own weather. */
export function mossWood(s: Sculpt, wood: number, moss: number, seed: number, from: number, share: number, size = 5): void {
  for (let z = 0; z < s.d; z++) for (let y = from; y < s.h - 1; y++) for (let x = 0; x < s.w; x++) {
    if (s.get(x, y, z) !== wood || s.get(x, y + 1, z)) continue;
    if (patch(seed, x, y, z, size) < share) s.set(x, y, z, moss);
  }
}
