import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import {
  COLLISION_COMPILER_VERSION, COLLISION_LIMITS, CollisionAssetCache, CollisionCompileError, collisionSolidity,
  type CollisionAsset, type CollisionBlueprint, type CollisionMaterial,
} from './asset';
import { terrainBoxes, terrainFootprint, type SampledTerrain, type TerrainFootprint } from './terrain';

/** A placed blueprint: rotate about its local origin by `rotation` quarter turns, then translate (metres). */
export interface CollisionPlacement {
  readonly id: string;
  /** Key into `blueprints`; also the asset cache key, so it must name immutable blueprint bytes. */
  readonly blueprint: string;
  readonly position: Vec3;
  /** Turn 1 maps local [x, y, z] to [z, y, -x]; turns 2 and 3 repeat it. */
  readonly rotation: number;
}

export interface CollisionWorldInput {
  /** The checked uint32 the walkers and the room agree on. */
  readonly revision: number;
  readonly materials: readonly CollisionMaterial[];
  readonly blueprints: ReadonlyMap<string, CollisionBlueprint>;
  readonly placements: readonly CollisionPlacement[];
  readonly terrain: SampledTerrain;
  /** Reuse compiled assets across revisions. A fresh cache is used when omitted. */
  readonly cache?: CollisionAssetCache;
}

export interface CollisionWorldStats {
  readonly compilerVersion: number;
  readonly placements: number;
  readonly assets: number;
  readonly structureBoxes: number;
  readonly terrainBoxes: number;
  readonly barrierBoxes: number;
  readonly boxes: number;
  readonly bucketMetres: number;
  readonly buckets: number;
  readonly bucketEntries: number;
  /** Bytes held by the packed bounds and index (box objects are created once, on first query). */
  readonly indexBytes: number;
}

export interface CompiledCollisionWorld extends CollisionWorld {
  /** The known volume: the terrain footprint between its bottom and ceiling. */
  readonly footprint: TerrainFootprint;
  readonly stats: CollisionWorldStats;
}

const BARRIERS = 6;
const MIN_BUCKET_METRES = 4;

/** Rotated local cell box → world metres, matching transformCardinalPoint for each corner. */
function placeBox(asset: CollisionAsset, b: number, position: Vec3, turn: number, out: number[]): void {
  const m = asset.cellMetres, s = asset.boxes, o = b * 6;
  const x0 = s[o]! * m, y0 = s[o + 1]! * m, z0 = s[o + 2]! * m, x1 = s[o + 3]! * m, y1 = s[o + 4]! * m, z1 = s[o + 5]! * m;
  const [px, py, pz] = position;
  let minX: number, maxX: number, minZ: number, maxZ: number;
  if (turn === 0) { minX = px + x0; maxX = px + x1; minZ = pz + z0; maxZ = pz + z1; }
  else if (turn === 1) { minX = px + z0; maxX = px + z1; minZ = pz - x1; maxZ = pz - x0; }
  else if (turn === 2) { minX = px - x1; maxX = px - x0; minZ = pz - z1; maxZ = pz - z0; }
  else { minX = px - z1; maxX = px - z0; minZ = pz + x0; maxZ = pz + x1; }
  out.push(minX, py + y0, minZ, maxX, py + y1, maxZ);
}

/**
 * Compiles the final solids of a placed scene and its sampled terrain into one immutable `CollisionWorld`.
 *
 * - Structures: each blueprint's ordered operations resolve to final cells (see `compileCollisionAsset`), then
 *   transform by their cardinal turn. Openings stay open under every turn; nothing is resnapped.
 * - Terrain: the explicit sampled lattice, every step kept (see `terrainBoxes`).
 * - Unknown: six barriers cover everything outside the footprint, below its bottom and above its ceiling.
 *
 * Boxes are ordered placements by ID (code units), each in asset order, then terrain rows, then barriers. A query
 * returns, in that order and without duplicates, every box that intersects or touches its bounds. Returned boxes
 * and arrays are frozen. The index is a fixed horizontal bucket grid; one query's workspace is one mark per box,
 * allocated with the world. There is no dense fine grid over the kingdom.
 */
