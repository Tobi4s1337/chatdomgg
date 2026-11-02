import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { heroLensOnLand, type HeroLensInput } from './hero-lens';

// The native landscape hero: south-south-west of the market, looking north at the castle.
const market: Vec3 = [0, 9, 10];
const base = (height: HeroLensInput['height']): HeroLensInput => ({
  height, pivot: market, eye: [-110, 49, 170], target: [0, 29, 2], fov: 52, aspect: 16 / 9, seaLevel: 0,
});
const inside = (x: number, z: number) => Math.abs(x) < 1200 && Math.abs(z) < 1200;
const flat = (x: number, z: number) => inside(x, z) ? 8 : null;
/** A range rising to 110 m north-west of the market, just beyond the north lens's left edge. */
const western = (x: number, z: number) => inside(x, z) ? 8 + 102 * Math.exp(-(((x + 420) / 140) ** 2) - (((z + 260) / 260) ** 2)) : null;

describe('the hero lens on the grand land', () => {
  it('keeps the accepted north lens on a land without relief', () => {
    const lens = heroLensOnLand(base(flat));
    expect(lens.yaw).toBe(0);
    expect(lens.eye).toEqual([-110, 49, 170]);
  });
  it('turns toward real mountains, keeping the castle as target, the eye height and the market distance', () => {
    const lens = heroLensOnLand(base(western));
    expect(lens.yaw).toBeLessThan(0);
    expect(Math.abs(lens.yaw)).toBeLessThanOrEqual(40 * Math.PI / 180 + 1e-9);
    expect(lens.target).toEqual([0, 29, 2]);
    expect(lens.eye[1]).toBe(49);
    expect(Math.hypot(lens.eye[0] - market[0], lens.eye[2] - market[2])).toBeCloseTo(Math.hypot(-110, 160), 6);
    expect(lens.score).toBeGreaterThan(heroLensOnLand(base(flat)).score);
  });
  it('is deterministic and symmetric in its ties', () => {
    expect(heroLensOnLand(base(western))).toEqual(heroLensOnLand(base(western)));
    const mirrored = (x: number, z: number) => western(-x, z);
    const left = heroLensOnLand({ ...base(western), eye: [0, 49, 204], target: [0, 29, 2] });
    const right = heroLensOnLand({ ...base(mirrored), eye: [0, 49, 204], target: [0, 29, 2] });
    expect(right.yaw).toBeCloseTo(-left.yaw, 9);
  });
  it('never carries the eye off the land or into the ground', () => {
    // The range stands north-east, so the lens would turn right, swinging the eye west; a scarp there buries it.
    const eastern = (x: number, z: number) => western(-x, z);
    expect(heroLensOnLand(base(eastern)).yaw).toBeGreaterThan(0);
    // The land ends just west of the eye: no turn may carry the eye off it.
    const edged = (x: number, z: number) => !inside(x, z) || x < -115 ? null : eastern(x, z);
    const lens = heroLensOnLand(base(edged));
    expect(lens.yaw).toBeLessThanOrEqual(0);
    expect(edged(lens.eye[0], lens.eye[2])).not.toBeNull();
    // The current eye itself is buried: keep it rather than invent another pose.
    expect(heroLensOnLand(base((x, z) => inside(x, z) ? 60 : null)).yaw).toBe(0);
  });
  it('rejects a malformed camera', () => {
    expect(() => heroLensOnLand({ ...base(flat), fov: Number.NaN })).toThrow(/finite camera/);
    expect(() => heroLensOnLand({ ...base(flat), aspect: 0 })).toThrow(/finite camera/);
  });
});
