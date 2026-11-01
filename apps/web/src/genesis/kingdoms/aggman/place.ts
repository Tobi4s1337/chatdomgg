import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import type { RoyalBrazier } from '../../../kingdom/royal-life';
import type { Dressing } from '../../../kingdom/settlement-content';

export const CELL = VOXEL_METRES.build;

/** A piece as the composition reads it: the blueprint, its lantern cells and its ground contact. */
export interface Placeable {
  readonly blueprint: VoxelBlueprint;
  readonly lanterns: readonly Vec3[];
  readonly footprint: { readonly from: readonly [number, number]; readonly to: readonly [number, number] };
  readonly draft?: number;
}

export interface Placed { readonly dressing: Dressing; readonly braziers: RoyalBrazier[]; readonly corners: readonly Vec3[] }

/**
 * Stand a piece with its footprint centred on world (x, z), its front (+Z) turned by `turn` quarter turns.
 * Grounded pieces settle to the lowest sampled corner of their footprint, so no edge floats over a dip; a
 * floating hull rides with its waterline on the sea. `level` pins an exact base (a building on its own pad).
 */
export function place(plan: SettlementPlan, piece: Placeable, x: number, z: number, turn: CardinalTurn, options: { level?: number; sink?: number } = {}): Placed {
  const { from, to } = piece.footprint;
  const centre: Vec3 = [(from[0] + to[0]) / 2 * CELL, 0, (from[1] + to[1]) / 2 * CELL];
  const offset = transformCardinalPoint([0, 0, 0], turn, centre);
  const origin0: Vec3 = [x - offset[0], 0, z - offset[2]];
  const corners = [[from[0], from[1]], [to[0], from[1]], [from[0], to[1]], [to[0], to[1]]]
    .map(([a, b]) => transformCardinalPoint(origin0, turn, [a! * CELL, 0, b! * CELL]));
  const sea = plan.genesisSurface?.coast.level ?? 0;
  const y = piece.draft !== undefined ? sea - piece.draft * CELL
    : options.level ?? Math.min(...corners.map(c => terrainHeight(plan, c[0], c[2]))) - (options.sink ?? CELL);
  const origin: Vec3 = [origin0[0], y, origin0[2]];
  const world = (cell: Vec3): Vec3 => transformCardinalPoint(origin, turn, [(cell[0] + .5) * CELL, (cell[1] + .5) * CELL, (cell[2] + .5) * CELL]);
  return {
    dressing: { blueprint: piece.blueprint, position: origin, yaw: turn * Math.PI / 2 },
    braziers: piece.lanterns.map(cell => ({ position: world(cell), normal: [0, 1, 0] as Vec3 })),
    corners: corners.map(c => [c[0], y, c[2]] as Vec3),
  };
}
