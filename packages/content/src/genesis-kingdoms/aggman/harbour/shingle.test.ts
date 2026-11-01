import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { MAT, MATERIALS } from '../../../materials';
import { meshCost, voxels } from '../../../places/water/piece-checks';
import { createShingleStrand, type ShingleSite } from './index';

/** A bank rising off a wandering waterline at the coast sampler's 22 % grade, in cells. */
const shore = (x: number, z: number) => z - 40 - 6 * Math.sin(x / 30);
const site: ShingleSite = {
  id: 'probe', length: 196, depth: 124, water: 0, reach: 76,
  ground: (x, z) => .22 * shore(x, z), shore,
  clear: (x, z) => x > 120 && z > 60,
};

describe('the harbour shingle', () => {
  const strand = createShingleStrand(site);
  const { at, size } = voxels(strand.blueprint);
  const tops: { x: number; z: number; y: number; material: number }[] = [];
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    for (let y = size[1] - 1; y >= 0; y--) if (at(x, y, z)) { tops.push({ x, z, y: y + strand.base, material: at(x, y, z) }); break; }
  }

  it('is the same strand every time, a valid Tide prop within a ground piece’s budget', () => {
    expect(JSON.stringify(createShingleStrand(site))).toBe(JSON.stringify(strand));
    expect(VoxelBlueprintSchema.safeParse(strand.blueprint).success).toBe(true);
    expect(strand.blueprint.id).toBe('genesis-aggman-shingle-probe');
    const registered = new Set(MATERIALS.materials.map(m => m.id));
    for (const box of strand.blueprint.boxes) expect(registered.has(box.material)).toBe(true);
    expect(strand.blueprint.boxes.length).toBeLessThan(6000);
    expect(meshCost(strand.blueprint).triangles).toBeLessThan(160_000);
  });

  it('lies on its bank: every stone within a cell and a half of the sampled ground, none floating, none buried', () => {
    expect(tops.length).toBeGreaterThan(5000);
    for (const top of tops) {
      const ground = site.ground(top.x + .5, top.z + .5);
      expect(top.y + 1, `${top.x},${top.z}`).toBeGreaterThan(ground);
      expect(top.y - ground, `${top.x},${top.z}`).toBeLessThan(2.5);
    }
  });

  it('runs from under the shallows up the bank, thinning into the turf, and keeps clear ground bare', () => {
    const inland = tops.map(top => shore(top.x + .5, top.z + .5));
    expect(Math.min(...inland)).toBeLessThan(-15);
    expect(Math.max(...inland)).toBeGreaterThan(70);
    expect(Math.max(...inland)).toBeLessThan(76 * 1.25 + 1);
    expect(tops.filter(top => top.x > 120 && top.z > 60)).toEqual([]);
    // The fringe is broken: at the top of the bank most columns are turf, low down almost none are.
    const share = (from: number, to: number) => {
      let stones = 0, columns = 0;
      for (let z = 0; z < size[2]; z++) for (let x = 0; x < 120; x++) {
        const d = shore(x + .5, z + .5);
        if (d < from || d >= to) continue;
        columns++;
        if (tops.some(top => top.x === x && top.z === z)) stones++;
      }
      return stones / columns;
    };
    expect(share(10, 40)).toBeGreaterThan(.97);
    expect(share(70, 90)).toBeLessThan(.6);
  });

  it('is wet and dark at the water, pale and dry up the bank, with weed on the wrack line', () => {
    const of = (from: number, to: number) => tops.filter(top => { const d = shore(top.x + .5, top.z + .5); return d >= from && d < to; });
    const dark = (list: typeof tops) => list.filter(top => top.material === MAT.darkStone).length / list.length;
    expect(dark(of(-20, 6))).toBeGreaterThan(.5);
    expect(dark(of(20, 70))).toBeLessThan(.02);
    const dry = of(20, 70), pale = new Set<number>([MAT.stone, MAT.paving, MAT.limestone, MAT.cream]);
    expect(dry.filter(top => pale.has(top.material)).length / dry.length).toBeGreaterThan(.97);
    expect(dry.filter(top => top.material === MAT.stone).length / dry.length).toBeGreaterThan(.4);
    expect(of(7, 12).some(top => top.material === MAT.moss)).toBe(true);
  });

  it('refuses a strand with no shore in it or one larger than a blueprint', () => {
    expect(() => createShingleStrand({ ...site, shore: () => 500 })).toThrow(/no shore/);
    expect(() => createShingleStrand({ ...site, length: 300 })).toThrow();
  });
});
