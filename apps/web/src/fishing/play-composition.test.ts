import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { FishingPierSite, KingdomId } from '@chatdom/shared';
import { registerPierInPlay, type PierHeldToolHandle, type PierPlaySlots, type PierViews, type PierWalkContext } from './play-composition';
import { createStagedPier } from './staged';
import type { PierLayerHost } from './layer';

const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
const lip = () => ({ position: [0, 1, 23.4] as [number, number, number], yaw: 0, grounded: true, collisionRevision: 7 });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); vi.setSystemTime(Date.UTC(2026, 10, 2, 18, 30)); });
afterEach(() => { vi.useRealTimers(); });
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function advance(ms: number) { for (let left = ms; left > 0; left -= 50) { vi.advanceTimersByTime(Math.min(50, left)); await settle(); } }

/** Play's slots, as a page would hold them: one equipped tool, its handle driven by the frame. */
function fakePlay() {
  const features: Parameters<PierPlaySlots['registerWalkFeature']>[0][] = [], tools = new Map<string, Parameters<PierPlaySlots['registerHeldTool']>[0]>();
  const pieces: Parameters<PierPlaySlots['registerHudPiece']>[0][] = [], pages: Parameters<PierPlaySlots['registerLedgerPage']>[0][] = [];
  const bindings: Parameters<PierPlaySlots['registerActionBinding']>[0][] = [], prompts: Parameters<PierPlaySlots['registerWorldPrompt']>[0][] = [];
  const poses: [string, string | null][] = [], held: (string | null)[] = [];
  let equipped: string | null = null, handle: PierHeldToolHandle | null = null;
  const base = { kingdomId: '200' as KingdomId, self: { personId: '100', publicName: 'Juniper' }, mode: 'walking' as const,
    requestCursor: () => ({ release() {}, active: true }), closeLedger() {} };
  const slots: PierPlaySlots = {
    registerWalkFeature(p) { features.push(p); return () => {}; },
    registerHeldTool(p) { tools.set(p.id, p); return () => { tools.delete(p.id); }; },
    equipTool(id) {
      if (id === equipped) return;
      handle?.dispose(); handle = null; equipped = id;
      if (id) handle = tools.get(id)!.equip({ ...base, holdPose: pose => held.push(pose) });
    },
    equippedTool: () => equipped,
    registerHudPiece(p) { pieces.push(p); return () => {}; },
    registerLedgerPage(p) { pages.push(p); return () => {}; },
    registerActionBinding(b) { bindings.push(b); return () => {}; },
    registerWorldPrompt(p) { prompts.push(p); return () => {}; },
    observedWalkerHand: () => null,
    observedWalkerPose(id, pose) { poses.push([id, pose]); },
  };
  return { slots, base, features, pieces, pages, bindings, prompts, poses, held, handle: () => handle };
}

