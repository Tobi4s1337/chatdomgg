import { describe, expect, it } from 'vitest';
import { stepPlayer } from '@chatdom/world/movement';
import { WALK_HZ, type CollisionWorld, type PlayerState } from '@chatdom/shared/realm';
import { angleBetween, facingByte, headingFromByte, walkDirection } from './direction';

const OPEN: CollisionWorld = { revision: 1, query: () => [{ min: [-100, -1, -100], max: [100, 0, 100] }] };
const travel = (moveX: number, moveZ: number, buttons = 0) => {
  const state: PlayerState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 1 };
  for (let n = 0; n < WALK_HZ; n++) stepPlayer(state, { moveX, moveZ, buttons, yaw: 0, collisionRevision: 1 }, 1 / WALK_HZ, OPEN);
  return Math.hypot(state.x, state.z);
};

describe('camera-relative walking', () => {
  it('walks into the picture whichever way the camera looks', () => {
    // Looking down -Z (the reference court's entry view), W walks -Z and D walks +X.
    expect(walkDirection(1, 0, Math.PI)).toEqual({ moveX: 0, moveZ: -127 });
    expect(walkDirection(0, 1, Math.PI)).toEqual({ moveX: 127, moveZ: 0 });
    // Looking down +X, W walks +X and D walks to the camera's right hand, +Z.
    expect(walkDirection(1, 0, Math.PI / 2)).toEqual({ moveX: 127, moveZ: 0 });
    expect(walkDirection(0, 1, Math.PI / 2)).toEqual({ moveX: 0, moveZ: 127 });
    expect(walkDirection(-1, 0, 0)).toEqual({ moveX: 0, moveZ: -127 });
  });

  it('never makes a diagonal faster than a straight walk, at any heading', () => {
    const straight = travel(127, 0);
    expect(straight).toBeCloseTo(4, 5);
    for (let k = 0; k < 64; k++) {
      const heading = k / 64 * Math.PI * 2 + .013;
      const diagonal = walkDirection(1, -1, heading);
      expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBeLessThanOrEqual(127.75);
      expect(travel(diagonal.moveX, diagonal.moveZ)).toBeLessThanOrEqual(straight + 1e-9);
      expect(travel(diagonal.moveX, diagonal.moveZ, 1)).toBeLessThanOrEqual(7 + 1e-9);
      expect(travel(diagonal.moveX, diagonal.moveZ)).toBeGreaterThan(3.98);
    }
  });

  it('keeps a gentle thumb gentle and refuses broken numbers', () => {
    const half = walkDirection(.5, 0, 0);
    expect(half).toEqual({ moveX: 0, moveZ: 64 });
    expect(walkDirection(0, 0, 1)).toEqual({ moveX: 0, moveZ: 0 });
    expect(walkDirection(Number.NaN, 1, 0)).toEqual({ moveX: 0, moveZ: 0 });
    expect(walkDirection(1, 0, Number.POSITIVE_INFINITY)).toEqual({ moveX: 0, moveZ: 0 });
    expect(walkDirection(5, 0, 0)).toEqual({ moveX: 0, moveZ: 127 });
  });

  it('faces the actual walk direction and keeps facing when still', () => {
    expect(facingByte(0, 127)).toBe(0);
    expect(facingByte(127, 0)).toBe(64);
    expect(facingByte(0, -127)).toBe(128);
    expect(facingByte(-127, 0)).toBe(192);
    expect(facingByte(0, 0)).toBeNull();
    // A byte heading survives the round trip through the renderer's radians.
    for (const yaw of [0, 1, 63, 128, 200, 255]) {
      const heading = headingFromByte(yaw);
      const move = walkDirection(1, 0, heading);
      expect(facingByte(move.moveX, move.moveZ)).toBe(yaw);
    }
  });

  it('measures the short way round', () => {
    expect(angleBetween(.1, Math.PI * 2 - .1)).toBeCloseTo(-.2);
    expect(angleBetween(Math.PI * 2 - .1, .1)).toBeCloseTo(.2);
  });
});
