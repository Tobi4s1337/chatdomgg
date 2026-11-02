// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Camera, DISTANCE_SCALE, distanceFor, MAX_SCALE, NO_INSETS, type Box, type Insets, type Viewport } from './camera';

/** The bounds of a real survey preview (world units): wider than tall, and off-centre around the origin. */
const BOUNDS: Box = { minX: -1230, minY: -1445, maxX: 1360, maxY: 878 };
const LAPTOP: Viewport = { width: 1440, height: 900 };
const PHONE: Viewport = { width: 390, height: 844 };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

/** Where the world's bounds land on screen. */
function mapOnScreen(camera: Camera, view: Viewport): Box {
  const a = camera.worldToScreen(BOUNDS.minX, BOUNDS.minY, view);
  const b = camera.worldToScreen(BOUNDS.maxX, BOUNDS.maxY, view);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Per axis, the share of the screen that shows the map. */
function coverage(camera: Camera, view: Viewport): { x: number; y: number } {
  const box = camera.visibleBox(view);
  const share = (lo: number, hi: number, min: number, max: number) => Math.max(0, Math.min(hi, max) - Math.max(lo, min)) / (hi - lo);
  return { x: share(box.minX, box.maxX, BOUNDS.minX, BOUNDS.maxX), y: share(box.minY, box.maxY, BOUNDS.minY, BOUNDS.maxY) };
}

describe('distanceFor', () => {
  it('switches distance exactly at the documented thresholds', () => {
    expect(distanceFor(0.05)).toBe('world');
    expect(distanceFor(DISTANCE_SCALE.continent - 1e-9)).toBe('world');
    expect(distanceFor(DISTANCE_SCALE.continent)).toBe('continent');
    expect(distanceFor(DISTANCE_SCALE.realm - 1e-9)).toBe('continent');
    expect(distanceFor(DISTANCE_SCALE.realm)).toBe('realm');
    expect(distanceFor(DISTANCE_SCALE.kingdom - 1e-9)).toBe('realm');
    expect(distanceFor(DISTANCE_SCALE.kingdom)).toBe('kingdom');
    expect(distanceFor(MAX_SCALE)).toBe('kingdom');
  });

  it('reaches every distance before the deepest zoom', () => {
    expect(DISTANCE_SCALE.continent).toBeLessThan(DISTANCE_SCALE.realm);
    expect(DISTANCE_SCALE.realm).toBeLessThan(DISTANCE_SCALE.kingdom);
    expect(DISTANCE_SCALE.kingdom).toBeLessThan(MAX_SCALE);
  });
});

describe('Camera projection', () => {
  it('starts at the centre of the world', () => {
    const camera = new Camera(BOUNDS);
    expect(camera.x).toBe(65);
    expect(camera.y).toBe(-283.5);
  });

  it('screenToWorld inverts worldToScreen', () => {
    const camera = new Camera(BOUNDS);
    camera.scale = 7.3;
    camera.x = 123.456;
    camera.y = -77.7;
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      const sx = random() * LAPTOP.width;
      const sy = random() * LAPTOP.height;
      const w = camera.screenToWorld(sx, sy, LAPTOP);
      const s = camera.worldToScreen(w.x, w.y, LAPTOP);
      expect(s.x).toBeCloseTo(sx, 9);
      expect(s.y).toBeCloseTo(sy, 9);
    }
    expect(camera.worldToScreen(camera.x, camera.y, LAPTOP)).toEqual({ x: 720, y: 450 });
  });

  it('visibleBox is the screen in world units, grown by the margin', () => {
    const camera = new Camera(BOUNDS);
    camera.scale = 2;
    expect(camera.visibleBox(LAPTOP)).toEqual({ minX: 65 - 360, minY: -283.5 - 225, maxX: 65 + 360, maxY: -283.5 + 225 });
    expect(camera.visibleBox(LAPTOP, 20)).toEqual({ minX: 65 - 370, minY: -283.5 - 235, maxX: 65 + 370, maxY: -283.5 + 235 });
  });
});

