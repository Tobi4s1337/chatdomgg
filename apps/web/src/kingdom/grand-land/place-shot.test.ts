import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createPlaceShot, type PlaceShotOwners } from './place-shot';

const unowned: PlaceShotOwners = { walking: false, capture: false, build: false, forge: false, arrival: false, moment: false, growth: false, dock: false, handoff: false };
const game = { eye: [6, 4, 9] as const, at: [1, 2, 3] as const };

describe('game shots as a layer over the director', () => {
  it('frames the shared host camera from eye/at and preserves its projection', () => {
    const layer = createPlaceShot(), camera = new PerspectiveCamera(53, 16 / 9), target = new Vector3();
    layer.set(game);
    expect(layer.apply(camera, target, unowned)).toBe(true);
    expect(camera.position.toArray()).toEqual(game.eye);
    expect(target.toArray()).toEqual(game.at);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(target.clone().sub(camera.position).normalize())).toBeLessThan(1e-10);
    expect(camera.fov).toBe(53); expect(camera.aspect).toBe(16 / 9);
    expect(layer.inspect()).toEqual({ requested: true, active: true });
  });

  it.each(Object.keys(unowned) as (keyof PlaceShotOwners)[])('yields to %s without disturbing that owner or losing the request', owner => {
    const layer = createPlaceShot(), camera = new PerspectiveCamera(), target = new Vector3(10, 2, 6);
    layer.set(game); layer.apply(camera, target, unowned);
    camera.position.set(40, 20, -12); target.set(10, 2, 6); camera.lookAt(target);
    const rotation = camera.quaternion.clone();
    layer.set({ eye: [7, 5, 10], at: game.at });
    expect(layer.apply(camera, target, { ...unowned, [owner]: true })).toBe(false);
    expect(camera.position.toArray()).toEqual([40, 20, -12]);
    expect(target.toArray()).toEqual([10, 2, 6]);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    expect(layer.inspect()).toEqual({ requested: true, active: false });
    expect(layer.apply(camera, target, unowned)).toBe(true);
    expect(camera.position.toArray()).toEqual([7, 5, 10]);
  });

  it('leaves the current base director intact after null and revises even a frozen evidence frame', () => {
    const layer = createPlaceShot(), camera = new PerspectiveCamera(), target = new Vector3();
    layer.set(game); layer.apply(camera, target, unowned);
    const gameRevision = layer.revision;
    layer.set(null);
    // The host recomputes its current hero/window/citizen base each frame, before this layer runs.
    camera.position.set(72, 23, 16); target.set(-2, 9, -8); camera.lookAt(target);
    const rotation = camera.quaternion.clone();
    expect(layer.apply(camera, target, unowned)).toBe(false);
    expect(layer.revision).toBeGreaterThan(gameRevision);
    expect(camera.position.toArray()).toEqual([72, 23, 16]);
    expect(target.toArray()).toEqual([-2, 9, -8]);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    expect(layer.inspect()).toEqual({ requested: false, active: false });
  });

  it('copies authored shots, ignores identical refreshes and rejects invalid framing atomically', () => {
    const layer = createPlaceShot(), camera = new PerspectiveCamera(), target = new Vector3();
    const eye: [number, number, number] = [6, 4, 9], at: [number, number, number] = [1, 2, 3];
    layer.set({ eye, at });
    const revision = layer.revision;
    layer.set(game);
    expect(layer.revision).toBe(revision);
    eye[0] = 999; at[1] = 999;
    for (const shot of [{ eye: [NaN, 1, 2], at: [1, 2, 3] }, { eye: [1, 2, 3], at: [1, 2, 3] }] as const) {
      expect(() => layer.set(shot)).toThrow('finite distinct');
    }
    layer.apply(camera, target, unowned);
    expect(camera.position.toArray()).toEqual(game.eye);
    expect(target.toArray()).toEqual(game.at);
  });
});
