import { naturalTerrainHeight } from '../settlement/terrain';
import { expandBounds, pointBounds, segmentProjection, smoothstep, SpatialIndex } from '../settlement/geometry';
import type { BoundsXZ, LandformPlan, LegacyLandformPlan } from '../settlement/types';
import type { KingdomLandform, LandHill, LandStream, LandWaterSample, WaterBody } from './types';

/**
 * One analytic land surface for version 2. Rendering, the terrain worker, ground contact and the water
 * mask all read these functions, so the visible shore is the physical shore. Version 1 keeps its own
 * sampler in settlement/terrain.ts, untouched; the water queries below read its existing shoreline.
 */

/** Wet-edge envelope beyond a water body's rim in which the sampler shapes a soft shore. */
const BODY_APRON = { lake: 30, pond: 14 } as const;
const BODY_SHORE_SLOPE = { lake: .11, pond: .22 } as const;
/** Gradient of a natural stream bank, and the fall of a raised leat/pond bank on low ground. */
const CHANNEL_BANK_SLOPE = .42;
const LEVEE_FALL = .5;
/** Steepest fall from a shaped bank back to the land it cuts into or stands above: 1 m per metre. */
const BANK_LIMIT = 1;
const RIM = .3;
const LEGACY_ENVELOPE = 8;

interface PreparedBody { body: WaterBody; apron: number; slope: number; shelf: number; phases: readonly [number, number, number]; bounds: BoundsXZ }
interface ChannelSegment { stream: LandStream; index: number; first: boolean; last: boolean }
interface Prepared {
  hills: readonly { hill: LandHill; phases: readonly [number, number] }[];
  bodies: readonly PreparedBody[];
  channels: SpatialIndex<ChannelSegment>;
}
interface Feature { id: string; distance: number; surface: number; bed: number; envelope: number;
  shore: number; levee: boolean }

const prepared = new WeakMap<KingdomLandform, Prepared>();

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const phaseOf = (seed: number, text: string): number => (hashText(`${seed}:${text}`) % 6283) / 1000;
const finite = (...values: number[]): boolean => values.every(Number.isFinite);

function validate(landform: KingdomLandform): void {
  if (!finite(landform.seed)) throw new Error('Land needs a finite seed');
  const ids = new Set<string>();
  const unique = (id: string) => { if (!id || ids.has(id)) throw new Error(`Land feature ${id || '(unnamed)'} needs a unique id`); ids.add(id); };
  for (const hill of landform.hills) {
    unique(hill.id);
    if (!finite(...hill.centre, hill.height, hill.radius, hill.plateau) || hill.plateau < 0 || hill.radius <= hill.plateau)
      throw new Error(`Hill ${hill.id} needs finite values and a radius beyond its plateau`);
  }
  for (const body of landform.waters) {
    unique(body.id);
    if (!finite(body.x, body.z, body.level, body.radiusX, body.radiusZ, body.depth) || body.radiusX <= 0 || body.radiusZ <= 0 || body.depth <= 0)
      throw new Error(`Water ${body.id} needs finite values, positive radii and depth`);
  }
  for (const stream of landform.streams) {
    unique(stream.id);
    if (stream.points.length < 2 || !finite(stream.bank) || stream.bank <= 0) throw new Error(`Stream ${stream.id} needs two points and a positive bank`);
    stream.points.forEach((point, i) => {
      if (!finite(...point.position, point.bed, point.level, point.width) || point.width <= 0 || point.bed >= point.level)
        throw new Error(`Stream ${stream.id} point ${i} needs a finite surface above its bed and a positive width`);
      const previous = stream.points[i - 1];
      if (previous && point.level > previous.level) throw new Error(`Stream ${stream.id} flows uphill at point ${i}`);
      if (previous && Math.hypot(point.position[0] - previous.position[0], point.position[1] - previous.position[1]) < 1e-6)
        throw new Error(`Stream ${stream.id} repeats point ${i}`);
    });
  }
}

