import type { Vec3 } from '@chatdom/shared';

/**
 * The stream's opening on a grand land: the whole island first, the way `/-/grand` frames it, with the town in
 * its valley, then one unbroken descent to the town's hero shot. The eye travels a quadratic curve that keeps its
 * height over the land and comes down over the town, so the ranges, the mere and the sea pass under it rather than
 * the camera diving straight through the air. The curve is lifted until it clears the land along its whole length.
 * Pure: the same shots and elapsed time give the same pose on every screen.
 */
export interface OpeningLens { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface OpeningPose extends OpeningLens { readonly done: boolean }

/** Seconds held on the island, then the descent. */
export const OPENING_HOLD = 6, OPENING_GLIDE = 14;
/** Metres the path keeps above the ground beneath it. */
const CLEARANCE = 24;

const smoother = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const curve = (a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 => mix(mix(a, c, t), mix(c, b, t), t);

const controls = new WeakMap<OpeningLens, Map<string, Vec3>>();

/** The curve's middle control: over the town at the island's height, raised until every point clears the land. */
export function openingControl(island: OpeningLens, hero: OpeningLens, height: (x: number, z: number) => number | null): Vec3 {
  const key = `${hero.eye.join(',')}`;
  const known = controls.get(island)?.get(key);
  if (known) return known;
  const control: [number, number, number] = [hero.eye[0] + (island.eye[0] - hero.eye[0]) * .35, Math.max(island.eye[1], hero.eye[1]) * .8 + Math.min(island.eye[1], hero.eye[1]) * .2,
    hero.eye[2] + (island.eye[2] - hero.eye[2]) * .35];
  for (let lift = 0; lift < 40; lift++) {
    let clear = true;
    for (let i = 1; i < 64 && clear; i++) {
      const p = curve(island.eye, control, hero.eye, i / 64), ground = height(p[0], p[2]);
      // The last stretch belongs to the hero's own validated eye.
      if (ground !== null && i < 58 && p[1] < ground + CLEARANCE) clear = false;
    }
    if (clear) break;
    control[1] += 20;
  }
  const map = controls.get(island) ?? new Map<string, Vec3>();
  map.set(key, control); controls.set(island, map);
  return control;
}

export function openingPose(island: OpeningLens, hero: OpeningLens, elapsed: number, height: (x: number, z: number) => number | null): OpeningPose {
  const t = smoother((elapsed - OPENING_HOLD) / OPENING_GLIDE);
  if (t <= 0) return { eye: [...island.eye], target: [...island.target], fov: island.fov, done: false };
  if (t >= 1) return { eye: [...hero.eye], target: [...hero.target], fov: hero.fov, done: true };
  const eye = curve(island.eye, openingControl(island, hero, height), hero.eye, t);
  // The gaze settles a little ahead of the eye, so the town is held in frame as the camera comes down to it.
  const look = smoother(Math.min(1, t * 1.25));
  return { eye, target: mix(island.target, hero.target, look), fov: island.fov + (hero.fov - island.fov) * t, done: false };
}
