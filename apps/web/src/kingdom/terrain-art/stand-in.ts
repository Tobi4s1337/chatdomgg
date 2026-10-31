import { seedHash, type PublicGroundSample, type SettlementPlan } from '@chatdom/world';

/**
 * FIXTURE STAND-IN for the picture-land candidate producer (spec 46, task PL01).
 *
 * This is an explicit, self-contained candidate height and material query so the land can be seen
 * before the real producer exists in `packages/world/src/terrain-art`. It is never authority: nothing
 * here is wired into the kingdom scene, its collision, its light field or a founded revision.
 *
 * The candidate is a corner field. `height(x, z)` interpolates integer-metre corners over the same
 * 00→11 triangles as the accepted terrain contact, so a later adopted revision can render and collide on
 * one surface. Every corner within the protection clearance of public ground, a plot, the castle or the
 * lake returns the caller's authoritative ground unchanged.
 */

export type BoundsXZ = SettlementPlan['bounds'];

/** Local classification for the fixture's draw adapter; not a shared schema. */
export type LandMaterial = 'grass' | 'heath' | 'trail' | 'paving' | 'scree' | 'rock' | 'ledge' | 'waterbed';
export const LAND_MATERIALS: readonly LandMaterial[] = ['grass', 'heath', 'trail', 'paving', 'scree', 'rock', 'ledge', 'waterbed'];

export interface LandCandidateInputs {
  /** Immutable accepted plan: read only, never copied into a second placement ledger. */
  readonly plan: SettlementPlan;
  /** Explicit sampling bounds; queries outside them are refused. */
  readonly bounds: BoundsXZ;
  /** The caller's existing authoritative ground. Sampled only at integer-metre corners. */
  readonly ground: (x: number, z: number) => number;
  /** The caller's existing public-ground query (streets, trails, squares, forecourts). */
  readonly publicGround: (x: number, z: number) => PublicGroundSample | undefined;
}

export interface LandCandidate {
  readonly bounds: BoundsXZ;
  /** Candidate height on the 1 m corner triangles (00→11 diagonal). */
  height(x: number, z: number): number;
  /** Corner height; the draw adapter and contact both read these exact Float32 values. */
  corner(ix: number, iz: number): number;
  /** One stable material per metre patch, derived from the same corners as `height`. */
  material(x: number, z: number): LandMaterial;
  /** Metres from the nearest protected footprint (negative inside it). Observable for tests. */
  protection(x: number, z: number): number;
}

/** Corners nearer than this to protected ground keep the authoritative height exactly. */
export const PROTECTION_CLEARANCE = 1.5;
/** Width over which sculpted land eases back to the authoritative grade. */
const PROTECTION_BAND = 9;
/** Height deliberately covers a whole landscape, but nothing beyond a bounded square. */
const MAX_EXTENT = 1100;
/** The inner cache keeps one Float32 per metre corner for the town's footprint (≈0.9 MB for 450×450 m). */
const CACHE_MARGIN = 48;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]; deterministic and platform independent. */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm(x: number, z: number, seed: number, octaves = 3): number {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) {
    // Rotate each octave so the field never lines up into rows.
    const rx = x * 0.8 - z * 0.6, rz = x * 0.6 + z * 0.8;
    sum += noise(rx, rz, seed + i * 977) * amplitude; total += amplitude;
    x = rx * 2.03 + 17.3; z = rz * 2.03 - 5.1; amplitude *= 0.5;
  }
  return sum / total;
}

/**
 * A sharp ledge on any height: long flat treads and a short riser. `k` is the riser's share of one step;
 * `offset` slides the riser along the slope, so a varying offset breaks the ledge's plan line.
 */
function ledge(height: number, step: number, k: number, offset: number): number {
  const t = height / step + offset, i = Math.floor(t), f = t - i;
  return (i + smoothstep(1 - k, 1, f) - offset) * step;
}

function rectangleDistance(b: BoundsXZ, x: number, z: number): number {
  const dx = Math.max(b.minX - x, x - b.maxX), dz = Math.max(b.minZ - z, z - b.maxZ);
  return dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
}

interface Ridge {
  /** Crest line z as a function of x (north is −z). */
  crest(x: number): number;
  /** Crest height above the land it rises from. */
  height(x: number): number;
  /** Metres from crest to foot on the town (south) face, and on the back slope. */
  face: number; back: number;
  /** Ledge spacing of its rock face, and the riser's share of one step (wider far away, never a one-cell tooth). */
  step: number; riser: number;
}

const gauss = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));
/** A flat-topped table between `a` and `b` with short shoulders: summits read as mesas, never domes. */
const table = (x: number, a: number, b: number, edge: number): number => smoothstep(a - edge, a + edge, x) * (1 - smoothstep(b - edge, b + edge, x));

