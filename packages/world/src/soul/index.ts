/** A deterministic, read-only picture of the kingdom between streams. */
export type SoulBiome = 'coastal' | 'woodland' | 'meadow' | 'highland';
export type SoulSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type SoulRole = 'baker' | 'lamplighter' | 'smith' | 'harbour-master';
export type SoulPoint = readonly [number, number, number];
export interface SoulTopology {
  /** Navigable, connected polylines. A keeper walks out and back on its route. */
  routes: Partial<Record<SoulRole, readonly SoulPoint[]>>;
  lamps: readonly { position: SoulPoint; routeProgress: number }[];
  harbour?: boolean;
}
export interface SoulConfig {
  seed: number;
  biome: SoulBiome;
  /** Number of actually present viewers, never the number of homes. */
  population: number;
  utcOffsetMinutes?: number;
  topology?: SoulTopology;
  /** Epoch milliseconds of arrivals the kingdom actually witnessed. */
  shipArrivals?: readonly number[];
}
export interface SoulKeeper {
  id: SoulRole;
  role: SoulRole;
  label: string;
  activity: string;
  position: SoulPoint;
  heading: number;
  moving: boolean;
  visible: boolean;
  progress: number;
  carrying?: string;
  light: false;
}
export interface SoulFrame {
  epochMs: number;
  hour: number;
  season: SoulSeason;
  weather: { rain: number; snow: number; fog: number; wind: number; wetness: number; snowCover: number; cloud: number; temperature: number };
  daylight: number;
  night: number;
  keepers: SoulKeeper[];
  lamps: { position: SoulPoint; lit: boolean }[];
  chimneySmoke: number;
  breadCart: { position: SoulPoint; visible: boolean };
  shipBell: boolean;
}

/** A small, authored street for standalone use. Production callers supply their own navigable routes. */
export const DEFAULT_SOUL_TOPOLOGY: SoulTopology = {
  routes: {
    baker: [[-8, 0, -2], [-8, 0, 0], [0, 0, 0], [6, 0, 0]],
    lamplighter: [[-8, 0, 0], [0, 0, 0], [6, 0, 0], [6, 0, 6]],
    smith: [[2, 0, -3], [2, 0, 0], [6, 0, 0]],
    'harbour-master': [[6, 0, 6], [6, 0, 0], [11, 0, 0]],
  },
  lamps: [
    { position: [-5, 0, 0], routeProgress: 3 / 20 },
    { position: [1, 0, 0], routeProgress: 9 / 20 },
    { position: [6, 0, 2], routeProgress: 16 / 20 },
  ],
  harbour: true,
};

