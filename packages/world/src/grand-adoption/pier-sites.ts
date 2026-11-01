import type { Vec3 } from '@chatdom/shared';
import { WALK_BODY, type SolidBox } from '@chatdom/shared/realm';
import { finiteVec3 } from '../interactions/geometry';
import { transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ } from '../settlement/types';
import { fullySupported } from './place-sites';
import { boxXZ, clearPierBounds, localPierBounds, overlaps, pierSiteBounds, PIER_EPS as EPS, preparePierSites, type PreparedPierSites } from './pier-sites-geometry';
import { PIER_SITE_BUDGET, type LandWaterCoverage, type LandWaterSample, type PierAnchor, type PierPlanningDimensions,
  type PierSiteCandidate, type PierSiteContext, type PierSiteFailure, type PierSitePlan, type PierSitePlanningOptions } from './pier-sites-types';

export * from './pier-sites-types';
export { pierSiteBounds } from './pier-sites-geometry';
export type PierSiteValidation = { readonly ok: true; readonly anchor: PierAnchor } | { readonly ok: false; readonly reason: PierSiteFailure };
const failure = (reason: PierSiteFailure): PierSiteValidation => ({ ok: false, reason });
const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1_000_000;
function validDimensions(d: PierPlanningDimensions): boolean {
  return [d.width, d.length, d.landingDepth, d.waterStart, d.minDepth, d.minFreeboard].every(finite)
    && d.width >= WALK_BODY.radius * 2 && d.width <= PIER_SITE_BUDGET.maxWidth
    && Number.isInteger(d.length) && d.length >= 1 && d.length <= PIER_SITE_BUDGET.maxLength
    && d.landingDepth >= WALK_BODY.radius * 2 && d.landingDepth <= PIER_SITE_BUDGET.maxLandingDepth
    && d.waterStart >= d.landingDepth / 2 && d.waterStart < d.length && d.minDepth > 0 && d.minFreeboard >= 0;
}
function validCandidate(c: PierSiteCandidate): boolean {
  return typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 128 && c.id.trim() === c.id
    && finiteVec3(c.root) && c.root.every(finite) && [0, 1, 2, 3].includes(c.turn);
}
function validWater(v: LandWaterSample | LandWaterCoverage): boolean {
  return v.state === 'dry' || (v.state === 'wet' || v.state === 'shore') && finite(v.level)
    && typeof v.biome === 'string' && v.biome.trim().length > 0 && v.biome.length <= 128
    && ['lake', 'river', 'sea'].includes(v.kind)
    && ('depth' in v ? finite(v.depth) && (v.state === 'shore' ? v.depth === 0 : v.depth > 0) : finite(v.minDepth) && (v.state === 'shore' ? v.minDepth >= 0 : v.minDepth > 0));
}
function ground(p: PreparedPierSites, x: number, z: number): Vec3 | null | 'budget-exceeded' {
  if (p.work.groundSamples >= PIER_SITE_BUDGET.groundSamples) return 'budget-exceeded';
  p.work.groundSamples++;
  const point = p.context.groundAt(x, z);
  return finiteVec3(point) && point.every(finite) && point[0] === x && point[2] === z ? point : null;
}
function water(p: PreparedPierSites, x: number, z: number): LandWaterSample | null | 'budget-exceeded' {
  if (p.work.waterSamples >= PIER_SITE_BUDGET.waterSamples) return 'budget-exceeded';
  p.work.waterSamples++;
  return p.context.water!.sample(x, z);
}
function coverage(p: PreparedPierSites, bounds: BoundsXZ): LandWaterCoverage | null | 'budget-exceeded' {
  if (p.work.coverageQueries >= PIER_SITE_BUDGET.coverageQueries) return 'budget-exceeded';
  p.work.coverageQueries++;
  return p.context.water!.coverage(bounds);
}
function query(p: PreparedPierSites, bounds: BoundsXZ, bottom: number, top: number): readonly SolidBox[] | 'budget-exceeded' {
  if (p.work.collisionQueries >= PIER_SITE_BUDGET.collisionQueries) return 'budget-exceeded';
  p.work.collisionQueries++;
  const boxes = p.context.collision!.query({ min: [bounds.minX, bottom, bounds.minZ], max: [bounds.maxX, top, bounds.maxZ] });
  if (boxes.length > PIER_SITE_BUDGET.collisionBoxes || p.work.collisionBoxes + boxes.length > PIER_SITE_BUDGET.totalCollisionBoxes) return 'budget-exceeded';
  p.work.collisionBoxes += boxes.length;
  return boxes;
}
function landing(p: PreparedPierSites, c: PierSiteCandidate, d: PierPlanningDimensions): PierSiteFailure | undefined {
  const bounds = localPierBounds(c, d.width, -d.landingDepth / 2, d.landingDepth / 2);
  const root = ground(p, c.root[0], c.root[2]);
  if (root === 'budget-exceeded') return root;
  if (!root) return 'unknown-ground';
  if (Math.abs(root[1] - c.root[1]) > EPS) return 'uneven-ground';
  for (let x = Math.floor(bounds.minX * 2) / 2; x < bounds.maxX; x += .5) for (let z = Math.floor(bounds.minZ * 2) / 2; z < bounds.maxZ; z += .5) {
    const point = ground(p, (Math.max(x, bounds.minX) + Math.min(x + .5, bounds.maxX)) / 2,
      (Math.max(z, bounds.minZ) + Math.min(z + .5, bounds.maxZ)) / 2);
    if (point === 'budget-exceeded') return point;
    if (!point) return 'unknown-ground';
    if (Math.abs(point[1] - c.root[1]) > EPS) return 'uneven-ground';
  }
  const boxes = query(p, bounds, c.root[1] - .05, c.root[1] + WALK_BODY.height);
  if (boxes === 'budget-exceeded') return boxes;
  if (boxes.some(b => b.max[1] > c.root[1] + EPS && b.min[1] < c.root[1] + WALK_BODY.height - EPS && overlaps(boxXZ(b), bounds))) return 'solid-overlap';
  const support = fullySupported(bounds, boxes, c.root[1]);
  if (support === 'budget-exceeded') return support;
  if (!support) return 'no-physical-support';
  const dry = coverage(p, bounds);
  if (dry === 'budget-exceeded') return dry;
  if (!dry) return 'unknown-water';
  if (!validWater(dry)) return 'invalid-water';
  if (dry.state !== 'dry') return 'wet-root';
  return undefined;
}
function clearPhysicalDeck(p: PreparedPierSites, c: PierSiteCandidate, bounds: BoundsXZ): PierSiteFailure | undefined {
  // Every intersecting half-metre physical terrain column must exist, including narrow fractional edges.
  for (let x = Math.floor(bounds.minX * 2) / 2; x < bounds.maxX; x += .5) for (let z = Math.floor(bounds.minZ * 2) / 2; z < bounds.maxZ; z += .5) {
    const point = ground(p, (Math.max(x, bounds.minX) + Math.min(x + .5, bounds.maxX)) / 2,
      (Math.max(z, bounds.minZ) + Math.min(z + .5, bounds.maxZ)) / 2);
    if (point === 'budget-exceeded') return point;
    if (!point) return 'unknown-ground';
    if (point[1] > c.root[1] + EPS) return 'solid-overlap';
  }
  // Query the complete continuous deck volume, not only sampled centreline points. CollisionWorld returns
  // barriers for every unknown region, so a sampler that extrapolates outside loaded physics cannot authorize it.
  const boxes = query(p, bounds, c.root[1], c.root[1] + WALK_BODY.height);
  if (boxes === 'budget-exceeded') return boxes;
  if (boxes.some(b => b.max[1] > c.root[1] + EPS && b.min[1] < c.root[1] + WALK_BODY.height - EPS && overlaps(boxXZ(b), bounds))) return 'solid-overlap';
  return undefined;
}
function freezeAnchor(c: PierSiteCandidate, wet: Extract<LandWaterCoverage, { state: 'wet' }>, depth: number[]): PierAnchor {
  return Object.freeze({ id: c.id, root: Object.freeze([...c.root]) as Vec3, turn: c.turn, waterY: wet.level,
    depth: Object.freeze(depth), water: wet.kind, biome: wet.biome });
}
function validate(p: PreparedPierSites, c: PierSiteCandidate, d: PierPlanningDimensions): PierSiteValidation {
  if (p.failure) return failure(p.failure);
  if (!validDimensions(d)) return failure('invalid-dimensions');
  if (!validCandidate(c)) return failure('invalid-site');
  const bounds = pierSiteBounds(c, d), exclusion = clearPierBounds(p, bounds);
  if (exclusion) return failure(exclusion);
  const rootFailure = landing(p, c, d);
  if (rootFailure) return failure(rootFailure);
  const deckFailure = clearPhysicalDeck(p, c, bounds);
  if (deckFailure) return failure(deckFailure);
  const wet = coverage(p, localPierBounds(c, d.width, d.waterStart, d.length));
  if (wet === 'budget-exceeded') return failure(wet);
  if (!wet) return failure('unknown-water');
  if (!validWater(wet)) return failure('invalid-water');
  if (wet.state !== 'wet') return failure('dry-deck');
  if (wet.minDepth < d.minDepth - EPS) return failure('shallow-water');
  if (c.root[1] < wet.level + d.minFreeboard - EPS) return failure('insufficient-freeboard');
  // The transition between the landing and waterStart may mix dry and wet. It must still be entirely known:
  // sparse centreline samples cannot authorize a tiny unknown patch or a second water body between stations.
  const entire = coverage(p, bounds);
  if (entire === 'budget-exceeded') return failure(entire);
  if (!entire) return failure('unknown-water');
  if (!validWater(entire) || entire.state !== 'shore') return failure('invalid-water');
  if (Math.abs(entire.level - wet.level) > EPS) return failure('nonflat-water');
  if (entire.kind !== wet.kind || entire.biome !== wet.biome) return failure('mixed-water');
  const depth: number[] = [];
  for (let z = 0; z <= d.length; z++) {
    const point = transformCardinalPoint(c.root, c.turn, [0, 0, z]);
    const sample = water(p, point[0], point[2]);
    if (sample === 'budget-exceeded') return failure(sample);
    if (!sample) return failure('unknown-water');
    if (!validWater(sample)) return failure('invalid-water');
    if (sample.state === 'dry') {
      if (z >= d.waterStart) return failure('dry-deck');
      depth.push(0); continue;
    }
    if (z === 0) return failure('wet-root');
    if (Math.abs(sample.level - wet.level) > EPS) return failure('nonflat-water');
    if (sample.kind !== wet.kind || sample.biome !== wet.biome) return failure('mixed-water');
    if (z >= d.waterStart && sample.depth < d.minDepth - EPS) return failure('shallow-water');
    const bed = ground(p, point[0], point[2]);
    if (bed === 'budget-exceeded') return failure(bed);
    if (!bed) return failure('unknown-ground');
    if (Math.abs(wet.level - bed[1] - sample.depth) > EPS) return failure('bed-mismatch');
    depth.push(sample.depth);
  }
  return { ok: true, anchor: freezeAnchor(c, wet, depth) };
}
/** Installation-time certificate only: no terrain edits and no permission to walk on an uninstalled deck. */
export function validatePierSite(context: PierSiteContext, candidate: PierSiteCandidate, dimensions: PierPlanningDimensions): PierSiteValidation {
  return validate(preparePierSites(context), candidate, dimensions);
}
function sameAnchor(a: PierAnchor, b: PierAnchor): boolean {
  return a.id === b.id && a.turn === b.turn && a.root.every((n, i) => n === b.root[i]) && a.waterY === b.waterY
    && a.water === b.water && a.biome === b.biome && Array.isArray(a.depth)
    && a.depth.length === b.depth.length && a.depth.every((n, i) => n === b.depth[i]);
}
/** Deterministic authored order, bounded work, one accepted site. Save the result with its dimensions at founding;
 * subsequent revisions must pass it as pinned. An installed pier:* placement stops empty-site planning entirely. */
