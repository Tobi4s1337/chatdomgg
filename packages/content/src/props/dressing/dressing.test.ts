import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../../voxel/src/index';
import { createRenderLodAsset } from '../../../../voxel/src/lod';
import { MAT, MATERIALS, STYLES } from '../../materials';
import { BLUEPRINTS, DRESSING_SIZES, createDressing, type DressingForm } from './index';

type Cell = readonly [number, number, number];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const parse = (k: string) => k.split(',').map(Number) as unknown as Cell;
const FLOWERS = { petal: MAT.petal, blue: MAT.blueFlower, gold: MAT.goldLeaf, cream: MAT.cream } as const;
const GREENS = new Set<number>([MAT.leaf, MAT.moss]);
const formOf = (b: VoxelBlueprint) => b.id.slice('dressing-'.length) as DressingForm;

/** The final rasterized cells, read from the production rasterizer rather than from the authored boxes. */
function occupancy(asset: VoxelAsset): Map<string, number> {
  const [sx, sy, sz] = asset.size, cells = new Map<string, number>();
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = asset.voxels[x + sx * (y + sy * z)]!;
    if (m) cells.set(key(x, y, z), m);
  }
  return cells;
}
const cellsOf = (form: DressingForm) => occupancy(rasterizeBlueprint(createDressing(form)));

/** Face-connected groups of the cells that pass `keep`. */
function components(cells: ReadonlyMap<string, number>, keep: (material: number) => boolean = () => true): Cell[][] {
  const todo = new Set([...cells].filter(([, m]) => keep(m)).map(([k]) => k)), groups: Cell[][] = [];
  for (const start of todo) {
    todo.delete(start);
    const group: Cell[] = [], queue = [start];
    while (queue.length) {
      const c = parse(queue.pop()!);
      group.push(c);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const n = key(c[0] + dx, c[1] + dy, c[2] + dz);
        if (todo.delete(n)) queue.push(n);
      }
    }
    groups.push(group);
  }
  return groups;
}

/** The top material of every occupied column of an asset. */
function columnTops(asset: VoxelAsset): number[] {
  const [sx, sy, sz] = asset.size, tops: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = sy - 1; y >= 0; y--) {
    const m = asset.voxels[x + sx * (y + sy * z)]!;
    if (m) { tops.push(m); break; }
  }
  return tops;
}

describe('ground-dressing blueprints', () => {
  it('lists the finished cover forms in R1 order', () => {
    expect(BLUEPRINTS.map(b => b.id)).toEqual([
      'dressing-meadow-tufts', 'dressing-wildflowers-petal', 'dressing-wildflowers-blue', 'dressing-wildflowers-gold',
      'dressing-wildflowers-cream', 'dressing-clover-pebbles',
    ]);
  });

  it.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s is strict, bounded, grounded and cheap', (_, b) => {
    expect(() => VoxelBlueprintSchema.parse(b)).not.toThrow();
    expect(b).toMatchObject({ version: 1, kind: 'flora', lattice: 'build', styleId: STYLES.grove.id, windows: [] });
    const max = DRESSING_SIZES[formOf(b)];
    b.size.forEach((n, axis) => expect(n).toBeLessThanOrEqual(max[axis]!));
    expect(b.boxes.length).toBeLessThanOrEqual(400);
    const keys = b.boxes.map(box => JSON.stringify(box));
    expect(new Set(keys).size).toBe(keys.length);
    for (const box of b.boxes) {
      expect(box.material).not.toBe(MAT.air);
      box.from.forEach((n, axis) => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(box.to[axis]!); expect(box.to[axis]!).toBeLessThanOrEqual(b.size[axis]!); });
    }
    const asset = rasterizeBlueprint(b), cells = occupancy(asset);
    // Every cell is written once: the boxes never overlap, so their volumes add up to the occupancy.
    expect(b.boxes.reduce((sum, { from, to }) => sum + (to[0] - from[0]) * (to[1] - from[1]) * (to[2] - from[2]), 0)).toBe(cells.size);
    expect(cells.size).toBeGreaterThan(0);
    for (const group of components(cells)) expect(group.some(c => c[1] === 0), `${b.id} has a floating group`).toBe(true);
    // A one-cell margin of open ground keeps neighbouring patches from fusing into a carpet.
    for (const k of cells.keys()) { const [x, , z] = parse(k); expect(x > 0 && z > 0 && x < b.size[0] - 1 && z < b.size[2] - 1, k).toBe(true); }
    const allowed = new Set<number>([MAT.leaf, MAT.moss, MAT.goldLeaf, MAT.petal, MAT.blueFlower, MAT.cream, MAT.earth, MAT.bark, MAT.stone]);
    for (const m of cells.values()) expect(allowed.has(m)).toBe(true);
    let triangles = 0;
    for (const chunk of prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)) triangles += meshVoxelChunk(chunk).indices.length / 3;
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(1500);
    expect(createDressing(formOf(b))).toEqual(createDressing(formOf(b)));
    expect(createDressing(formOf(b))).toEqual(b);
  });

  it('fails explicitly for unknown, styled or unfinished forms', () => {
    expect(() => createDressing('dandelions' as DressingForm)).toThrow('Unknown dressing form');
    expect(() => createDressing('meadow-tufts', 'hearth')).toThrow('takes no style');
    expect(() => createDressing('oak-old-a')).toThrow('not part of the finished');
    expect(() => createDressing('garden-bed')).toThrow('kit form');
  });
});

