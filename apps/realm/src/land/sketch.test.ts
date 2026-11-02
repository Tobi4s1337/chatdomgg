import { describe, expect, it } from 'vitest';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { genesisSketchRecipe } from './sketch';

describe('Genesis sketch recipes', () => {
  it('key each channel by its full identity and Genesis profile, so no two channels share a land', async () => {
    const recipes = [['63920635', 'The_AGGman'], ['4363967', 'PinkKittyRose'], ['154972160', 'MashaD4']].map(([id, name]) => genesisSketchRecipe(id!, name!));
    for (const recipe of recipes) expect(recipe.seed.seedKey).toContain(recipe.seed.kingdomId);
    expect(recipes.map(recipe => recipe.seed.character)).toEqual(['coastal-harbour', 'river-valley', 'mountain-pass']);
    const hashes = await Promise.all(recipes.map(recipe => sha256Hex(utf8(canonicalSceneJson(recipe)))));
    expect(new Set(hashes).size).toBe(3);
    // Recorded with the sketch bakes in work/evidence/grand-world/GW11.md; a changed generator input is a new hash.
    expect(hashes.map(hash => hash.slice(0, 8))).toEqual(['972a725a', '042a265d', 'a15c1e23']);
    expect(() => genesisSketchRecipe('129634568', 'tobi4s_')).toThrow(/No observed Genesis facts/);
  });
});
