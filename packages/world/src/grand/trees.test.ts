import { describe, expect, it } from 'vitest';
import { M } from './palette';
import { generateTreeShape, treeExtent } from './trees';
import { TREE_SPECIES, type TreeShape, type TreeSpecies } from './types';

const SEEDS = [1, 7, 2024, 31337, 0xdeadbeef, 4000000000];
const HERO = new Set<TreeSpecies>(['hero-gold', 'hero-teal', 'hero-cherry']);
const BARK = new Set<number>(Object.values(M.bark));
const isBark = (m: number) => BARK.has(m);
const isLeaf = (m: number) => m >= M.leaf.oak && m < M.crop.wheat;

const key = (x: number, y: number, z: number) => ((x + 128) * 256 + (z + 128)) * 256 + (y + 8);

function cells(t: TreeShape): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < t.count; i++) map.set(key(t.dx[i]!, t.dy[i]!, t.dz[i]!), t.material[i]!);
  return map;
}

/** Faces a mesher would emit above ground: cell faces with no neighbour. */
function exposedFaces(t: TreeShape): number {
  const map = cells(t);
  let faces = 0;
  for (let i = 0; i < t.count; i++) {
    const x = t.dx[i]!, y = t.dy[i]!, z = t.dz[i]!;
    if (y < 0) continue;
    for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (ay === -1 && y === 0) continue;
      if (!map.has(key(x + ax, y + ay, z + az))) faces++;
    }
  }
  return faces;
}

