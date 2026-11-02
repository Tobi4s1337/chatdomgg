// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CollisionGrid, comparePriority, LETTER_CLEARANCE, MARK_PX, overlaps, underLettering, type Rect } from './collide';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

describe('overlaps', () => {
  it('is symmetric and does not count touching edges or corners', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
    for (const [b, expected] of [
      [{ x: 9.99, y: 9.99, w: 5, h: 5 }, true],
      [{ x: 10, y: 0, w: 5, h: 10 }, false], // shares the right edge
      [{ x: 0, y: -5, w: 10, h: 5 }, false], // shares the top edge
      [{ x: 10, y: 10, w: 5, h: 5 }, false], // shares a corner
      [{ x: 2, y: 2, w: 1, h: 1 }, true], // inside
      [{ x: -5, y: -5, w: 30, h: 30 }, true], // around
      [{ x: -5, y: 4, w: 30, h: 1 }, true], // a bar straight through
    ] as const) {
      expect(overlaps(a, b)).toBe(expected);
      expect(overlaps(b, a)).toBe(expected);
    }
  });
});

describe('CollisionGrid', () => {
  it('lets the first box claim its patch and refuses overlapping ones', () => {
    const grid = new CollisionGrid(1440, 900);
    expect(grid.take({ x: 100, y: 100, w: 80, h: 20 })).toBe(true);
    expect(grid.free({ x: 150, y: 110, w: 80, h: 20 })).toBe(false);
    expect(grid.take({ x: 150, y: 110, w: 80, h: 20 })).toBe(false);
    expect(grid.take({ x: 180, y: 100, w: 40, h: 20 })).toBe(true); // touching on the right is fine
  });

  it('does not claim anything when take is refused', () => {
    const grid = new CollisionGrid(1440, 900);
    grid.take({ x: 0, y: 0, w: 50, h: 50 });
    expect(grid.take({ x: 40, y: 0, w: 50, h: 50 })).toBe(false);
    // Overlaps only the refused box: still free.
    expect(grid.take({ x: 60, y: 0, w: 20, h: 20 })).toBe(true);
  });

  it('finds a large claim from a small box in a far cell it spans', () => {
    const grid = new CollisionGrid(1440, 900);
    grid.claim({ x: 10, y: 10, w: 600, h: 400 });
    expect(grid.free({ x: 600, y: 400, w: 5, h: 5 })).toBe(false);
    expect(grid.free({ x: 610, y: 410, w: 5, h: 5 })).toBe(true);
    // And the other way round: a small claim blocks a large box that spans its cell.
    const other = new CollisionGrid(1440, 900);
    other.claim({ x: 700, y: 500, w: 3, h: 3 });
    expect(other.free({ x: 0, y: 0, w: 1440, h: 900 })).toBe(false);
  });

  it('handles boxes at negative coordinates, inside and beyond the margin', () => {
    const grid = new CollisionGrid(390, 844, 256);
    expect(grid.take({ x: -40, y: -30, w: 60, h: 40 })).toBe(true);
    expect(grid.free({ x: -10, y: 0, w: 5, h: 5 })).toBe(false);
    // Far past the margin, everything collapses into the edge cells; that must not invent collisions…
    expect(grid.take({ x: -2000, y: -2000, w: 30, h: 30 })).toBe(true);
    expect(grid.take({ x: -1000, y: -2000, w: 30, h: 30 })).toBe(true);
    // …nor miss real ones.
    expect(grid.free({ x: -1990, y: -1990, w: 5, h: 5 })).toBe(false);
    expect(grid.free({ x: -985, y: -1985, w: 30, h: 30 })).toBe(false);
  });

  it('handles boxes past the right and bottom edges without false hits from wrapped cells', () => {
    const grid = new CollisionGrid(390, 844, 64); // 10 columns of 64 px, counted from x = −64
    // Column 11 of row 1 and column 1 of row 2 share one cell key: (650, 0) and (10, 70) land in the same bucket.
    expect(grid.take({ x: 650, y: 0, w: 5, h: 5 })).toBe(true);
    expect(grid.take({ x: 10, y: 70, w: 5, h: 5 })).toBe(true);
    expect(grid.take({ x: 652, y: 2, w: 5, h: 5 })).toBe(false);
    expect(grid.take({ x: 12, y: 72, w: 5, h: 5 })).toBe(false);
    expect(grid.take({ x: 5000, y: 0, w: 20, h: 20 })).toBe(true);
    expect(grid.take({ x: 5005, y: 5, w: 5, h: 5 })).toBe(false);
    expect(grid.take({ x: 5, y: 3000, w: 5, h: 5 })).toBe(true);
    expect(grid.free({ x: 8, y: 3003, w: 5, h: 5 })).toBe(false);
  });

  it('accepts exactly what a brute-force greedy pass accepts', () => {
    const random = seeded(2026);
    for (const [width, height, margin] of [[1440, 900, 256], [390, 844, 0], [1920, 1080, 64]] as const) {
      const grid = new CollisionGrid(width, height, margin);
      const accepted: Rect[] = [];
      for (let i = 0; i < 1500; i++) {
        const big = i % 40 === 0;
        const rect: Rect = {
          x: -700 + random() * (width + 1400),
          y: -700 + random() * (height + 1400),
          w: big ? 200 + random() * 500 : 4 + random() * 90,
          h: big ? 100 + random() * 300 : 4 + random() * 30,
        };
        // Snap a share of boxes to a 16-px lattice so that touching edges occur often.
        if (i % 3 === 0) {
          rect.x = Math.round(rect.x / 16) * 16;
          rect.y = Math.round(rect.y / 16) * 16;
          rect.w = Math.max(16, Math.round(rect.w / 16) * 16);
          rect.h = Math.max(16, Math.round(rect.h / 16) * 16);
        }
        const expected = accepted.every((other) => !overlaps(rect, other));
        expect(grid.take(rect)).toBe(expected);
        if (expected) accepted.push(rect);
      }
      expect(accepted.length).toBeGreaterThan(50);
    }
  });
});