describe('Camera.home', () => {
  it('shows the whole map, centred, on a laptop', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    const box = mapOnScreen(camera, LAPTOP);
    expect(box.minX).toBeGreaterThanOrEqual(0);
    expect(box.minY).toBeGreaterThanOrEqual(0);
    expect(box.maxX).toBeLessThanOrEqual(LAPTOP.width);
    expect(box.maxY).toBeLessThanOrEqual(LAPTOP.height);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(720, 6);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(450, 6);
    // Contain with a small margin: the limiting axis fills 97 % of the screen.
    expect(Math.max((box.maxX - box.minX) / LAPTOP.width, (box.maxY - box.minY) / LAPTOP.height)).toBeCloseTo(0.97, 6);
    expect(camera.minScale).toBeCloseTo(camera.containScale(LAPTOP) * 0.92, 12);
  });

  it('fills a phone screen with the map, centred, instead of a thin strip', () => {
    const camera = new Camera(BOUNDS);
    camera.home(PHONE);
    const box = mapOnScreen(camera, PHONE);
    // The map is taller than the strip a contain fit would give, and spills past the narrow sides.
    expect(camera.scale).toBeGreaterThan(camera.containScale(PHONE) * 1.5);
    expect(camera.scale).toBeLessThanOrEqual(camera.containScale(PHONE) * 2.6 + 1e-12);
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(PHONE.width);
    expect(box.maxY - box.minY).toBeCloseTo(PHONE.height * 0.92, 6);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(PHONE.width / 2, 6);
  });

  it('centres the map between the phone header and the bottom sheet', () => {
    const insets: Insets = { left: 0, right: 0, top: 76, bottom: 60 };
    const camera = new Camera(BOUNDS);
    camera.home(PHONE, insets);
    const box = mapOnScreen(camera, PHONE);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(76 + (844 - 76 - 60) / 2, 6);
  });

  it('centres the map in the space a modest side panel leaves', () => {
    const insets: Insets = { left: 0, right: 200, top: 0, bottom: 0 };
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP, insets);
    const box = mapOnScreen(camera, LAPTOP);
    expect((box.minX + box.maxX) / 2).toBeCloseTo((LAPTOP.width - 200) / 2, 6);
    expect(box.maxX).toBeLessThanOrEqual(LAPTOP.width - 200 + 1e-6);
    expect(box.minX).toBeGreaterThanOrEqual(0);
  });

  // Bug: with the 370 px left panel index.tsx uses on screens ≥ 1100 px wide, the clamp (centre may move only half a
  // screen past the bounds) and the minimum zoom (92 % of a contain fit of the *whole* viewport) both override the
  // inset, so the opening map slides under the panel: 50 px at 1280×800, 95 px under it and 98 px off the right at
  // 1100×900, 10 px at 1440×900.
  it('keeps the whole opening map clear of the 370 px left panel on common laptop sizes', () => {
    const insets: Insets = { left: 370, right: 0, top: 0, bottom: 0 };
    for (const view of [{ width: 1280, height: 800 }, { width: 1100, height: 900 }, LAPTOP]) {
      const camera = new Camera(BOUNDS);
      camera.home(view, insets);
      const box = mapOnScreen(camera, view);
      expect(box.minX, `${view.width}×${view.height}`).toBeGreaterThanOrEqual(insets.left - 0.5);
      expect(box.maxX, `${view.width}×${view.height}`).toBeLessThanOrEqual(view.width + 0.5);
    }
  });

  it('is idempotent and independent of where the camera was before', () => {
    const a = new Camera(BOUNDS);
    a.home(LAPTOP);
    const first = a.snapshot();
    a.zoomAt(8, 100, 100, LAPTOP);
    a.panBy(-900, 300, LAPTOP);
    a.home(LAPTOP);
    expect(a.snapshot()).toEqual(first);
  });
});

describe('Camera.zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const random = seeded(7);
    for (let i = 0; i < 300; i++) {
      const camera = new Camera(BOUNDS);
      camera.home(LAPTOP);
      camera.zoomAt(3 + random() * 10, 720, 450, LAPTOP); // start somewhere in the middle of the world
      const sx = 200 + random() * 1040;
      const sy = 150 + random() * 600;
      const before = camera.screenToWorld(sx, sy, LAPTOP);
      const factor = 0.7 + random() * 0.8;
      camera.zoomAt(factor, sx, sy, LAPTOP);
      const after = camera.worldToScreen(before.x, before.y, LAPTOP);
      expect(after.x).toBeCloseTo(sx, 7);
      expect(after.y).toBeCloseTo(sy, 7);
    }
  });

  it('stays anchored to the sub-pixel through a hundred wheel steps at the deepest zoom', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    camera.zoomAt(1000, 720, 450, LAPTOP);
    expect(camera.scale).toBe(MAX_SCALE);
    const sx = 1001.37;
    const sy = 313.91;
    const anchor = camera.screenToWorld(sx, sy, LAPTOP);
    for (let i = 0; i < 100; i++) camera.zoomAt(i % 2 ? 1.1 : 1 / 1.1, sx, sy, LAPTOP);
    const after = camera.worldToScreen(anchor.x, anchor.y, LAPTOP);
    expect(Math.abs(after.x - sx)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - sy)).toBeLessThan(1e-6);
  });

  it('clamps to the maximum scale and keeps the anchor while clamped', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    const anchor = camera.screenToWorld(600, 400, LAPTOP);
    camera.zoomAt(1e6, 600, 400, LAPTOP);
    expect(camera.scale).toBe(MAX_SCALE);
    const at = camera.worldToScreen(anchor.x, anchor.y, LAPTOP);
    expect(at.x).toBeCloseTo(600, 7);
    expect(at.y).toBeCloseTo(400, 7);
  });

  it('clamps to the minimum scale with a little paper around the whole map', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    camera.zoomAt(1e-6, 100, 100, LAPTOP);
    expect(camera.scale).toBe(camera.minScale);
    const box = mapOnScreen(camera, LAPTOP);
    expect(box.minX).toBeGreaterThanOrEqual(0);
    expect(box.minY).toBeGreaterThanOrEqual(0);
    expect(box.maxX).toBeLessThanOrEqual(LAPTOP.width);
    expect(box.maxY).toBeLessThanOrEqual(LAPTOP.height);
  });
});

