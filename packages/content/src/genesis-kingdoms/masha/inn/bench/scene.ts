// SIMULATED Bell Court for the Copper Kettle bench: authored bench ground rising behind the inn towards the city's
// terraces, a small cobbled square in front of its door, a few trees for scale, and the inn itself. Every height and
// site here is a bench fixture, never a land decision; the inn's real site, turn and ground belong to the city plan.
// Production code never imports this module.
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { createTree } from '../../../../core/index';
import { Boxes, hash } from '../../../../genesis-landmarks/kit';
import type { LandmarkPiece } from '../../../../genesis-landmarks/types';
import { MAT, type StyleKey } from '../../../../materials';
import { createCopperKettle } from '../inn';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface InnBench {
  readonly piece: LandmarkPiece;
  /** The inn's local origin in bench metres. */
  readonly inn: Vec3;
  readonly ground: { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array };
  readonly placements: readonly BenchPlacement[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** The square is level round the inn; behind it the mountainside climbs in soft terraces. */
export function courtLand(x: number, z: number): number {
  const behind = -z - 14;
  let h = -0.06 + 0.04 * Math.sin(x * 0.31 + z * 0.17);
  if (behind > 0) h += 9 * smooth(0, 40, behind) + 0.6 * Math.sin(behind * 0.35) * smooth(0, 10, behind) + 0.3 * Math.sin(x * 0.12);
  // The far sides of the court lift a little, so the square reads as a hollow at the foot of the town.
  h += 1.4 * smooth(22, 48, Math.abs(x));
  return h;
}

/**
 * The cobbles of Bell Court: rows of rounded setts in paving and stone, laid with a dark joint a cell lower, their
 * rows bending gently as old paving does. Bench-only content, never part of the inn.
 */
export function cobbles(style: StyleKey, width: number, depth: number): VoxelBlueprint {
  const b = new Boxes();
  b.add(0, 0, 0, width, 1, depth, MAT.earth);
  for (let row = 0, z = 0; z < depth; row++, z += 3) {
    const bend = Math.round(2 * Math.sin(row * 0.21));
    let x = -((row * 2 + bend + 8) % 4);
    while (x < width) {
      const length = 2 + Math.floor(hash(x, row, 0, 401) * 3), r = hash(x, row, 1, 401);
      const material = r < 0.5 ? MAT.paving : r < 0.82 ? MAT.stone : r < 0.95 ? MAT.limestone : MAT.darkStone;
      b.add(Math.max(0, x), 1, z, Math.min(width, x + length), 2, Math.min(depth, z + 2), material);
      x += length + 1;
    }
  }
  return { version: 1, id: `bench-bell-court-cobbles-${style}`, styleId: StyleIdSchema.parse(style), kind: 'prop', lattice: 'build', size: [width, 2, depth], boxes: b.list, windows: [] };
}

export function innBench(style: StyleKey = 'tide'): InnBench {
  const piece = createCopperKettle({ style });
  // The door's centre sits on x = 0 and the stone front on z = 6.
  const inn: Vec3 = [-72 * CELL, 0, 6 - 116 * CELL];
  const width = 241, depth = 241, origin: [number, number] = [-60, -80], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = courtLand(origin[0] + i * step, origin[1] + k * step);
  const court = cobbles(style, 248, 176);
  const trees = [createTree(0), createTree(1), createTree(2)];
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, courtLand(x, z) - 0.1, z - (blueprint.size[2] * CELL) / 2];
  const placements: BenchPlacement[] = [
    { id: 'inn', blueprint: piece.blueprint, origin: inn, yaw: 0 },
    { id: 'cobbles', blueprint: court, origin: [-15.5, -2 * CELL, 5.2], yaw: 0 },
  ];
  for (const [i, [x, z, v]] of ([[-17, 9, 2], [18.5, 2, 1], [-20, -6, 2], [16, -16, 2], [-13, -22, 0], [24, -10, 0]] as const).entries()) {
    placements.push({ id: `tree-${i}`, blueprint: trees[v]!, origin: at(x, z, trees[v]!), yaw: i * 1.3 });
  }
  return {
    piece, inn, placements,
    ground: { origin, step, width, depth, data },
    views: {
      // A three-quarter view from the court, about 25 m out, at a standing eye a little above the cobbles.
      wide: { eye: [15.5, 3.2, 26.5], target: [-0.4, 8.6, 0.5], fov: 50 },
      tall: { eye: [11, 2.6, 30], target: [0, 9.5, 0], fov: 66 },
    },
    shadowBounds: { min: [-26, -2, -24], max: [26, 28, 28] },
  };
}
