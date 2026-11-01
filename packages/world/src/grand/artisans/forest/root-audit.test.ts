import { expect, it } from 'vitest';
import { createTree, planRiparianReviewTrees, riparianReviewSurface } from './index';

it('audits actual occupied base footprints against the bank', () => {
  let trees = 0, unsupported = 0; const examples: string[] = [];
  for (const seed of ['tobi4s_', 'The_AGGman', 'PinkKittyRose', 'MashaD4', 'bank-21', 'bank-24', 'bank-25', 'bank-31', 'bank-66', 'bank-72', 'bank-104']) {
    const surface = riparianReviewSurface(seed);
    const grove = planRiparianReviewTrees(seed);
    for (const tree of grove) {
      trees++;
      const shape = createTree('willow', tree.seedKey, tree.scale);
      for (const box of shape.boxes) {
        if (!(box.min[1] <= 0 && box.min[1] + box.size[1] > 0)) continue;
        for (let x = box.min[0]; x < box.min[0] + box.size[0]; x++) for (let z = box.min[2]; z < box.min[2] + box.size[2]; z++) {
          const p = surface(tree.x + x, tree.z + z);
          if (p.water || p.groundY !== tree.y) { unsupported++; if (examples.length < 8) examples.push(`${seed} base(${tree.x},${tree.y},${tree.z}) scale=${tree.scale.toFixed(3)} cell(${x},${z}) ground=${p.water ? 'water' : p.groundY}`); }
        }
      }
    }
  }
  expect(trees).toBeGreaterThan(10);
  expect(unsupported, examples.join('\n')).toBe(0);
});