function setup() {
  const staged = createStagedPier({ kingdomId: '200', site, rack: [0, 1, 1], revision: 7, sample: () => ({ waterY: 0, groundY: -2 }),
    where: 'Willowmere pier', seeds: [7], clock: () => Date.now(),
    people: [{ personId: '100', walkerId: 'juniper-seat', name: 'Juniper', pose: lip },
      { personId: '101', walkerId: 'saoirse-seat', name: 'saoirse_k', pose: () => ({ ...lip(), position: [2, 1, 23.4] as [number, number, number] }) }] });
  const play = fakePlay();
  const layers: PierLayerHost[] = [], uis: string[] = [];
  const views: PierViews = {
    ui: () => ({ prompt() {}, fight() {}, note() {}, caught(tag) { uis.push(tag.name); }, worldTags() {}, dispose() {} }),
    layer: async host => { layers.push(host); return { update() {}, stats: () => ({ draws: 0, triangles: 0, fishers: 0, phase: null }), dispose() {} }; },
    sound: () => ({ cue() {}, reel() {}, tension() {}, ambience() {}, dispose() {} }) as never,
    bag: () => () => {}, hotbar: () => ({ refresh() {}, dispose() {} }), portrait: async () => null,
  };
  const stop = registerPierInPlay(play.slots, views);
  const frames = new Set<(dt: number, now: number) => void>();
  const ctx: PierWalkContext = { ...play.base, room: staged.room('100'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    selfWalkerId: () => 'juniper-seat', walkers: () => [], hand: () => null, hour: () => 18.5, kingdomName: 'Willowmere',
    overlay: {} as HTMLElement, audio: () => null, onFrame(listener) { frames.add(listener); return () => { frames.delete(listener); }; } };
  const unmount = play.features[0]!.mount(ctx);
  const frame = () => { for (const listener of frames) listener(1 / 60, performance.now()); play.handle()?.update(1 / 60); };
  return { staged, play, layers, uis, stop, unmount, frame };
}

it('registers the pier with play: the walk, the rod, the belt, the bag, its keys and the rack', () => {
  const { play, stop, unmount, staged } = setup();
  expect(play.pieces.map(p => [p.id, p.region])).toEqual([['hotbar', 'bottom-centre']]);
  expect(play.pages.map(p => [p.id, p.title])).toEqual([['bag', 'Bag']]);
  expect(play.bindings.map(b => [b.id, b.defaultCode])).toEqual([['bag', 'KeyB'], ['hotbar.1', 'Digit1']]);
  expect(play.prompts.map(p => p.id)).toEqual(['pier.rack']);
  // Watching, or nobody signed in: nothing of the pier's is offered.
  expect(play.pieces[0]!.available({ ...play.base, mode: 'watching' })).toBe(false);
  expect(play.pieces[0]!.available(play.base)).toBe(true);
  unmount(); stop(); staged.dispose();
});

it('takes a rod at the rack, puts it in the hand, casts and keeps a fish through the held tool', async () => {
  const { play, layers, uis, stop, unmount, staged, frame } = setup();
  await settle();
  // The layer mounts from the realm's own pier, once its state is in.
  expect(layers).toHaveLength(1);
  expect(layers[0]!.site.id).toBe('pier:lake');
  const prompt = play.prompts[0]!;
  expect(prompt.prompt({ position: [0, 1, 18], yaw: 0 })).toBeNull();
  expect(prompt.prompt({ position: [0.5, 1, 1.5], yaw: 0 })).toEqual({ label: 'Take a willow rod', at: [0, 1, 1] });
  prompt.use(play.base); await settle();
  // Taken: in the first slot and straight into the hand.
  expect(play.slots.equippedTool()).toBe('rod');
  expect(prompt.prompt({ position: [0.5, 1, 1.5], yaw: 0 })).toBeNull();
  const tool = play.handle()!;
  tool.press(0); frame(); await advance(700); tool.release(0); await settle(); frame();
  expect(play.held).toContain('cast');
  for (let i = 0; i < 400 && !staged.views().some(view => view.phase === 'bite'); i++) { await advance(50); frame(); }
  tool.press(0); await advance(100); frame();
  for (let i = 0; i < 900 && staged.views().some(view => view.phase === 'fighting'); i++) {
    const fight = staged.views()[0]?.fight;
    if (fight && (fight.phase === 'run' || fight.tension > 6500)) tool.release(0); else tool.press(0);
    await advance(50); frame();
  }
  for (let i = 0; i < 40 && !uis.length; i++) await advance(50);
  expect(play.held).toContain('reel');
  expect(staged.records().filter(record => record.defId.startsWith('fish:'))).toHaveLength(1);
  // The catch tag rose from the layer's own host: the controller's kept event reaches the overlay.
  expect(layers[0]!.ui).toBeTruthy();
  // Putting the rod down lowers it for everyone; it stays on the belt.
  play.slots.equipTool(null); await settle();
  expect(play.held.at(-1)).toBeNull();
  unmount(); stop(); staged.dispose();
});
