import { expect, it } from 'vitest';
import { createTree, FOREST_SPECIES, treeExtent } from './index';

it('contains diverse generated trees inside their spacing envelope', () => {
  for (const species of FOREST_SPECIES) for (let seed = 0; seed < 32; seed++) {
    const extent = treeExtent(species), tree = createTree(species, `channel-${seed}`);
    let radius = 0, height = 0;
    for (const b of tree.boxes) {
      radius = Math.max(radius, Math.abs(b.min[0]), Math.abs(b.min[0] + b.size[0]), Math.abs(b.min[2]), Math.abs(b.min[2] + b.size[2]));
      height = Math.max(height, b.min[1] + b.size[1]);
    }
    expect(radius, `${species} seed ${seed}`).toBeLessThanOrEqual(extent.radius);
    expect(height, `${species} seed ${seed}`).toBeLessThanOrEqual(extent.height);
  }
}, 30000);
