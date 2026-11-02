import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SHELF_CHANNEL, type FishingPierSite, type KingdomId, type ShelfDoor, type ShelfReply, type ShelfRequest } from '@chatdom/shared';
import { nearestDoor, registerPierInPlay, type PierHeldToolHandle, type PierPlaySlots, type PierViews, type PierWalkContext } from './play-composition';
import { createStagedPier } from './staged';
import type { PierLayerHost } from './layer';
import type { AlmanacOptions } from '../almanac/book';

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
  const staged = createStagedPier({ kingdomId: '200', site, rack: [0, 1, 1], almanac: [6, 1, 30], revision: 7, sample: () => ({ waterY: 0, groundY: -2 }),
    where: 'Willowmere pier', seeds: [7], clock: () => Date.now(),
    people: [{ personId: '100', walkerId: 'juniper-seat', name: 'Juniper', pose: lip },
      { personId: '101', walkerId: 'saoirse-seat', name: 'saoirse_k', pose: () => ({ ...lip(), position: [2, 1, 23.4] as [number, number, number] }) }] });
  const play = fakePlay();
  const layers: PierLayerHost[] = [], uis: string[] = [], books: AlmanacOptions[] = [], notes: string[] = [], shelves: string[] = [];
  let almanacFails = false;
  const views: PierViews = {
    ui: () => ({ prompt() {}, fight() {}, note(message) { notes.push(message); }, caught(tag) { uis.push(tag.name); }, worldTags() {}, dispose() {} }),
    layer: async host => { layers.push(host); return { update() {}, stats: () => ({ draws: 0, triangles: 0, fishers: 0, phase: null }), dispose() {} }; },
    sound: () => ({ cue() {}, reel() {}, tension() {}, ambience() {}, dispose() {} }) as never,
    bag: () => () => {}, hotbar: () => ({ refresh() {}, press: () => false, dispose() {} }), portrait: async () => null,
    shelf: (_host, source) => { shelves.push(source.mode === 'visit' ? `visit:${source.name}` : 'own'); return () => {}; },
    almanac: (_host, options) => { books.push(options); return { show() {}, update() {}, dispose() {}, ready: Promise.resolve(), page: 'contents' }; },
    loadAlmanac: async kingdomId => {
      if (almanacFails) throw new Error('offline');
      return { version: 1, kingdomId: kingdomId as KingdomId, kingdom: 'Willowmere', asOf: 1, water: 'lake', entries: [], caught: 0, catches: 0 };
    },
  };
  const stop = registerPierInPlay(play.slots, views);
  const frames = new Set<(dt: number, now: number) => void>();
  const ctx: PierWalkContext = { ...play.base, room: staged.room('100'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    selfWalkerId: () => 'juniper-seat', walkers: () => [], hand: () => null, hour: () => 18.5, kingdomName: 'Willowmere',
    overlay: {} as HTMLElement, audio: () => null, onFrame(listener) { frames.add(listener); return () => { frames.delete(listener); }; } };
  const unmount = play.features[0]!.mount(ctx);
  const frame = () => { for (const listener of frames) listener(1 / 60, performance.now()); play.handle()?.update(1 / 60); };
  return { staged, play, layers, uis, books, notes, shelves, views, failAlmanac: () => { almanacFails = true; }, stop, unmount, frame };
}

