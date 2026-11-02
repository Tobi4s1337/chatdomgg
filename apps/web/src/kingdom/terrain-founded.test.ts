import { expect, it } from 'vitest';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { compileFoundedScene, foundedTerrainFrame, primeFoundedTerrain, sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import { foundedGroundWindow, foundedHeightSampler, joinFoundedGround, prepareFoundedGround, sampleFoundedGroundBand } from './terrain-founded';

it('samples the founded floor and height window in bands identical to the main-thread samplers', async () => {
  const plan = generateSettlementPlan({ seed: 'founded-ground-bands', tier: 'hamlet', firstYear: 2025, year: 2026 });
  // A worker receives a structured clone: its own plan object, its own terrain caches.
  const copy = structuredClone(plan), window = foundedGroundWindow(copy);
  const bands = [2, 0, 1].map(part => sampleFoundedGroundBand({ plan: structuredClone(copy), window, part, parts: 3 }));
  const ground = joinFoundedGround(copy, window, bands);
  const terrain = sampleFoundedTerrain(plan);
  expect(ground.floor).not.toBeNull();
  expect(Array.from(ground.floor!)).toEqual(Array.from(terrain.heights as Float32Array));
  const frame = foundedTerrainFrame(plan)!;
  expect([frame.columns, frame.rows, frame.origin]).toEqual([terrain.columns, terrain.rows, terrain.origin]);
  for (let z = 0; z < window.depth; z += 7) for (let x = 0; x < window.width; x += 5)
    expect(ground.height[x + z * window.width]).toBe(Math.fround(terrainHeight(plan, window.origin[0] + x, window.origin[1] + z)));
  // Without workers the same result is sampled in place.
  const local = await prepareFoundedGround(structuredClone(plan));
  expect(Array.from(local.floor!)).toEqual(Array.from(ground.floor!));
  expect(Array.from(local.height)).toEqual(Array.from(ground.height));
  expect(() => joinFoundedGround(copy, window, bands.slice(1))).toThrow();
}, 120_000);

it('primes the founded collision floor only with an exact installed grid', () => {
  const plan = generateSettlementPlan({ seed: 'founded-ground-prime', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const window = foundedGroundWindow(plan);
  const { floor } = joinFoundedGround(plan, window, [sampleFoundedGroundBand({ plan: structuredClone(plan), window, part: 0, parts: 1 })]);
  expect(() => primeFoundedTerrain(plan, floor!.subarray(1))).toThrow('wrong shape');
  const odd = Float32Array.from(floor!); odd[3] = odd[3]! + .25;
  expect(() => primeFoundedTerrain(plan, odd)).toThrow('installed floor');
  primeFoundedTerrain(plan, floor!);
  const copy = structuredClone(plan);
  // An equal plan reads the primed floor; it is a copy, so callers cannot change the cache.
  const primed = sampleFoundedTerrain(copy);
  expect(Array.from(primed.heights as Float32Array)).toEqual(Array.from(floor!));
  expect(compileFoundedScene).toBeTypeOf('function');
}, 120_000);

it('answers ground queries from the workers\' corners exactly as terrainHeight does', () => {
  const plan = generateSettlementPlan({ seed: 'founded-ground-sampler', tier: 'town', firstYear: 2025, year: 2026 });
  expect(plan.version).toBe(2);
  const window = foundedGroundWindow(plan);
  // The corners come from another realm, as from a worker; the queries run against a fresh plan's own caches.
  const ground = joinFoundedGround(plan, window, [sampleFoundedGroundBand({ plan: structuredClone(plan), window, part: 0, parts: 1 })]);
  const fresh = structuredClone(plan), sample = foundedHeightSampler(fresh, ground);
  expect(sample).not.toBeNull();
  const [ox, oz] = window.origin;
  // Inside the window, on its last metre and just outside it (where the sampler defers to terrainHeight).
  for (let z = oz - 3.3; z < oz + window.depth + 3; z += 1.37) for (let x = ox - 2.9; x < ox + window.width + 3; x += 1.13)
    expect(sample!(x, z)).toBe(terrainHeight(fresh, x, z));
  for (const [x, z] of [[ox + 10, oz + 10], [ox + 10.5, oz + 10.5], [ox + 10.25, oz + 10.75], [ox + 10.75, oz + 10.25], [ox + window.width - 1.5, oz + window.depth - 1.5]] as const)
    expect(sample!(x, z)).toBe(terrainHeight(fresh, x, z));
  // Corners that are not this plan's are refused, and so is a window of the wrong size.
  const wrong = Float32Array.from(ground.height, value => value + 0.25);
  expect(foundedHeightSampler(structuredClone(plan), { window, height: wrong })).toBeNull();
  expect(foundedHeightSampler(structuredClone(plan), { window, height: ground.height.subarray(1) })).toBeNull();
}, 120_000);
