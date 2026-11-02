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
    // Each channel's own grand-land-2 world (GW13; the grand-land-1 sketches of GW11 were never served). A changed
    // generator input is a new hash, so a pinned hash changing here means every stored sketch is a different land.
    expect(hashes.map(hash => hash.slice(0, 8))).toEqual(['a2766d2e', '899c96f0', '917af010']);
    expect(() => genesisSketchRecipe('129634568', 'tobi4s_')).toThrow(/No observed Genesis facts/);
  });
});
