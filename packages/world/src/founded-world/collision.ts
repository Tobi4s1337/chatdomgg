import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { COLLISION_COMPILER_VERSION, compileCollisionWorld, type SampledTerrain } from '@chatdom/voxel/collision';
import { terrainHeight } from '../layout';
import type { RealmFoundedScene } from './types';
import type { SettlementPlan } from '../settlement/types';
import { TERRAIN_ART_PRODUCER } from '../terrain-art/types';

/** Changes to sampling/known volume must change this identity before a revision is reused. */
export const FOUNDED_TERRAIN_VERSION = `founded-terrain:2/${TERRAIN_ART_PRODUCER}` as const;
export const FOUNDED_PHYSICS_VERSION = `${COLLISION_COMPILER_VERSION}/${FOUNDED_TERRAIN_VERSION}` as const;

/**
 * Same 16m chunk footprint and half-metre cell-centre sampling as kingdom/terrain-worker.ts. Its render halos
 * are excluded from known space. Visible metre triangles are smoothed; their heights are not physical floors.
 * The lake's actual sampled bed remains below the animated water sheet; no sheet collider is manufactured.
 * Browser-safe. Unsupported landforms fail until their terrainHeight dispatch is installed.
 */
const terrainCache = new Map<string, SampledTerrain>();

export function sampleFoundedTerrain(plan: SettlementPlan): SampledTerrain {
  const signature = JSON.stringify(plan), hit = terrainCache.get(signature);
  if (hit) return { ...hit, heights: Float32Array.from(hit.heights as ArrayLike<number>) };
  const terrain = buildTerrain(plan);
  terrainCache.set(signature, terrain);
  while (terrainCache.size > 4) terrainCache.delete(terrainCache.keys().next().value!);
  return { ...terrain, heights: Float32Array.from(terrain.heights as ArrayLike<number>) };
}

/** The founded collision grid's frame: its origin, size and one cell's exact floor top (null without a sampler). */
export interface FoundedTerrainFrame {
  readonly origin: Vec3; readonly columns: number; readonly rows: number; readonly ceilingY: number;
  sample(column: number, row: number): number;
}
export function foundedTerrainFrame(plan: SettlementPlan): FoundedTerrainFrame | null {
  if (plan.version !== 2 || plan.landform.version !== 1) return null;
  const b = plan.bounds;
  if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ) throw new Error('Founded terrain needs finite nonempty bounds.');
  const x = Math.floor(b.minX / 16) * 16, z = Math.floor(b.minZ / 16) * 16;
  const countX = Math.ceil((b.maxX - x) / 16), countZ = Math.ceil((b.maxZ - z) / 16);
  if (countX > 32 || countZ > 32) throw new Error('Founded terrain exceeds the installed render footprint.');
  return { origin: [x, -16, z], columns: countX * 32, rows: countZ * 32, ceilingY: 496,
    sample(column, row) {
      const value = terrainHeight(plan, x + (column + .5) * .5, z + (row + .5) * .5);
      // Mirrors terrain-worker's BOTTOM_Y and 32 vertical chunks at 16m each.
      if (!Number.isFinite(value) || value <= -4 || value >= 496) throw new Error('Founded terrain exceeds its installed vertical volume.');
      return Math.round(value / .5) * .5;
    } };
}

function buildTerrain(plan: SettlementPlan): SampledTerrain {
  const frame = foundedTerrainFrame(plan);
  if (!frame) throw new Error('Founded terrain has no installed sampler for this plan.');
  const { columns, rows } = frame, heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) heights[column + columns * row] = frame.sample(column, row);
  return { origin: frame.origin, columns, rows, heights, ceilingY: frame.ceilingY };
}

/**
 * Accept floor tops sampled elsewhere (the opening's ground workers run this module's own sampler) so the next
 * `sampleFoundedTerrain` of an equal plan reuses them. Rejects any grid that does not have the frame's exact shape
 * and half-metre values; it never widens what is known.
 */
export function primeFoundedTerrain(plan: SettlementPlan, heights: Float32Array): void {
  const frame = foundedTerrainFrame(plan);
  if (!frame) throw new Error('Founded terrain has no installed sampler for this plan.');
  if (heights.length !== frame.columns * frame.rows) throw new Error('Primed founded terrain has the wrong shape.');
  for (const value of heights) if (!Number.isFinite(value) || value <= -4 || value >= 496 || value * 2 !== Math.round(value * 2)) throw new Error('Primed founded terrain is not an installed floor.');
  const signature = JSON.stringify(plan);
  if (terrainCache.has(signature)) return;
  terrainCache.set(signature, { origin: frame.origin, columns: frame.columns, rows: frame.rows, heights: Float32Array.from(heights), ceilingY: frame.ceilingY });
  while (terrainCache.size > 4) terrainCache.delete(terrainCache.keys().next().value!);
}

/** Compile already validated, receipt-matched public geometry on either end of walking. */
export function compileFoundedScene(scene: RealmFoundedScene): CollisionWorld {
  return compileCollisionWorld({ revision: scene.collisionRevision, materials: scene.materials, assets: scene.assets,
    placements: scene.placements, terrain: sampleFoundedTerrain(scene.plan) });
}

/** Physical ground under one location. A caller still must check support and body clearance in the compiled world. */
export function foundedGroundAt(plan: SettlementPlan, x: number, z: number): Vec3 {
  const px = (Math.floor(x * 2) + .5) * .5, pz = (Math.floor(z * 2) + .5) * .5;
  return [x, Math.round(terrainHeight(plan, px, pz) / .5) * .5, z];
}
