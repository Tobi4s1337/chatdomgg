/**
 * Greedy meshing to eight-byte instanced quads for the grand land (one byte per voxel, 255 materials).
 *
 * A quad is two u32 words:
 *   word0 = x | y<<5 | z<<10 | (w-1)<<15 | (h-1)<<20 | face<<25 | flip<<28   (chunk-local cell, 5 bits each)
 *   word1 = material | ao<<8 | chunkSlot<<16                                 (ao: 4 corners × 2 bits)
 * Faces are +X,-X,+Y,-Y,+Z,-Z (0..5). For axis a the quad spans u = (a+1)%3 by w and v = (a+2)%3 by h;
 * corners run (0,0),(w,0),(w,h),(0,h). `flip` picks the 1-3 diagonal (0fps AO anisotropy fix).
 * Quads are written into six face buckets so a renderer can drop whole directions that face away.
 * At 8 bytes a quad (not 4 vertices of 16 bytes plus 6 indices), 20 M quads fit in 160 MB.
 *
 * Background: Lysenko, "Meshing in a Minecraft game" and "Ambient occlusion for Minecraft-like worlds"
 * (0fps.net); our own implementation.
 */
export const QUAD_PAD = 34;
export const QUAD_FLAG_EMIT = 1;
export const QUAD_FLAG_AO = 2;

export interface QuadBuckets {
  /** Quad words per face, each sized to its count × 2. */
  readonly faces: Uint32Array[];
  readonly counts: number[];
}

export function createQuadBuckets(initial = 4096): QuadBuckets {
  return { faces: Array.from({ length: 6 }, () => new Uint32Array(initial * 2)), counts: [0, 0, 0, 0, 0, 0] };
}

function push(buckets: QuadBuckets, face: number, a: number, b: number): void {
  let words = buckets.faces[face]!;
  const n = buckets.counts[face]!;
  if (n * 2 + 2 > words.length) {
    const grown = new Uint32Array(words.length * 2);
    grown.set(words);
    buckets.faces[face] = grown;
    words = grown;
  }
  words[n * 2] = a; words[n * 2 + 1] = b;
  buckets.counts[face] = n + 1;
}

/** Concatenate buckets into one buffer with seven offsets (in quads); transferable. */
export function packQuadBuckets(buckets: QuadBuckets): { quads: Uint32Array; offsets: Int32Array } {
  const total = buckets.counts.reduce((sum, n) => sum + n, 0);
  const quads = new Uint32Array(total * 2), offsets = new Int32Array(7);
  let at = 0;
  for (let f = 0; f < 6; f++) {
    offsets[f] = at;
    quads.set(buckets.faces[f]!.subarray(0, buckets.counts[f]! * 2), at * 2);
    at += buckets.counts[f]!;
  }
  offsets[6] = at;
  return { quads, offsets };
}

const S = [1, QUAD_PAD, QUAD_PAD * QUAD_PAD] as const;
const BASE = 1 + QUAD_PAD + QUAD_PAD * QUAD_PAD;
const keys = new Uint16Array(1024);
const merge = new Uint8Array(1024);

/**
 * Mesh one padded 34³ volume (x fastest, then y, then z) into the buckets. A face is drawn where an
 * emitting cell meets air; every non-air cell hides its neighbour's face (water and the hidden sea fill
 * included), and only cells flagged QUAD_FLAG_AO darken corners.
 */
