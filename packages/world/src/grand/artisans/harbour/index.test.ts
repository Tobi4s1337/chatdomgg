import { describe, expect, it } from 'vitest';
import { createHarbour, createLighthouse, createShip } from './index';
import type { ArtisanKit, Point } from '../kit';

function occupied(kit: ArtisanKit, [x, y, z]: Point): boolean {
  return kit.boxes.some(({ min, size }) => x >= min[0] && x < min[0] + size[0]
    && y >= min[1] && y < min[1] + size[1] && z >= min[2] && z < min[2] + size[2]);
}

describe('grand harbour kit', () => {
  it('keeps valid integer boxes and deterministic, independently seeded silhouettes', () => {
    for (const make of [createShip, createLighthouse, createHarbour]) {
      const a = make('broadcaster:123');
      expect(a).toEqual(make('broadcaster:123'));
      expect(a.boxes.length).toBeGreaterThan(50);
      for (const { min, size, colour } of a.boxes) {
        expect([...min, ...size].every(Number.isInteger)).toBe(true);
        expect(size.every(v => v > 0)).toBe(true);
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('places the hull across the tide and carries its masts from the deck', () => {
    const ship = createShip('test');
    expect(ship.anchors.waterline).toEqual([0, 0, 0]);
    expect(occupied(ship, [0, -2, 0])).toBe(true);
    expect(occupied(ship, [0, 4, 0])).toBe(true);
    expect(occupied(ship, [-5, 6, 0])).toBe(true);
    expect(occupied(ship, [-5, 36, 0])).toBe(true);
    expect(occupied(ship, [12, 6, 0])).toBe(true);
  });

  it('ties the quay, piers and landing to the waterline and foundations', () => {
    const harbour = createHarbour('test');
    expect(harbour.anchors.seaLevel).toEqual([0, 0, 0]);
    for (const x of [-38, -31, 22, 29]) {
      expect(occupied(harbour, [x, -4, -29])).toBe(true);
      expect(occupied(harbour, [x, 7, -29])).toBe(true);
    }
    for (let n = 0; n < 9; n++) expect(occupied(harbour, [10, -1 + n, -8 + n])).toBe(true);
    expect(occupied(harbour, [54, 7, 20])).toBe(true);
    expect(occupied(harbour, [54, 8, 20])).toBe(true);
  });

  it('keeps the lighthouse entry clear through to its room, over a solid floor', () => {
    const tower = createLighthouse('test');
    for (let z = -11; z <= 0; z++) {
      for (let y = 1; y <= 8; y++) expect(occupied(tower, [0, y, z])).toBe(false);
      expect(occupied(tower, [0, 0, z])).toBe(true);
    }
  });
});
