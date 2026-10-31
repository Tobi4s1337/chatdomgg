/**
 * The one collision adapter for a founded scene. Browser-safe: `@chatdom/shared`, `@chatdom/world` (terrain
 * sampling and types) and the pure voxel compiler; no content, forge, Node or Three imports. Server and browser
 * call exactly this with the same decoded scene, so they walk the same solids.
 */
import { VOXEL_METRES } from '@chatdom/shared';
import { terrainHeight, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
// Main registers `@chatdom/voxel/collision` → packages/voxel/src/collision/index.ts; until then the source path.
import {
  COLLISION_COMPILER_VERSION, CollisionAssetCache, compileCollisionWorld,
  type CollisionBlueprint, type CompiledCollisionWorld, type SampledTerrain,
} from '../../../../packages/voxel/src/collision/index';

/**
 * Bumped whenever the terrain recipe below can sample the same plan differently. Together with the compiler
 * version and the scene's geometry digest it names one physical world (see `foundedCollisionKey`).
 */
export const FOUNDED_TERRAIN_SAMPLER = 1;

/**
 * The renderer's terrain field (`apps/web/src/kingdom/terrain-worker.ts`): 16 m chunks from the floored plan
 * bounds, half-metre columns sampled at their centres, tops rounded to the half-metre lattice, solid from the
 * reserved base 16 m below sea level up to 32 vertical chunks. The occupancy is this half-metre lattice; the
 * visible ground is a 1 m tessellation of the continuous `terrainHeight`, so the drawn surface may sit up to about
 * a quarter metre above or below a column top. Walking eases its feet onto the visible surface; collision never
 * smooths a step into a ramp. Water is a visible sheet over the real lake bed, never a floor.
 */
export const FOUNDED_TERRAIN = {
  cellMetres: VOXEL_METRES.terrain,
  chunkMetres: VOXEL_METRES.terrain * 32,
  /** The renderer refuses ground at or below this height; so does collision. */
  lowestGround: -4,
  bottom: -16,
  ceiling: -16 + 32 * VOXEL_METRES.terrain * 32,
} as const;

export class FoundedCollisionError extends Error {
  readonly code = 'realm.founded-collision';
  constructor(message: string) { super(message); this.name = 'FoundedCollisionError'; }
}

/** Identity of one physical world: the revision owner maps each key to exactly one uint32 `collisionRevision`. */
export function foundedCollisionKey(geometryDigest: string): string {
  if (!/^[0-9a-f]{64}$/.test(geometryDigest)) throw new FoundedCollisionError('geometry digest must be a SHA-256 hex digest');
  return `${geometryDigest}:c${COLLISION_COMPILER_VERSION}:t${FOUNDED_TERRAIN_SAMPLER}`;
}

/** The known footprint and sampled half-metre ground of exactly this adopted plan. Pure and cacheable per plan. */
export function sampleFoundedTerrain(plan: SettlementPlan): SampledTerrain {
  if (plan.version !== 2) throw new FoundedCollisionError(`settlement plan version ${String(plan.version)} has no terrain sampler`);
  if (plan.landform?.version !== 1) throw new FoundedCollisionError(`landform version ${String(plan.landform?.version)} has no installed sampler`);
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) throw new FoundedCollisionError('terrain needs finite, nonempty bounds');
  const { cellMetres: cell, chunkMetres: chunk } = FOUNDED_TERRAIN;
  const originX = Math.floor(minX / chunk) * chunk, originZ = Math.floor(minZ / chunk) * chunk;
  const columns = Math.ceil((maxX - originX) / chunk) * 32, rows = Math.ceil((maxZ - originZ) / chunk) * 32;
  const heights = new Int32Array(columns * rows);
  for (let k = 0; k < rows; k++) for (let i = 0; i < columns; i++) {
    const height = terrainHeight(plan, originX + (i + .5) * cell, originZ + (k + .5) * cell);
    if (!Number.isFinite(height) || height <= FOUNDED_TERRAIN.lowestGround || height >= FOUNDED_TERRAIN.ceiling) {
      throw new FoundedCollisionError('terrain height exceeds the reserved vertical volume');
    }
    heights[i + columns * k] = Math.round(height / cell);
  }
  return Object.freeze({ cellMetres: cell, originX, originZ, columns, rows, heights,
    bottom: FOUNDED_TERRAIN.bottom, ceiling: FOUNDED_TERRAIN.ceiling });
}

/** Structural view of the renderer's `TerrainField` (`prepareTerrainField` in the web terrain worker). */
export interface RenderedTerrainField {
  readonly origin: readonly [number, number, number];
  readonly chunkCounts: readonly [number, number];
  readonly columns: number;
  readonly rows: number;
  /** Column tops in cells above origin.y, with a one-column halo on every side. */
  readonly heights: Int16Array;
}

/**
 * The browser already samples this exact lattice to draw the ground. Reusing its field gives the identical
 * `SampledTerrain` as `sampleFoundedTerrain(plan)` without sampling the plan a second time.
 */
export function terrainFromRenderField(field: RenderedTerrainField): SampledTerrain {
  const { cellMetres: cell, chunkMetres: chunk } = FOUNDED_TERRAIN;
  const [countX, countZ] = field.chunkCounts;
  const columns = countX * 32, rows = countZ * 32;
  if (field.columns !== columns + 2 || field.rows !== rows + 2 || field.heights.length !== field.columns * field.rows) throw new FoundedCollisionError('render terrain field does not match its chunk counts');
  if (field.origin[1] !== FOUNDED_TERRAIN.bottom || field.origin[0] % chunk !== 0 || field.origin[2] % chunk !== 0) throw new FoundedCollisionError('render terrain field is not on the founded terrain lattice');
  const base = field.origin[1] / cell, heights = new Int32Array(columns * rows);
  for (let k = 0; k < rows; k++) for (let i = 0; i < columns; i++) heights[i + columns * k] = field.heights[i + 1 + field.columns * (k + 1)]! + base;
  return Object.freeze({ cellMetres: cell, originX: field.origin[0], originZ: field.origin[2], columns, rows, heights,
    bottom: FOUNDED_TERRAIN.bottom, ceiling: FOUNDED_TERRAIN.ceiling });
}

export interface FoundedCollisionOptions {
  /** A previously sampled terrain of this same plan revision (sampling is the costly part). */
  readonly terrain?: SampledTerrain;
  /** Compiled assets keyed by `assetHash`, reused across revisions of the same kingdom. */
  readonly cache?: CollisionAssetCache;
}

/**
 * Every placement of a validated scene, keyed by its `assetHash`, plus the plan's own terrain, at the scene's
 * `collisionRevision`. Call it only on a scene from `validateFoundedScene`/`decodeFoundedScene`; any
 * inconsistency still fails closed in the compiler.
 */
export function compileFoundedCollision(scene: RealmFoundedScene, options: FoundedCollisionOptions = {}): CompiledCollisionWorld {
  const blueprints = new Map<string, CollisionBlueprint>(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  return compileCollisionWorld({
    revision: scene.collisionRevision,
    materials: scene.materials.materials,
    blueprints,
    placements: scene.placements.map(p => ({ id: p.id, blueprint: p.assetHash, position: p.position, rotation: p.rotation })),
    terrain: options.terrain ?? sampleFoundedTerrain(scene.plan),
    ...(options.cache ? { cache: options.cache } : {}),
  });
}

export { COLLISION_COMPILER_VERSION, CollisionAssetCache, type CompiledCollisionWorld, type SampledTerrain };
