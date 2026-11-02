import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../genesis';
import { adoptedGrandRecipe } from './adopted';
import { planGrandLand } from './plan';
import { freezeGrandLandRecipe, grandLandRecipeHash, type GrandLandRecipe } from './recipe';
import { grandMacroSketch } from './terrain';
import { GRAND_CREST_CLAY, GRAND_LANDFORMS, grandSeedFromGenesis, grandWorldTraits } from './world';

// A spread of real game categories (the curated Genesis dictionary maps some, others fall back), so the thousand
// channels span every biome and landscape the compiler can pick.
const GAMES = ['Just Chatting', 'Counter-Strike', 'Minecraft', 'Retro', 'Chess', 'Sea of Thieves', 'World of Warcraft',
  'Stardew Valley', 'Elden Ring', 'Fortnite', 'League of Legends', 'Music', 'Art', 'Animal Crossing', 'Valheim', 'Rust'];
const COLOURS = ['#9146ff', '#ff4f4f', '#2ecc71', '#f1c40f', '#00bcd4', '#ff8c00', '#e91e63', '#607d8b'];

function channel(i: number) {
  const id = String(10_000_019 + i * 7_919);
  const genesis = compileChannelGenesis({
    version: 1, broadcasterId: id, evidence: { kind: 'observed', sourceId: 'world-test', asOf: 1793377944392 },
    audience: { averageViewers: (i * 37) % 900, followers: null, windowHours: 24 },
    categories: [{ categoryId: `c${i % GAMES.length}`, name: GAMES[i % GAMES.length]!, observedMinutes: 120 }],
    profileColours: i % 3 ? [COLOURS[i % COLOURS.length]!] : [], approvedEmotes: [], approvedDescription: null, oldestFollowYear: null,
  });
  return grandSeedFromGenesis(genesis, `Channel ${i}`);
}

const sketchRecipe = (seed: ReturnType<typeof channel>): GrandLandRecipe => freezeGrandLandRecipe({
  version: 1, generator: 'grand-land-2', kit: 'grand-artisans-1', grader: 'gk11-grade-3', mesher: 'hosted-grand-land-2', seed,
  frame: { envelope: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 }, centre: [0, 0], waterLevel: 0, seaward: [0, 1],
    castle: { bounds: { minX: -16, maxX: 16, minZ: -48, maxZ: -16 }, centre: [0, 8, -32] } },
});

describe('every channel its own world', () => {
  it('keeps the adopted grand-land-1 plan byte for byte', () => {
    const seed = adoptedGrandRecipe('129634568')!.seed;
    expect(seed.world).toBeUndefined();
    const fingerprint = createHash('sha256').update(JSON.stringify(planGrandLand(seed))).digest('hex');
    expect(fingerprint).toBe('265ddf1468bb96aea5a88d66b6dc85b95a2287023db42fc577d87aa8bc91c199');
  });

  it('gives 1,000 channels 1,000 recipe hashes and 1,000 land layouts', async () => {
    const seeds = Array.from({ length: 1000 }, (_, i) => channel(i));
    const hashes = await Promise.all(seeds.map(seed => grandLandRecipeHash(sketchRecipe(seed))));
    expect(new Set(hashes).size).toBe(1000);
    const sketches = seeds.map(seed => grandMacroSketch(planGrandLand(seed), 32));
    const keys = new Set(sketches.map(s => Buffer.from(s).toString('base64')));
    expect(keys.size).toBe(1000);
    // Not merely different bits: any two layouts differ over a real share of the land.
    let closest = Infinity;
    for (let a = 0; a < sketches.length; a++) for (let b = a + 1; b < sketches.length; b++) {
      let differ = 0;
      const x = sketches[a]!, y = sketches[b]!;
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) differ++;
      if (differ < closest) closest = differ;
    }
    expect(closest).toBeGreaterThanOrEqual(32);
    // The thousand reach every landform, and no landform takes most of them.
    const forms = new Map<string, number>();
    for (const seed of seeds) forms.set(seed.world!.landform, (forms.get(seed.world!.landform) ?? 0) + 1);
    expect([...forms.keys()].sort()).toEqual([...GRAND_LANDFORMS].sort());
    expect(Math.max(...forms.values())).toBeLessThan(400);
  });

  it('chooses the same world for the same channel, and keeps the crest in clay', () => {
    const a = channel(42), b = channel(42);
    expect(a).toEqual(b);
    const traits = grandWorldTraits({ seedKey: '["channel","7"]', character: 'river-valley',
      identity: { biome: 'meadow', landmark: 'watermill', profileColourTargets: ['#00ff66', '#ff00ff'] } });
    expect(GRAND_CREST_CLAY).toContain(traits.crest.field);
    expect(traits.crest.charge).not.toBe(traits.crest.field);
    expect(traits.landmark).toBe('watermill');
    expect(() => grandWorldTraits({ seedKey: '', character: 'river-valley', identity: { biome: 'meadow', landmark: 'watermill', profileColourTargets: [] } })).toThrow();
  });

  it('names its generator by its seed', () => {
    const seed = channel(3);
    expect(() => freezeGrandLandRecipe({ ...sketchRecipe(seed), generator: 'grand-land-1' })).toThrow(/generator/);
    const adopted = adoptedGrandRecipe('129634568')!;
    expect(() => freezeGrandLandRecipe({ ...adopted, generator: 'grand-land-2' })).toThrow(/generator/);
  });

  it('gives each landform its own large form', () => {
    const base = channel(5);
    const plans = GRAND_LANDFORMS.map(landform => planGrandLand({ ...base, world: { ...base.world!, landform } }));
    for (const plan of plans) expect(plan.landform).toBeDefined();
    const byForm = Object.fromEntries(plans.map(plan => [plan.landform!, plan]));
    expect(byForm['lake-country']!.meres!.length).toBeGreaterThanOrEqual(2);
    expect(byForm.highland!.plateau!.height).toBeGreaterThan(15);
    expect(byForm['mountain-valley']!.spines.length).toBe(3);
    expect(byForm['river-delta']!.islets.length).toBeGreaterThan(byForm.island!.islets.length);
    expect(byForm['cliff-coast']!.seaStacks).toBeGreaterThan(byForm.island!.seaStacks);
    // The signature forest carries the groves.
    const groves = byForm.island!.groves, [dominant] = base.world!.forest;
    expect(Math.max(...Object.values(groves))).toBe(groves[dominant]);
  });
});