export const SOUL_DUSK_HOUR = 18.75;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function random(seed: number, n: number, salt: number): number {
  let x = (seed | 0) ^ Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
function noise(seed: number, time: number, period: number, salt: number): number {
  const p = time / period;
  const n = Math.floor(p);
  return mix(random(seed, n, salt), random(seed, n + 1, salt), smooth(p - n));
}
function atmosphere(config: SoulConfig, t: number) {
  const local = t + (config.utcOffsetMinutes ?? 0) * 60_000;
  const date = new Date(local);
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const yearLength = Date.UTC(year + 1, 0, 1) - start;
  const yearPhase = (local - start) / yearLength;
  const hour = ((local % DAY) + DAY) % DAY / HOUR;
  const biomeTemp = { coastal: 1, woodland: 0, meadow: 1, highland: -5 }[config.biome];
  const temperature = 10 + biomeTemp + 11 * Math.cos(2 * Math.PI * (yearPhase - .55)) + 3 * Math.cos(2 * Math.PI * (hour - 15) / 24) + (noise(config.seed, t, 36 * HOUR, 2) - .5) * 5;
  const cloud = smooth((noise(config.seed, t, 12 * HOUR, 1) - .17) / .68);
  const precipitation = smooth((cloud - .48) / .4) * .8;
  const freezing = smooth((2 - temperature) / 4);
  const rain = precipitation * (1 - freezing);
  const snow = precipitation * freezing;
  const wind = .12 + .7 * noise(config.seed, t, 8 * HOUR, 3);
  const dawn = Math.exp(-Math.pow((hour - 6) / 2.8, 2));
  const fog = clamp(dawn * (config.biome === 'coastal' ? .65 : .42) * (1 - wind * .55) + cloud * .08);
  return { temperature, cloud, rain, snow, wind, fog };
}
function accumulated(config: SoulConfig, t: number): { wetness: number; snowCover: number } {
  // A finite, exponentially fading history makes offline and live sampling identical.
  // Samples slide with t, so the result has no tick or midnight discontinuity.
  let wet = 0; let snow = 0;
  for (let i = 0; i < 120; i++) {
    const w = atmosphere(config, t - (i + .5) * HOUR);
    wet += (w.rain + w.snow * .12) * Math.exp(-i / 12) / 12;
    snow += w.snow * Math.exp(-i / 36) / 36;
  }
  const now = atmosphere(config, t);
  return { wetness: clamp(wet), snowCover: clamp(snow * smooth((5 - now.temperature) / 8) * 1.5) };
}
function pathAt(path: readonly SoulPoint[], progress: number): { position: SoulPoint; heading: number } {
  if (path.length === 0) return { position: [0, 0, 0], heading: 0 };
  if (path.length === 1) return { position: path[0]!, heading: 0 };
  const lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1], p[2] - path[i]![2]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = clamp(progress) * total;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length || i === lengths.length - 1) {
      const a = path[i]!; const b = path[i + 1]!; const f = length ? Math.min(1, remaining / length) : 0;
      return { position: [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)], heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
    }
    remaining -= length;
  }
  return { position: path[0]!, heading: 0 };
}
const WALK_SPEED = .55; // metres per second
const STOP_SECONDS = 3;
function routeLengths(route: readonly SoulPoint[]): number[] {
  return route.slice(1).map((p, i) => Math.hypot(p[0] - route[i]![0], p[1] - route[i]![1], p[2] - route[i]![2]));
}
/** Seconds after departure at which the outward walker reaches this distance fraction. */
function arrivalSeconds(route: readonly SoulPoint[], progress: number): number {
  const lengths = routeLengths(route);
  const target = lengths.reduce((a, b) => a + b, 0) * clamp(progress);
  let distance = 0; let stops = 0;
  for (let i = 0; i < lengths.length - 1; i++) {
    distance += lengths[i]!;
    if (distance < target) stops++;
  }
  return target / WALK_SPEED + stops * STOP_SECONDS;
}
function tripAt(route: readonly SoulPoint[], elapsed: number): { progress: number; moving: boolean; returning: boolean; active: boolean } {
  const lengths = routeLengths(route);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0 || elapsed < 0) return { progress: 0, moving: false, returning: false, active: false };
  let t = elapsed; let distance = 0;
  for (let pass = 0; pass < 2; pass++) {
    const ordered = pass === 0 ? lengths : [...lengths].reverse();
    for (let i = 0; i < ordered.length; i++) {
      const duration = ordered[i]! / WALK_SPEED;
      if (t < duration) {
        const d = distance + (pass === 0 ? 1 : -1) * t * WALK_SPEED;
        return { progress: d / total, moving: duration > 0, returning: pass === 1, active: true };
      }
      t -= duration;
      distance += (pass === 0 ? 1 : -1) * ordered[i]!;
      if (t < STOP_SECONDS) return { progress: distance / total, moving: false, returning: pass === 1, active: true };
      t -= STOP_SECONDS;
    }
  }
  return { progress: 0, moving: false, returning: false, active: false };
}
function keeper(role: SoulRole, route: readonly SoulPoint[], hour: number, bell: boolean, population: number): SoulKeeper {
  const seconds = hour * 3600;
  const routeDuration = 2 * (routeLengths(route).reduce((a, b) => a + b, 0) / WALK_SPEED + routeLengths(route).length * STOP_SECONDS);
  // A cycle always contains a complete return, even for a long supplied route.
  const cycle = Math.max(900, Math.ceil(routeDuration / 900) * 900);
  let departure = -1;
  let work = 'keeping their place';
  let carrying: string | undefined;
  if (role === 'baker' && seconds >= 6 * 3600 && seconds < 11 * 3600 + routeDuration) {
    const n = Math.min(Math.floor((seconds - 6 * 3600) / cycle), Math.ceil(5 * 3600 / cycle) - 1);
    const candidate = 6 * 3600 + n * cycle;
    if (candidate < 11 * 3600) departure = candidate;
    work = 'delivering bread'; carrying = 'bread';
  } else if (role === 'lamplighter') {
    if (seconds >= 15 * 3600 && seconds < 16 * 3600 + routeDuration) {
      const n = Math.min(Math.floor((seconds - 15 * 3600) / cycle), Math.ceil(3600 / cycle) - 1);
      const candidate = 15 * 3600 + n * cycle;
      if (candidate < 16 * 3600) departure = candidate;
      work = 'trimming lamps'; carrying = 'lantern';
    }
    if (seconds >= SOUL_DUSK_HOUR * 3600) { departure = SOUL_DUSK_HOUR * 3600; work = 'lighting lamps'; carrying = 'lantern'; }
  }
  const trip = departure < 0 ? { progress: 0, moving: false, returning: false, active: false } : tripAt(route, seconds - departure);
  const pose = pathAt(route, trip.progress);
  const label: Record<SoulRole, string> = { baker: 'Baker', lamplighter: 'Lamplighter', smith: 'Smith', 'harbour-master': 'Harbour master' };
  // The first route point is an authored open forge or quay for these roles.
  const onDuty = role === 'smith' ? hour >= 8 && hour < 17 : role === 'harbour-master' ? (hour >= 8 && hour < 18) || bell : false;
  const visible = population < 12 && (trip.active || onDuty);
  const activity = role === 'harbour-master' && bell ? 'ringing the arrival bell' : trip.active ? work : role === 'baker' && hour >= 4 && hour < 6 ? 'baking' : role === 'smith' && onDuty ? 'working at the forge' : role === 'harbour-master' && onDuty ? 'keeping the quay' : 'keeping their place';
  return { id: role, role, label: label[role], activity, position: pose.position, heading: trip.returning ? pose.heading + Math.PI : pose.heading, moving: visible && trip.moving && !(role === 'harbour-master' && bell), visible, progress: trip.progress, ...(trip.active && carrying ? { carrying } : {}), light: false };
}
function validate(config: SoulConfig): void {
  if (!Number.isFinite(config.population) || config.population < 0) throw new RangeError('Soul population must be finite and non-negative');
  const topology = config.topology ?? DEFAULT_SOUL_TOPOLOGY;
  for (const route of Object.values(topology.routes)) {
    for (const point of route ?? []) {
      if (point.length !== 3 || !point.every(Number.isFinite)) throw new RangeError('Soul route points must have three finite coordinates');
    }
    if (route && route.length > 101) throw new RangeError('Soul routes may have at most 100 segments');
    if (route && routeLengths(route).reduce((a, b) => a + b, 0) > 1000) throw new RangeError('Soul routes may be at most 1000 metres long');
  }
  if (config.shipArrivals?.some(t => !Number.isFinite(t) || Math.abs(t) > 8_640_000_000_000_000)) throw new RangeError('Soul arrival timestamps must be valid epoch milliseconds');
  for (const lamp of topology.lamps) {
    if (lamp.position.length !== 3 || !lamp.position.every(Number.isFinite) || !Number.isFinite(lamp.routeProgress) || lamp.routeProgress < 0 || lamp.routeProgress > 1) throw new RangeError('Soul lamp position and progress must be finite and progress in [0, 1]');
  }
}
export function soulAt(config: SoulConfig, epochMs: number): SoulFrame {
  return soulAtWithWeather(config, epochMs);
}
function soulAtWithWeather(config: SoulConfig, epochMs: number, cachedWeather?: SoulFrame['weather']): SoulFrame {
  if (!Number.isFinite(epochMs) || !Number.isFinite(config.seed) || !Number.isFinite(config.utcOffsetMinutes ?? 0)) throw new RangeError('Soul time, seed and UTC offset must be finite');
  validate(config);
  const local = epochMs + (config.utcOffsetMinutes ?? 0) * 60_000;
  const date = new Date(local);
  const history = new Date(epochMs - 120 * HOUR + (config.utcOffsetMinutes ?? 0) * 60_000);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(history.getTime()) || date.getUTCFullYear() > 9998 || history.getUTCFullYear() < 1900) throw new RangeError('Soul time and five-day weather history must be within years 1900–9998');
  const hour = ((local % DAY) + DAY) % DAY / HOUR;
  const month = date.getUTCMonth();
  // Northern-hemisphere calendar dates of the equinoxes and solstices.
  const day = date.getUTCDate();
  const season: SoulSeason = month < 2 || (month === 2 && day < 20) || (month === 11 && day >= 21) ? 'winter' : month < 5 || (month === 5 && day < 21) ? 'spring' : month < 8 || (month === 8 && day < 22) ? 'summer' : 'autumn';
  const daylight = smooth((hour - 5) / 2) * (1 - smooth((hour - 18) / 2));
  const topology = config.topology ?? DEFAULT_SOUL_TOPOLOGY;
  const hasHarbour = !!topology.harbour && (config.topology !== undefined || config.biome === 'coastal');
  const bell = hasHarbour && (config.shipArrivals ?? []).some(t => epochMs >= t && epochMs < t + 12_000);
  const roles: SoulRole[] = ['baker', 'lamplighter', 'smith', ...(hasHarbour ? ['harbour-master' as const] : [])];
  const keepers = roles.flatMap(role => { const route = topology.routes[role]; return route?.length ? [keeper(role, route, hour, bell, config.population)] : []; });
  const lampRoute = topology.routes.lamplighter;
  const lamps = topology.lamps.map(l => ({ position: l.position, lit: !!lampRoute?.length && routeLengths(lampRoute).some(length => length > 0) && (hour >= SOUL_DUSK_HOUR ? (hour - SOUL_DUSK_HOUR) * 3600 >= arrivalSeconds(lampRoute, l.routeProgress) : hour < 5) }));
  const baker = keepers.find(k => k.role === 'baker');
  const weather = cachedWeather ?? { ...atmosphere(config, epochMs), ...accumulated(config, epochMs) };
  return { epochMs, hour, season, weather, daylight, night: 1 - daylight, keepers, lamps, chimneySmoke: baker ? smooth((hour - 3.5) / .5) * (1 - smooth((hour - 7) / 1)) : 0, breadCart: { position: baker?.position ?? [0, 0, 0], visible: !!baker?.visible && baker.activity === 'delivering bread' }, shipBell: bell };
}

/** For animation loops: interpolate minute weather samples while motion remains frame-accurate. */
export function createSoulSampler(config: SoulConfig): (epochMs: number) => SoulFrame {
  let minute = NaN;
  let start: SoulFrame['weather'] | undefined;
  let end: SoulFrame['weather'] | undefined;
  return epochMs => {
    const currentMinute = Math.floor(epochMs / 60_000);
    if (currentMinute !== minute || !start || !end) {
      start = currentMinute === minute + 1 && end ? end : soulAt(config, currentMinute * 60_000).weather;
      const endTime = (currentMinute + 1) * 60_000;
      end = { ...atmosphere(config, endTime), ...accumulated(config, endTime) };
      minute = currentMinute;
    }
    const fraction = (epochMs - currentMinute * 60_000) / 60_000;
    const weather = Object.fromEntries(
      (Object.keys(start) as (keyof SoulFrame['weather'])[]).map(key => [key, mix(start![key], end![key], fraction)]),
    ) as SoulFrame['weather'];
    return soulAtWithWeather(config, epochMs, weather);
  };
}
