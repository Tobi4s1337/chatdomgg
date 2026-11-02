// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DISTANCE_SCALE } from './camera';
import { WASH_PX, WASH_RADIUS, washDetail, washPx, washSoftening } from './wash';

const WORLD = 0.3; // a whole-world view, well below continent distance
const REALM = DISTANCE_SCALE.realm;

describe('washSoftening', () => {
  it('is full strength from afar, up to just before realm distance', () => {
    for (const scale of [0.05, WORLD, DISTANCE_SCALE.continent, REALM * 0.6]) expect(washSoftening(scale)).toBe(1);
  });

  it('settles at about half strength (0.52) once the pennants have taken over', () => {
    for (const scale of [REALM * 1.2, DISTANCE_SCALE.kingdom, 40]) expect(washSoftening(scale)).toBeCloseTo(0.52, 12);
  });

  it('eases monotonically between the two, never below 0.52 or above 1', () => {
    let previous = Infinity;
    for (let scale = 0.1; scale <= 12; scale += 0.05) {
      const value = washSoftening(scale);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      expect(value).toBeGreaterThanOrEqual(0.52 - 1e-12);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    // At realm distance itself the ramp is two thirds of the way down (1 − 0.48 · 2/3).
    expect(washSoftening(REALM)).toBeCloseTo(0.68, 12);
  });
});

describe('washDetail', () => {
  it('is 0 at world and continent distance: one soft density layer', () => {
    for (const scale of [0.05, WORLD, DISTANCE_SCALE.continent, DISTANCE_SCALE.continent * 1.3]) expect(washDetail(scale)).toBe(0);
  });

  it('is 1 from just before realm distance on: every holding its own bloom', () => {
    for (const scale of [REALM * 0.8, REALM, DISTANCE_SCALE.kingdom, 40]) expect(washDetail(scale)).toBe(1);
  });

  it('cross-fades in between', () => {
    const mid = (DISTANCE_SCALE.continent * 1.3 + REALM * 0.8) / 2;
    expect(washDetail(mid)).toBeCloseTo(0.5, 12);
  });
});

describe('washPx', () => {
  it('scales the class radius with the camera inside its bounds', () => {
    expect(washPx(1, 5)).toBeCloseTo(WASH_RADIUS[1] * 5, 12); // 65 px, inside [15, 120]
    expect(washPx(3, 4)).toBeCloseTo(WASH_RADIUS[3] * 4, 12); // 16.8 px, inside [5.5, 46]
  });

  it('clamps every class to its WASH_PX bounds, far out and close in', () => {
    for (let liveClass = 1; liveClass <= 5; liveClass++) {
      const [min, max] = WASH_PX[liveClass]!;
      expect(washPx(liveClass, 0.001)).toBe(min);
      expect(washPx(liveClass, 1_000)).toBe(max);
      for (const scale of [0.1, 0.5, 1, 2, 4, 8, 16, 32]) {
        const px = washPx(liveClass, scale);
        expect(px).toBeGreaterThanOrEqual(min);
        expect(px).toBeLessThanOrEqual(max);
      }
    }
  });

  it('keeps a capital wider than a small stream at every scale', () => {
    for (const scale of [0.1, 1, 4, 16]) expect(washPx(1, scale)).toBeGreaterThan(washPx(5, scale));
  });

  it('paints nothing for an offline holding or an unknown class', () => {
    expect(washPx(0, 10)).toBe(0);
    expect(washPx(6, 10)).toBe(0);
    expect(washPx(-1, 10)).toBe(0);
  });
});
