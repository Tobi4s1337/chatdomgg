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
    expect(strand.blueprint.boxes.length).toBeLessThan(8000);
    // Tone and crown, not lowered cracks: about half again a plain skin's triangles, a third of a carved one's.
    expect(meshCost(strand.blueprint).triangles).toBeLessThan(60_000);
  });

  it('lies on its bank: every stone a cell proud of the sampled ground, a crowned one three, none floating, none buried', () => {
    expect(tops.length).toBeGreaterThan(5000);
    for (const top of tops) {
      const ground = site.ground(top.x + .5, top.z + .5);
      expect(top.y + 1, `${top.x},${top.z}`).toBeGreaterThan(ground);
      expect(top.y - ground, `${top.x},${top.z}`).toBeLessThan(3.5);
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
    // Up the bank the only dark is the shadowed crack between two stones.
    expect(dark(of(20, 70))).toBeGreaterThan(.03);
    expect(dark(of(20, 70))).toBeLessThan(.25);
    const dry = of(20, 70), pale = new Set<number>([MAT.stone, MAT.paving, MAT.limestone, MAT.cream]);
    expect(dry.filter(top => pale.has(top.material)).length / dry.length).toBeGreaterThan(.75);
    expect(dry.filter(top => pale.has(top.material) || top.material === MAT.darkStone).length / dry.length).toBeGreaterThan(.97);
    expect(dry.filter(top => top.material === MAT.stone).length / dry.length).toBeGreaterThan(.4);
    expect(of(7, 12).some(top => top.material === MAT.moss)).toBe(true);
  });

  it('refuses a strand with no shore in it or one larger than a blueprint', () => {
    expect(() => createShingleStrand({ ...site, shore: () => 500 })).toThrow(/no shore/);
    expect(() => createShingleStrand({ ...site, length: 300 })).toThrow();
  });
});

describe('a berth on the shingle', () => {
  // A boat drawn up high on the bank, above where the strand's own stones thin out.
  const berth = { x0: 60, x1: 100, z0: 40 + 104, z1: 40 + 124 };
  const out = (x: number, z: number) => {
    const dx = Math.max(berth.x0 - x, 0, x - berth.x1), dz = Math.max(berth.z0 - z, 0, z - berth.z1);
    return dx || dz ? Math.hypot(dx, dz) : -1;
  };
  const strand = createShingleStrand({ ...site, depth: 180, berth: out });
  const { at, size } = voxels(strand.blueprint);
  const stone = (x: number, z: number) => { for (let y = size[1] - 1; y >= 0; y--) if (at(x, y, z)) return true; return false; };

  it('is stones however far up the bank it lies, with a margin that thins into the turf', () => {
    let covered = 0, cells = 0;
    for (let z = berth.z0 - 3; z < berth.z1 + 3; z++) for (let x = berth.x0 - 3; x < berth.x1 + 3; x++) { cells++; if (stone(x, z)) covered++; }
    expect(covered / cells).toBeGreaterThan(.97);
    let far = 0;
    for (let z = berth.z0; z < berth.z1; z++) for (let x = berth.x1 + 14; x < berth.x1 + 30; x++) if (stone(x, z)) far++;
    expect(far).toBe(0);
  });
});
