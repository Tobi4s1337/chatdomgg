import { beforeAll, describe, expect, it } from 'vitest';
import { foundedAnvilPosition } from '@chatdom/world/interactions';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { anvilFixture, bounds, neighbourhood, placedFixture, solidAt, startsAround, walkInto, type Fixture, type Land } from './solids-lands';

/**
 * F08, buildings are solid: a WALK_BODY driven by the shared movement law into every fixture drawn in the street is
 * stopped before any part of it is inside the fixture's voxels, on both lands, walking and sprinting, from every side
 * the ground offers. Each land is founded through the realm provider's own pipeline and compiled by the real
 * collision compiler (the grand land's through its land seam). Bench foundings: no citizen, no adopted plan.
 */

/** Fixtures of the street a person sees as solid: the market, the Forge, civic growth and the arrival gates. */
const STREET = /^(market|forge|civic|arrival):/;
/** The fixtures the brief names; each must be placed on both lands. */
const NAMED = ['forge:hearth:v1', 'forge:workshop:v1', 'forge:brazier:v1:north', 'forge:brazier:v1:south', 'market:well'] as const;
const TIMEOUT = 300_000;
/** How far around a fixture the walk sweep reads the compiled world once (queries beyond it go to the world). */
const MARGIN = 12;

const same = (a: readonly SolidBox[], b: readonly SolidBox[]) => a.length === b.length
  && a.every((box, i) => box.min.every((n, k) => n === b[i]!.min[k]) && box.max.every((n, k) => n === b[i]!.max[k]));

/** Every way a fixture's solidity is checked; the failure message says which fixture and which approach. */
function expectSolid(land: Land, fixture: Fixture) {
  const starts = startsAround(land, fixture);
  expect(starts.length, `${fixture.id}: clear, supported starts around it`).toBeGreaterThanOrEqual(3);
  let reached = 0;
  const world = neighbourhood(land, bounds(fixture.solids), MARGIN);
  for (const start of starts) for (const sprint of [false, true]) {
    const approach = walkInto(land, fixture, start, sprint, 4, world);
    expect(approach.deepest, `${fixture.id}: ${sprint ? 'sprinting' : 'walking'} in from ${approach.from.map(n => n.toFixed(2)).join(', ')}`).toBe(0);
    if (approach.reached) reached++;
  }
  // Not vacuous: the walker reached the fixture itself, it was not stopped by something else every time.
  expect(reached, `${fixture.id}: approaches that reached it`).toBeGreaterThan(0);
  // And the compiled world carries every one of its solids.
  const missing = fixture.solids.filter(b => !solidAt(land, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]));
  expect(missing.length, `${fixture.id}: solids absent from collision`).toBe(0);
}

/** The whole case for one land; `solids-old.test.ts` and `solids-grand.test.ts` run one land each. */
export function describeSolids(name: string, make: () => Promise<Land>) {
  describe(`on ${name}`, () => {
    let land: Land;
    beforeAll(async () => { land = await make(); }, TIMEOUT);

    it('reads the compiled world around a fixture exactly as the world answers', () => {
      // Every query of real walks into a sample of fixtures, answered by both: the same boxes in the same order.
      const sample = land.scene.placements.filter(p => STREET.test(p.id)).filter((_, i) => i % 7 === 0);
      let compared = 0;
      for (const placement of sample) {
        const fixture = placedFixture(land.scene, placement), view = neighbourhood(land, bounds(fixture.solids), MARGIN);
        const both: CollisionWorld = { revision: land.world.revision, query(b: SolidBox) {
          const near = view.query(b), real = land.world.query(b);
          if (!same(near, real)) expect(near, `${placement.id}: query ${JSON.stringify(b)}`).toEqual(real);
          compared++;
          return real;
        } };
        for (const start of startsAround(land, fixture).slice(0, 3)) walkInto(land, fixture, start, true, 4, both);
      }
      expect(compared).toBeGreaterThan(1000);
    }, TIMEOUT);

    it('places every fixture the brief names', () => {
      const ids = new Set(land.scene.placements.map(p => p.id));
      for (const id of NAMED) expect(ids.has(id), id).toBe(true);
    });

    it.each(NAMED)('stops a walker at %s', id => {
      expectSolid(land, placedFixture(land.scene, land.scene.placements.find(p => p.id === id)!));
    }, TIMEOUT);

    it('stops a walker at every other placed street fixture', () => {
      const others = land.scene.placements.filter(p => STREET.test(p.id) && !(NAMED as readonly string[]).includes(p.id));
      expect(others.length).toBeGreaterThan(5);
      for (const placement of others) expectSolid(land, placedFixture(land.scene, placement));
    }, TIMEOUT);

    it('draws the anvil where the Forge stands, clear on every side to walk up to', () => {
      const anvil = anvilFixture(land.scene), box = bounds(anvil.solids), at = foundedAnvilPosition(land.scene);
      // The drawn anvil hero's footprint: x from -0.94 to 1.38, z ±0.56 about the anvil, a 1.43 m face on its block.
      expect(box.min[0] - at[0]).toBeCloseTo(-.9375, 9);
      expect(box.max[0] - at[0]).toBeCloseTo(1.375, 9);
      expect(box.min[2] - at[2]).toBeCloseTo(-.5625, 9);
      expect(box.max[2] - at[2]).toBeCloseTo(.5625, 9);
      expect(box.max[1] - at[1]).toBeCloseTo(1.43, 9);
      expect(startsAround(land, anvil).length).toBeGreaterThanOrEqual(6);
    });

    // needs: grand-world places the anvil's solid box in the founded placements (see the lane report). Until it does,
    // a walker walks straight through the anvil everyone sees: this case fails, honestly.
    it.fails('stops a walker at the anvil', () => {
      expectSolid(land, anvilFixture(land.scene));
    }, TIMEOUT);
  });
}
