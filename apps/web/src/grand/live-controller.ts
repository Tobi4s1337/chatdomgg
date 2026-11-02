import { createRealmSpectatorSource } from '../kingdom-entry/spectator';
import { createSceneMount } from '../stream/mount';
import { createDockConnection } from '../stream/dock-connection';
import { grandLiveSelection } from './live-source';
import type { OpeningJournal } from '../kingdom/grand-land/opening/journal';

export interface GrandLiveState {
  readonly phase: 'checking' | 'loading' | 'ready' | 'unavailable' | 'hidden';
  readonly title: string;
  readonly biome: string | null;
  readonly hour: number;
  readonly progress: { readonly text: string; readonly fraction: number } | null;
  readonly error: string | null;
  readonly source: string | null;
  readonly canRetry: boolean;
  /** The heading's small line above the name (a founded kingdom's is the default). */
  readonly eyebrow?: string;
  /** One sentence under the heading, such as what an unfounded land is waiting for. */
  readonly note?: string;
  /** The panel's heading when the view will not open here, and where to go instead (a founded kingdom's door). */
  readonly heading?: string;
  readonly door?: { readonly href: string; readonly label: string };
}
const unavailable = 'The kingdom could not be reached. Try again, or find another kingdom on the Atlas.';

/** The public grand view is the native kingdom host with a free overview lens. Its verified watch owns every
 * placement, light and live event; its pinned recipe owns the land. No local founding or presence fallback. */
export function createGrandLiveController(hooks: { host(): HTMLElement; onState(state: GrandLiveState): void; onOpening?(journal: OpeningJournal): void }) {
  const params = new URLSearchParams(location.search), selected = grandLiveSelection(params);
  let disposed = false, started = false, firstView = true;
  let state: GrandLiveState = { phase: 'checking', title: 'Your kingdom', biome: null, hour: selected?.hour ?? 17.5,
    progress: null, error: null, source: null, canRetry: !!selected };
  const emit = (next: Partial<GrandLiveState>) => { if (!disposed) { state = { ...state, ...next }; hooks.onState(state); } };
  const watch = selected ? createRealmSpectatorSource({ kingdomId: selected.kingdomId }) : undefined;
  const dock = selected ? createDockConnection(selected.kingdomId, { readOnly: true }) : undefined;
  const mount = createSceneMount({
    host: hooks.host,
    settings: () => ({ mode: 'watching', overview: true, source: 'herald', tier: 'town', seed: selected?.kingdomId ?? '',
      camera: 'hero', hour: state.hour, time: null, directArrivals: false }),
    prepare: async (signal, revision, lost) => {
      if (!selected || !watch) throw new Error('This kingdom has no adopted grand land');
      const connection = await watch(signal, revision, lost);
      if (signal.aborted || disposed || connection.manifest.origin !== 'live' || connection.scene.origin !== 'live'
        || connection.manifest.kingdomId !== selected.kingdomId || connection.scene.kingdomId !== selected.kingdomId) {
        connection.dispose();
        throw new Error('The adopted kingdom could not be confirmed');
      }
      const plan = connection.scene.plan;
      return { settings: { founded: connection.scene, foundedReceipt: connection.manifest, kingdomId: selected.kingdomId, realmName: connection.kingdomName,
        tier: plan.config.tier, seed: plan.config.seed, firstYear: plan.config.firstYear, year: plan.config.year,
        presenceOrigin: 'live' as const, presenceFeed: connection.presenceFeed, growthFeed: connection.growthFeed,
        growthCeremonies: connection.growthCeremonies, forgeFeed: connection.forgeFeed, momentFeed: connection.momentFeed,
        walkerFeed: connection.walkerFeed, ...(dock ? { dockFeed: dock } : {}) }, chatFeed: connection.chatFeed,
      activate: () => { connection.activate(); emit({ title: connection.kingdomName, biome: selected.recipe.seed.biome }); },
      dispose: connection.dispose };
    },
    onPhase: phase => {
      if (disposed) return;
      debugWindow.__chatdomReady = phase === 'ready';
      if (phase === 'ready') emit({ phase: 'ready', progress: null, error: null });
      else if (phase === 'failed') emit({ phase: 'unavailable', error: unavailable, progress: null, source: null });
      else emit({ phase: phase === 'hidden' ? 'hidden' : 'loading', error: null, progress: null, source: null });
    },
    ...(hooks.onOpening ? { onOpening: hooks.onOpening } : {}),
    onProgress: (text, fraction) => emit({ phase: 'loading', progress: { text, fraction }, error: null }),
    onSource: source => emit({ source }),
    onNames: () => {},
    onScene: scene => {
      if (!scene || !firstView) return;
      firstView = false;
      const value = (key: string) => { const raw = params.get(key); return raw !== null && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null; };
      // yaw and pitch are degrees in the URL, as on /-/grand-bench and the story page's hero; the lens takes radians.
      const degrees = (v: number | null) => v === null ? null : v * Math.PI / 180;
      scene.overview?.orbit(degrees(value('yaw')), degrees(value('pitch')), value('dist'));
    },
  });
  const debug = { stats: () => ({ ...mount.scene?.debug, phase: state.phase, land: mount.scene?.inspect().land ?? null }),
    inspect: () => mount.scene?.inspect() ?? null, overview: () => mount.scene?.overview?.inspect() ?? null,
    setHour, resetView: () => mount.scene?.overview?.reset(), orbit: (yaw: number | null, pitch: number | null, distance: number | null) => mount.scene?.overview?.orbit(yaw, pitch, distance) };
  const debugWindow = window as Window & { __chatdomReady?: boolean; __chatdomGrand?: typeof debug };
  function setHour(hour: number) {
    if (disposed || !Number.isFinite(hour) || hour < 0 || hour > 24) return;
    emit({ hour }); mount.scene?.setHour(hour);
  }
  const visibility = () => {
    if (disposed || !started || !selected) return;
    if (document.hidden) mount.unmount('hidden'); else mount.mount();
  };
  function start() {
    if (disposed || started) return;
    started = true; debugWindow.__chatdomReady = false; debugWindow.__chatdomGrand = debug;
    if (!selected) { emit({ phase: 'unavailable', error: 'This kingdom’s grand land is not open yet. Find an open kingdom on the Atlas.' }); return; }
    document.addEventListener('visibilitychange', visibility);
    emit({ phase: 'checking' }); visibility();
  }
  return { start, setHour, resetView: debug.resetView, orbit: debug.orbit,
    retry() { if (disposed || !selected || state.phase === 'ready' || state.phase === 'loading') return; firstView = true; mount.unmount('hidden'); visibility(); },
    dispose() {
      if (disposed) return;
      disposed = true; document.removeEventListener('visibilitychange', visibility); mount.unmount('hidden'); dock?.dispose();
      if (debugWindow.__chatdomGrand === debug) { delete debugWindow.__chatdomGrand; debugWindow.__chatdomReady = false; }
    },
  };
}
