import { describe, expect, it } from 'vitest';
import { tavernInteriorEnvironment, tavernLight, tavernLightSources } from './light';

describe('tavern lighting', () => {
  it('bakes the hearth and every authored lantern into one local field', () => {
    const sources = tavernLightSources([11.125, 1, 1.5]);
    expect(sources).toHaveLength(4);
    const field = tavernLight(sources);
    const sample = (x: number, y: number, z: number) => {
      const [nx, ny] = field.size;
      const ix = Math.floor((x - field.origin[0]) / field.cellSize);
      const iy = Math.floor((y - field.origin[1]) / field.cellSize);
      const iz = Math.floor((z - field.origin[2]) / field.cellSize);
      return field.light[ix + nx * (iy + ny * iz)]!;
    };
    for (const source of sources) expect(sample(...source)).toBeGreaterThanOrEqual(12);
    // The aisle between the hearth and lanterns retains shadow instead of
    // accumulating all sources into a room-wide orange wash.
    expect(sample(13, 1, 8)).toBeLessThan(sample(...sources[1]!) / 2);
    expect(sample(3, 1.3, 4.5)).toBeGreaterThan(sample(13, 1, 8));
    expect(field.surfaceSamples.length).toBeGreaterThan(0);
  });

  it('keeps the interior sheltered at both daytime and dusk', () => {
    for (const hour of [12, 19]) {
      const grade = tavernInteriorEnvironment(hour);
      expect(grade.night).toBeGreaterThanOrEqual(.85);
      expect(grade.ambientIntensity).toBeLessThan(1);
      expect(grade.sunIntensity).toBeLessThan(.2);
    }
  });
});