it('registers the pier with play: the walk, the rod, the belt, the bag, its keys and the rack', () => {
  const { play, stop, unmount, staged } = setup();
  expect(play.pieces.map(p => [p.id, p.region])).toEqual([['hotbar', 'bottom-centre']]);
  expect(play.pages.map(p => [p.id, p.title])).toEqual([['bag', 'Bag'], ['shelf', 'Shelf'], ['almanac', 'Almanac']]);
  expect(play.bindings.map(b => [b.id, b.defaultCode])).toEqual([['bag', 'KeyB'],
    ...Array.from({ length: 9 }, (_, i) => [`hotbar.${i + 1}`, `Digit${i + 1}`])]);
  expect(play.prompts.map(p => p.id)).toEqual(['pier.rack', 'pier.almanac', 'pier.shelf']);
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

it('opens the Almanac at the lectern with your own marks, and in the ledger for anyone', async () => {
  const appended: unknown[] = [];
  vi.stubGlobal('document', { createElement: () => ({ style: {}, className: '', textContent: '', remove() {} }) });
  try {
    const { play, books, notes, stop, unmount, staged, failAlmanac } = setup();
    await settle();
    const lectern = play.prompts.find(p => p.id === 'pier.almanac')!;
    expect(lectern.prompt({ position: [0, 1, 18], yaw: 0 })).toBeNull();
    expect(lectern.prompt({ position: [5, 1, 29], yaw: 0 })).toEqual({ label: 'Read the Almanac', at: [6, 1, 30] });
    const overlay = { append: (node: unknown) => { appended.push(node); } };
    // Walk again with an overlay the test can see into.
    unmount();
    const ctx = { ...play.base, room: staged.room('100'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      selfWalkerId: () => 'juniper-seat', walkers: () => [], hand: () => null, hour: () => 18.5, kingdomName: 'Willowmere',
      overlay: overlay as unknown as HTMLElement, audio: () => null, onFrame: () => () => {} } satisfies PierWalkContext;
    const again = play.features[0]!.mount(ctx);
    await settle();
    lectern.use(play.base); await settle();
    expect(appended).toHaveLength(1);
    expect(books.at(-1)).toMatchObject({ mode: 'walker', marks: [], almanac: { kingdom: 'Willowmere' } });
    // The ledger page: watching, the public book without anyone's marks.
    const page = play.pages.find(p => p.id === 'almanac')!;
    expect(page.available({ ...play.base, mode: 'watching' })).toBe(true);
    const host = { append() {}, replaceChildren() {} } as unknown as HTMLElement;
    const close = page.mount(host, { ...play.base, mode: 'watching' }); await settle();
    expect(books.at(-1)).toMatchObject({ mode: 'watcher', marks: null });
    close();
    // An unreachable Almanac says so in plain words, and opens nothing.
    books.length = 0;
    failAlmanac();
    again(); const third = play.features[0]!.mount(ctx); await settle();
    lectern.use(play.base); await settle();
    expect(books).toHaveLength(0);
    expect(notes.length).toBeGreaterThan(0);
    third(); stop(); staged.dispose();
  } finally { vi.unstubAllGlobals(); }
});

it('offers your shelf at your own door and a shown shelf at a neighbour’s, and opens each', async () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, className: '', textContent: '', remove() {} }) });
  try {
    const { play, staged, shelves, stop, unmount } = setup();
    unmount();
    // The realm's shelf channel, answered here: your door, Wren's shown door and her shelf.
    const mine: ShelfDoor = { plotId: 'home:3', at: [10, 1, 4], name: null, mine: true, shown: false };
    const wren: ShelfDoor = { plotId: 'home:5', at: [20, 1, 4], name: 'Wren', mine: false, shown: true };
    const inner = staged.room('100'), listeners = new Set<(message: unknown) => void>();
    const answer = (message: ShelfReply) => queueMicrotask(() => { for (const listener of listeners) listener(message); });
    const sent: ShelfRequest[] = [];
    const room = {
      onMessage(type: string, listener: (message: unknown) => void) {
        if (type !== SHELF_CHANNEL) return inner.onMessage(type, listener);
        listeners.add(listener); return () => { listeners.delete(listener); };
      },
      send(type: string, payload: unknown) {
        if (type !== SHELF_CHANNEL) { inner.send(type, payload); return; }
        const request = payload as ShelfRequest; sent.push(request);
        if (request.type === 'shelf.read') answer({ type: 'shelf.state', id: request.id, settings: { shown: false, revision: 0 }, door: mine });
        if (request.type === 'shelf.doors') answer({ type: 'shelf.doors', id: request.id, doors: [mine, wren] });
        if (request.type === 'shelf.visit') answer(request.plotId === 'home:5'
          ? { type: 'shelf.view', id: request.id, plotId: 'home:5', name: 'Wren', pieces: [] }
          : { type: 'shelf.refused', id: request.id, message: 'This shelf is kept by its owner.' });
      },
    };
    const overlay = { append() {}, clientWidth: 1440, clientHeight: 900 } as unknown as HTMLElement;
    const again = play.features[0]!.mount({ ...play.base, room, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      selfWalkerId: () => 'juniper-seat', walkers: () => [], hand: () => null, hour: () => 18.5, kingdomName: 'Willowmere',
      overlay, audio: () => null, onFrame: () => () => {} });
    await settle();
    const prompt = play.prompts.find(p => p.id === 'pier.shelf')!;
    expect(prompt.prompt({ position: [0, 1, 4], yaw: 0 })).toBeNull();
    expect(prompt.prompt({ position: [10.5, 1, 5], yaw: 0 })).toEqual({ label: 'Your shelf', at: [10, 1, 4] });
    prompt.use(play.base); await settle();
    expect(shelves).toEqual(['own']);
    expect(prompt.prompt({ position: [19, 1, 4.5], yaw: 0 })).toEqual({ label: 'Wren’s shelf', at: [20, 1, 4] });
    prompt.use(play.base); await settle();
    expect(shelves).toEqual(['own', 'visit:Wren']);
    expect(sent.filter(request => request.type === 'shelf.visit')).toEqual([expect.objectContaining({ plotId: 'home:5' })]);
    // Watching nobody's shelf from a step too high or too far.
    expect(prompt.prompt({ position: [20, 4, 4], yaw: 0 })).toBeNull();
    again(); stop(); staged.dispose();
  } finally { vi.unstubAllGlobals(); }
});

it('finds the nearest door you may look at, never a hidden neighbour’s', () => {
  const at = (x: number): readonly [number, number, number] => [x, 1, 0];
  const own: ShelfDoor = { plotId: 'a', at: [0, 1, 0], name: null, mine: true, shown: false };
  const hidden: ShelfDoor = { plotId: 'b', at: [1, 1, 0], name: 'Wren', mine: false, shown: false };
  const shown: ShelfDoor = { plotId: 'c', at: [2, 1, 0], name: 'Saoirse', mine: false, shown: true };
  const store = { door: () => own, doors: () => [hidden, shown] };
  expect(nearestDoor(store, { position: at(.2) })?.plotId).toBe('a');
  expect(nearestDoor(store, { position: at(.9) })?.plotId).toBe('a');
  expect(nearestDoor(store, { position: at(1.8) })?.plotId).toBe('c');
  expect(nearestDoor(store, { position: at(9) })).toBeNull();
  expect(nearestDoor({ door: () => null, doors: () => [hidden] }, { position: at(1) })).toBeNull();
});