function prepare(landform: KingdomLandform): Prepared {
  const cached = prepared.get(landform);
  if (cached) return cached;
  validate(landform);
  const hills = landform.hills.map(hill => ({ hill, phases: [phaseOf(landform.seed, `${hill.id}:a`), phaseOf(landform.seed, `${hill.id}:b`)] as const }));
  const bodies = [...landform.waters].sort((a, b) => a.id.localeCompare(b.id)).map(body => {
    const lake = body.id === 'lake' || Math.min(body.radiusX, body.radiusZ) > 20;
    const apron = lake ? BODY_APRON.lake : BODY_APRON.pond, reach = Math.max(body.radiusX, body.radiusZ) * 1.25 + apron;
    return { body, apron, slope: lake ? BODY_SHORE_SLOPE.lake : BODY_SHORE_SLOPE.pond, shelf: Math.max(3, Math.min(body.radiusX, body.radiusZ) * .45),
      phases: [phaseOf(landform.seed, `${body.id}:3`), phaseOf(landform.seed, `${body.id}:5`), phaseOf(landform.seed, `${body.id}:7`)] as const,
      bounds: { minX: body.x - reach, maxX: body.x + reach, minZ: body.z - reach, maxZ: body.z + reach } };
  });
  const channels = new SpatialIndex<ChannelSegment>(16);
  for (const stream of [...landform.streams].sort((a, b) => a.id.localeCompare(b.id))) {
    for (let i = 1; i < stream.points.length; i++) {
      const a = stream.points[i - 1]!, b = stream.points[i]!;
      const reach = Math.max(a.width, b.width) / 2 + stream.bank;
      channels.add(expandBounds(pointBounds([a.position, b.position]), reach), { stream, index: i, first: i === 1, last: i === stream.points.length - 1 });
    }
  }
  const value = { hills, bodies, channels };
  prepared.set(landform, value);
  return value;
}

/** The shared ridge and gentle swell of version 1, without its castle mound or lake carve. */
function baseHeight(landform: KingdomLandform, x: number, z: number): number {
  const { ridge } = landform, phase = (landform.seed % 6283) / 1000;
  const dx = x - ridge.origin[0], dz = z - ridge.origin[1], c = Math.cos(ridge.bearing), s = Math.sin(ridge.bearing);
  const across = dx * c - dz * s - 5 * Math.sin(z * .021 + phase), along = dx * s + dz * c;
  return 1.2 + ridge.height * Math.exp(-((across / ridge.width) ** 2) - (along / ridge.length) ** 2)
    + .85 * Math.sin(x * .033 + landform.seed % 1000) * Math.cos(z * .027) + .35 * Math.sin((x + z) * .073);
}

/** 1 across the plateau, easing to 0 at a gently lobed foot. */
function hillWeight(hill: LandHill, phases: readonly [number, number], x: number, z: number): number {
  const dx = x - hill.centre[0], dz = z - hill.centre[1], distance = Math.hypot(dx, dz);
  if (distance <= hill.plateau) return 1;
  const angle = Math.atan2(dz, dx), lobes = 1 + .1 * Math.sin(angle * 2 + phases[0]) + .06 * Math.sin(angle * 3 + phases[1]);
  const foot = hill.plateau + (hill.radius - hill.plateau) * lobes;
  if (distance >= foot) return 0;
  const u = (distance - hill.plateau) / (foot - hill.plateau);
  return (1 - u) * (1 - u) * (1 + 2 * u);
}

/** Land before water: ridge, swell and level-topped rises/terraces in authored order. */
export function landBeforeWater(landform: KingdomLandform, x: number, z: number): number {
  const { hills } = prepare(landform);
  let h = baseHeight(landform, x, z);
  for (const { hill, phases } of hills) {
    const weight = hillWeight(hill, phases, x, z);
    if (weight > 0) h += (hill.height - h) * weight;
  }
  return h;
}

function bodyFeature(entry: PreparedBody, x: number, z: number): Feature | undefined {
  const { body, phases } = entry;
  if (x < entry.bounds.minX || x > entry.bounds.maxX || z < entry.bounds.minZ || z > entry.bounds.maxZ) return undefined;
  const dx = x - body.x, dz = z - body.z, length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz / body.radiusZ, dx / body.radiusX);
  const ux = length ? dx / length : 1, uz = length ? dz / length : 0;
  const shore = 1 + .1 * Math.sin(angle * 3 + phases[0]) + .05 * Math.cos(angle * 5 - phases[1]) + .03 * Math.sin(angle * 7 + phases[2]);
  const rim = shore / Math.hypot(ux / body.radiusX, uz / body.radiusZ), distance = length - rim;
  if (distance >= entry.apron) return undefined;
  const inside = Math.min(1, Math.max(0, -distance) / entry.shelf);
  const bed = body.level - body.depth * (1 - (1 - inside) ** 2);
  return { id: body.id, distance, surface: body.level, bed, envelope: entry.apron, shore: entry.slope, levee: true };
}

