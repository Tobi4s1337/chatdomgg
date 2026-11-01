import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import { Boxes, hash } from '../../../genesis-landmarks/kit';
import { RIVER_HALL } from '../../../genesis-landmarks/river-hall/hall';
import { cresset, roses } from '../landing/index';

/**
 * The river hall's abutments where they meet PinkKittyRose's land. The river runs on its own levee and the hall's
 * banks stand at the hall's drawn bank line, a couple of metres above the crest, so on the far side the closed
 * pavilion would stand on a sheer pale block over a meadow falling three metres away, and on the town side the
 * abutment's flanks would show the same blank stone either side of the landing.
 *
 * This is the masons' answer: a battered revetment wrapped round each abutment, its courses stepping out a cell
 * every three as they go down, a stepped stone apron that meets the falling ground well out from the wall rather
 * than standing over it, under a cream band at the bank line. At the far end the hall's paved top becomes a balcony over
 * the far meadow: a parapet with a darkStone coping and roses along it, and a pier at each corner carrying an iron
 * fire basket, so the far end of the hall is lit from the far bank as the landing lights the town side.
 *
 * Frame: the hall's own (see `RIVER_HALL`), in build cells: X across the hall, Z along the span from the far bank
 * (z = 0) to the town bank (z = 256), y = 0 the river bed. Every piece is solid masonry founded a metre under the
 * ground it stands on; the host passes that ground in the same frame and places the blueprint at `offset` with the
 * hall's own placement.
 */

export type AbutmentEnd = 'far' | 'near';

export interface AbutmentRevetmentOptions {
  readonly end: AbutmentEnd;
  /** The displayed ground under a point of the hall's frame, in cells above the bed (may be negative). */
  readonly ground: (x: number, z: number) => number;
}

export interface AbutmentRevetment {
  readonly blueprint: VoxelBlueprint;
  readonly size: Vec3;
  /** The piece's origin in the hall's frame, cells. */
  readonly offset: Vec3;
  /** Flame bases of the corner fire baskets, in the hall's frame, cells. */
  readonly fires: readonly Vec3[];
  /** The ground the piece covers, in the hall's frame (cells): [x0, z0, x1, z1]. */
  readonly footprint: readonly [number, number, number, number];
}

const P = RIVER_HALL.pavilions;
export const ABUTMENT_REVETMENT = {
  /** The abutment block each revetment wraps, [x0, x1) across and [z0, z1) along the span. */
  far: { x: [P.x[0], P.x[1]] as const, z: [0, RIVER_HALL.deck.z[0]] as const },
  near: { x: [P.x[0], P.x[1]] as const, z: [RIVER_HALL.deck.z[1], 256] as const },
  /** Top of the revetment: the bank line, with a cream band in its top two cells. */
  top: RIVER_HALL.bank,
  band: 2,
  /** Each ring outward steps down one course: a stepped apron at about 1 in 3. */
  course: 3,
  /** The masonry goes this far under the ground. */
  found: 8,
  rings: 32,
  /**
   * The far end's approach bank: turf, its top this far under the bank line at the wall, falling a
   * cell per cell outward, and tapering off toward the river along the flanks from `taper`. It takes the apron's lower
   * courses, so the far end meets its meadow on a green bank rather than following the ground down into the hollow at
   * the levee's foot.
   */
  bank: { below: 12, rings: 56, taper: 36 },
  parapet: { thick: 2, high: 4 },
  pier: 8,
} as const;
const R = ABUTMENT_REVETMENT;

/** The top of the batter on ring `o` (1 is the ring touching the abutment): the band rings, then a course per ring. */
export const batterTop = (o: number): number => (o <= R.band ? R.top : R.top - R.course * (o - R.band));

interface Run { readonly ring: number; readonly axis: 'x' | 'z'; readonly fixed: number; readonly from: number; readonly to: number; readonly out: readonly [number, number] }

/** The rings of an end: runs of columns one cell outward at a time, with the outward direction of each face. */
function rings(end: AbutmentEnd, count: number = R.rings): Run[] {
  const block = R[end], runs: Run[] = [];
  for (let o = 1; o <= count; o++) {
    const x0 = block.x[0] - o, x1 = block.x[1] - 1 + o;
    if (end === 'far') {
      runs.push({ ring: o, axis: 'x', fixed: -o, from: x0, to: x1 + 1, out: [0, -1] });
      runs.push({ ring: o, axis: 'z', fixed: x0, from: -o + 1, to: block.z[1], out: [-1, 0] });
      runs.push({ ring: o, axis: 'z', fixed: x1, from: -o + 1, to: block.z[1], out: [1, 0] });
    } else {
      runs.push({ ring: o, axis: 'z', fixed: x0, from: block.z[0], to: block.z[1], out: [-1, 0] });
      runs.push({ ring: o, axis: 'z', fixed: x1, from: block.z[0], to: block.z[1], out: [1, 0] });
    }
  }
  return runs;
}

