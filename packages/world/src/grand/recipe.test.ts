import { describe, expect, it } from 'vitest';
import { generateSettlementPlan } from '../settlement/generator';
import { seatKingdomOnLand } from './kingdom';
import type { GrandField, GrandFieldSites } from './kingdom/types';
import { createGrandLandRecipe, freezeGrandLandRecipe, grandLandRecipeHash, type GrandLandRecipe } from './recipe';
import type { GrandLandSeed } from './types';

const config = { seed: 'willowmere', firstYear: 2025, year: 2026 };
const profile: Omit<GrandLandSeed, 'minSize'> = {
  seedKey: 'twitch:129634568', kingdomId: '129634568', name: 'Willowmere',
  biome: 'meadow', tier: 'hamlet', character: 'river-valley',
};
const plan = () => generateSettlementPlan({ ...config, tier: 'hamlet' });

function field(): GrandField & { sites: Pick<GrandFieldSites, 'town' | 'harbour'> } {
  const size = 1024, n = size * size;
  const ground = new Uint16Array(n); ground.fill(60);
  return { size, height: 384, seaLevel: 48, ground, water: new Uint16Array(n),
    cover: new Uint8Array(n), coast: new Int8Array(n), trees: new Float32Array(), treeCount: 0,
    sites: { town: { x: 512, z: 512, rx: 200, rz: 150, angle: 0, level: 60 },
      harbour: { x: 512, z: 900, facing: Math.PI / 2 } } };
}

describe('founded grand land recipe', () => {
  it('uses the selected profile rather than current home styles or tier', async () => {
    const hamlet = plan();
    const changed = structuredClone(hamlet);
    changed.config.tier = 'town';
    changed.homes[0]!.style = changed.homes[0]!.style === 'hearth' ? 'tide' : 'hearth';
    const a = createGrandLandRecipe(hamlet, profile), b = createGrandLandRecipe(changed, profile);
    expect(a.seed).toMatchObject(profile);
    expect(b.seed).toEqual(a.seed);
    expect(await grandLandRecipeHash(b)).toBe(await grandLandRecipeHash(a));
  });

  it('holds the recipe and seat while reserved homes are built', async () => {
    const hamlet = plan(), town = generateSettlementPlan({ ...config, tier: 'town' });
    expect(town.homes.length).toBeGreaterThan(hamlet.homes.length);
    const recipe = createGrandLandRecipe(hamlet, profile);
    const hash = await grandLandRecipeHash(recipe);
    const before = seatKingdomOnLand(field(), hamlet, recipe.frame);
    const after = seatKingdomOnLand(field(), town, recipe.frame);
    expect(after.seat.offset).toEqual(before.seat.offset);
    expect(await grandLandRecipeHash(recipe)).toBe(hash);
    expect(recipe.seed.minSize).toBeGreaterThan(0);
  }, 60_000);

  it('binds full identity and each version to the hash', async () => {
    const recipe = createGrandLandRecipe(plan(), profile), original = await grandLandRecipeHash(recipe);
    const other = createGrandLandRecipe(plan(), { ...profile, kingdomId: '4294967296', seedKey: 'twitch:4294967296' });
    expect(await grandLandRecipeHash(other)).not.toBe(original);
    for (const key of ['version', 'generator', 'kit', 'grader', 'mesher'] as const) {
      const altered = { ...recipe, [key]: key === 'version' ? 2 : `${recipe[key]}-next` } as unknown as GrandLandRecipe;
      expect(await grandLandRecipeHash(altered)).not.toBe(original);
    }
    expect(() => createGrandLandRecipe(plan(), { ...profile, seedKey: 'twitch:123' })).toThrow('full kingdom identity');
  });

  it('deep freezes a detached copy without freezing the caller’s plan or profile', () => {
    const ownedPlan = plan(), ownedProfile = { ...profile };
    const recipe = createGrandLandRecipe(ownedPlan, ownedProfile);
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.seed)).toBe(true);
    expect(Object.isFrozen(recipe.frame.envelope)).toBe(true);
    expect(Object.isFrozen(recipe.frame.castle.bounds)).toBe(true);
    expect(Object.isFrozen(ownedPlan.castle.bounds)).toBe(false);
    expect(Object.isFrozen(ownedProfile)).toBe(false);
    const copy = freezeGrandLandRecipe(recipe);
    expect(copy).toEqual(recipe);
    expect(copy.frame.castle.bounds).not.toBe(recipe.frame.castle.bounds);
  });

  it('rejects an installed region outside its founded reservation', () => {
    const hamlet = plan(), recipe = createGrandLandRecipe(hamlet, profile);
    const outside = { ...hamlet, bounds: { ...hamlet.bounds, maxX: recipe.frame.envelope.maxX + 32 } };
    expect(() => seatKingdomOnLand(field(), outside, recipe.frame)).toThrow('The installed region exceeds its founded land reservation');
  });
});
