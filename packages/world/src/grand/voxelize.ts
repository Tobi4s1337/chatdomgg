import { GrandKind, M, kindTable, STRATA_COUNT } from './palette';
import { hash2, hash3, simplex2, type Noise2 } from './noise';
import { GRAND_KITS, landMaterials } from './kits';
import { Cover, GRAND_CHUNK, STRUCTURE_STRIDE, TREE_SPECIES, TREE_STRIDE, type GrandLand, type TreeShape } from './types';

const treeExtent = GRAND_KITS.trees.extent, generateTreeShape = GRAND_KITS.trees.shape;

/** Padded chunk volume: 34³ cells, x fastest, then y, then z; local -1..32 maps to 0..33. */
export const PAD = GRAND_CHUNK + 2;
export const PAD_VOLUME = PAD * PAD * PAD;
export const padIndex = (x: number, y: number, z: number): number => (x + 1) + (y + 1) * PAD + (z + 1) * PAD * PAD;

export interface VoxelizeContext {
  readonly land: GrandLand;
  readonly kinds: Uint8Array;
  readonly strataWarp: Noise2;
  readonly patch: Noise2;
  readonly bloom: Noise2;
  /** Tree indices per 64-column bucket. */
  readonly buckets: Int32Array[];
  readonly bucketWidth: number;
  /** Structure box indices per 64-column bucket. */
  readonly structureBuckets: Int32Array[];
  readonly cache: Map<number, TreeShape>;
  readonly cacheLimit: number;
  readonly best: Int16Array;
  treeVoxels: number;
}

const BUCKET = 64;

