import { blur } from './distance';
import { GRAND_KITS } from './kits';
import { TREE_SPECIES, TREE_STRIDE, GRAND_VOXEL_METRES, type GrandLand } from './types';

/**
 * Large-scale sky occlusion as a height field: the surface and canopy tops, blurred at two radii. A surface
 * below its blurred neighbourhood sits in a hollow (a valley, a forest floor, a street between roofs) and
 * sees less sky. Two RG channels in metres at quarter resolution; the shader compares its own height.
 */
export function skyOcclusionMap(land: GrandLand, step = 4): { data: Float32Array; size: number } {
  const size = Math.ceil(land.size / step), top = new Float32Array(size * size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
      const sx = Math.min(land.size - 1, x * step + dx), sz = Math.min(land.size - 1, z * step + dz), i = sx + sz * land.size;
      h += Math.max(land.ground[i]!, land.water[i]!);
    }
    top[x + z * size] = h / (step * step);
  }
  for (let t = 0; t < land.treeCount; t++) {
    const o = t * TREE_STRIDE;
    const e = GRAND_KITS.trees.extent(TREE_SPECIES[land.trees[o + 3]!]!, land.trees[o + 5]!);
    const crown = land.trees[o + 2]! + e.height * 0.8, r = e.radius * 0.85 / step;
    const cx = land.trees[o]! / step, cz = land.trees[o + 1]! / step;
    for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(size - 1, Math.ceil(cz + r)); z++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(size - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > r * r) continue;
        const i = x + z * size;
        if (crown > top[i]!) top[i] = crown;
      }
    }
  }
  const small = blur(top, size, 2, 2), large = blur(top, size, 9, 2);
  const data = new Float32Array(size * size * 2);
  for (let i = 0; i < size * size; i++) { data[i * 2] = small[i]! * GRAND_VOXEL_METRES; data[i * 2 + 1] = large[i]! * GRAND_VOXEL_METRES; }
  return { data, size };
}