/** Height (top cell + 1) and leaf radius from the trunk axis. */
function measure(t: TreeShape): { height: number; radius: number; bark: number; leaf: number } {
  let radius = 0, bark = 0, leaf = 0;
  for (let i = 0; i < t.count; i++) {
    const m = t.material[i]!;
    if (isBark(m)) bark++;
    else if (isLeaf(m)) { leaf++; radius = Math.max(radius, Math.hypot(t.dx[i]!, t.dz[i]!)); }
  }
  return { height: t.max[1] + 1, radius, bark, leaf };
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

describe('grand trees', () => {
  it('grows the same tree from the same arguments', () => {
    for (const species of TREE_SPECIES) {
      const a = generateTreeShape(species, 99, 1.1);
      // Interleave another tree so shared scratch state cannot leak between calls.
      generateTreeShape(TREE_SPECIES[(TREE_SPECIES.indexOf(species) + 3) % TREE_SPECIES.length]!, 5, 0.8);
      const b = generateTreeShape(species, 99, 1.1);
      expect(b.count).toBe(a.count);
      expect(same(b.dx, a.dx) && same(b.dy, a.dy) && same(b.dz, a.dz) && same(b.material, a.material), species).toBe(true);
      expect(b.min).toEqual(a.min);
      expect(b.max).toEqual(a.max);
    }
  });

  it('varies with the seed', () => {
    for (const species of TREE_SPECIES) {
      const counts = new Set(SEEDS.map(seed => generateTreeShape(species, seed, 1).count));
      expect(counts.size, species).toBeGreaterThan(SEEDS.length / 2);
    }
  });

  it('emits unique cells inside the declared and allowed bounds', () => {
    for (const species of TREE_SPECIES) {
      for (const seed of SEEDS.slice(0, 3)) {
        for (const scale of HERO.has(species) ? [1, 1.3] : [0.7, 1, 1.4]) {
          const t = generateTreeShape(species, seed, scale);
          expect(t.count).toBeGreaterThan(0);
          expect(t.dx.length).toBe(t.count);
          expect(t.material.length).toBe(t.count);
          expect(cells(t).size, `${species} duplicates`).toBe(t.count);
          const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          let empty = 0;
          for (let i = 0; i < t.count; i++) {
            const p = [t.dx[i]!, t.dy[i]!, t.dz[i]!];
            for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
            if (t.material[i] === 0) empty++;
          }
          expect(empty, `${species} air cells`).toBe(0);
          expect([...t.min]).toEqual(lo);
          expect([...t.max]).toEqual(hi);
          expect(t.min[0]).toBeGreaterThanOrEqual(-60); expect(t.max[0]).toBeLessThanOrEqual(60);
          expect(t.min[2]).toBeGreaterThanOrEqual(-60); expect(t.max[2]).toBeLessThanOrEqual(60);
          expect(t.min[1]).toBeGreaterThanOrEqual(-4); expect(t.max[1]).toBeLessThanOrEqual(120);
        }
      }
    }
  });

  it('roots every tree into the ground under its trunk', () => {
    for (const species of TREE_SPECIES) {
      const map = cells(generateTreeShape(species, 3, 1));
      for (let y = -3; y <= 0; y++) expect(isBark(map.get(key(0, y, 0)) ?? 0), `${species} at dy=${y}`).toBe(true);
    }
  });

  it('keeps leaves above the ground cell', () => {
    for (const species of TREE_SPECIES) {
      const t = generateTreeShape(species, 11, 1);
      let buried = 0;
      for (let i = 0; i < t.count; i++) if (isLeaf(t.material[i]!) && t.dy[i]! < 0) buried++;
      expect(buried, species).toBe(0);
    }
  });

  it('gives every species bark and leaves in its own materials', () => {
    const leafFamily: Record<TreeSpecies, number> = {
      oak: M.leaf.oak, lime: M.leaf.lime, birch: M.leaf.birch, 'autumn-gold': M.leaf.gold, 'autumn-red': M.leaf.red,
      pine: M.leaf.pine, spruce: M.leaf.pine, cherry: M.leaf.cherry, teal: M.leaf.teal, willow: M.leaf.willow,
      shrub: -1, 'hero-gold': M.leaf.gold, 'hero-teal': M.leaf.teal, 'hero-cherry': M.leaf.cherry,
    };
    for (const species of TREE_SPECIES) {
      const m = measure(generateTreeShape(species, 21, 1));
      expect(m.bark, species).toBeGreaterThan(0);
      expect(m.leaf, species).toBeGreaterThan(species === 'shrub' ? 10 : 100);
      if (species === 'shrub') expect(m.leaf).toBeGreaterThan(m.bark * 3);
      const family = leafFamily[species];
      if (family < 0) continue;
      const t = generateTreeShape(species, 21, 1);
      let own = 0;
      for (let i = 0; i < t.count; i++) { const v = t.material[i]!; if (v >= family && v < family + 4) own++; }
      expect(own / m.leaf, species).toBeGreaterThan(0.6);
    }
    const birch = generateTreeShape('birch', 5, 1);
    expect([...birch.material]).toContain(M.bark.birch);
    expect([...birch.material]).toContain(M.bark.dead);
  });

  it('grows each species to its size', () => {
    // [height min, height max, radius min, radius max] at scale 1, over many seeds.
    const ranges: Record<TreeSpecies, readonly [number, number, number, number]> = {
      oak: [14, 28, 5, 14], lime: [14, 28, 4.5, 12], birch: [15, 27, 3, 9], 'autumn-gold': [13, 27, 5, 13], 'autumn-red': [12, 25, 5, 12],
      pine: [18, 38, 3, 9], spruce: [16, 36, 3, 9.5], cherry: [10, 20, 6, 14], teal: [16, 31, 4, 12], willow: [12, 22, 6, 13],
      shrub: [2, 7, 1.5, 6], 'hero-gold': [50, 82, 24, 46], 'hero-teal': [50, 82, 22, 46], 'hero-cherry': [44, 70, 25, 48],
    };
    for (const species of TREE_SPECIES) {
      const [h0, h1, r0, r1] = ranges[species];
      const n = HERO.has(species) ? 4 : 16;
      const heights: number[] = [], radii: number[] = [];
      for (let i = 0; i < n; i++) {
        const m = measure(generateTreeShape(species, (i * 2654435761) >>> 0, 1));
        expect(m.height, `${species} height`).toBeGreaterThanOrEqual(h0);
        expect(m.height, `${species} height`).toBeLessThanOrEqual(h1);
        expect(m.radius, `${species} radius`).toBeGreaterThanOrEqual(r0);
        expect(m.radius, `${species} radius`).toBeLessThanOrEqual(r1);
        heights.push(m.height); radii.push(m.radius);
      }
      // The placement estimate tracks what really grows.
      const e = treeExtent(species, 1);
      expect(Math.abs(median(heights) - e.height) / e.height, `${species} extent height`).toBeLessThan(0.2);
      expect(Math.abs(median(radii) - e.radius) / e.radius, `${species} extent radius`).toBeLessThan(0.25);
    }
  });

  it('scales with the scale argument', () => {
    for (const species of TREE_SPECIES) {
      const small = measure(generateTreeShape(species, 8, HERO.has(species) ? 1 : 0.7));
      const large = measure(generateTreeShape(species, 8, HERO.has(species) ? 1.3 : 1.4));
      expect(large.height, species).toBeGreaterThan(small.height);
      expect(treeExtent(species, 1.4).radius).toBeCloseTo(treeExtent(species, 1).radius * 1.4, 6);
    }
  });

  it('stays inside the voxel and face budgets', () => {
    for (const species of TREE_SPECIES) {
      for (const seed of SEEDS.slice(0, 3)) {
        const t = generateTreeShape(species, seed, 1);
        const faces = exposedFaces(t);
        if (HERO.has(species)) {
          expect(t.count, `${species} voxels`).toBeLessThan(90_000);
          expect(faces, `${species} faces`).toBeLessThan(35_000);
        } else {
          expect(t.count, `${species} voxels`).toBeLessThan(6_000);
          expect(faces, `${species} faces`).toBeLessThan(2_500);
        }
      }
    }
  });

  it('keeps accents to a sprinkle', () => {
    const accents = new Set<number>(Object.values(M.accent));
    const share = (species: TreeSpecies, mat: number) => {
      let hit = 0, leaves = 0;
      for (const seed of SEEDS) {
        const t = generateTreeShape(species, seed, 1);
        for (let i = 0; i < t.count; i++) { const m = t.material[i]!; if (isLeaf(m)) { leaves++; if (m === mat) hit++; } }
      }
      return hit / leaves;
    };
    const orange = share('autumn-gold', M.accent.orange);
    expect(orange).toBeGreaterThan(0.02);
    expect(orange).toBeLessThan(0.16);
    expect(share('autumn-red', M.accent.gold)).toBeLessThan(0.12);
    expect(share('hero-teal', M.accent.lilac)).toBeLessThan(0.05);
    for (const species of ['oak', 'lime', 'birch', 'pine', 'spruce', 'willow'] as const) {
      const t = generateTreeShape(species, 4, 1);
      expect([...t.material].some(m => accents.has(m)), species).toBe(false);
    }
  });

  it('grows fast enough to fill a land with thousands of trees', () => {
    for (const species of TREE_SPECIES) generateTreeShape(species, 1, 1);
    const normal = TREE_SPECIES.filter(s => !HERO.has(s));
    let t0 = performance.now();
    const n = 400;
    for (let i = 0; i < n; i++) generateTreeShape(normal[i % normal.length]!, i * 7919, 0.8 + (i % 7) * 0.08);
    const perTree = (performance.now() - t0) / n;
    // Generous for shared CI hosts; a quiet machine runs about 1 ms.
    expect(perTree).toBeLessThan(6);
    t0 = performance.now();
    for (const species of HERO) generateTreeShape(species, 42, 1.2);
    expect((performance.now() - t0) / HERO.size).toBeLessThan(150);
  });

  it('treats odd scales sanely', () => {
    for (const scale of [0, -1, Number.NaN, 100]) {
      const t = generateTreeShape('oak', 1, scale);
      expect(t.count).toBeGreaterThan(0);
      expect(t.max[1]).toBeLessThanOrEqual(120);
    }
  });
});
