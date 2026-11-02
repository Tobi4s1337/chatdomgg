import type { AtlasGateEvent, AtlasGateHost, AtlasTravelStage, GateLand } from '../raid-gate/ports';
import type { AtlasChannel } from '@chatdom/shared';
import type { AtlasRaid, KingdomId } from '../../../api/src/raid-gate/contracts';
import { preloadFaces } from './fonts';

export type AtlasMode = 'hero' | 'explore' | 'gate';
export type AtlasTarget = { login: string } | { channelId: string };
/** Mount owned footer content; its cleanup runs on hero mode or disposal. Never called for a hero. */
export type AtlasFooterSlot = (element: HTMLElement) => void | (() => void);
export interface AtlasMountOptions {
  mode: AtlasMode;
  focus?: AtlasTarget | null;
  /**
   * Start exactly at a view this map gave earlier (`handle.view()`): its position, zoom and open card. Wins over
   * `focus`. A view from another survey revision, or a malformed one, falls back to the usual start.
   */
  view?: AtlasView | null;
  routing?: 'url' | 'memory';
  onExplore?: (view: AtlasView) => void;
  base?: string;
  signal?: AbortSignal;
  slots?: { footer?: AtlasFooterSlot };
}
export interface AtlasView { x: number; y: number; scale: number; selected: string | null; mapId: string }
export type AtlasReadyState = 'map' | 'still' | 'failed';
export interface AtlasHandle {
  readonly mode: AtlasMode;
  readonly ready: Promise<AtlasReadyState>;
  readonly gate: AtlasGateHost | null;
  view(): AtlasView;
  flyTo(target: AtlasTarget, options?: { openCard?: boolean; signal?: AbortSignal }): Promise<boolean>;
  /**
   * Put the map exactly at a view it gave earlier, without a flight, and open its card (explore only). Resolves true
   * once it stands there; false for a view from another survey revision, a malformed view, a card that cannot be
   * shown, a disposed map, or one superseded by a newer `restore` or `flyTo` (only the newest may still open a card).
   */
  restore(view: AtlasView, options?: { signal?: AbortSignal }): Promise<boolean>;
  setMode(mode: 'hero' | 'explore'): void;
  dispose(): void;
}

/** The scene's half of gate mode. The embed's bridge owns listeners and queues calls until the map is up. */
export interface AtlasSceneGate {
  open(from: KingdomId, signal: AbortSignal): void;
  close(): void;
  resolve(kingdomId: KingdomId, signal: AbortSignal): Promise<Readonly<{ channel: AtlasChannel; land: GateLand }> | null>;
  follow(raid: AtlasRaid, signal: AbortSignal): void;
  travel(stage: AtlasTravelStage, signal: AbortSignal): void;
}

/** Internal scene boundary. This module deliberately has no runtime imports. */
export interface AtlasScene {
  view(): AtlasView;
  flyTo: AtlasHandle['flyTo'];
  restore: AtlasHandle['restore'];
  setMode(mode: 'hero' | 'explore'): void;
  /** gate mode only. */
  gate?: AtlasSceneGate;
  dispose(): void;
}

/** What the scene tells the bridge: the monarch's pick, or the board closed by its own hand. */
export type AtlasGateEmit = (event: AtlasGateEvent) => void;

/**
 * `handle.gate`: raid-show's `AtlasGateHost`, usable the moment `mountAtlas` returns. Calls made before the map is
 * drawn wait for it (the latest `open` wins, `follow` and `travel` keep their order); listeners live here, so a
 * subscription survives the map loading. Presentation only: nothing here decides or performs a raid.
 */