export function meshQuadChunk(volume: Uint8Array, flags: Uint8Array, chunkSlot: number, buckets: QuadBuckets): number {
  if (volume.length !== QUAD_PAD ** 3) throw new Error('Quad meshing needs a 34³ padded volume.');
  let emitted = 0;
  const slotBits = (chunkSlot & 0xffff) << 16;
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
    const sign = (face & 1) === 0 ? 1 : -1;
    const sa = S[axis]!, su = S[u]!, sv = S[v]!, step = sign * sa;
    for (let d = 0; d < 32; d++) {
      let any = false;
      for (let j = 0; j < 32; j++) {
        const row = BASE + d * sa + j * sv;
        for (let i = 0; i < 32; i++) {
          const index = row + i * su;
          const m = volume[index]!;
          const k = i + j * 32;
          if (m === 0 || !(flags[m]! & QUAD_FLAG_EMIT) || volume[index + step]! !== 0) { keys[k] = 0; continue; }
          const q = index + step;
          const um = q - su, up = q + su, vm = q - sv, vp = q + sv;
          const oUm = (flags[volume[um]!]! & QUAD_FLAG_AO) !== 0, oUp = (flags[volume[up]!]! & QUAD_FLAG_AO) !== 0;
          const oVm = (flags[volume[vm]!]! & QUAD_FLAG_AO) !== 0, oVp = (flags[volume[vp]!]! & QUAD_FLAG_AO) !== 0;
          const c0 = (flags[volume[um - sv]!]! & QUAD_FLAG_AO) !== 0, c1 = (flags[volume[up - sv]!]! & QUAD_FLAG_AO) !== 0;
          const c2 = (flags[volume[up + sv]!]! & QUAD_FLAG_AO) !== 0, c3 = (flags[volume[um + sv]!]! & QUAD_FLAG_AO) !== 0;
          const a0 = oUm && oVm ? 0 : 3 - +oUm - +oVm - +c0;
          const a1 = oUp && oVm ? 0 : 3 - +oUp - +oVm - +c1;
          const a2 = oUp && oVp ? 0 : 3 - +oUp - +oVp - +c2;
          const a3 = oUm && oVp ? 0 : 3 - +oUm - +oVp - +c3;
          keys[k] = m | ((a0 | (a1 << 2) | (a2 << 4) | (a3 << 6)) << 8);
          merge[k] = (a0 === a1 && a3 === a2 ? 1 : 0) | (a0 === a3 && a1 === a2 ? 2 : 0);
          any = true;
        }
      }
      if (!any) continue;
      for (let j = 0; j < 32; j++) {
        for (let i = 0; i < 32;) {
          const k = i + j * 32, key = keys[k]!;
          if (key === 0) { i++; continue; }
          let w = 1, h = 1;
          if (merge[k]! & 1) while (i + w < 32 && keys[k + w] === key) w++;
          if (merge[k]! & 2) {
            outer: while (j + h < 32) {
              const row = k + h * 32;
              for (let x = 0; x < w; x++) if (keys[row + x] !== key) break outer;
              h++;
            }
          }
          for (let y = 0; y < h; y++) keys.fill(0, k + y * 32, k + y * 32 + w);
          const ao = key >>> 8;
          const flip = (ao & 3) + ((ao >>> 4) & 3) > ((ao >>> 2) & 3) + ((ao >>> 6) & 3) ? 1 : 0;
          const p = [0, 0, 0];
          p[axis] = d; p[u] = i; p[v] = j;
          push(buckets, face, (p[0]! | (p[1]! << 5) | (p[2]! << 10) | ((w - 1) << 15) | ((h - 1) << 20) | (face << 25) | (flip << 28)) >>> 0,
            ((key & 255) | ((ao & 255) << 8) | slotBits) >>> 0);
          emitted++;
          i += w;
        }
      }
    }
  }
  return emitted;
}

export interface UnpackedQuad { x: number; y: number; z: number; w: number; h: number; face: number; flip: number; material: number; ao: number; slot: number }
export function unpackQuad(a: number, b: number): UnpackedQuad {
  return { x: a & 31, y: (a >>> 5) & 31, z: (a >>> 10) & 31, w: ((a >>> 15) & 31) + 1, h: ((a >>> 20) & 31) + 1, face: (a >>> 25) & 7, flip: (a >>> 28) & 1,
    material: b & 255, ao: (b >>> 8) & 255, slot: b >>> 16 };
}
