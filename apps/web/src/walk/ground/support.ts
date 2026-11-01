import { WALK_BODY, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';

/**
 * What a body's feet rest on, for presentation only. `terrain`: nothing but the sampled terrain columns near the
 * soles, so the drawn terrain is the surface to draw the feet on. `solid`: a placement (a floor, a stair, a
 * foundation, a bridge deck, a bench) is under or around the feet; the drawn terrain below is not the floor.
 */
export type WalkerSupport = 'terrain' | 'solid';

export interface SupportOptions {
  /** Bottom of the compiled terrain columns (`sampleFoundedTerrain(plan).origin[1]`): how a terrain column is told apart. */
  readonly terrainFloorY: number;
  /**
   * Top of the compiled volume (`sampleFoundedTerrain(plan).ceilingY`). Unknown terrain cells compile as columns up to
   * it; they are barriers, never terrain. Default: 512 m above the floor (the founded volume).
   */
  readonly terrainCeilingY?: number;
  /** Placements whose top lies within this distance below the feet still count as the floor. Default: one step. */
  readonly reach?: number;
  /** Cached 4 m bins, oldest dropped first. */
  readonly bins?: number;
}

export interface SupportClassifier {
  readonly world: CollisionWorld;
  at(x: number, y: number, z: number): WalkerSupport;
  /**
   * The highest placement top at (x, z) that is not above `below`, or null: the stepped floor a sole lands on (a
   * tread, a deck, a foundation). Terrain columns are left out; the drawn terrain answers there.
   */
  topAt(x: number, z: number, below: number): number | null;
  /** Collision queries made so far (one per newly visited 4 m bin). */
  readonly queries: number;
}

const BIN = 4, CELL = .5, CELLS = BIN / CELL;

interface Bin {
  readonly solids: readonly SolidBox[];
  /** Each half-metre cell's solids, for point lookups. */
  readonly cells: readonly (readonly SolidBox[])[];
}

/**
 * Classify support from the exact collision revision the walker moves in. Each 4 m bin is queried once for its
 * non-terrain solids; afterwards a sample is a few box comparisons. Any doubt answers `solid`, which draws the body
 * at its physical height: the safe side, never a foot pushed into a floor.
 */
export function createSupportClassifier(world: CollisionWorld, options: SupportOptions): SupportClassifier {
  const reach = options.reach ?? WALK_BODY.stepHeight + .05, capacity = options.bins ?? 1024;
  const floor = options.terrainFloorY, ceiling = options.terrainCeilingY ?? floor + 512;
  if (!Number.isFinite(floor) || !(ceiling > floor) || !(reach >= 0) || !(capacity >= 1)) throw new Error('Support needs a finite terrain volume and a reach');
  const bins = new Map<string, Bin>();
  let queries = 0;
  const terrainColumn = (box: SolidBox) => box.min[1] <= floor + 1e-9 && box.max[1] < ceiling - 1e-9
    && Math.abs(box.max[0] - box.min[0] - .5) < 1e-9 && Math.abs(box.max[2] - box.min[2] - .5) < 1e-9;
  const bin = (bx: number, bz: number): Bin => {
    const key = `${bx},${bz}`, hit = bins.get(key);
    if (hit) { bins.delete(key); bins.set(key, hit); return hit; }
    queries++;
    const x0 = bx * BIN, z0 = bz * BIN;
    const found = world.query({ min: [x0, floor, z0], max: [x0 + BIN, ceiling, z0 + BIN] });
    const solids = found.filter(box => !terrainColumn(box));
    const cells: SolidBox[][] = Array.from({ length: CELLS * CELLS }, () => []);
    const cell = (v: number) => Math.min(CELLS - 1, Math.max(0, Math.floor(v / CELL)));
    for (const box of solids) {
      // Inclusive edges: a point on a box's face still finds it.
      for (let j = cell(box.min[2] - z0); j <= cell(box.max[2] - z0); j++) for (let i = cell(box.min[0] - x0); i <= cell(box.max[0] - x0); i++) cells[i + j * CELLS]!.push(box);
    }
    const made = { solids, cells };
    bins.set(key, made);
    while (bins.size > capacity) bins.delete(bins.keys().next().value!);
    return made;
  };
  return {
    world,
    get queries() { return queries; },
    at(x, y, z) {
      if (![x, y, z].every(Number.isFinite)) return 'solid';
      const r = WALK_BODY.radius, x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
      for (let bz = Math.floor(z0 / BIN); bz <= Math.floor(z1 / BIN); bz++) for (let bx = Math.floor(x0 / BIN); bx <= Math.floor(x1 / BIN); bx++) {
        for (const box of bin(bx, bz).solids) {
          // Strict overlap of the footprint, as the movement law has it: touching a wall is not standing on it.
          if (!(box.min[0] < x1 && box.max[0] > x0 && box.min[2] < z1 && box.max[2] > z0)) continue;
          if (box.max[1] >= y - reach && box.min[1] < y + WALK_BODY.height) return 'solid';
        }
      }
      return 'terrain';
    },
    topAt(x, z, below) {
      if (![x, z, below].every(Number.isFinite)) return null;
      const bx = Math.floor(x / BIN), bz = Math.floor(z / BIN);
      const i = Math.min(CELLS - 1, Math.floor((x - bx * BIN) / CELL)), j = Math.min(CELLS - 1, Math.floor((z - bz * BIN) / CELL));
      let top: number | null = null;
      for (const box of bin(bx, bz).cells[i + j * CELLS]!) {
        if (box.min[0] > x || box.max[0] < x || box.min[2] > z || box.max[2] < z) continue;
        const y = box.max[1];
        if (y <= below && (top === null || y > top)) top = y;
      }
      return top;
    },
  };
}
