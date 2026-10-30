import { describe, expect, it } from 'vitest';
import type { Box } from './camera';
import { clipPolygon, detailRing } from './paint';
import { levelScale, pyramidFor, tileBox } from './pyramid';

/** Shoelace area, signed (positive for counter-clockwise in a y-up frame). */
function signedArea(points: readonly number[]): number {
  let sum = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i * 2]! * points[j * 2 + 1]! - points[j * 2]! * points[i * 2 + 1]!;
  }
  return sum / 2;
}

const inside = (points: readonly number[], box: Box, eps = 1e-9) => {
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < box.minX - eps || x > box.maxX + eps || y < box.minY - eps || y > box.maxY + eps) return false;
  }
  return true;
};

const WIDE: Box = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

/** The output of detailRing between the original vertex `from` and the next original vertex `to`, both included. */
function segmentOf(out: readonly number[], from: [number, number], to: [number, number]): number[] {
  let start = -1;
  for (let i = 0; i < out.length; i += 2) if (out[i] === from[0] && out[i + 1] === from[1]) start = i;
  if (start < 0) throw new Error('segment start not found');
  for (let i = start + 2; i <= out.length; i += 2) {
    const at = i % out.length;
    if (out[at] === to[0] && out[at + 1] === to[1]) {
      const pieces = [];
      for (let k = start; k <= i; k += 2) pieces.push(out[k % out.length]!, out[(k % out.length) + 1]!);
      return pieces;
    }
  }
  throw new Error('segment end not found');
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe('clipPolygon', () => {
  const box: Box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('leaves a polygon inside the box untouched, vertex for vertex', () => {
    const square = [2, 2, 8, 2, 8, 8, 2, 8];
    expect(clipPolygon(square, box)).toEqual(square);
  });

  it('returns nothing for a polygon entirely outside the box', () => {
    expect(clipPolygon([20, 20, 30, 20, 30, 30], box)).toEqual([]);
    expect(clipPolygon([-5, 0, -1, 0, -1, 10, -5, 10], box)).toEqual([]);
    expect(clipPolygon([], box)).toEqual([]);
  });

  it('returns the box itself for a polygon that surrounds it', () => {
    const out = clipPolygon([-100, -100, 100, -100, 100, 100, -100, 100], box);
    expect(inside(out, box)).toBe(true);
    expect(signedArea(out)).toBeCloseTo(100, 9);
  });

  it('cuts overlapping convex shapes to their exact intersection', () => {
    const shifted = clipPolygon([5, -5, 15, -5, 15, 5, 5, 5], box);
    expect(inside(shifted, box)).toBe(true);
    expect(signedArea(shifted)).toBeCloseTo(25, 9);
    // A diamond |x−5| + |y−5| ≤ 8 poking out of all four sides: the box minus four corner triangles of area 2.
    const diamond = clipPolygon([5, -3, 13, 5, 5, 13, -3, 5], box);
    expect(inside(diamond, box)).toBe(true);
    expect(signedArea(diamond)).toBeCloseTo(100 - 4 * 2, 9);
  });

  it('keeps the area of a concave coast correct (degenerate edges lie on the box)', () => {
    // A U shape, open towards +y, straddling the box's top edge.
    const u = [1, 5, 9, 5, 9, 15, 7, 15, 7, 8, 3, 8, 3, 15, 1, 15];
    const out = clipPolygon(u, box);
    expect(inside(out, box)).toBe(true);
    // Inside the box: the base 8×3, and two prongs 2×2 each.
    expect(signedArea(out)).toBeCloseTo(24 + 4 + 4, 9);
  });

  it('preserves the winding of the input', () => {
    const ccw = [5, -5, 15, -5, 15, 5, 5, 5];
    const cw = [5, 5, 15, 5, 15, -5, 5, -5];
    expect(Math.sign(signedArea(clipPolygon(ccw, box)))).toBe(1);
    expect(Math.sign(signedArea(clipPolygon(cw, box)))).toBe(-1);
  });

  it('matches a grid-sampled area for random polygons against random boxes', () => {
    let s = 41;
    const random = () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
    for (let round = 0; round < 40; round++) {
      // A star-shaped polygon (simple, possibly concave) around a random centre.
      const cx = random() * 20 - 5;
      const cy = random() * 20 - 5;
      const n = 5 + Math.floor(random() * 12);
      const polygon: number[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        const r = 2 + random() * 8;
        polygon.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      const clip: Box = { minX: random() * 5, minY: random() * 5, maxX: 6 + random() * 6, maxY: 6 + random() * 6 };
      const out = clipPolygon(polygon, clip);
      expect(inside(out, clip)).toBe(true);
      // Even–odd sampling of the source polygon inside the box.
      const step = 0.05;
      let hits = 0;
      for (let y = clip.minY + step / 2; y < clip.maxY; y += step) {
        for (let x = clip.minX + step / 2; x < clip.maxX; x += step) {
          let odd = false;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i * 2]!;
            const yi = polygon[i * 2 + 1]!;
            const xj = polygon[j * 2]!;
            const yj = polygon[j * 2 + 1]!;
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
          }
          if (odd) hits++;
        }
      }
      const sampled = hits * step * step;
      const exact = out.length >= 6 ? Math.abs(signedArea(out)) : 0;
      const perimeter = 2 * (clip.maxX - clip.minX + clip.maxY - clip.minY);
      expect(Math.abs(exact - sampled)).toBeLessThan(step * (perimeter + 60));
    }
  });
});

