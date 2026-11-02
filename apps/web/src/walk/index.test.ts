import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WALK_BUTTON, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import type { RealmWalkerPose } from '../realm/client';
import { createWalkController, type WalkRealm } from './index';
import { createPlaySettings } from '../play/settings';

const hudInput = vi.hoisted(() => ({ jump: undefined as (() => void) | undefined }));
const gestureUi = vi.hoisted(() => ({ state: undefined as import('./gestures').GestureState | undefined }));
vi.mock('./gestures', async importOriginal => ({
  ...await importOriginal<typeof import('./gestures')>(),
  mountGestureSelector: (_host: HTMLElement, options: import('./gestures').GestureSelectorOptions) => {
    gestureUi.state = options.state;
    return { setAvailable() {}, setVisible() {}, dispose() { gestureUi.state = undefined; } };
  },
}));
vi.mock('./input/hud', async importOriginal => ({
  ...await importOriginal<typeof import('./input/hud')>(),
  createWalkHud: (_container: HTMLElement, jump: () => void) => {
    hudInput.jump = jump;
    return { update() {}, dispose() { hudInput.jump = undefined; } };
  },
}));

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
  const self = { ...at, speed: 0, placement: 0 };
  const onLeave = signal(), onDrop = signal();
  const fake: WalkRealm = {
    selfId: 'me',
    room: { onLeave, onDrop, state: { collisionRevision: 7, walkers: { get: id => id === 'me' ? { x: self.x, y: self.y, z: self.z, yaw: self.yaw, placement: self.placement } : undefined } } },
    tick(_now, input) {
      sent.push({ ...input });
      const poses: RealmWalkerPose[] = [
        { id: 'me', name: 'Juniper', look: 'a', homeSlot: 65535, ...self, distance: 0, self: true },
        { id: 'other', name: 'Wren', look: 'b', homeSlot: 65535, x: 4, y: 0, z: 4, yaw: 0, distance: 0, speed: 0, self: false },
      ];
      return poses;
    },
  };
  return { fake, sent, self, onLeave, onDrop };
}
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false }));
}
function setup(width = 1440, height = 900, heading?: number, collisionOrHud?: CollisionWorld | (() => CollisionWorld | null) | boolean, gestures?: import('./index').WalkControllerOptions['gestures'], settings?: import('../play/slots').PlaySettingsReader) {
  const withHud = collisionOrHud === true;
  const collision = typeof collisionOrHud === 'boolean' ? undefined : collisionOrHud;
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
  const controller = createWalkController({ camera, surface, realm: world.fake, keyboard, page, lockDocument, coarse: false, clock: () => clock.now, ...(heading === undefined ? {} : { heading }), ...(collision ? { collision } : {}), ...(withHud ? { hud: {} as HTMLElement } : {}), ...(gestures ? { gestures } : {}), ...(settings ? { settings } : {}), keyboardLock: null });
  /** A trusted press into the world (scripted events are never trusted, so tests call the capture directly). */
  const capture = () => controller.cursor.capture({ isTrusted: true, type: 'pointerdown', button: 0 });
  const touch = (type: string, id: number, x: number, y: number) =>
    surface.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, buttons: 1, clientX: x, clientY: y }));
  const mouse = (movementX: number, movementY: number) => lockDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  return { keyboard, page, surface, camera, controller, lockDocument, touch, mouse, clock, capture, ...world };
}

