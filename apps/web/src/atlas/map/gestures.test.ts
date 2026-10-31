import { describe, expect, it } from 'vitest';
import { Camera, type Box, type Viewport } from './camera';
import { Gestures, INERTIA, isNotched, releaseVelocity, WHEEL, type GestureHost } from './gestures';

const BOUNDS: Box = { minX: -1230, minY: -1445, maxX: 1360, maxY: 878 };

function rig(view: Viewport = { width: 1440, height: 900 }, scale = 4, reduced = false) {
  const camera = new Camera(BOUNDS);
  camera.home(view);
  camera.scale = scale;
  camera.x = 0;
  camera.y = 0;
  let now = 1_000;
  const log = { taps: [] as [number, number, string][], doubleTaps: [] as [number, number][], begins: 0, changes: 0 };
  const host: GestureHost = {
    view: () => view,
    now: () => now,
    reducedMotion: () => reduced,
    begin: () => void log.begins++,
    changed: () => void log.changes++,
    tap: (x, y, type) => void log.taps.push([x, y, type]),
    doubleTap: (x, y) => void log.doubleTaps.push([x, y]),
  };
  const gestures = new Gestures(camera, host);
  return {
    camera, gestures, log, view,
    tick: (ms: number) => { now += ms; return now; },
    get now() { return now; },
    world: (sx: number, sy: number) => camera.screenToWorld(sx, sy, view),
    screen: (x: number, y: number) => camera.worldToScreen(x, y, view),
  };
}

/** Run the frame loop until nothing moves by itself, at 60 Hz. */
function settle(r: ReturnType<typeof rig>, limit = 600): number {
  let frames = 0;
  while (frames < limit && r.gestures.step(r.tick(16))) frames++;
  return frames;
}

describe('one-pointer pan', () => {
  it('keeps the grabbed world point under the pointer the whole way', () => {
    const r = rig();
    const grabbed = r.world(700, 400);
    r.gestures.down(1, 700, 400, 'mouse');
    for (let i = 1; i <= 20; i++) {
      r.tick(16);
      r.gestures.move(1, 700 + i * 9, 400 - i * 4);
      const s = r.screen(grabbed.x, grabbed.y);
      expect(s.x).toBeCloseTo(700 + i * 9, 6);
      expect(s.y).toBeCloseTo(400 - i * 4, 6);
    }
  });

  it('a flick coasts on in the same direction and stops by itself; a rested release does not', () => {
    const r = rig();
    r.gestures.down(1, 400, 400, 'touch');
    for (let i = 1; i <= 6; i++) {
      r.tick(16);
      r.gestures.move(1, 400 + i * 20, 400);
    }
    const before = r.camera.x;
    r.tick(8);
    r.gestures.up(1);
    expect(r.gestures.active).toBe(true);
    const frames = settle(r);
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(200);
    // Content moved right with the finger, so the camera centre moved left and keeps doing so while coasting.
    expect(r.camera.x).toBeLessThan(before);
    expect(r.gestures.active).toBe(false);

    const s = rig();
    s.gestures.down(1, 400, 400, 'touch');
    for (let i = 1; i <= 6; i++) {
      s.tick(16);
      s.gestures.move(1, 400 + i * 20, 400);
    }
    s.tick(INERTIA.restMs + 10);
    s.gestures.up(1);
    expect(s.gestures.active).toBe(false);
  });

  it('caps the coasting speed', () => {
    const v = releaseVelocity([{ x: 0, y: 0, at: 0 }, { x: 900, y: 0, at: 16 }], 20)!;
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(INERTIA.maxSpeed, 9);
    expect(releaseVelocity([{ x: 0, y: 0, at: 0 }, { x: 1, y: 0, at: 90 }], 95)).toBeNull();
  });

  it('a short still press is a tap; a drag beyond the slop is not', () => {
    const r = rig();
    r.gestures.down(1, 300, 300, 'mouse');
    r.tick(80);
    r.gestures.move(1, 302, 301);
    r.gestures.up(1);
    expect(r.log.taps).toEqual([[302, 301, 'mouse']]);
    r.gestures.down(1, 300, 300, 'mouse');
    r.tick(16);
    r.gestures.move(1, 330, 300);
    r.gestures.up(1);
    expect(r.log.taps).toHaveLength(1);
  });

  it('two quick touch taps in one place zoom instead of tapping twice', () => {
    const r = rig();
    r.gestures.down(1, 300, 300, 'touch');
    r.tick(60);
    r.gestures.up(1);
    r.tick(150);
    r.gestures.down(2, 306, 304, 'touch');
    r.tick(60);
    r.gestures.up(2);
    expect(r.log.taps).toHaveLength(1);
    expect(r.log.doubleTaps).toEqual([[306, 304]]);
  });

  it('ignores secondary mouse buttons', () => {
    const r = rig();
    expect(r.gestures.down(1, 10, 10, 'mouse', 2)).toBe(false);
    expect(r.gestures.active).toBe(false);
  });
});

