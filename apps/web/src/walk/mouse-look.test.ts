import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RealmWalkerPose } from '../realm/client';
import { createWalkController, LOOK, type WalkRealm } from './index';
import { wrapAngle } from './input/direction';

/**
 * End to end through look.ts and the shoulder rig: synthetic 1000 Hz locked mousemove at 60, 144, 240 and 360 Hz
 * frames. The realm walks the citizen where the input says, as the server does, so camera-relative walking and
 * the camera's auto-follow can meet.
 */
function setup(coarse = false) {
  const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  const lockDocument = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, exitPointerLock() {} });
  const surface = Object.assign(new EventTarget(), {
    clientWidth: 1440, clientHeight: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    requestPointerLock() { lockDocument.pointerLockElement = surface; lockDocument.dispatchEvent(new Event('pointerlockchange')); },
  });
  const self = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, placement: 0 };
  const signal = Object.assign(() => {}, { remove() {} });
  const realm: WalkRealm = {
    selfId: 'me',
    room: { onLeave: signal, onDrop: signal, state: { collisionRevision: 1, walkers: { get: () => self } } },
    tick(_now, input) {
      const moving = input.moveX !== 0 || input.moveZ !== 0;
      self.speed = moving ? 4.5 : 0;
      if (moving) self.yaw = input.yaw;
      return [{ id: 'me', name: 'Juniper', look: 'a', homeSlot: 65535, ...self, distance: 0, self: true } as RealmWalkerPose];
    },
  };
  const clock = { now: 0 };
  const controller = createWalkController({ camera: new THREE.PerspectiveCamera(), surface, realm, keyboard, page, lockDocument, coarse,
    clock: () => clock.now, heading: 0, keyboardLock: null });
  const mouse = (movementX: number, movementY: number) => lockDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  const key = (type: 'keydown' | 'keyup', code: string) => keyboard.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  /** Run `ms` of 1 ms ticks, drawing a frame every 1000/hz ms. */
  const run = (from: number, ms: number, hz: number, each?: (at: number) => void) => {
    let drawn = from;
    for (let at = from + 1; at <= from + ms; at++) { clock.now = at; each?.(at); if (at - drawn >= 1000 / hz) { drawn = at; controller.frame(at); } }
    controller.frame(from + ms);
    return from + ms;
  };
  return { controller, mouse, key, run, clock, capture: () => controller.cursor.capture({ isTrusted: true, type: 'pointerdown', button: 0 }) };
}
const turned = (from: number, to: number) => wrapAngle(from - to);

describe('mouse look end to end', () => {
  for (const hz of [60, 144, 240, 360]) {
    it(`turns exactly as far as the hand moved at ${hz} Hz, and not a hair after`, () => {
      const { controller, mouse, run, capture } = setup();
      controller.frame(0); capture();
      const start = controller.debug.camera.yaw;
      // 300 ms of a 1000 Hz mouse, 3 counts per poll: 900 counts right.
      const at = run(0, 300, hz, () => mouse(3, 0));
      const after = controller.debug.camera.yaw;
      expect(turned(start, after)).toBeCloseTo(900 * LOOK.radiansPerPx, 9);
      // The hand stops: nothing keeps turning.
      run(at, 3000, hz);
      expect(controller.debug.camera.yaw).toBe(after);
    });
  }
  it('keeps a Firefox-style accelerated flick whole at 360 Hz (no raw input: events ramp to hundreds of px)', () => {
    const { controller, mouse, run, capture } = setup();
    controller.frame(0); capture();
    const start = controller.debug.camera.yaw;
    // 60 ms of a 1000 Hz mouse under Windows pointer acceleration: a smooth bell from 0 up to 300 px per event and back.
    const flick = Array.from({ length: 60 }, (_, i) => Math.round(300 * Math.sin(Math.PI * (i + .5) / 60) ** 2));
    let n = 0;
    run(0, 400, 360, () => { if (n < flick.length) mouse(flick[n++]!, 0); });
    const total = flick.reduce((a, b) => a + b, 0);
    expect(turned(start, controller.debug.camera.yaw)).toBeCloseTo(wrapAngle(total * LOOK.radiansPerPx), 9);
  });
  it('sums Firefox-on-Windows recentre pairs whole: a reset and its correction cancel, the camera never jumps', () => {
    // Firefox locks on Windows by re-centring the hidden cursor; the locked stream can carry a large delta and its
    // equal and opposite correction (bugzilla 2055058). Only the hand's 8 counts per poll may turn the world.
    const { controller, mouse, run, capture } = setup();
    controller.frame(0); capture();
    const start = controller.debug.camera.yaw;
    let n = 0, hand = 0;
    run(0, 500, 360, () => {
      n++;
      if (n % 50 === 25) { mouse(300, 0); mouse(-300, 0); }
      else { mouse(8, 0); hand += 8; }
    });
    expect(turned(start, controller.debug.camera.yaw)).toBeCloseTo(wrapAngle(hand * LOOK.radiansPerPx), 9);
  });
  it('a small nudge on a 1600 DPI mouse is a small turn (1 cm, 630 raw counts, under 40°)', () => {
    const { controller, mouse, capture } = setup();
    controller.frame(0); capture();
    const start = controller.debug.camera.yaw;
    for (let n = 0; n < 63; n++) mouse(10, 0);
    controller.frame(16);
    expect(Math.abs(turned(start, controller.debug.camera.yaw)) * 180 / Math.PI).toBeLessThan(40);
  });
  for (const hz of [60, 240, 360]) {
    it(`never spins on its own while a mouse player strafes or walks a diagonal (${hz} Hz)`, () => {
      const { controller, key, mouse, run, capture } = setup();
      controller.frame(0); capture();
      let at = run(0, 100, hz, () => mouse(2, 0));
      const settled = controller.debug.camera.yaw;
      key('keydown', 'KeyD');
      at = run(at, 6000, hz);
      expect(controller.debug.camera.yaw).toBe(settled);
      key('keydown', 'KeyW');
      run(at, 6000, hz);
      expect(controller.debug.camera.yaw).toBe(settled);
    });
  }
  it('a thumb on the stick still has the camera swing behind the walk', () => {
    const { controller, key, run } = setup(true);
    controller.frame(0);
    const start = controller.debug.camera.yaw;
    key('keydown', 'KeyD');
    run(0, 4000, 60);
    expect(Math.abs(turned(start, controller.debug.camera.yaw))).toBeGreaterThan(.3);
  });
});
