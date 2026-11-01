import { describe, expect, it } from 'vitest';
import { createHarbour, createLighthouse, createQuay, createQuayInlandStairs, createQuaySection, createShip } from './index';
import { KitBuilder, type ArtisanKit, type Point } from '../kit';

function occupied(kit: ArtisanKit, [x, y, z]: Point): boolean {
  return kit.boxes.some(({ min, size }) => x >= min[0] && x < min[0] + size[0]
    && y >= min[1] && y < min[1] + size[1] && z >= min[2] && z < min[2] + size[2]);
}

describe('grand harbour kit', () => {
  it('keeps valid integer boxes and deterministic, independently seeded silhouettes', () => {
    for (const make of [createShip, createLighthouse, createQuay, createHarbour]) {
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

  it('exports a bounded quay whose piles connect tide bed and pier deck', () => {
    const quay = createQuay('test');
    const min = [0, 1, 2].map(i => Math.min(...quay.boxes.map(b => b.min[i]!)));
    const max = [0, 1, 2].map(i => Math.max(...quay.boxes.map(b => b.min[i]! + b.size[i]!)));
    expect(min).toEqual([-61, -5, -32]);
    expect(max).toEqual([63, 12, 23]);
    expect(quay.anchors.shoreJoin).toEqual([0, 6, 21]);
    expect(quay.anchors.quayTop).toEqual([0, 8, 10]);
    for (const x of [-38, -31, 22, 29]) for (const z of [-29, -20, -11, -2]) {
      for (let y = -5; y <= 8; y++) expect(occupied(quay, [x, y, z])).toBe(true);
    }
    // The isolated quay has neither an offshore ship nor a tower in the headland sky.
    expect(occupied(quay, [-35, 0, -45])).toBe(false);
    expect(occupied(quay, [54, 40, 20])).toBe(false);
  });

  it('joins the raised cap to sampled dry land with supported treads and a flush apron', () => {
    const heights = [9, 8, 7], ground = [...Array<number>(12).fill(5), ...Array<number>(12).fill(7), ...Array<number>(12).fill(7)];
    const kit = createQuayInlandStairs(heights, ground, Array<number>(12).fill(7));
    expect(kit.anchors).toEqual({ quay: [0, 9, 23], land: [0, 7, 29], 'apron-end': [0, 7, 31] });
    for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
      const box = kit.boxes[row * 6 + col]!, top = heights[Math.floor(row / 2)]!, g = ground[row * 6 + col]!;
      expect(box.min).toEqual([col - 3, Math.min(g, top - 1), 23 + row]);
      expect(box.min[1] + box.size[1]).toBe(top);
    }
    for (const box of kit.boxes.slice(-12)) expect(box.min[1] + box.size[1]).toBe(7);
    expect(Math.max(...kit.boxes.map(b => b.min[2] + b.size[2]))).toBe(31);
    expect(createQuayInlandStairs([8], Array<number>(12).fill(8), Array<number>(12).fill(8)).anchors.quay).toEqual([0, 8, 23]);
  });

  it('rejects floating, submerged, obstructed, disconnected or steep stair routes', () => {
    const ground = [...Array<number>(12).fill(7), ...Array<number>(12).fill(7)];
    expect(() => createQuayInlandStairs([9, 7], ground, Array<number>(12).fill(7))).toThrow();
    expect(() => createQuayInlandStairs([9, 8], ground, Array<number>(12).fill(8))).toThrow(); // last tread is not joined
    expect(() => createQuayInlandStairs([9], Array<number>(12).fill(0), Array<number>(12).fill(9))).toThrow();
    expect(() => createQuayInlandStairs([9], Array<number>(12).fill(10), Array<number>(12).fill(9))).toThrow();
    expect(() => createQuayInlandStairs([9], Array<number>(12).fill(9), Array<number>(12).fill(8))).toThrow();
    expect(() => createQuayInlandStairs([7], Array<number>(12).fill(7), Array<number>(12).fill(7))).toThrow();
  });

  it.each([-4, -2, 0, 2, 4] as const)('seats the stair against every back-edge column with offset %s', offset => {
    const section = createQuaySection('realm', 'frontage', offset);
    const stair = createQuayInlandStairs([9], Array<number>(12).fill(9), Array<number>(12).fill(9), offset);
    for (let x = -3; x < 3; x++) {
      const shift = Math.round((x + 8) / 15 * offset);
      expect(occupied(section, [x, 8, 22 + shift])).toBe(true);
      expect(occupied(stair, [x, 8, 23 + shift])).toBe(true);
    }
  });

  it('retains the same ordered review assembly when its parts are placed independently', () => {
    const seed = 'broadcaster:123';
    const assembled = new KitBuilder();
    assembled.add(createQuay(seed));
    assembled.add(createShip(`${seed}:west-berth`), [-35, 0, -45]);
    assembled.add(createShip(`${seed}:east-berth`), [28, 0, -48], 2);
    assembled.add(createLighthouse(seed), [54, 8, 20]);
    expect(createHarbour(seed).boxes).toEqual(assembled.boxes);
  });

  it.each([
    ['frontage', 1], ['pier', -32], ['landing', -8],
  ] as const)('makes an independently grounded %s section with a flush 16-cell shore join', (kind, minZ) => {
    const section = createQuaySection('realm', kind);
    const min = [0, 1, 2].map(i => Math.min(...section.boxes.map(b => b.min[i]!)));
    const max = [0, 1, 2].map(i => Math.max(...section.boxes.map(b => b.min[i]! + b.size[i]!)));
    expect(min).toEqual([-8, -5, minZ]);
    expect(max).toEqual([8, 12, 23]);
    expect(section.anchors['shore-left']).toEqual([-8, 6, 21]);
    expect(section.anchors['shore-right']).toEqual([8, 6, 21]);
    expect(section.anchors.deck).toEqual([0, 9, 10]);
    expect(section).toEqual(createQuaySection('realm', kind));
    for (let x = -8; x < 8; x++) {
      expect(occupied(section, [x, -5, 20])).toBe(true);
      expect(occupied(section, [x, 8, 21])).toBe(true);
      expect(occupied(section, [x, 9, 21])).toBe(false);
    }
  });

  it.each([-4, -2, 0, 2, 4] as const)('joins neighbouring frontages continuously with shore offset %s', offset => {
    const first = createQuaySection('realm', 'frontage', offset);
    const second = createQuaySection('realm');
    expect(first.anchors['shore-right']).toEqual([8, 6, 21 + offset]);
    const combined = new KitBuilder(); combined.add(first); combined.add(second, [16, 0, offset]);
    const kit = combined.finish('joined');
    // Across each individual column transition there is a broad connected cap,
    // and the two independent sections meet on the join's two sides.
    for (let x = -8; x < 23; x++) {
      const a = first.boxes.filter(b => b.min[0] === x && b.min[1] === 6 && b.size[1] === 3)[0];
      if (x < 7 && a) expect(occupied(kit, [x + 1, 8, a.min[2] + 10])).toBe(true);
    }
    for (let z = 3 + offset; z < 20 + offset; z++) {
      expect(occupied(kit, [7, 8, z])).toBe(true);
      expect(occupied(kit, [8, 8, z])).toBe(true);
    }
  });

  it('carries the pier deck into its piles and the landing down to tide level', () => {
    const pier = createQuaySection('realm', 'pier'), landing = createQuaySection('realm', 'landing');
    for (const x of [-4, 3]) for (const z of [-29, -20, -11, -2]) {
      for (let y = -5; y <= 8; y++) expect(occupied(pier, [x, y, z])).toBe(true);
    }
    for (let n = 0; n < 9; n++) expect(occupied(landing, [0, -1 + n, -8 + n])).toBe(true);
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
