import { expect, it } from 'vitest';
import { CLAY } from '../kit';
import { createRiparianGrove, riparianReviewSurface } from './index';

it('makes a meandering water strip with graded, sampled dry-bank willow bases', () => {
  const seed = 'bank-review', surface = riparianReviewSurface(seed), kit = createRiparianGrove(seed);
  expect(kit).toEqual(createRiparianGrove(seed));
  expect(kit.boxes.some(b => b.colour === CLAY.water)).toBe(true);
  expect(kit.boxes.some(b => b.colour === CLAY.earth)).toBe(true);
  expect(kit.boxes.some(b => b.colour === CLAY.grass)).toBe(true);
  const bank = surface(0, 0);
  expect(bank.water).toBe(true);
  // Opposite bank boundaries vary along the length, and dry terrain rises out of the water.
  const edge = (z: number) => { for (let x = 0; x < 30; x++) if (!surface(x, z).water) return x; return -1; };
  expect(new Set([-60, -30, 0, 30, 60].map(edge)).size).toBeGreaterThan(1);
  const heights = new Set(Array.from({ length: 30 }, (_, x) => surface(x, 0)).filter(p => !p.water).map(p => p.groundY));
  expect(heights.size).toBeGreaterThanOrEqual(3);
  const trees = Object.entries(kit.anchors).filter(([name]) => name.startsWith('tree-'));
  expect(trees.length).toBeGreaterThan(2);
  for (const [, [x, y, z]] of trees) {
    const point = surface(x, z);
    expect(point.water).toBe(false);
    expect(point.groundY).toBe(y);
    expect(point.waterDistance).toBeGreaterThanOrEqual(1);
    expect(point.waterDistance).toBeLessThanOrEqual(14);
    for (const [dx, dz] of [[0,0], [3,0], [-3,0], [0,3], [0,-3]]) {
      const foot = surface(x + dx!, z + dz!);
      expect(foot.water).toBe(false);
      expect(foot.groundY).toBe(y);
    }
  }
});
