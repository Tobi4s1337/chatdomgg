import { describe, expect, it } from 'vitest';
import { CLAY } from '../kit';
import { createFieldPlot, createFields, createWindmill, createWindmillParts, fieldLayout } from './index';

describe('grand fields', () => {
  it('makes four dry parcels around continuous lanes, with all three crops', () => {
    for (const seed of ['129634568', '63920635', '4363967', '154972160']) {
      const { plots, laneWidth } = fieldLayout(seed);
      expect(plots).toHaveLength(4);
      expect(new Set(plots.map(p => p.crop))).toEqual(new Set(['wheat', 'lavender', 'cabbage']));
      expect(plots[1]!.x0 - plots[0]!.x1).toBe(laneWidth);
      expect(plots[2]!.z0 - plots[0]!.z1).toBe(laneWidth);
      for (const p of plots) {
        expect(p.x1 - p.x0).toBeGreaterThanOrEqual(35);
        expect(p.z1 - p.z0).toBeGreaterThanOrEqual(35);
      }
      const kit = createFields(seed);
      const [lx, , lz] = kit.anchors.lane!;
      expect(plots.every(p => lx < p.x0 || lx >= p.x1 || lz < p.z0 || lz >= p.z1)).toBe(true);
    }
  });
  it('accepts individual fitted plots and rejects undersized or fractional bounds', () => {
    const plot = { x0: -20, z0: 12, x1: 10, z1: 40, crop: 'lavender', rows: 'x' } as const;
    const kit = createFieldPlot(plot);
    expect(kit.anchors.centre).toEqual([-5, 1, 26]);
    expect(kit.boxes.every(box => box.min[0] >= plot.x0 && box.min[2] >= plot.z0 && box.min[0] + box.size[0] <= plot.x1 && box.min[2] + box.size[2] <= plot.z1)).toBe(true);
    expect(() => createFieldPlot({ ...plot, x1: -15 })).toThrow(RangeError);
    expect(() => createFieldPlot({ ...plot, z0: 12.5 })).toThrow(RangeError);
    expect(() => createFieldPlot({ ...plot, x1: 1000 })).toThrow(RangeError);
  });
  it('is repeatable per full seed and varies parcel boundaries', () => {
    expect(createFields('a')).toEqual(createFields('a'));
    expect(fieldLayout('a')).not.toEqual(fieldLayout('b'));
  });
  it('leaves a supported entrance and an unfilled ground-floor room', () => {
    const kit = createWindmill('129634568');
    const occupied = (x: number, y: number, z: number) => kit.boxes.some(box =>
      x >= box.min[0] && x < box.min[0] + box.size[0] &&
      y >= box.min[1] && y < box.min[1] + box.size[1] &&
      z >= box.min[2] && z < box.min[2] + box.size[2]);
    // 2 m wide, 3.5 m high, from the outside step into the middle of the room.
    for (let x = -2; x < 2; x++) for (let y = 5; y < 12; y++) for (let z = 0; z < 12; z++) {
      expect(occupied(x, y, z), `blocked at ${x},${y},${z}`).toBe(false);
    }
    for (let x = -2; x < 2; x++) for (let z = 0; z < 12; z++) expect(occupied(x, 4, z)).toBe(true);
    for (let x = -5; x < 5; x++) for (let y = 5; y < 12; y++) for (let z = -4; z < 4; z++) {
      expect(occupied(x, y, z), `room filled at ${x},${y},${z}`).toBe(false);
    }
  });
  it('forms a grounded mill with a hub and four framed sail quadrants', () => {
    const mill = createWindmill('129634568');
    const hub = mill.anchors.sailHub!;
    expect(mill.boxes.some(box => box.min[1] === 0 && box.colour === CLAY.stoneDark)).toBe(true);
    const cloth = mill.boxes.filter(box => box.colour === CLAY.sail);
    expect(cloth.length).toBeGreaterThan(50);
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      expect(cloth.some(box => (box.min[0] - hub[0]) * sx > 4 && (box.min[1] - hub[1]) * sy > 4)).toBe(true);
    }
    expect(mill.boxes.every(box => box.size.every(v => Number.isInteger(v) && v > 0))).toBe(true);
    expect(createWindmill('129634568')).toEqual(mill);
    const parts = createWindmillParts('129634568');
    expect(parts.sails.anchors.sailHub).toEqual(hub);
    expect(parts.sails.boxes.length + parts.body.boxes.length).toBe(mill.boxes.length);
    expect(parts.body.boxes.some(box => box.colour === CLAY.sail)).toBe(false);
    expect(parts.sails.boxes.some(box => box.colour === CLAY.sail)).toBe(true);
  });
});
