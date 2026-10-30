import { describe, expect, it } from 'vitest';
import type { Box } from './camera';
import { MAX_SCALE } from './camera';
import {
  decorBand, DECOR_SPACING, levelFor, levelScale, MAX_LEVEL, parentOf, pyramidFor, TILE_PX, tileBox, tileKey,
  tilesFor, tileWorldSize, type Pyramid, type TileKey,
} from './pyramid';

const BOUNDS: Box = { minX: -1230, minY: -1445, maxX: 1360, maxY: 878 };
/** A world whose size is not a dyadic fraction, so tile edges are not exact binary numbers. */
const AWKWARD: Box = { minX: -1230.05, minY: -1445.15, maxX: 1360.35, maxY: 878.1 };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

const area = (box: Box) => Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
const intersect = (a: Box, b: Box): Box => ({ minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) });

describe('pyramidFor', () => {
  it('makes one square level-0 tile from the world origin that covers the longer side', () => {
    expect(pyramidFor(BOUNDS)).toEqual({ originX: -1230, originY: -1445, size: 2590 });
    expect(pyramidFor({ minX: 0, minY: 0, maxX: 10, maxY: 40 })).toEqual({ originX: 0, originY: 0, size: 40 });
  });

  it('halves the tile size and doubles the drawing scale per level', () => {
    const pyramid = pyramidFor(BOUNDS);
    for (let level = 0; level <= MAX_LEVEL; level++) {
      expect(tileWorldSize(pyramid, level)).toBe(2590 / 2 ** level);
      expect(levelScale(pyramid, level) * tileWorldSize(pyramid, level)).toBeCloseTo(TILE_PX, 9);
    }
  });
});

describe('levelFor', () => {
  const pyramid = pyramidFor(BOUNDS);

  it('is never blurrier than ~0.8 texel per device pixel, and never more than ~1.6', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (let scale = 0.05; scale <= MAX_SCALE; scale *= 1.013) {
        const level = levelFor(pyramid, scale, dpr);
        const texelsPerDevicePx = levelScale(pyramid, level) / (scale * dpr);
        // Clamping at level 0 can only make tiles sharper, clamping at MAX_LEVEL only blurrier.
        if (level > 0) expect(texelsPerDevicePx, `scale ${scale} dpr ${dpr}`).toBeLessThan(1.61);
        if (level < MAX_LEVEL) expect(texelsPerDevicePx, `scale ${scale} dpr ${dpr}`).toBeGreaterThanOrEqual(0.799);
      }
    }
  });

  it('only ever gets sharper as the camera zooms in', () => {
    let previous = 0;
    for (let scale = 0.01; scale <= 400; scale *= 1.01) {
      const level = levelFor(pyramid, scale, 1);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('clamps to 0 … MAX_LEVEL', () => {
    expect(levelFor(pyramid, 1e-6, 1)).toBe(0);
    expect(levelFor(pyramid, 0.0001, 2)).toBe(0);
    expect(levelFor(pyramid, 1e6, 2)).toBe(MAX_LEVEL);
  });

  it('reaches about level 9 at the deepest laptop zoom', () => {
    expect(levelFor(pyramid, MAX_SCALE, 1)).toBe(9);
  });
});

describe('tileBox and tileKey', () => {
  it('tiles the pyramid without gaps or overlaps at every level', () => {
    for (const bounds of [BOUNDS, AWKWARD]) {
      const pyramid = pyramidFor(bounds);
      for (const level of [0, 1, 5, 9, MAX_LEVEL]) {
        const count = 2 ** level;
        const step = Math.max(1, Math.floor(count / 64));
        for (let t = 0; t + 1 < count; t += step) {
          const a = tileBox(pyramid, { level, tx: t, ty: t });
          const right = tileBox(pyramid, { level, tx: t + 1, ty: t });
          const below = tileBox(pyramid, { level, tx: t, ty: t + 1 });
          // Neighbours meet within float rounding; a hairline larger than 1e-9 world units would be a gap.
          expect(Math.abs(a.maxX - right.minX)).toBeLessThan(1e-9);
          expect(Math.abs(a.maxY - below.minY)).toBeLessThan(1e-9);
          expect(right.minY).toBe(a.minY);
          expect(below.minX).toBe(a.minX);
        }
        const last = tileBox(pyramid, { level, tx: count - 1, ty: count - 1 });
        expect(last.maxX).toBeCloseTo(pyramid.originX + pyramid.size, 9);
        expect(last.maxY).toBeCloseTo(pyramid.originY + pyramid.size, 9);
      }
    }
  });

  it('names tiles level/x/y', () => {
    expect(tileKey({ level: 9, tx: 300, ty: 17 })).toBe('9/300/17');
  });
});

describe('parentOf', () => {
  it('has no parent at level 0', () => {
    expect(parentOf({ level: 0, tx: 0, ty: 0 })).toBeNull();
  });

  it('maps all four children to the one tile that contains them', () => {
    const pyramid = pyramidFor(BOUNDS);
    for (const parent of [{ level: 0, tx: 0, ty: 0 }, { level: 3, tx: 5, ty: 2 }, { level: 10, tx: 1023, ty: 511 }]) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const child: TileKey = { level: parent.level + 1, tx: parent.tx * 2 + dx, ty: parent.ty * 2 + dy };
        expect(parentOf(child)).toEqual(parent);
        const inner = tileBox(pyramid, child);
        const outer = tileBox(pyramid, parent);
        expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - 1e-9);
        expect(inner.maxX).toBeLessThanOrEqual(outer.maxX + 1e-9);
        expect(inner.minY).toBeGreaterThanOrEqual(outer.minY - 1e-9);
        expect(inner.maxY).toBeLessThanOrEqual(outer.maxY + 1e-9);
      }
    }
  });

  it('walks back to level 0 from the deepest tile', () => {
    let key: TileKey | null = { level: MAX_LEVEL, tx: 2047, ty: 1234 };
    let steps = 0;
    while ((key = parentOf(key))) steps++;
    expect(steps).toBe(MAX_LEVEL);
  });
});

