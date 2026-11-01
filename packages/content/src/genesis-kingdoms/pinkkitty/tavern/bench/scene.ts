// SIMULATED town bank for PinkKittyRose's tavern bench: an authored grass bank, a river channel behind the inn, a
// paved street before it, and The Lantern and Oar standing between them with its jetty out over the water, a rowing
// boat at the jetty and two trees for scale. Every height, site and arrangement here is a bench fixture, never a
// placement decision; the real site belongs to the kingdom host. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../../materials';
import { createTree } from '../../../../core/index';
import { Boxes, hash } from '../../../../genesis-landmarks/kit';
import { ROWING_BOAT, createRowingBoat } from '../../../../places/water/boats/index';
import { LANTERN_AND_OAR, createLanternAndOar } from '../index';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

/** The inn's street level, above the river at y = 0. The grass lies a cell lower so paving never fights it. */
const BANK = 0.6;
const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** The town bank (+Z) stands level and drops into the river at the quay (z ≈ 0); the far bank rises beyond z = −13. */
export function bank(x: number, z: number): number {
  const town = smooth(-1.1, -0.3, z), far = smooth(-12.5, -14.5, z);
  const bed = -1.6 + 0.08 * Math.sin(x * 0.3);
  const top = BANK - CELL + 0.05 * Math.sin(x * 0.41 + z * 0.23) * smooth(16, 24, Math.hypot(x, z - 6));
  return bed + (top - bed) * Math.max(town, far);
}

/** A paved street before the inn: flags in grey and buff, kerbed on both edges. */
function street(width: number, depth: number): VoxelBlueprint {
  const b = new Boxes();
  b.add(0, 0, 0, width, 2, depth, MAT.paving);
  for (let x = 0; x < width; x += 6) for (let z = 1; z < depth - 1; z += 5) {
    const r = hash(x, z, 3, 17);
    if (r < 0.42) b.add(x, 1, z, Math.min(width, x + 6), 2, z + 5, r < 0.24 ? MAT.stone : MAT.limestone);
  }
  b.add(0, 1, 0, width, 2, 1, MAT.darkStone);
  b.add(0, 1, depth - 1, width, 2, depth, MAT.darkStone);
  return { version: 1, id: 'pinkkitty-tavern-bench-street', styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [width, 2, depth], boxes: b.list, windows: [] };
}

export function tavernBench() {
  const width = 161, depth = 161, origin: [number, number] = [-40, -34], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = bank(origin[0] + i * step, origin[1] + k * step);

  const inn = createLanternAndOar();
  // The inn's body centre on x = 0, its river face (z = 34) on the quay line z = 0, its street level at BANK.
  const innAt: Vec3 = [-82 * CELL, BANK - inn.ground * CELL, -LANTERN_AND_OAR.body.z[0] * CELL];
  const world = (p: Vec3): Vec3 => [innAt[0] + p[0] * CELL, innAt[1] + p[1] * CELL, innAt[2] + p[2] * CELL];
  const front = world([0, 0, inn.footprint[3]])[2];
  const road = street(256, 40);
  const trees = [createTree(0), createTree(2)];
  const boat = createRowingBoat('hearth', 0);
  const at = (x: number, z: number, b: VoxelBlueprint): Vec3 => [x - (b.size[0] * CELL) / 2, bank(x, z), z - (b.size[2] * CELL) / 2];
  const placements: BenchPlacement[] = [
    { id: 'inn', blueprint: inn.blueprint, origin: innAt, yaw: 0 },
    { id: 'street', blueprint: road, origin: [-16, BANK - 2 * CELL, front + 0.4], yaw: 0 },
    { id: 'tree-0', blueprint: trees[0]!, origin: at(-16, 4, trees[0]!), yaw: 0.6 },
    { id: 'tree-1', blueprint: trees[1]!, origin: at(15.5, -0.5, trees[1]!), yaw: 2.1 },
    { id: 'rowing-boat', blueprint: boat.blueprint, origin: [-0.4, -ROWING_BOAT.draft * CELL, -4.6], yaw: 1.5 },
  ];
  return {
    inn, ground: { origin, step, width, depth, data },
    river: { id: 'river', x: 0, z: -7.2, radiusX: 90, radiusZ: 7.4, level: 0, depth: 1.6 },
    placements,
    fires: inn.fires.map(world),
    sign: world(inn.sign),
    views: {
      // The town's hero framing: high three-quarter from the street side, about 35 m out.
      hero: { eye: [14.5, 26.5, 30.5], target: [0, 4.6, 5.2], fov: 34 } as BenchView,
      // From across the street at eye height, a little east of the door.
      street: { eye: [6.2, 1.7, 22.5], target: [-0.6, 4.4, 8.6], fov: 52 } as BenchView,
      // From the far bank: the quay, the jetty and its moorings, and the river face.
      river: { eye: [9.5, 2.6, -17], target: [0, 3.2, 0], fov: 50 } as BenchView,
    },
    shadowBounds: { min: [-24, -4, -14] as Vec3, max: [24, 20, 26] as Vec3 },
  };
}
