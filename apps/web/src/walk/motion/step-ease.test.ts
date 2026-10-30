import { describe, expect, it } from 'vitest';
import { WALK_BUTTON, WALK_HZ, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { embeddedSolids, stepPlayer } from '@chatdom/world/movement';
import { createStepEase, STEP_EASE } from './step-ease';

type V = [number, number, number];
const box = (min: V, max: V): SolidBox => ({ min, max });
const world = (boxes: readonly SolidBox[]): CollisionWorld =>
  ({ revision: 1, query: q => boxes.filter(b => b.min.every((n, i) => n <= q.max[i]! && b.max[i]! >= q.min[i]!)) });
const at = (x: number, y: number): PlayerState =>
  ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 1 });
const input = (moveX: number, buttons = 0): WalkInput => ({ moveX, moveZ: 0, buttons, yaw: 0, collisionRevision: 1 });

/** Four half-metre steps up to a landing, then four down, built from real solids and walked by the shared step. */
const STAIR = world([
  box([-10, -1, -4], [30, 0, 4]),
  ...[1, 2, 3, 4].map(n => box([n * .6, 0, -4], [10, n * .5, 4])),
  ...[1, 2, 3, 4].map(n => box([10, 0, -4], [10 + (4 - n) * .6 + .6, n * .5, 4])),
]);

/** Renders at `fps` while the shared step runs at `WALK_HZ`, as the browser does between fixed inputs. */
function walk(s: PlayerState, frames: number, fps: number, sample: (tick: number) => WalkInput) {
  const ease = createStepEase();
  const out: { y: number; grounded: boolean; body: number; camera: number; x: number }[] = [];
  let clock = 0, ticks = 0;
  for (let f = 0; f < frames; f++) {
    clock += 1 / fps;
    while (ticks < Math.floor(clock * WALK_HZ + 1e-9)) { stepPlayer(s, sample(ticks), 1 / WALK_HZ, STAIR); ticks++; }
    out.push({ y: s.y, grounded: s.grounded, x: s.x, ...ease.update(s.y, s.grounded, 1 / fps) });
  }
  return out;
}

describe('step ease', () => {
  it('carries the camera smoothly up and down a real stair without drawing the avatar inside it', () => {
    for (const fps of [60, 144, 24]) {
      const frames = walk(at(-1, 0), fps * 3, fps, () => input(127, WALK_BUTTON.sprint));
      expect(frames.at(-1)!.x).toBeGreaterThan(14);
      expect(Math.max(...frames.map(f => f.y))).toBe(2);
      let previous = frames[0]!, maxCam = 0, maxFeet = 0;
      for (const f of frames) {
        // The avatar is never drawn below its body, and where it is drawn there is only air.
        expect(f.body).toBeGreaterThanOrEqual(f.y);
        expect(embeddedSolids({ x: f.x, y: f.body, z: 0 }, STAIR)).toEqual([]);
        // The camera lags by at most two steps.
        expect(Math.abs(f.camera - f.y)).toBeLessThanOrEqual(STEP_EASE.cameraLag + 1e-9);
        maxCam = Math.max(maxCam, Math.abs(f.camera - previous.camera)); maxFeet = Math.max(maxFeet, Math.abs(f.y - previous.y));
        previous = f;
      }
      // Without easing the feet pop well above the stair's mean ascent; the camera stays near that pace.
      const start = frames.findIndex(f => f.y > 0), top = frames.findIndex(f => f.y === 2);
      const ascent = 2 / ((top - start + 1) / fps);
      expect(maxFeet * fps).toBeGreaterThan(1.7 * ascent);
      expect(maxCam * fps).toBeLessThan(1.4 * ascent);
      // Down the far side the avatar eased at least once, then everything settled on the floor.
      expect(frames.some(f => f.body > f.y + .05)).toBe(true);
      expect([previous.y, previous.body]).toEqual([0, 0]);
      expect(previous.camera).toBeCloseTo(0, 3);
    }
  });

  it('leaves a jump and its landing to the shared step', () => {
    const s = at(-5, 0);
    const frames = walk(s, 60, 60, tick => input(0, tick === 0 ? WALK_BUTTON.jump : 0));
    expect(Math.max(...frames.map(f => f.y))).toBeGreaterThan(1.2);
    for (const f of frames) expect([f.body, f.camera]).toEqual([f.y, f.y]);
  });

  it('forgets its easing on reset and ignores a frame without time', () => {
    const ease = createStepEase();
    ease.update(0, true, 1 / 60);
    expect(ease.update(.5, true, 0)).toEqual({ body: .5, camera: 0 });
    ease.reset();
    expect(ease.update(1, true, 1 / 60)).toEqual({ body: 1, camera: 1 });
  });
});
