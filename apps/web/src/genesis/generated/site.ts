import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan, type XZ } from '@chatdom/world';
import { sampleGenesisSurface, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { RoyalBrazier } from '../../kingdom/royal-life';
import type { Dressing } from '../../kingdom/settlement-content';

export const CELL = VOXEL_METRES.build;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** A footprint in world metres: centre, half extents along its own x and z, and its quarter turn. */
export interface Footprint { readonly centre: XZ; readonly half: readonly [number, number]; readonly turn: CardinalTurn }

const rectOf = (f: Footprint): Rect => {
  const [hx, hz] = f.turn % 2 ? [f.half[1], f.half[0]] : f.half;
  return { minX: f.centre[0] - hx, maxX: f.centre[0] + hx, minZ: f.centre[1] - hz, maxZ: f.centre[1] + hz };
};
const overlaps = (a: Rect, b: Rect, margin = 0) => a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;
const distanceToRect = (r: Rect, x: number, z: number) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

/**
 * What already stands on the proposed land: every home lot, every street's clear corridor, the castle and the market,
 * plus whatever this composition has placed. A site is accepted only on dry, gentle, unclaimed ground.
 */
export class Ground {
  private readonly claimed: Rect[] = [];
  private readonly roads: { x: number; z: number; r: number }[] = [];

  constructor(readonly plan: SettlementPlan, readonly landscape: DeepReadonly<GenesisLandscape>) {
    for (const home of plan.homes) this.claimed.push({ minX: home.lot.minX, maxX: home.lot.maxX, minZ: home.lot.minZ, maxZ: home.lot.maxZ });
    this.claimed.push({ ...plan.castle.bounds });
    for (const street of plan.streets) {
      const r = street.width / 2 + (street.kind === 'approach' ? .5 : 1.5);
      for (let i = 0; i < street.points.length; i++) {
        const p = street.points[i]!;
        this.roads.push({ x: p[0], z: p[2], r });
        // Approaches are short two-point runs: sample between their ends too.
        const q = street.points[i + 1];
        if (q) for (let t = 1; t < 4; t++) this.roads.push({ x: p[0] + (q[0] - p[0]) * t / 4, z: p[2] + (q[2] - p[2]) * t / 4, r });
      }
    }
  }

  height(x: number, z: number): number { return terrainHeight(this.plan, x, z); }

  /** Dry ground with its banks: water, a shore within `margin` metres, or the sea all refuse. */
  dry(x: number, z: number, margin = 2): boolean {
    const s = sampleGenesisSurface(this.landscape, x, z);
    return !(s.waterLevel !== null && s.ground <= s.waterLevel + .4) && s.shoreDistance > margin;
  }

  /** The lowest and highest ground under a footprint, sampled on a two-metre grid including its edges. */
  span(f: Footprint): { low: number; high: number } {
    const r = rectOf(f);
    let low = Infinity, high = -Infinity;
    for (let x = r.minX; x <= r.maxX + 1e-6; x += Math.max(.5, (r.maxX - r.minX) / Math.ceil((r.maxX - r.minX) / 2))) {
      for (let z = r.minZ; z <= r.maxZ + 1e-6; z += Math.max(.5, (r.maxZ - r.minZ) / Math.ceil((r.maxZ - r.minZ) / 2))) {
        const h = this.height(x, z);
        low = Math.min(low, h); high = Math.max(high, h);
      }
    }
    return { low, high };
  }

  /** Whether a footprint is free: no lot, castle, street corridor, earlier piece or water under it, and slope within `rise`. */
  free(f: Footprint, options: { rise?: number; margin?: number; roads?: boolean } = {}): boolean {
    const r = rectOf(f), margin = options.margin ?? 1;
    if (this.claimed.some(c => overlaps(r, c, margin))) return false;
    if (options.roads !== false && this.roads.some(road => distanceToRect(r, road.x, road.z) < road.r)) return false;
    for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ], [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]] as const) {
      if (!this.dry(x, z)) return false;
    }
    const { low, high } = this.span(f);
    return high - low <= (options.rise ?? 2.5);
  }

  claim(f: Footprint): void { this.claimed.push(rectOf(f)); }

  /**
   * The first free footprint on rings around `near`, nearest first, each candidate turned so its front faces `face`.
   * Deterministic and bounded.
   */
  find(near: XZ, half: readonly [number, number], face: XZ, options: { from?: number; to?: number; rise?: number; margin?: number; roads?: boolean; step?: number } = {}): Footprint | null {
    const step = options.step ?? 3;
    for (let radius = options.from ?? 0; radius <= (options.to ?? 90); radius += step) {
      const count = radius === 0 ? 1 : Math.max(8, Math.round(radius * 2 * Math.PI / step));
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2;
        const centre: XZ = [near[0] + Math.cos(a) * radius, near[1] + Math.sin(a) * radius];
        const f: Footprint = { centre, half, turn: facing(centre, face) };
        if (this.free(f, options)) return f;
      }
    }
    return null;
  }
}

/** The quarter turn that points a piece's front (+Z) from `from` most nearly at `to`. */
export function facing(from: XZ, to: XZ): CardinalTurn {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  // turn 0: +Z, turn 1: +X, turn 2: -Z, turn 3: -X (transformCardinalPoint).
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 0 : 2;
}

/** A piece as placed: its dressing, any lit cells as braziers, and its world frame. */
export interface Placed {
  readonly dressing: Dressing;
  readonly braziers: RoyalBrazier[];
  readonly origin: Vec3;
  readonly turn: CardinalTurn;
  world(cell: Vec3): Vec3;
}

/**
 * Stand a blueprint with the cell `anchor` (x, z) on world `at`, its front turned by `turn`, on the lowest ground
 * under `footprint` cells less `sink` metres, so no edge floats over a dip.
 */
export function stand(ground: Ground, blueprint: VoxelBlueprint, anchor: readonly [number, number], at: XZ, turn: CardinalTurn,
  options: { footprint?: { from: readonly [number, number]; to: readonly [number, number] }; lanterns?: readonly Vec3[]; level?: number; sink?: number } = {}): Placed {
  const offset = transformCardinalPoint([0, 0, 0], turn, [anchor[0] * CELL, 0, anchor[1] * CELL]);
  const origin0: Vec3 = [at[0] - offset[0], 0, at[1] - offset[2]];
  const from = options.footprint?.from ?? [0, 0], to = options.footprint?.to ?? [blueprint.size[0], blueprint.size[2]];
  let level = options.level;
  if (level === undefined) {
    let low = Infinity;
    for (let x = from[0]; x <= to[0]; x += Math.max(1, Math.floor((to[0] - from[0]) / 8))) {
      for (let z = from[1]; z <= to[1]; z += Math.max(1, Math.floor((to[1] - from[1]) / 8))) {
        const p = transformCardinalPoint(origin0, turn, [x * CELL, 0, z * CELL]);
        low = Math.min(low, ground.height(p[0], p[2]));
      }
    }
    level = Math.floor((low - (options.sink ?? CELL)) / CELL) * CELL;
  }
  const origin: Vec3 = [origin0[0], level, origin0[2]];
  const world = (cell: Vec3): Vec3 => transformCardinalPoint(origin, turn, [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL]);
  return {
    dressing: { blueprint, position: origin, yaw: turn * Math.PI / 2 },
    braziers: (options.lanterns ?? []).map(cell => ({ position: world([cell[0] + .5, cell[1] + .5, cell[2] + .5]), normal: [0, 1, 0] as Vec3 })),
    origin, turn, world,
  };
}