export function gateBridge(scene: () => AtlasScene | null, loaded: Promise<unknown>, ready: Promise<AtlasReadyState>, disposed: () => boolean): { host: AtlasGateHost; emit: AtlasGateEmit } {
  const listeners = new Set<(event: AtlasGateEvent) => void>();
  let queue: ((gate: AtlasSceneGate) => void)[] = [];
  let pendingOpen: { from: KingdomId; signal: AbortSignal } | null = null;
  let flushed = false;
  void loaded.then(() => ready).then(() => {
    flushed = true;
    const gate = scene()?.gate;
    if (!gate || disposed()) return;
    if (pendingOpen && !pendingOpen.signal.aborted) gate.open(pendingOpen.from, pendingOpen.signal);
    pendingOpen = null;
    for (const call of queue) call(gate);
    queue = [];
  });
  const later = (call: (gate: AtlasSceneGate) => void) => {
    if (disposed()) return;
    const gate = flushed ? scene()?.gate : null;
    if (gate) call(gate);
    else if (!flushed) queue.push(call);
  };
  const host: AtlasGateHost = {
    // A product host is always fed by the Surveyor and the Atlas service; there is no bench origin on this surface.
    origin: 'live',
    open(from, signal) {
      if (signal.aborted || disposed()) return;
      const gate = flushed ? scene()?.gate : null;
      if (gate) gate.open(from, signal);
      else if (!flushed) pendingOpen = { from, signal };
    },
    close() {
      pendingOpen = null;
      queue = [];
      if (flushed) scene()?.gate?.close();
    },
    async resolve(kingdomId, signal) {
      await loaded;
      await ready;
      const gate = scene()?.gate;
      if (!gate || disposed() || signal.aborted) return null;
      return gate.resolve(kingdomId, signal);
    },
    subscribe(listener, signal) {
      if (signal.aborted) return;
      listeners.add(listener);
      signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
    },
    follow(raid, signal) {
      if (!signal.aborted) later(gate => { if (!signal.aborted) gate.follow(raid, signal); });
    },
    travel(stage, signal) {
      if (!signal.aborted) later(gate => { if (!signal.aborted) gate.travel(stage, signal); });
    },
  };
  return {
    host,
    emit: event => {
      if (disposed()) return;
      for (const listener of [...listeners]) {
        try { listener(event); } catch (error) { console.error('A gate listener failed', error); }
      }
    },
  };
}

export function mountAtlas(el: HTMLElement, options: AtlasMountOptions): AtlasHandle {
  // The lettering's faces travel beside the scene's code, not after it.
  preloadFaces();
  let mode = options.mode;
  let scene: AtlasScene | null = null;
  let disposed = false;
  let resolveReady!: (state: AtlasReadyState) => void;
  const ready = new Promise<AtlasReadyState>(resolve => { resolveReady = resolve; });
  const root = document.createElement('div');
  root.dataset.chatdomAtlas = '';
  root.dataset.atlasMode = mode;
  root.dataset.atlasReady = 'loading';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#e2d3ae' });
  el.append(root);
  const controller = new AbortController();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    options.signal?.removeEventListener('abort', dispose);
    scene?.dispose();
    scene = null;
    root.remove();
    resolveReady('failed');
  };
  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener('abort', dispose, { once: true });
  let emitGate: AtlasGateEmit = () => undefined;
  const loading = disposed ? Promise.resolve() : import('./scene').then(module => {
    if (disposed) return;
    scene = module.mountScene(root, { ...options, mode, signal: controller.signal }, state => {
      if (disposed) return;
      root.dataset.atlasReady = state;
      resolveReady(state);
    }, event => emitGate(event));
  }).catch(() => {
    if (disposed) return;
    root.dataset.atlasReady = 'failed';
    root.textContent = 'The map room is closed. Try again in a moment.';
    root.style.cssText += ';display:grid;place-items:center;padding:24px;color:#3b2f25;font:20px Georgia,serif;text-align:center';
    resolveReady('failed');
  });
  let gate: AtlasGateHost | null = null;
  if (options.mode === 'gate') {
    const bridge = gateBridge(() => scene, loading, ready, () => disposed);
    gate = bridge.host;
    emitGate = bridge.emit;
  }
  return {
    get mode() { return mode; }, ready, gate,
    view: () => scene?.view() ?? { x: 0, y: 0, scale: 1, selected: null, mapId: '' },
    async flyTo(target, flyOptions) {
      await loading;
      if (disposed || flyOptions?.signal?.aborted || !scene) return false;
      await ready;
      return !disposed && !flyOptions?.signal?.aborted ? scene.flyTo(target, flyOptions) : false;
    },
    async restore(view, restoreOptions) {
      await loading;
      if (disposed || restoreOptions?.signal?.aborted || !scene) return false;
      await ready;
      return !disposed && !restoreOptions?.signal?.aborted && scene ? scene.restore(view, restoreOptions) : false;
    },
    setMode(next) {
      // A gate map is the Raid Gate's own surface; it never turns into the front page's map.
      if (disposed || mode === 'gate') return;
      mode = next;
      root.dataset.atlasMode = next;
      scene?.setMode(next);
    },
    dispose,
  };
}

/** Warm only the module and immutable world head; mounting remains the only operation that draws. */
export async function preloadAtlas(options?: { base?: string }): Promise<void> {
  const [{ fetchPointer, fetchWorld }] = await Promise.all([import('./data/preview'), import('./scene')]);
  const source = { base: options?.base ?? '/map-data', fetch: globalThis.fetch.bind(globalThis) };
  const pointer = await fetchPointer(source);
  await fetchWorld(source, pointer);
}
