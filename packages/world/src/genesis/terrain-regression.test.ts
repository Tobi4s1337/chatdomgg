import { expect, it } from 'vitest';
import { terrainHeight } from '../layout';
import { samplePublicGround } from '../settlement/terrain';
import { compileChannelGenesis } from './index';
import { compileGenesisSettlement } from './settlement';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from './observed-fixtures';
import { sampleGenesisSurface } from './surface';

it('keeps the three failing Genesis shore and frontage patches inside the existing terrain mesh bounds', () => {
  const failures: unknown[] = [];
  for (const [i, anchor] of [[0, [58, -170]], [1, [-9, 11]], [2, [14, -5]]] as const) {
    const recipe = compileChannelGenesis(OBSERVED_GENESIS_FIXTURES[i]);
    const land = recipe.landscapes.find(item => item.character === OBSERVED_GENESIS_SHOWCASE_CHOICES[i]!.character)!;
    const plan = compileGenesisSettlement(recipe, land.id);
    for (let z = anchor[1] - 2; z <= anchor[1] + 1; z++) for (let x = anchor[0] - 2; x <= anchor[0] + 1; x++) {
      const top = Math.round(terrainHeight(plan, x + .25, z + .25) * 2) / 2;
      for (const [dx, dz] of [[0,0], [0,1], [1,1], [1,0]]) {
        const px = x + dx!, pz = z + dz!, height = terrainHeight(plan, px, pz);
        const natural = sampleGenesisSurface(land, px, pz);
        if (natural.shoreDistance < 0) expect(height).toBeLessThanOrEqual(natural.ground + 1e-5);
        if (Math.abs(top - height) > 2) failures.push({ i, px, pz, top, height, natural: sampleGenesisSurface(land,px,pz), ground: samplePublicGround(plan,px,pz) });
      }
    }
  }
  expect(failures).toEqual([]);
});
