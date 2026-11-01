import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createKingdomCitizens, homeSpeechAnchor, segmentHitsBox } from './citizen-scene';
import { walkerSlots } from './observed-walkers';
import type { WalkerPresentation } from './walker-presentation';
import { subscribeSpeech, type SpeechFrame } from '../walk/labels/bus';
import { joinSpeech, peopleFromLabels } from '../walk/labels/model';
import { createLabelStage, BUBBLE_TAIL_PX } from '../walk/labels/stage';
import { labelLimits } from '../walk/labels/density';

const kingdomId = KingdomIdSchema.parse('129634568');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function town(seed: string, present: number, since: (index: number) => number, asOf: number) {
  const scene = new THREE.Scene(), clay = createVoxelMaterial(MATERIALS, 'build');
  const layout = generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const citizens = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay);
  cleanups.push(() => { citizens.dispose(); clay.dispose(); });
  const windows = layout.homes.slice(0, present).map((home, index) => ({ slot: home.slot, present: true, publicName: `Neighbour ${home.slot}`, since: since(index) }));
  const frame: KingdomPresenceFrame = { version: 1, kingdomId, epoch: 'presence-1', sequence: 1, asOf, origin: 'live', streamLive: true, connection: 'fresh', windows };
  citizens.applyFrame(frame);
  return { scene, layout, citizens, frame, windows };
}
/** The probe learns its canvas from the renderer on the first draw; a test stands in for that draw. */
function drawInto(scene: THREE.Scene, width = 1440, height = 900) {
  const canvas = { clientWidth: width, clientHeight: height } as HTMLCanvasElement;
  const probe = scene.getObjectByName('speech-canvas-probe')!;
  (probe.onBeforeRender as (renderer: unknown) => void)({ domElement: canvas });
  const frames: SpeechFrame[] = [];
  cleanups.push(subscribeSpeech((source, frame) => { if (source === canvas) frames.push(frame); }));
  return { canvas, frames };
}
const walkerAt = (slot: number, x: number, y: number, z: number, speed = 1): WalkerPresentation =>
  ({ id: `walker-${slot}`, name: `Walker ${slot}`, look: 'dusk', homeSlot: slot, x, y, z, yaw: 0, distance: x, speed, self: false });
const lanternCount = (scene: THREE.Scene) => Math.max(...scene.children.filter(child => child instanceof THREE.InstancedMesh).map(mesh => (mesh as THREE.InstancedMesh).count));