export function planPierSites(context: PierSiteContext, options: PierSitePlanningOptions): PierSitePlan {
  const limit = options.maxCandidates ?? PIER_SITE_BUDGET.candidates;
  if (!Number.isInteger(limit) || limit < 1 || limit > PIER_SITE_BUDGET.candidates) throw new Error('Pier site candidate budget must be 1..512');
  const p = preparePierSites(context), pinned = options.pinned;
  const candidates = pinned ? [pinned] : options.candidates ?? [];
  const rejected: Partial<Record<PierSiteFailure, number>> = {};
  let anchor: PierAnchor | undefined, exhausted = false;
  if (p.failure) rejected[p.failure] = 1;
  else if (!validDimensions(options.dimensions)) rejected['invalid-dimensions'] = 1;
  else for (const candidate of candidates) {
    if (p.work.candidates >= limit) { exhausted = true; break; }
    p.work.candidates++;
    const result = validate(p, candidate, options.dimensions);
    const reason = !result.ok ? result.reason : pinned && !sameAnchor(pinned, result.anchor) ? 'pinned-mismatch' : undefined;
    if (result.ok && !reason) { anchor = result.anchor; break; }
    rejected[reason!] = (rejected[reason!] ?? 0) + 1;
    if (reason === 'budget-exceeded') { exhausted = true; break; }
  }
  const diagnostics = anchor ? [] : [Object.freeze({ reason: pinned ? 'pinned-invalid' as const
    : exhausted || rejected['budget-exceeded'] ? 'budget-exceeded' as const : 'unavailable' as const,
  checked: p.work.candidates, rejected: Object.freeze(rejected) })];
  return Object.freeze({ piers: Object.freeze(anchor ? [anchor] : []), diagnostics: Object.freeze(diagnostics), work: Object.freeze(p.work) });
}