describe('pinch', () => {
  it('holds the world point under the first centroid while the fingers spread and travel', () => {
    const r = rig({ width: 390, height: 844 }, 3);
    r.gestures.down(1, 150, 400, 'touch');
    r.gestures.down(2, 250, 400, 'touch');
    const anchor = r.world(200, 400);
    for (let i = 1; i <= 30; i++) {
      r.tick(16);
      // Fingers spread from 100 px to 220 px apart while their middle drifts down and left.
      const spread = 50 + i * 2;
      const cx = 200 - i;
      const cy = 400 + i * 2;
      r.gestures.move(1, cx - spread, cy);
      r.gestures.move(2, cx + spread, cy);
      const s = r.screen(anchor.x, anchor.y);
      expect(s.x).toBeCloseTo(cx, 6);
      expect(s.y).toBeCloseTo(cy, 6);
    }
    expect(r.camera.scale).toBeCloseTo(3 * (220 / 100), 6);
  });

  it('hands over to a pan from the remaining finger without a jump, a tap or inertia from the pinch', () => {
    const r = rig({ width: 390, height: 844 }, 3);
    r.gestures.down(1, 150, 400, 'touch');
    r.gestures.down(2, 250, 400, 'touch');
    for (let i = 1; i <= 10; i++) {
      r.tick(16);
      r.gestures.move(1, 150 - i * 5, 400);
      r.gestures.move(2, 250 + i * 5, 400);
    }
    const before = r.camera.snapshot();
    r.gestures.up(1);
    // Nothing moved at the hand-over, nor on the frames after it.
    expect(r.camera.snapshot()).toEqual(before);
    r.gestures.step(r.tick(16));
    expect(r.camera.snapshot()).toEqual(before);
    const held = r.world(300, 400);
    r.tick(16);
    r.gestures.move(2, 310, 410);
    const s = r.screen(held.x, held.y);
    expect(s.x).toBeCloseTo(310, 6);
    expect(s.y).toBeCloseTo(410, 6);
    // A fast flick of the remaining finger, lifted mid-motion, would coast after a plain drag; after a pinch it stops.
    for (let i = 1; i <= 5; i++) {
      r.tick(16);
      r.gestures.move(2, 310 + i * 24, 410);
    }
    r.tick(4);
    const lifted = r.camera.snapshot();
    r.gestures.up(2);
    expect(settle(r)).toBe(0);
    expect(r.camera.snapshot()).toEqual(lifted);
    expect(r.log.taps).toHaveLength(0);
    expect(r.gestures.active).toBe(false);
  });

  it('a pinch released with both fingers neither taps nor coasts', () => {
    const r = rig({ width: 390, height: 844 }, 3);
    r.gestures.down(1, 190, 400, 'touch');
    r.gestures.down(2, 200, 400, 'touch');
    r.tick(16);
    r.gestures.move(2, 202, 400);
    r.gestures.up(1);
    r.gestures.up(2);
    expect(r.log.taps).toHaveLength(0);
    expect(r.gestures.active).toBe(false);
  });

  it('ignores a third finger', () => {
    const r = rig();
    r.gestures.down(1, 100, 100, 'touch');
    r.gestures.down(2, 200, 100, 'touch');
    expect(r.gestures.down(3, 300, 100, 'touch')).toBe(false);
    expect(r.gestures.touching).toBe(2);
  });

  it('stays within the zoom limits', () => {
    const r = rig({ width: 390, height: 844 }, 30);
    r.gestures.down(1, 190, 400, 'touch');
    r.gestures.down(2, 200, 400, 'touch');
    r.gestures.move(2, 390, 400);
    expect(r.camera.scale).toBe(r.camera.maxScale);
  });
});

