import { expect, it } from 'vitest';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { createCastleContent } from '../castle-content';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { foundedGroundWindow, joinFoundedGround, sampleFoundedGroundBand } from '../terrain-founded';
import { lakeKeepOut, planAdoptedCover } from './adopted-cover';
import { prepareAdoptedCover } from './adopted-cover-prepare';
import { planAdoptedCoverFor } from './adopted-cover-request';

it('plans the grand floor\'s cover in another realm exactly as the scene plans it in place', async () => {
  const plan = generateSettlementPlan({ seed: 'adopted-cover-worker', tier: 'hamlet', firstYear: 2025, year: 2026 });
  expect(plan.version).toBe(2);
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  const occupied = [...houses, ...props, ...placeMarketContent(plan.market), ...createCastleContent(plan.castle).buildings];
  const keepClear = [{ x: 0, z: 8, radius: 7 }];
  const lake = plan.lake;
  // The scene's own closure, as it was written before the keep-out became a shared function.
  const waterKeepOut = (x: number, z: number, margin: number) =>
    Math.hypot((x - lake.x) / (lake.radiusX + margin), (z - lake.z) / (lake.radiusZ + margin)) < 1.19;
  for (const [x, z, m] of [[lake.x, lake.z, 0], [lake.x + lake.radiusX * 1.18, lake.z, 0], [lake.x + lake.radiusX * 1.2, lake.z, 0], [lake.x, lake.z + lake.radiusZ + 3, 2]] as const)
    expect(lakeKeepOut(plan)(x, z, m)).toBe(waterKeepOut(x, z, m));
  const inPlace = planAdoptedCover(plan, { ground: (x, z) => terrainHeight(plan, x, z), waterKeepOut, occupied, keepClear });
  expect([...inPlace.pieces.values()].flat().length).toBeGreaterThan(100);
  // The worker gets a structured clone of the plan, the occupied pieces and the ground workers' window.
  const window = foundedGroundWindow(plan);
  const ground = joinFoundedGround(plan, window, [sampleFoundedGroundBand({ plan: structuredClone(plan), window, part: 0, parts: 1 })]);
  const request = structuredClone({ plan, ground, occupied, keepClear });
  const elsewhere = structuredClone(planAdoptedCoverFor(request));
  expect(elsewhere).toEqual(inPlace);
  // Without the window the worker samples terrainHeight itself, to the same plan; without workers it plans here.
  expect(planAdoptedCoverFor(structuredClone({ plan, ground: null, occupied, keepClear }))).toEqual(inPlace);
  expect(await prepareAdoptedCover(structuredClone({ plan, ground, occupied, keepClear }))).toEqual(inPlace);
  const aborted = new AbortController(); aborted.abort();
  await expect(prepareAdoptedCover({ plan, ground, occupied, keepClear }, { signal: aborted.signal })).rejects.toThrow('closed');
}, 300_000);