it('gives bodies only to walkers: chat-only people are their lit window, standing unseen at their own door', () => {
  const now = 1_000_000;
  const { scene, citizens, layout, windows } = town('only-walkers', 8, index => index === 7 ? now : now - 600_000, now);
  const walkerSlot = windows[0]!.slot;
  const feet = walkerSlots([walkerAt(walkerSlot, 2, 0, 3)]);
  const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 500); camera.position.set(0, 20, 30); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const samples = citizens.update(now, 0, camera, new Set(), feet);
  expect(samples.map(sample => sample.slot).sort((a, b) => a - b)).toEqual(windows.map(window => window.slot).sort((a, b) => a - b));
  // Nothing is meshed or drawn for chat-only people: no renderer, no shadow, no lantern.
  expect(scene.children.filter(child => child instanceof THREE.InstancedMesh).every(mesh => (mesh as THREE.InstancedMesh).count === 0)).toBe(true);
  citizens.drawLanterns(0, 1, camera, new Map());
  expect(lanternCount(scene)).toBe(0);
  // Each chat-only person is an unseen subject at their own door, already home: an arrival shot frames the window.
  for (const window of windows.slice(1)) {
    const subject = citizens.subject(window.slot)!;
    const door = citizens.motion.routeForSlot(window.slot)!.points.at(-1)!;
    expect(subject).toMatchObject({ position: door, opacity: 0, speed: 0, state: 'home', homeLit: true, homeLitAtMs: window.since });
  }
  // The walker is where their body is, and seen.
  expect(citizens.subject(walkerSlot)).toMatchObject({ position: [2, 0, 3], opacity: 1, state: 'walking', homeLit: true });
  // The walker carries a lantern from their own drawn hand; nobody else does.
  citizens.drawLanterns(0, 1, camera, new Map([[`walker-${walkerSlot}`, new THREE.Matrix4().makeTranslation(2.3, 1, 3)]]));
  expect(lanternCount(scene)).toBe(1);
  // Windows light from presence, the moment someone arrives: no unseen walk home delays it.
  const light = citizens.lightFrame(now)!;
  expect(light.windows.filter(window => window.present).map(window => window.slot)).toHaveLength(8);
  expect(light.windows.find(window => window.slot === windows[7]!.slot)).toMatchObject({ present: true, since: now });
  // Gathering calls move nobody: there are no chat-only bodies to gather.
  citizens.watchForge(true, now, [0, layout.market.elevation, 8]);
  citizens.gatherFire(true, now, [0, layout.market.elevation, 0]);
  citizens.update(now + 120_000, 120, camera, new Set(), feet);
  for (const window of windows.slice(1)) expect(citizens.subject(window.slot)!.position).toEqual(citizens.motion.routeForSlot(window.slot)!.points.at(-1));
  expect(citizens.checkpoint()!.watchers.size).toBe(0);
  // Someone who arrives later lights at their own moment.
  // The presentation clock can trail the projection; someone arrives at their own moment, not before.
  const late = { slot: layout.homes[8]!.slot, present: true, publicName: 'Late', since: now + 130_000 };
  citizens.applyFrame({ version: 1, kingdomId, epoch: 'presence-1', sequence: 2, asOf: now + 130_000, origin: 'live', streamLive: true, connection: 'fresh', windows: [...windows, late] });
  citizens.update(now + 129_000, 129, camera, new Set(), feet);
  expect(citizens.subject(late.slot)).toBeUndefined();
  citizens.update(now + 130_000, 130, camera, new Set(), feet);
  expect(citizens.subject(late.slot)).toMatchObject({ homeLitAtMs: now + 130_000, opacity: 0 });
}, 30_000);

it('places a walker’s bubble on the projected head and a chat-only bubble above the door, every frame of a camera move', () => {
  const now = 2_000_000;
  const { scene, citizens, windows } = town('per-frame-bubbles', 3, () => now - 60_000, now);
  const { frames } = drawInto(scene);
  const walkerSlot = windows[0]!.slot, homeSlot = windows[1]!.slot;
  const anchor = homeSpeechAnchor(citizens.motion.routeForSlot(homeSlot)!)!;
  const parts = [{ kind: 'text' as const, text: 'Lovely night for it.' }];
  for (const slot of [walkerSlot, homeSlot]) expect(citizens.receiveChat({ version: 1, id: `line-${slot}`, kingdomId, origin: 'live', epoch: 'presence-1', slot,
    asOf: now, expiresAt: now + 9_000, parts })).toBe(true);
  // The walker strolls along the street in front of the home while the camera orbits and dollies in, re-aimed
  // every frame. Their drawn head is wherever the renderer put it this frame.
  const route = citizens.motion.routeForSlot(homeSlot)!;
  const out = new THREE.Vector3(-Math.sin(route.homeHeading), 0, -Math.cos(route.homeHeading)), right = new THREE.Vector3(out.z, 0, -out.x);
  const camera = new THREE.PerspectiveCamera(55, 1440 / 900, .1, 500);
  const stage = createLabelStage(), projected = new THREE.Vector3();
  const sizes = { width: 160, height: 54 };
  let lastWalkerX: number | undefined, moved = 0;
  for (let frame = 0; frame < 48; frame++) {
    const t = frame / 47, angle = -.5 + t;
    const feet = new THREE.Vector3(...anchor).addScaledVector(right, 3.5 + Math.sin(frame / 9)).addScaledVector(out, 1.5 + frame * .02);
    const walker = walkerAt(walkerSlot, feet.x, anchor[1] - 2.7, feet.z);
    const head = new THREE.Vector3(walker.x, walker.y + 1.95, walker.z);
    const target = new THREE.Vector3(...anchor).add(head).multiplyScalar(.5);
    const radius = 12 - 3 * t;
    camera.position.copy(target).addScaledVector(out, radius * Math.cos(angle)).addScaledVector(right, radius * Math.sin(angle)).add(new THREE.Vector3(0, 2.5 + t, 0));
    camera.lookAt(target); camera.updateMatrixWorld();
    const atMs = now + frame * 16;
    citizens.update(atMs, atMs / 1000, camera, new Set(), walkerSlots([walker]));
    citizens.drawLanterns(atMs / 1000, 1, camera, new Map());
    // The host's name label for the walker, projected from the same head with the same camera this frame.
    projected.copy(head).project(camera);
    const label = { id: walker.id, slot: walkerSlot, name: walker.name, self: false, distance: head.distanceTo(camera.position),
      x: (projected.x + 1) * 720, y: (1 - projected.y) * 450 };
    const speech = frames.at(-1)!;
    const people = joinSpeech(peopleFromLabels([label], []), speech);
    const staged = new Map(stage.frame({ people, viewport: { width: 1440, height: 900 }, limits: labelLimits(), reducedMotion: true, now: atMs, size: () => sizes })
      .map(item => [item.id, item]));
    const bubble = staged.get(`walker:${walker.id}`)!;
    expect(bubble.person.speech).toEqual(parts);
    // Tail tip on the head, this frame: the same camera, no older projection.
    expect(bubble.left + sizes.width / 2).toBeCloseTo(label.x, 6);
    expect(bubble.top + sizes.height + BUBBLE_TAIL_PX).toBeCloseTo(label.y, 6);
    const home = staged.get(`home:${homeSlot}`)!;
    projected.set(...anchor).project(camera);
    expect(home.left + sizes.width / 2).toBeCloseTo((projected.x + 1) * 720, 6);
    expect(home.top + sizes.height + BUBBLE_TAIL_PX).toBeCloseTo((1 - projected.y) * 450, 6);
    expect(home.person.home).toBe(true);
    if (frame > 12) { expect(bubble.shown).toBe(true); expect(home.shown).toBe(true); }
    if (lastWalkerX !== undefined && Math.abs(lastWalkerX - label.x) > .5) moved++;
    lastWalkerX = label.x;
  }
  expect(moved).toBeGreaterThan(40);
}, 30_000);

