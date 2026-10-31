import { VOXEL_METRES, type Vec3, type VoxelLattice } from '@chatdom/shared';

/** Bumped whenever the same inputs could compile to different solids. Producers bind it into their revision. */
export const COLLISION_COMPILER_VERSION = 1;

/** Upper bounds that keep one compile bounded however its inputs were produced. */
export const COLLISION_LIMITS = {
  /** Cells along one blueprint axis; reviewed blueprints stay far below this. */
  assetAxis: 4096,
  /** Ordered voxel operations in one blueprint. */
  assetOperations: 65_536,
  /** Cells of one asset's compressed grid. Never more than its own dense volume. */
  assetCells: 16_777_216,
  placements: 65_536,
  terrainColumns: 16_777_216,
  /** All indexed world boxes: structures, terrain and the unknown barriers. */
  boxes: 4_000_000,
  /** Buckets of the horizontal index. The bucket edge grows to stay under it. */
  buckets: 1_048_576,
} as const;

export class CollisionCompileError extends Error {
  readonly code = 'voxel.collision-compile';
  constructor(message: string) { super(message); this.name = 'CollisionCompileError'; }
}

/** The one material fact collision needs. Anything else (faces, light, colour) never decides solidity. */
export interface CollisionMaterial { readonly id: number; readonly solid: boolean }
/** One ordered operation in build cells, half-open. Material zero carves air. */
export interface CollisionVoxelBox { readonly from: Vec3; readonly to: Vec3; readonly material: number }
/** Structural view of a voxel blueprint: no dependency on content, forge or world. */
export interface CollisionBlueprint {
  readonly lattice: VoxelLattice;
  readonly size: Vec3;
  readonly boxes: readonly CollisionVoxelBox[];
}

/**
 * Material solidity as a 16-bit lookup: 0 unknown, 1 air, 2 solid. Material zero must be air; every other ID
 * comes from the registry. `key` names exactly which IDs are solid, so a cache never mixes two solidity rules.
 */
export interface CollisionSolidity { readonly table: Uint8Array; readonly key: string }

export function collisionSolidity(materials: readonly CollisionMaterial[]): CollisionSolidity {
  const table = new Uint8Array(65536);
  for (const { id, solid } of materials) {
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new CollisionCompileError(`material ID ${String(id)} is not an unsigned 16-bit integer`);
    if (table[id]) throw new CollisionCompileError(`material ${id} appears twice`);
    if (typeof solid !== 'boolean') throw new CollisionCompileError(`material ${id} has no solidity`);
    if (id === 0 && solid) throw new CollisionCompileError('material zero must remain air');
    table[id] = solid ? 2 : 1;
  }
  if (table[0] !== 1) throw new CollisionCompileError('the registry has no material zero');
  const solids: number[] = [];
  for (let id = 0; id < table.length; id++) if (table[id] === 2) solids.push(id);
  return { table, key: solids.join(',') };
}

/**
 * Final solid cells of one blueprint, coalesced into boxes in local lattice cells (6 per box: min xyz, max xyz).
 * The boxes cover exactly the solid cells after every ordered operation, so carved doors and thin glass survive.
 */
export interface CollisionAsset {
  readonly lattice: VoxelLattice;
  readonly cellMetres: number;
  readonly size: Vec3;
  readonly boxes: Int32Array;
  readonly count: number;
  readonly solidCells: number;
}

function axisEdges(size: number, boxes: readonly CollisionVoxelBox[], axis: 0 | 1 | 2): Int32Array {
  const seen = new Uint8Array(size + 1);
  seen[0] = 1; seen[size] = 1;
  for (const box of boxes) { seen[box.from[axis]] = 1; seen[box.to[axis]] = 1; }
  let count = 0;
  for (const flag of seen) count += flag;
  const edges = new Int32Array(count);
  for (let v = 0, n = 0; v <= size; v++) if (seen[v]) edges[n++] = v;
  return edges;
}

function edgeLookup(edges: Int32Array, size: number): Int32Array {
  const index = new Int32Array(size + 1).fill(-1);
  for (let i = 0; i < edges.length; i++) index[edges[i]!] = i;
  return index;
}

/**
 * Resolves a blueprint's ordered operations on a coordinate-compressed grid: each axis is cut only where some
 * operation starts or ends, so every compressed cell is uniform and the result is exact at the asset's own
 * lattice. The grid is never larger than the asset's dense volume and is dropped after the call. Later
 * operations overwrite earlier ones; material zero carves. Solidity comes from the final material only, so glass
 * stays physical and an unknown ID anywhere in the blueprint refuses the whole asset.
 *
 * Coalescing is greedy in a fixed order: a run along X, widened along Z, then raised along Y, each only over
 * solid cells not yet taken. It never fills an opening and is the same on every machine.
 */
