import { MAT } from '../../../materials';
import { Grid, round } from './grid';

/**
 * A clinker hull described by three curves and a section, in the craft language of the lake's rowing boat
 * (`places/water/boats/hull.ts`) but parametric, so the harbour can build a six-and-a-half-metre coble and its
 * small rowing boats from one grammar. Local frame in build cells: length along +Z with the transom at z = 0 and
 * the stem at z = length − 1, the beam across X centred on beam / 2, y = 0 the underside of the keel amidships.
 *
 * - `keel(z)`: the keel's underside, level amidships and rockering up into the stem and the heel.
 * - `sheer(z)`: one above the highest planking; dips amidships and sweeps up to both ends.
 * - `plan(z)`: the fraction of full beam at each station; `fineness` draws the lower strakes in faster forward, so
 *   the bow flares over a fine forefoot.
 * - `section[row]`: half-breadth by row above the keel. Each step out is a lap, and the laps draw as shadow lines.
 * - `stern(y)`: the first station of the hull at row y; a raked transom leans aft as it rises.
 */
export interface HullForm {
  readonly length: number;
  readonly beam: number;
  readonly keel: (z: number) => number;
  readonly sheer: (z: number) => number;
  readonly plan: (z: number) => number;
  readonly section: readonly number[];
  readonly fineness?: (row: number, z: number) => number;
  readonly stern?: (y: number) => number;
  /** Extra section rows at station z: flat, full floors where a boat carries her bottom broad (a coble's run). */
  readonly fullness?: (z: number) => number;
}

/** The hull's occupancy classes, read from the curves. */
export interface HullShape {
  readonly form: HullForm;
  readonly halfBreadth: (y: number, z: number) => number;
  /** Inside the hull's outer skin. */
  readonly solid: (x: number, y: number, z: number) => boolean;
  /** Solid cells hidden from outside: inner halves of laps, the inwale, the stem's inner face. */
  readonly inner: (x: number, y: number, z: number) => boolean;
  /** Solid cells seen from outside: the painted skin. */
  readonly painted: (x: number, y: number, z: number) => boolean;
  /** The open boat: air never next to a painted cell, so every surface seen inside is bare wood. */
  readonly open: (x: number, y: number, z: number) => boolean;
}

/** |x − centre| measured so that an odd beam has one keel column and an even beam two. */
function across(form: HullForm, x: number): number {
  return Math.abs(x + 0.5 - form.beam / 2) - (form.beam % 2 === 0 ? 0.5 : 0);
}

export function hullShape(form: HullForm): HullShape {
  const L = form.length, top = form.section.length - 1;
  const stern = form.stern ?? (() => 0), fine = form.fineness ?? (() => 1), full = form.fullness ?? (() => 0);
  const halfBreadth = (y: number, z: number): number => {
    if (z < 0 || z >= L || z < stern(y) || y < form.keel(z) || y >= form.sheer(z)) return -1;
    const row = Math.min(y - form.keel(z) + full(z), top);
    return Math.max(0, round(form.section[row]! * Math.max(0, form.plan(z)) ** fine(row, z)));
  };
  const solid = (x: number, y: number, z: number) => {
    const h = halfBreadth(y, z);
    return h >= 0 && across(form, x) <= h;
  };
  // The section carried on up past the sheer: the open air over the boat.
  const within = (x: number, y: number, z: number) => {
    if (z < 0 || z >= L || y < form.keel(z)) return false;
    const h = halfBreadth(Math.min(y, form.sheer(z) - 1), z);
    return h >= 0 && across(form, x) <= h;
  };
  const sideways = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]] as const;
  const inner = (x: number, y: number, z: number) => solid(x, y, z) && sideways.every(([dx, dy, dz]) => within(x + dx, y + dy, z + dz));
  const painted = (x: number, y: number, z: number) => solid(x, y, z) && !inner(x, y, z);
  const hollow = (x: number, y: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!within(x + dx, y, z + dz) || !within(x + dx, y - 1, z + dz)) return false;
    }
    return true;
  };
  const around = [...sideways, [0, 1, 0]] as const;
  const open = (x: number, y: number, z: number) =>
    solid(x, y, z) && hollow(x, y, z) && around.every(([dx, dy, dz]) => !painted(x + dx, y + dy, z + dz));
  return { form, halfBreadth, solid, inner, painted, open };
}

export interface HullFit {
  /** Paint for a seen skin cell, by hull-local cell. */
  readonly skin: (x: number, y: number, z: number) => number;
  /** Bare wood inside, and the darker worn tone of the floorboards. */
  readonly plank: number;
  readonly floorboard: number;
  /** The floorboards' row: everything open at or below it is laid solid in floorboard. */
  readonly floor: number;
  /** The thwarts' row and their half-open stations. */
  readonly thwartRow: number;
  readonly thwarts: readonly (readonly [number, number])[];
}

/**
 * Lays the hull into the grid with its corner at (ox, oy, oz): the painted skin, bare wood inside (the inner half
 * of every lap and a lining wherever one plank would show paint), the floorboards and the thwarts let into the
 * lining at both ends.
 */
export function layHull(g: Grid, shape: HullShape, fit: HullFit, ox: number, oy: number, oz: number): void {
  const { form, solid, inner, open } = shape;
  let height = 0;
  for (let z = 0; z < form.length; z++) height = Math.max(height, form.sheer(z));
  for (let z = 0; z < form.length; z++) for (let y = 0; y < height; y++) for (let x = 0; x < form.beam; x++) {
    if (!solid(x, y, z)) continue;
    let m: number;
    if (open(x, y, z)) {
      if (y > fit.floor) continue;
      m = fit.floorboard;
    } else if (inner(x, y, z)) m = y === fit.floor ? fit.floorboard : fit.plank;
    else m = fit.skin(x, y, z);
    g.set(ox + x, oy + y, oz + z, m);
  }
  for (const [z0, z1] of fit.thwarts) for (let z = z0; z < z1; z++) {
    let laid = 0;
    for (let x = 0; x < form.beam; x++) if (open(x, fit.thwartRow, z)) { g.set(ox + x, oy + fit.thwartRow, oz + z, fit.plank); laid++; }
    if (!laid) throw new Error(`clinker hull: no room for a thwart at station ${z}.`);
  }
}

/** Boat tar: the darkest wood tone, so the wetted bottom reads as tarred planks rather than stone. */
export const TAR = MAT.bark;
