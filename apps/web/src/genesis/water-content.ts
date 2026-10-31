import type { WindowHouse } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '@chatdom/content';
import { sampleLandWater, terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { sampleGenesisSurface } from '@chatdom/world/genesis';
import { createPier } from '../../../../packages/content/src/places/water/pier/index';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/index';

const CELL = 0.125;

/** Authored water structures placed on the same sampled ground as the Genesis landscape. */
export function createGenesisWaterContent(plan: SettlementPlan): WindowHouse[] {
  const land = plan.genesisSurface;
  if (!land) return [];
  const turn = land.coast.oceanToward;
  const world = (x: number, z: number) => transformCardinalPoint([0, 0, 0], turn, [x, 0, z]);
  const ground = (x: number, z: number) => terrainHeight(plan, x, z);
  const result: WindowHouse[] = [];

  if (land.character === 'coastal-harbour') {
    // Find the dry-to-ocean crossing near the harbour, then find a root whose
    // ground meets the pier factory's four-cell landing tolerance.
    const localX = -65;
    let shore = 0;
    for (let z = 50; z < 300; z += .25) {
      const p = world(localX, z);
      if (sampleGenesisSurface(land, p[0], p[2]).water === 'ocean') { shore = z; break; }
    }
    if (shore) {
      let rootZ = shore, best = Infinity;
      for (let z = shore - 12; z <= shore; z += .125) {
        const p = world(localX, z), error = Math.abs(ground(p[0], p[2]) - .7);
        if (error < best) { best = error; rootZ = z; }
      }
      // Pier +Z points out to sea, and its x=10 cells is its centreline.
      const origin = world(localX - 1.25, rootZ);
      const point = (x: number, z: number) => transformCardinalPoint(origin, turn, [x * CELL, 0, z * CELL]);
      if (best <= .5) {
        const pier = createPier('tide', { walk: 192, freeboard: .7 / CELL, seed: plan.landform.seed,
          depth: (x, z) => { const p = point(x, z); return (.7 - ground(p[0], p[2])) / CELL; } });
        for (const module of pier.modules) {
          const p = transformCardinalPoint(origin, turn, [module.offset[0] * CELL, .7 + module.offset[1] * CELL, module.offset[2] * CELL]);
          result.push({ slot: -1, blueprint: module.piece.blueprint, position: p, yaw: turn * Math.PI / 2 });
        }
      }
    }
  }

  // The bridge spans local X while the river runs roughly along local Z.
  // Choose the sampled river section nearest town and only mount where its
  // actual bed and both landing heights fit the authored bridge's frame.
  const stream = land.terrainCore.streams.find(item => item.id === 'river');
  if (stream) {
    const inverse = ((4 - turn) % 4) as CardinalTurn;
    const candidates = stream.points.slice(0, -1).flatMap((point, index) => {
      const next = stream.points[index + 1]!;
      return Array.from({ length: 8 }, (_, i) => {
        const t = i / 8;
        const p = transformCardinalPoint([0, 0, 0], inverse, [point.position[0] * (1 - t) + next.position[0] * t, 0, point.position[1] * (1 - t) + next.position[1] * t]);
        return { x: p[0], z: p[2] };
      });
    }).sort((a, b) => Math.abs(a.z - 20) - Math.abs(b.z - 20));
    for (const candidate of candidates) {
      const centre = world(candidate.x, candidate.z), water = sampleLandWater(land.terrainCore, centre[0], centre[2]);
      if (!water || water.id !== stream.id || water.shoreDistance >= 0) continue;
      const left = world(candidate.x - 9, candidate.z), right = world(candidate.x + 9, candidate.z);
      const leftGround = ground(left[0], left[2]), rightGround = ground(right[0], right[2]);
      // Extend the abutments below the factory's datum to the sampled bed.
      const bed = ground(centre[0], centre[2]);
      const waterCells = Math.min(12, Math.floor((water.surface - bed) / CELL));
      if (waterCells < 2) continue;
      const base = water.surface - waterCells * CELL;
      const bankCells = Math.round(((leftGround + rightGround) / 2 - base) / CELL);
      if (bankCells <= waterCells || bankCells > 24 || Math.abs(leftGround - rightGround) > .75
        || leftGround <= water.surface || rightGround <= water.surface) continue;
      const corner = world(candidate.x - 9, candidate.z - 2);
      const position: Vec3 = [corner[0], base, corner[2]];
      const supports = bridgeFoundations(plan, position, turn);
      if (supports === undefined) continue;
      if (supports) result.push({ slot: -1, blueprint: supports.blueprint, position: supports.position, yaw: turn * Math.PI / 2 });
      result.push({ slot: -1, blueprint: createHumpbackBridge('tide', waterCells, bankCells).blueprint, position, yaw: turn * Math.PI / 2 });
      break;
    }
  }
  return result;
}

/** Extend the authored bridge's two abutments down to the displayed terrain.
 * Each small stone course samples its own footprint; the arch opening remains clear. */
function bridgeFoundations(plan: SettlementPlan, origin: Vec3, turn: CardinalTurn): { blueprint: VoxelBlueprint; position: Vec3 } | null | undefined {
  const cells: { x: number; z: number; bottom: number }[] = [];
  for (const x0 of [0, 100]) for (let x = x0; x < x0 + 44; x += 4) for (let z = 0; z < 32; z += 4) {
    const heights = [[x, z], [x + 4, z], [x, z + 4], [x + 4, z + 4]].map(([a, b]) => {
      const p = transformCardinalPoint(origin, turn, [a! * CELL, 0, b! * CELL]);
      return terrainHeight(plan, p[0], p[2]);
    });
    const bottom = Math.floor((Math.min(...heights) - origin[1]) / CELL);
    if (bottom < 0) cells.push({ x, z, bottom });
  }
  if (!cells.length) return null;
  const depth = -Math.min(...cells.map(cell => cell.bottom));
  if (depth > 256) return undefined;
  // Mesh caching keys on blueprint id, so include the sampled foundation shape.
  let hash = 2166136261;
  for (const cell of cells) hash = Math.imul(hash ^ (cell.bottom * 311 + cell.x * 17 + cell.z), 16777619);
  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-bridge-foundation-${hash >>> 0}`, styleId: STYLES.tide.id, kind: 'civic', lattice: 'build',
    size: [144, depth, 32], windows: [],
    boxes: cells.map(cell => ({ from: [cell.x, depth + cell.bottom, cell.z], to: [cell.x + 4, depth, cell.z + 4], material: MAT.darkStone })),
  };
  return { blueprint, position: [origin[0], origin[1] - depth * CELL, origin[2]] };
}
