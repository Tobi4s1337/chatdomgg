import type { VoxelBlueprint } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece } from '../piece';

/**
 * One segment of The_AGGman's harbour quay: a coursed stone platform whose top is flush with the graded quay and
 * whose seaward face stands down to the shingle and the sea bed the host sampled. Local frame in build cells: x
 * runs along the quay, +Z runs out to sea, y = 0 is the lowest sampled ground under the segment. Heights the host
 * supplies are absolute world cells (world metres / 0.125); `base` reports the absolute height of y = 0.
 *
 * The face is drawn in staggered courses of grey and pale stone with a dark wet foot, a weed line at the water,
 * timber fenders and iron mooring rings, all under an overhanging limestone coping. A stair can be cut down
 * through the platform to a landing (the pier deck), and a slip can ramp the top down into the water.
 */
export interface QuaySegmentSite {
  readonly id: string;
  /** Cells along the quay (≤ 256) and out to sea (≤ 128). */
  readonly length: number;
  readonly depth: number;
  /** Absolute cells of the quay's walking top. */
  readonly top: number;
  /** Absolute cells of the sea surface. */
  readonly water: number;
  /** Absolute cells of the ground or bed at local cell point (x, z). */
  ground(x: number, z: number): number;
  /** A stair cut seaward through x ∈ [from, to), descending to an absolute landing height. */
  readonly stair?: { readonly from: number; readonly to: number; readonly landing: number };
  /** A slip ramping from the top at z = 0 into the water through x ∈ [from, to). */
  readonly slip?: { readonly from: number; readonly to: number };
}

export interface QuaySegment extends AggmanPiece {
  /** Absolute world cells of the blueprint's y = 0. */
  readonly base: number;
}

const COLUMN = 4, COPE = 2, COURSE = 3;
const hash = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

