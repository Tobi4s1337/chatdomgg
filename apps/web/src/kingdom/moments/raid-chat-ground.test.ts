import { describe, expect, it, vi } from 'vitest';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { raidChatGroundOf, raidPropGroundOf } from './raid-chat-ground';

const generated = generateSettlementPlan({ seed: 'raid-chat-ground', tier: 'hamlet', firstYear: 2026, year: 2026 });
function site(): SettlementPlan {
  const square = { ...generated.market, boundary: [[-90, -90], [-80, -90], [-80, -80], [-90, -80]] as const };
  return { ...generated, bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, reservations: [], streets: [], activeStreetIds: [],
    market: square, courts: [], castle: { ...generated.castle, court: square, bounds: { minX: -90, maxX: -80, minZ: -90, maxZ: -80 } },
    lake: { x: 50, z: 50, radiusX: 5, radiusZ: 5, level: 0 } };
}

describe('raid chat on the adopted surface', () => {
  it('samples the entire foot on actual raised ground and retains a bounded scene-local result', () => {
    const ground = vi.fn(() => 7), sample = raidChatGroundOf(site(), ground);
    expect(sample(20, 20)).toBe(7); expect(ground).toHaveBeenCalledTimes(5);
    expect(sample(20, 20)).toBe(7); expect(ground).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 300; i++) sample(20 + i / 1000, 20);
    const calls = ground.mock.calls.length;
    expect(sample(20, 20)).toBe(7); expect(ground.mock.calls.length).toBeGreaterThan(calls);
  });

  it('keeps whole feet outside lots, civic squares, roads, water and adopted bounds', () => {
    const plan = site(), reservation = generated.reservations[0]!;
    const sample = raidChatGroundOf({ ...plan, reservations: [{ ...reservation, lot: { ...reservation.lot, minX: 20, maxX: 25, minZ: 20, maxZ: 25 } }],
      streets: [{ id: 'road', from: 'a', to: 'b', kind: 'main', name: 'Road', points: [[0, 7, -50], [0, 7, 50]], width: 8, verge: 1 }], activeStreetIds: ['road'] }, () => 7);
    // The .6 m margins would fit an unrotated foot but clip its corner at a 45-degree gate.
    for (const [x, z] of [[19.4, 22], [-85, -85], [4.6, 0], [50, 50], [99.4, 10], [Infinity, 0]]) expect(sample(x!, z!)).toBeNull();
    expect(sample(5, 0)).toBe(7);
  });

  it('refuses unsupported, submerged and steep footprints instead of guessing a ground plane', () => {
    for (const ground of [() => NaN, () => Infinity, () => 0, () => { throw new Error('surface unavailable'); }, (x: number) => x === 20 ? 7 : 8]) {
      expect(raidChatGroundOf(site(), ground)(20, 20)).toBeNull();
    }
    expect(raidChatGroundOf(site(), x => 7 + (x - 20) / 20)(20, 20)).toBeCloseTo(6.9675);
  });

  it('rechecks current physical support after terrain is cached and fails closed on support loss', () => {
    let clear = true;
    const ground = vi.fn(() => 7), support = vi.fn(() => clear), sample = raidChatGroundOf(site(), ground, support);
    expect(sample(20, 20)).toBe(7);
    expect(support).toHaveBeenLastCalledWith({ foot: [20, 7, 20], radius: .65, height: 2.4 });
    clear = false; expect(sample(20, 20)).toBeNull();
    clear = true; expect(sample(20, 20)).toBe(7);
    expect(ground).toHaveBeenCalledTimes(5); expect(support).toHaveBeenCalledTimes(3);
    expect(raidChatGroundOf(site(), ground, () => { throw new Error('retired revision'); })(20, 20)).toBeNull();
  });
  it('refuses localized relief beneath a wide wall bay, between its centre and corners', () => {
    const ground = vi.fn((x: number, z: number) => x === 21 && z === 20 ? 7.5 : 7);
    const sample = raidPropGroundOf(site(), ground, { radius: 1.5, height: 4.5, maxRise: .18, sampleSpacing: .5 });
    expect(sample(20, 20)).toBeNull(); expect(ground).toHaveBeenCalledTimes(49);
  });

  it('checks the whole pennant footprint and its current physical support', () => {
    const support = vi.fn(() => true);
    const sample = raidPropGroundOf(site(), x => 7 + (x - 20) * .05, { radius: 1.5, height: 4.5, maxRise: .18, support });
    expect(sample(20, 20)).toBeCloseTo(6.925);
    expect(support).toHaveBeenCalledWith({ foot: [20, 6.925, 20], radius: 1.5, height: 4.5 });
    expect(raidPropGroundOf(site(), x => 7 + (x - 20) * .07, { radius: 1.5, height: 4.5, maxRise: .18 })(20, 20)).toBeNull();
    expect(sample(99, 10)).toBeNull();
  });

});
