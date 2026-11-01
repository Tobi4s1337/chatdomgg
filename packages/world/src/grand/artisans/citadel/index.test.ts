import { describe, expect, it } from 'vitest';
import type { ArtisanKit } from '../kit';
import { createCitadel, createTownWalls } from './index';

function occupies(kit: ArtisanKit, x: number, y: number, z: number): boolean {
  return kit.boxes.some(({ min, size }) => x >= min[0] && x < min[0] + size[0]
    && y >= min[1] && y < min[1] + size[1] && z >= min[2] && z < min[2] + size[2]);
}

describe('grand citadel dressing', () => {
  it('is deterministic, bounded and retains a strong central peak', () => {
    const kit = createCitadel('tobi4s_');
    expect(createCitadel('tobi4s_')).toEqual(kit);
    expect(kit.boxes.length).toBeLessThan(6000);
    expect(kit.boxes.every(b => b.size.every(v => Number.isInteger(v) && v > 0))).toBe(true);
    const highest = Math.max(...kit.boxes.map(b => b.min[1] + b.size[1]));
    expect(highest).toBeGreaterThan(125);
    expect(kit.anchors.summit![1]).toBe(highest);
    expect(kit.boxes.some(b => b.colour === '#4d597e' && b.min[1] > 100)).toBe(true);
    // The entrance is a shadowed recess, not a painted slab flush with the frontage.
    expect(occupies(kit, 0, 18, -24)).toBe(false);
    // Each full riser is supported to ground and rises one cell into the entry.
    for (let step = 0; step < 13; step++) {
      const z = -62 + step * 2;
      for (let y = 0; y <= step; y++) expect(occupies(kit, 0, y, z)).toBe(true);
      expect(occupies(kit, 0, step + 1, z)).toBe(false);
    }
    expect(occupies(kit, 0, 12, -32)).toBe(true);
    expect(occupies(kit, 0, 13, -32)).toBe(false);
    expect(Math.min(...kit.boxes.map(b => b.min[2]))).toBe(-62);
    expect(Math.max(...kit.boxes.map(b => b.min[2] + b.size[2]))).toBeLessThanOrEqual(46);
    expect(occupies(kit, 0, 18, -13)).toBe(true);
  });
  it('leaves a clear entry beneath the gate lintel', () => {
    const walls = createTownWalls('mashad4');
    for (let z = -74; z < -70; z++) for (let x = -7; x <= 7; x++) for (let y = 0; y < 13; y++) {
      expect(occupies(walls, x, y, z)).toBe(false);
    }
    expect(occupies(walls, 0, 14, -74)).toBe(true);
    expect(occupies(walls, 40, 6, -74)).toBe(true);
  });
});