/**
 * Three layered ridges to the north, each lower and nearer than the one behind it, with a saddle behind
 * the keep so the castle keeps the sky. Asymmetric: a steep, ledged south scarp facing the town and a
 * long back slope. Flanking highland closes the valley to the west and lifts to the east.
 */
function ridges(seed: number): Ridge[] {
  const p = (seed % 6283) / 1000;
  // Coulisses: each ridge is high toward the frame's edges and dips behind the keep (x≈0), so the castle
  // stands against the sky while the layers step up and back on either side of it.
  return [
    { crest: x => -205 + 18 * Math.sin(x * 0.011 + p) + 7 * Math.sin(x * 0.029 + 2.1),
      height: x => 28 + 6 * Math.sin(x * 0.0085 + 0.6) + 20 * table(x, -260, -110, 22) + 15 * table(x, 140, 250, 18) - 20 * gauss(x, 12, 60),
      face: 70, back: 150, step: 7, riser: 0.24 },
    { crest: x => -430 + 30 * Math.sin(x * 0.0062 + 2 + p) + 10 * Math.sin(x * 0.017),
      height: x => 84 + 12 * Math.sin(x * 0.0052 + 1.4) + 44 * table(x, 210, 430, 30) + 36 * table(x, -470, -230, 34) + 14 * table(x, 520, 700, 40) - 40 * gauss(x, 0, 120),
      face: 130, back: 230, step: 14, riser: 0.34 },
    { crest: x => -780 + 45 * Math.sin(x * 0.004 + 4 + p),
      height: x => 160 + 20 * Math.sin(x * 0.0037 + 0.3) + 90 * table(x, -620, -300, 50) + 76 * table(x, 330, 640, 46) - 40 * gauss(x, 10, 170),
      face: 210, back: 320, step: 24, riser: 0.4 },
  ];
}

function ridgeHeight(r: Ridge, x: number, z: number, seed: number): number {
  const s = z - r.crest(x) + 5 * fbm(x * 0.018, z * 0.018, seed);
  // A cuesta: a level crest that breaks at a sharp edge into a steep scarp toward the town, easing into a
  // concave talus at its foot; behind the edge a long, gentle back slope. Never a rounded dome.
  const t = Math.min(1, Math.max(0, s / r.face));
  const shape = s >= 0 ? (1 - t) ** 2.4 : Math.exp(-((Math.max(0, -s - r.face * 0.15) / r.back) ** 2));
  // Notched crest: shallow cols cut the long line into readable summits.
  const notch = 0.86 + 0.14 * Math.abs(Math.sin(x * 0.0105 + r.face));
  return Math.max(0, r.height(x)) * notch * shape;
}

/** Highland closing the valley: the west rises in broad shelves, the east lifts into a rocky knoll. */
function flanks(x: number, z: number, seed: number): number {
  const wobble = 18 * fbm(x * 0.012, z * 0.012, seed + 31);
  const west = 46 * smoothstep(-235, -420, x + wobble) * (0.65 + 0.35 * smoothstep(250, -150, z));
  const east = 34 * smoothstep(305, 460, x - wobble) * (0.55 + 0.45 * smoothstep(320, -80, z))
    + 22 * gauss(Math.hypot(x - 380, z - 40), 0, 55);
  const south = 8 * smoothstep(340, 520, z) * (0.6 + 0.4 * noise(x * 0.01, z * 0.01, seed + 7));
  return west + east + south;
}

function relief(x: number, z: number, seed: number, list: readonly Ridge[]): { height: number; step: number; riser: number } {
  let height = 0, step = 3.5, riser = 0.2, best = 0;
  for (const r of list) {
    const h = ridgeHeight(r, x, z, seed);
    // A soft maximum keeps each ridge's own silhouette in front of the one behind it.
    if (h > best) { best = h; step = r.step; riser = r.riser; }
    height = Math.max(height, h) + 0.08 * Math.min(height, h);
  }
  const f = flanks(x, z, seed);
  if (f > height) { step = 4.5; riser = 0.22; }
  return { height: Math.max(height, f) + 0.15 * Math.min(height, f), step, riser };
}

