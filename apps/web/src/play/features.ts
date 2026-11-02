import type { KingdomAudio } from '@chatdom/audio';
import { onSlotsChanged, walkFeatures, type PlayContext, type WalkFeatureContext, type WalkFeatureProvider } from './slots';
import type { PlayWorld } from './tools';

/**
 * Walk features (pier's SEAMS 2a, play SEAMS B1c): every registered feature is mounted once the room has placed you,
 * a feature registered later mounts on the next frame, one unregistered is disposed, and all of them are disposed as
 * the walk ends. A feature that throws is logged and left out; it never stops the walk or another feature.
 */
export interface WalkFeatureWorld {
  selfWalkerId(): string | null;
  walkers(): ReturnType<WalkFeatureContext['walkers']>;
  hour(): number;
  readonly kingdomName: string;
  audio(): KingdomAudio | null;
  /** Where the features' overlay goes: the walk's HUD host. The overlay sits under the HUD pieces. */
  readonly overlayHost: HTMLElement;
}

export interface WalkFeatureRuntime {
  /** The ids mounted now. */
  readonly mounted: readonly string[];
  /** Once per drawn frame, before the render. */
  frame(dt: number, now: number): void;
  dispose(): void;
}

interface Mounted { readonly provider: WalkFeatureProvider; readonly listeners: Set<(dt: number, now: number) => void>; unmount: () => void; live: boolean }

export function createWalkFeatures(ctx: PlayContext, world: PlayWorld, features: WalkFeatureWorld): WalkFeatureRuntime {
  const overlay = document.createElement('div');
  overlay.className = 'pl-features';
  overlay.setAttribute('aria-hidden', 'true');
  features.overlayHost.appendChild(overlay);
  const mounted = new Map<string, Mounted>();
  let disposed = false, dirty = true;

  const contextFor = (entry: Mounted): WalkFeatureContext => ({
    get kingdomId() { return ctx.kingdomId; },
    get self() { return ctx.self; },
    get live() { return ctx.live; },
    get mode() { return ctx.mode; },
    get settings() { return ctx.settings; },
    requestCursor: reason => ctx.requestCursor(reason),
    closeLedger: () => ctx.closeLedger(),
    requestInput: reason => ctx.requestInput(reason),
    hideSelf: reason => ctx.hideSelf(reason),
    room: world.room,
    pose: () => world.pose(),
    hand: () => world.hand(),
    scene: world.scene,
    camera: world.camera,
    selfWalkerId: () => features.selfWalkerId(),
    walkers: () => features.walkers(),
    hour: () => features.hour(),
    kingdomName: features.kingdomName,
    overlay,
    audio: () => features.audio(),
    onFrame(listener) {
      // Only a mounted feature hears frames; a listener added after its own dispose is ignored.
      if (!entry.live) return () => {};
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
  });

  const unmount = (id: string) => {
    const entry = mounted.get(id);
    if (!entry) return;
    mounted.delete(id);
    entry.live = false; entry.listeners.clear();
    try { entry.unmount(); } catch (error) { console.error(`The walk feature ${id} failed to leave`, error); }
  };

  const sync = () => {
    if (disposed) return;
    const wanted = walkFeatures(), ids = new Set(wanted.map(provider => provider.id));
    for (const [id, entry] of [...mounted]) if (!ids.has(id) || !wanted.includes(entry.provider)) unmount(id);
    // Mounted only once the room has placed you, so a feature never reads an empty room.
    if (features.selfWalkerId() === null) return;
    dirty = false;
    for (const provider of wanted) {
      if (mounted.has(provider.id)) continue;
      const entry: Mounted = { provider, listeners: new Set(), unmount: () => {}, live: true };
      mounted.set(provider.id, entry);
      try {
        const done = provider.mount(contextFor(entry));
        if (typeof done !== 'function') throw new Error('mount did not return its dispose');
        if (mounted.get(provider.id) === entry) entry.unmount = done; else done();
      } catch (error) {
        if (mounted.get(provider.id) === entry) mounted.delete(provider.id);
        entry.live = false; entry.listeners.clear();
        console.error(`The walk feature ${provider.id} could not be mounted`, error);
      }
    }
  };
  const stopSlots = onSlotsChanged(() => { dirty = true; });

  return {
    get mounted() { return [...mounted.keys()]; },
    frame(dt, now) {
      if (disposed) return;
      if (dirty) sync();
      for (const [id, entry] of [...mounted]) {
        for (const listener of [...entry.listeners]) {
          try { listener(dt, now); } catch (error) { console.error(`The walk feature ${id} failed in a frame`, error); }
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSlots();
      for (const id of [...mounted.keys()].reverse()) unmount(id);
      overlay.remove();
    },
  };
}
