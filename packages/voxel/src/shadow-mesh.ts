import type { VoxelMaterial } from '@chatdom/shared';
import { sameMeshStamp, type VoxelChunkMesh } from './mesh';
import type { AssetChunkMesh } from './protocol';
import { materialLookup } from './types';

/** Original 32³ voxel cells can emit at most six faces each. Reject before allocating output. */
export const MAX_SHADOW_SOURCE_QUADS = 6 * 32 ** 3;
/** Six orientations, 33 corner planes, 32 rows, one uint32 coverage mask per row. */
export const SHADOW_MASK_BYTES = 6 * 33 * 32 * 4;
const POSITIVE_TRIANGLES = [[0, 1, 2, 0, 2, 3], [0, 1, 3, 1, 2, 3]] as const;
const NEGATIVE_TRIANGLES = [[0, 2, 1, 0, 3, 2], [0, 3, 1, 1, 3, 2]] as const;
type Rect = { face: number; plane: number; u0: number; u1: number; v0: number; v1: number; material: number };
interface Context { readonly known: Uint8Array; readonly glass: Uint8Array; readonly rows: Uint32Array }

function context(materials: readonly VoxelMaterial[]): Context {
  const { known } = materialLookup(materials), glass = new Uint8Array(65536);
  for (const material of materials) if (material.surface === 'glass') glass[material.id] = 1;
  return { known, glass, rows: new Uint32Array(SHADOW_MASK_BYTES / 4) };
}
const rangeMask = (start: number, width: number): number => width === 32 ? 0xffffffff : ((2 ** width - 1) << start) >>> 0;
function fail(): never { throw new Error('Shadow merging requires an original packed voxel rectangle mesh'); }

