import { describe, expect, it } from 'vitest';
import { createForest, createTree, FOREST_SPECIES, planForest, treeExtent } from './index';

describe('forest grammar', () => {
  it('makes deterministic, seeded, distinct silhouettes rooted at the terrain', () => {
    for (const species of FOREST_SPECIES) {
      const tree = createTree(species, 'a');
      expect(tree).toEqual(createTree(species, 'a'));
      expect(tree.boxes.length).toBeGreaterThan(20);
      expect(tree.boxes.every(b => b.size.every(n => Number.isInteger(n) && n > 0))).toBe(true);
      expect(tree.boxes.some(b => b.min[1] === 0 && b.min[0] <= 0 && b.min[0] + b.size[0] > 0 && b.min[2] <= 0 && b.min[2] + b.size[2] > 0)).toBe(true);
    }
    expect(createTree('gold', 'a').boxes).not.toEqual(createTree('gold', 'b').boxes);
    expect(createTree('pine', 'a').boxes).not.toEqual(createTree('gold', 'a').boxes);
  });

  it('reports conservative bounds for multiple shapes and scales', () => {
    for (const species of FOREST_SPECIES) for (const seed of ['one', 'two']) for (const scale of [0.8, 1, 1.16, 2]) {
      const tree = createTree(species, seed, scale), extent = treeExtent(species, scale);
      let radius = 0, height = 0;
      for (const box of tree.boxes) {
        radius = Math.max(radius, Math.abs(box.min[0]), Math.abs(box.min[0] + box.size[0]), Math.abs(box.min[2]), Math.abs(box.min[2] + box.size[2]));
        height = Math.max(height, box.min[1] + box.size[1]);
      }
      expect(radius).toBeLessThanOrEqual(extent.radius);
      expect(height).toBeLessThanOrEqual(extent.height);
    }
  });

  it('connects every emitted tree voxel to its ground root through faces', () => {
    const neighbours = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
    for (const species of FOREST_SPECIES) for (const seed of ['one', 'two', 'three']) {
      const tree = createTree(species, seed), cells = new Set<string>();
      for (const b of tree.boxes) for (let y = b.min[1]; y < b.min[1] + b.size[1]; y++) for (let z = b.min[2]; z < b.min[2] + b.size[2]; z++) for (let x = b.min[0]; x < b.min[0] + b.size[0]; x++) cells.add(`${x},${y},${z}`);
      const root = '0,0,0', visited = new Set<string>([root]), queue = [root];
      expect(cells.has(root)).toBe(true);
      for (let i = 0; i < queue.length; i++) {
        const [x,y,z] = queue[i]!.split(',').map(Number) as [number,number,number];
        for (const [dx,dy,dz] of neighbours) {
          const key = `${x+dx},${y+dy},${z+dz}`;
          if (cells.has(key) && !visited.has(key)) { visited.add(key); queue.push(key); }
        }
      }
      expect(visited.size, `${species} ${seed} disconnected cells`).toBe(cells.size);
    }
  });

  it('keeps crown envelopes clear of reserved clearings and respects terrain samples', () => {
    const options = { radius: 100, density: 35, clearings: [{ x: 0, z: 0, radius: 20 }], sample: (x: number, z: number) => x > 0 ? null : { groundY: 4, slope: 0.5, waterDistance: 6, reserved: z > 30 } };
    const grove = planForest('realm', 'willow', options);
    expect(grove.length).toBeGreaterThan(5);
    expect(grove).toEqual(planForest('realm', 'willow', options));
    expect(grove.every(t => t.x <= 0 && t.z <= 30 && t.y === 4 && Math.hypot(t.x, t.z) >= 20 + treeExtent(t.species, t.scale).radius)).toBe(true);
    expect(planForest('realm', 'willow', { sample: () => ({ groundY: 0, slope: 0, waterDistance: 30, reserved: false }) })).toHaveLength(0);
    const protectedGrove = planForest('realm', 'gold', { radius: 100, density: 30, canPlace: (x, _z, r) => x + r <= 0 });
    expect(protectedGrove.length).toBeGreaterThan(0);
    expect(protectedGrove.every(t => t.x + treeExtent(t.species, t.scale).radius <= 0)).toBe(true);
  });

  it('bounds work inputs and spaces dense candidates without overlaps', () => {
    expect(() => planForest('x', 'gold', { radius: Infinity })).toThrow(RangeError);
    expect(() => planForest('x', 'gold', { radius: 2048 })).toThrow(RangeError);
    expect(() => planForest('x', 'gold', { density: 5001 })).toThrow(RangeError);
    expect(() => planForest('x', 'gold', { clearings: [{ x: 0, z: 0, radius: Infinity }] })).toThrow(RangeError);
    const grove = planForest('dense', 'pine', { radius: 140, density: 300 });
    expect(grove.length).toBeGreaterThan(50);
    for (let i = 0; i < grove.length; i++) for (let j = i + 1; j < grove.length; j++) {
      const a = grove[i]!, b = grove[j]!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(Math.max(treeExtent('pine', a.scale).radius, treeExtent('pine', b.scale).radius) * 1.15);
    }
  });

  it('supplies visible trees in every default review forest, including a riparian willow fixture', () => {
    for (const species of FOREST_SPECIES) {
      const forest = createForest('review', species);
      expect(forest.boxes.length).toBeGreaterThan(0);
      expect(Object.keys(forest.anchors).length).toBeGreaterThan(0);
    }
  }, 30000);

  it('does not move trees when undergrowth is built', () => {
    const options = { radius: 55, density: 6 };
    const grove = planForest('realm', 'gold', options);
    const forest = createForest('realm', 'gold', options);
    for (let i = 0; i < grove.length; i++) expect(forest.anchors[`tree-${i}`]).toEqual([grove[i]!.x, grove[i]!.y, grove[i]!.z]);
  });
});
