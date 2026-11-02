import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { COLLISION_COMPILER_VERSION, compileCollisionWorld, type SampledTerrain } from '@chatdom/voxel/collision';
import { terrainHeight } from '../layout';
import type { RealmFoundedScene } from './types';
import type { SettlementPlan } from '../settlement/types';
import { TERRAIN_ART_PRODUCER } from '../terrain-art/types';

/** Changes to sampling/known volume must change this identity before a revision is reused. */
export const FOUNDED_TERRAIN_VERSION = `founded-terrain:2/${TERRAIN_ART_PRODUCER}` as const;
/** The static solids the scene's own placements do not carry (see `FOUNDED_ANVIL_SOLIDS`). */
export const FOUNDED_STATIC_SOLIDS_VERSION = 'founded-anvil:1' as const;
export const FOUNDED_PHYSICS_VERSION = `${COLLISION_COMPILER_VERSION}/${FOUNDED_TERRAIN_VERSION}/${FOUNDED_STATIC_SOLIDS_VERSION}` as const;

/**
 * The Forge anvil is drawn by the kingdom's anvil hero, not by a scene placement (a placement would draw a second,
 * plain anvil inside the hero), so its solid enters here, where the realm and every walking client compile the same
 * world. Cells are the hero's 0.0625 m lattice about the anvil (`foundedAnvilPosition` in interactions/founded.ts,
 * restated in `foundedAnvil` so the compiler stays free of the interaction graph), with the horn toward +X: the stone
 * block (x -15..9, z -9..9, up to its top course) and the iron above it to the 1.43 m face (x -14..22, z -6..6).
 * Rows start one cell under the street; the hero's rows are lifted by -0.0075 m so row 22's top is the face.
 * apps/web/src/walk/solids-cases.ts checks these boxes against the hero's sculpt voxel for voxel.
 */
const ANVIL_CELL = .0625, ANVIL_ROW_LIFT = 1.43 - 23 * ANVIL_CELL;
export const FOUNDED_ANVIL_SOLIDS = [
  { from: [-15, -1, -9], to: [9, 7, 9] },
  { from: [-14, 7, -6], to: [22, 23, 6] },
] as const;
const ANVIL_ID = 'forge:anvil', ANVIL_ASSET = 'founded:forge-anvil:1';
const ANVIL_MIN = [-15, -1, -9] as const, ANVIL_SIZE = [37, 24, 18] as const;

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

function buildTerrain(plan: SettlementPlan): SampledTerrain {
  if (plan.version !== 2 || plan.landform.version !== 1) throw new Error('Founded terrain has no installed sampler for this plan.');
  const b = plan.bounds;
  if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ) throw new Error('Founded terrain needs finite nonempty bounds.');
  const x = Math.floor(b.minX / 16) * 16, z = Math.floor(b.minZ / 16) * 16;
  const countX = Math.ceil((b.maxX - x) / 16), countZ = Math.ceil((b.maxZ - z) / 16);
  if (countX > 32 || countZ > 32) throw new Error('Founded terrain exceeds the installed render footprint.');
  const columns = countX * 32, rows = countZ * 32, heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const value = terrainHeight(plan, x + (column + .5) * .5, z + (row + .5) * .5);
    // Mirrors terrain-worker's BOTTOM_Y and 32 vertical chunks at 16m each.
    if (!Number.isFinite(value) || value <= -4 || value >= 496) throw new Error('Founded terrain exceeds its installed vertical volume.');
    heights[column + columns * row] = Math.round(value / .5) * .5;
  }
  return { origin: [x, -16, z], columns, rows, heights, ceilingY: 496 };
}

/** Compile already validated, receipt-matched public geometry on either end of walking. */
export function compileFoundedScene(scene: RealmFoundedScene): CollisionWorld {
  const anvil = foundedAnvil(scene);
  return compileCollisionWorld({ revision: scene.collisionRevision, materials: scene.materials,
    assets: anvil ? [...scene.assets, anvil.asset] : scene.assets,
    placements: anvil ? [...scene.placements, anvil.placement] : scene.placements, terrain: sampleFoundedTerrain(scene.plan) });
}

/** The anvil as one collision-only asset and placement; null only if the scene has no solid material at all. */
function foundedAnvil(scene: RealmFoundedScene) {
  const material = scene.materials.materials.find(m => m.solid)?.id;
  if (material === undefined) return null;
  if (scene.placements.some(p => p.id === ANVIL_ID) || scene.assets.some(a => a.assetHash === ANVIL_ASSET)) {
    throw new Error('The founded scene already names the Forge anvil; it is a compiled solid, not a placement.');
  }
  const at: Vec3 = [0, scene.plan.market.elevation, 8], local = (v: readonly number[]) => v.map((n, i) => n - ANVIL_MIN[i]!) as unknown as Vec3;
  return {
    asset: { assetHash: ANVIL_ASSET, blueprint: { lattice: 'avatar' as const, size: ANVIL_SIZE as unknown as Vec3,
      boxes: FOUNDED_ANVIL_SOLIDS.map(box => ({ from: local(box.from), to: local(box.to), material })) } },
    placement: { id: ANVIL_ID, assetHash: ANVIL_ASSET, rotation: 0,
      position: [at[0] + ANVIL_MIN[0] * ANVIL_CELL, at[1] + ANVIL_MIN[1] * ANVIL_CELL + ANVIL_ROW_LIFT, at[2] + ANVIL_MIN[2] * ANVIL_CELL] as Vec3 },
  };
}

/** Physical ground under one location. A caller still must check support and body clearance in the compiled world. */
export function foundedGroundAt(plan: SettlementPlan, x: number, z: number): Vec3 {
  const px = (Math.floor(x * 2) + .5) * .5, pz = (Math.floor(z * 2) + .5) * .5;
  return [x, Math.round(terrainHeight(plan, px, pz) / .5) * .5, z];
}
