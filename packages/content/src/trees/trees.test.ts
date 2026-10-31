import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../voxel/src/index';
import { createRenderLodAsset } from '../../../voxel/src/lod';
import { MAT, MATERIALS, STYLES } from '../materials';
import { allPictureTrees, createPictureTree, selectTree, TREE_LIMITS, TREE_SPECIES, TREE_STYLES, TREE_VARIANTS, treeBlueprints, treeId } from './index';
import { rng, Sculpt } from './sculpt';
import { GROWERS } from './species';

const trees = allPictureTrees();
/** Flora palette: natural greens and golds, bark, earth, birch white, and any kit's stone for deadwood and marks. */
const PALETTE = new Set<number>([MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.grass, MAT.goldLeaf, MAT.cream, MAT.thatch, ...Object.values(STYLES).map(kit => kit.stone)]);
const FOLIAGE = new Set<number>([MAT.leaf, MAT.moss, MAT.grass, MAT.goldLeaf, MAT.thatch]);

function triangles(asset: VoxelAsset): number {
  let count = 0;
  for (const prepared of prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)) count += meshVoxelChunk(prepared).indices.length / 3;
  return count;
}

/** Occupied cells with no face path to y=0. */
function floating(asset: VoxelAsset): number {
  const [sx, sy, sz] = asset.size, seen = new Uint8Array(asset.voxels.length), queue: number[] = [];
  let occupied = 0;
  for (let i = 0; i < asset.voxels.length; i++) if (asset.voxels[i]) occupied++;
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) { const i = x + sx * sy * z; if (asset.voxels[i]) { seen[i] = 1; queue.push(i); } }
  let reached = queue.length;
  while (queue.length) {
    const i = queue.pop()!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1, z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
      if (n >= 0 && !seen[n] && asset.voxels[n]) { seen[n] = 1; reached++; queue.push(n); }
    }
  }
  return occupied - reached;
}