function channelFeatures(landform: KingdomLandform, x: number, z: number): Feature[] {
  const nearest = new Map<LandStream, Feature>();
  for (const segment of prepare(landform).channels.at(x, z)) {
    const { stream, index } = segment, a = stream.points[index - 1]!, b = stream.points[index]!;
    const ax = a.position[0], az = a.position[1], bx = b.position[0], bz = b.position[1];
    const length = Math.hypot(bx - ax, bz - az), raw = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (length * length);
    const t = Math.max(0, Math.min(1, raw)), lateral = segmentProjection(a.position, b.position, x, z).distance;
    const width = a.width + (b.width - a.width) * t, level = a.level + (b.level - a.level) * t;
    const deepest = a.bed + (b.bed - a.bed) * t;
    let distance = lateral - width / 2;
    // A course begins at a spring, weir or wheel and ends inside its receiving water: both ends are cut square.
    if (segment.first && raw < 0) distance = Math.max(Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / length - width / 2, -raw * length);
    if (segment.last && raw > 1) distance = Math.max(Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / length - width / 2, (raw - 1) * length);
    if (distance >= stream.bank) continue;
    const inside = Math.min(1, Math.max(0, -distance) / (width / 2));
    const feature = { id: stream.id, distance, surface: level, bed: level - (level - deepest) * (1 - (1 - inside) ** 2),
      envelope: stream.bank, shore: CHANNEL_BANK_SLOPE, levee: true };
    const previous = nearest.get(stream);
    if (!previous || distance < previous.distance) nearest.set(stream, feature);
  }
  return [...nearest.values()];
}

function features(landform: KingdomLandform, x: number, z: number): Feature[] {
  const found: Feature[] = [];
  for (const entry of prepare(landform).bodies) { const feature = bodyFeature(entry, x, z); if (feature) found.push(feature); }
  found.push(...channelFeatures(landform, x, z));
  return found;
}

/** Most-inside water first; equal distances fall back to the id, never to the higher level. */
function nearestFeature(found: readonly Feature[]): Feature | undefined {
  let best: Feature | undefined;
  for (const feature of found) if (!best || feature.distance < best.distance - 1e-9
    || (Math.abs(feature.distance - best.distance) <= 1e-9 && feature.id < best.id)) best = feature;
  return best;
}

/**
 * Natural version 2 ground: land, then soft shores, carved beds and the raised banks that hold a leat
 * or pond above lower ground. The wet edge meets each surface exactly, so no water sheet floats or rims.
 */
export function naturalLandHeight(landform: KingdomLandform, x: number, z: number): number {
  if (!finite(x, z)) throw new Error('Land needs finite coordinates');
  const natural = landBeforeWater(landform, x, z);
  let h = natural, wet = Infinity;
  for (const feature of features(landform, x, z)) {
    const s = feature.distance;
    if (s < 0) { wet = Math.min(wet, feature.bed); continue; }
    // The authored bank holds out to its near edge; beyond it the shaped ground may only return to the land
    // at BANK_LIMIT, so a deep cut or a raised leat never leaves a cliff the terrain skin cannot follow.
    const near = feature.envelope * .55, beyond = Math.max(0, s - near), held = Math.min(s, near);
    const lip = feature.surface + RIM * smoothstep(0, 1.4, s);
    const cap = lip + feature.shore * held + BANK_LIMIT * beyond;
    let shaped = Math.min(h, cap);
    if (feature.levee) shaped = Math.max(shaped, lip - LEVEE_FALL * Math.max(0, held - 1.6) - BANK_LIMIT * beyond);
    const fade = smoothstep(near, feature.envelope, s);
    h = shaped + (h - shaped) * fade;
  }
  // Under water the ground is the course's own bed: a channel perched on lower land keeps its floor.
  return wet < Infinity ? wet : h;
}