describe('meadow tufts', () => {
  const cells = cellsOf('meadow-tufts');

  it('stays under half a metre so it can stand before a facade', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(3);
  });

  it('is four to seven separate tufts with open ground between them', () => {
    const tufts = components(cells);
    expect(tufts.length).toBeGreaterThanOrEqual(4);
    expect(tufts.length).toBeLessThanOrEqual(7);
    const footprints = tufts.map(t => new Set(t.map(([x, , z]) => `${x},${z}`)).size);
    // Varied sizes, not one stamp repeated.
    expect(Math.max(...footprints)).toBeGreaterThanOrEqual(3 * Math.min(...footprints));
    const ground = [...cells.keys()].filter(k => parse(k)[1] === 0).length;
    expect(ground / (16 * 16)).toBeLessThan(0.45);
  });

  it('uses two greens, with moss only as the lit tips of the taller blades', () => {
    expect(new Set(cells.values())).toEqual(GREENS);
    const moss = [...cells].filter(([, m]) => m === MAT.moss).map(([k]) => parse(k));
    expect(moss.length).toBeLessThan(cells.size * 0.15);
    for (const [x, y, z] of moss) { expect(cells.has(key(x, y + 1, z))).toBe(false); expect(y).toBeGreaterThanOrEqual(2); }
  });
});

describe('wildflowers', () => {
  const colours = Object.keys(FLOWERS) as (keyof typeof FLOWERS)[];

  it('keeps every drift under half a metre, like the tufts', () => {
    for (const colour of colours) expect(Math.max(...[...cellsOf(`wildflowers-${colour}`).keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(3);
  });

  it('uses one arrangement, recoloured with exactly one flower each', () => {
    const petal = cellsOf('wildflowers-petal');
    for (const colour of colours) {
      const cells = cellsOf(`wildflowers-${colour}`);
      const materials = new Set(cells.values());
      expect([...materials].filter(m => !GREENS.has(m))).toEqual([FLOWERS[colour]]);
      expect([...cells.keys()]).toEqual([...petal.keys()]);
      for (const [k, m] of petal) expect(cells.get(k)).toBe(m === MAT.petal ? FLOWERS[colour] : m);
    }
  });

  it('holds six to twelve 2×2 heads on even cells, each on a leafy stem', () => {
    const cells = cellsOf('wildflowers-petal');
    const flowers = [...cells].filter(([, m]) => m === MAT.petal).map(([k]) => parse(k));
    const heads = components(cells, m => m === MAT.petal);
    for (const cell of flowers) expect(cell[1] === 2 || cell[1] === 3, `${cell.join(',')}`).toBe(true);
    // Heads may touch corner to corner but never share a face, so each is its own component.
    expect(heads.length).toBeGreaterThanOrEqual(6);
    expect(heads.length).toBeLessThanOrEqual(12);
    for (const head of heads) {
      const xs = head.map(c => c[0]), zs = head.map(c => c[2]);
      const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
      expect([x0 % 2, z0 % 2, Math.max(...xs) - x0, Math.max(...zs) - z0]).toEqual([0, 0, 1, 1]);
      // Its whole lower course is present, at most one top corner is open, and a stem holds it up.
      expect(head.filter(c => c[1] === 2).length).toBe(4);
      expect(head.length).toBeGreaterThanOrEqual(7);
      expect(head.filter(c => c[1] === 2).some(([x, , z]) => cells.get(key(x, 1, z)) === MAT.leaf)).toBe(true);
    }
    expect(flowers.length / cells.size).toBeLessThan(0.3);
  });

  it.each(colours)('%s heads survive both render LODs as the top of the drift', colour => {
    const asset = rasterizeBlueprint(createDressing(`wildflowers-${colour}`));
    const flower = FLOWERS[colour];
    const heads = components(occupancy(asset), m => m === flower).length;
    // At LOD 2 each head fills its own coarse cell, so every one of them still shows.
    expect(columnTops(createRenderLodAsset(asset, 2, MATERIALS.materials)).filter(m => m === flower).length).toBe(heads);
    // At LOD 4 the two paired hearts of the drift outvote their leaves.
    expect(columnTops(createRenderLodAsset(asset, 4, MATERIALS.materials)).filter(m => m === flower).length).toBeGreaterThanOrEqual(2);
  });
});

describe('clover and pebbles', () => {
  const cells = cellsOf('clover-pebbles');

  it('lies two cells low at most, with clover in both greens', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(1);
    expect(new Set(cells.values())).toEqual(new Set([MAT.leaf, MAT.moss, MAT.stone]));
    const raised = [...cells].filter(([k, m]) => m !== MAT.stone && parse(k)[1] === 1);
    expect(raised.length).toBeGreaterThanOrEqual(3);
    expect(raised.length).toBeLessThan(10);
  });

  it('beds three or four pebbles of at least 2×2 cells into the lawn', () => {
    const pebbles = components(cells, m => m === MAT.stone);
    expect(pebbles.length).toBeGreaterThanOrEqual(3);
    expect(pebbles.length).toBeLessThanOrEqual(4);
    for (const pebble of pebbles) {
      const ground = pebble.filter(c => c[1] === 0);
      const has = (x: number, z: number) => ground.some(c => c[0] === x && c[2] === z);
      expect(ground.some(([x, , z]) => has(x + 1, z) && has(x, z + 1) && has(x + 1, z + 1))).toBe(true);
    }
  });

  it('keeps the lawn calm: a couple of mats rather than a scatter', () => {
    const mats = components(cells, m => GREENS.has(m));
    expect(mats.length).toBeLessThanOrEqual(3);
    for (const mat of mats) expect(mat.length).toBeGreaterThanOrEqual(8);
  });
});