it('keeps a line up long enough to read, never shorter than the server allows, and drops it at once when removed', () => {
  const now = 3_000_000;
  const { scene, citizens, windows } = town('reading-time', 2, () => now - 60_000, now);
  const { frames } = drawInto(scene);
  // From above the two homes, both doors are in front of the eye.
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 500);
  const [a, b] = windows.map(window => homeSpeechAnchor(citizens.motion.routeForSlot(window.slot)!)!);
  const middle = new THREE.Vector3(...a!).add(new THREE.Vector3(...b!)).multiplyScalar(.5);
  camera.position.copy(middle).add(new THREE.Vector3(0, 18, 4)); camera.lookAt(middle); camera.updateMatrixWorld();
  expect(Math.max(camera.position.distanceTo(new THREE.Vector3(...a!)), camera.position.distanceTo(new THREE.Vector3(...b!)))).toBeLessThan(40);
  const live = (atMs: number) => { citizens.update(atMs, 0, camera); citizens.drawLanterns(0, 1, camera); return frames.at(-1)!.speech.map(line => line.slot); };
  const long = 'a'.repeat(150), short = 'Hi!';
  citizens.receiveChat({ version: 1, id: 'long', kingdomId, origin: 'live', epoch: 'presence-1', slot: windows[0]!.slot, asOf: now, expiresAt: now + 3_000, parts: [{ kind: 'text', text: long }] });
  citizens.receiveChat({ version: 1, id: 'short', kingdomId, origin: 'live', epoch: 'presence-1', slot: windows[1]!.slot, asOf: now, expiresAt: now + 9_000, parts: [{ kind: 'text', text: short }] });
  expect(live(now)).toHaveLength(2);
  expect(live(now + 5_000)).toEqual([windows[0]!.slot, windows[1]!.slot]);
  // The short line goes with its server expiry; the long one stays its reading time (2.5 s + 60 ms a character).
  expect(live(now + 9_000)).toEqual([windows[0]!.slot]);
  expect(live(now + 11_499)).toEqual([windows[0]!.slot]);
  expect(live(now + 11_500)).toEqual([]);
  // A moderator's removal is immediate.
  citizens.receiveChat({ version: 1, id: 'removed', kingdomId, origin: 'live', epoch: 'presence-1', slot: windows[1]!.slot, asOf: now + 12_000, expiresAt: now + 20_000, parts: [{ kind: 'text', text: short }] });
  expect(live(now + 12_000)).toHaveLength(1);
  citizens.clearChat(['removed']);
  expect(live(now + 12_016)).toEqual([]);
}, 30_000);

