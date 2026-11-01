import { expect, it } from 'vitest';
import { createTree, FOREST_SPECIES } from './index';

it('varies each tree species with placement seed without changing coordinates on repeat', () => {
  for (const species of FOREST_SPECIES) {
    const shapes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const seed = `kingdom/tree/${i}`;
      const shape = JSON.stringify(createTree(species, seed).boxes);
      expect(shape).toBe(JSON.stringify(createTree(species, seed).boxes));
      shapes.add(shape);
    }
    expect(shapes.size, species).toBeGreaterThanOrEqual(4);
  }
});
