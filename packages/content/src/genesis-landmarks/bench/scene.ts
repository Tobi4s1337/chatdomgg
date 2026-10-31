// SIMULATED harbour headland for the Genesis landmark bench: authored bench ground, a sea basin, the watchtower the
// adapter proposed for the coastal showcase recipe, and a few existing water-place pieces for scale and life. Every
// height and site here is a bench fixture, never a land decision; the tower's real site, turn and ground belong to
// main. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createRowingBoat, createUpturnedBoat, ROWING_BOAT } from '../../places/water/boats/index';
import { createCritter, type Critter } from '../../places/water/critters/index';
import { createPebbles, createReeds } from '../../places/water/shore/index';
import { createTree } from '../../core/index';
import { deriveWaterReaches, type WaterReach } from '../../../../world/src/places/water/reaches';
import type { KingdomLandform, LandStream } from '../../../../world/src/kingdom-land/types';
import { proposeGenesisLandmarks, type GenesisLandmarkProposal, type RiverLandmarkProposal } from '../adapter';
import { RIVER_HALL, RIVER_HALL_AXIS } from '../river-hall/hall';
import { HARBOUR_TARGET, RIVER_TARGET, showcaseFixture } from '../showcase-fixtures';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number; readonly bob?: number }
/** A lantern float on the basin (SIMULATED: a citizen would set it down), drifting slowly from `at`. */
export interface BenchFloat { readonly id: string; readonly critter: Critter; readonly at: readonly [number, number]; readonly drift: readonly [number, number]; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface HarbourBench {
  readonly proposal: GenesisLandmarkProposal;
  readonly ground: { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array };
  readonly sea: { readonly id: string; readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number; readonly level: number; readonly depth: number };
  readonly tower: Vec3;
  readonly placements: readonly BenchPlacement[];
  readonly floats: readonly BenchFloat[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const PAD = 1.0;

/** The seaward shore behind the tower, and the quay edge in front of it where the harbour basin begins. */
const quayZ = (x: number) => 12.5 + 0.1 * x;
const shoreZ = (x: number) => -6.4 + (x < -8.5 ? 1.25 * (-8.5 - x) : 0) - (x > 14 ? 0.3 * (x - 14) : 0);

export function land(x: number, z: number): number {
  const d = Math.min(z - shoreZ(x), quayZ(x) - z);
  let h = PAD + 0.55 * smooth(4, 40, d) + 0.06 * Math.sin(x * 0.37 + z * 0.21) + 0.05 * Math.sin(z * 0.29 - x * 0.13);
  // A short rocky drop into the sea, then the shelving sea floor.
  if (d < 1.2) h = d > -3 ? -2.2 + (h + 2.2) * smooth(-3, 1.2, d) : -2.2 - 2.8 * smooth(-3, -26, d);
  // The tower's knoll is level under the plinth, the porch and the steps.
  const pad = Math.max(Math.abs(x) - 6.6, Math.max(-5.2 - z, z - 9.5));
  if (pad < 3) h = h + (PAD - h) * (1 - smooth(0, 3, pad));
  // Two islands off the headland.
  for (const [cx, cz, r, top] of [[-58, -78, 16, 7.5], [26, -92, 10, 4.2], [-12, -118, 7, 3]] as const) {
    const e = Math.hypot(x - cx, z - cz) / r;
    if (e < 1.4) h = Math.max(h, -4 + (top + 4) * Math.pow(Math.max(0, 1 - (e / 1.4) ** 2), 0.7) + 0.4 * Math.sin(x * 0.5 + z * 0.3));
  }
  return h;
}

export function harbourBench(): HarbourBench {
  const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
  const proposal = proposeGenesisLandmarks(recipe, landscape)[0]!;
  const tower: Vec3 = [-6, PAD, -5.5];
  const width = 281, depth = 381, origin: [number, number] = [-80, -130], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = land(origin[0] + i * step, origin[1] + k * step);
  const style = proposal.piece.blueprint.styleId as 'tide';
  const boat = createRowingBoat(style, 0), upturned = createUpturnedBoat(style, 1);
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, land(x, z), z - (blueprint.size[2] * CELL) / 2];
  const reeds = [createReeds(style, 0), createReeds(style, 2)], pebbles = createPebbles(style, 1);
  return {
    proposal, tower,
    ground: { origin, step, width, depth, data },
    sea: { id: 'sea', x: -10, z: -70, radiusX: 280, radiusZ: 240, level: 0, depth: 6 },
    placements: [
      { id: 'tower', blueprint: proposal.piece.blueprint, origin: tower, yaw: 0 },
      { id: 'rowing-boat', blueprint: boat.blueprint, origin: [-3.5, -ROWING_BOAT.draft * CELL, 15.2], yaw: 1.42, bob: 1 },
      { id: 'upturned-boat', blueprint: upturned.blueprint, origin: at(10.5, 7.5, upturned.blueprint), yaw: -0.35 },
      { id: 'reeds-0', blueprint: reeds[0]!.blueprint, origin: at(-12.4, 11.4, reeds[0]!.blueprint), yaw: 0 },
      { id: 'reeds-1', blueprint: reeds[1]!.blueprint, origin: at(15.5, 13.8, reeds[1]!.blueprint), yaw: 0.8 },
      { id: 'pebbles', blueprint: pebbles.blueprint, origin: at(-8.6, 11.2, pebbles.blueprint), yaw: 0 },
    ],
    floats: ([[-7, 22.5, 0.06, 0.012], [-4.2, 27, 0.05, -0.01], [1.2, 30.5, 0.04, 0.015], [5.5, 24.6, 0.07, 0.008], [12.6, 27.4, 0.05, -0.012]] as const)
      .map(([x, z, dx, dz], i) => ({ id: `float-${i}`, critter: createCritter('floater', (i % 3) as 0 | 1 | 2), at: [x, z] as const, drift: [dx, dz] as const, yaw: i * 1.3 })),
    views: {
      wide: { eye: [17, 2.6, 45], target: [-5.5, 13.4, -3], fov: 46 },
      tall: { eye: [8, 2.6, 34], target: [-0.5, 13.5, -2], fov: 62 },
    },
    shadowBounds: { min: [-30, -3, -24], max: [24, 32, 26] },
  };
}

// ── The river valley ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RiverBench {
  readonly proposal: RiverLandmarkProposal;
  readonly ground: HarbourBench['ground'];
  readonly reaches: readonly WaterReach[];
  readonly level: number;
  /** The hall's local origin in bench metres. */
  readonly hall: Vec3;
  readonly placements: readonly BenchPlacement[];
  readonly floats: readonly BenchFloat[];
  /** Chimney mouths, where the bench's smoke rises. */
  readonly chimneys: readonly Vec3[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

/** The bank height the hall is drawn for, above the water at y = 0. */
const BANK = (RIVER_HALL.bank - RIVER_HALL.water) * CELL;
/** The river's centre line: straight through the hall, bending towards the town bank downstream. */
const riverZ = (x: number) => (x > 14 ? 0.0045 * (x - 14) ** 2 : x < -14 ? -0.003 * (x + 14) ** 2 : 0);

export function riverLand(x: number, z: number): number {
  const dz = Math.abs(z - riverZ(x)), side = z > riverZ(x) ? 1 : -1;
  // The channel: a two-metre bed, shelving sides and a short steep bank up to the bank top; downstream of the hall
  // the town bank lies back into a long shingle shore.
  const shore = 2 + (side > 0 ? 11 * smooth(5, 15, x) : 0);
  if (dz < 7 + shore) {
    if (dz < 3.5) return -2;
    if (dz < 7) return -2 + 1.7 * smooth(3.5, 7, dz);
    return -0.3 + (BANK + 0.3) * smooth(7, 7 + shore, dz);
  }
  // Banks: the town side rises gently, the far side climbs to a wooded ridge behind the hall.
  const rise = side > 0 ? 1.3 * smooth(12 + shore, 46, dz) : 6.5 * smooth(14, 70, dz);
  let h = BANK + rise + 0.08 * Math.sin(x * 0.31 + z * 0.17) + 0.06 * Math.sin(z * 0.23 - x * 0.11);
  // Level pads at bank height under both pavilions, their landings and the town steps.
  const pad = Math.max(Math.abs(x) - 6.2, Math.abs(z) - 19.5);
  if (pad < 4) h = h + (BANK - h) * (1 - smooth(0, 4, pad));
  return h;
}

export function riverBench(): RiverBench {
  const { recipe, landscape } = showcaseFixture(RIVER_TARGET);
  const proposal = proposeGenesisLandmarks(recipe, landscape)[0] as RiverLandmarkProposal;
  // The span's middle at the bench origin; the drawn water line at y = 0.
  const hall: Vec3 = [-RIVER_HALL_AXIS.x * CELL, -RIVER_HALL.water * CELL, -RIVER_HALL_AXIS.z * CELL];
  const width = 321, depth = 281, origin: [number, number] = [-90, -80], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = riverLand(origin[0] + i * step, origin[1] + k * step);
  // A bench course in the land's own records: level through the hall, falling a few centimetres across the bench.
  const stream: LandStream = {
    id: 'river', kind: 'stream', bank: 6,
    points: Array.from({ length: 13 }, (_, i) => {
      const x = -86 + i * 20 - (i === 12 ? 4 : 0);
      return { position: [x, riverZ(x)] as const, bed: -2, level: 0.06 - 0.12 * (i / 12), width: 14 };
    }),
  };
  const landform: KingdomLandform = {
    version: 2, seed: 11, ridge: { origin: [0, -400], bearing: 0, length: 1, width: 1, height: 0 }, castleRise: { centre: [0, -500], radius: 1, height: 0 },
    lake: { x: 0, z: -600, radiusX: 1, radiusZ: 1, level: -50 }, hills: [], waters: [], streams: [stream],
  };
  const style = proposal.piece.blueprint.styleId as 'hearth';
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, riverLand(x, z), z - (blueprint.size[2] * CELL) / 2];
  const boat = createRowingBoat(style, 2), upturned = createUpturnedBoat(style, 0);
  const reeds = ([0, 1, 2, 0] as const).map(v => createReeds(style, v)), pebbles = createPebbles(style, 2);
  const trees = [createTree(0), createTree(2), createTree(1), createTree(0)];
  return {
    proposal, hall, level: 0,
    ground: { origin, step, width, depth, data },
    reaches: deriveWaterReaches(landform),
    placements: [
      { id: 'hall', blueprint: proposal.piece.blueprint, origin: hall, yaw: 0 },
      { id: 'rowing-boat', blueprint: boat.blueprint, origin: [13.5, -ROWING_BOAT.draft * CELL, 5.2], yaw: -0.08, bob: 1 },
      { id: 'upturned-boat', blueprint: upturned.blueprint, origin: at(-15, -12.5, upturned.blueprint), yaw: 0.4 },
      { id: 'reeds-0', blueprint: reeds[0]!.blueprint, origin: at(20.5, 9.6, reeds[0]!.blueprint), yaw: 0 },
      { id: 'reeds-1', blueprint: reeds[1]!.blueprint, origin: at(-13, 8.4, reeds[1]!.blueprint), yaw: 1.1 },
      { id: 'reeds-2', blueprint: reeds[2]!.blueprint, origin: at(11, -8.6, reeds[2]!.blueprint), yaw: 2.2 },
      { id: 'reeds-3', blueprint: reeds[3]!.blueprint, origin: at(27, 12.6, reeds[3]!.blueprint), yaw: 0.5 },
      { id: 'pebbles', blueprint: pebbles.blueprint, origin: at(16.5, 8.2, pebbles.blueprint), yaw: 0 },
      { id: 'tree-0', blueprint: trees[0]!, origin: at(-19, -21, trees[0]!), yaw: 0.3 },
      { id: 'tree-1', blueprint: trees[1]!, origin: at(14, -22, trees[1]!), yaw: 1.2 },
      { id: 'tree-2', blueprint: trees[2]!, origin: at(-26, 15, trees[2]!), yaw: 2.4 },
      { id: 'tree-3', blueprint: trees[3]!, origin: at(-8, 30, trees[3]!), yaw: 0.9 },
    ],
    floats: ([[-3, 1.2, 0.09, 0.004], [6.5, -2.6, 0.1, -0.003], [12, 2.4, 0.08, 0.006], [20, 4.4, 0.07, 0.01], [-11, -1.8, 0.09, 0]] as const)
      .map(([x, z, dx, dz], i) => ({ id: `float-${i}`, critter: createCritter('floater', (i % 3) as 0 | 1 | 2), at: [x, z] as const, drift: [dx, dz] as const, yaw: i * 1.7 })),
    chimneys: [[2.625, 16.3, 9.5], [2.625, 16.3, -9.5]],
    views: {
      // From the town bank downstream, over the shingle: the river leading in under the arches, the town front turned
      // towards the eye.
      wide: { eye: [31, 6.4, 25.5], target: [-1, 6.6, 0], fov: 46 },
      tall: { eye: [24, 6.4, 27.5], target: [-1, 9, 0], fov: 66 },
    },
    shadowBounds: { min: [-36, -3, -34], max: [36, 26, 36] },
  };
}
