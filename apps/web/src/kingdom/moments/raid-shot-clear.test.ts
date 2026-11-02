import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { RAID_SHOT_SOLIDS, raidShotClearOf } from './raid-shot-clear';

const generated = generateSettlementPlan({ seed: 'raid-shot-clear', tier: 'hamlet', firstYear: 2026, year: 2026 });
function site(): SettlementPlan {
  const home = generated.homes[0] ?? { ...generated.reservations[0]!, slot: 0, tier: 'cottage', allowedDepth: 1, style: 'hearth', variant: 0 } as SettlementPlan['homes'][number];
  return { ...generated, homes: [{ ...home, lot: { ...home.lot, minX: 20, maxX: 28, minZ: 20, maxZ: 36 } }],
    castle: { ...generated.castle, bounds: { minX: -90, maxX: -70, minZ: -90, maxZ: -70 } } };
}

describe('the gate shot standing check from the adopted plan', () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const clear = raidShotClearOf(site(), () => 2);

  it('keeps an eye over open street with a clear line to the gate', () => {
    expect(clear(v(0, 14, 40), v(0, 3, 0))).toBe(true);
  });

  it('refuses an eye inside or just beside a built home, under the ground or over the castle', () => {
    expect(clear(v(24, 8, 28), v(0, 3, 0))).toBe(false);
    expect(clear(v(28 + RAID_SHOT_SOLIDS.pad - 0.1, 8, 28), v(0, 3, 0))).toBe(false);
    expect(clear(v(0, 3, 40), v(0, 3, 0))).toBe(false);
    expect(clear(v(-80, 30, -80), v(-60, 3, -60))).toBe(false);
  });

  it('refuses a line of sight through a home below its conservative height, and allows one well over it', () => {
    expect(clear(v(40, 6, 28), v(0, 3, 28))).toBe(false);
    expect(clear(v(40, 40, 28), v(0, 30, 28))).toBe(true);
  });

  it('never stands where the adopted surface cannot be read', () => {
    const missing = raidShotClearOf(site(), () => { throw new Error('no terrain'); });
    expect(missing(v(0, 14, 40), v(0, 3, 0))).toBe(false);
    expect(clear(v(Number.NaN, 14, 40), v(0, 3, 0))).toBe(false);
  });
});
