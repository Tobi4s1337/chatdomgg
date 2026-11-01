import { describe, expect, it } from 'vitest';
import { voxels } from '../../../places/water/piece-checks';
import { aggmanPieceFailures, BUILDING_BUDGET } from '../checks';
import { createQuaySegment, type QuaySegmentSite } from './quay';

// A shore that falls from the quay to below the sea across the segment's depth.
const site = (extra: Partial<QuaySegmentSite> = {}): QuaySegmentSite => ({
  id: 'test', length: 128, depth: 68, top: 24, water: 0,
  ground: (x, z) => 23 - z * .4 + Math.sin(x * .1) * 1.5, ...extra,
});

describe('harbour quay segment', () => {
  it('meets the piece bar and stands on its lowest sampled ground', () => {
    const piece = createQuaySegment(site());
    expect(aggmanPieceFailures(piece, BUILDING_BUDGET)).toEqual([]);
    expect(piece.base).toBeLessThan(0);
    expect(piece.blueprint.size[1]).toBe(24 - piece.base + 8);
  });

  it('is deterministic and names its sampled shape', () => {
    expect(createQuaySegment(site())).toEqual(createQuaySegment(site()));
    expect(createQuaySegment(site()).blueprint.id).not.toBe(createQuaySegment(site({ ground: (x, z) => 22 - z * .45 })).blueprint.id);
  });

  it('keeps its walking top flush and cuts a clear stair down to the landing', () => {
    const piece = createQuaySegment(site({ stair: { from: 40, to: 64, landing: 6 } }));
    expect(aggmanPieceFailures(piece, BUILDING_BUDGET)).toEqual([]);
    const { at } = voxels(piece.blueprint), top = 24 - piece.base;
    expect(at(10, top - 1, 10)).not.toBe(0);
    expect(at(10, top, 10)).toBe(0);
    // Inside the stair, every tread is lower than the one before and the landing is reached.
    let previous = Infinity;
    for (let z = 0; z < 60; z += 6) {
      let surface = top;
      while (surface > 0 && at(52, surface - 1, z) === 0) surface--;
      expect(surface).toBeLessThanOrEqual(previous);
      previous = surface;
    }
    expect(previous).toBeLessThanOrEqual(6 - piece.base + 2);
  });

  it('refuses a quay that would not stand clear of the water', () => {
    expect(() => createQuaySegment(site({ top: 3 }))).toThrow();
    expect(() => createQuaySegment(site({ length: 300 }))).toThrow();
  });
});
