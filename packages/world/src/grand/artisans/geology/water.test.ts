import { describe, expect, it } from 'vitest';
import { createWaterDressSampler } from './water';

function field() {
  const size = 5, ground = new Uint16Array(size * size).fill(10), water = new Uint16Array(size * size);
  // A high reach meets a lower receiving reach across the x=2/3 boundary; a dry bank is beside both.
  for (let z = 1; z <= 3; z++) {
    water[1 + z * size] = 20; water[2 + z * size] = 20; water[3 + z * size] = 14;
  }
  return { size, ground, water };
}

describe('grand water observations', () => {
  it('preserves source levels, depths and a receiving reach without creating water on the bank', () => {
    const sample = createWaterDressSampler(field());
    expect(sample(2, 2)).toEqual({ wet: true, level: 20, depth: 10, dryNeighbours: 0, largestWetDrop: 6, lowerNeighbour: [1, 0] });
    expect(sample(3, 2)).toMatchObject({ wet: true, level: 14, depth: 4, dryNeighbours: 1, largestWetDrop: 0, lowerNeighbour: null });
    expect(sample(4, 2)).toMatchObject({ wet: false, level: 0, depth: 0 });
  });
  it('never wraps rows or treats an unknown field boundary as a dry shoreline', () => {
    const size = 3, ground = new Uint16Array(size * size).fill(4), water = new Uint16Array(size * size).fill(8);
    const sample = createWaterDressSampler({ size, ground, water });
    expect(sample(0, 1)).toMatchObject({ wet: true, dryNeighbours: 0, largestWetDrop: 0 });
    expect(sample(-1, 1)).toBeNull(); expect(sample(3, 1)).toBeNull(); expect(sample(1, 1.5)).toBeNull();
  });
  it('does not invent a receiving pool when a wet reach ends against dry ground', () => {
    const data = field(); data.water[3 + 2 * data.size] = 0;
    const sample = createWaterDressSampler(data);
    expect(sample(2, 2)).toMatchObject({ dryNeighbours: 1, largestWetDrop: 0, lowerNeighbour: null });
  });
  it('rejects incomplete backing fields', () => {
    expect(() => createWaterDressSampler({ size: 2, ground: new Uint16Array(4), water: new Uint16Array(3) })).toThrow(RangeError);
  });
});
