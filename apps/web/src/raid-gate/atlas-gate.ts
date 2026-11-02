/**
 * Atlas gate mode for hosts of the gate board (SEAMS §1). The Atlas embed is found through `import.meta.glob`, so a
 * build without the Atlas still compiles and its board honestly says the map is not available (`atlas: null`), while
 * a build that has it binds `mountAtlas(el, { mode: 'gate' })` and hands its `gate` straight to the controller.
 *
 * Nothing here decides anything: the Atlas owns the finder and its ordering, and the controller owns every request.
 */
import type { AtlasGateEvent, AtlasGateHost } from './ports';

/** A lazily loadable module map, shaped like `import.meta.glob`'s result. Tests pass their own. */
export type GateAtlasModules = Readonly<Record<string, () => Promise<unknown>>>;

/** How far the map got: drawn (`map`), only its still picture (`still`), or not at all (`failed`). The Atlas's own words. */
export type GateAtlasReady = 'map' | 'still' | 'failed';

/** The part of the Atlas embed this file relies on. Anything else about the module is the Atlas's business. */
type GateEmbed = Readonly<{
  mountAtlas(el: HTMLElement, options: { mode: 'gate'; signal: AbortSignal }): {
    readonly gate: AtlasGateHost | null; readonly ready?: Promise<GateAtlasReady>; dispose(): void;
  };
}>;

/**
 * Hears how far a mounted map got, each time that changes. The Atlas shows its still picture first and is drawn
 * later, so a listener may hear `still` and then `map`. An embed that does not say is taken as drawn.
 */
export type GateAtlasReadyListener = (state: GateAtlasReady) => void;

const EMBED = '../atlas/embed.ts';
const bundled: GateAtlasModules = import.meta.glob('../atlas/embed.ts');

/** Whether this build carries the Atlas embed at all. Known at build time, so a host can decide synchronously. */
export function gateAtlasBundled(modules: GateAtlasModules = bundled): boolean {
  return typeof modules[EMBED] === 'function';
}

function embedOf(value: unknown): GateEmbed | null {
  return value !== null && typeof value === 'object' && typeof (value as { mountAtlas?: unknown }).mountAtlas === 'function' ? value as GateEmbed : null;
}

/**
 * Loads the Atlas embed and mounts gate mode into `el` for as long as `signal` lives; aborting disposes the map.
 * Resolves `null` when the build has no Atlas, when it fails to load, when the embed offers no gate, or when the
 * signal ended first. It never resolves a stand-in.
 */
export async function mountGateAtlas(
  el: HTMLElement, signal: AbortSignal, modules: GateAtlasModules = bundled, onReady?: GateAtlasReadyListener,
): Promise<AtlasGateHost | null> {
  const load = modules[EMBED];
  if (!load || signal.aborted) return null;
  let embed: GateEmbed | null;
  try { embed = embedOf(await load()); } catch { return null; }
  if (!embed || signal.aborted) return null;
  const handle = embed.mountAtlas(el, { mode: 'gate', signal });
  const dispose = () => handle.dispose();
  if (!handle.gate) { dispose(); return null; }
  signal.addEventListener('abort', dispose, { once: true });
  if (onReady) {
    let last: GateAtlasReady | null = null;
    const tell = (state: GateAtlasReady) => { if (!signal.aborted && state !== last) { last = state; onReady(state); } };
    const ready = handle.ready ?? Promise.resolve<GateAtlasReady>('map');
    void ready.then(tell, () => tell('failed'));
    // The ready promise settles on the first state only; the embed's root keeps saying where it got to since.
    if (typeof MutationObserver === 'function') {
      const read = () => {
        const state = el.querySelector<HTMLElement>('[data-chatdom-atlas]')?.dataset.atlasReady;
        if (state === 'map' || state === 'still' || state === 'failed') tell(state);
      };
      const watch = new MutationObserver(read);
      watch.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-atlas-ready'] });
      signal.addEventListener('abort', () => watch.disconnect(), { once: true });
    }
  }
  return handle.gate;
}

/** A gate map mounted on first need, which a host may also warm ahead of it (see `deferGateAtlas`). */
export type DeferredGateAtlas = AtlasGateHost & Readonly<{
  /**
   * Mounts the map now, without opening anything, so it is drawn by the time a journey asks for the rise. A walker
   * who joined a march warms it; a monarch's board never needs to. Repeated calls do nothing more.
   */
  warm(): void;
}>;

export type DeferGateAtlasOptions = Readonly<{
  /** Hears how far the mounted map got, as it changes. A map that is not drawn leaves the host its own road. */
  onReady?: GateAtlasReadyListener;
}>;

/**
 * An `AtlasGateHost` that mounts the map only when the board first needs it (opening the finder, naming a destination,
 * following a raid), so a monarch who only reads the gate never loads the map. Calls made while it loads keep their
 * order and the latest `open` wins; `close` before the map is up cancels a pending open. If the map cannot be loaded,
 * listeners hear `closed` (the finder is not open after all) and `resolve` answers null; the next need tries again.
 *
 * Returns null when the build has no Atlas, so the board says the map is not available rather than waiting on one.
 * `origin` is `live` until the embed answers: the product embed is always fed by the Surveyor.
 */
export function deferGateAtlas(
  place: () => HTMLElement, signal: AbortSignal, modules: GateAtlasModules = bundled, options: DeferGateAtlasOptions = {},
): DeferredGateAtlas | null {
  if (!gateAtlasBundled(modules)) return null;
  const listeners = new Set<(event: AtlasGateEvent) => void>();
  let host: AtlasGateHost | null = null;
  let mounting: Promise<AtlasGateHost | null> | null = null;
  /** Each `open`/`close` takes a turn; only the newest open still pending may reach the map. */
  let turn = 0;

  const tell = (event: AtlasGateEvent) => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { console.error('A gate map listener failed', error); }
    }
  };

  function ready(): Promise<AtlasGateHost | null> {
    if (host) return Promise.resolve(host);
    if (signal.aborted) return Promise.resolve(null);
    mounting ??= mountGateAtlas(place(), signal, modules, options.onReady).then(mounted => {
      mounting = null;
      if (mounted && !signal.aborted) {
        host = mounted;
        mounted.subscribe(tell, signal);
      }
      return host;
    });
    return mounting;
  }

  return {
    get origin() { return host?.origin ?? 'live'; },
    warm() { void ready(); },
    open(from, openSignal) {
      if (signal.aborted || openSignal.aborted) return;
      const mine = ++turn;
      void ready().then(mounted => {
        if (mine !== turn || openSignal.aborted) return;
        if (mounted) mounted.open(from, openSignal);
        else tell({ kind: 'closed' });
      });
    },
    close() {
      ++turn;
      host?.close();
    },
    async resolve(kingdomId, resolveSignal) {
      const mounted = await ready();
      if (!mounted || resolveSignal.aborted) return null;
      return mounted.resolve(kingdomId, resolveSignal);
    },
    subscribe(listener, listenSignal) {
      if (listenSignal.aborted) return;
      listeners.add(listener);
      listenSignal.addEventListener('abort', () => listeners.delete(listener), { once: true });
    },
    follow(raid, followSignal) {
      if (followSignal.aborted) return;
      void ready().then(mounted => { if (mounted && !followSignal.aborted) mounted.follow(raid, followSignal); });
    },
    travel(stage, travelSignal) {
      if (travelSignal.aborted) return;
      void ready().then(mounted => { if (mounted && !travelSignal.aborted) mounted.travel?.(stage, travelSignal); });
    },
  };
}
