import { expect, it } from 'vitest';
import { terrainHeight } from '../layout';
import { compileChannelGenesis } from './index';
import { compileGenesisSettlement } from './settlement';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from './observed-fixtures';
import { sampleGenesisSurface } from './surface';

it('keeps Genesis water seams continuous and foothill earthwork close to natural land', () => {
  const formerlyFailingPatches = [[[58, -170], [-108, -172]], [[-9, 11], [-87, 180]], [[14, -5], [160, -79], [191, 92], [176, -106]]] as const;
  for (let i = 0; i < OBSERVED_GENESIS_FIXTURES.length; i++) {
    const recipe = compileChannelGenesis(OBSERVED_GENESIS_FIXTURES[i]);
    const land = recipe.landscapes.find(item => item.character === OBSERVED_GENESIS_SHOWCASE_CHOICES[i]!.character)!;
    const plan = compileGenesisSettlement(recipe, land.id);
    expect(plan.homes.length).toBe(recipe.size.homeCapacity);
    for (const [x, z] of formerlyFailingPatches[i]!) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const height = terrainHeight(plan, x + dx, z + dz);
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThan(-16);
      expect(height).toBeLessThan(496);
    }
    const outward = [[0, 1], [1, 0], [0, -1], [-1, 0]][land.coast.oceanToward]!;
    for (let j = 1; j < land.coast.shoreline.length; j++) for (const t of [0, .25, .5, .75, 1]) {
      const a = land.coast.shoreline[j - 1]!, b = land.coast.shoreline[j]!;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const wet = sampleGenesisSurface(land, x + outward[0]! * .01, z + outward[1]! * .01);
      const dry = sampleGenesisSurface(land, x - outward[0]! * .01, z - outward[1]! * .01);
      expect(Math.abs(wet.ground - dry.ground)).toBeLessThan(.1);
    }
    for (const stream of land.terrainCore.streams) {
      const a = stream.points[0]!.position, b = stream.points[1]!.position;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / length * .01, dz = (b[1] - a[1]) / length * .01;
      expect(Math.abs(sampleGenesisSurface(land, a[0] - dx, a[1] - dz).ground - sampleGenesisSurface(land, a[0] + dx, a[1] + dz).ground)).toBeLessThan(.1);
    }
    if (i === 1) {
      const turn = land.coast.oceanToward;
      const local = (x: number, z: number): readonly [number, number] => turn === 0 ? [x, z] : turn === 1 ? [-z, x] : turn === 2 ? [-x, -z] : [z, -x];
      const world = (x: number, z: number): readonly [number, number] => turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
      const points = land.terrainCore.streams[0]!.points;
      const at = points.findIndex((point, index) => index > 0 && local(...points[index - 1]!.position)[1] <= 20 && local(...point.position)[1] >= 20);
      expect(at).toBeGreaterThan(0);
      const a = points[at - 1]!, b = points[at]!, start = local(...a.position), end = local(...b.position), t = (20 - start[1]) / (end[1] - start[1]);
      const x = start[0] + (end[0] - start[0]) * t, level = a.level + (b.level - a.level) * t;
      const banks = [-9, 9].map(side => sampleGenesisSurface(land, ...world(x + side, 20)).ground);
      for (const bank of banks) { expect(bank).toBeGreaterThan(level); expect(bank).toBeLessThanOrEqual(level + 1.5); }
      expect(Math.abs(banks[0]! - banks[1]!)).toBeLessThanOrEqual(.75);
    }
    if (recipe.size.tier === 'city') {
      expect(plan.quarters.length).toBe(8);
      for (const home of plan.homes) for (const x of [home.lot.minX, home.position[0], home.lot.maxX]) for (const z of [home.lot.minZ, home.position[2], home.lot.maxZ]) {
        expect(Math.abs(sampleGenesisSurface(land, x, z).ground - home.position[1])).toBeLessThanOrEqual(3.001);
      }
      for (const road of plan.streets.filter(road => road.kind === 'lane')) for (const p of road.points) expect(Math.abs(sampleGenesisSurface(land, p[0], p[2]).ground - p[1])).toBeLessThanOrEqual(3.001);
    }
    if (recipe.size.tier === 'hamlet') {
      expect(plan.quarters.map(ward => plan.homes.filter(home => ward.courtIds.includes(home.courtId)).length)).toEqual([6, 6, 4]);
      expect(plan.castle.modules).toHaveLength(1);
      expect(plan.castle.modules[0]!.kind).toBe('keep');
    }
  }
});
