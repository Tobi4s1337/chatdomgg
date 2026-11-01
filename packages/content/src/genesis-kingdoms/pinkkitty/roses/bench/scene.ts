// SIMULATED river landing for the PinkKittyRose roses bench: an authored grass bank, a river channel, and the four
// rose pieces set out as a lane mouth on the town bank (arch, two cressets at the water, planters along the edge,
// bushes at the posts). Every height, site and arrangement here is a bench fixture, never a placement decision; the
// real sites belong to the kingdom host. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createTree } from '../../../../core/index';
import { createRiverCresset, createRoseArch, createRoseBush, createRosePlanter } from '../index';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

const BANK = 0.6;
const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** The town bank (+Z) stands level at 0.6 m and drops into a river whose far bank rises again beyond z = -12. */
export function landing(x: number, z: number): number {
  const town = smooth(-1.4, 0.3, z), far = smooth(-11, -13, z);
  const bed = -1.3 + 0.06 * Math.sin(x * 0.3);
  return bed + (BANK - bed) * Math.max(town, far) + 0.04 * Math.sin(x * 0.41 + z * 0.23) * Math.max(town, far);
}

export function rosesBench() {
  const width = 161, depth = 121, origin: [number, number] = [-40, -30], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = landing(origin[0] + i * step, origin[1] + k * step);
  // A piece's local origin from its plan centre on the bank.
  const at = (x: number, z: number, b: VoxelBlueprint): Vec3 => [x - (b.size[0] * CELL) / 2, BANK, z - (b.size[2] * CELL) / 2];
  const arch = createRoseArch(40), cresset = createRiverCresset(), long = createRosePlanter(32), short = createRosePlanter(24), wide = createRosePlanter(48);
  const bushes = ([0, 1, 2, 3] as const).map(v => createRoseBush(v));
  const trees = [createTree(0), createTree(2)];
  const fires: Vec3[] = [];
  const placements: BenchPlacement[] = [{ id: 'arch', blueprint: arch, origin: at(0, 3.8, arch), yaw: 0 }];
  for (const [i, x] of [-4.9, 4.9].entries()) {
    const o = at(x, 0.95, cresset.blueprint);
    placements.push({ id: `cresset-${i}`, blueprint: cresset.blueprint, origin: o, yaw: 0 });
    fires.push([o[0] + cresset.fire[0] * CELL, o[1] + cresset.fire[1] * CELL, o[2] + cresset.fire[2] * CELL]);
  }
  placements.push({ id: 'planter-32', blueprint: long, origin: at(-8.4, 1.0, long), yaw: 0 });
  placements.push({ id: 'planter-24', blueprint: short, origin: at(7.9, 1.0, short), yaw: 0 });
  placements.push({ id: 'planter-48', blueprint: wide, origin: at(-9.6, 7.4, wide), yaw: 0 });
  for (const [i, [x, z]] of ([[-5.3, 5.5], [-7.3, 4.6], [5.4, 5.6], [7.4, 4.7]] as const).entries())
    placements.push({ id: `bush-${i}`, blueprint: bushes[i]!, origin: at(x, z, bushes[i]!), yaw: 0 });
  placements.push({ id: 'tree-0', blueprint: trees[0]!, origin: at(-14, 11, trees[0]!), yaw: 0.4 });
  placements.push({ id: 'tree-1', blueprint: trees[1]!, origin: at(13, 12, trees[1]!), yaw: 1.7 });
  return {
    ground: { origin, step, width, depth, data },
    river: { id: 'river', x: 0, z: -6, radiusX: 90, radiusZ: 6.6, level: 0, depth: 1.3 },
    placements, fires,
    views: {
      // From the far bank, low over the water: the lane mouth with its fires doubled in the river.
      wide: { eye: [5.5, 3.4, -13.5], target: [-0.4, 2.6, 3], fov: 44 } as BenchView,
      tall: { eye: [3, 3.2, -12], target: [0, 3, 3], fov: 66 } as BenchView,
      // Close on each bank group at a walker's height: bushes, planter heads and the cresset's basket.
      left: { eye: [-2.6, 2.6, -1.6], target: [-7.2, 1.2, 4.2], fov: 42 } as BenchView,
      right: { eye: [2.6, 2.6, -1.6], target: [7.2, 1.2, 4.2], fov: 42 } as BenchView,
    },
    shadowBounds: { min: [-20, -2, -6] as Vec3, max: [20, 12, 16] as Vec3 },
  };
}
