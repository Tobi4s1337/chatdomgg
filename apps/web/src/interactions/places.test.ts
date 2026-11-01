import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, CommittedForgeAttachment, SolidBox } from '@chatdom/shared/realm';
import { createInteractionRegistry, interactionTargetId } from '../../../../packages/world/src/interactions';
import { campfirePlacement, tavernPlacement } from '../../../../packages/world/src/interactions/places';
import type { ForgeObservationHandlers } from '../realm/adapters/forge';
import { createInteractionController } from './controller';
import { LANDED_MS, anvilHomeLine, anvilLine, watchAnvil } from './places/anvil-state';
import { BODY_CLEAR, FRAMING_MS, anvilShot, clearShot, createShotEase, seatShot } from './places/framing';
import { composeInteractionPlaces, createSeatPlace, createTablePlace } from './places/openers';
import type { InteractIntent, InteractionPlaces } from './ports';
import { createInteractionSession } from './session';

const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
const worldOf = (solids: readonly SolidBox[]): CollisionWorld => ({ revision: 1, query: q => solids.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) });
const GROUND = box([-30, -1, -30], [30, 0, 30]);
const ANVIL = interactionTargetId.anvil('market');
/** The fire's seats and a table's chair, from the producers' own authored shapes; the anvil as main registers it. */
const registry = (world: CollisionWorld) => createInteractionRegistry({ layoutRevision: 'founded-1', world, placements: [
  campfirePlacement({ site: 'glade', origin: [0, 0, 0], turn: 0, seatTop: .45, source: 'campfire:glade@6',
    seats: [{ seat: 1, kind: 'player', hip: [0, 1.6], heading: Math.PI }], approach: () => [[-1.5, 2.6], [0, 1]] }),
  tavernPlacement({ tavern: 'inn', origin: [10, 0, 0], turn: 0, source: 'tavern:inn@snug', seats: [
    { key: 'long:a', tableId: 'long', position: [0, .45, 0], facing: Math.PI, approach: [0, 0, .8] },
  ] }),
  { source: 'forge:market-anvil', origin: [0, 0, 0], turn: 0, cell: 1, anchors: [
    { id: ANVIL, kind: 'anvil', zone: 'street', position: [-4, 1.25, 0], approach: [-4, 0, 1.7], reach: 3 },
  ] },
] });

