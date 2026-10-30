import { HALO_VOLUME, haloIndex, type Vec3 } from './coordinates';
import { assertKnownMaterials, materialLookup, type MeshStamp, type VoxelMaterial } from './types';

export interface MeshChunkRequest {
  readonly stamp: MeshStamp;
  /** Padded 34³ material IDs, indexed from local coordinates -1..32. */
  readonly halo: Uint16Array;
  /** Padded 34³ static sky openness in 0..15, computed beyond this chunk's roof. */
  readonly sky: Uint8Array;
  readonly materials: readonly VoxelMaterial[];
}

export interface VoxelChunkMesh {
  readonly stamp: MeshStamp;
  readonly vertices: Uint32Array;
  readonly indices: Uint32Array;
  readonly quadCount: number;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 } | null;
}

/** Classic local voxel accessibility; a doubly enclosed corner never leaks diagonal light. */
export function cornerAccessibility(side1: boolean, side2: boolean, corner: boolean): number {
  return side1 && side2 ? 0 : 3 - Number(side1) - Number(side2) - Number(corner);
}

/** Both inputs must describe the same exact dependency set, including missing neighbours. */
export function sameMeshStamp(a: MeshStamp, b: MeshStamp): boolean {
  if (a.key !== b.key || a.revision !== b.revision || a.materialRevision !== b.materialRevision
    || a.dependencies.length !== b.dependencies.length) return false;
  const revisions = new Map(a.dependencies.map((dependency) => [dependency.key, dependency.revision]));
  if (revisions.size !== a.dependencies.length || new Set(b.dependencies.map(d => d.key)).size !== b.dependencies.length) return false;
  return b.dependencies.every((dependency) => revisions.has(dependency.key) && revisions.get(dependency.key) === dependency.revision);
}

/**
 * Greedy rectangles with baked corner AO and sky. A repeated corner tuple may extend
 * only along an axis where its values are constant, preserving interpolation exactly.
 * Materials add world-space grain in the renderer, without fracturing these rectangles.
 */