describe('the walk controller', () => {
  it('binds local and witnessed gestures while keeping reset, movement and loss of ownership honest', () => {
    let available = true;
    const publish = vi.fn();
    const { controller, keyboard, sent } = setup(1440, 900, 0, true, { available: () => available, publish, sample: () => 'bow' });
    controller.frame(0);
    gestureUi.state!.play('sit', 0); controller.frame(16);
    expect(controller.gestureFor('me', 16)).toBe('sit');
    expect(controller.gestureFor('other', 16)).toBe('bow');
    key(keyboard, 'keydown', 'KeyW'); controller.frame(32);
    expect(controller.gestureFor('me', 32)).toBe('none');
    expect(sent.at(-1)?.moveZ).toBe(127);
    gestureUi.state!.play('wave', 32); controller.reset(); controller.frame(48);
    // Reset clears the action but retains its live UI/state for the next deliberate action.
    gestureUi.state!.play('cheer', 48); controller.frame(64);
    expect(controller.gestureFor('me', 64)).toBe('cheer');
    controller.release();
    expect(controller.gestureFor('me', 64)).toBe('none');
    controller.resume(); gestureUi.state!.play('wave', 64); controller.frame(80);
    available = false; controller.frame(96);
    expect(controller.gestureFor('me', 96)).toBe('none');
    expect(controller.gestureFor('other', 96)).toBe('none');
    expect(publish.mock.calls.map(([g]) => g)).toEqual(['sit', 'none', 'wave', 'none', 'cheer', 'none', 'wave', 'none']);
    controller.dispose(); expect(gestureUi.state).toBeUndefined();
    expect(controller.gestureFor('other', 112)).toBe('none');
  });
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

  it('comes back from a Forge or build camera to the normal walking view and walks on the first frame', () => {
    const solids: SolidBox[] = [{ min: [-20, -1, -20], max: [20, 0, 20] }];
    const { controller, keyboard, camera, sent } = setup(1440, 900, undefined, { revision: 7, query: () => solids });
    controller.frame(0);
    const entry = { position: camera.position.clone(), fov: camera.fov, filmOffset: camera.filmOffset };
    key(keyboard, 'keydown', 'KeyW'); key(keyboard, 'keydown', 'Space');
    controller.frame(16);
    controller.release();
    // The Forge composes its own shot with a view offset and fov; walking leaves both alone while it owns them.
    camera.position.set(0, 3, 8); camera.fov = 43;
    camera.setViewOffset(1440, 900, -105, 15, 1440, 900);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Escape', repeat: false, ctrlKey: false, metaKey: false, altKey: false });
    keyboard.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    controller.frame(32);
    expect([camera.position.toArray(), camera.fov, camera.view?.enabled]).toEqual([[0, 3, 8], 43, true]);
    expect(controller.selfOpacity).toBe(1);
    // Its close forgot the view offset. The first walking frame is the ordinary view all the same.
    controller.resume();
    controller.frame(48);
    expect(camera.view?.enabled ?? false).toBe(false);
    expect(camera.position.distanceTo(entry.position)).toBeLessThan(.05);
    expect([camera.fov, camera.filmOffset]).toEqual([entry.fov, entry.filmOffset]);
    expect(controller.debug.screen!.x).toBeLessThan(1440 * .4);
    // W and Space are still down from before the Forge opened: the key's own repeat walks on at once,
    // and the held Space never becomes a second jump.
    key(keyboard, 'keydown', 'KeyW', true); key(keyboard, 'keydown', 'Space', true);
    controller.frame(64);
    expect(sent.at(-1)).toMatchObject({ moveZ: -127, buttons: 0 });
  });

  it('hands a first-person walker back to another camera whole, and takes first person back at once', () => {
    const settings = createPlaySettings(null);
    const { controller } = setup(1440, 900, undefined, undefined, undefined, settings);
    controller.frame(0);
    settings.set({ view: 'first' });
    for (let n = 1; n <= 60; n++) controller.frame(n * 16);
    expect([controller.debug.camera.distance, controller.selfOpacity, controller.debug.person]).toEqual([0, 0, 'first']);
    // The director or the Forge looks at the citizen: it must be drawn.
    controller.release();
    expect(controller.selfOpacity).toBe(1);
    controller.resume();
    controller.frame(2000);
    expect([controller.debug.camera.distance, controller.selfOpacity]).toEqual([0, 0]);
  });

  it('applies sensitivity, invert and field of view live from the ledger’s settings', () => {
    const settings = createPlaySettings(null);
    const { controller, mouse, capture, camera } = setup(1440, 900, undefined, true, undefined, settings);
    controller.frame(0);
    capture();
    const fov = camera.fov, start = { ...controller.debug.camera };
    settings.set({ sensitivity: 2, invertY: true, fov: 90 });
    mouse(50, 20);
    controller.frame(16);
    expect(start.yaw - controller.debug.camera.yaw).toBeCloseTo(50 * .0024 * 2, 9);
    // Inverted: moving the mouse down looks up.
    expect(controller.debug.camera.pitch).toBeLessThan(start.pitch);
    expect(camera.fov).toBeGreaterThan(fov);
  });

  it('walks on the keys the person bound, and the arrows always walk too', () => {
    const settings = createPlaySettings(null);
    const { controller, keyboard, sent } = setup(1440, 900, 0, undefined, undefined, settings);
    settings.bind('forward', 'KeyI');
    controller.frame(0);
    key(keyboard, 'keydown', 'KeyW');
    controller.frame(16);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0 });
    key(keyboard, 'keyup', 'KeyW'); key(keyboard, 'keydown', 'KeyI');
    controller.frame(32);
    expect(sent.at(-1)!.moveZ).not.toBe(0);
    key(keyboard, 'keyup', 'KeyI'); key(keyboard, 'keydown', 'ArrowUp');
    controller.frame(48);
    expect(sent.at(-1)!.moveZ).not.toBe(0);
  });

  it('holds input under a page without moving the camera off the citizen', () => {
    const { controller, keyboard, sent } = setup(1440, 900, 0);
    controller.frame(0);
    key(keyboard, 'keydown', 'KeyW');
    controller.hold(true);
    controller.frame(16);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0 });
    expect([controller.owner, controller.held, controller.debug.ready]).toEqual(['walking', true, true]);
    key(keyboard, 'keydown', 'KeyW');
    controller.frame(32);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0 });
    controller.hold(false);
    key(keyboard, 'keydown', 'KeyW');
    controller.frame(48);
    expect(sent.at(-1)!.moveZ).not.toBe(0);
  });

  it('lends the captured mouse to a seated game while held, and drops movement no one asked for', () => {
    const { controller, mouse, clock, capture } = setup(1440, 900, 0, true);
    controller.frame(0);
    capture();
    const yaw = controller.debug.camera.yaw, seen: number[][] = [];
    controller.hold(true);
    controller.divertLook((dx, dy) => seen.push([dx, dy]));
    clock.now = 50; mouse(30, -4); mouse(31, -5);
    controller.frame(60);
    expect(seen).toEqual([[61, -9]]);
    controller.divertLook(null);
    clock.now = 80; mouse(40, 0); mouse(40, 0);
    controller.frame(90);
    controller.hold(false);
    controller.frame(110);
    // Nothing gathered while held turns the camera on release.
    expect(controller.debug.camera.yaw).toBeCloseTo(yaw, 9);
  });

  it('keeps the boom short in a place and lets it pass the walls the place fades', () => {
    const solids: SolidBox[] = [{ min: [-20, -1, -20], max: [20, 0, 20] }];
    const wall: SolidBox = { min: [-20, 0, 11], max: [20, 6, 11.4] };
    const { controller, camera } = setup(1440, 900, undefined, () => ({ revision: 3, query: () => [...solids, wall] }));
    controller.frame(0); controller.frame(16);
    expect(camera.position.z).toBeLessThan(11);
    controller.limitCamera({ maxDistance: 3, tilt: [.1, .5], seeThrough: [{ min: [-30, -.5, 10.5], max: [30, 7, 12] }] });
    for (let t = 32; t < 3000; t += 16) controller.frame(t);
    expect(controller.debug.camera.desiredDistance).toBeCloseTo(3, 6);
    expect(controller.debug.camera.clearance).toBeNull();
    controller.limitCamera(null);
    for (let t = 3000; t < 4000; t += 16) controller.frame(t);
    expect(controller.debug.camera.desiredDistance).toBeGreaterThan(5);
    expect(camera.position.z).toBeLessThan(11);
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
      const { controller, mouse, clock, capture } = setup(width, height, undefined, true);
      controller.frame(0);
      capture();
      expect(controller.debug.look).toBe('locked');
      const start = controller.debug.camera.yaw;
      // Nothing else is drawn for 200 ms (a stalled frame), while the hand keeps moving.
      clock.now = 120;
      for (let n = 0; n < 10; n++) { mouse(20, 0); clock.now += 13; }
      mouse(600, 0); // a warp: alone, far larger than the steady hand before it
      controller.frame(250);
      clock.now += 40; mouse(19, 0); mouse(21, 0);
      controller.frame(300);
      return start - controller.debug.camera.yaw;
    };
    const desktop = turn(1440, 900), phone = turn(390, 844);
    expect(desktop).toBeCloseTo(240 * .0024, 9);
    expect(phone).toBeCloseTo(desktop, 9);
  });
  it('lets go of held keys, a pending jump and the stick on a dropped connection, a hidden page and a menu', () => {
    const { controller, keyboard, page, touch, onDrop, onLeave, lockDocument, sent, capture } = setup(1440, 900, undefined, true);
    controller.frame(0);
    const holdAll = () => {
      key(keyboard, 'keydown', 'KeyW'); key(keyboard, 'keydown', 'Space');
      touch('pointerdown', 1, 200, 800); touch('pointermove', 1, 200, 740);
    };
    const still = (now: number) => {
      controller.frame(now);
      expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0 });
      expect(controller.debug.stick).toBeNull();
    };
    holdAll(); onDrop.fire(4000); still(16);
    key(keyboard, 'keyup', 'Space');
    holdAll(); onLeave.fire(1000); still(32);
    key(keyboard, 'keyup', 'Space');
    holdAll(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); still(48);
    page.hidden = false; key(keyboard, 'keyup', 'Space');
    capture();
    expect(lockDocument.pointerLockElement).not.toBeNull();
    holdAll(); controller.release();
    controller.frame(64);
    // Handing the camera away lets the mouse go too, as the walk's own release: never the person's Escape.
    expect([controller.debug.look, lockDocument.pointerLockElement, sent.at(-1)!.buttons]).toEqual(['touch', null, 0]);
    expect(controller.cursor.mode).toBe('idle');
    expect(capture()).toBe(false);
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

  it('does not inject an exact 30 Hz height change before SDK rendered feet begin moving', () => {
    const { controller, camera, fake, self } = setup();
    const predicted: PlayerState = { x: self.x, y: 0, z: self.z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: self.yaw, distance: 0, collisionRevision: 7 };
    Object.defineProperty(fake, 'predicted', { value: predicted });
    controller.frame(0); controller.frame(1000 / 360);
    const cameraY = camera.position.y;
    // A fixed tick climbs, while interpolation still draws the previous endpoint. Both presentation consumers
    // must stay on that endpoint; the exact state only supplies grounded/revision decisions.
    predicted.y = .5;
    const drawn = controller.frame(2000 / 360).find(p => p.self)!;
    expect(drawn.y).toBe(0);
    expect(camera.position.y).toBeCloseTo(cameraY, 12);
    self.y = .5 / 12;
    controller.frame(3000 / 360);
    expect(controller.debug.self!.y).toBe(self.y);
    expect(camera.position.y).toBeGreaterThanOrEqual(cameraY);
    controller.dispose();
  });

  it('eases a predicted step down without moving collision feet or drawing the head into the next lintel', () => {
    const lintel: SolidBox = { min: [2.5, 1.8, 8], max: [4, 3, 10] };
    const collision: CollisionWorld = { revision: 7, query: () => [lintel] };
    const { controller, fake, self } = setup(390, 844, undefined, collision);
    self.y = .5;
    const predicted: PlayerState = { x: self.x, y: .5, z: self.z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: self.yaw, distance: 0, collisionRevision: 7 };
    Object.defineProperty(fake, 'predicted', { value: predicted });
    controller.frame(0);
    self.y = predicted.y = 0;
    expect(controller.frame(16).find(p => p.self)!.y).toBeGreaterThan(0);
    expect(predicted.y).toBe(0);
    // The next step of horizontal travel is under a lintel that clears the real body, but not its easing.
    self.x = predicted.x = 3;
    expect(controller.frame(32).find(p => p.self)!.y).toBe(0);
    self.y = predicted.y = .2; predicted.grounded = false;
    expect(controller.frame(48).find(p => p.self)!.y).toBe(.2);
    self.x = predicted.x = 2; self.y = predicted.y = .5; predicted.grounded = true;
    controller.frame(64);
    self.y = predicted.y = 0;
    expect(controller.frame(80).find(p => p.self)!.y).toBeGreaterThan(0);
    // A relocation at identical feet height must also drop residual body and camera stair easing.
    self.placement++;
    expect(controller.frame(96).find(p => p.self)!.y).toBe(0);
    controller.dispose();
  });

  it.each(['blur', 'contextmenu'])('drops a queued phone jump and every held input on %s', event => {
    const { controller, keyboard, touch, lockDocument, sent, fake } = setup(390, 844, undefined, true);
    const clearInput = vi.fn(); Object.assign(fake, { clearInput });
    controller.frame(0);
    key(keyboard, 'keydown', 'KeyW');
    touch('pointerdown', 1, 90, 700); touch('pointermove', 1, 90, 600);
    hudInput.jump!();
    keyboard.dispatchEvent(new Event(event, { cancelable: true }));
    controller.frame(16);
    expect(sent.at(-1)).toMatchObject({ moveX: 0, moveZ: 0, buttons: 0 });
    expect([controller.debug.stick, lockDocument.pointerLockElement]).toEqual([null, null]);
    expect(clearInput).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
