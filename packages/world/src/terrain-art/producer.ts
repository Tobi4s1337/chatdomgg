import { seedHash } from '../layout';
import { rectangleDistance } from '../settlement/geometry';
import type { BoundsXZ, SettlementPlan, XZ } from '../settlement/types';
import { createGuards, WATER_BANK } from './guards';
import { CANONICAL_BACK, fbm, ledge, noise, relief, ridges, smoothstep } from './relief';
import { TERRAIN_ART_PRODUCER, type TerrainArtBackdrop, type TerrainArtCandidate, type TerrainArtInputs, type TerrainArtMaterial } from './types';

/**
 * Picture-land candidate producer (spec 46): a bounded, deterministic height and material query over an
 * accepted settlement plan. The plan and the caller's ground are read only. Every corner the plan guards
 * returns the caller's ground exactly, and the land eases from there into terraces between the homes,
 * ledged rock and layered ridges beyond the town.
 *
 * The candidate is a corner field. `height` interpolates Float32 integer-metre corners on the accepted
 * 00→11 triangles, so whoever renders the candidate and whoever collides with it read one surface. It is
 * not authority because it renders. Main adopts it, or doesn't, as one validated revision.
 */

export const TERRAIN_ART_LIMITS = Object.freeze({
  /** Corners nearer than this to any guard keep the authoritative ground exactly. */
  clearance: 1.5,
  /** Metres over which sculpted land eases back to the authoritative ground. */
  band: 9,
  /** The candidate never sits more than this below the authoritative ground… */
  maxCut: 3,
  /** …or more than this above it. */
  maxLift: 360,
  /** Bounds must lie within this square around the origin. */
  maxExtent: 1100,
  /** Landscape relief fades in over this many metres beyond a water body's dry bank. */
  waterRelief: 60,
});

/** Corner cache margin around the town; one Float32 and one Float64 per metre (≈3 MB for the founded town). */
const CACHE_MARGIN = 48;
const DIRECTIONS: Readonly<Record<TerrainArtBackdrop, XZ>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const BACKDROP_ORDER: readonly TerrainArtBackdrop[] = ['north', 'east', 'south', 'west'];
/** `GenesisLandscape.coast.oceanToward` as a compass side (turn 0 puts the ocean toward +z). */
const OCEAN_SIDE: readonly TerrainArtBackdrop[] = ['south', 'east', 'north', 'west'];

const edgeToward = (bounds: BoundsXZ, [bx, bz]: XZ): number => Math.max(bx * bounds.minX, bx * bounds.maxX) + Math.max(bz * bounds.minZ, bz * bounds.maxZ);

/**
 * The town's back is the bounds edge nearest the castle: the keep stands at the top of the town with the
 * ridges behind it. It is never the ocean side of a coastal Genesis landscape.
 */
export function terrainArtBackdrop(plan: SettlementPlan): TerrainArtBackdrop {
  const ocean = plan.genesisSurface ? OCEAN_SIDE[plan.genesisSurface.coast.oceanToward] : undefined;
  const [cx, , cz] = plan.castle.centre;
  let best: TerrainArtBackdrop = 'north', gap = Infinity;
  for (const side of BACKDROP_ORDER) {
    if (side === ocean) continue;
    const direction = DIRECTIONS[side], distance = edgeToward(plan.bounds, direction) - (direction[0] * cx + direction[1] * cz);
    if (distance < gap) { gap = distance; best = side; }
  }
  return best;
}

