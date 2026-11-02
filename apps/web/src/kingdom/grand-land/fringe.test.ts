import { expect, it } from 'vitest';
import { FRINGE_FAR, FRINGE_NEAR, planForestFringe } from './fringe';

const region = { minX: -100, maxX: 100, minZ: -80, maxZ: 80 };
const lake = (x: number, z: number) => Math.hypot(x - 130, z) < 20;
const input = { region, seaLevel: 0, seed: 'willowmere', style: 'hearth' as const,
  height: (x: number, z: number) => Math.abs(x) > 400 ? null : lake(x, z) ? 1 : 4 + .02 * x + (x < -118 ? 6 : 0),
  water: (x: number, z: number) => lake(x, z) ? 2 : null };
const outside = (x: number, z: number) => Math.hypot(Math.max(region.minX - x, 0, x - region.maxX), Math.max(region.minZ - z, 0, z - region.maxZ));

it('grows groves only in the band outside the walkable town, on dry gentle ground', () => {
  const sites = planForestFringe(input);
  expect(sites.length).toBeGreaterThan(80);
  for (const site of sites) {
    const [x, y, z] = site.position, d = outside(x, z);
    expect(d).toBeGreaterThanOrEqual(FRINGE_NEAR);
    expect(d).toBeLessThanOrEqual(FRINGE_FAR);
    expect(Math.hypot(x - 130, z)).toBeGreaterThan(23);
    // No trunk at the foot or the lip of the step.
    expect(Math.abs(x + 118)).toBeGreaterThan(1.2);
    expect(y).toBeLessThanOrEqual(input.height(x, z)!);
    expect(site.room).toBeCloseTo(d + 1.5, 6);
  }
  expect(new Set(sites.map(site => site.id)).size).toBe(sites.length);
  // Clearings: a good share of the band stays open, so the edge of town still looks out over the land.
  const band = 2 * ((200 + 2 * FRINGE_FAR) * FRINGE_FAR + 160 * FRINGE_FAR);
  expect(sites.length * 4.6 * 4.6).toBeLessThan(band * .8);
});

it('is the same woods for the same land and seed, and different woods for another seed', () => {
  expect(planForestFringe(input)).toEqual(planForestFringe(input));
  expect(planForestFringe({ ...input, seed: 'other' }).map(site => site.id)).not.toEqual(planForestFringe(input).map(site => site.id));
});