export function compileCollisionWorld(input: CollisionWorldInput): CompiledCollisionWorld {
  const { revision } = input;
  if (!Number.isInteger(revision) || revision < 0 || revision > 0xffffffff) throw new CollisionCompileError('collision revision must be a uint32');
  const solidity = collisionSolidity(input.materials);
  const cache = input.cache ?? new CollisionAssetCache(Math.max(1, input.blueprints.size));
  if (input.placements.length > COLLISION_LIMITS.placements) throw new CollisionCompileError('too many placements');
  const placements = [...input.placements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bounds: number[] = [];
  const used = new Set<string>();
  for (let p = 0; p < placements.length; p++) {
    const placement = placements[p]!;
    if (typeof placement.id !== 'string' || !placement.id) throw new CollisionCompileError('placement needs an ID');
    if (p > 0 && placements[p - 1]!.id === placement.id) throw new CollisionCompileError(`placement ${placement.id} appears twice`);
    const turn = placement.rotation;
    if (turn !== 0 && turn !== 1 && turn !== 2 && turn !== 3) throw new CollisionCompileError(`placement ${placement.id} has no cardinal turn`);
    const position = placement.position;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new CollisionCompileError(`placement ${placement.id} has no finite position`);
    const blueprint = input.blueprints.get(placement.blueprint);
    if (!blueprint) throw new CollisionCompileError(`placement ${placement.id} references a missing blueprint`);
    let asset: CollisionAsset;
    try { asset = cache.resolve(placement.blueprint, blueprint, solidity); }
    catch (error) { throw error instanceof CollisionCompileError ? new CollisionCompileError(`placement ${placement.id}: ${error.message}`) : error; }
    used.add(placement.blueprint);
    for (let b = 0; b < asset.count; b++) placeBox(asset, b, position, turn, bounds);
    if (bounds.length / 6 > COLLISION_LIMITS.boxes) throw new CollisionCompileError('scene exceeds the collision box budget');
  }
  const structureBoxes = bounds.length / 6;
  const footprint = terrainFootprint(input.terrain);
  const terrainCount = terrainBoxes(input.terrain, bounds);
  const { minX, maxX, minZ, maxZ, bottom, ceiling } = footprint;
  const I = Infinity;
  bounds.push(
    -I, -I, -I, minX, I, I, // west
    maxX, -I, -I, I, I, I, // east
    minX, -I, -I, maxX, I, minZ, // south
    minX, -I, maxZ, maxX, I, I, // north
    minX, -I, minZ, maxX, bottom, maxZ, // below the known ground
    minX, ceiling, minZ, maxX, I, maxZ, // above the known volume
  );
  const total = bounds.length / 6;
  if (total > COLLISION_LIMITS.boxes) throw new CollisionCompileError('scene exceeds the collision box budget');
  const packed = Float64Array.from(bounds);
  const finite = total - BARRIERS;

  // Horizontal bucket grid over every finite box; barriers are always tested on their own.
  let gx0 = minX, gx1 = maxX, gz0 = minZ, gz1 = maxZ;
  for (let b = 0; b < finite; b++) {
    const o = b * 6;
    gx0 = Math.min(gx0, packed[o]!); gz0 = Math.min(gz0, packed[o + 2]!);
    gx1 = Math.max(gx1, packed[o + 3]!); gz1 = Math.max(gz1, packed[o + 5]!);
  }
  let edge = MIN_BUCKET_METRES;
  while (Math.floor((gx1 - gx0) / edge + 1) * Math.floor((gz1 - gz0) / edge + 1) > COLLISION_LIMITS.buckets) edge *= 2;
  const cols = Math.floor((gx1 - gx0) / edge) + 1, rows = Math.floor((gz1 - gz0) / edge) + 1;
  const cellX = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - gx0) / edge)));
  const cellZ = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - gz0) / edge)));
  const starts = new Uint32Array(cols * rows + 1);
  for (let b = 0; b < finite; b++) {
    const o = b * 6;
    for (let z = cellZ(packed[o + 2]!), z1 = cellZ(packed[o + 5]!); z <= z1; z++)
      for (let x = cellX(packed[o]!), x1 = cellX(packed[o + 3]!); x <= x1; x++) starts[x + cols * z + 1] = starts[x + cols * z + 1]! + 1;
  }
  for (let i = 1; i < starts.length; i++) starts[i] = starts[i]! + starts[i - 1]!;
  const entries = new Uint32Array(starts[cols * rows]!);
  const fill = starts.slice(0, cols * rows);
  for (let b = 0; b < finite; b++) {
    const o = b * 6;
    for (let z = cellZ(packed[o + 2]!), z1 = cellZ(packed[o + 5]!); z <= z1; z++)
      for (let x = cellX(packed[o]!), x1 = cellX(packed[o + 3]!); x <= x1; x++) { const at = x + cols * z; entries[fill[at]!] = b; fill[at] = fill[at]! + 1; }
  }

  const objects: (SolidBox | undefined)[] = new Array<SolidBox | undefined>(total);
  const boxAt = (b: number): SolidBox => {
    let box = objects[b];
    if (!box) {
      const o = b * 6;
      box = Object.freeze({
        min: Object.freeze([packed[o]!, packed[o + 1]!, packed[o + 2]!] as const),
        max: Object.freeze([packed[o + 3]!, packed[o + 4]!, packed[o + 5]!] as const),
      });
      objects[b] = box;
    }
    return box;
  };
  const marks = new Uint32Array(finite);
  let epoch = 0;
  const touches = (b: number, q: SolidBox): boolean => {
    const o = b * 6;
    return packed[o]! <= q.max[0] && packed[o + 3]! >= q.min[0] && packed[o + 1]! <= q.max[1] && packed[o + 4]! >= q.min[1]
      && packed[o + 2]! <= q.max[2] && packed[o + 5]! >= q.min[2];
  };
  const barriersOnly = Object.freeze(Array.from({ length: BARRIERS }, (_, n) => boxAt(finite + n)));

  const query = (q: SolidBox): readonly SolidBox[] => {
    const lo = q.min, hi = q.max;
    // Unreadable bounds cannot be answered with air: report the unknown barriers.
    for (let d = 0; d < 3; d++) if (Number.isNaN(lo[d]) || Number.isNaN(hi[d]) || lo[d]! > hi[d]!) return barriersOnly;
    if (++epoch === 0x100000000) { marks.fill(0); epoch = 1; }
    const hits: number[] = [];
    if (hi[0]! >= gx0 && lo[0]! <= gx1 && hi[2]! >= gz0 && lo[2]! <= gz1) {
      for (let z = cellZ(lo[2]!), z1 = cellZ(hi[2]!); z <= z1; z++) for (let x = cellX(lo[0]!), x1 = cellX(hi[0]!); x <= x1; x++) {
        const cell = x + cols * z;
        for (let e = starts[cell]!, end = starts[cell + 1]!; e < end; e++) {
          const b = entries[e]!;
          if (marks[b] === epoch) continue;
          marks[b] = epoch;
          if (touches(b, q)) hits.push(b);
        }
      }
    }
    hits.sort((a, b) => a - b);
    for (let n = 0; n < BARRIERS; n++) if (touches(finite + n, q)) hits.push(finite + n);
    return Object.freeze(hits.map(boxAt));
  };

  const stats: CollisionWorldStats = Object.freeze({
    compilerVersion: COLLISION_COMPILER_VERSION, placements: placements.length, assets: used.size,
    structureBoxes, terrainBoxes: terrainCount, barrierBoxes: BARRIERS, boxes: total,
    bucketMetres: edge, buckets: cols * rows, bucketEntries: entries.length,
    indexBytes: packed.byteLength + starts.byteLength + entries.byteLength + marks.byteLength,
  });
  return Object.freeze({ revision, query, footprint: Object.freeze({ ...footprint }), stats });
}