export function createTerrainArtCandidate(inputs: TerrainArtInputs): TerrainArtCandidate {
  const { plan, ground, publicGround } = inputs;
  const { clearance, band, maxCut, maxLift, maxExtent, waterRelief } = TERRAIN_ART_LIMITS;
  const bounds: Readonly<BoundsXZ> = Object.freeze({ minX: inputs.bounds.minX, maxX: inputs.bounds.maxX, minZ: inputs.bounds.minZ, maxZ: inputs.bounds.maxZ });
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ
    || Math.max(-bounds.minX, bounds.maxX, -bounds.minZ, bounds.maxZ) > maxExtent) {
    throw new RangeError('A terrain-art candidate needs finite, nonempty bounds within its horizon square.');
  }
  const seed = seedHash(`${plan.config.seed}:picture-land`) | 0;
  const list = ridges(seed >>> 0);
  const town = plan.bounds;
  const guards = createGuards(plan, publicGround, clearance + band + 1, WATER_BANK + waterRelief);

  // The canonical frame of the ridges: its north is the town's back, x = 0 the keep's line.
  const backdrop = terrainArtBackdrop(plan), back = DIRECTIONS[backdrop], across: XZ = [-back[1], back[0]];
  const backEdge = edgeToward(town, back), [keepX, , keepZ] = plan.castle.centre;
  const reliefAt = (x: number, z: number) => relief(
    (x - keepX) * across[0] + (z - keepZ) * across[1],
    CANONICAL_BACK - (x * back[0] + z * back[1] - backEdge), seed, list);

  // Bounded inner caches over the town and a margin: authoritative ground and candidate corners.
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
    if (i >= 0) { const cached = groundCache[i]!; if (!Number.isNaN(cached)) return cached; }
    const value = ground(ix, iz);
    if (!Number.isFinite(value)) throw new Error(`Authoritative ground is not finite at ${ix}, ${iz}.`);
    if (i >= 0) groundCache[i] = value;
    return value;
  };

  const sculpt = (ix: number, iz: number): number => {
    const b = base(ix, iz);
    const p = guards.protection(ix, iz).distance;
    if (p <= clearance) return b;
    const w = smoothstep(clearance, clearance + band, p);
    // Landscape relief grows outside the town footprint and stays clear of water; inside the town only the
    // ground between guarded footprints terraces.
    const r = smoothstep(-12, 150, rectangleDistance(town, ix, iz)) * smoothstep(WATER_BANK, WATER_BANK + waterRelief, guards.waterDistance(ix, iz));
    const lifted = reliefAt(ix, iz);
    const natural = b + r * lifted.height;
    // The land's slope before ledging decides where ledges belong; quiet meadows stay quiet.
    const gx = (base(ix + 2, iz) - base(ix - 2, iz)) / 4, gz = (base(ix, iz + 2) - base(ix, iz - 2)) / 4;
    const rx = r * (reliefAt(ix + 2, iz).height - reliefAt(ix - 2, iz).height) / 4;
    const rz = r * (reliefAt(ix, iz + 2).height - reliefAt(ix, iz - 2).height) / 4;
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
    const value = b + (ledged + rough - b) * w;
    return Math.min(b + maxLift, Math.max(b - maxCut, value));
  };

  const corner = (ix: number, iz: number): number => {
    const i = cacheIndex(ix, iz);
    if (i >= 0) { const cached = cornerCache[i]!; if (!Number.isNaN(cached)) return cached; }
    const value = Math.fround(sculpt(ix, iz));
    if (!Number.isFinite(value)) throw new Error('A terrain-art candidate produced a non-finite height.');
    if (i >= 0) cornerCache[i] = value;
    return value;
  };

  const inside = (x: number, z: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('A terrain-art candidate needs finite coordinates.');
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) throw new RangeError('A terrain-art query is outside its bounds.');
  };

  const height = (x: number, z: number): number => {
    inside(x, z);
    const left = Math.floor(x), backZ = Math.floor(z), u = x - left, v = z - backZ;
    const h00 = corner(left, backZ);
    if (u === 0 && v === 0) return h00;
    const h01 = corner(left, backZ + 1), h11 = corner(left + 1, backZ + 1);
    if (u <= v) return h00 + u * (h11 - h01) + v * (h01 - h00);
    const h10 = corner(left + 1, backZ);
    return h00 + u * (h10 - h00) + v * (h11 - h10);
  };

  const patchRise = (ix: number, iz: number): number => {
    const h00 = corner(ix, iz), h10 = corner(ix + 1, iz), h01 = corner(ix, iz + 1), h11 = corner(ix + 1, iz + 1);
    return Math.max(Math.abs(h11 - h00), Math.abs(h10 - h01), Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h10), Math.abs(h11 - h01));
  };

  const material = (x: number, z: number): TerrainArtMaterial => {
    inside(x, z);
    const ix = Math.floor(x), iz = Math.floor(z);
    const h00 = corner(ix, iz), h10 = corner(ix + 1, iz), h01 = corner(ix, iz + 1), h11 = corner(ix + 1, iz + 1);
    const cx = ix + 0.5, cz = iz + 0.5;
    const sample = publicGround(cx, cz);
    if (sample && sample.kind === 'trail' && sample.reservedDistance <= 0) return 'trail';
    // Paving keeps the installed rule: the designed width plus a continuous worn edge, never the verge.
    const wear = 0.22 * Math.sin(cx * 0.12 + cz * 0.09) + 0.1 * Math.sin(cx * 0.29 - cz * 0.17);
    if (sample && sample.kind !== 'trail' && sample.pavingDistance <= Math.max(0, wear)) return 'paving';
    const level = guards.waterLevel(cx, cz);
    if (level !== null && (h00 + h10 + h01 + h11) / 4 < level + 0.25) return 'waterbed';
    // The patch's own triangles decide, so material and contact agree. A face reads as one band: a
    // moderately steep patch joins the rock it touches instead of speckling the face.
    const rise = patchRise(ix, iz);
    if (rise >= 1.05) return 'rock';
    if (rise >= 0.5) {
      const touching = Math.max(patchRise(ix + 1, iz), patchRise(ix - 1, iz), patchRise(ix, iz + 1), patchRise(ix, iz - 1));
      return touching >= 1.05 ? 'rock' : 'scree';
    }
    // A lip: level ground that ends at a drop within a metre or two.
    const low = Math.min(h00, h10, h01, h11), high = Math.max(h00, h10, h01, h11);
    let drop = 0;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) drop = Math.max(drop, low - corner(ix + (dx > 0 ? 1 : 0) + dx, iz + (dz > 0 ? 1 : 0) + dz));
    if (drop >= 1.6 && rise < 0.35) return 'ledge';
    if (rectangleDistance(town, cx, cz) > 30 && high - base(ix, iz) > 18 + 6 * noise(cx * 0.02, cz * 0.02, seed + 606)) return 'heath';
    return 'grass';
  };

  return Object.freeze({
    producer: TERRAIN_ART_PRODUCER,
    planRevision: plan.revision,
    candidateRevision: `${plan.revision}+${TERRAIN_ART_PRODUCER}`,
    bounds,
    backdrop,
    height,
    corner: (ix: number, iz: number) => {
      inside(ix, iz);
      if (!Number.isInteger(ix) || !Number.isInteger(iz)) throw new RangeError('Terrain-art corners sit on integer metres.');
      return corner(ix, iz);
    },
    material,
    protection: (x: number, z: number) => { inside(x, z); return guards.protection(x, z); },
  });
}
