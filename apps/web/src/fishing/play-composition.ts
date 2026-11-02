import * as THREE from 'three';
import { kingdomAudioHost, type KingdomAudio } from '@chatdom/audio';
import { kingdomWaterMood, type KingdomId, type Vec3 } from '@chatdom/shared';
import { createBagStore, hotbarSlots, mountBag, mountHotbar, itemPortrait, type BagSound, type BagStore } from '../bag';
import { createFishingController, type FishingController } from './controller';
import { mountPierLayer, type PierLayer, type PierWalker } from './layer';
import { claimPierScene } from './kingdom-layer';
import { fishingLink, itemLink, type ChannelRoom } from './link';
import { createPierSound } from './sound';
import { mountFishingUiStaged } from './ui/mount';
import type { FishingUi } from './ui/types';

/*
 * The pier in a walked kingdom, composed from play's slots (apps/web/src/play/slots.ts, play SEAMS B1a). The shapes
 * below are the parts of play's slots pier uses, written out by shape so this folder builds on its own; the
 * integrator passes play's own module: `registerPierInPlay(slots)` (pier SEAMS 2a). Nothing here moves the camera,
 * takes pointer lock or reads input the held tool is not given.
 */

type Pose = 'cast' | 'hold' | 'reel' | null;
export interface PierPlayContext {
  readonly kingdomId: KingdomId;
  readonly self: { readonly personId: string; readonly publicName: string } | null;
  readonly mode: 'walking' | 'watching' | 'stream';
  requestCursor(reason: string): { release(): void; readonly active: boolean };
  closeLedger(): void;
}
/** play's `ToolContext`, as the rod reads it. */
export interface PierToolContext extends PierPlayContext {
  holdPose(pose: Pose): void;
}
/**
 * The walk feature pier asks play for (SEAMS 2a): mounted once per walked kingdom once the room has placed you,
 * disposed when you leave it. It is the held tool's context for the whole walk, plus what a feature that others see
 * needs: who you are in the room, everyone play draws, an overlay, the kingdom's audio and the frame.
 */
export interface PierWalkContext extends PierPlayContext {
  readonly room: ChannelRoom;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Your walker id in the room (its session id), or null before the room has placed you. */
  selfWalkerId(): string | null;
  /** Everyone play draws, you included: feet in world metres, yaw in radians (0 faces +Z), approved name. */
  walkers(): readonly PierWalker[];
  /** World matrix of your right-hand grip, third or first person; null while not drawn. */
  hand(): THREE.Matrix4 | null;
  /** The scene's hour, 0..24. */
  hour(): number;
  /** The kingdom's approved name, for "First in …"; empty when it has none. */
  readonly kingdomName: string;
  /** A full-window, pointer-transparent layer over the world, under play's HUD pieces. */
  readonly overlay: HTMLElement;
  /** The kingdom's own audio at the world volume, once the first gesture has unlocked it. */
  audio(): KingdomAudio | null;
  /** Each drawn frame, before the render: seconds since the last frame and `performance.now()`. */
  onFrame(listener: (dt: number, now: number) => void): () => void;
}
export interface PierHeldToolHandle { press(at: number): void; release(at: number): void; cancel(): void; update(dt: number): void; dispose(): void }
export interface PierPlaySlots {
  registerWalkFeature(provider: { readonly id: string; mount(ctx: PierWalkContext): () => void }): () => void;
  registerHeldTool(provider: { readonly id: string; equip(ctx: PierToolContext): PierHeldToolHandle }): () => void;
  equipTool(id: string | null): void;
  equippedTool(): string | null;
  registerHudPiece(provider: { readonly id: string; readonly region: 'bottom-centre'; readonly order: number;
    available(ctx: PierPlayContext): boolean; mount(host: HTMLElement, ctx: PierPlayContext): () => void }): () => void;
  registerLedgerPage(provider: { readonly id: string; readonly title: string; readonly order: number;
    available(ctx: PierPlayContext): boolean; mount(host: HTMLElement, ctx: PierPlayContext): () => void }): () => void;
  registerActionBinding(binding: { readonly id: string; readonly label: string; readonly defaultCode: string; onPress(ctx: PierPlayContext): void }): () => void;
  registerWorldPrompt(provider: { readonly id: string;
    prompt(pose: { readonly position: readonly [number, number, number]; readonly yaw: number }): { readonly label: string; readonly at: readonly [number, number, number] } | null;
    use(ctx: PierPlayContext): void }): () => void;
  observedWalkerHand(walkerId: string): THREE.Matrix4 | null;
  observedWalkerPose(walkerId: string, pose: Pose): void;
}

/** One walked kingdom's pier: the room links, the controller, the bag, and (once the realm names a pier) the layer. */
export interface PierWalk {
  readonly controller: FishingController;
  readonly store: BagStore;
  readonly ui: FishingUi;
  layer(): PierLayer | null;
  /** Select a hotbar thing: the rod goes into the hand, nothing empties it. */
  select(itemId: string | null): void;
  toggleBag(): void;
  dispose(): void;
}

