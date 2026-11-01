import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { SolidBox } from '@chatdom/shared/realm';
import { transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ } from '../settlement/types';
import { PIER_SITE_BUDGET, type PierPlanningDimensions, type PierSiteCandidate, type PierSiteContext, type PierSiteFailure, type PierSiteWork } from './pier-sites-types';

export const PIER_EPS = 1e-6;
export interface PreparedPierSites {
  readonly context: PierSiteContext;
  readonly work: PierSiteWork;
  readonly blockers: { bounds: BoundsXZ; reason: PierSiteFailure }[];
  readonly roads: { a: Vec3; b: Vec3; radius: number }[];
  failure?: PierSiteFailure;
}
export const overlaps = (a: BoundsXZ, b: BoundsXZ): boolean => a.minX < b.maxX - PIER_EPS && a.maxX > b.minX + PIER_EPS
  && a.minZ < b.maxZ - PIER_EPS && a.maxZ > b.minZ + PIER_EPS;
export const boxXZ = (box: SolidBox): BoundsXZ => ({ minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] });
export function localPierBounds(candidate: PierSiteCandidate, width: number, start: number, end: number): BoundsXZ {
  const a = transformCardinalPoint(candidate.root, candidate.turn, [-width / 2, 0, start]);
  const b = transformCardinalPoint(candidate.root, candidate.turn, [width / 2, 0, end]);
  return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) };
}
/** Full deck envelope, including the dry landing behind the root. */
export function pierSiteBounds(candidate: PierSiteCandidate, dimensions: PierPlanningDimensions): BoundsXZ {
  return localPierBounds(candidate, dimensions.width, -dimensions.landingDepth / 2, dimensions.length);
}
export function preparePierSites(context: PierSiteContext): PreparedPierSites {
  const p: PreparedPierSites = { context, blockers: [], roads: [], work: { candidates: 0, preparationChecks: 0, groundSamples: 0,
    waterSamples: 0, coverageQueries: 0, collisionQueries: 0, collisionBoxes: 0, exclusionChecks: 0 } };
  const { scene, collision, water } = context, { plan } = scene;
  if (scene.layoutRevision !== plan.revision || collision && collision.revision !== scene.collisionRevision
    || water && (water.layoutRevision !== scene.layoutRevision || water.collisionRevision !== scene.collisionRevision)) p.failure = 'revision-mismatch';
  if (p.failure) return p;
  const consume = (n: number): boolean => {
    if (p.work.preparationChecks + n > PIER_SITE_BUDGET.primitives) { p.failure = 'budget-exceeded'; return false; }
    p.work.preparationChecks += n; return true;
  };
  // Charge array entries before scanning them, including empty streets/courts. This also bounds the installed
  // placement guard. Blueprint boxes are different: only the prefix inspected to find one solid is charged.
  if (!consume(plan.reservations.length + plan.homes.length + scene.placements.length + scene.assets.length
    + scene.materials.materials.length + plan.streets.length + plan.courts.length + 3)) return p;
  if (scene.placements.some(v => v.id.startsWith('pier:'))) p.failure = 'installed-pier';
  else if (!collision) p.failure = 'no-collision';
  else if (!water || typeof water.sample !== 'function' || typeof water.coverage !== 'function') p.failure = 'no-water-source';
  if (p.failure) return p;
  for (const plot of [...plan.reservations, ...plan.homes]) p.blockers.push({ bounds: plot.lot, reason: 'reserved-lot' });
  p.blockers.push({ bounds: plan.castle.bounds, reason: 'civic-overlap' });
  for (const square of [plan.market, plan.castle.court, ...plan.courts]) {
    if (!consume(square.boundary.length)) return p;
    if (square.boundary.length < 3) { p.failure = 'invalid-scene'; return p; }
    const xs = square.boundary.map(v => v[0]), zs = square.boundary.map(v => v[1]);
    p.blockers.push({ bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }, reason: 'civic-overlap' });
  }
  for (const street of plan.streets) {
    if (!consume(street.points.length)) return p;
    for (let i = 1; i < street.points.length; i++) p.roads.push({ a: street.points[i - 1]!, b: street.points[i]!, radius: street.width / 2 + street.verge });
  }
  const solid = new Set(scene.materials.materials.filter(m => m.solid).map(m => m.id));
  const solidAssets = new Map<string, typeof scene.assets[number]['blueprint']>();
  const allAssets = new Set<string>();
  for (const asset of scene.assets) {
    allAssets.add(asset.assetHash);
    // The conservative envelope needs only existence of a solid, not a scan of all detailed decoration.
    // Many real assets have their solid body first; charging their unvisited boxes rejected valid large scenes.
    for (const box of asset.blueprint.boxes) {
      if (!consume(1)) return p;
      if (solid.has(box.material)) { solidAssets.set(asset.assetHash, asset.blueprint); break; }
    }
  }
  for (const placement of scene.placements) {
    if (!allAssets.has(placement.assetHash)) { p.failure = 'invalid-scene'; return p; }
    const bp = solidAssets.get(placement.assetHash);
    if (!bp) continue;
    // Conservatively reserve the whole existing asset, including holes/empty corners. Nothing is removed here.
    const unit = VOXEL_METRES[bp.lattice], a = placement.position;
    const b = transformCardinalPoint(a, placement.rotation, [bp.size[0] * unit, 0, bp.size[2] * unit]);
    p.blockers.push({ bounds: { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) }, reason: 'placement-overlap' });
  }
  return p;
}
function pointSegment(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
}
function segmentHits(a: Vec3, b: Vec3, bounds: BoundsXZ): boolean {
  let enter = 0, leave = 1;
  for (const [start, end, min, max] of [[a[0], b[0], bounds.minX, bounds.maxX], [a[2], b[2], bounds.minZ, bounds.maxZ]]) {
    const delta = end! - start!;
    if (Math.abs(delta) < PIER_EPS) { if (start! < min! || start! > max!) return false; continue; }
    const u = (min! - start!) / delta, v = (max! - start!) / delta;
    enter = Math.max(enter, Math.min(u, v)); leave = Math.min(leave, Math.max(u, v));
    if (enter > leave) return false;
  }
  return true;
}
function roadDistance(a: Vec3, b: Vec3, bounds: BoundsXZ): number {
  if (segmentHits(a, b, bounds)) return 0;
  const pointBox = (v: Vec3) => Math.hypot(Math.max(bounds.minX - v[0], 0, v[0] - bounds.maxX), Math.max(bounds.minZ - v[2], 0, v[2] - bounds.maxZ));
  return Math.min(pointBox(a), pointBox(b), ...[bounds.minX, bounds.maxX].flatMap(x =>
    [bounds.minZ, bounds.maxZ].map(z => pointSegment(x, z, a, b))));
}
export function clearPierBounds(p: PreparedPierSites, bounds: BoundsXZ): PierSiteFailure | undefined {
  const region = p.context.scene.plan.bounds;
  if (bounds.minX < region.minX || bounds.maxX > region.maxX || bounds.minZ < region.minZ || bounds.maxZ > region.maxZ) return 'outside-plan';
  const tick = () => { if (p.work.exclusionChecks >= PIER_SITE_BUDGET.exclusionChecks) return false; p.work.exclusionChecks++; return true; };
  for (const blocker of p.blockers) {
    if (!tick()) return 'budget-exceeded';
    if (overlaps(bounds, blocker.bounds)) return blocker.reason;
  }
  for (const road of p.roads) {
    if (!tick()) return 'budget-exceeded';
    if (roadDistance(road.a, road.b, bounds) < road.radius - PIER_EPS) return 'road-overlap';
  }
  return undefined;
}