/** The top of the far approach bank on ring `o`, at `along` (z on a flank, or undefined on the far face). */
export const bankTop = (o: number, along?: number): number =>
  R.top - R.bank.below - (o - 1) - (along === undefined ? 0 : Math.max(0, along - R.bank.taper));

/** Coordinates of a run's cell `u`, as (x, z). */
const cell = (run: Run, u: number): [number, number] => (run.axis === 'x' ? [u, run.fixed] : [run.fixed, u]);

export function createAbutmentRevetment(options: AbutmentRevetmentOptions): AbutmentRevetment {
  const { end, ground } = options;
  if (end !== 'far' && end !== 'near') throw new Error('end must be "far" or "near".');
  // The ground under each four-cell block, at its lowest corner: the masonry's foot is founded under that.
  const blocks = new Map<string, number>();
  const groundAt = (x: number, z: number): number => {
    const bx = Math.floor(x / 4) * 4, bz = Math.floor(z / 4) * 4, key = `${bx},${bz}`;
    let g = blocks.get(key);
    if (g === undefined) {
      g = Math.min(ground(bx, bz), ground(bx + 4, bz), ground(bx, bz + 4), ground(bx + 4, bz + 4));
      if (!Number.isFinite(g)) throw new Error(`The ground under (${bx}, ${bz}) is not a number.`);
      blocks.set(key, g);
    }
    return g;
  };

  type Col = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; m: number };
  const cols: Col[] = [];
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => {
    if (x0 < x1 && y0 < y1 && z0 < z1) cols.push({ x0, z0, x1, z1, y0, y1, m });
  };
  const fires: Vec3[] = [];

  // The batter: every ring's run, cut into four-cell segments that share a founded foot; a column stands only where
  // its course is above the ground.
  const faces = rings(end);
  for (const run of faces) {
    const top = batterTop(run.ring);
    for (let u = run.from; u < run.to;) {
      const next = Math.min(run.to, (Math.floor(u / 4) + 1) * 4);
      const [x, z] = cell(run, u), g = groundAt(x, z);
      if (top > g) {
        const foot = Math.floor(g) - R.found;
        if (run.axis === 'x') add(u, foot, run.fixed, next, top, run.fixed + 1, MAT.limestone);
        else add(run.fixed, foot, u, run.fixed + 1, top, next, MAT.limestone);
      }
      u = next;
    }
  }

  // The face of each course: two rows of stones four to eight cells long, mostly limestone, the odd grey or cream
  // one, perpends staggered row to row; and the cream band at the bank line on the outer band ring.
  const along = (run: Run, a: number, b: number, y0: number, y1: number, m: number) => {
    for (let s = a; s < b;) {
      const next = Math.min(b, (Math.floor(s / 4) + 1) * 4), [x, z] = cell(run, s);
      if (y1 > groundAt(x, z)) {
        if (run.axis === 'x') add(s, y0, run.fixed, next, y1, run.fixed + 1, m);
        else add(run.fixed, y0, s, run.fixed + 1, y1, next, m);
      }
      s = next;
    }
  };
  for (const run of faces) {
    if (run.ring < R.band) continue;
    const top = run.ring === R.band ? R.top - R.band : batterTop(run.ring), below = batterTop(run.ring + 1);
    if (run.ring === R.band) along(run, run.from, run.to, R.top - R.band, R.top, MAT.cream);
    for (let y = below; y < top; y += R.course) {
      const y1 = Math.min(top, y + R.course);
      for (let u = run.from - Math.floor(hash(run.ring, y, run.fixed, 31) * 6); u < run.to;) {
        const length = 4 + Math.floor(hash(u, y, run.fixed, 32) * 5), pick = hash(u, y, run.fixed, 33);
        const m = pick < 0.7 ? MAT.limestone : pick < 0.88 ? MAT.stone : MAT.cream;
        if (m !== MAT.limestone) along(run, Math.max(run.from, u), Math.min(run.to, u + length), y, y1, m);
        u += length;
      }
    }
  }

  // The far end's approach bank, over the apron's lower courses: turf in quarter-metre steps, each a cell down from
  // its neighbour nearer the wall, with the odd tussock a cell proud so the bank reads as earth, not a stair.
  if (end === 'far') {
    const block = R[end], reach = R.bank.rings, S = 2;
    for (let bx = block.x[0] - reach; bx < block.x[1] + reach; bx += S) {
      for (let bz = -reach; bz < block.z[1]; bz += S) {
        // Rings to the block's nearest cell: outside the abutment across X, or beyond its far face.
        const dx = bx + S <= block.x[0] ? block.x[0] - (bx + S - 1) : bx >= block.x[1] ? bx - block.x[1] + 1 : 0;
        const dz = bz + S <= 0 ? -(bz + S - 1) : 0, o = Math.max(dx, dz);
        if (o < 1) continue;
        const tussock = o > 2 && hash(bx, bz, o, 71) < 0.12 ? 1 : 0;
        const top = bankTop(o, dx >= dz && bz >= 0 ? bz : undefined) + tussock, g = groundAt(bx, bz);
        if (top > g) add(bx, Math.floor(g) - 2, bz, bx + S, top, bz + S, MAT.grass);
      }
    }
  }

  // The far end's balcony: a parapet on the band rings along the far face with a coping a cell proud, roses on it,
  // and a pier at each corner carrying a fire basket.
  if (end === 'far') {
    const block = R[end], { thick, high } = R.parapet, x0 = block.x[0] - R.pier, x1 = block.x[1] + R.pier;
    add(x0, R.top, -thick, x1, R.top + high, 0, MAT.limestone);
    add(x0, R.top + high, -thick - 1, x1, R.top + high + 1, 0, MAT.darkStone);
    roses(new ColBoxes(add), block.x[0] + 2, block.x[1] - 2, -thick, 0, R.top + high + 1, 4363967);
    for (const px of [block.x[0] - R.pier, block.x[1]]) {
      const pz = -R.pier, cx = px + R.pier / 2, cz = pz + R.pier / 2;
      let g = Infinity;
      for (let x = px; x <= px + R.pier; x += 4) for (let z = pz; z <= 0; z += 4) g = Math.min(g, groundAt(x, z));
      const foot = Math.floor(g) - R.found, capTop = R.top + high + 6;
      add(px - 1, foot, pz - 1, px + R.pier + 1, Math.max(foot + R.found + 2, Math.floor(g) + 2), pz + R.pier + 1, MAT.stone);
      add(px, foot, pz, px + R.pier, capTop - 2, pz + R.pier, MAT.limestone);
      // Quoins: a cream stone at every corner on alternate three-cell courses.
      for (let y = Math.floor(g) + 2, k = 0; y + 3 <= capTop - 3; y += 3, k++) {
        if (k % 2) continue;
        for (const qx of [px, px + R.pier - 2]) for (const qz of [pz, pz + R.pier - 2]) add(qx, y, qz, qx + 2, y + 3, qz + 2, MAT.cream);
      }
      add(px - 1, capTop - 3, pz - 1, px + R.pier + 1, capTop - 2, pz + R.pier + 1, MAT.darkStone);
      add(px, capTop - 2, pz, px + R.pier, capTop - 1, pz + R.pier, MAT.limestone);
      add(px + 1, capTop - 1, pz + 1, px + R.pier - 1, capTop, pz + R.pier - 1, MAT.cream);
      fires.push(cresset(new ColBoxes(add), cx, capTop, cz));
    }
  }

  if (!cols.length) throw new Error(`The ${end} abutment stands on its ground everywhere; it needs no revetment.`);
  const min = [Math.min(...cols.map(c => c.x0)), Math.min(...cols.map(c => c.y0)), Math.min(...cols.map(c => c.z0))] as const;
  const max = [Math.max(...cols.map(c => c.x1)), Math.max(...cols.map(c => c.y1)) + 1, Math.max(...cols.map(c => c.z1))] as const;
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const boxes = cols.map(c => ({ from: [c.x0 - min[0], c.y0 - min[1], c.z0 - min[2]] as [number, number, number], to: [c.x1 - min[0], c.y1 - min[1], c.z1 - min[2]] as [number, number, number], material: c.m }));
  let h = 2166136261;
  for (const box of boxes) h = Math.imul(h ^ (box.from[0] * 7 + box.from[1] * 131 + box.from[2] * 8191 + box.to[1] * 31 + box.material), 16777619);
  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-pinkkitty-abutment-${end}-${(h >>> 0).toString(16)}`, styleId: StyleIdSchema.parse(STYLES.hearth.id), kind: 'civic',
    lattice: 'build', size, boxes, windows: [],
  };
  const footprint = [min[0], min[2], max[0], max[2]] as const;
  return { blueprint, size, offset: [min[0], min[1], min[2]], fires, footprint };
}

/** Boxes that feed the revetment's own column list, so shared helpers draw straight into the piece's frame. */
class ColBoxes extends Boxes {
  constructor(private readonly sink: (x: number, y: number, z: number, X: number, Y: number, Z: number, m: number) => void) { super(); }
  override add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void { this.sink(x, y, z, X, Y, Z, material); }
}