export function createVoxelizeContext(land: GrandLand, cacheLimit = 1800): VoxelizeContext {
  const seed = hashSeed(`grand-voxels/${land.seed.seedKey}`);
  const bw = Math.ceil(land.size / BUCKET);
  const lists: number[][] = Array.from({ length: bw * bw }, () => []);
  for (let t = 0; t < land.treeCount; t++) {
    const o = t * TREE_STRIDE;
    const x = land.trees[o]!, z = land.trees[o + 1]!, species = TREE_SPECIES[land.trees[o + 3]!]!, scale = land.trees[o + 5]!;
    const r = treeExtent(species, scale).radius + 3;
    for (let bz = Math.max(0, Math.floor((z - r) / BUCKET)); bz <= Math.min(bw - 1, Math.floor((z + r) / BUCKET)); bz++) {
      for (let bx = Math.max(0, Math.floor((x - r) / BUCKET)); bx <= Math.min(bw - 1, Math.floor((x + r) / BUCKET)); bx++) lists[bx + bz * bw]!.push(t);
    }
  }
  const boxes: number[][] = Array.from({ length: bw * bw }, () => []);
  for (let b = 0; b < land.structureCount; b++) {
    const o = b * STRUCTURE_STRIDE, s = land.structures;
    for (let bz = Math.floor(s[o + 2]! / BUCKET); bz <= Math.min(bw - 1, Math.floor((s[o + 5]! - 1) / BUCKET)); bz++) {
      for (let bx = Math.floor(s[o]! / BUCKET); bx <= Math.min(bw - 1, Math.floor((s[o + 3]! - 1) / BUCKET)); bx++) boxes[bx + bz * bw]!.push(b);
    }
  }
  return {
    structureBuckets: boxes.map(list => Int32Array.from(list)),
    land, kinds: kindTable(landMaterials(land)), strataWarp: simplex2(seed ^ 0x6001), patch: simplex2(seed ^ 0x6002), bloom: simplex2(seed ^ 0x6003),
    buckets: lists.map(list => Int32Array.from(list)), bucketWidth: bw, cache: new Map(), cacheLimit, best: new Int16Array(PAD_VOLUME), treeVoxels: 0,
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * A tree's voxel shape. Full detail and ×2 use the tree's own seed; at ×4 and ×8 (2–4 m cells) the seed no
 * longer shows, so trees share one shape per species and scale step and keep their silhouette and coverage.
 */
function treeShape(ctx: VoxelizeContext, t: number, level: number): TreeShape {
  const o = t * TREE_STRIDE, trees = ctx.land.trees, species = trees[o + 3]!, scale = trees[o + 5]!;
  const shared = level >= 2, step = Math.round(scale * 10);
  const key = shared ? -1 - (species * 64 + step) : t;
  const hit = ctx.cache.get(key);
  if (hit) { ctx.cache.delete(key); ctx.cache.set(key, hit); return hit; }
  const shape = shared ? generateTreeShape(TREE_SPECIES[species]!, 0x9e3779b1 ^ species, step / 10) : generateTreeShape(TREE_SPECIES[species]!, trees[o + 4]! >>> 0, scale);
  ctx.cache.set(key, shape);
  if (!shared) ctx.treeVoxels += shape.count;
  if (ctx.cache.size > ctx.cacheLimit) ctx.cache.delete(ctx.cache.keys().next().value!);
  return shape;
}

/** Height of decoration above the ground (crops, hedges, flowers, tufts) and its material by step. */
function decorHeight(ctx: VoxelizeContext, i: number, x: number, z: number): number {
  const land = ctx.land, cover = land.cover[i]!;
  if (land.water[i]! > land.ground[i]!) return 0;
  if (cover === Cover.field) {
    const p = land.plots[land.plot[i]! - 1];
    if (!p) return 0;
    const c = p.crop, row = p.rows === 0 ? z : x, along = p.rows === 0 ? x : z;
    if (c === M.crop.ploughed) return 0;
    if (c === M.crop.rapeseed || c === M.crop.flax) return 1;
    if (c === M.crop.cabbage || c === M.crop.pumpkin) return row % 3 !== 0 && along % 3 === 1 ? 1 : 0;
    if (c === M.crop.sunflower) return row % 3 === 1 ? (along % 2 === 0 ? 3 : 2) : 0;
    if (c === M.crop.hay) return hash2(x >> 2, z >> 2, 77) < 0.08 && (x & 3) < 2 && (z & 3) < 2 ? 2 : 0;
    return row % 3 !== 0 ? 1 : 0;
  }
  if (cover === Cover.hedge) return hash2(x >> 1, z >> 1, 91) < 0.82 ? 2 + (hash2(x, z, 92) < 0.3 ? 1 : 0) : 0;
  if (cover === Cover.meadow || cover === Cover.grass || cover === Cover.reserved) {
    const h = hash2(x, z, 0x51);
    const density = cover === Cover.meadow ? 0.06 : cover === Cover.reserved ? 0.008 : 0.016;
    if (h < density) return 1;
  }
  if (cover === Cover.forest && hash2(x, z, 0x52) < 0.025) return 1;
  return 0;
}

function decorMaterial(ctx: VoxelizeContext, i: number, x: number, z: number, step: number): number {
  const land = ctx.land, cover = land.cover[i]!;
  if (cover === Cover.field) {
    const p = land.plots[land.plot[i]! - 1]!;
    const c = p.crop, row = p.rows === 0 ? z : x;
    if (c === M.crop.lavender) return (row / 3 | 0) % 2 ? M.crop.lavender : M.crop.lavenderDark;
    if (c === M.crop.wheat) return hash2(x >> 3, z >> 3, 31) < 0.3 ? M.crop.wheatPale : M.crop.wheat;
    if (c === M.crop.sunflower) return step >= 1 && step === decorHeight(ctx, i, x, z) - 1 ? M.crop.sunflowerHead : M.crop.sunflower;
    if (c === M.crop.cabbage) return M.crop.cabbage;
    return c;
  }
  if (cover === Cover.hedge) return M.leaf.hedge + Math.min(3, step + 1);
  if (cover === Cover.forest) return M.leaf.hedge + 1;
  // Flowers grow in drifts: one colour holds a patch, with a few strays.
  const h = hash2(x, z, 0x53);
  if (cover !== Cover.meadow && h < 0.5) return M.grass[2];
  const drift = ctx.bloom(x / 34, z / 34);
  const flowers = [M.flower.poppy, M.flower.buttercup, M.flower.daisy, M.flower.cornflower, M.flower.violet, M.flower.pink, M.flower.marigold];
  const pick = h < 0.82 ? Math.floor((drift * 0.5 + 0.5) * 6.99) : Math.floor(h * 1000) % 7;
  return flowers[pick]!;
}

function strata(ctx: VoxelizeContext, x: number, y: number, z: number, warp: number): number {
  const band = Math.floor((y + warp + 0.035 * x - 0.022 * z) / 3);
  return M.strata + (((band % STRATA_COUNT) + STRATA_COUNT) % STRATA_COUNT);
}

/** The material of terrain cell y in column i (y below ground). */
function terrainMaterial(ctx: VoxelizeContext, i: number, x: number, z: number, y: number, warp: number): number {
  const land = ctx.land, top = land.ground[i]! - 1, depth = top - y, cover = land.cover[i]!;
  switch (cover) {
    case Cover.sea: return depth < 3 ? M.sand : strata(ctx, x, y, z, warp);
    case Cover.sand: return depth < 4 ? (depth === 0 && y <= land.seaLevel ? M.sandWet : M.sand) : strata(ctx, x, y, z, warp);
    case Cover.shingle: return depth < 2 ? M.shingle : strata(ctx, x, y, z, warp);
    case Cover.rock: case Cover.cliff: {
      if (depth === 0) {
        const p = Math.min(1, Math.max(0, (y - land.snowline + 38) / 50));
        if (hash3(x, y, z, 0x71) < p * 0.85) return M.snow;
      }
      return strata(ctx, x, y, z, warp);
    }
    case Cover.scree: return depth === 0 ? (hash2(x >> 1, z >> 1, 0x72) < 0.5 ? M.scree : strata(ctx, x, y, z, warp)) : strata(ctx, x, y, z, warp);
    case Cover.snow: return depth < 2 ? (depth === 0 ? M.snow : M.snowShade) : strata(ctx, x, y, z, warp);
    case Cover.riverbed: case Cover.lakebed: {
      if (depth > 2) return strata(ctx, x, y, z, warp);
      const shallow = land.water[i]! - land.ground[i]! < 2;
      return shallow || cover === Cover.lakebed && hash2(x >> 2, z >> 2, 0x73) < 0.5 ? M.sand : M.riverbed;
    }
    case Cover.field: {
      if (depth === 0) {
        const p = land.plots[land.plot[i]! - 1];
        if (p) {
          const row = p.rows === 0 ? z : x;
          if (p.crop === M.crop.ploughed) return row % 2 ? M.crop.ploughed : M.crop.furrow;
          if (p.crop === M.crop.hay) return M.crop.hay;
          return row % 3 === 0 ? M.crop.furrow : M.crop.ploughed;
        }
      }
      return depth < 4 ? M.dirt : strata(ctx, x, y, z, warp);
    }
    default: {
      // Grass, meadow, forest, hedge and reserved ground. The top two cells stay green so a one-voxel step
      // reads as a grassy slope, not a dirt stair.
      if (depth <= 1) {
        if (cover === Cover.forest) return M.forestFloor;
        const patch = ctx.patch(x / 52, z / 52) * 0.5 + 0.5;
        if (cover === Cover.meadow) return patch > 0.5 ? M.meadow[0] : M.meadow[1];
        return M.grass[Math.min(3, Math.floor(patch * 3.4))]!;
      }
      return depth < 5 ? (depth < 3 ? M.dirt : M.dirtDark) : strata(ctx, x, y, z, warp);
    }
  }
}

export interface ChunkRange { readonly lo: number; readonly hi: number }

/**
 * The span of visible coarse cells (inclusive lo, exclusive hi) for a chunk column at a level: cells
 * below every neighbour's surface are buried, so whole chunks under the land are never voxelised.
 */
export function chunkColumnRange(ctx: VoxelizeContext, level: number, cx: number, cz: number): ChunkRange {
  const s = 1 << level, land = ctx.land, size = land.size;
  const x0 = cx * GRAND_CHUNK * s, z0 = cz * GRAND_CHUNK * s, span = GRAND_CHUNK * s;
  let lo = 1e9, hi = 0;
  const surface = (x: number, z: number) => {
    const i = Math.min(size - 1, Math.max(0, x)) + Math.min(size - 1, Math.max(0, z)) * size;
    return Math.max(land.ground[i]!, land.water[i]!);
  };
  for (let z = z0 - s; z < z0 + span + s; z += 1) for (let x = x0 - s; x < x0 + span + s; x += 1) {
    if (x < 0 || z < 0 || x >= size || z >= size) { lo = Math.min(lo, land.seaLevel); continue; }
    const here = surface(x, z);
    if (here > hi) hi = here;
    if (x >= x0 && z >= z0 && x < x0 + span && z < z0 + span) {
      const low = Math.min(here, surface(x + s, z), surface(x - s, z), surface(x, z + s), surface(x, z - s));
      if (low < lo) lo = low;
    }
  }
  hi += 4;
  // Trees reach above the ground.
  const bw = ctx.bucketWidth;
  for (let bz = Math.max(0, Math.floor(z0 / BUCKET)); bz <= Math.min(bw - 1, Math.floor((z0 + span) / BUCKET)); bz++) {
    for (let bx = Math.max(0, Math.floor(x0 / BUCKET)); bx <= Math.min(bw - 1, Math.floor((x0 + span) / BUCKET)); bx++) {
      for (const t of ctx.buckets[bx + bz * bw]!) {
        const o = t * TREE_STRIDE, tx = land.trees[o]!, tz = land.trees[o + 1]!;
        const e = treeExtent(TREE_SPECIES[land.trees[o + 3]!]!, land.trees[o + 5]!);
        if (tx + e.radius + 2 < x0 || tx - e.radius - 2 > x0 + span || tz + e.radius + 2 < z0 || tz - e.radius - 2 > z0 + span) continue;
        hi = Math.max(hi, land.trees[o + 2]! + e.height + 4);
      }
    }
  }
  for (let bz = Math.max(0, Math.floor(z0 / BUCKET)); bz <= Math.min(bw - 1, Math.floor((z0 + span) / BUCKET)); bz++) {
    for (let bx = Math.max(0, Math.floor(x0 / BUCKET)); bx <= Math.min(bw - 1, Math.floor((x0 + span) / BUCKET)); bx++) {
      for (const b of ctx.structureBuckets[bx + bz * bw]!) {
        const o = b * STRUCTURE_STRIDE, st = land.structures;
        if (st[o + 3]! <= x0 - s || st[o]! >= x0 + span + s || st[o + 5]! <= z0 - s || st[o + 2]! >= z0 + span + s) continue;
        hi = Math.max(hi, st[o + 4]! + 1);
      }
    }
  }
  return { lo: Math.floor((lo - 2) / s), hi: Math.ceil(hi / s) + 1 };
}

export interface VoxelizeOptions {
  /** Coarse-unit bounds [x0, z0, x1, z1) outside which halo cells read as air (LOD skirts). */
  readonly skirt?: readonly [number, number, number, number];
}

/**
 * Fill a padded chunk volume at a level. Level 0 is the source; level l cells are 2^l source voxels and
 * take the material of the top-most source voxel they contain (surface priority), so far mountains keep
 * their snow and far forests keep their canopy colour. Returns the number of solid cells written.
 */
export function voxelizeChunk(ctx: VoxelizeContext, level: number, cx: number, cy: number, cz: number, out: Uint8Array, options: VoxelizeOptions = {}): number {
  const land = ctx.land, size = land.size, s = 1 << level, sea = land.seaLevel;
  const X0 = cx * GRAND_CHUNK - 1, Y0 = cy * GRAND_CHUNK - 1, Z0 = cz * GRAND_CHUNK - 1;
  const seaC = Math.round(sea / s);
  out.fill(0);
  const best = ctx.best;
  best.fill(-32768);
  const skirt = options.skirt;
  let solid = 0;
  for (let hz = 0; hz < PAD; hz++) for (let hx = 0; hx < PAD; hx++) {
    const X = X0 + hx, Z = Z0 + hz;
    if (skirt && (X < skirt[0] || Z < skirt[1] || X >= skirt[2] || Z >= skirt[3])) continue;
    const column = hx + hz * PAD * PAD;
    if (X < 0 || Z < 0 || X * s >= size || Z * s >= size) {
      for (let hy = 0; hy < PAD; hy++) { const Y = Y0 + hy; if (Y >= 0 && Y < seaC) out[column + hy * PAD] = M.sea; }
      continue;
    }
    // Source column: the highest top in the block (ground plus decoration).
    let src = X * s + Z * s * size, top = 0, waterTop = 0, sx = X * s, sz = Z * s;
    for (let bz = 0; bz < s; bz++) for (let bx = 0; bx < s; bx++) {
      const x = X * s + bx, z = Z * s + bz;
      if (x >= size || z >= size) continue;
      const i = x + z * size;
      const t = land.ground[i]! + (land.cover[i] === Cover.sea ? 0 : decorHeight(ctx, i, x, z));
      if (t > top) { top = t; src = i; sx = x; sz = z; }
      if (land.water[i]! > waterTop) waterTop = land.water[i]!;
    }
    const ground = land.ground[src]!;
    const topC = Math.ceil(top / s);
    const waterC = waterTop > 0 ? Math.round(waterTop / s) : 0;
    // Below the sea plane everything not solid is hidden fill: the seabed under open sea is never meshed.
    const surfaceC = Math.max(topC, waterC, seaC);
    const hidden = waterTop > 0 && waterTop <= sea;
    const warp = 7 * ctx.strataWarp(sx / 90, sz / 90);
    for (let hy = 0; hy < PAD; hy++) {
      const Y = Y0 + hy;
      if (Y < 0 || Y >= surfaceC) continue;
      const index = column + hy * PAD;
      if (Y < topC) {
        const y = Math.min(Y * s + s - 1, top - 1);
        out[index] = y >= ground ? decorMaterial(ctx, src, sx, sz, y - ground) : terrainMaterial(ctx, src, sx, sz, y, warp);
        best[index] = y;
        solid++;
      } else {
        out[index] = hidden || Y < seaC ? M.sea : M.water;
      }
    }
  }
  // Structures: placed kit boxes replace terrain; a coarse cell is built if any of its source cells is.
  {
    const bw = ctx.bucketWidth, st = land.structures, seen = new Set<number>();
    const x0 = X0 * s, z0 = Z0 * s, span = PAD * s;
    for (let bz = Math.max(0, Math.floor(z0 / BUCKET)); bz <= Math.min(bw - 1, Math.floor((z0 + span) / BUCKET)); bz++) {
      for (let bx = Math.max(0, Math.floor(x0 / BUCKET)); bx <= Math.min(bw - 1, Math.floor((x0 + span) / BUCKET)); bx++) {
        for (const b of ctx.structureBuckets[bx + bz * bw]!) {
          if (seen.has(b)) continue;
          seen.add(b);
          const o = b * STRUCTURE_STRIDE;
          const lx0 = Math.max(0, Math.floor(st[o]! / s) - X0), lx1 = Math.min(PAD, Math.ceil(st[o + 3]! / s) - X0);
          const ly0 = Math.max(0, Math.floor(st[o + 1]! / s) - Y0), ly1 = Math.min(PAD, Math.ceil(st[o + 4]! / s) - Y0);
          const lz0 = Math.max(0, Math.floor(st[o + 2]! / s) - Z0), lz1 = Math.min(PAD, Math.ceil(st[o + 5]! / s) - Z0);
          const material = st[o + 6]!;
          for (let lz = lz0; lz < lz1; lz++) for (let lx = lx0; lx < lx1; lx++) {
            if (skirt) { const X = lx + X0, Z = lz + Z0; if (X < skirt[0] || Z < skirt[1] || X >= skirt[2] || Z >= skirt[3]) continue; }
            for (let ly = ly0; ly < ly1; ly++) {
              const index = lx + ly * PAD + lz * PAD * PAD;
              if (out[index] === 0) solid++;
              out[index] = material;
              best[index] = (ly + Y0) * s + s - 1;
            }
          }
        }
      }
    }
  }
  // Trees: stamp every overlapping tree's voxels, bark over leaf, higher voxels over lower in a coarse cell.
  const sx0 = X0 * s, sz0 = Z0 * s, sy0 = Y0 * s, sspan = PAD * s;
  const bw = ctx.bucketWidth, kinds = ctx.kinds, trees = land.trees;
  const seen = new Set<number>();
  for (let bz = Math.max(0, Math.floor(sz0 / BUCKET)); bz <= Math.min(bw - 1, Math.floor((sz0 + sspan) / BUCKET)); bz++) {
    for (let bx = Math.max(0, Math.floor(sx0 / BUCKET)); bx <= Math.min(bw - 1, Math.floor((sx0 + sspan) / BUCKET)); bx++) {
      for (const t of ctx.buckets[bx + bz * bw]!) {
        if (seen.has(t)) continue;
        seen.add(t);
        const o = t * TREE_STRIDE, tx = trees[o]!, tz = trees[o + 1]!, ty = trees[o + 2]!;
        const e = treeExtent(TREE_SPECIES[trees[o + 3]!]!, trees[o + 5]!);
        if (tx + e.radius + 4 < sx0 || tx - e.radius - 4 >= sx0 + sspan || tz + e.radius + 4 < sz0 || tz - e.radius - 4 >= sz0 + sspan) continue;
        if (ty + e.height + 6 < sy0 || ty - 6 >= sy0 + sspan) continue;
        const shape = treeShape(ctx, t, level);
        if (tx + shape.max[0] < sx0 || tx + shape.min[0] >= sx0 + sspan || tz + shape.max[2] < sz0 || tz + shape.min[2] >= sz0 + sspan
          || ty + shape.max[1] < sy0 || ty + shape.min[1] >= sy0 + sspan) continue;
        for (let v = 0; v < shape.count; v++) {
          const gx = tx + shape.dx[v]!, gy = ty + shape.dy[v]!, gz = tz + shape.dz[v]!;
          const lx = Math.floor(gx / s) - X0, ly = Math.floor(gy / s) - Y0, lz = Math.floor(gz / s) - Z0;
          if (lx < 0 || ly < 0 || lz < 0 || lx >= PAD || ly >= PAD || lz >= PAD) continue;
          if (skirt) { const X = lx + X0, Z = lz + Z0; if (X < skirt[0] || Z < skirt[1] || X >= skirt[2] || Z >= skirt[3]) continue; }
          const index = lx + ly * PAD + lz * PAD * PAD;
          const material = shape.material[v]!, existing = out[index]!;
          if (existing === 0) { out[index] = material; best[index] = gy; solid++; continue; }
          const existingKind = kinds[existing]!;
          if (existingKind === GrandKind.water) continue;
          if (s === 1) {
            if (existingKind === GrandKind.leaf && (kinds[material] === GrandKind.bark || kinds[material] === GrandKind.leaf)) out[index] = material;
          } else if (gy > best[index]!) { out[index] = material; best[index] = gy; }
        }
      }
    }
  }
  return solid;
}

export { TREE_SPECIES };
