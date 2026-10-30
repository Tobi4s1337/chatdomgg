import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALK_BUTTON, type CollisionWorld, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import type { RealmWalkerPose } from '../realm/client';
import { createWalkController, type WalkRealm } from './index';

function signal() {
  const listeners = new Set<(code: number) => void>();
  return Object.assign((listener: (code: number) => void) => { listeners.add(listener); }, {
    remove: (listener: (code: number) => void) => { listeners.delete(listener); },
    fire: (code: number) => { for (const listener of listeners) listener(code); },
    count: () => listeners.size,
  });
}
function realm(at: { x: number; y: number; z: number; yaw: number }) {
  const sent: WalkInput[] = [];
  const self = { ...at, speed: 0 };
  const onLeave = signal(), onDrop = signal();
  const fake: WalkRealm = {
    selfId: 'me',
    room: { onLeave, onDrop, state: { collisionRevision: 7, walkers: { get: id => id === 'me' ? { x: self.x, y: self.y, z: self.z, yaw: self.yaw } : undefined } } },
    tick(_now, input) {
      sent.push({ ...input });
      const poses: RealmWalkerPose[] = [
        { id: 'me', name: 'Juniper', look: 'a', ...self, distance: 0, self: true },
        { id: 'other', name: 'Wren', look: 'b', x: 4, y: 0, z: 4, yaw: 0, distance: 0, speed: 0, self: false },
      ];
      return poses;
    },
  };
  return { fake, sent, self, onLeave, onDrop };
}
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false }));
}
function setup(width = 1440, height = 900, heading?: number, collision?: CollisionWorld | (() => CollisionWorld | null)) {
  const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  const lockDocument = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock() { if (lockDocument.pointerLockElement) { lockDocument.pointerLockElement = null; lockDocument.dispatchEvent(new Event('pointerlockchange')); } },
  });
  const surface = Object.assign(new EventTarget(), {
    clientWidth: width, clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    requestPointerLock() { lockDocument.pointerLockElement = surface; lockDocument.dispatchEvent(new Event('pointerlockchange')); },
  });
  const camera = new THREE.PerspectiveCamera(52, width / height, .15, 2200);
  const world = realm({ x: 2, y: 0, z: 9, yaw: 128 });
  const clock = { now: 0 };
  const controller = createWalkController({ camera, surface, realm: world.fake, keyboard, page, lockDocument, coarse: false, clock: () => clock.now, ...(heading === undefined ? {} : { heading }), ...(collision ? { collision } : {}) });
  const touch = (type: string, id: number, x: number, y: number) =>
    surface.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, buttons: 1, clientX: x, clientY: y }));
  const mouse = (movementX: number, movementY: number) => lockDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  return { keyboard, page, surface, camera, controller, lockDocument, touch, mouse, clock, ...world };
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

  it('walks and sprints with the phone stick, camera relative, and turns with a second finger', () => {
    const { controller, touch, sent } = setup(390, 844);
    controller.frame(0);
    // Facing -Z: pushing the stick up walks -Z, pushing it right walks +X (the camera's right hand).
    touch('pointerdown', 1, 90, 700); touch('pointermove', 1, 90, 600);
    controller.frame(16);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: -127, buttons: WALK_BUTTON.sprint, yaw: 128 });
    expect(controller.debug.stick).toMatchObject({ x: 90, y: 700, sprint: true });
    touch('pointermove', 1, 120, 700);
    controller.frame(32);
    const half = sent.at(-1)!;
    expect(half.moveZ).toBe(0);
    expect(half.moveX).toBeGreaterThan(60);
    expect(half.moveX).toBeLessThan(90);
    expect(half.buttons).toBe(0);
    const before = controller.debug.camera.yaw;
    touch('pointerdown', 2, 300, 300); touch('pointermove', 2, 340, 300);
    controller.frame(48);
    expect(controller.debug.camera.yaw).not.toBeCloseTo(before, 3);
    touch('pointerup', 1, 120, 700);
    controller.frame(64);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0 });
  });

  it('turns a fixed angle per locked mouse pixel, gathering a whole slow frame', () => {
    const turn = (width: number, height: number) => {
      const { controller, keyboard, mouse, clock } = setup(width, height);
      controller.frame(0);
      key(keyboard, 'keydown', 'KeyV');
      expect(controller.debug.look).toBe('locked');
      const start = controller.debug.camera.yaw;
      clock.now = 50; mouse(50, 0); // inside the settle window: ignored
      controller.frame(50);
      expect(controller.debug.camera.yaw).toBe(start);
      // Nothing else is drawn for 200 ms (a stalled frame), while the hand keeps moving.
      clock.now = 120;
      for (let n = 0; n < 10; n++) { mouse(20, 0); clock.now += 13; }
      mouse(600, 0); // a warp
      controller.frame(250);
      return start - controller.debug.camera.yaw;
    };
    const desktop = turn(1440, 900), phone = turn(390, 844);
    expect(desktop).toBeCloseTo(200 * .0024, 9);
    expect(phone).toBeCloseTo(desktop, 9);
  });

  it('lets go of held keys, a pending jump, the stick and the lock on a dropped connection, a hidden page and a menu', () => {
    const { controller, keyboard, page, touch, onDrop, onLeave, lockDocument, sent } = setup();
    controller.frame(0);
    const holdAll = () => {
      key(keyboard, 'keydown', 'KeyW'); key(keyboard, 'keydown', 'Space'); key(keyboard, 'keydown', 'KeyV');
      touch('pointerdown', 1, 200, 800); touch('pointermove', 1, 200, 740);
    };
    const still = (now: number) => {
      controller.frame(now);
      expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0 });
      expect([controller.debug.look, controller.debug.stick, lockDocument.pointerLockElement]).toEqual(['free', null, null]);
    };
    holdAll(); onDrop.fire(4000); still(16);
    key(keyboard, 'keyup', 'Space');
    holdAll(); onLeave.fire(1000); still(32);
    key(keyboard, 'keyup', 'Space');
    holdAll(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); still(48);
    page.hidden = false; key(keyboard, 'keyup', 'Space');
    holdAll(); controller.release();
    controller.frame(64);
    expect([controller.debug.look, lockDocument.pointerLockElement, sent.at(-1)!.buttons]).toEqual(['free', null, 0]);
    // V is not heard while the menu owns the keyboard.
    key(keyboard, 'keydown', 'KeyV');
    expect(controller.debug.look).toBe('free');
  });

  it('lets go of everything on dispose', () => {
    const { controller, keyboard, camera, sent, onLeave, onDrop } = setup();
    controller.frame(0);
    expect([onLeave.count(), onDrop.count()]).toEqual([1, 1]);
    controller.dispose();
    expect([onLeave.count(), onDrop.count()]).toEqual([0, 0]);
    expect([controller.owner, camera.filmOffset, controller.debug.ready]).toEqual(['disposed', 0, false]);
    key(keyboard, 'keydown', 'KeyW');
    expect(controller.frame(16)).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('keeps the camera out of the newest supplied collision world from the first frame a wall exists', () => {
    const solids: SolidBox[] = [{ min: [-20, -1, -20], max: [20, 0, 20] }];
    let world: CollisionWorld | null = { revision: 7, query: () => solids };
    const { controller, camera } = setup(1440, 900, undefined, () => world);
    controller.frame(0); controller.frame(16);
    // The citizen stands at z = 9 facing -Z; the shoulder camera is about six metres behind, toward +Z.
    expect(camera.position.z).toBeGreaterThan(14);
    expect(controller.debug.camera).toMatchObject({ clearance: null, collisionRevision: 7, near: camera.near });
    // A newly published revision puts a wall two metres behind the citizen.
    const wall: SolidBox = { min: [-20, 0, 11], max: [20, 6, 11.4] };
    world = { revision: 8, query: () => [...solids, wall] };
    controller.frame(32);
    expect(camera.position.z).toBeLessThan(11);
    expect(controller.debug.camera.collisionRevision).toBe(8);
    expect(controller.debug.camera.clearance).toBe(controller.debug.camera.distance);
    expect(controller.debug.camera.desiredDistance).toBeGreaterThan(6);
    // A moment without a world keeps the last one rather than letting the camera through the wall.
    world = null;
    controller.frame(48);
    expect(camera.position.z).toBeLessThan(11);
    expect(controller.debug.camera.collisionRevision).toBe(8);
  });

  it('reports a camera with no collision world honestly', () => {
    const { controller } = setup();
    controller.frame(0);
    expect(controller.debug.camera.collisionRevision).toBeNull();
    expect(controller.debug.camera.clearance).toBeNull();
  });
});