export function meshVoxelChunk(request: MeshChunkRequest): VoxelChunkMesh {
  if (request.halo.length !== HALO_VOLUME || request.sky.length !== HALO_VOLUME) {
    throw new Error('Meshing requires a complete 34³ material and sky halo.');
  }
  if (request.stamp.dependencies.some((dependency) => dependency.revision === null)) {
    throw new Error('Meshing waits for unavailable neighbours; unknown cells are not air.');
  }
  const lookup = materialLookup(request.materials);
  assertKnownMaterials(request.halo, lookup);
  for (const sky of request.sky) if (sky > 15) throw new Error('Sky openness must be in 0..15.');
  const vertices: number[] = [], indices: number[] = [];
  const materialMask = new Uint16Array(1024);
  const aoMask = new Uint8Array(1024);
  const skyMask = new Uint16Array(1024);
  const mergeMask = new Uint8Array(1024);
  const visibleRows = new Uint32Array(6 * 32 * 32);
  const activeSlices = new Uint8Array(6 * 32);
  const offsets = [1, -1, 34, -34, 34 * 34, -34 * 34];
  // Visit occupied cells once, then spend corner-shading work only on visible faces.
  for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const index = haloIndex(x, y, z), material = request.halo[index]!;
    if (!material) continue;
    for (let face = 0; face < 6; face++) {
      const neighbour = request.halo[index + offsets[face]!]!;
      if (lookup.faces[neighbour] || neighbour === material) continue;
      const axis = face >> 1;
      const slice = axis === 0 ? x : axis === 1 ? y : z;
      const column = axis === 0 ? y : axis === 1 ? z : x;
      const row = axis === 0 ? z : axis === 1 ? x : y;
      const rowIndex = (face * 32 + slice) * 32 + row;
      visibleRows[rowIndex] = visibleRows[rowIndex]! | (1 << column);
      activeSlices[face * 32 + slice] = 1;
    }
  }
  const low = [32, 32, 32], high = [0, 0, 0];
  const p = [0, 0, 0], q = [0, 0, 0], c = [0, 0, 0];
  const read = (point: number[]): number => request.halo[haloIndex(point[0]!, point[1]!, point[2]!)]!;
  const skyAt = (point: number[]): number => request.sky[haloIndex(point[0]!, point[1]!, point[2]!)]!;
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
    const sign = (face & 1) === 0 ? 1 : -1;
    for (let slice = 0; slice < 32; slice++) {
      if (!activeSlices[face * 32 + slice]) continue;
      materialMask.fill(0);
      mergeMask.fill(0);
      for (let j = 0; j < 32; j++) {
        let bits = visibleRows[(face * 32 + slice) * 32 + j]!;
        while (bits !== 0) {
        const i = 31 - Math.clz32(bits & -bits);
        bits = (bits & (bits - 1)) >>> 0;
        p[axis] = slice; p[u] = i; p[v] = j;
        const material = read(p);
        q[0] = p[0]!; q[1] = p[1]!; q[2] = p[2]!;
        q[axis] = slice + sign;
        let aoWord = 0, skyWord = 0;
        for (let corner = 0; corner < 4; corner++) {
          const du = corner === 1 || corner === 2 ? 1 : -1;
          const dv = corner >= 2 ? 1 : -1;
          c[0] = q[0]!; c[1] = q[1]!; c[2] = q[2]!;
          c[u] = q[u]! + du;
          const side1 = Boolean(lookup.ao[read(c)]);
          let sum = skyAt(q), samples = 1;
          if (!lookup.light[read(c)]) { sum += skyAt(c); samples++; }
          c[u] = q[u]!; c[v] = q[v]! + dv;
          const side2 = Boolean(lookup.ao[read(c)]);
          if (!lookup.light[read(c)]) { sum += skyAt(c); samples++; }
          c[u] = q[u]! + du;
          const diagonal = Boolean(lookup.ao[read(c)]);
          if (!lookup.light[read(c)] && !(side1 && side2)) { sum += skyAt(c); samples++; }
          aoWord |= cornerAccessibility(side1, side2, diagonal) << (corner * 2);
          skyWord |= Math.floor(sum / samples + 0.5) << (corner * 4);
        }
        const index = i + j * 32;
        materialMask[index] = material;
        aoMask[index] = aoWord;
        skyMask[index] = skyWord;
        const a0 = aoWord & 3, a1 = (aoWord >>> 2) & 3, a2 = (aoWord >>> 4) & 3, a3 = aoWord >>> 6;
        const s0 = skyWord & 15, s1 = (skyWord >>> 4) & 15, s2 = (skyWord >>> 8) & 15, s3 = skyWord >>> 12;
        const alongU = a0 === a1 && a2 === a3 && s0 === s1 && s2 === s3;
        const alongV = a0 === a3 && a1 === a2 && s0 === s3 && s1 === s2;
        mergeMask[index] = Number(alongU) | (Number(alongV) << 1);
        }
      }
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32;) {
        const index = i + j * 32, material = materialMask[index]!;
        if (!material) { i++; continue; }
        const aoWord = aoMask[index]!, skyWord = skyMask[index]!;
        const compatible = (x: number, y: number): boolean => {
          const other = x + y * 32;
          return materialMask[other] === material
            && aoMask[other] === aoWord && skyMask[other] === skyWord;
        };
        let width = 1, height = 1;
        if (mergeMask[index]! & 1) {
          while (i + width < 32 && compatible(i + width, j)) width++;
        }
        if (mergeMask[index]! & 2) {
          rows: while (j + height < 32) {
            for (let x = i; x < i + width; x++) if (!compatible(x, j + height)) break rows;
            height++;
          }
        }
        const base = vertices.length / 2;
        for (let corner = 0; corner < 4; corner++) {
          p[axis] = slice + (sign === 1 ? 1 : 0);
          p[u] = i + (corner === 1 || corner === 2 ? width : 0);
          p[v] = j + (corner >= 2 ? height : 0);
          const ao = (aoWord >>> (corner * 2)) & 3;
          const sky = (skyWord >>> (corner * 4)) & 15;
          vertices.push((p[0]! | (p[1]! << 6) | (p[2]! << 12) | (face << 18) | (ao << 21) | (sky << 23)) >>> 0, material);
          for (let dimension = 0; dimension < 3; dimension++) {
            low[dimension] = Math.min(low[dimension]!, p[dimension]!);
            high[dimension] = Math.max(high[dimension]!, p[dimension]!);
          }
        }
        const flip = (aoWord & 3) + ((aoWord >>> 4) & 3) > ((aoWord >>> 2) & 3) + ((aoWord >>> 6) & 3);
        const triangles = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
        for (let t = 0; t < 6; t += 3) {
          indices.push(base + triangles[t]!, base + triangles[t + (sign === 1 ? 1 : 2)]!, base + triangles[t + (sign === 1 ? 2 : 1)]!);
        }
        for (let y = j; y < j + height; y++) materialMask.fill(0, i + y * 32, i + width + y * 32);
        i += width;
      }
    }
  }
  return { stamp: request.stamp, vertices: Uint32Array.from(vertices), indices: Uint32Array.from(indices),
    quadCount: indices.length / 6,
    bounds: vertices.length === 0 ? null : { min: [low[0]!, low[1]!, low[2]!], max: [high[0]!, high[1]!, high[2]!] } };
}
