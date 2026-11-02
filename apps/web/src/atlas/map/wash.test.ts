// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Settler } from '../data/model';
import { Camera, DISTANCE_SCALE, type Viewport } from './camera';
import { WASH_MARGIN, WASH_PX, WASH_RADIUS, WASH_SCALE_TOLERANCE, onAirOrder, washCovers, washDetail, washPlacement, washPx, washReusable, washSoftening, type LaidWash } from './wash';

const WORLD = 0.3; // a whole-world view, well below continent distance
const REALM = DISTANCE_SCALE.realm;

describe('washSoftening', () => {
  it('is full strength from afar, up to just before realm distance', () => {
    for (const scale of [0.05, WORLD, DISTANCE_SCALE.continent, REALM * 0.6]) expect(washSoftening(scale)).toBe(1);
  });

  it('settles at about half strength (0.52) once the pennants have taken over', () => {
    for (const scale of [REALM * 1.2, DISTANCE_SCALE.kingdom, 40]) expect(washSoftening(scale)).toBeCloseTo(0.52, 12);
  });

  it('eases monotonically between the two, never below 0.52 or above 1', () => {
    let previous = Infinity;
    for (let scale = 0.1; scale <= 12; scale += 0.05) {
      const value = washSoftening(scale);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      expect(value).toBeGreaterThanOrEqual(0.52 - 1e-12);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    // At realm distance itself the ramp is two thirds of the way down (1 − 0.48 · 2/3).
    expect(washSoftening(REALM)).toBeCloseTo(0.68, 12);
  });
});

describe('washDetail', () => {
  it('is 0 at world and continent distance: one soft density layer', () => {
    for (const scale of [0.05, WORLD, DISTANCE_SCALE.continent, DISTANCE_SCALE.continent * 1.3]) expect(washDetail(scale)).toBe(0);
  });

  it('is 1 from just before realm distance on: every holding its own bloom', () => {
    for (const scale of [REALM * 0.8, REALM, DISTANCE_SCALE.kingdom, 40]) expect(washDetail(scale)).toBe(1);
  });

  it('cross-fades in between', () => {
    const mid = (DISTANCE_SCALE.continent * 1.3 + REALM * 0.8) / 2;
    expect(washDetail(mid)).toBeCloseTo(0.5, 12);
  });
});

describe('washPx', () => {
  it('scales the class radius with the camera inside its bounds', () => {
    expect(washPx(1, 5)).toBeCloseTo(WASH_RADIUS[1] * 5, 12); // 65 px, inside [15, 120]
    expect(washPx(3, 4)).toBeCloseTo(WASH_RADIUS[3] * 4, 12); // 16.8 px, inside [5.5, 46]
  });

  it('clamps every class to its WASH_PX bounds, far out and close in', () => {
    for (let liveClass = 1; liveClass <= 5; liveClass++) {
      const [min, max] = WASH_PX[liveClass]!;
      expect(washPx(liveClass, 0.001)).toBe(min);
      expect(washPx(liveClass, 1_000)).toBe(max);
      for (const scale of [0.1, 0.5, 1, 2, 4, 8, 16, 32]) {
        const px = washPx(liveClass, scale);
        expect(px).toBeGreaterThanOrEqual(min);
        expect(px).toBeLessThanOrEqual(max);
      }
    }
  });

  it('keeps a capital wider than a small stream at every scale', () => {
    for (const scale of [0.1, 1, 4, 16]) expect(washPx(1, scale)).toBeGreaterThan(washPx(5, scale));
  });

  it('paints nothing for an offline holding or an unknown class', () => {
    expect(washPx(0, 10)).toBe(0);
    expect(washPx(6, 10)).toBe(0);
    expect(washPx(-1, 10)).toBe(0);
  });
});

describe('the laid wash picture', () => {
  const view: Viewport = { width: 1920, height: 1080 };
  const camera = new Camera({ minX: -1230, minY: -1445, maxX: 1360, maxY: 878 });
  camera.x = 140;
  camera.y = -260;
  camera.scale = 1.7;
  const key = { live: 4, store: 9 };
  const origin = camera.screenToWorld(-WASH_MARGIN, -WASH_MARGIN, view);
  const laid: LaidWash = { ...key, originX: origin.x, originY: origin.y, scale: camera.scale, width: view.width, height: view.height, until: Infinity };
  const at = (dx: number, dy: number, zoom = 1) => ({ x: camera.x + dx / camera.scale, y: camera.y + dy / camera.scale, scale: camera.scale * zoom });

  it('sits exactly where its washes were laid, and keeps every world point under the same screen point', () => {
    const placed = washPlacement(laid, at(0, 0), view);
    expect(placed.x).toBeCloseTo(-WASH_MARGIN, 9);
    expect(placed.y).toBeCloseTo(-WASH_MARGIN, 9);
    expect(placed.ratio).toBe(1);
    // A pan and a breath of zoom: a world point drawn into the picture lands where the camera now shows it.
    const world = { x: camera.x + 300, y: camera.y - 120 };
    const laidAt = camera.worldToScreen(world.x, world.y, view);
    const moved = new Camera({ minX: -1230, minY: -1445, maxX: 1360, maxY: 878 });
    Object.assign(moved, at(37, -21, 1.008));
    const p = washPlacement(laid, moved, view);
    const shown = moved.worldToScreen(world.x, world.y, view);
    expect(p.x + (laidAt.x + WASH_MARGIN) * p.ratio).toBeCloseTo(shown.x, 9);
    expect(p.y + (laidAt.y + WASH_MARGIN) * p.ratio).toBeCloseTo(shown.y, 9);
  });

  it('is moved, not laid again, for pans inside its margin and the hero drift', () => {
    expect(washReusable(laid, key, at(0, 0), view, 0)).toBe(true);
    expect(washReusable(laid, key, at(WASH_MARGIN - 1, -(WASH_MARGIN - 1)), view, 0)).toBe(true);
    expect(washReusable(laid, key, at(36, 22, 1 + WASH_SCALE_TOLERANCE * 0.9), view, 0)).toBe(true);
  });

  it('is laid again past its margin, past a breath of zoom, on a resize, and when the live frame, store or a bloom changes', () => {
    expect(washReusable(laid, key, at(WASH_MARGIN + 1, 0), view, 0)).toBe(false);
    expect(washReusable(laid, key, at(0, -(WASH_MARGIN + 1)), view, 0)).toBe(false);
    expect(washReusable(laid, key, at(0, 0, 1 + WASH_SCALE_TOLERANCE * 1.1), view, 0)).toBe(false);
    expect(washReusable(laid, key, at(0, 0, 1 - WASH_SCALE_TOLERANCE * 1.1), view, 0)).toBe(false);
    // Zooming out shrinks the picture until it no longer covers the view, even inside the tolerance.
    expect(washReusable(laid, key, at(WASH_MARGIN * 0.99, 0, 1 - WASH_SCALE_TOLERANCE * 0.9), view, 0)).toBe(false);
    expect(washReusable(laid, key, at(0, 0), { width: 1919, height: 1080 }, 0)).toBe(false);
    expect(washReusable(laid, { ...key, live: 5 }, at(0, 0), view, 0)).toBe(false);
    expect(washReusable(laid, { ...key, store: 10 }, at(0, 0), view, 0)).toBe(false);
    expect(washReusable({ ...laid, until: 4_000 }, key, at(0, 0), view, 3_999)).toBe(true);
    expect(washReusable({ ...laid, until: 4_000 }, key, at(0, 0), view, 4_000)).toBe(false);
  });

  it('can stand in for a newer live frame or store while gathering, but never for a view it does not cover', () => {
    expect(washCovers(laid, at(40, 30), view)).toBe(true);
    expect(washReusable(laid, { live: 5, store: 10 }, at(40, 30), view, 0)).toBe(false);
    expect(washCovers(laid, at(WASH_MARGIN + 1, 0), view)).toBe(false);
    expect(washCovers(laid, at(0, 0, 1.05), view)).toBe(false);
  });
});

describe('the holdings on air', () => {
  it('keeps exactly the live, unwithheld holdings in the order the box query used to give, biggest class first', () => {
    let seed = 7;
    const next = () => ((seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
    const settlers = Array.from({ length: 4_000 }, (_, i) => ({ ordinal: 4_000 - i, withheld: next() < 0.05, x: next() * 100, y: next() * 100 })) as unknown as Settler[];
    const classes = new Map(settlers.map((s) => [s.ordinal, next() < 0.7 ? 0 : 1 + Math.floor(next() * 5)]));
    const liveClass = (s: Settler) => (s.withheld ? 0 : classes.get(s.ordinal)!);
    const order = onAirOrder(settlers, liveClass);
    // The earlier path: every unwithheld holding in a box, its class, the live ones, sorted by class then ordinal.
    const box = { minX: 20, minY: 10, maxX: 75, maxY: 90 };
    const inBox = (s: Settler) => s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY;
    const before = settlers.filter((s) => !s.withheld && inBox(s))
      .map((settler) => ({ settler, liveClass: liveClass(settler) }))
      .filter((item) => item.liveClass > 0)
      .sort((a, b) => a.liveClass - b.liveClass || a.settler.ordinal - b.settler.ordinal)
      .map((item) => item.settler);
    expect(order.filter(inBox)).toEqual(before);
    expect(order.every((s) => !s.withheld && liveClass(s) > 0)).toBe(true);
    expect(order.length).toBe(settlers.filter((s) => liveClass(s) > 0).length);
  });
});
