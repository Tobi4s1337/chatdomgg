import { hashString } from './rng';
import type { DayParts } from './weather';
import type {
  GenesisBiome, GenesisLandmark, GenesisRecipe, GenesisWeather, LandscapeCharacter, Vec3, XZ,
} from './types';

/**
 * What a chosen land holds for the ear, read from the recipe: the physical land (sea, river, ridges, pass, forest)
 * from the explicitly selected landscape, the living chorus from `soul.soundscape`, the landmark from the identity.
 * Pure data. Positions are kingdom metres.
 */
export type Habitat = 'sea' | 'shore' | 'river' | 'forest' | 'open' | 'ridge' | 'town' | 'harbour' | 'offshore' | 'pass' | 'landmark' | 'sky';

/** Every one-shot sound the land can make. Calls are creatures; the rest are places and weather. */
export type CallKey =
  | 'gull' | 'oystercatcher' | 'curlew' | 'skylark' | 'blackbird' | 'wren' | 'woodpigeon' | 'woodpecker' | 'owl'
  | 'raven' | 'chough' | 'buzzard' | 'frog'
  | 'rigging' | 'hull' | 'mooring' | 'buoy' | 'slap' | 'plop' | 'wheel' | 'chimes' | 'flag' | 'scree' | 'drip'
  | 'thunder' | 'branch' | 'stones';

export interface CallPool {
  key: CallKey;
  habitat: Habitat;
  /** Calls per minute at full activity with the habitat at hand. */
  rate: number;
  /** Seconds per decision slot: at most one call per slot, so a pool can never burst. */
  slot: number;
  /** Metres at which the call has fallen 6 dB: how far it carries. */
  carry: number;
  /** Height above the ground or water it calls from, metres. */
  lift: readonly [number, number];
  /** 0..1 activity for the time and the weather. */
  activity(day: DayParts, weather: GenesisWeather): number;
  /** In the stream profile, how much of this pool is kept (talkative calls thin out under a voice). */
  stream: number;
}

export interface StreamCourse { points: readonly { position: XZ; level: number; width: number }[] }
export interface Hill { id: string; centre: XZ; radius: number; height: number }

