import { grandSketchRecipe } from '../../../../packages/world/src/grand/sketch';
import { fetchCard } from '../atlas/data/directory';
import { HoldingError, readDoorHolding, type DoorHolding } from '../atlas/data/holding';
import { loadPreview } from '../atlas/data/load';
import type { PreviewSource } from '../atlas/data/preview';
import { detectGrandTier, GRAND_TIERS, GrandEngine, type GrandTier } from './engine';
import { grandSeedForHolding } from './holding-world';
import type { GrandLiveState } from './live-controller';
import { sketchDrawnLand } from './sketch-land';
import { openSketchLand, resolveChannelWorld, SketchRefused, type ChannelWorld, type SketchLand, type SketchSourceState } from './sketch-source';

const SOURCE: PreviewSource = { base: '/map-data', fetch: (input, init) => fetch(input, init) };
const LANDFORMS: Record<string, string> = { island: 'An island', 'mountain-valley': 'A mountain valley', 'river-delta': 'A river delta',
  'lake-country': 'Lake country', 'cliff-coast': 'A cliff coast', highland: 'Highland' };
const WOODS: Record<string, string> = { oak: 'oak', lime: 'lime', birch: 'birch', 'autumn-gold': 'autumn gold', 'autumn-red': 'autumn red',
  pine: 'pine', spruce: 'spruce', cherry: 'cherry', teal: 'teal', willow: 'willow' };

/** A channel named in the address that has no founded grand land: its sketch is shown instead (GW13). */
export function grandSketchTarget(params: URLSearchParams): { readonly id: string } | { readonly login: string } | null {
  const kingdom = params.get('kingdom')?.trim(), channel = params.get('channel')?.trim().toLowerCase();
  if (kingdom && /^[1-9][0-9]{0,31}$/.test(kingdom)) return { id: kingdom };
  if (channel && /^[1-9][0-9]{0,31}$/.test(channel)) return { id: channel };
  if (channel && /^[a-z0-9_]{1,25}$/.test(channel)) return { login: channel };
  return null;
}

async function holdingFor(target: { readonly id: string } | { readonly login: string }, signal: AbortSignal): Promise<DoorHolding> {
  if ('id' in target) return readDoorHolding(SOURCE, null, target.id, signal);
  let id: string;
  try {
    const { world } = await loadPreview(SOURCE, null, signal);
    id = (await fetchCard(SOURCE, world.id, { login: target.login }, signal)).channel.id;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new HoldingError('missing', 'This channel is not on the Atlas yet.');
  }
  return readDoorHolding(SOURCE, null, id, signal);
}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;

/**
 * `/-/grand?channel=<login>` for a channel that has not founded its kingdom: the land its kingdom will stand on,
 * raised once by the realm from the channel's survey facts and drawn from those baked bytes. The page says what is
 * really happening (the realm raising it, its regions being cut, the bytes arriving) and nothing about people.
 */