describe('a place takes the camera only to frame itself, and gives it back whole', () => {
  it('frames a log from its own anchors, eases there, and never looks through a wall', () => {
    const open = worldOf([GROUND]);
    const log = registry(open).get('fire:glade:seat:1')!;
    const shot = seatShot(log, 16 / 10)!;
    // Behind the sitter (on the far side from the fire, +Z), above, looking past the log toward the ring.
    expect(shot.eye[2]).toBeGreaterThan(log.target.approach[2]);
    expect(shot.eye[1]).toBeGreaterThan(2.5);
    expect(shot.at[2]).toBeLessThan(log.rest![2]);
    expect(clearShot(open, shot)).toBe(shot);
    // A roof beam across the line: the eye is pulled in to stand clear of it, never through it.
    const beam = worldOf([GROUND, box([-3, 1.9, 3.4], [3, 2.3, 3.6])]);
    const pulled = clearShot(beam, shot)!;
    const length = (s: typeof shot) => Math.hypot(s.eye[0] - s.at[0], s.eye[1] - s.at[1], s.eye[2] - s.at[2]);
    expect(length(pulled)).toBeLessThan(length(shot));
    expect(length(pulled)).toBeGreaterThan(1.1);
    // Something right against the look point: no framing at all, the walking camera stays.
    const boxed = worldOf([GROUND, box([-2, 0, .5], [2, 3, .8])]);
    expect(clearShot(boxed, shot)).toBe(null);
    // The subject itself is no wall: a look point inside the solid being framed (an anvil's horn) keeps its shot.
    const subject = worldOf([GROUND, box([shot.at[0] - .2, shot.at[1] - .2, shot.at[2] - .2], [shot.at[0] + .2, shot.at[1] + .2, shot.at[2] + .2])]);
    expect(clearShot(subject, shot)).toBe(shot);
    expect(createSeatPlace({ camera: new THREE.PerspectiveCamera(), world: () => boxed, reducedMotion: () => false })(log, () => {})).toBe(null);

    // The ease starts from where walking left the camera and lands on the shot; reduced motion cuts.
    const camera = new THREE.PerspectiveCamera(50, 1.6);
    camera.position.set(5, 2, 5); camera.lookAt(0, 0, 0);
    const ease = createShotEase(camera, shot, { reducedMotion: false, now: 1000 });
    expect(ease.frame(1000)).toBe(0);
    expect(camera.position.toArray()).toEqual([5, 2, 5]);
    ease.frame(1000 + FRAMING_MS / 2);
    expect(camera.position.x).toBeLessThan(5);
    expect(ease.frame(1000 + FRAMING_MS)).toBe(1);
    expect(camera.position.toArray().map(n => +n.toFixed(6))).toEqual(shot.eye.map(n => +n.toFixed(6)));
    const ahead = new THREE.Vector3(); camera.getWorldDirection(ahead);
    const want = new THREE.Vector3(...shot.at).sub(new THREE.Vector3(...shot.eye)).normalize();
    expect(ahead.dot(want)).toBeGreaterThan(.9999);
    const cut = new THREE.PerspectiveCamera();
    createShotEase(cut, shot, { reducedMotion: true }).frame(0);
    expect(cut.position.toArray().map(n => +n.toFixed(6))).toEqual(shot.eye.map(n => +n.toFixed(6)));

    // The anvil sits left of centre on a wide screen (the card is on the right) and high on a tall one.
    const anvil = registry(open).get(ANVIL)!;
    for (const [aspect, side] of [[16 / 10, 'left'], [390 / 844, 'up']] as const) {
      const at = anvilShot(anvil, aspect), view = new THREE.PerspectiveCamera(aspect < 1 ? 62 : 46, aspect);
      // The framing must survive the collision check: a look point under the ground would leave the walking view.
      expect(clearShot(open, at)).toBe(at);
      createShotEase(view, at, { reducedMotion: true }).frame(0);
      view.updateProjectionMatrix();
      const p = new THREE.Vector3(...anvil.target.position).project(view);
      if (side === 'left') expect(p.x).toBeLessThan(-.15); else { expect(p.y).toBeGreaterThan(.25); expect(Math.abs(p.x)).toBeLessThan(.4); }
      expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1);
    }
    // Used from where you stood, not from the authored approach: a body right on the default line between the eye
    // and the anvil swings the framing aside, so your own back never hides the anvil, and the anvil stays framed.
    const plain = anvilShot(anvil, 16 / 10), [ex, , ez] = plain.eye, [tx, , tz] = anvil.target.position;
    const inTheWay: Vec3 = [ex + (tx - ex) * .5, 0, ez + (tz - ez) * .5];
    for (const aspect of [16 / 10, 390 / 844]) {
      const moved = anvilShot(anvil, aspect, inTheWay);
      const ux = tx - moved.eye[0], uz = tz - moved.eye[2], t = ((inTheWay[0] - moved.eye[0]) * ux + (inTheWay[2] - moved.eye[2]) * uz) / (ux * ux + uz * uz);
      const off = Math.hypot(inTheWay[0] - moved.eye[0] - ux * Math.min(1, Math.max(0, t)), inTheWay[2] - moved.eye[2] - uz * Math.min(1, Math.max(0, t)));
      expect(off).toBeGreaterThanOrEqual(BODY_CLEAR);
      expect(clearShot(open, moved)).toBe(moved);
      const view = new THREE.PerspectiveCamera(aspect < 1 ? 62 : 46, aspect);
      createShotEase(view, moved, { reducedMotion: true }).frame(0);
      view.updateProjectionMatrix();
      const p = new THREE.Vector3(...anvil.target.position).project(view);
      expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1);
      if (aspect > 1) expect(p.x).toBeLessThan(-.15); else expect(p.y).toBeGreaterThan(.25);
    }
  });

  it('opens each family only through its installed producer, and a table view closes with its seat', () => {
    const open = worldOf([GROUND]);
    const records = registry(open);
    const stage = { camera: new THREE.PerspectiveCamera(), world: () => open, reducedMotion: () => true };
    const tables: string[] = [];
    const places = composeInteractionPlaces({
      campfire: createSeatPlace(stage),
      tavern: createTablePlace(stage, { open: ({ table, seat }) => { tables.push(`open ${table}/${seat}`); return { close: () => { tables.push('close'); } }; } }),
    });
    const chair = records.get('tavern:long:seat:a')!;
    const view = places.open({ action: 'tavern', record: chair }, () => {})!;
    view.frame?.(0);
    expect(stage.camera.position.toArray().every(Number.isFinite)).toBe(true);
    view.close();
    expect(tables).toEqual(['open long/a', 'close']);
    expect(places.open({ action: 'sit', record: records.get('fire:glade:seat:1')! }, () => {})).not.toBe(null);
    // No Forge producer composed here: the anvil keeps the walking camera; doors never open a place view.
    expect(places.open({ action: 'forge', record: records.get(ANVIL)! }, () => {})).toBe(null);
    // A table host that has no view of its own: you still sit at the chair, in the seated framing.
    const bare = createTablePlace(stage)(chair, () => {});
    expect(bare).not.toBe(null);
  });

  it('tells the anvil’s truth from the actual Forge feed and never keeps work it cannot confirm', () => {
    let now = 50_000;
    let handlers: ForgeObservationHandlers = {};
    const feed = { subscribe(next: ForgeObservationHandlers) { handlers = next; return () => { handlers = {}; }; } };
    const part = (id: string, maker: string, at: number, source: 'live' | 'simulated' = 'live') =>
      ({ id, committedAt: at, provenance: { source, makerName: maker, kingdomName: 'Willowmere', designId: id, firstForgedAt: at } }) as unknown as CommittedForgeAttachment;
    const watch = watchAnvil(feed, () => now);
    const seen: string[] = [];
    watch.subscribe(state => { seen.push(anvilLine(state)); });
    expect(watch.state()).toMatchObject({ heard: 'waiting', working: null, standing: 0 });
    handlers.restored?.([part('a', 'Wren', 10), part('b', 'Juniper', 30)]);
    expect(watch.state()).toMatchObject({ heard: 'listening', standing: 2, latest: { maker: 'Juniper', simulated: false } });
    handlers.stage?.('wish-1', 'drafting');
    expect(anvilLine(watch.state())).toBe('A wish is in the fire: the smith is drawing it.');
    handlers.committed?.(part('c', 'Bram', 49_000, 'simulated'), 'wish-1');
    expect(watch.state()).toMatchObject({ working: null, standing: 3, landed: { maker: 'Bram', simulated: true }, latest: { maker: 'Bram', simulated: true } });
    now += LANDED_MS;
    handlers.stage?.('wish-2', 'judging-words');
    expect(watch.state().landed).toBe(null);
    // The feed lost the room: work in progress is dropped, nothing is invented, standing parts stay counted.
    handlers.unavailable?.();
    expect(watch.state()).toMatchObject({ heard: 'unavailable', working: null, landed: null, standing: 3 });
    expect(seen.at(-1)).toBe('The anvil cannot hear the kingdom just now, so it cannot show the fire’s work.');
    watch.dispose();
    expect(handlers).toEqual({});
    expect(anvilHomeLine('unknown')).toBe(null);
    expect(anvilHomeLine('none')).toMatch(/do not have one/);
  });

  it('ticks the held view first, and Escape, a step or gamepad East close the anvil and give the camera back', () => {
    const open = worldOf([GROUND]);
    const records = registry(open).records;
    let now = 0;
    const sent: InteractIntent[] = [];
    const session = createInteractionSession({ realm: { send: intent => { sent.push(intent); } }, clock: () => now });
    session.connect('e1');
    let owner: 'walking' | 'released' | 'disposed' = 'walking';
    const camera = { get owner() { return owner; }, release() { owner = 'released'; }, resume() { owner = 'walking'; } };
    const ticks: number[] = [];
    let closes = 0;
    const places: InteractionPlaces = { open: ({ action }) => action === 'forge' ? { frame: t => { ticks.push(t); }, close() { closes++; } } : null };
    const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
    const surface = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect });
    const pad = { connected: true, buttons: [0, 1, 2, 3].map(() => ({ pressed: false })) };
    const controller = createInteractionController({ prompt: () => ({ update() {}, dispose() {} }), surface, session, camera, places, keyboard, page, gamepads: () => [pad] });
    const frame = () => controller.frame({ now, look: { feet: [-4, 0, 1.7], forward: [0, -.4, -1] }, records, world: open,
      actor: { walkerId: 'w', zone: 'street', ownedPlotId: null }, project: () => ({ x: 10, y: 10 }) });
    const key = (code: string) => keyboard.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code, key: code, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false }));
    const forge = () => {
      frame();
      expect(controller.debug.focus).toBe(ANVIL);
      expect(controller.use()).toBe(true);
      const id = sent.at(-1)!.id;
      session.receive({ type: 'receipt', receipt: { version: 1, id, status: 'applied', writerEpoch: 'e1', state: { revision: sent.length, mode: 'standing', targetId: null, plotId: null } } });
      expect(owner).toBe('released');
    };

    forge();
    now = 16; frame(); now = 32; frame();
    expect(ticks).toEqual([16, 32]);
    // A first step at the anvil walks away from it: the visit closes and walking has the camera in the same call.
    key('KeyW');
    expect([owner, closes, controller.debug.held]).toEqual(['walking', 1, null]);
    now = 48; frame();
    expect(ticks).toEqual([16, 32]);

    forge();
    pad.buttons[1]!.pressed = true; frame(); pad.buttons[1]!.pressed = false;
    expect([owner, closes]).toEqual(['walking', 2]);

    forge();
    key('Escape');
    expect([owner, closes]).toEqual(['walking', 3]);
    controller.dispose();
  });
});
