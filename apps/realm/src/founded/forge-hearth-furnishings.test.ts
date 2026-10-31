import { describe, expect, it } from 'vitest';
import { generateSettlementPlan } from '@chatdom/world';
import { enrichNativeForgeHearth } from './forge-hearth-furnishings';
import { enrichNativeMarket } from './market-furnishings';
import { enrichNativeMarketSeats } from './market-seats';
import { createNativeTown } from './native';

describe('founded forge hearth', () => {
  it('appends a deterministic complete group without altering the adopted fixtures', () => {
    const plan = generateSettlementPlan({ seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 });
    const native = enrichNativeMarketSeats(plan, enrichNativeMarket(plan, createNativeTown(plan)));
    const result = enrichNativeForgeHearth(plan, native);
    expect(result.fixtures.slice(native.fixtures.length).map(p => p.id)).toEqual([
      'forge:hearth:v1', 'forge:brazier:v1:north', 'forge:brazier:v1:south']);
    expect(result.homes).toBe(native.homes);
    native.fixtures.forEach((piece, i) => expect(result.fixtures[i]).toBe(piece));
    expect(enrichNativeForgeHearth(plan, native)).toEqual(result);
    expect(enrichNativeForgeHearth(plan, result)).toBe(result);
    const obstructed = { ...native, fixtures: [...native.fixtures, result.fixtures.at(-1)!] };
    expect(enrichNativeForgeHearth(plan, obstructed)).toBe(obstructed);
    const blocked = { ...native, fixtures: [...native.fixtures, { ...result.fixtures.at(-1)!, id: 'other:fixture' }] };
    expect(enrichNativeForgeHearth(plan, blocked)).toBe(blocked);
  }, 15_000);
});