describe('comparePriority', () => {
  const holding = (tierRank: number, average: number, id: string) => ({ tierRank, average, id });

  it('puts the bigger tier first, then the larger average, then the smaller channel ID by number', () => {
    const list = [
      holding(1, 900, '5'),
      holding(0, 6_000, '700'),
      holding(1, 4_000, '100'),
      holding(1, 900, '10'),
      holding(1, 900, '9'),
      holding(0, 33_015, '552120296'),
      holding(3, 25, '1'),
    ];
    expect(list.sort(comparePriority)).toEqual([
      holding(0, 33_015, '552120296'),
      holding(0, 6_000, '700'),
      holding(1, 4_000, '100'),
      holding(1, 900, '5'),
      holding(1, 900, '9'),
      holding(1, 900, '10'),
      holding(3, 25, '1'),
    ]);
  });

  it('never lets a hamlet outrank a village, whatever its audience', () => {
    expect(comparePriority(holding(4, 24, '1'), holding(3, 25, '999999999'))).toBeGreaterThan(0);
    expect(comparePriority(holding(4, 4_000, '1'), holding(3, 25, '999999999'))).toBeGreaterThan(0);
    expect([holding(4, 900, '2'), holding(3, 25, '7'), holding(4, 12, '1')].sort(comparePriority))
      .toEqual([holding(3, 25, '7'), holding(4, 900, '2'), holding(4, 12, '1')]);
  });

  it('marks a hamlet a step smaller than a village, so it gives way under lettering only where its dot would touch', () => {
    expect(MARK_PX).toHaveLength(5);
    expect(MARK_PX[4]).toBeLessThan(MARK_PX[3]);
    const name: Rect = { x: 300, y: 100, w: 80, h: 30 };
    expect(underLettering(300 - MARK_PX[4] / 2 - LETTER_CLEARANCE + 0.5, 115, 4, [name])).toBe(true);
    expect(underLettering(300 - MARK_PX[3] / 2 - LETTER_CLEARANCE + 0.1, 115, 4, [name])).toBe(false);
  });

  it('orders channel IDs numerically, not as text', () => {
    expect(comparePriority(holding(2, 50, '99'), holding(2, 50, '100'))).toBeLessThan(0);
    expect(comparePriority(holding(2, 50, '36926489'), holding(2, 50, '207813352'))).toBeLessThan(0);
    expect(comparePriority(holding(2, 50, '207813352'), holding(2, 50, '207813353'))).toBeLessThan(0);
    expect(comparePriority(holding(2, 50, '207813352'), holding(2, 50, '207813352'))).toBe(0);
  });

  it('is a total order: antisymmetric, transitive, and independent of the input order', () => {
    const random = seeded(11);
    const items = Array.from({ length: 400 }, () => holding(
      Math.floor(random() * 4),
      [25, 50, 500, 900, 5_000][Math.floor(random() * 5)]!,
      String(1 + Math.floor(random() * (random() < 0.5 ? 50 : 2e9))),
    ));
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j += 7) {
        const ab = Math.sign(comparePriority(items[i]!, items[j]!));
        const ba = Math.sign(comparePriority(items[j]!, items[i]!));
        expect(ab).toBe(-ba || 0);
        if (ab === 0) expect(items[i]).toEqual(items[j]);
      }
    }
    const key = (list: typeof items) => list.map((h) => `${h.tierRank}:${h.average}:${h.id}`).join(',');
    const sorted = key([...items].sort(comparePriority));
    for (let round = 0; round < 5; round++) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(key(shuffled.sort(comparePriority))).toBe(sorted);
    }
    // Sorted output is consistent with pairwise comparison (transitivity over the chain).
    const chain = [...items].sort(comparePriority);
    for (let i = 1; i < chain.length; i++) expect(comparePriority(chain[i - 1]!, chain[i]!)).toBeLessThanOrEqual(0);
  });
});

describe('underLettering', () => {
  const name: Rect = { x: 100, y: 100, w: 200, h: 30 };
  it('lifts a survey mark inside a name or within its clearance, by the mark’s own size', () => {
    expect(underLettering(200, 115, 0, [name])).toBe(true);
    // Just outside the right edge, but the capital's mark plus clearance still reaches in.
    expect(underLettering(300 + MARK_PX[0] / 2 + LETTER_CLEARANCE - 0.5, 115, 0, [name])).toBe(true);
    // A village's smaller mark at the same spot clears it.
    expect(underLettering(300 + MARK_PX[0] / 2 + LETTER_CLEARANCE - 0.5, 115, 3, [name])).toBe(false);
    expect(underLettering(200, 160, 0, [name])).toBe(false);
  });
  it('never lifts anything when nothing is lettered', () => {
    expect(underLettering(200, 115, 0, [])).toBe(false);
  });
});