export function createQuaySegment(site: QuaySegmentSite): QuaySegment {
  const { length: L, depth: D, top, water } = site;
  if (!Number.isInteger(L) || !Number.isInteger(D) || L < 8 || L > 256 || D < 8 || D > 124) throw new Error('A quay segment is 8–256 cells long and 8–124 deep.');
  if (!Number.isInteger(top) || !Number.isInteger(water) || top <= water + 4) throw new Error('A quay top stands at least five cells over the water.');
  // Sample each column's lowest corner: no face may float over a dip.
  const columns: { x: number; z: number; bottom: number }[] = [];
  for (let x = 0; x < L; x += COLUMN) for (let z = 0; z < D + COPE; z += COLUMN) {
    const X = Math.min(L, x + COLUMN), Z = Math.min(D + COPE, z + COLUMN);
    const low = Math.min(site.ground(x, z), site.ground(X, z), site.ground(x, Z), site.ground(X, Z));
    columns.push({ x, z, bottom: Math.floor(low) - 1 });
  }
  const base = Math.min(...columns.map(c => c.bottom));
  const H = top - base;
  if (H > 256) throw new Error('The quay face would stand deeper than one blueprint.');
  const y = (absolute: number) => absolute - base;
  const b = new Boxes();
  const wet = y(water) + 1;
  // The body: columns down to their own ground, dark and wet below the waterline, grey above.
  // The face plane (z = D - 1) is laid in separate blocks below, so the body stops one cell short of it and every
  // joint between blocks opens onto a recessed, shadowed seam.
  for (const c of columns) {
    if (c.z >= D) continue;
    const X = Math.min(L, c.x + COLUMN), Z = Math.min(D - 1, c.z + COLUMN), from = y(c.bottom);
    if (Z <= c.z) continue;
    if (from < wet) b.add(c.x, from, c.z, X, wet, Z, MAT.darkStone);
    b.add(c.x, Math.max(from, wet), c.z, X, y(top) - 1, Z, MAT.darkStone);
    // Worn setts on the walking top, mostly warm paving with grey and pale stones among them.
    const sett = hash(c.x, c.z, 13);
    b.add(c.x, y(top) - 1, c.z, X, y(top), Z, sett < .62 ? MAT.paving : sett < .86 ? MAT.stone : MAT.limestone);
  }
  // Seaward face: staggered courses, pale and grey, a dark foot and the weed line.
  for (let row = 0, course = y(top) - COPE - COURSE; course > -COURSE; row++, course -= COURSE) {
    const y0 = Math.max(0, course), y1 = course + COURSE;
    for (let x = -(row % 2) * 4; x < L;) {
      const long = 6 + Math.floor(hash(x, row, 7) * 4), X = Math.min(L, x + long), x0 = Math.max(0, x);
      const tone = hash(x, row, 3), low = y1 <= wet + 1;
      const material = low ? (tone < .75 ? MAT.darkStone : MAT.stone) : tone < .45 ? MAT.stone : tone < .7 ? MAT.limestone : tone < .9 ? MAT.darkStone : MAT.brick;
      // Each block leaves a recessed joint above and beside it; some stand a cell proud so the face catches light unevenly.
      b.add(x0, y0, D - 1, X - 1, y1 - 1, D, material);
      if (hash(x, row, 11) < .3 && X - x0 > 3) b.add(x0 + 1, y0, D, X - 2, y1 - 1, D + 1, material);
      x = X;
    }
  }
  for (let x = 0; x < L; x += 5) b.add(x, Math.max(0, wet - 1), D - 1, Math.min(L, x + 3 + Math.floor(hash(x, 1, 9) * 3)), wet + (hash(x, 2, 9) < .5 ? 1 : 0), D, MAT.moss);
  // Overhanging coping, its joints cut every metre or so.
  for (let x = 0; x < L; x += 8 + Math.floor(hash(x, 0, 5) * 3)) {
    b.add(x, y(top) - COPE, D - 1, Math.min(L, x + 8 + Math.floor(hash(x, 0, 5) * 3)) - 1, y(top), D + 1, MAT.limestone);
  }
  // Timber fenders and iron rings on the face.
  for (let x = 10; x + 2 < L; x += 28) {
    b.add(x, Math.max(0, wet - 6), D, x + 2, y(top) - COPE - 1, D + 1, MAT.timber);
    b.add(x, y(top) - COPE - 4, D, x + 2, y(top) - COPE - 3, D + 1, MAT.darkStone);
    const ring = x + 13;
    if (ring + 3 < L) {
      b.add(ring, y(top) - COPE - 5, D, ring + 3, y(top) - COPE - 2, D + 1, MAT.hairBlack);
      b.add(ring + 1, y(top) - COPE - 4, D, ring + 2, y(top) - COPE - 3, D + 1, MAT.air);
    }
  }
  if (site.stair) {
    const { from, to, landing } = site.stair;
    if (from < 2 || to > L - 2 || to - from < 8) throw new Error('A quay stair needs 8 cells and its own side walls.');
    const rises = top - landing, tread = Math.max(3, Math.floor((D + COPE) / Math.max(1, rises)));
    b.add(from, y(landing), 0, to, y(top) + 1, D + COPE, MAT.air);
    for (let step = 0; step < rises; step++) {
      const z0 = step * tread, z1 = Math.min(D + COPE, z0 + tread), height = y(top) - step - 1;
      if (z0 >= D + COPE || height <= y(landing)) break;
      b.add(from, y(landing), z0, to, height, z1, MAT.stone);
      b.add(from, height - 1, z0, to, height, z0 + 1, MAT.limestone);
    }
    // An iron handrail on the open side.
    const tread0 = tread, rail = (z: number) => Math.max(y(landing), y(top) - Math.floor(z / tread0) - 1);
    for (let z = 2; z < D; z += 10) b.add(to - 1, rail(z), z, to, rail(z) + 7, z + 1, MAT.hairBlack);
    for (let z = 2; z < D - 10; z += 10) b.add(to - 1, Math.min(rail(z), rail(z + 10)) + 6, z, to, Math.max(rail(z), rail(z + 10)) + 7, z + 11, MAT.hairBlack);
  }
  if (site.slip) {
    const { from, to } = site.slip;
    for (let z = 0; z < D + COPE; z++) {
      const surface = Math.round(y(top) - (y(top) - (wet - 4)) * (z / (D + COPE)));
      b.add(from, surface, z, to, y(top) + 1, z + 1, MAT.air);
      b.add(from + 2, surface - 1, z, to - 2, surface, z + 1, z % 3 === 0 ? MAT.timber : MAT.paving);
    }
  }
  // Mesh caching keys on blueprint id, so the id names the sampled foundation shape too.
  let shape = 2166136261;
  for (const c of columns) shape = Math.imul(shape ^ (c.bottom * 311 + c.x * 17 + c.z), 16777619);
  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-aggman-quay-${site.id}-${(shape >>> 0).toString(36)}`, styleId: STYLES.tide.id, kind: 'civic', lattice: 'build',
    size: [L, H + 8, D + COPE], windows: [], boxes: b.list.filter(box => box.to[1] > 0).map(box => ({ ...box, from: [box.from[0], Math.max(0, box.from[1]), box.from[2]] as [number, number, number] })),
  };
  return { blueprint, lanterns: [], footprint: { from: [0, 0], to: [L, D] }, base };
}