describe('ending gestures', () => {
  it('pointer cancel ends a drag with no tap and no coasting', () => {
    const r = rig();
    r.gestures.down(1, 400, 400, 'touch');
    for (let i = 1; i <= 5; i++) {
      r.tick(16);
      r.gestures.move(1, 400 + i * 30, 400);
    }
    r.gestures.cancel(1);
    expect(r.gestures.active).toBe(false);
    expect(r.log.taps).toHaveLength(0);
    const before = r.camera.snapshot();
    settle(r);
    expect(r.camera.snapshot()).toEqual(before);
  });

  it('reset (blur, hide, unmount) mid-pinch leaves nothing active, and later moves do nothing', () => {
    const r = rig();
    r.gestures.down(1, 100, 100, 'touch');
    r.gestures.down(2, 200, 100, 'touch');
    r.gestures.reset();
    expect(r.gestures.active).toBe(false);
    const before = r.camera.snapshot();
    r.gestures.move(1, 500, 500);
    r.gestures.up(2);
    expect(r.camera.snapshot()).toEqual(before);
    expect(r.log.taps).toHaveLength(0);
  });

  it('reset during inertia stops it at once', () => {
    const r = rig();
    r.gestures.down(1, 400, 400, 'touch');
    for (let i = 1; i <= 6; i++) {
      r.tick(16);
      r.gestures.move(1, 400 + i * 25, 400);
    }
    r.gestures.up(1);
    r.gestures.step(r.tick(16));
    r.gestures.reset();
    const before = r.camera.snapshot();
    expect(r.gestures.step(r.tick(16))).toBe(false);
    expect(r.camera.snapshot()).toEqual(before);
  });

  it('a new press stops coasting and calls begin so flights stop too', () => {
    const r = rig();
    r.gestures.down(1, 400, 400, 'touch');
    for (let i = 1; i <= 6; i++) {
      r.tick(16);
      r.gestures.move(1, 400 + i * 25, 400);
    }
    r.gestures.up(1);
    const begins = r.log.begins;
    r.gestures.down(2, 100, 100, 'touch');
    expect(r.log.begins).toBe(begins + 1);
    const before = r.camera.snapshot();
    r.gestures.step(r.tick(16));
    expect(r.camera.snapshot()).toEqual(before);
  });
});

describe('wheel', () => {
  it('tells a notched wheel from a trackpad', () => {
    expect(isNotched(100, 0)).toBe(true);
    expect(isNotched(-120, 0)).toBe(true);
    expect(isNotched(3, 1)).toBe(true);
    expect(isNotched(4.000244140625 * 25, 0)).toBe(true);
    expect(isNotched(7.5, 0)).toBe(false);
    expect(isNotched(2, 0)).toBe(false);
  });

  it('a notch glides around the pointer and lands on its exact target with the anchor held', () => {
    const r = rig();
    const anchor = r.world(1000, 300);
    const start = r.camera.scale;
    r.gestures.wheel(-100, 0, false, 1000, 300);
    const frames = settle(r);
    expect(frames).toBeGreaterThan(3);
    expect(r.camera.scale).toBeCloseTo(start * Math.exp(100 * WHEEL.notch), 9);
    const s = r.screen(anchor.x, anchor.y);
    expect(s.x).toBeCloseTo(1000, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });

  it('successive notches extend one glide rather than restarting from the current scale', () => {
    const r = rig();
    const start = r.camera.scale;
    r.gestures.wheel(-100, 0, false, 720, 450);
    r.gestures.step(r.tick(16));
    r.gestures.wheel(-100, 0, false, 720, 450);
    settle(r);
    expect(r.camera.scale).toBeCloseTo(start * Math.exp(200 * WHEEL.notch), 9);
  });

  it('a trackpad delta and a ctrl pinch apply at once around the pointer', () => {
    const r = rig();
    const anchor = r.world(200, 700);
    const start = r.camera.scale;
    r.gestures.wheel(-6.5, 0, false, 200, 700);
    expect(r.camera.scale).toBeCloseTo(start * Math.exp(6.5 * WHEEL.fine), 9);
    r.gestures.wheel(-3, 0, true, 200, 700);
    expect(r.gestures.active).toBe(false);
    const s = r.screen(anchor.x, anchor.y);
    expect(s.x).toBeCloseTo(200, 6);
    expect(s.y).toBeCloseTo(700, 6);
  });

  it('reduced motion applies a notch at once', () => {
    const r = rig(undefined, 4, true);
    r.gestures.wheel(100, 0, false, 720, 450);
    expect(r.gestures.active).toBe(false);
    expect(r.camera.scale).toBeCloseTo(4 * Math.exp(-100 * WHEEL.notch), 9);
  });
});