export function createLandCandidate(inputs: LandCandidateInputs): LandCandidate {
  const { plan, ground, publicGround } = inputs;
  const bounds: BoundsXZ = Object.freeze({ ...inputs.bounds });
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ
    || Math.max(-bounds.minX, bounds.maxX, -bounds.minZ, bounds.maxZ) > MAX_EXTENT) {
    throw new RangeError('Land candidate needs finite, nonempty bounds within the horizon footprint.');
  }
  const seed = seedHash(`${plan.config.seed}:picture-land`) | 0;
  const list = ridges(seed >>> 0);
  const town = plan.bounds, lake = plan.lake, castle = plan.castle.bounds;
  const lots = [...plan.reservations.map(r => r.lot), ...plan.homes.map(h => h.lot)];

  // A 16 m bucket index keeps plot distance local; the plan itself is never modified.
  const BUCKET = 16, REACH = PROTECTION_CLEARANCE + PROTECTION_BAND + 1;
  const buckets = new Map<string, BoundsXZ[]>();
  for (const lot of lots) {
    for (let bx = Math.floor((lot.minX - REACH) / BUCKET); bx <= Math.floor((lot.maxX + REACH) / BUCKET); bx++)
      for (let bz = Math.floor((lot.minZ - REACH) / BUCKET); bz <= Math.floor((lot.maxZ + REACH) / BUCKET); bz++) {
        const key = `${bx},${bz}`; const list = buckets.get(key); if (list) list.push(lot); else buckets.set(key, [lot]);
      }
  }

  const protection = (x: number, z: number): number => {
    let d = REACH + 1;
    const sample = publicGround(x, z);
    if (sample) d = Math.min(d, sample.reservedDistance);
    for (const lot of buckets.get(`${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`) ?? []) d = Math.min(d, rectangleDistance(lot, x, z));
    d = Math.min(d, rectangleDistance(castle, x, z) - 2);
    // The shore and a generous bank stay exactly as the water expects them.
    const shore = Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ);
    d = Math.min(d, (shore - 1.3) * Math.min(lake.radiusX, lake.radiusZ));
    return d;
  };

  // Bounded inner caches: authoritative ground and candidate corners over the town and a margin.
  const cx0 = Math.floor(Math.max(bounds.minX, town.minX - CACHE_MARGIN)), cz0 = Math.floor(Math.max(bounds.minZ, town.minZ - CACHE_MARGIN));
  const cw = Math.max(0, Math.ceil(Math.min(bounds.maxX, town.maxX + CACHE_MARGIN)) - cx0 + 1);
  const cd = Math.max(0, Math.ceil(Math.min(bounds.maxZ, town.maxZ + CACHE_MARGIN)) - cz0 + 1);
  const groundCache = new Float64Array(cw * cd).fill(NaN), cornerCache = new Float32Array(cw * cd).fill(NaN);
  const cacheIndex = (ix: number, iz: number): number => {
    const x = ix - cx0, z = iz - cz0;
    return x < 0 || z < 0 || x >= cw || z >= cd ? -1 : x + z * cw;
  };
  const base = (ix: number, iz: number): number => {
    const i = cacheIndex(ix, iz);
    if (i < 0) return ground(ix, iz);
    const cached = groundCache[i]!;
    if (!Number.isNaN(cached)) return cached;
    const value = ground(ix, iz); groundCache[i] = value; return value;
  };

  const sculpt = (ix: number, iz: number): number => {
    const b = base(ix, iz);
    const p = protection(ix, iz);
    if (p <= PROTECTION_CLEARANCE) return b;
    const w = smoothstep(PROTECTION_CLEARANCE, PROTECTION_CLEARANCE + PROTECTION_BAND, p);
    // Landscape relief grows outside the town footprint; inside it only the in-between ground terraces.
    const outside = rectangleDistance(town, ix, iz), r = smoothstep(-12, 150, outside);
    const lifted = relief(ix, iz, seed, list);
    const natural = b + r * lifted.height;
    // Slope of the land before ledging decides where ledges belong; quiet meadows stay quiet.
    const gx = (base(ix + 2, iz) - base(ix - 2, iz)) / 4, gz = (base(ix, iz + 2) - base(ix, iz - 2)) / 4;
    const rx = r * (relief(ix + 2, iz, seed, list).height - relief(ix - 2, iz, seed, list).height) / 4;
    const rz = r * (relief(ix, iz + 2, seed, list).height - relief(ix, iz - 2, seed, list).height) / 4;
    const slope = Math.hypot(gx + rx, gz + rz);
    // The ledge line wanders: low-frequency drift and a finer break along its edge.
    const offset = 0.42 * fbm(ix * 0.03, iz * 0.03, seed + 101) + 0.14 * noise(ix * 0.13, iz * 0.13, seed + 202);
    const townStep = 1.7 + 0.5 * noise(ix * 0.02, iz * 0.02, seed + 303);
    const step = r > 0.5 ? lifted.step * (0.85 + 0.3 * noise(ix * 0.015, iz * 0.015, seed + 404)) : townStep;
    // Ledges outcrop in bands with quiet grass slopes between them, never as contour hatching everywhere.
    const outcrop = r > 0.5 ? smoothstep(-0.3, 0.12, fbm(ix * 0.007, iz * 0.007, seed + 707)) : 1;
    const amount = smoothstep(0.07, 0.2, slope) * (r > 0.5 ? outcrop : 0.9);
    const ledged = natural + (ledge(natural, step, r > 0.5 ? lifted.riser : 0.13, offset) - natural) * amount;
    // A little broken relief on the high ground only, never as per-metre noise.
    const rough = r * 1.2 * fbm(ix * 0.05, iz * 0.05, seed + 505) * smoothstep(8, 40, lifted.height);
    return b + (ledged + rough - b) * w;
  };

  const corner = (ix: number, iz: number): number => {
    const i = cacheIndex(ix, iz);
    if (i >= 0) {
      const cached = cornerCache[i]!;
      if (!Number.isNaN(cached)) return cached;
    }
    const value = Math.fround(sculpt(ix, iz));
    if (!Number.isFinite(value)) throw new Error('Land candidate produced a non-finite height.');
    if (i >= 0) cornerCache[i] = value;
    return value;
  };

  const inside = (x: number, z: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Land candidate needs finite coordinates.');
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) throw new RangeError('Land candidate query is outside its bounds.');
  };

  const height = (x: number, z: number): number => {
    inside(x, z);
    const left = Math.floor(x), back = Math.floor(z), u = x - left, v = z - back;
    const h00 = corner(left, back);
    if (u === 0 && v === 0) return h00;
    const h01 = corner(left, back + 1), h11 = corner(left + 1, back + 1);
    if (u <= v) return h00 + u * (h11 - h01) + v * (h01 - h00);
    const h10 = corner(left + 1, back);
    return h00 + u * (h10 - h00) + v * (h11 - h10);
  };

  const patchRise = (ix: number, iz: number): number => {
    const h00 = corner(ix, iz), h10 = corner(ix + 1, iz), h01 = corner(ix, iz + 1), h11 = corner(ix + 1, iz + 1);
    return Math.max(Math.abs(h11 - h00), Math.abs(h10 - h01), Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h10), Math.abs(h11 - h01));
  };

  const material = (x: number, z: number): LandMaterial => {
    inside(x, z);
    const ix = Math.floor(x), iz = Math.floor(z);
    const h00 = corner(ix, iz), h10 = corner(ix + 1, iz), h01 = corner(ix, iz + 1), h11 = corner(ix + 1, iz + 1);
    const cx = ix + 0.5, cz = iz + 0.5;
    const sample = publicGround(cx, cz);
    if (sample && sample.kind === 'trail' && sample.reservedDistance <= 0) return 'trail';
    // Paving keeps the installed rule: the designed width plus a continuous worn edge, never the verge.
    const wear = 0.22 * Math.sin(cx * 0.12 + cz * 0.09) + 0.1 * Math.sin(cx * 0.29 - cz * 0.17);
    if (sample && sample.kind !== 'trail' && sample.pavingDistance <= Math.max(0, wear)) return 'paving';
    const low = Math.min(h00, h10, h01, h11), high = Math.max(h00, h10, h01, h11);
    if ((h00 + h10 + h01 + h11) / 4 < lake.level + 0.25) return 'waterbed';
    // Rise across the metre: the patch's own triangles decide, so material and contact agree. A face is read
    // as one band: a moderately steep patch joins the rock it touches instead of speckling the face.
    const rise = patchRise(ix, iz);
    if (rise >= 1.05) return 'rock';
    if (rise >= 0.5) {
      const touching = Math.max(patchRise(ix + 1, iz), patchRise(ix - 1, iz), patchRise(ix, iz + 1), patchRise(ix, iz - 1));
      return touching >= 1.05 ? 'rock' : 'scree';
    }
    // A lip: level ground that ends at a drop within a metre or two.
    let drop = 0;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) drop = Math.max(drop, low - corner(ix + (dx > 0 ? 1 : 0) + dx, iz + (dz > 0 ? 1 : 0) + dz));
    if (drop >= 1.6 && rise < 0.35) return 'ledge';
    const outside = rectangleDistance(town, cx, cz);
    if (outside > 30 && high - base(ix, iz) > 18 + 6 * noise(cx * 0.02, cz * 0.02, seed + 606)) return 'heath';
    return 'grass';
  };

  return { bounds, height, corner: (ix, iz) => { inside(ix, iz); return corner(ix, iz); }, material, protection: (x, z) => { inside(x, z); return protection(x, z); } };
}