/** The drawn pieces, replaceable in tests (which have no DOM or WebGL). */
export interface PierViews {
  ui: typeof mountFishingUiStaged;
  layer: typeof mountPierLayer;
  sound: typeof createPierSound;
  bag: typeof mountBag;
  hotbar: typeof mountHotbar;
  portrait(defId: string): Promise<CanvasImageSource | null>;
}
const VIEWS: PierViews = { ui: mountFishingUiStaged, layer: mountPierLayer, sound: createPierSound, bag: mountBag, hotbar: mountHotbar,
  portrait: defId => itemPortrait(defId, 288).catch(() => null) };

const RACK_REACH = 2.25, RACK_RISE = .75;
const compact = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
const isRod = (defId: string | undefined) => !!defId?.startsWith('tool:rod.');

function walkPier(ctx: PierWalkContext, slots: PierPlaySlots, views: PierViews): PierWalk {
  const fishing = fishingLink(ctx.room), items = itemLink(ctx.room);
  const controller = createFishingController({ link: fishing, selfWalkerId: ctx.selfWalkerId() ?? '' });
  const store = createBagStore(items, ctx.self ? { personId: ctx.self.personId } : {});
  let audio: KingdomAudio | null = null;
  const sound = views.sound(() => { audio = ctx.audio(); return audio ? kingdomAudioHost(audio) : null; });
  const surface: BagSound = kind => { ctx.audio()?.cue('wood', { ui: kind }); };
  const ui = views.ui(ctx.overlay, { compact: compact(), kingdomName: ctx.kingdomName,
    onBeat: beat => sound.cue(beat === 'dismiss' ? 'tag' : beat, { intensity: beat === 'dismiss' ? .25 : .5 }) });
  let layer: PierLayer | null = null, mounting = false, disposed = false, closeBag: (() => void) | null = null, unclaim = () => {};
  let bagHost: HTMLDivElement | null = null;
  const camera = ctx.camera instanceof THREE.PerspectiveCamera ? ctx.camera : null;
  const self = () => ctx.selfWalkerId();
  const mountLayer = () => {
    const state = controller.state();
    if (layer || mounting || disposed || !state.site || !camera) return;
    mounting = true;
    void views.layer({ scene: ctx.scene, camera, site: state.site, lights: state.lights, rack: state.rack, controller,
      hour: () => ctx.hour(), mood: () => kingdomWaterMood(ctx.kingdomId, controller.serverNow()),
      walkers: () => ctx.walkers(),
      hand: id => (id === self() ? ctx.hand() : slots.observedWalkerHand(id)),
      viewport: () => ({ width: ctx.overlay.clientWidth, height: ctx.overlay.clientHeight }),
      touch: () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
      sound, ui, portrait: views.portrait })
      // Once this layer draws the lanterns and mood, the watcher's lanterns for the same scene stand aside.
      .then(mounted => { if (disposed) mounted.dispose(); else { layer = mounted; unclaim = claimPierScene(ctx.scene); } })
      .catch(error => { console.error('The pier could not be drawn.', error); })
      .finally(() => { mounting = false; });
  };
  // Other fishers' bodies hold their rods in the pose their line asks for.
  const posed = new Map<string, Pose>();
  const poseOthers = () => {
    const state = controller.state(), seen = new Set<string>();
    for (const walkerId of state.rods) {
      if (walkerId === self()) continue;
      const phase = state.casts.get(walkerId)?.phase;
      const pose: Pose = phase === 'drawing' ? 'cast' : phase === 'fighting' || phase === 'landing' ? 'reel' : 'hold';
      seen.add(walkerId);
      if (posed.get(walkerId) !== pose) { posed.set(walkerId, pose); slots.observedWalkerPose(walkerId, pose); }
    }
    for (const walkerId of [...posed.keys()]) if (!seen.has(walkerId)) { posed.delete(walkerId); slots.observedWalkerPose(walkerId, null); }
  };
  const stopEvents = controller.subscribe(event => {
    if (event.kind === 'state') mountLayer();
    // A rod taken from the rack goes straight into the hand, as it lands in the first slot.
    if (event.kind === 'taken') slots.equipTool('rod');
  });
  const stopFrame = ctx.onFrame((_dt, now) => { layer?.update(now / 1000); poseOthers(); });
  controller.sync();
  return {
    controller, store, ui, layer: () => layer,
    select(itemId) {
      const item = itemId ? store.item(itemId) : undefined;
      if (item && isRod(item.defId)) { controller.equip(item.id); slots.equipTool('rod'); return; }
      if (slots.equippedTool() === 'rod') slots.equipTool(null);
      controller.equip(null);
    },
    toggleBag() {
      if (closeBag) { closeBag(); return; }
      const cursor = ctx.requestCursor('bag');
      const host = bagHost ??= Object.assign(document.createElement('div'), { className: 'pier-bag-layer' });
      Object.assign(host.style, { position: 'absolute', inset: '0', pointerEvents: 'auto' });
      ctx.overlay.append(host);
      const unmount = views.bag(host, store, { ...(ctx.self ? { viewerPersonId: ctx.self.personId } : {}), compact: compact(), sound: surface,
        onClose: () => closeBag?.() });
      closeBag = () => { closeBag = null; unmount(); host.remove(); cursor.release(); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeBag?.(); stopFrame(); stopEvents();
      for (const walkerId of posed.keys()) slots.observedWalkerPose(walkerId, null);
      posed.clear();
      layer?.dispose(); layer = null; unclaim();
      ui.dispose(); sound.dispose(); store.dispose(); controller.dispose(); fishing.dispose(); items.dispose();
    },
  };
}

/** Registers the pier with play: the walk feature, the rod, the hotbar, the bag, their keys and the rack's prompt. */
export function registerPierInPlay(slots: PierPlaySlots, views: PierViews = VIEWS): () => void {
  let walk: PierWalk | null = null;
  const walking = (ctx: PierPlayContext) => ctx.mode === 'walking' && !!ctx.self && !!walk;
  const stops = [
    slots.registerWalkFeature({ id: 'pier', mount(ctx) {
      if (ctx.mode !== 'walking' || !ctx.self) return () => {};
      const mine = walkPier(ctx, slots, views);
      walk = mine;
      return () => { if (walk === mine) walk = null; mine.dispose(); };
    } }),
    slots.registerHeldTool({ id: 'rod', equip(ctx) {
      const current = walk;
      let pose: Pose = null;
      const hold = (next: Pose) => { if (next !== pose) { pose = next; ctx.holdPose(next); } };
      return {
        press() { current?.controller.press(); },
        release() { current?.controller.release(); },
        cancel() { current?.controller.cancel(); },
        update() {
          const state = current?.controller.state(), phase = state?.cast?.phase;
          hold(!state?.rod ? null : state.input === 'drawing' || phase === 'drawing' ? 'cast' : phase === 'fighting' || phase === 'landing' ? 'reel' : 'hold');
        },
        dispose() {
          hold(null);
          // Putting the rod down reels in and lowers it for everyone; the rod stays yours on the belt.
          if (current && walk === current && current.controller.state().rod) { current.controller.cancel(); current.controller.equip(null); }
        },
      };
    } }),
    slots.registerHudPiece({ id: 'hotbar', region: 'bottom-centre', order: 10, available: walking, mount(host) {
      const mine = walk;
      if (!mine) return () => {};
      const hotbar = views.hotbar(host, mine.store, { compact: compact(),
        selected: () => (slots.equippedTool() === 'rod' ? mine.controller.state().rod?.id ?? null : null),
        onSelect: itemId => mine.select(itemId) });
      const stop = mine.controller.subscribe(event => { if (event.kind === 'state' || event.kind === 'rod' || event.kind === 'taken') hotbar.refresh(); });
      return () => { stop(); hotbar.dispose(); };
    } }),
    slots.registerLedgerPage({ id: 'bag', title: 'Bag', order: 25, available: walking, mount(host, ctx) {
      const mine = walk;
      if (!mine) return () => {};
      return views.bag(host, mine.store, { ...(ctx.self ? { viewerPersonId: ctx.self.personId } : {}), compact: compact(), onClose: () => ctx.closeLedger() });
    } }),
    slots.registerActionBinding({ id: 'bag', label: 'Open your bag', defaultCode: 'KeyB', onPress(ctx) { if (walking(ctx)) walk!.toggleBag(); } }),
    slots.registerActionBinding({ id: 'hotbar.1', label: 'Hold the first thing on your belt', defaultCode: 'Digit1', onPress(ctx) {
      if (!walking(ctx)) return;
      const first = hotbarSlots(walk!.store.items())[0]?.item;
      if (!first) return;
      walk!.select(slots.equippedTool() === 'rod' && walk!.controller.state().rod?.id === first.id ? null : first.id);
    } }),
    slots.registerWorldPrompt({ id: 'pier.rack',
      prompt(pose) {
        const state = walk?.controller.state(), rack = state?.rack;
        if (!state?.ready || !rack || state.rod || state.busy) return null;
        const near = Math.abs(pose.position[1] - rack[1]) <= RACK_RISE && Math.hypot(pose.position[0] - rack[0], pose.position[2] - rack[2]) <= RACK_REACH;
        return near ? { label: 'Take a willow rod', at: rack as Vec3 } : null;
      },
      use(ctx) { if (walking(ctx)) walk!.controller.take(); } }),
  ];
  return () => { for (const stop of stops.reverse()) stop(); walk?.dispose(); walk = null; };
}