export interface SoundScene {
  /** Kingdom + land seed; every seeded event mixes it. */
  seed: number;
  weatherSeedKey: string;
  landscapeId: string;
  character: LandscapeCharacter;
  biome: GenesisBiome;
  landmark: GenesisLandmark;
  /** The ear when the host gives none: the plaza at head height. */
  defaultEar: Vec3;
  shoreline: readonly XZ[];
  /** Unit vector from shore towards open sea. */
  seaward: XZ;
  islands: readonly { centre: XZ; radius: number }[];
  streams: readonly StreamCourse[];
  waters: readonly { centre: XZ; radius: number }[];
  forest: readonly XZ[];
  clearing: XZ;
  saddle: Vec3;
  passWidth: number;
  hills: readonly Hill[];
  /** Built ground: the settlement reserve. */
  town: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the town meets the sea: the shore point nearest the reserve. */
  harbour: XZ;
  /** Where the bell buoy rides: offshore of the harbour, short of the islands. */
  buoy: XZ;
  /** Where the river is loudest near town: the steepest reach, or a weir. */
  weir: XZ;
  /**
   * Sound intent for the landmark until the landmark consumer places it: lighthouse and watchtower on the shore
   * or the castle hill, watermill at the weir, bell garden and stage by the plaza, stone circle in the clearing.
   */
  landmarkAt: XZ;
  /** How much each element leads in this land (1 = as heard). */
  emphasis: { sea: number; river: number; wind: number; whistle: number; echo: number; harbour: number };
  pools: readonly CallPool[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const calm = (w: GenesisWeather) => (1 - w.rain * 0.75) * (1 - w.snow * 0.9) * (1 - w.storm) * (1 - Math.max(0, w.wind - 0.55) * 1.4);

/** Songbirds sing at dawn, less by day, again at dusk; they go quiet in rain, snow, gales and fog. */
const songbird = (dawn: number, day: number, dusk: number, night = 0) => (d: DayParts, w: GenesisWeather) =>
  clamp01((d.day * day + d.dawn * dawn + d.dusk * dusk + d.night * night) * calm(w) * (1 - w.fog * 0.5));

function biomeChorus(biome: GenesisBiome): CallPool[] {
  const pools: CallPool[] = [];
  const add = (pool: CallPool) => pools.push(pool);
  const warmNight = (d: DayParts, w: GenesisWeather) => clamp01(d.night * calm(w));
  if (biome === 'meadow' || biome === 'highland') {
    add({ key: 'skylark', habitat: 'open', rate: 0.9, slot: 9, carry: 60, lift: [25, 60], activity: songbird(0.9, 1, 0.2), stream: 0.6 });
  }
  if (biome === 'meadow' || biome === 'woodland') {
    add({ key: 'blackbird', habitat: 'forest', rate: biome === 'woodland' ? 3 : 2.2, slot: 5, carry: 45, lift: [3, 12], activity: songbird(1.6, 0.45, 1.5), stream: 0.6 });
    add({ key: 'woodpigeon', habitat: 'forest', rate: 1.1, slot: 8, carry: 30, lift: [4, 14], activity: songbird(0.8, 1, 0.5), stream: 0.5 });
    add({ key: 'owl', habitat: 'forest', rate: 1.3, slot: 9, carry: 70, lift: [5, 14], activity: (d, w) => warmNight(d, w) * (1 - w.fog * 0.3), stream: 0.7 });
  }
  if (biome === 'woodland') {
    add({ key: 'wren', habitat: 'forest', rate: 1.8, slot: 6, carry: 25, lift: [0.5, 4], activity: songbird(1.4, 0.9, 0.7), stream: 0.4 });
    add({ key: 'woodpecker', habitat: 'forest', rate: 0.8, slot: 9, carry: 50, lift: [4, 14], activity: songbird(0.6, 1, 0.3), stream: 0.6 });
  }
  if (biome === 'coastal') {
    add({ key: 'oystercatcher', habitat: 'shore', rate: 2.4, slot: 6, carry: 55, lift: [0.3, 12], activity: songbird(1, 0.8, 1, 0.15), stream: 0.4 });
    add({ key: 'curlew', habitat: 'shore', rate: 1.2, slot: 9, carry: 90, lift: [1, 20], activity: songbird(1.4, 0.5, 1.3, 0.2), stream: 0.6 });
    add({ key: 'chough', habitat: 'ridge', rate: 0.9, slot: 9, carry: 60, lift: [10, 40], activity: songbird(0.6, 1, 0.5), stream: 0.6 });
  }
  if (biome === 'highland') {
    add({ key: 'curlew', habitat: 'open', rate: 1.1, slot: 9, carry: 90, lift: [1, 20], activity: songbird(1.4, 0.5, 1.3, 0.1), stream: 0.6 });
    add({ key: 'raven', habitat: 'ridge', rate: 1.2, slot: 8, carry: 80, lift: [15, 60], activity: songbird(0.8, 1, 0.7), stream: 0.7 });
    add({ key: 'owl', habitat: 'forest', rate: 0.8, slot: 11, carry: 70, lift: [5, 14], activity: (d, w) => warmNight(d, w), stream: 0.7 });
  }
  return pools;
}

/** Creatures and things that belong to the physical land, whatever the chorus. */
function landPools(character: LandscapeCharacter, landmark: GenesisLandmark): CallPool[] {
  const harbour = character === 'coastal-harbour';
  const pools: CallPool[] = [
    { key: 'gull', habitat: 'sea', rate: harbour ? 6 : 3.5, slot: 3, carry: 70, lift: [4, 30], activity: (d, w) =>
      clamp01((d.day + d.dawn * 0.3 + d.night * 0.04) * (1 - w.storm * 0.75) * (1 - w.fog * 0.45) * (1 - w.rain * 0.4) * (1 - w.snow * 0.8)), stream: 0.5 },
    { key: 'frog', habitat: 'river', rate: character === 'river-valley' ? 5 : 2.2, slot: 2.5, carry: 22, lift: [0, 0.2], activity: (d, w) =>
      clamp01((d.dusk * 1.3 + d.night) * (1 - w.snow) * (1 - w.storm * 0.6) * (1 - Math.max(0, w.wind - 0.6))), stream: 0.4 },
    { key: 'plop', habitat: 'river', rate: 1.6, slot: 6, carry: 14, lift: [0, 0], activity: (d, w) => clamp01((0.4 + d.day * 0.6 + d.dusk) * (1 - w.snow)), stream: 0.6 },
    { key: 'branch', habitat: 'forest', rate: 2, slot: 5, carry: 20, lift: [3, 10], activity: (_d, w) => clamp01((w.wind - 0.3) * 1.6), stream: 0.5 },
    { key: 'drip', habitat: 'town', rate: 26, slot: 0.8, carry: 6, lift: [2, 5], activity: (_d, w) => clamp01(w.wet * (1 - w.rain * 0.4)), stream: 0.4 },
    { key: 'thunder', habitat: 'sky', rate: 2.4, slot: 14, carry: 2500, lift: [800, 1500], activity: (_d, w) => clamp01((w.storm - 0.25) * 1.6), stream: 0.8 },
    { key: 'buzzard', habitat: 'ridge', rate: character === 'mountain-pass' ? 0.9 : 0.35, slot: 13, carry: 150, lift: [40, 120], activity: songbird(0.3, 1, 0.4), stream: 0.7 },
    { key: 'raven', habitat: 'ridge', rate: character === 'mountain-pass' ? 0.6 : 0.2, slot: 13, carry: 80, lift: [15, 60], activity: songbird(0.8, 1, 0.7), stream: 0.7 },
    { key: 'buoy', habitat: 'offshore', rate: harbour ? 3.5 : 1.6, slot: 4, carry: 160, lift: [0.5, 0.5], activity: (_d, w) => clamp01(0.3 + w.wind * 0.7 + w.storm * 0.5 + w.fog * 0.6), stream: 0.7 },
  ];
  if (harbour) {
    pools.push(
      { key: 'rigging', habitat: 'harbour', rate: 7, slot: 2, carry: 18, lift: [3, 7], activity: (_d, w) => clamp01(0.15 + w.wind * 1.1), stream: 0.4 },
      { key: 'hull', habitat: 'harbour', rate: 4, slot: 3, carry: 16, lift: [0, 0.3], activity: (_d, w) => clamp01(0.35 + w.wind * 0.8 + w.storm * 0.5), stream: 0.5 },
      { key: 'mooring', habitat: 'harbour', rate: 2.2, slot: 6, carry: 12, lift: [0.5, 1.5], activity: (_d, w) => clamp01(0.25 + w.wind), stream: 0.4 },
      { key: 'slap', habitat: 'harbour', rate: 7, slot: 1.6, carry: 14, lift: [0, 0], activity: (_d, w) => clamp01(0.4 + w.wind * 0.7 + w.storm * 0.4), stream: 0.4 },
    );
  }
  if (character === 'mountain-pass') {
    pools.push({ key: 'scree', habitat: 'ridge', rate: 1.1, slot: 11, carry: 60, lift: [10, 50], activity: (_d, w) => clamp01(0.4 + w.rain * 0.8 + w.storm * 0.5), stream: 0.6 });
    pools.push({ key: 'stones', habitat: 'pass', rate: 1.6, slot: 7, carry: 30, lift: [0, 2], activity: (_d, w) => clamp01(0.3 + w.wind * 0.8), stream: 0.5 });
  }
  if (landmark === 'bell-garden') pools.push({ key: 'chimes', habitat: 'landmark', rate: 9, slot: 1.4, carry: 24, lift: [2, 3], activity: (_d, w) => clamp01(0.1 + w.wind * 1.2), stream: 0.4 });
  if (landmark === 'watchtower' || landmark === 'lighthouse' || landmark === 'open-air-stage') {
    pools.push({ key: 'flag', habitat: 'landmark', rate: 3.5, slot: 4, carry: 26, lift: [8, 16], activity: (_d, w) => clamp01((w.wind - 0.15) * 1.4), stream: 0.5 });
  }
  if (landmark === 'watermill') pools.push({ key: 'wheel', habitat: 'landmark', rate: 60 / 1.35, slot: 1.35, carry: 22, lift: [0, 1], activity: (_d, w) => 1 - w.snow * 0.3, stream: 0.7 });
  return pools;
}

const EMPHASIS: Readonly<Record<LandscapeCharacter, SoundScene['emphasis']>> = {
  'coastal-harbour': { sea: 1, river: 0.75, wind: 0.85, whistle: 0.5, echo: 0.15, harbour: 1 },
  'river-valley': { sea: 0.8, river: 1.15, wind: 0.7, whistle: 0.35, echo: 0.35, harbour: 0 },
  'mountain-pass': { sea: 0.75, river: 0.95, wind: 1.15, whistle: 1, echo: 1, harbour: 0 },
};

const SEAWARD: Readonly<Record<0 | 1 | 2 | 3, XZ>> = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };

/**
 * Reads the selected land. Throws when `landscapeId` is not one of the recipe's three candidates: the
 * recommendation is never assumed to be the selection.
 */
export function describeGenesisSoundscape(recipe: GenesisRecipe, landscapeId: string): SoundScene {
  const land = recipe.landscapes.find(candidate => candidate.id === landscapeId);
  if (!land) throw new RangeError(`genesis sound: ${landscapeId} is not one of this recipe's landscapes`);
  const plaza = land.places.find(place => place.purpose === 'plaza')?.anchor ?? centreOf(land.settlementReserve);
  const hills: Hill[] = land.terrainCore.hills.map(hill => ({ id: hill.id, centre: [hill.centre[0], hill.centre[1]], radius: hill.radius, height: hill.height }));
  const ground = groundAt(hills, plaza);
  const shoreline = land.coast.shoreline.map(point => [point[0], point[1]] as XZ);
  const seaward = SEAWARD[land.coast.oceanToward];
  const town = { ...land.settlementReserve };
  const reserveCentre = centreOf(town);
  const harbour = nearestOnPolyline(shoreline, reserveCentre).point;
  const islands = land.islands.map(island => ({ centre: [island.centre[0], island.centre[1]] as XZ, radius: Math.max(island.radiusX, island.radiusZ) }));
  const nearestIsland = islands.reduce<{ centre: XZ; radius: number } | null>((best, island) =>
    !best || dist(island.centre, harbour) < dist(best.centre, harbour) ? island : best, null);
  const buoy: XZ = nearestIsland
    ? lerpXZ(harbour, nearestIsland.centre, 0.55)
    : [harbour[0] + seaward[0] * 90, harbour[1] + seaward[1] * 90];
  const streams = land.terrainCore.streams.map(stream => ({
    points: stream.points.map(point => ({ position: [point.position[0], point.position[1]] as XZ, level: point.level, width: point.width })),
  }));
  const weir = steepestNear(streams, reserveCentre) ?? harbour;
  const castle = land.places.find(place => place.purpose === 'castle')?.anchor ?? plaza;
  const landmark = recipe.identity.landmark;
  const landmarkAt: XZ = landmark === 'watermill' ? weir
    : landmark === 'lighthouse' ? harbour
    : landmark === 'watchtower' ? [castle[0], castle[1]]
    : landmark === 'stone-circle' ? [land.forest.clearing[0], land.forest.clearing[1]]
    : [plaza[0], plaza[1]];
  const biome = recipe.soul.soundscape;
  return {
    seed: hashString(`${recipe.seedKey}|${land.id}|sound`),
    weatherSeedKey: recipe.soul.weatherSeedKey,
    landscapeId: land.id,
    character: land.character,
    biome,
    landmark,
    defaultEar: [plaza[0], ground + 1.6, plaza[1]],
    shoreline,
    seaward,
    islands,
    streams,
    waters: land.terrainCore.waters.map(water => ({ centre: [water.x, water.z] as XZ, radius: Math.max(water.radiusX, water.radiusZ) })),
    forest: land.forest.boundary.map(point => [point[0], point[1]] as XZ),
    clearing: [land.forest.clearing[0], land.forest.clearing[1]],
    saddle: [land.mountainPass.saddle[0], land.mountainPass.saddle[1], land.mountainPass.saddle[2]],
    passWidth: land.mountainPass.width,
    hills,
    town,
    harbour,
    buoy,
    weir,
    landmarkAt,
    emphasis: EMPHASIS[land.character],
    pools: mergePools([...landPools(land.character, landmark), ...biomeChorus(biome)]),
  };
}

/** One pool per call: when the chorus and the land both bring a species, the livelier habitat wins. */
function mergePools(pools: CallPool[]): CallPool[] {
  const byKey = new Map<CallKey, CallPool>();
  for (const pool of pools) {
    const existing = byKey.get(pool.key);
    if (!existing || pool.rate > existing.rate) byKey.set(pool.key, pool);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------

export function dist(a: XZ, b: XZ): number { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
export function lerpXZ(a: XZ, b: XZ, t: number): XZ { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function centreOf(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): XZ {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
}

/** Ground height from the land's hills (plateau then a smooth foot); sea level 0. Good enough for an ear. */
export function groundAt(hills: readonly Hill[], at: XZ): number {
  let height = 0;
  for (const hill of hills) {
    const d = dist(hill.centre, at), t = clamp01(1 - d / hill.radius);
    height = Math.max(height, hill.height * t * t * (3 - 2 * t));
  }
  return height;
}

/** Nearest point on a polyline, with its arc position (metres from the first point). */
export function nearestOnPolyline(points: readonly XZ[], at: XZ): { point: XZ; distance: number; arc: number; length: number } {
  let best = { point: points[0] ?? at, distance: points[0] ? dist(points[0], at) : Infinity, arc: 0 };
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const t = length > 0 ? clamp01(((at[0] - a[0]) * dx + (at[1] - a[1]) * dz) / (length * length)) : 0;
    const point: XZ = [a[0] + dx * t, a[1] + dz * t], d = dist(point, at);
    if (d < best.distance) best = { point, distance: d, arc: walked + length * t };
    walked += length;
  }
  return { ...best, length: walked };
}

/** The point at `arc` metres along a polyline, clamped to its ends. */
export function pointAlong(points: readonly XZ[], arc: number): XZ {
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!, length = dist(a, b);
    if (walked + length >= arc) return lerpXZ(a, b, length > 0 ? clamp01((arc - walked) / length) : 0);
    walked += length;
  }
  return points[points.length - 1] ?? [0, 0];
}

/** The steepest reach of any stream within 260 m of `near`, by fall per metre; the loudest water near town. */
function steepestNear(streams: readonly StreamCourse[], near: XZ): XZ | null {
  let best: { at: XZ; score: number } | null = null;
  for (const stream of streams) {
    for (let i = 0; i + 1 < stream.points.length; i++) {
      const a = stream.points[i]!, b = stream.points[i + 1]!;
      const mid = lerpXZ(a.position, b.position, 0.5), length = Math.max(1, dist(a.position, b.position));
      const fall = (a.level - b.level) / length, d = dist(mid, near);
      const score = fall * 100 + 1 / (1 + d / 120) - (d > 260 ? 10 : 0);
      if (!best || score > best.score) best = { at: mid, score };
    }
  }
  return best?.at ?? null;
}

export function insidePolygon(polygon: readonly XZ[], at: XZ): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a[1] > at[1]) !== (b[1] > at[1]) && at[0] < ((b[0] - a[0]) * (at[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Distance to a closed polygon's edge; 0 inside. */
export function distanceToPolygon(polygon: readonly XZ[], at: XZ): number {
  if (polygon.length < 3) return Infinity;
  if (insidePolygon(polygon, at)) return 0;
  return nearestOnPolyline([...polygon, polygon[0]!], at).distance;
}
