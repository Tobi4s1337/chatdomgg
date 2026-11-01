/** Every view the place bench will frame (spec 30); each place owns its prefix. */
export const PLACES = ['court', 'lookout', 'forest'] as const;
export type Place = typeof PLACES[number];
export const VIEWS = ['court-town', 'court-arrive', 'court-lean', 'hill-far', 'hill-summit', 'hill-telescope', 'forest-meadow', 'forest-oak', 'forest-gap'] as const;
export type View = typeof VIEWS[number];
/** Views whose pieces exist. The others fail visibly rather than framing a stand-in. */
export const BUILT_VIEWS: readonly View[] = ['court-arrive', 'court-town'];
export const TIERS = ['hamlet', 'town'] as const;
export type Tier = typeof TIERS[number];

export interface BenchState {
  place: Place;
  view: View;
  hour: number;
  /** Seconds into the SIMULATED evening: drives presence and every seekable motion. */
  time: number;
  /** SIMULATED neighbours at home (true) or an empty town with every window dark (false). */
  occupied: boolean;
  /** Lookout only: the bounded cairn stone count main supplies. */
  stones: number | null;
  /** Telescope only: the supplied window index to settle on. */
  target: number | null;
  tier: Tier;
}

const placeOf = (view: View): Place => view.startsWith('court') ? 'court' : view.startsWith('hill') ? 'lookout' : 'forest';
const KNOWN = ['place', 'view', 'hour', 'time', 'occupied', 'stones', 'target', 'tier'] as const;

/** Every bench input is finite and named; anything else is refused instead of quietly defaulted. */
export function parseBench(search: string): BenchState {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) if (!(KNOWN as readonly string[]).includes(key)) throw new Error(`Unknown bench input "${key}". Use ${KNOWN.join(', ')}.`);
  for (const key of KNOWN) if (params.getAll(key).length > 1) throw new Error(`Give ${key} once.`);
  const rawView = params.get('view') ?? 'court-arrive';
  if (!(VIEWS as readonly string[]).includes(rawView)) throw new Error(`Unknown view "${rawView}". Choose ${VIEWS.join(', ')}.`);
  const view = rawView as View;
  if (!BUILT_VIEWS.includes(view)) throw new Error(`The ${view} view has no finished pieces yet. Choose ${BUILT_VIEWS.join(', ')}.`);
  const rawPlace = params.get('place') ?? placeOf(view);
  if (!(PLACES as readonly string[]).includes(rawPlace)) throw new Error(`Unknown place "${rawPlace}". Choose ${PLACES.join(', ')}.`);
  if (rawPlace !== placeOf(view)) throw new Error(`The ${view} view belongs to the ${placeOf(view)}, not the ${rawPlace}.`);
  const hour = params.get('hour') ?? '18.5';
  if (!/^(?:1?\d|2[0-3])(?:\.\d{1,2})?$/.test(hour)) throw new Error(`Unknown hour "${hour}". Choose 0 to 23.99.`);
  const time = params.get('time') ?? '30';
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(time)) throw new Error(`Unknown time "${time}". Choose seconds from 0.`);
  const occupied = params.get('occupied') ?? '1';
  if (occupied !== '0' && occupied !== '1') throw new Error(`Unknown occupied "${occupied}". Choose 0 or 1.`);
  const stones = params.get('stones');
  if (stones !== null && (view.startsWith('hill') ? !/^\d{1,3}$/.test(stones) : true)) throw new Error(`stones applies to the lookout views as a whole count, not "${stones}" on ${view}.`);
  const target = params.get('target');
  if (target !== null && (view === 'hill-telescope' ? !/^\d{1,2}$/.test(target) : true)) throw new Error(`target applies to the telescope view as a window index, not "${target}" on ${view}.`);
  const tier = params.get('tier') ?? 'town';
  if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`Unknown tier "${tier}". Choose ${TIERS.join(', ')}.`);
  return { place: rawPlace as Place, view, hour: Number(hour), time: Number(time), occupied: occupied === '1',
    stones: stones === null ? null : Number(stones), target: target === null ? null : Number(target), tier: tier as Tier };
}

/** The query that reproduces a state; defaults are written out so a shot names everything it shows. */
export function benchQuery(state: BenchState): URLSearchParams {
  const query = new URLSearchParams({ place: state.place, view: state.view, hour: String(state.hour), time: String(state.time),
    occupied: state.occupied ? '1' : '0', tier: state.tier });
  if (state.stones !== null) query.set('stones', String(state.stones));
  if (state.target !== null) query.set('target', String(state.target));
  return query;
}
