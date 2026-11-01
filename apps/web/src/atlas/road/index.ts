import { geographyOf, SettlerStore, type Settler } from '../data/model';
import { fetchChunk, fetchNames, fetchPointer, fetchWorld, type PreviewSource, type PreviewWorld } from '../data/preview';
import { MapView, type MapStats } from '../map/view';
import { caravanCount, columnTail } from './caravan';
import { planRoad, rideSeconds, type RoadPath } from './geometry';
import { RoadLayer } from './layer';
import { NEAR_SCALE, roadShot } from './shot';

export { caravanCount, columnTail, MARCHER_SPACING_PX } from './caravan';
export { planRoad, rideSeconds, roadSeed, sampleRoad, type RoadPath } from './geometry';
export { NEAR_SCALE, pullBack, roadShot, smoothstep } from './shot';

/**
 * The Atlas side of a raid's journey (spec 23 `AtlasGateHost`, Atlas.md §7.5–7.6): the real survey's map with the
 * road between two real holdings and the raid's torch column on it, driven frame by frame by the journey's director.
 * It reads the same survey preview, names projection and visibility rules as the Atlas page: a holding the names
 * projection withholds, or one not on the survey, cannot be ridden to here and the journey says so.
 */

export const ROAD_SOURCE: PreviewSource = { base: '/map-data', fetch: (input, init) => fetch(input, init) };

export interface RoadHolding {
  id: string;
  /** The name the survey serves for this holding now; `null` while it serves none (the caller names it). */
  name: string | null;
  login: string | null;
  x: number;
  y: number;
  tier: Settler['tier'];
  realmName: string;
  region: number;
}

export class RoadAtlasError extends Error {
  constructor(readonly reason: 'unavailable' | 'missing' | 'withheld', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RoadAtlasError';
  }
}

export interface RoadFrame {
  /** 0…1 the rise out of the source kingdom; 1 once riding. */
  rise: number;
  /** 0…1 the banner-bearer's way along the road; at 1 it stands at the destination. */
  travel: number;
  /** 0…1 the rest of the column filing in through the destination's gate. */
  file: number;
  /** 0…1 the destination's drawing waking. */
  wake: number;
  /** Presentation seconds, for the walk and the torches. */
  time: number;
  /** Whether the column is out on the road. */
  marching: boolean;
}

export interface RoadAtlas {
  readonly from: RoadHolding;
  readonly to: RoadHolding;
  readonly path: RoadPath;
  /** The public caravan's ride, by distance (12–30 s). */
  readonly rideSeconds: number;
  /** When the survey behind this map was observed (the map says so). */
  readonly surveyedAt: number;
  /** Resolves once the first view is completely drawn. */
  readonly ready: Promise<void>;
  show(frame: RoadFrame): void;
  /** The banner-bearer's and both ends' screen positions in the last frame drawn. */
  marks(): { head: { x: number; y: number; visible: boolean }; from: { x: number; y: number }; to: { x: number; y: number } };
  /** Whether every tile the current camera needs is drawn (captures wait for it). */
  settled(): boolean;
  stats(): MapStats;
  dispose(): void;
}

/**
 * The road's end at a channel, or why there is none. A channel off this survey has no holding; a withheld holding is
 * bare land and no road may name it. A holding whose name the survey is not serving just now (names are served only
 * while fresh) is still there: the road is drawn to it, unnamed on the map, and the caller names it.
 */
export function roadHolding(settler: Settler | null, which: 'raiding' | 'raided'): RoadHolding {
  if (!settler) throw new RoadAtlasError('missing', `The ${which} channel has no holding on this survey of the Atlas.`);
  if (settler.withheld) throw new RoadAtlasError('withheld', `The ${which} channel is not shown on the Atlas.`);
  return { id: settler.id, name: settler.name, login: settler.login, x: settler.x, y: settler.y, tier: settler.tier, realmName: settler.realmName, region: settler.region };
}

/** Read the holding for a channel: the cities in the world file, then each land's towns and villages in turn. */
async function findHolding(store: SettlerStore, world: PreviewWorld, source: PreviewSource, id: string, signal: AbortSignal): Promise<Settler | null> {
  const known = store.byId.get(id);
  if (known) return known;
  const order = [...world.regions].sort((a, b) => b.members - a.members || a.index - b.index);
  for (const region of order) {
    if (store.hasRegion(region.index)) continue;
    store.addChunk(await fetchChunk(source, world, region.index, signal));
    const found = store.byId.get(id);
    if (found) return found;
  }
  return null;
}

export async function openRoadAtlas(host: HTMLElement, options: {
  from: string; to: string; viewers: number; signal: AbortSignal; source?: PreviewSource; reduceMotion?: () => boolean;
}): Promise<RoadAtlas> {
  const source = options.source ?? ROAD_SOURCE;
  const { signal } = options;
  let world: PreviewWorld;
  try {
    const pointer = await fetchPointer(source, signal);
    world = await fetchWorld(source, pointer, signal);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new RoadAtlasError('unavailable', 'The Atlas could not be read just now, so the road cannot be drawn.', { cause: error });
  }
  const store = new SettlerStore(world);
  store.applyNames(await fetchNames(source, world, signal));
  const from = roadHolding(await findHolding(store, world, source, options.from, signal), 'raiding');
  const to = roadHolding(await findHolding(store, world, source, options.to, signal), 'raided');
  const geo = geographyOf(world);
  const path = planRoad(from, to, `${from.id}>${to.id}`, from.region !== to.region);
  const span = Math.hypot(geo.bounds.maxX - geo.bounds.minX, geo.bounds.maxY - geo.bounds.minY);
  const count = caravanCount(options.viewers);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const layer = new RoadLayer(path, { sourceId: from.id, count }, pixelRatio);
  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const view = await MapView.create(host, {
    world, geo, store,
    loadChunk: async region => store.addChunk(await fetchChunk(source, world, region, signal)),
  }, {
    ready: resolveReady, select: () => undefined, selectDab: () => undefined, camera: () => undefined,
    chunkFailed: () => undefined, tilesFailed: () => undefined, context: () => undefined,
  }, undefined, roadShot(path, { rise: 0, travel: 0, wake: 0 }, { width: host.clientWidth || 1, height: host.clientHeight || 1 }));
  view.attachLayer(layer);
  if (signal.aborted) { view.dispose(); throw signal.reason; }
  const tail = columnTail(path, count, NEAR_SCALE);
  let shown = '';
  return {
    from, to, path, ready, surveyedAt: world.asOf,
    rideSeconds: rideSeconds(path, span),
    show(frame) {
      // The clock only moves the drawing while the column marches; a hidden or resting map is not redrawn.
      const time = frame.marching && !options.reduceMotion?.() ? frame.time : 0;
      const key = `${frame.rise}|${frame.travel}|${frame.file}|${frame.wake}|${frame.marching}|${time}`;
      if (key === shown) return;
      shown = key;
      const viewport = view.viewport();
      view.setCamera(roadShot(path, frame, viewport));
      // The head runs on past the destination while the column files in, so the last torch goes through too.
      const head = frame.travel + frame.file * tail;
      layer.set({ head, inked: Math.min(1, head), time, marching: frame.marching, opacity: 1 });
    },
    marks: () => ({ head: layer.head, from: layer.ends.from, to: layer.ends.to }),
    settled: () => {
      const stats = view.stats();
      return stats.tiles.uncovered === 0 && stats.tiles.fading === 0;
    },
    stats: () => view.stats(),
    dispose: () => view.dispose(),
  };
}
