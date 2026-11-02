import { describe, expect, it } from 'vitest';
import type { SettlementPlan } from '../settlement/types';
import { fishingPierCandidates, FISHING_PIER_CANDIDATE_BUDGET } from './pier-fishing-candidates';

const square = { id: 'market', boundary: [[-6, -6], [-2, -6], [-2, -2], [-6, -2]] as const, elevation: 2, nodeId: 'market' };
const lake = { x: 20, z: 30, radiusX: 10, radiusZ: 10, level: 1 };
const plan: SettlementPlan = { version: 2, revision: 'candidate-layout', config: { seed: 'pier-tests', tier: 'hamlet', firstYear: 2025, year: 2026 },
  landform: { version: 1, seed: 1, ridge: { origin: [0, 0], bearing: 0, length: 10, width: 5, height: 2 },
    castleRise: { centre: [0, 0], radius: 4, height: 2 }, lake }, lake,
  homes: [], reservations: [], quarters: [], nodes: [], streets: [], activeStreetIds: [], market: square, courts: [],
  castle: { centre: [0, 2, 0], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, modules: [], court: square, gateNodeId: 'gate', beaconModuleId: 'beacon' },
  bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 } };
const ground = (x: number, z: number) => [x, 2, z] as const;
const hint = () => 1;

describe('fishing pier candidate search', () => {
  it('enumerates stable seed, lateral, back and walk schedules without duplicates or rerolls', () => {
    const candidates = [...fishingPierCandidates(plan, ground, hint)];
    expect(candidates).toHaveLength(FISHING_PIER_CANDIDATE_BUDGET.candidates);
    expect(candidates.slice(0, 3).map(c => [c.turn, c.root, c.walk])).toEqual([
      [0, [20, 2, 14.5], 20], [0, [20, 2, 14.5], 16], [0, [20, 2, 14.5], 12],
    ]);
    expect(candidates.slice(0, 15).filter((_, i) => i % 3 === 0).map(c => c.root)).toEqual([
      [20, 2, 14.5], [20, 2, 14.25], [20, 2, 14], [20, 2, 13.75], [20, 2, 13.5],
    ]);
    expect(candidates[15]?.root).toEqual([24, 2, 14.5]);
    expect([0, 135, 270, 405].map(i => candidates[i]?.turn)).toEqual([0, 1, 2, 3]);
    expect(candidates[135]?.root).toEqual([4.5, 2, 30]);
    expect(new Set(candidates.map(c => JSON.stringify([c.turn, c.root, c.walk]))).size).toBe(candidates.length);
    expect([...fishingPierCandidates(plan, ground, hint)]).toEqual(candidates);
  });
  it('does not offer a root when physical ground is unknown, malformed or for a different point', () => {
    for (const badGround of [() => null, (x: number, z: number) => [x + 1, 2, z] as const,
      (x: number, z: number) => [x, NaN, z] as const]) {
      expect([...fishingPierCandidates(plan, badGround, hint)]).toEqual([]);
    }
  });
  it('requires a finite shoreline hint matching the lake level', () => {
    for (const badHint of [() => null, () => NaN, () => Infinity, () => 1.1]) {
      expect([...fishingPierCandidates(plan, ground, badHint)]).toEqual([]);
    }
  });
  it('fails before scanning an oversized ray and caps total shoreline samples', () => {
    const largePlan = (radius: number): SettlementPlan => ({ ...plan, landform: { ...plan.landform,
      lake: { ...lake, radiusX: radius, radiusZ: radius } } });
    let samples = 0;
    const missing = () => { samples++; return null; };
    expect(() => [...fishingPierCandidates(largePlan(400), ground, missing)]).toThrow('Pier shoreline ray exceeds its budget');
    expect(samples).toBe(0);
    expect(() => [...fishingPierCandidates(largePlan(350), ground, missing)]).toThrow('Pier shoreline sample budget exhausted');
    expect(samples).toBe(FISHING_PIER_CANDIDATE_BUDGET.shoreSamples);
  });
});
