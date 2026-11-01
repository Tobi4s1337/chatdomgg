import { MAT, STYLES, type StyleKey } from '../../materials';
import { Shape, seeded } from '../shape';
import type { PlacePiece } from '../types';

export type CourtHalf = 'west' | 'east';

/** The founded court is 40 × 24 m: each half is 20 m across (160 cells) and the full depth (192 cells). */
export const COURT_FLOOR_SIZE = { width: 160, depth: 192 } as const;
/** The floor is two cells thick: a mortar bed and the flags. It is laid one cell into the ground. */
export const COURT_FLOOR_HEIGHT = 2;
/**
 * Lateral plan from the court's axis, in cells (u = 0 is the axis). The processional way runs from the gate to
 * the keep stair as broad worn slabs whose first stone in each course spans the axis, then a joint and the field.
 */
export const COURT_WAY = { slabs: [0, 19], field: 20 } as const;

/**
 * One half of the court's flagstone floor. Local +Z runs from the keep (z = 0) to the gate (z = depth); the
 * axis is the half's inner edge (x = 0 for the east half, x = width for the west half). Coursed flags of the
 * castle's own stone stand a cell proud of an earth-and-moss bed, so every joint is a real shaded recess. The
 * way is broad and worn pale, the field mixed, patched and cracked, and moss gathers where the front curtain
 * shades the joints and the court frays out at its sides. Both halves share their courses and the stone that
 * spans the axis, so the way reads as one surface.
 */
export function createCourtFloor(half: CourtHalf, style: StyleKey, size: { width: number; depth: number } = COURT_FLOOR_SIZE): PlacePiece {
  const { width: W, depth: D } = size;
  if (!Number.isInteger(W) || !Number.isInteger(D) || W < 40 || D < 40 || W > 256 || D > 256) {
    throw new Error(`A court floor half must be 40–256 whole cells each way, not ${W}×${D}.`);
  }
  const kit = STYLES[style];
  const shape = new Shape();
  // u is measured from the axis outward; x mirrors so the west half's axis is its +X edge.
  const lay = (u0: number, u1: number, y: number, Y: number, z: number, Z: number, material: number) => {
    const a = Math.max(0, u0), b = Math.min(W, u1);
    if (a >= b) return;
    if (half === 'east') shape.box(a, y, z, b, Y, Z, material);
    else shape.box(W - b, y, z, W - a, Y, Z, material);
  };

  // The bed: warm earth in the joints, moss where the front curtain's shade sits and along the frayed sides.
  lay(0, W, 0, 1, 0, D, MAT.earth);
  lay(0, W, 0, 1, D - 44, D, MAT.moss);
  lay(W - 18, W, 0, 1, 0, D, MAT.moss);
  const bed = seeded(`court-floor-bed:${half}`);
  for (let i = 0; i < 9; i++) {
    const u = COURT_WAY.field + Math.floor(bed() * (W - COURT_WAY.field - 24)), z = Math.floor(bed() * (D - 50));
    lay(u, u + 8 + Math.floor(bed() * 10), 0, 1, z, z + 6 + Math.floor(bed() * 10), MAT.moss);
  }

  // Courses are shared by both halves so their joints line up across the axis.
  const courses: [number, number][] = [];
  const course = seeded('court-floor-courses');
  for (let z = 0; z < D;) {
    const depth = Math.min(6 + Math.floor(course() * 4), D - z - 1);
    if (depth < 3) break;
    courses.push([z, z + depth]);
    z += depth + 1;
  }

  const rand = seeded(`court-floor:${half}:${style}`);
  const fieldStone = () => {
    const r = rand();
    return r < .44 ? kit.stone : r < .78 ? MAT.cream : r < .93 ? kit.wall : MAT.darkStone;
  };
  for (const [ci, [z0, z1]] of courses.entries()) {
    // Worn slabs, mostly pale. The first stone of every course is chosen by the shared course seed, so it spans
    // the axis as one broad slab across both halves; a few older stones survive in the wear.
    const shared = seeded(`court-floor-way:${ci}`);
    const first = 7 + Math.floor(shared() * 9), firstStone = shared() < .82 ? MAT.cream : kit.wall;
    lay(0, first, 1, 2, z0, z1, firstStone);
    let u = first + 1;
    while (u < COURT_WAY.slabs[1]) {
      const length = Math.min(COURT_WAY.slabs[1] - u, 6 + Math.floor(rand() * 9));
      const end = COURT_WAY.slabs[1] - (u + length) < 4 ? COURT_WAY.slabs[1] : u + length;
      lay(u, end, 1, 2, z0, z1, rand() < .75 ? MAT.cream : kit.wall);
      u = end + 1;
    }
    // The field: staggered flags, some cracked, a few patched; the outer margin breaks up into the bed.
    u = COURT_WAY.field + (ci % 2 ? 0 : 3);
    if (u > COURT_WAY.field) lay(COURT_WAY.field, u - 1, 1, 2, z0, z1, fieldStone());
    while (u < W) {
      const length = Math.min(W - u, 6 + Math.floor(rand() * 8));
      const margin = W - u;
      const fray = margin < 22 ? (22 - margin) / 22 : 0;
      const shaded = z1 > D - 44;
      if (rand() < fray * .75) {
        // A lost flag at the frayed margin: the bed shows, mossed over.
        lay(u, u + length, 0, 1, z0, z1, MAT.moss);
      } else if (rand() < .09 && length >= 8 && z1 - z0 >= 6) {
        // A cracked flag: the crack jogs halfway across, so it reads as one broken stone, not two.
        const m = u + Math.floor(length / 2), zm = z0 + Math.floor((z1 - z0) / 2);
        const stone = fieldStone();
        lay(u, m, 1, 2, z0, z1, stone);
        lay(m + 1, u + length, 1, 2, z0, z1, stone);
        lay(m, m + 1, 1, 2, z0, zm, stone);
      } else {
        lay(u, u + length, 1, 2, z0, z1, fieldStone());
        // Moss creeps over the corner of a shaded or outer flag.
        if ((shaded || fray > .3) && rand() < .45) lay(u, u + 2 + Math.floor(rand() * 2), 1, 2, z1 - 2, z1, MAT.moss);
      }
      u += length + 1;
    }
  }

  return {
    blueprint: { version: 1, id: `court-floor-${half}-${style}-${W}x${D}`, styleId: kit.id, kind: 'civic', lattice: 'build',
      size: [W, COURT_FLOOR_HEIGHT, D], boxes: shape.list, windows: [] },
    footings: [{ id: 'bed', box: { from: [0, 0, 0], to: [W, 1, D] } }],
    walks: [{ id: 'flags', box: { from: [0, 1, 0], to: [W, 2, D] }, top: 2 }],
    seats: [], interactions: [], texts: [],
  };
}