/** Read only the source mesher's canonical four-corner rectangle layout. Never infer hidden faces. */
function rectangle(mesh: VoxelChunkMesh, q: number, ctx: Context, out: Rect, low: number[], high: number[]): void {
  const first = q * 8, word = mesh.vertices[first]!, material = mesh.vertices[first + 1]!;
  const face = (word >>> 18) & 7, axis = face >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
  if (face > 5 || !material || material > 65535 || !ctx.known[material]) fail();
  const at = (corner: number, dimension: number) => (mesh.vertices[first + corner * 2]! >>> (dimension * 6)) & 63;
  const plane = at(0, axis), u0 = at(0, u), v0 = at(0, v), u1 = at(1, u), v1 = at(2, v);
  if (!(u0 < u1 && v0 < v1) || plane < (face % 2 === 0 ? 1 : 0) || plane > (face % 2 === 0 ? 32 : 31)) fail();
  for (let c = 0; c < 4; c++) {
    const packed = mesh.vertices[first + c * 2]!;
    if (packed >>> 27 || ((packed >>> 18) & 7) !== face || mesh.vertices[first + c * 2 + 1] !== material
      || at(c, axis) !== plane || at(c, u) !== (c === 1 || c === 2 ? u1 : u0)
      || at(c, v) !== (c >= 2 ? v1 : v0)) fail();
    for (let d = 0; d < 3; d++) {
      const n = at(c, d);
      if (n > 32) fail();
      low[d] = Math.min(low[d]!, n); high[d] = Math.max(high[d]!, n);
    }
  }
  const triangles = face % 2 === 0 ? POSITIVE_TRIANGLES : NEGATIVE_TRIANGLES;
  if (!triangles.some(pattern => pattern.every((index, i) => mesh.indices[q * 6 + i] === q * 4 + index))) fail();
  Object.assign(out, { face, plane, u0, u1, v0, v1, material });
}
function paint(rows: Uint32Array, r: Rect): void {
  const mask = rangeMask(r.u0, r.u1 - r.u0), base = (r.face * 33 + r.plane) * 32;
  for (let row = r.v0; row < r.v1; row++) rows[base + row] = rows[base + row]! | mask;
}
type Emit = (face: number, plane: number, u: number, v: number, width: number, height: number) => void;
/** Deterministic integer-plane tiling. Clearing a mask bit can never fill a missing square. */
function tile(rows: Uint32Array, limit: number, emit?: Emit): number {
  let count = 0;
  for (let face = 0; face < 6; face++) for (let plane = 0; plane < 33; plane++) {
    const base = (face * 33 + plane) * 32;
    for (let v = 0; v < 32; v++) while (rows[base + v]) {
      const word = rows[base + v]!, u = 31 - Math.clz32(word & -word);
      let width = 1;
      while (u + width < 32 && (word & (1 << (u + width)))) width++;
      const mask = rangeMask(u, width);
      let height = 1;
      while (v + height < 32 && ((rows[base + v + height]! & mask) >>> 0) === mask) height++;
      for (let j = 0; j < height; j++) rows[base + v + j] = rows[base + v + j]! & ~mask;
      if (++count > limit) return count;
      emit?.(face, plane, u, v, width, height);
    }
  }
  return count;
}
function bounds(low: number[], high: number[], count: number): VoxelChunkMesh['bounds'] {
  return count ? { min: [low[0]!, low[1]!, low[2]!], max: [high[0]!, high[1]!, high[2]!] } : null;
}
function checkedRectangles(mesh: VoxelChunkMesh, ctx: Context, visit: (rect: Rect) => void): void {
  if (!Number.isInteger(mesh.quadCount) || mesh.quadCount < 0 || mesh.quadCount > MAX_SHADOW_SOURCE_QUADS
    || !(mesh.vertices instanceof Uint32Array) || !(mesh.indices instanceof Uint32Array)
    || mesh.vertices.length !== mesh.quadCount * 8 || mesh.indices.length !== mesh.quadCount * 6) fail();
  const rect: Rect = { face: 0, plane: 0, u0: 0, u1: 0, v0: 0, v1: 0, material: 0 };
  const low = [32, 32, 32], high = [0, 0, 0];
  for (let q = 0; q < mesh.quadCount; q++) {
    rectangle(mesh, q, ctx, rect, low, high);
    visit(rect);
  }
  if (!mesh.quadCount ? mesh.bounds !== null : !mesh.bounds || mesh.bounds.min.length !== 3 || mesh.bounds.max.length !== 3
    || mesh.bounds.min.some((n, d) => n !== low[d]) || mesh.bounds.max.some((n, d) => n !== high[d])) fail();
}
function compile(mesh: VoxelChunkMesh, ctx: Context): VoxelChunkMesh {
  ctx.rows.fill(0);
  let opaque = 0, representative = 0;
  checkedRectangles(mesh, ctx, rect => {
    if (ctx.glass[rect.material]) return;
    opaque++; representative ||= rect.material; paint(ctx.rows, rect);
  });

  const tiled = tile(ctx.rows, opaque), fallback = tiled > opaque, count = fallback ? opaque : tiled;
  const vertices = new Uint32Array(count * 8), indices = new Uint32Array(count * 6);
  const low = [32, 32, 32], high = [0, 0, 0];
  let written = 0;
  if (fallback) {
    // A greedy repartition can be worse than the source rectangles. Preserve those opaque rectangles instead.
    for (let q = 0; q < mesh.quadCount; q++) {
      if (ctx.glass[mesh.vertices[q * 8 + 1]!]) continue;
      vertices.set(mesh.vertices.subarray(q * 8, q * 8 + 8), written * 8);
      for (let i = 0; i < 6; i++) indices[written * 6 + i] = mesh.indices[q * 6 + i]! - q * 4 + written * 4;
      for (let c = 0; c < 4; c++) for (let d = 0; d < 3; d++) {
        const n = (mesh.vertices[q * 8 + c * 2]! >>> (d * 6)) & 63;
        low[d] = Math.min(low[d]!, n); high[d] = Math.max(high[d]!, n);
      }
      written++;
    }
  } else {
    ctx.rows.fill(0);
    const rect: Rect = { face: 0, plane: 0, u0: 0, u1: 0, v0: 0, v1: 0, material: 0 };
    // Refill the same 25 KiB mask instead of retaining a second source-sized array or growable JS output.
    for (let q = 0; q < mesh.quadCount; q++) {
      const word = mesh.vertices[q * 8]!, material = mesh.vertices[q * 8 + 1]!;
      if (ctx.glass[material]) continue;
      const face = (word >>> 18) & 7, axis = face >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
      rect.face = face; rect.plane = (word >>> (axis * 6)) & 63;
      rect.u0 = (word >>> (u * 6)) & 63; rect.v0 = (word >>> (v * 6)) & 63;
      rect.u1 = (mesh.vertices[q * 8 + 2]! >>> (u * 6)) & 63;
      rect.v1 = (mesh.vertices[q * 8 + 4]! >>> (v * 6)) & 63;
      paint(ctx.rows, rect);
    }
    const p = [0, 0, 0];
    tile(ctx.rows, count, (face, plane, x, y, width, height) => {
      const axis = face >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (let c = 0; c < 4; c++) {
        p[axis] = plane; p[u] = x + (c === 1 || c === 2 ? width : 0); p[v] = y + (c >= 2 ? height : 0);
        vertices[written * 8 + c * 2] = (p[0]! | (p[1]! << 6) | (p[2]! << 12) | (face << 18) | (3 << 21) | (15 << 23)) >>> 0;
        vertices[written * 8 + c * 2 + 1] = representative;
        for (let d = 0; d < 3; d++) { low[d] = Math.min(low[d]!, p[d]!); high[d] = Math.max(high[d]!, p[d]!); }
      }
      const pattern = face % 2 === 0 ? POSITIVE_TRIANGLES[0] : NEGATIVE_TRIANGLES[0];
      for (let i = 0; i < 6; i++) indices[written * 6 + i] = written * 4 + pattern[i]!;
      written++;
    });
  }
  return { stamp: mesh.stamp, vertices, indices, quadCount: written, bounds: bounds(low, high, written) };
}