/** Version 1's own irregular lake edge: where its existing carve crosses the level along each ray. */
function legacySample(landform: LegacyLandformPlan, x: number, z: number): LandWaterSample | null {
  const { lake } = landform, nx = (x - lake.x) / lake.radiusX, nz = (z - lake.z) / lake.radiusZ, q = Math.hypot(nx, nz);
  if (q > 1.6) return null;
  const at = (scale: number) => naturalTerrainHeight(landform, lake.x + (x - lake.x) * scale, lake.z + (z - lake.z) * scale);
  if (q < 1e-9) { const bed = naturalTerrainHeight(landform, x, z); return { id: 'lake', surface: lake.level, bed, shoreDistance: -Math.min(lake.radiusX, lake.radiusZ) * .76 }; }
  // .7 is always fully carved and 1.3 never is; bisect the crossing on this point's own ray.
  let low = .7, high = 1.3;
  for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (at(mid / q) < lake.level) low = mid; else high = mid; }
  const edge = (low + high) / 2, length = Math.hypot(x - lake.x, z - lake.z), shoreDistance = length - length * edge / q;
  if (shoreDistance >= LEGACY_ENVELOPE) return null;
  const ground = naturalTerrainHeight(landform, x, z);
  return { id: 'lake', surface: lake.level, bed: Math.min(lake.level, ground), shoreDistance };
}

function requireFinite(x: number, z: number): void { if (!finite(x, z)) throw new Error('Water queries need finite coordinates'); }

/** Nearest water or bank envelope at a point; null beyond every envelope. */
export function sampleLandWater(landform: LandformPlan, x: number, z: number): LandWaterSample | null {
  requireFinite(x, z);
  if (landform.version === 1) return legacySample(landform, x, z);
  const best = nearestFeature(features(landform, x, z));
  return best ? { id: best.id, surface: best.surface, bed: Math.min(best.bed, best.surface), shoreDistance: best.distance } : null;
}

/** Surface level inside wet ground only; banks and dry land return null. */
export function waterSurfaceAt(landform: LandformPlan, x: number, z: number): number | null {
  requireFinite(x, z);
  if (landform.version === 1) { const sample = legacySample(landform, x, z); return sample && sample.shoreDistance < 0 ? sample.surface : null; }
  const best = nearestFeature(features(landform, x, z).filter(feature => feature.distance < 0));
  return best ? best.surface : null;
}

/** True within `margin` metres of any body or channel's wet edge, including beyond the bank envelope. */
export function waterKeepOut(landform: LandformPlan, x: number, z: number, margin: number): boolean {
  requireFinite(x, z);
  if (!Number.isFinite(margin) || margin < 0) throw new Error('Water keep-out margin must be finite and nonnegative');
  if (landform.version === 1) {
    const { lake } = landform, reach = Math.max(lake.radiusX, lake.radiusZ) * 1.3 + margin;
    if (Math.hypot(x - lake.x, z - lake.z) > reach) return false;
    const sample = legacySample(landform, x, z);
    if (sample) return sample.shoreDistance < margin;
    // Beyond the sampled envelope, measure along the same ray from its existing rim.
    const nx = (x - lake.x) / lake.radiusX, nz = (z - lake.z) / lake.radiusZ, q = Math.hypot(nx, nz), length = Math.hypot(x - lake.x, z - lake.z);
    return length - length * 1.3 / q < margin;
  }
  const { bodies } = prepare(landform);
  for (const entry of bodies) {
    const { body } = entry, dx = x - body.x, dz = z - body.z, length = Math.hypot(dx, dz);
    if (length - Math.max(body.radiusX, body.radiusZ) * 1.2 >= margin) continue;
    const angle = Math.atan2(dz / body.radiusZ, dx / body.radiusX), ux = length ? dx / length : 1, uz = length ? dz / length : 0;
    const shore = 1 + .1 * Math.sin(angle * 3 + entry.phases[0]) + .05 * Math.cos(angle * 5 - entry.phases[1]) + .03 * Math.sin(angle * 7 + entry.phases[2]);
    if (length - shore / Math.hypot(ux / body.radiusX, uz / body.radiusZ) < margin) return true;
  }
  for (const stream of landform.streams) for (let i = 1; i < stream.points.length; i++) {
    const a = stream.points[i - 1]!, b = stream.points[i]!, p = segmentProjection(a.position, b.position, x, z);
    if (p.distance - Math.max(a.width, b.width) / 2 >= margin) continue;
    const ax = a.position[0], az = a.position[1], bx = b.position[0], bz = b.position[1], length = Math.hypot(bx - ax, bz - az);
    const raw = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (length * length), width = a.width + (b.width - a.width) * p.t;
    let distance = p.distance - width / 2;
    const lateral = Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / length - width / 2;
    if (i === 1 && raw < 0) distance = Math.max(lateral, -raw * length);
    if (i === stream.points.length - 1 && raw > 1) distance = Math.max(lateral, (raw - 1) * length);
    if (distance < margin) return true;
  }
  return false;
}