describe('Camera.panBy and clamp', () => {
  it('moves the map with the pointer', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    camera.zoomAt(10, 720, 450, LAPTOP);
    const point = camera.screenToWorld(500, 500, LAPTOP);
    camera.panBy(37, -21, LAPTOP);
    const at = camera.worldToScreen(point.x, point.y, LAPTOP);
    expect(at.x).toBeCloseTo(537, 9);
    expect(at.y).toBeCloseTo(479, 9);
  });

  it('always keeps most of the screen on the map, however far it is dragged', () => {
    const random = seeded(99);
    for (const view of [LAPTOP, PHONE, { width: 1920, height: 1080 }]) {
      for (let i = 0; i < 200; i++) {
        const camera = new Camera(BOUNDS);
        camera.home(view);
        camera.zoomAt(Math.exp(random() * Math.log(MAX_SCALE / camera.minScale)), random() * view.width, random() * view.height, view);
        camera.panBy((random() - 0.5) * 1e6, (random() - 0.5) * 1e6, view);
        const share = coverage(camera, view);
        const box = camera.visibleBox(view);
        // A map wider than the screen keeps at least three quarters of it; a map that fits may overhang by a quarter.
        const wantX = Math.min(0.75, (BOUNDS.maxX - BOUNDS.minX) / (box.maxX - box.minX) - 0.25);
        const wantY = Math.min(0.75, (BOUNDS.maxY - BOUNDS.minY) / (box.maxY - box.minY) - 0.25);
        expect(share.x).toBeGreaterThanOrEqual(wantX - 1e-9);
        expect(share.y).toBeGreaterThanOrEqual(wantY - 1e-9);
      }
    }
  });

  it('holds the anchor of a zoom near the map edge while the whole map still fits', () => {
    for (const view of [LAPTOP, PHONE]) {
      const camera = new Camera(BOUNDS);
      camera.home(view);
      // A point a little inside the map's right edge, zoomed by three wheel notches.
      const edge = camera.worldToScreen(BOUNDS.maxX, (BOUNDS.minY + BOUNDS.maxY) / 2, view);
      const sx = Math.min(view.width - 10, edge.x - 60);
      const sy = view.height / 2;
      const anchor = camera.screenToWorld(sx, sy, view);
      camera.zoomAt(1.88, sx, sy, view);
      const held = camera.worldToScreen(anchor.x, anchor.y, view);
      expect(held.x).toBeCloseTo(sx, 6);
      expect(held.y).toBeCloseTo(sy, 6);
    }
  });

  it('pulls an out-of-range camera back without changing a valid one', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    camera.zoomAt(20, 720, 450, LAPTOP);
    const valid = camera.snapshot();
    camera.clamp(LAPTOP);
    expect(camera.snapshot()).toEqual(valid);
    camera.x = 1e9;
    camera.y = -1e9;
    camera.scale = 1e9;
    camera.clamp(LAPTOP);
    expect(camera.scale).toBe(MAX_SCALE);
    expect(camera.x).toBeLessThanOrEqual(BOUNDS.maxX);
    expect(camera.y).toBeGreaterThanOrEqual(BOUNDS.minY);
  });

  it('raises the minimum zoom when the window grows, and clamps to it', () => {
    const camera = new Camera(BOUNDS);
    camera.home(PHONE);
    camera.zoomAt(1e-6, 195, 422, PHONE);
    camera.resize(LAPTOP);
    expect(camera.minScale).toBeCloseTo(camera.containScale(LAPTOP) * 0.92, 12);
    expect(camera.scale).toBeGreaterThanOrEqual(camera.minScale);
  });

  it('leaves the default insets empty', () => {
    expect(NO_INSETS).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});