export function createGrandSketchController(hooks: { host(): HTMLElement; onState(state: GrandLiveState): void }) {
  const params = new URLSearchParams(location.search), target = grandSketchTarget(params);
  const value = (key: string) => { const raw = params.get(key); return raw !== null && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null; };
  const hourParam = value('hour');
  let state: GrandLiveState = { phase: 'checking', title: 'login' in (target ?? {}) ? (target as { login: string }).login : 'A kingdom', biome: null,
    hour: hourParam !== null && hourParam >= 0 && hourParam <= 24 ? hourParam : 17.6, progress: null, error: null, source: null, canRetry: true,
    eyebrow: 'A land that waits for its kingdom' };
  let disposed = false, abort: AbortController | null = null, engine: GrandEngine | null = null, sketch: SketchLand | null = null, canvas: HTMLCanvasElement | null = null;
  const emit = (next: Partial<GrandLiveState>) => { if (!disposed) { state = { ...state, ...next }; hooks.onState(state); } };
  const debugWindow = window as Window & { __chatdomReady?: boolean; __chatdomGrand?: unknown };
  const onResize = () => engine?.resize();

  function stop() {
    abort?.abort(); abort = null;
    engine?.dispose(); engine = null; sketch?.dispose(); sketch = null; canvas?.remove(); canvas = null;
    window.removeEventListener('resize', onResize);
  }

  async function open(signal: AbortSignal) {
    if (!target) throw new HoldingError('missing', 'This address names no channel.');
    emit({ phase: 'loading', progress: { text: 'Reading the Atlas', fraction: 0 } });
    const holding = await holdingFor(target, signal), name = holding.name;
    emit({ title: name, progress: { text: `Asking the realm about ${name}`, fraction: 0 } });
    const proposed = grandSketchRecipe(grandSeedForHolding(holding));
    let place: ChannelWorld = await resolveChannelWorld({ proposed, signal });
    // A founded kingdom is shown as itself, never as a sketch of what it might have been.
    const founded = () => {
      stop();
      emit({ phase: 'unavailable', progress: null, eyebrow: 'A founded kingdom', heading: `${name} has founded its kingdom`, canRetry: false, biome: null, note: '',
        error: 'Its people already live there. Enter the kingdom to see their streets.', door: { href: `/kingdom/${encodeURIComponent(holding.id)}`, label: 'Enter the kingdom' } });
    };
    if (place.kind === 'founded') { founded(); return; }
    const follow = (source: SketchSourceState) => {
      if (source.kind === 'asking') emit({ progress: { text: `Asking the realm for the land of ${name}`, fraction: 0 } });
      else if (source.kind === 'raising') {
        emit({ progress: source.ahead > 0
          ? { text: `${source.ahead} ${source.ahead === 1 ? 'land is' : 'lands are'} raised before this one`, fraction: 0 }
          : source.stage === 'raising' ? { text: `The realm is raising the land of ${name} for the first time`, fraction: 0 }
            : { text: `Cutting the land into regions: ${source.done} of ${source.total}`, fraction: source.total ? source.done / source.total : 0 } });
      } else emit({ progress: { text: `Reading the land: ${megabytes(source.bytes)}${source.cacheHits ? ', some kept from your last visit' : ''}`, fraction: 0 } });
    };
    const describe = (world: ChannelWorld & { kind: 'world' }) => {
      const traits = world.recipe.seed.world;
      emit({ biome: `${LANDFORMS[traits.landform] ?? 'A land'} of ${WOODS[traits.forest[0]]} and ${WOODS[traits.forest[1]]} woods`,
        note: `Not founded yet. When ${name} founds this kingdom on stream, its town will be raised on this land.` });
    };
    describe(place);
    try { sketch = await openSketchLand({ recipe: place.recipe, pinned: place.pinned, signal, onState: follow }); }
    catch (error) {
      if (error instanceof SketchRefused && error.reason === 'founded') { founded(); return; }
      // Someone else's lookup pinned this channel's world a moment ago: open that one, which every visitor sees.
      if (!(error instanceof SketchRefused) || error.reason !== 'pinned' || place.pinned) throw error;
      place = await resolveChannelWorld({ proposed, signal });
      if (place.kind !== 'world' || !place.pinned) throw error;
      describe(place);
      sketch = await openSketchLand({ recipe: place.recipe, pinned: place.pinned, signal, onState: follow });
    }
    if (signal.aborted) return;
    const seed = sketch.record.recipe.seed;
    const requested = params.get('tier'), capture = params.get('capture') === '1';
    const tier: GrandTier = requested && requested in GRAND_TIERS ? requested as GrandTier : detectGrandTier(document.createElement('canvas'));
    canvas = document.createElement('canvas');
    hooks.host().append(canvas);
    const time = value('t');
    engine = new GrandEngine(canvas, seed, { tier, capture, hour: state.hour, view: 'orbit', time: time ?? (tier === 'software' ? 0 : null), citizens: null });
    const drawn = engine;
    drawn.onFailure = message => { if (!disposed && drawn === engine) { stop(); emit({ phase: 'unavailable', progress: null, error: `The land could not be drawn: ${message}` }); } };
    let last = 0;
    drawn.onChange = () => {
      const now = performance.now();
      if (state.phase === 'ready' || now - last < 250) return;
      last = now;
      const shown = Math.round(drawn.stats.progress * drawn.stats.regions);
      emit({ progress: { text: `The land comes into view: ${shown} of ${drawn.stats.regions} regions`, fraction: drawn.stats.progress } });
    };
    drawn.onReady = () => { if (drawn === engine) { emit({ phase: 'ready', progress: null }); debugWindow.__chatdomReady = true; } };
    window.addEventListener('resize', onResize);
    await drawn.startBaked(sketchDrawnLand(sketch));
    const yaw = value('yaw'), pitch = value('pitch'), dist = value('dist');
    if (yaw !== null || pitch !== null || dist !== null) drawn.orbit(yaw, pitch, dist);
  }

  function run() {
    stop();
    const controller = new AbortController();
    abort = controller;
    debugWindow.__chatdomReady = false;
    void open(controller.signal).catch((error: unknown) => {
      if (disposed || controller.signal.aborted) return;
      stop();
      const message = error instanceof HoldingError ? (error.reason === 'unavailable' ? 'The Atlas could not be read just now. Please try again.' : 'This channel is not on the Atlas yet. Find another kingdom on the map.')
        : error instanceof SketchRefused && error.reason === 'busy' ? 'Many lands are being raised just now. Please try again in a little while.'
          : 'This land cannot be raised just now. Please try again later, or find another kingdom on the Atlas.';
      emit({ phase: 'unavailable', progress: null, error: message, canRetry: !(error instanceof HoldingError && error.reason !== 'unavailable') });
    });
  }

  const debug = { stats: () => engine ? { ...engine.stats, sketch: sketch ? { recipeHash: sketch.record.recipeHash, landform: sketch.record.recipe.seed.world.landform, ...sketch.stats } : null } : null,
    setHour, setView: (view: Parameters<GrandEngine['setView']>[0]) => engine?.setView(view), orbit: (yaw: number | null, pitch: number | null, distance: number | null) => engine?.orbit(yaw, pitch, distance) };
  function setHour(hour: number) { if (!disposed && Number.isFinite(hour) && hour >= 0 && hour <= 24) { emit({ hour }); engine?.setHour(hour); } }
  return {
    start() { debugWindow.__chatdomGrand = debug; run(); },
    setHour,
    resetView() { engine?.setView('orbit'); },
    orbit: debug.orbit,
    retry() { if (state.phase === 'unavailable') run(); },
    dispose() { if (disposed) return; disposed = true; stop(); if (debugWindow.__chatdomGrand === debug) { delete debugWindow.__chatdomGrand; debugWindow.__chatdomReady = false; } },
  };
}
