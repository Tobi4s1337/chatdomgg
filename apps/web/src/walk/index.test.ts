import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALK_BUTTON, type WalkInput } from '@chatdom/shared/realm';
import type { RealmWalkerPose } from '../realm/client';
import { createWalkController, type WalkRealm } from './index';

function realm(at: { x: number; y: number; z: number; yaw: number }) {
  const sent: WalkInput[] = [];
  const self = { ...at, speed: 0 };
  const fake: WalkRealm = {
    selfId: 'me',
    room: { state: { collisionRevision: 7, walkers: { get: id => id === 'me' ? { x: self.x, y: self.y, z: self.z, yaw: self.yaw } : undefined } } },
    tick(_now, input) {
      sent.push({ ...input });
      const poses: RealmWalkerPose[] = [
        { id: 'me', name: 'Juniper', look: 'a', ...self, distance: 0, self: true },
        { id: 'other', name: 'Wren', look: 'b', x: 4, y: 0, z: 4, yaw: 0, distance: 0, speed: 0, self: false },
      ];
      return poses;
    },
  };
  return { fake, sent, self };
}
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false }));
}
function setup(width = 1440, height = 900, heading?: number) {
  const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  const surface = Object.assign(new EventTarget(), { clientWidth: width, clientHeight: height });
  const camera = new THREE.PerspectiveCamera(52, width / height, .15, 2200);
  const world = realm({ x: 2, y: 0, z: 9, yaw: 128 });
  const controller = createWalkController({ camera, surface, realm: world.fake, keyboard, page, ...(heading === undefined ? {} : { heading }) });
  return { keyboard, page, surface, camera, controller, ...world };
}

describe('the walk controller', () => {
  it('puts the camera on the connected citizen behind the way they face', () => {
    const { controller, camera, sent } = setup();
    expect(controller.debug.ready).toBe(false);
    const poses = controller.frame(1000);
    expect(poses).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(controller.debug.ready).toBe(true);
    // The citizen faces -Z (yaw byte 128); the camera stands behind them on the +Z side, looking -Z.
    expect(camera.position.z).toBeGreaterThan(9);
    const look = new THREE.Vector3(); camera.getWorldDirection(look);
    expect(look.z).toBeLessThan(-.9);
    expect(camera.filmOffset).toBeGreaterThan(0);
    const { screen, viewport } = controller.debug;
    expect(screen!.x).toBeLessThan(viewport.width * .37);
    expect(screen!.y).toBeGreaterThan(viewport.height * .6);
    expect(controller.debug.authority).toEqual({ x: 2, y: 0, z: 9 });
    expect(controller.debug.walkers).toBe(2);
    expect(controller.debug.peers).toEqual([{ id: 'other', x: 4, y: 0, z: 4 }]);
  });

  it('keeps a newly placed citizen facing the way the room placed them', () => {
    const { controller, sent } = setup();
    controller.frame(0); controller.frame(16);
    expect(sent.map(input => input.yaw)).toEqual([128, 128]);
  });

  it('sends camera-relative, quantized walking with the actual collision revision', () => {
    const { controller, keyboard, sent } = setup();
    controller.frame(0);
    key(keyboard, 'keydown', 'KeyW'); key(keyboard, 'keydown', 'ShiftLeft');
    controller.frame(16);
    expect(sent.at(-1)).toEqual({ moveX: 0, moveZ: -127, buttons: WALK_BUTTON.sprint, yaw: 128, collisionRevision: 7 });
    key(keyboard, 'keyup', 'KeyW'); key(keyboard, 'keydown', 'KeyD');
    controller.frame(32);
    expect(sent.at(-1)).toMatchObject({ moveX: 127, moveZ: 0, yaw: 64 });
    // Standing still keeps facing where they last walked rather than turning to the camera.
    key(keyboard, 'keyup', 'KeyD'); key(keyboard, 'keyup', 'ShiftLeft');
    controller.frame(48);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0, yaw: 64 });
  });

  it('turns a press of Space into exactly one rising edge', () => {
    const { controller, keyboard, sent } = setup();
    controller.frame(0);
    key(keyboard, 'keydown', 'Space');
    for (let n = 1; n <= 5; n++) { key(keyboard, 'keydown', 'Space', true); controller.frame(n * 16); }
    expect(sent.slice(1).map(input => input.buttons & WALK_BUTTON.jump)).toEqual([2, 0, 0, 0, 0]);
    // Two quick presses between the same pair of frames make two edges, a frame apart.
    key(keyboard, 'keyup', 'Space'); key(keyboard, 'keydown', 'Space');
    controller.frame(100);
    key(keyboard, 'keyup', 'Space'); key(keyboard, 'keydown', 'Space');
    controller.frame(116); controller.frame(132); controller.frame(148);
    expect(sent.slice(-4).map(input => input.buttons & WALK_BUTTON.jump)).toEqual([2, 0, 2, 0]);
  });

  it('hands the camera over cleanly and takes it back ready to walk', () => {
    const { controller, keyboard, camera, sent } = setup();
    controller.frame(0);
    key(keyboard, 'keydown', 'KeyW');
    controller.release();
    expect([controller.owner, camera.filmOffset]).toEqual(['released', 0]);
    // The menu's camera stays where its owner puts it; the realm still ticks, idle.
    camera.position.set(-50, 40, -50);
    controller.frame(16);
    expect(camera.position.toArray()).toEqual([-50, 40, -50]);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0 });
    // Keys pressed while a menu owns the keyboard do nothing, and nothing stays held afterwards.
    key(keyboard, 'keydown', 'KeyA');
    controller.resume();
    controller.frame(32);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0 });
    expect(camera.position.z).toBeGreaterThan(9);
    expect(camera.filmOffset).toBeGreaterThan(0);
    key(keyboard, 'keydown', 'KeyW');
    controller.frame(48);
    expect(sent.at(-1)).toMatchObject({ moveZ: -127 });
  });

  it('follows the given entry heading and resets to it', () => {
    const { controller, camera } = setup(390, 844, Math.PI / 2);
    controller.frame(0);
    const look = new THREE.Vector3(); camera.getWorldDirection(look);
    expect(look.x).toBeGreaterThan(.9);
    expect(controller.debug.screen!.x).toBeLessThan(390 * .4);
    controller.reset(0);
    controller.frame(16);
    camera.getWorldDirection(look);
    expect(look.z).toBeGreaterThan(.9);
  });

  it('uses the resized surface for framing', () => {
    const { controller, camera } = setup();
    controller.resize(390, 844);
    controller.frame(0);
    expect(camera.aspect).toBeCloseTo(390 / 844);
    expect(controller.debug.viewport).toEqual({ width: 390, height: 844 });
    expect(controller.debug.screen!.y).toBeGreaterThan(844 * .6);
  });

  it('lets go of everything on dispose', () => {
    const { controller, keyboard, camera, sent } = setup();
    controller.frame(0);
    controller.dispose();
    expect([controller.owner, camera.filmOffset, controller.debug.ready]).toEqual(['disposed', 0, false]);
    key(keyboard, 'keydown', 'KeyW');
    expect(controller.frame(16)).toEqual([]);
    expect(sent).toHaveLength(1);
  });
});