describe('picture trees', () => {
  it('grows every species in every kit with its variants, under stable unique ids', () => {
    expect(trees).toHaveLength(TREE_STYLES.length * TREE_SPECIES.reduce((n, s) => n + TREE_VARIANTS[s], 0));
    expect(new Set(trees.map(t => t.id)).size).toBe(trees.length);
    for (const tree of trees) {
      expect(tree.id).toBe(treeId(tree.species, tree.style, tree.variant));
      expect(tree.id).toMatch(/^tree-(oak|pine|birch|willow|elder)-(hearth|tide|grove)-\d$/);
      expect(tree.blueprint.id).toBe(tree.id);
      expect(tree.blueprint.styleId).toBe(STYLES[tree.style].id);
    }
    expect(treeBlueprints().map(b => b.id)).toEqual(trees.map(t => t.id));
  });

  it('is a strict blueprint in the flora palette, within the lane budgets', () => {
    for (const { blueprint, species } of trees) {
      expect(VoxelBlueprintSchema.parse(blueprint)).toEqual(blueprint);
      expect(blueprint.kind).toBe('flora');
      expect(blueprint.lattice).toBe('build');
      expect(blueprint.windows).toEqual([]);
      expect(Object.keys(blueprint).sort()).toEqual(['boxes', 'id', 'kind', 'lattice', 'size', 'styleId', 'version', 'windows']);
      blueprint.size.forEach((v, axis) => expect(v, blueprint.id).toBeLessThanOrEqual(TREE_LIMITS[species][axis]!));
      expect(blueprint.size[0] % 8, 'footprint keeps LOD 4 blocks whole around the trunk').toBe(0);
      expect(blueprint.size[0]).toBe(blueprint.size[2]);
      expect(blueprint.boxes.length, blueprint.id).toBeLessThanOrEqual(2000);
      for (const box of blueprint.boxes) expect(PALETTE.has(box.material), `${blueprint.id} material ${box.material}`).toBe(true);
    }
  });

  it('writes every cell exactly once, grounded and connected, meshing within its triangle budget', () => {
    for (const { blueprint, species } of trees) {
      const asset = rasterizeBlueprint(blueprint);
      const volume = blueprint.boxes.reduce((n, b) => n + (b.to[0] - b.from[0]) * (b.to[1] - b.from[1]) * (b.to[2] - b.from[2]), 0);
      expect(asset.voxels.reduce((n, v) => n + (v ? 1 : 0), 0), `${blueprint.id} boxes overlap`).toBe(volume);
      expect(floating(asset), `${blueprint.id} floats`).toBe(0);
      expect(triangles(asset), blueprint.id).toBeLessThanOrEqual(species === 'elder' ? 40_000 : 24_000);
    }
  }, 120_000);

  it('stands its trunk on the centre of the footprint and keeps a crown of leaves above it', () => {
    for (const { blueprint, root, canopy } of trees) {
      const asset = rasterizeBlueprint(blueprint), [sx, sy] = asset.size;
      expect(root).toEqual([sx / 2, 0, blueprint.size[2] / 2]);
      const at = (x: number, y: number, z: number) => asset.voxels[x + sx * (y + sy * z)]!;
      for (const [x, z] of [[root[0] - 1, root[2] - 1], [root[0], root[2]], [root[0] - 1, root[2]], [root[0], root[2] - 1]]) {
        expect([MAT.bark, MAT.cream], `${blueprint.id} root column`).toContain(at(x!, 0, z!));
      }
      let leaves = 0, high = 0;
      for (let i = 0; i < asset.voxels.length; i++) if (FOLIAGE.has(asset.voxels[i]!)) { leaves++; if (Math.floor(i / sx) % sy * 0.125 > canopy.pivot) high++; }
      expect(high / leaves, `${blueprint.id} crown sits above its pivot`).toBeGreaterThan(0.8);
      expect(canopy.pivot).toBeGreaterThan(1);
      expect(canopy.top).toBeGreaterThan(canopy.pivot + 2);
      expect(canopy.top).toBeLessThanOrEqual(sy * 0.125);
      expect(canopy.reach).toBeLessThanOrEqual(sx * 0.0625);
      expect(canopy.sway).toBeLessThanOrEqual(0.125);
    }
  });

  it('keeps every coarse detail level grounded: no crown comes loose at stream distance', () => {
    for (const { blueprint } of trees.filter(t => t.style === 'hearth')) for (const factor of [2, 4] as const) {
      expect(floating(createRenderLodAsset(rasterizeBlueprint(blueprint), factor, MATERIALS.materials)), `${blueprint.id} @${factor}`).toBe(0);
    }
  }, 120_000);

  it('grows the same tree from the same name, and different trees from different variants', () => {
    for (const species of TREE_SPECIES) for (const style of TREE_STYLES) {
      const grow = () => {
        const r = rng(`picture-tree:${species}:${style}:0`), { sculpt } = GROWERS[species](r, style, 0, Math.floor(r() * 9973));
        return JSON.stringify(sculpt.toBlueprint());
      };
      const tree = createPictureTree(species, style, 0);
      expect(grow()).toBe(JSON.stringify({ size: tree.blueprint.size, boxes: tree.blueprint.boxes }));
      expect(createPictureTree(species, style, 0)).toBe(tree);
      const bodies = new Set(Array.from({ length: TREE_VARIANTS[species] }, (_, v) => JSON.stringify(createPictureTree(species, style, v).blueprint.boxes)));
      expect(bodies.size).toBe(TREE_VARIANTS[species]);
    }
    // Kits differ, not only in name.
    expect(JSON.stringify(createPictureTree('oak', 'hearth', 0).blueprint.boxes)).not.toBe(JSON.stringify(createPictureTree('oak', 'tide', 0).blueprint.boxes));
  });

  it('selects a variant by seed, the same one every time, and uses them all', () => {
    for (const species of TREE_SPECIES) {
      const picked = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const tree = selectTree('grove', species, `site-${i}`);
        expect(selectTree('grove', species, `site-${i}`)).toBe(tree);
        expect(tree.species).toBe(species);
        picked.add(tree.variant);
      }
      expect(picked.size).toBe(TREE_VARIANTS[species]);
    }
    expect(() => createPictureTree('oak', 'hearth', 4)).toThrow(/variants/);
    expect(() => createPictureTree('palm' as never, 'hearth', 0)).toThrow(/species/);
    expect(() => selectTree('marble' as never, 'oak', 1)).toThrow(/kit/);
  });

  it('crops on whole 4-cell columns and rejects volumes that cannot keep the trunk centred', () => {
    expect(() => new Sculpt(30, 40, 32)).toThrow();
    const s = new Sculpt(32, 20, 32);
    s.limb([0, 0, 0], [0, 12, 0], 2, 1.5, MAT.bark);
    s.clump([0, 13, 0], 6, 4, 6, MAT.leaf, rng('t'));
    s.setBlock(0, 18, 0, MAT.leaf); // A loose block with no path down is removed.
    const { size, boxes } = s.toBlueprint();
    expect(s.get(0, 18, 0)).toBe(0);
    expect(s.get(16, 5, 16)).toBe(MAT.bark);
    expect(size[0] % 8).toBe(0);
    expect(boxes.every(b => b.to[1] <= size[1] && b.to[0] <= size[0] && b.to[2] <= size[2])).toBe(true);
  });
});
