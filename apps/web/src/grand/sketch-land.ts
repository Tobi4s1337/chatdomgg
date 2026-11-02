import { GRAND_REGION, GRAND_VOXEL_METRES, type GrandLand } from '../../../../packages/world/src/grand/types';
import type { BakedSurface } from '../../../../packages/world/src/grand/baked/types';
import type { GrandBakedLand, GrandDrawnLand } from './engine';
import type { SketchLand } from './sketch-source';

/**
 * Signed distance to the coast in columns, clamped to ±127: positive inland, negative at sea, as the generator's
 * `coast` field (the sea's shallows and foam read it). From the verified surface: a column is sea where its ground
 * lies below the sea's surface. A two-pass chamfer transform, about a hundred milliseconds for a capital.
 */
export function coastField(surface: Pick<BakedSurface, 'size' | 'ground' | 'seaLevel'>): Int8Array {
  const { size, ground, seaLevel } = surface, n = size * size, cap = 127;
  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) sea[i] = ground[i]! <= seaLevel ? 1 : 0;
  const distance = (target: number): Float32Array => {
    // Distance from every column to the nearest column whose class is `target` (straight 1, diagonal √2).
    const d = new Float32Array(n).fill(cap);
    for (let i = 0; i < n; i++) if (sea[i] === target) d[i] = 0;
    const D = Math.SQRT2;
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const i = x + z * size;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (z > 0) {
        v = Math.min(v, d[i - size]! + 1);
        if (x > 0) v = Math.min(v, d[i - size - 1]! + D);
        if (x < size - 1) v = Math.min(v, d[i - size + 1]! + D);
      }
      d[i] = v;
    }
    for (let z = size - 1; z >= 0; z--) for (let x = size - 1; x >= 0; x--) {
      const i = x + z * size;
      let v = d[i]!;
      if (x < size - 1) v = Math.min(v, d[i + 1]! + 1);
      if (z < size - 1) {
        v = Math.min(v, d[i + size]! + 1);
        if (x < size - 1) v = Math.min(v, d[i + size + 1]! + D);
        if (x > 0) v = Math.min(v, d[i + size - 1]! + D);
      }
      d[i] = v;
    }
    return d;
  };
  const toSea = distance(1), toLand = distance(0), coast = new Int8Array(n);
  for (let i = 0; i < n; i++) coast[i] = sea[i] ? -Math.min(cap, Math.round(toLand[i]!)) : Math.min(cap, Math.max(1, Math.round(toSea[i]!)));
  return coast;
}

/** Separable box blur of a square field, `passes` times (three passes approach a gaussian). */
function blur(source: Float32Array, size: number, radius: number, passes: number): Float32Array {
  let a = Float32Array.from(source), b = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass++) for (let axis = 0; axis < 2; axis++) {
    for (let line = 0; line < size; line++) {
      let sum = 0, count = 0;
      const at = (k: number) => axis === 0 ? k + line * size : line + k * size;
      for (let k = 0; k <= Math.min(size - 1, radius); k++) { sum += a[at(k)]!; count++; }
      for (let k = 0; k < size; k++) {
        b[at(k)] = sum / count;
        const add = k + radius + 1, drop = k - radius;
        if (add < size) { sum += a[at(add)]!; count++; }
        if (drop >= 0) { sum -= a[at(drop)]!; count--; }
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * Sky occlusion from the surface, at the same radii and resolution as `skyOcclusionMap`. A sketch's canopy is in its
 * meshes, not in a tree table, so hollows are read from the ground and water alone.
 */
export function surfaceSkyMap(surface: Pick<BakedSurface, 'size' | 'ground' | 'water'>, step = 4): { data: Float32Array; size: number } {
  const size = Math.ceil(surface.size / step), top = new Float32Array(size * size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
      const sx = Math.min(surface.size - 1, x * step + dx), sz = Math.min(surface.size - 1, z * step + dz), i = sx + sz * surface.size;
      h += Math.max(surface.ground[i]!, surface.water[i]!);
    }
    top[x + z * size] = h / (step * step);
  }
  const small = blur(top, size, 2, 2), large = blur(top, size, 9, 2), data = new Float32Array(size * size * 2);
  for (let i = 0; i < size * size; i++) { data[i * 2] = small[i]! * GRAND_VOXEL_METRES; data[i * 2 + 1] = large[i]! * GRAND_VOXEL_METRES; }
  return { data, size };
}

/** The engine's view of a served sketch: the verified surface and record, and its meshes on request. */
export function sketchDrawnLand(sketch: SketchLand): GrandBakedLand {
  const { record, surface } = sketch;
  const land: GrandDrawnLand = {
    seed: record.recipe.seed, size: record.size, height: record.height, seaLevel: record.seaLevel,
    ground: surface.ground, water: surface.water, coast: coastField(surface),
    // The trees are voxels inside the region meshes; there is no separate table to draw or occlude with.
    trees: new Float32Array(0), treeCount: 0, sites: record.sites as GrandLand['sites'],
    structures: new Int32Array(0), structureCount: 0, stats: { solidVoxels: 0 },
  };
  const bounds = new Map<string, [number, number]>(), refs = new Map<string, (typeof record.meshes)[number]>();
  for (const ref of record.meshes) {
    refs.set(`${ref.rx},${ref.rz},${ref.level}`, ref);
    if (ref.maxY <= ref.minY) continue;
    const key = `${ref.rx},${ref.rz}`, scale = 1 << ref.level, span = bounds.get(key) ?? [Infinity, -Infinity];
    bounds.set(key, [Math.min(span[0], ref.minY * scale), Math.max(span[1], ref.maxY * scale)]);
  }
  if (record.size % GRAND_REGION) throw new Error('A sketch is made of whole regions');
  return {
    land, palette: record.palette, sky: surfaceSkyMap(surface), bounds,
    async mesh(level, rx, rz, signal) {
      const ref = refs.get(`${rx},${rz},${level}`);
      if (!ref) throw new Error('The sketch has no mesh for this region');
      const mesh = await sketch.mesh(ref, signal);
      return { quads: mesh.quads, offsets: mesh.offsets, minY: mesh.minY, maxY: mesh.maxY };
    },
  };
}
