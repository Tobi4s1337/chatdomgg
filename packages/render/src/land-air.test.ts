import { describe, expect, it } from 'vitest';
import { getEnvironment, GRAND_LAND_AIR, withLandAir } from './atmosphere';
import { NATIVE_LAND_AIR } from './voxel-material';

describe('land air', () => {
  it('keeps the native land exactly as it was', () => {
    const golden = getEnvironment(17.5);
    expect(withLandAir(golden, null)).toBe(golden);
    expect(NATIVE_LAND_AIR).toEqual({ lowHaze: 2.2, clear: 65 });
  });

  it('thins the air over a grand land at every hour without changing its colour', () => {
    for (const hour of [6.5, 12, 17.5, 22]) {
      const native = getEnvironment(hour), grand = withLandAir(native, GRAND_LAND_AIR);
      expect(grand.fogDensity).toBeLessThan(native.fogDensity);
      expect(grand.fogDensity).toBeGreaterThan(0);
      expect(grand.fog).toBe(native.fog);
      expect(grand.sun).toBe(native.sun);
    }
    expect(GRAND_LAND_AIR.lowHaze).toBeLessThan(NATIVE_LAND_AIR.lowHaze);
    expect(GRAND_LAND_AIR.clear).toBeGreaterThan(NATIVE_LAND_AIR.clear);
  });
});