/** Exact depth-only union of the ORIGINAL emitted opaque faces. Only static, undisplaced clay may opt in.
 * Glass follows the native sun caster's discard rule; hidden faces next to glass are never reconstructed. */
export function mergeOpaqueShadowChunk(mesh: VoxelChunkMesh, materials: readonly VoxelMaterial[]): VoxelChunkMesh {
  return compile(mesh, context(materials));
}

/** Reuses bounded plane scratch across chunks; one owned shadow mesh for every original chunk, including empty ones. */
export function createOpaqueShadowChunks(chunks: readonly AssetChunkMesh[], materials: readonly VoxelMaterial[]): readonly AssetChunkMesh[] {
  const ctx = context(materials);
  return chunks.map(({ coordinate, mesh }) => {
    if (coordinate.length !== 3 || coordinate.some(n => !Number.isInteger(n) || n < 0 || n > 31)) fail();
    return { coordinate: [coordinate[0], coordinate[1], coordinate[2]], mesh: compile(mesh, ctx) };
  });
}

/** Verify an untrusted worker's companion depth meshes against the actual returned color faces.
 * Shape/stamps alone cannot detect an empty shadow or a moved opening. Paint the original opaque union,
 * consume every target rectangle exactly once, and require no remaining squares. No occupancy is inferred.
 * Linear in input/output faces (at most 32 row operations per rectangle); scratch is reused across chunks. */
export function assertExactOpaqueShadowChunks(source: readonly AssetChunkMesh[], shadow: readonly AssetChunkMesh[], materials: readonly VoxelMaterial[]): void {
  if (source.length !== shadow.length || source.length > 32 ** 3) fail();
  const ctx = context(materials), seen = new Uint8Array(32 ** 3);
  for (let i = 0; i < source.length; i++) {
    const original = source[i]!, target = shadow[i]!, coordinate = original.coordinate;
    if (coordinate.length !== 3 || target.coordinate.length !== 3
      || coordinate.some((n, d) => !Number.isInteger(n) || n < 0 || n > 31 || target.coordinate[d] !== n)
      || !sameMeshStamp(original.mesh.stamp, target.mesh.stamp)) fail();
    const key = coordinate[0] | (coordinate[1] << 5) | (coordinate[2] << 10);
    if (seen[key]) fail();
    seen[key] = 1; ctx.rows.fill(0);
    let opaque = 0;
    checkedRectangles(original.mesh, ctx, rect => {
      if (ctx.glass[rect.material]) return;
      opaque++; paint(ctx.rows, rect);
    });
    if (target.mesh.quadCount > opaque) fail();
    checkedRectangles(target.mesh, ctx, rect => {
      if (ctx.glass[rect.material]) fail();
      const mask = rangeMask(rect.u0, rect.u1 - rect.u0), base = (rect.face * 33 + rect.plane) * 32;
      for (let row = rect.v0; row < rect.v1; row++) {
        if (((ctx.rows[base + row]! & mask) >>> 0) !== mask) fail();
        ctx.rows[base + row] = ctx.rows[base + row]! & ~mask;
      }
    });
    if (ctx.rows.some(word => word !== 0)) fail();
  }
}
