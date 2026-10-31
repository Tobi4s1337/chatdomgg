// SIMULATED harbour headland for the Genesis landmark bench: authored bench ground, a sea basin, the watchtower the
// adapter proposed for the coastal showcase recipe, and a few existing water-place pieces for scale and life. Every
// height and site here is a bench fixture, never a land decision; the tower's real site, turn and ground belong to
// main. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createRowingBoat, createUpturnedBoat, ROWING_BOAT } from '../../places/water/boats/index';
import { createCritter, type Critter } from '../../places/water/critters/index';
import { createPebbles, createReeds } from '../../places/water/shore/index';
import { proposeGenesisLandmarks, type GenesisLandmarkProposal } from '../adapter';
import { HARBOUR_TARGET, showcaseFixture } from '../showcase-fixtures';

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