describe('detailRing', () => {
  // A coast in world units, roughly the size of a real language continent's shore.
  const RING = new Float64Array([0, 0, 12, 1, 20, 9, 18, 21, 6, 24, -4, 13]);
  const vertex = (i: number): [number, number] => [RING[(i % 6) * 2]!, RING[(i % 6) * 2 + 1]!];

  it('leaves segments far from the clip box exactly as they were', () => {
    const out = detailRing(RING, 50, { minX: 500, minY: 500, maxX: 600, maxY: 600 });
    expect(out).toEqual(Array.from(RING));
  });

  it('starts at the first vertex, keeps every vertex, and does not repeat the first at the end', () => {
    const out = detailRing(RING, 50, WIDE);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).not.toEqual([0, 0]);
    for (let i = 0; i < 6; i++) expect(segmentOf(out, vertex(i), vertex(i + 1)).length).toBeGreaterThan(4);
    expect(out.length % 2).toBe(0);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it('splits detailed segments until each piece is a few pixels long', () => {
    for (const scale of [5, 50, 200]) {
      const out = detailRing(RING, scale, WIDE);
      for (let i = 0; i < out.length; i += 2) {
        const j = (i + 2) % out.length;
        expect(Math.hypot(out[j]! - out[i]!, out[j + 1]! - out[i + 1]!) * scale).toBeLessThanOrEqual(4.5 * 1.2);
      }
    }
  });

  it('stays within a small distance of the source coast', () => {
    for (const scale of [3, 50, 400]) {
      const out = detailRing(RING, scale, WIDE);
      for (let s = 0; s < 6; s++) {
        const [ax, ay] = vertex(s);
        const [bx, by] = vertex(s + 1);
        const length = Math.hypot(bx - ax, by - ay);
        const piece = segmentOf(out, [ax, ay], [bx, by]);
        for (let i = 0; i < piece.length; i += 2) expect(distanceToSegment(piece[i]!, piece[i + 1]!, ax, ay, bx, by)).toBeLessThanOrEqual(0.3 * length);
      }
    }
  });

  it('draws the same coast for a segment whatever tile asks for it', () => {
    const full = detailRing(RING, 50, WIDE);
    const clips: Box[] = [
      { minX: 15, minY: 3, maxX: 16, maxY: 4 }, // a sliver touching only segment 1→2
      { minX: 10, minY: 0, maxX: 30, maxY: 30 },
      { minX: -50, minY: -50, maxX: 50, maxY: 50 },
      { minX: 16, minY: 5, maxX: 40, maxY: 7 },
    ];
    for (const clip of clips) {
      const out = detailRing(RING, 50, clip);
      expect(segmentOf(out, vertex(1), vertex(2))).toEqual(segmentOf(full, vertex(1), vertex(2)));
    }
  });

  it('is deterministic and does not depend on where the ring starts', () => {
    expect(detailRing(RING, 50, WIDE)).toEqual(detailRing(RING, 50, WIDE));
    const rotated = new Float64Array([...RING.slice(4), ...RING.slice(0, 4)]);
    const a = detailRing(RING, 50, WIDE);
    const b = detailRing(rotated, 50, WIDE);
    for (let s = 0; s < 6; s++) expect(segmentOf(b, vertex(s), vertex(s + 1))).toEqual(segmentOf(a, vertex(s), vertex(s + 1)));
  });

  it('copes with repeated vertices without producing NaN', () => {
    const out = detailRing(new Float64Array([0, 0, 0, 0, 10, 0, 10, 0, 5, 8]), 80, WIDE);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  // Bug: whether a segment gets detail is decided by its straight bounding box against the tile's clip (tile plus
  // 76 px). Detail can bulge up to ~0.17 × the segment length sideways, so a long coast segment lying just beyond a
  // tile's clip box is detailed by its neighbour but drawn straight here, and the bulge that crosses the shared
  // edge is missing from this tile: the coast steps at the seam. At level 10 (the deepest zoom on a 2× screen) this
  // hits segments longer than ~4.4 world units, and bulges reach ~110 CSS px into the neighbour; real previews have
  // about 1000 coast segments that long.
  it('paints the same coast on both sides of a tile seam for long coast segments at deep zoom', () => {
    const pyramid = pyramidFor({ minX: -1230, minY: -1445, maxX: 1360, maxY: 878 });
    const level = 10;
    const scale = levelScale(pyramid, level);
    const margin = 76 / scale;
    const grow = (box: Box): Box => ({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin });
    const problems: string[] = [];
    for (let t = 0; t < 8; t++) {
      const a = tileBox(pyramid, { level, tx: 500 + t, ty: 500 });
      const b = tileBox(pyramid, { level, tx: 501 + t, ty: 500 });
      for (const length of [4.5, 6, 8.8, 12.9]) {
        for (const gap of [0.01, 0.1, 0.3]) {
          for (const up of [false, true]) {
            // A long north–south coast segment in tile A, just outside tile B's clip box, spanning B's height.
            const x = b.minX - margin - gap;
            const y0 = (a.minY + a.maxY) / 2 - length / 2;
            const v0: [number, number] = [x, up ? y0 + length : y0];
            const v1: [number, number] = [x, up ? y0 : y0 + length];
            const ring = new Float64Array([...v0, ...v1, x - 40, y0 + length / 2]);
            const seenFromA = segmentOf(detailRing(ring, scale, grow(a)), v0, v1);
            const seenFromB = segmentOf(detailRing(ring, scale, grow(b)), v0, v1);
            let depthPx = 0;
            for (let i = 0; i < seenFromA.length; i += 2) {
              if (seenFromA[i]! > b.minX && seenFromA[i + 1]! > b.minY && seenFromA[i + 1]! < b.maxY) depthPx = Math.max(depthPx, (seenFromA[i]! - b.minX) * scale);
            }
            if (depthPx > 0 && JSON.stringify(seenFromA) !== JSON.stringify(seenFromB)) problems.push(`tile ${500 + t}, length ${length}: ${depthPx.toFixed(1)} px missing in the neighbour`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