describe('tilesFor', () => {
  const pyramid: Pyramid = pyramidFor(BOUNDS);
  const world: Box = { minX: pyramid.originX, minY: pyramid.originY, maxX: pyramid.originX + pyramid.size, maxY: pyramid.originY + pyramid.size };

  it('covers exactly the part of the view inside the pyramid, with no duplicate or stray tiles', () => {
    const random = seeded(3);
    for (let i = 0; i < 300; i++) {
      const level = Math.floor(random() * 10);
      const tile = tileWorldSize(pyramid, level);
      const w = Math.min(random() * 900, random() * 14 * tile) + 0.01;
      const h = Math.min(random() * 700, random() * 14 * tile) + 0.01;
      const view: Box = { minX: -1600 + random() * 3000, minY: -1800 + random() * 2600, maxX: 0, maxY: 0 };
      view.maxX = view.minX + w;
      view.maxY = view.minY + h;
      const keys = tilesFor(pyramid, level, view);
      expect(new Set(keys.map(tileKey)).size).toBe(keys.length);
      const target = intersect(view, world);
      let covered = 0;
      for (const key of keys) {
        const inRange = key.level === level && key.tx >= 0 && key.ty >= 0 && key.tx < 2 ** level && key.ty < 2 ** level;
        const part = intersect(tileBox(pyramid, key), target);
        // Every tile returned touches the view (a tile merely sharing an edge contributes zero area).
        const touches = part.maxX >= part.minX && part.maxY >= part.minY;
        if (!inRange || !touches) expect.fail(`stray tile ${tileKey(key)} for view ${JSON.stringify(view)}`);
        covered += area(part);
      }
      expect(covered).toBeCloseTo(area(target), 6);
    }
  });

  it('puts the tile under the centre of the view first and the rest by distance', () => {
    const view: Box = { minX: -300, minY: -200, maxX: 260, maxY: 180 };
    const keys = tilesFor(pyramid, 6, view);
    expect(keys.length).toBeGreaterThan(20);
    const first = tileBox(pyramid, keys[0]!);
    const cx = (view.minX + view.maxX) / 2;
    const cy = (view.minY + view.maxY) / 2;
    expect(cx >= first.minX && cx <= first.maxX && cy >= first.minY && cy <= first.maxY).toBe(true);
    const distance = (key: TileKey) => {
      const box = tileBox(pyramid, key);
      return Math.hypot((box.minX + box.maxX) / 2 - cx, (box.minY + box.maxY) / 2 - cy);
    };
    for (let i = 1; i < keys.length; i++) expect(distance(keys[i]!)).toBeGreaterThanOrEqual(distance(keys[i - 1]!));
  });

  it('returns the single root tile at level 0 and nothing for a view off the pyramid', () => {
    expect(tilesFor(pyramid, 0, { minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 })).toEqual([{ level: 0, tx: 0, ty: 0 }]);
    expect(tilesFor(pyramid, 4, { minX: 5000, minY: 0, maxX: 6000, maxY: 100 })).toEqual([]);
    expect(tilesFor(pyramid, 4, { minX: -9000, minY: -9000, maxX: -8000, maxY: -8000 })).toEqual([]);
  });

  it('asks for a bounded number of tiles for a laptop screen at any zoom', () => {
    for (let scale = 0.3; scale <= MAX_SCALE; scale *= 1.07) {
      for (const dpr of [1, 2]) {
        const level = levelFor(pyramid, scale, dpr);
        const halfW = 720 / scale;
        const halfH = 450 / scale;
        const keys = tilesFor(pyramid, level, { minX: -halfW, minY: -halfH, maxX: halfW, maxY: halfH });
        // 1440×900 CSS px of 256-px tiles at up to 1.6 texels per device px: (ceil(1440·1.6·dpr/256)+1)·(…+1).
        const across = Math.ceil((1440 * 1.61 * dpr) / TILE_PX) + 1;
        const down = Math.ceil((900 * 1.61 * dpr) / TILE_PX) + 1;
        expect(keys.length).toBeLessThanOrEqual(across * down);
      }
    }
  });
});

describe('decorBand', () => {
  it('steps from 0 to the last band as the camera zooms in, and never back', () => {
    let previous = 0;
    for (let scale = 0.01; scale <= 100; scale *= 1.02) {
      const band = decorBand(scale);
      expect(band).toBeGreaterThanOrEqual(previous);
      expect(band).toBeGreaterThanOrEqual(0);
      expect(band).toBeLessThan(DECOR_SPACING.length);
      previous = band;
    }
    expect(decorBand(0.01)).toBe(0);
    expect(decorBand(100)).toBe(DECOR_SPACING.length - 1);
  });

  it('keeps the on-screen decor spacing near 50 px while a band is in range', () => {
    for (let scale = 0.37; scale <= 11.7; scale *= 1.01) {
      const spacingPx = DECOR_SPACING[decorBand(scale)]! * scale;
      expect(spacingPx).toBeGreaterThanOrEqual(50 / Math.SQRT2 - 1e-9);
      expect(spacingPx).toBeLessThanOrEqual(50 * Math.SQRT2 + 1e-9);
    }
  });

  it('halves the spacing from one band to the next', () => {
    for (let i = 1; i < DECOR_SPACING.length; i++) expect(DECOR_SPACING[i]! * 2).toBe(DECOR_SPACING[i - 1]);
  });
});
