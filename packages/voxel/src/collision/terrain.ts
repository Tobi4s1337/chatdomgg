import { COLLISION_LIMITS, CollisionCompileError } from './asset';

/**
 * Terrain sampled on its own lattice, supplied explicitly by the producer (server and browser run the same
 * sampler). Column (i, k) covers x ∈ [originX + i·cell, originX + (i+1)·cell], likewise z, and is solid from
 * `bottom` up to `heights[i + columns·k] · cell` metres. Everything outside the footprint, below `bottom` or
 * above `ceiling` is unknown and blocks.
 */
export interface SampledTerrain {
  readonly cellMetres: number;
  readonly originX: number;
  readonly originZ: number;
  readonly columns: number;
  readonly rows: number;
  /** Column tops in whole cells above y = 0. */
  readonly heights: Int32Array | Int16Array | readonly number[];
  readonly bottom: number;
  readonly ceiling: number;
}

export interface TerrainFootprint { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly bottom: number; readonly ceiling: number }

export function terrainFootprint(terrain: SampledTerrain): TerrainFootprint {
  const { cellMetres: c, originX, originZ, columns, rows, bottom, ceiling } = terrain;
  if (!(Number.isFinite(c) && c > 0) || !Number.isFinite(originX) || !Number.isFinite(originZ)) throw new CollisionCompileError('terrain lattice needs a finite positive cell and origin');
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns * rows > COLLISION_LIMITS.terrainColumns) {
    throw new CollisionCompileError('terrain needs a bounded, nonempty column grid');
  }
  if (terrain.heights.length !== columns * rows) throw new CollisionCompileError('terrain heights do not match its column grid');
  if (!Number.isFinite(bottom) || !Number.isFinite(ceiling) || bottom >= ceiling) throw new CollisionCompileError('terrain needs a finite vertical range');
  return { minX: originX, maxX: originX + columns * c, minZ: originZ, maxZ: originZ + rows * c, bottom, ceiling };
}

/**
 * Coalesces equal-height columns into rectangles (a run along X, widened along Z), each a solid prism from
 * `bottom` to its top. Every half-metre step keeps its own face; nothing is smoothed into a ramp or a wall.
 * Pushes 6 numbers per box (min xyz, max xyz) in world metres.
 */
export function terrainBoxes(terrain: SampledTerrain, out: number[]): number {
  const footprint = terrainFootprint(terrain);
  const { cellMetres: c, originX, originZ, columns, rows, heights, bottom, ceiling } = terrain;
  for (let i = 0; i < heights.length; i++) {
    const top = heights[i]!;
    if (!Number.isInteger(top) || top * c <= bottom || top * c > ceiling) throw new CollisionCompileError('terrain column top is outside its vertical range');
  }
  const taken = new Uint8Array(columns * rows);
  let count = 0;
  for (let k = 0; k < rows; k++) for (let i = 0; i < columns; i++) {
    const at = i + columns * k;
    if (taken[at]) continue;
    const top = heights[at]!;
    let i1 = i + 1;
    while (i1 < columns && !taken[i1 + columns * k] && heights[i1 + columns * k] === top) i1++;
    let k1 = k + 1;
    widen: while (k1 < rows) {
      for (let ii = i; ii < i1; ii++) if (taken[ii + columns * k1] || heights[ii + columns * k1] !== top) break widen;
      k1++;
    }
    for (let kk = k; kk < k1; kk++) taken.fill(1, i + columns * kk, i1 + columns * kk);
    out.push(originX + i * c, footprint.bottom, originZ + k * c, originX + i1 * c, top * c, originZ + k1 * c);
    count++;
  }
  return count;
}