export function compileCollisionAsset(blueprint: CollisionBlueprint, solidity: CollisionSolidity): CollisionAsset {
  const cellMetres = (VOXEL_METRES as Record<string, number>)[blueprint.lattice];
  if (cellMetres === undefined || blueprint.lattice === 'terrain') throw new CollisionCompileError(`blueprint lattice ${String(blueprint.lattice)} cannot be placed as a structure`);
  const size = blueprint.size;
  if (!Array.isArray(size) || size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1 || n > COLLISION_LIMITS.assetAxis)) {
    throw new CollisionCompileError('blueprint size must be three integers in 1..4096');
  }
  const ops = blueprint.boxes;
  if (ops.length > COLLISION_LIMITS.assetOperations) throw new CollisionCompileError('blueprint has too many voxel operations');
  for (const [index, op] of ops.entries()) {
    for (let d = 0; d < 3; d++) {
      const from = op.from[d]!, to = op.to[d]!;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > size[d]!) {
        throw new CollisionCompileError(`blueprint operation ${index} is empty or outside the blueprint`);
      }
    }
    if (!Number.isInteger(op.material) || op.material < 0 || op.material > 65535 || !solidity.table[op.material]) {
      throw new CollisionCompileError(`blueprint operation ${index} uses unknown material ${String(op.material)}`);
    }
  }
  const ex = axisEdges(size[0], ops, 0), ey = axisEdges(size[1], ops, 1), ez = axisEdges(size[2], ops, 2);
  const nx = ex.length - 1, ny = ey.length - 1, nz = ez.length - 1;
  const cells = nx * ny * nz;
  if (cells > COLLISION_LIMITS.assetCells) throw new CollisionCompileError('blueprint grid exceeds the collision budget');
  const ix = edgeLookup(ex, size[0]), iy = edgeLookup(ey, size[1]), iz = edgeLookup(ez, size[2]);
  const grid = new Uint8Array(cells);
  const stride = nx * ny;
  for (const op of ops) {
    const value = solidity.table[op.material] === 2 ? 1 : 0;
    const x0 = ix[op.from[0]]!, x1 = ix[op.to[0]]!, y0 = iy[op.from[1]]!, y1 = iy[op.to[1]]!, z0 = iz[op.from[2]]!, z1 = iz[op.to[2]]!;
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) grid.fill(value, x0 + nx * y + stride * z, x1 + nx * y + stride * z);
  }
  const out: number[] = [];
  let solidCells = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const at = x + nx * y + stride * z;
    if (!grid[at]) continue;
    let x1 = x + 1;
    while (x1 < nx && grid[x1 + nx * y + stride * z]) x1++;
    const run = (yy: number, zz: number): boolean => {
      const base = nx * yy + stride * zz;
      for (let xx = x; xx < x1; xx++) if (!grid[xx + base]) return false;
      return true;
    };
    let z1 = z + 1;
    while (z1 < nz && run(y, z1)) z1++;
    let y1 = y + 1;
    rise: while (y1 < ny) {
      for (let zz = z; zz < z1; zz++) if (!run(y1, zz)) break rise;
      y1++;
    }
    for (let zz = z; zz < z1; zz++) for (let yy = y; yy < y1; yy++) grid.fill(0, x + nx * yy + stride * zz, x1 + nx * yy + stride * zz);
    const minX = ex[x]!, maxX = ex[x1]!, minY = ey[y]!, maxY = ey[y1]!, minZ = ez[z]!, maxZ = ez[z1]!;
    solidCells += (maxX - minX) * (maxY - minY) * (maxZ - minZ);
    out.push(minX, minY, minZ, maxX, maxY, maxZ);
  }
  return Object.freeze({
    lattice: blueprint.lattice, cellMetres, size: Object.freeze([size[0], size[1], size[2]] as const),
    boxes: Int32Array.from(out), count: out.length / 6, solidCells,
  });
}

/**
 * Compiled assets keyed by the caller's immutable asset identity (a content hash) and the solidity rule, so a
 * recompile after one home changes reuses every other asset. Least-recently used entries leave first.
 */
export class CollisionAssetCache {
  readonly #entries = new Map<string, CollisionAsset>();
  constructor(readonly limit = 512) {
    if (!Number.isInteger(limit) || limit < 1) throw new CollisionCompileError('collision asset cache limit must be a positive integer');
  }
  get size(): number { return this.#entries.size; }
  resolve(key: string, blueprint: CollisionBlueprint, solidity: CollisionSolidity): CollisionAsset {
    const id = `${COLLISION_COMPILER_VERSION}\n${solidity.key}\n${key}`;
    const hit = this.#entries.get(id);
    if (hit) { this.#entries.delete(id); this.#entries.set(id, hit); return hit; }
    const asset = compileCollisionAsset(blueprint, solidity);
    this.#entries.set(id, asset);
    while (this.#entries.size > this.limit) this.#entries.delete(this.#entries.keys().next().value!);
    return asset;
  }
}