it('does not repeat a name its home plate already shows, and hides a home bubble behind a wall', () => {
  const now = 4_000_000;
  const { scene, citizens, windows, layout } = town('home-name', 1, () => now - 60_000, now);
  const { frames } = drawInto(scene);
  const slot = windows[0]!.slot;
  citizens.receiveChat({ version: 1, id: 'line', kingdomId, origin: 'live', epoch: 'presence-1', slot, asOf: now, expiresAt: now + 9_000, parts: [{ kind: 'text', text: 'Home, at last!' }] });
  const route = citizens.motion.routeForSlot(slot)!, anchor = homeSpeechAnchor(route)!;
  const outX = -Math.sin(route.homeHeading), outZ = -Math.cos(route.homeHeading);
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 500);
  const look = (x: number, y: number, z: number) => { camera.position.set(x, y, z); camera.lookAt(...anchor); camera.updateMatrixWorld(); citizens.update(now, 0, camera); citizens.drawLanterns(0, 1, camera); return frames.at(-1)!.speech[0]!; };
  // From the street in front of the door.
  expect(look(anchor[0] + outX * 8, anchor[1], anchor[2] + outZ * 8)).toMatchObject({ from: 'home', name: 'Neighbour ' + slot, visibility: 1 });
  citizens.speechLabels(camera, 1440, 900, now, new Set([slot]));
  expect(look(anchor[0] + outX * 8, anchor[1], anchor[2] + outZ * 8).name).toBeNull();
  // From behind the house, its own walls stand in the way.
  expect(look(anchor[0] - outX * 14, anchor[1] - 1, anchor[2] - outZ * 14).visibility).toBe(0);
  // The host's 80 ms path is quiet: speech goes out every frame on the bus instead.
  expect(citizens.speechLabels(camera, 1440, 900, now)).toEqual([]);
  expect(layout.homes.length).toBeGreaterThan(0);
}, 30_000);

it('tests a sight line against a box', () => {
  expect(segmentHitsBox([-5, 1, 0], [5, 1, 0], [-1, 0, -1], [1, 2, 1])).toBe(true);
  expect(segmentHitsBox([-5, 3, 0], [5, 3, 0], [-1, 0, -1], [1, 2, 1])).toBe(false);
  expect(segmentHitsBox([-5, 1, 0], [-2, 1, 0], [-1, 0, -1], [1, 2, 1])).toBe(false);
  expect(segmentHitsBox([0, 5, 0], [0, -5, 0], [-1, 0, -1], [1, 2, 1])).toBe(true);
}, 30_000);

it('carries looks across a scene rebuild only under the current presence authority', () => {
  const now = 5_000_000;
  const { scene, citizens, frame, layout } = town('checkpoint', 1, () => now - 60_000, now);
  const clay = createVoxelMaterial(MATERIALS, 'build');
  cleanups.push(() => clay.dispose());
  citizens.applyFrame({ ...frame, sequence: 2, windows: frame.windows.map(window => ({ ...window, look: 'tide' })) });
  const checkpoint = citizens.checkpoint()!;
  expect(checkpoint.watchers.size).toBe(0);
  const restored = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, checkpoint);
  cleanups.push(() => restored.dispose());
  restored.applyFrame({ ...frame, sequence: 3, asOf: frame.asOf + 1_000 });
  expect(restored.checkpoint()!.looks.get(frame.windows[0]!.slot)).toBe('tide');
  expect(restored.motion).toBe(checkpoint.motion);
  const stranger = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, citizens.checkpoint()!);
  cleanups.push(() => stranger.dispose());
  stranger.applyFrame({ ...frame, epoch: 'presence-2', sequence: 1, asOf: frame.asOf + 2_000 });
  expect(stranger.checkpoint()!.looks.size).toBe(0);
}, 30_000);
