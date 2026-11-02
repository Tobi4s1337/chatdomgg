import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { type RealmWalkerFrame, type RealmWatchCheckpoint } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createVoxelMaterial } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createKingdomCitizens } from './citizen-scene';
import { createObservedWalkers, createObservedWalkerTrack, walkerSlots } from './observed-walkers';
import type { InteractionRegistry } from '@chatdom/world/interactions';
import { createRealmWatch, type WatchEventSource } from '../realm/adapters/watch';

const renderer = vi.hoisted(() => ({ update: vi.fn(), dispose: vi.fn(), heads: new Map(), grips: new Map() }));
const created = vi.hoisted(() => ({ count: 0 }));
vi.mock('../citizens', () => ({ createDefaultCitizenLooks: () => ['hearth', 'tide', 'grove', 'clay', 'sun', 'dusk'].map(id => ({ id, parts: [] })),
  createCitizenRenderer: async () => { created.count++; return renderer; } }));
afterEach(() => vi.useRealTimers());

it('one witnessed slot is the only body; chat-only people stay light while windows survive; stale and revised watch poses disappear', async () => {
  vi.useFakeTimers();
  const kingdomId = KingdomIdSchema.parse('129634568'), epoch = 'presence-1', at = Date.now();
  const manifest = { version: 1 as const, kingdomId, origin: 'live' as const, layoutRevision: 'streets-1', collisionRevision: 1, sceneHash: 'a'.repeat(64) };
  class Source extends EventTarget implements WatchEventSource {
    close() {}
    emit(type: string, data: unknown) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
  }
  const source = new Source(), lost = vi.fn();
  const watch = createRealmWatch({ kingdomId, signal: new AbortController().signal, source: () => source, revision() {}, unavailable: lost });
  const checkpoint: RealmWatchCheckpoint = { version: 1, manifest, checkpoint: { version: 1, kingdomId, writerEpoch: 'writer-1', throughSequence: 0, throughCursor: 0,
    layoutRevision: 'streets-1', collisionRevision: 1, current: [] } };
  source.emit('checkpoint', checkpoint); await watch.checkpoint;
  const plan = generateSettlementPlan({ seed: 'one-body', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const slot = plan.homes[0]!.slot;
  const sample = (sampledAt: number, x: number, placement = 0): RealmWalkerFrame => ({ version: 1, kingdomId, origin: 'live', layoutRevision: 'streets-1', collisionRevision: 1, writerEpoch: 'writer-1', sampledAt,
    walkers: [{ id: 'public-walker', name: 'Juniper', homeSlot: slot, look: 'dusk', x, y: 0, z: 0, yaw: 0, distance: x, speed: 1, placement }] });
  // While geometry loads, only the newest actual frame is retained. No walk client or input channel exists.
  source.emit('walkers', sample(at, 1)); source.emit('walkers', sample(at + 200, 2));
  const track = createObservedWalkerTrack(manifest), received = vi.fn((frame: RealmWalkerFrame) => track.receive(frame, performance.now()));
  const unavailable = vi.fn(() => track.clear());
  const off = watch.walkerFeed.subscribe(received, unavailable);
  expect(received).toHaveBeenCalledOnce();
  // Strict schemas reject added private/unknown fields without exposing them to the renderer.
  source.emit('walkers', { ...sample(at + 300, 3), secret: 'not-public' });
  expect(track.sample(performance.now())).toEqual([]);
  source.emit('walkers', sample(at + 400, 0));
  const self = { ...track.sample(performance.now())[0]!, self: true };
  const feet = walkerSlots([self]);
  const scene = new THREE.Scene(), clay = createVoxelMaterial(MATERIALS, 'build');
  const crowd = createKingdomCitizens(scene, plan, {} as VoxelWorkerPool, clay);
  await crowd.prepare();
  const frame: KingdomPresenceFrame = { version: 1, kingdomId, origin: 'live', epoch, sequence: 1, asOf: at - 45_000,
    connection: 'fresh', streamLive: true, windows: [{ slot, present: true, publicName: 'Juniper', look: 'dusk', since: at - 45_000 }] };
  crowd.applyFrame(frame);
  const camera = new THREE.PerspectiveCamera(60, 1440 / 900, .1, 1000);
  camera.position.set(0, 3, 10); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  // Chatting without walking: no body is ever meshed or drawn for them. They are their window.
  crowd.update(at, 45, camera);
  expect(created.count).toBe(0);
  expect(renderer.update).not.toHaveBeenCalled();
  expect(crowd.subject(slot)).toMatchObject({ opacity: 0, homeLit: true });
  const light = crowd.lightFrame(at);
  expect(light?.windows[0]).toMatchObject({ slot, present: true, since: at - 45_000 });
  crowd.applyFrame({ ...frame, sequence: 2, asOf: at, windows: frame.windows.map(({ slot, present, publicName, since }) => ({ slot, present, publicName, since })) });
  expect(crowd.receiveChat({ version: 1, id: 'heard-once', kingdomId, origin: 'live', epoch, slot,
    asOf: at, expiresAt: at + 9000, parts: [{ kind: 'text', text: 'Here I am.' }] })).toBe(true);
  // Walking: the witnessed walker is the body, and the camera's subject is at their feet. The window stays lit.
  crowd.update(at, 45, camera, undefined, feet);
  expect(renderer.update).not.toHaveBeenCalled();
  expect(scene.children.filter(child => child instanceof THREE.InstancedMesh).every(mesh => (mesh as THREE.InstancedMesh).count === 0)).toBe(true);
  expect(crowd.subject(slot)).toMatchObject({ position: [0, 0, 0], opacity: 1 });
  expect(crowd.lightFrame(at)?.windows[0]).toMatchObject({ slot, present: true, since: at - 45_000 });
  // The host's 80 ms speech path is quiet; the per-frame bus carries the line on the walker's own label.
  expect(crowd.speechLabels(camera, 1440, 900, at)).toEqual([]);
  const interpolation = createObservedWalkerTrack(manifest);
  interpolation.receive(sample(at, 0), 0); interpolation.receive(sample(at + 200, 2), 200);
  expect(interpolation.sample(300)[0]?.x).toBe(.5); // 250 ms delay; no extrapolation.
  expect(interpolation.sample(550)[0]?.x).toBe(2);
  interpolation.receive(sample(at + 600, 100, 1), 600);
  expect(interpolation.sample(600)[0]?.x).toBe(100); // A placement never slides across intervening solids.
  vi.advanceTimersByTime(2000);
  expect(track.sample(performance.now())).toEqual([]);
  source.emit('walkers', sample(at + 400, 0)); // An expired frame cannot be made fresh by redelivery.
  expect(track.sample(performance.now())).toEqual([]);
  crowd.update(at, 45, camera, undefined, walkerSlots(track.sample(performance.now())));
  expect(crowd.subject(slot)).toMatchObject({ opacity: 0 });
  source.emit('walkers', sample(at + 2400, 4));
  expect(track.sample(performance.now())).toHaveLength(1);
  source.emit('revision', { layoutRevision: 'streets-2', collisionRevision: 2 });
  expect(track.sample(performance.now())).toEqual([]);
  source.emit('walkers', sample(at + 2600, 5));
  expect(track.sample(performance.now())).toEqual([]);
  expect(lost).not.toHaveBeenCalled();
  source.emit('checkpoint', checkpoint); source.emit('walkers', sample(at + 2800, 6));
  expect(track.sample(performance.now())).toHaveLength(1);
  watch.dispose(); expect(track.sample(performance.now())).toEqual([]);
  off(); crowd.dispose(); clay.dispose();
}, 30_000);

it('draws the nearest 64 walkers in full and the rest as simple figures, never dropping anyone', async () => {
  const kingdomId = KingdomIdSchema.parse('129634568');
  const manifest = { kingdomId, origin: 'live' as const, layoutRevision: 'streets-1', collisionRevision: 1 };
  let receive: ((frame: RealmWalkerFrame) => void) | undefined;
  const feed = { subscribe(next: (frame: RealmWalkerFrame) => void) { receive = next; return () => { receive = undefined; }; } };
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 1000); camera.position.set(0, 2, 0); camera.lookAt(0, 1, 10); camera.updateMatrixWorld();
  const canvas = { clientWidth: 1440, clientHeight: 900 } as HTMLCanvasElement;
  renderer.update.mockClear();
  const observed = await createObservedWalkers(scene, camera, canvas, {} as VoxelWorkerPool, material, manifest, feed, { get: () => undefined } as unknown as InteractionRegistry);
  const walkers = Array.from({ length: 90 }, (_, i) => ({ id: `w${String(i).padStart(2, '0')}`, name: `Walker ${i}`, homeSlot: i, look: 'tide',
    x: 0, y: 0, z: 2 + i * .5, yaw: 0, distance: i, speed: 1, placement: 0 }));
  receive!({ version: 1, kingdomId, origin: 'live', layoutRevision: 'streets-1', collisionRevision: 1, writerEpoch: 'writer-1', sampledAt: 1, walkers });
  const now = performance.now();
  observed.frame(now); observed.draw(now);
  const full = renderer.update.mock.lastCall![0] as { id: string }[];
  expect(full.map(sample => sample.id)).toEqual(walkers.slice(0, 64).map(walker => walker.id));
  const figures = scene.getObjectByName('walker-figures') as THREE.InstancedMesh;
  expect(figures.count).toBe(0); // simple figures ease in from nothing
  observed.frame(now + 100); observed.draw(now + 100);
  expect(figures.count).toBe(26);
  // Far walkers still have a head for their name and bubble.
  expect(observed.labels().map(label => label.id)).toContain('w66');
  observed.dispose(); material.dispose();
  expect(scene.getObjectByName('walker-figures')).toBeUndefined();
}, 30_000);
