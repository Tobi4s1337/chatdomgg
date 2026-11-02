import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { WALK_BODY, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../founded-world/types';
import { finiteVec3 } from '../interactions/geometry';
import type { LandGroundAt, PlaceSite } from '../land-interface';
import { transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ, CardinalTurn } from '../settlement/types';

export type PlaceKind = 'tavern' | 'campfire';
export interface KingdomPlaceSites { readonly tavern?: import('./place-sites-tavern').TavernDoorAnchor; readonly campfire?: PlaceSite }
export type PlaceSiteFailure = 'invalid-site' | 'footprint-mismatch' | 'outside-plan' | 'reserved-lot'
  | 'road-overlap' | 'civic-overlap' | 'placement-overlap' | 'place-overlap' | 'unknown-ground'
  | 'uneven-ground' | 'no-collision' | 'revision-mismatch' | 'no-physical-support' | 'solid-overlap'
  | 'missing-tavern' | 'unsupported-tavern' | 'installed-campfire' | 'budget-exceeded';
export interface PlaceSiteDiagnostic {
  readonly place: PlaceKind;
  readonly reason: 'unavailable' | 'pinned-invalid' | 'budget-exceeded';
  readonly checked: number;
  readonly rejected: Readonly<Partial<Record<PlaceSiteFailure, number>>>;
}
export interface PlaceSitePlan {
  readonly places: KingdomPlaceSites;
  readonly diagnostics: readonly PlaceSiteDiagnostic[];
  readonly work: Readonly<{ candidates: number; groundSamples: number; collisionQueries: number; exclusionChecks: number }>;
}
export interface PlaceSiteContext {
  readonly scene: RealmFoundedScene;
  readonly groundAt: LandGroundAt;
  readonly collision?: CollisionWorld;
}
export interface PlaceSitePlanningOptions {
  /** Persist the accepted clearing. A rejected pinned site is never silently relocated. */
  readonly pinned?: PlaceSite;
  /** Optional authored clearing candidates in deterministic priority order. */
  readonly candidates?: readonly PlaceSite[];
  /** Per place, including rejected candidates. Hard maximum 512. */
  readonly maxCandidates?: number;
}
export const PLACE_SITE_BUDGET = Object.freeze({ candidatesPerPlace: 512, groundSamples: 65_536,
  collisionQueries: 2_048, collisionBoxes: 4_096, coverageSlabs: 256, exclusionChecks: 4_000_000, primitives: 32_768 });
export const CAMPFIRE_SITE_FOOTPRINT = Object.freeze([18, 18] as const);
const EPS = 1e-6;
const TURNS = [0, 1, 2, 3] as const;
type Work = { candidates: number; groundSamples: number; collisionQueries: number; exclusionChecks: number };
type Blocker = { bounds: BoundsXZ; reason: PlaceSiteFailure };
type Road = { a: Vec3; b: Vec3; radius: number; active: boolean };
interface Prepared { context: PlaceSiteContext; blockers: Blocker[]; roads: Road[]; work: Work; failure?: PlaceSiteFailure }

function footprintValid(value: readonly number[]): boolean {
  return value.length === 2 && value.every(n => Number.isFinite(n) && n > 0 && n <= 32);
}
/** Origin is the local [0,0,0] corner, matching gather's shared blueprint origin. */
export function placeSiteBounds(site: PlaceSite): BoundsXZ {
  const other = transformCardinalPoint(site.origin, site.turn, [site.footprint[0], 0, site.footprint[1]]);
  return { minX: Math.min(site.origin[0], other[0]), maxX: Math.max(site.origin[0], other[0]),
    minZ: Math.min(site.origin[2], other[2]), maxZ: Math.max(site.origin[2], other[2]) };
}
const overlap = (a: BoundsXZ, b: BoundsXZ) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS
  && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
const inside = (a: BoundsXZ, b: BoundsXZ) => a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ;
const xz = (box: SolidBox): BoundsXZ => ({ minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] });
function pointSegment(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
}
function segmentHits(a: Vec3, b: Vec3, box: BoundsXZ): boolean {
  let enter = 0, leave = 1;
  for (const [start, end, min, max] of [[a[0], b[0], box.minX, box.maxX], [a[2], b[2], box.minZ, box.maxZ]]) {
    const delta = end! - start!;
    if (Math.abs(delta) < EPS) { if (start! < min! || start! > max!) return false; continue; }
    const u = (min! - start!) / delta, v = (max! - start!) / delta;
    enter = Math.max(enter, Math.min(u, v)); leave = Math.min(leave, Math.max(u, v));
    if (enter > leave) return false;
  }
  return true;
}
function roadDistance(road: Road, bounds: BoundsXZ): number {
  if (segmentHits(road.a, road.b, bounds)) return 0;
  const pointBox = (p: Vec3) => Math.hypot(Math.max(bounds.minX - p[0], 0, p[0] - bounds.maxX), Math.max(bounds.minZ - p[2], 0, p[2] - bounds.maxZ));
  return Math.min(pointBox(road.a), pointBox(road.b), ...[bounds.minX, bounds.maxX].flatMap(x =>
    [bounds.minZ, bounds.maxZ].map(z => pointSegment(x, z, road.a, road.b))));
}
function prepare(context: PlaceSiteContext): Prepared {
  const { scene, collision } = context, { plan } = scene;
  const value: Prepared = { context, blockers: [], roads: [], work: { candidates: 0, groundSamples: 0, collisionQueries: 0, exclusionChecks: 0 } };
  if (scene.layoutRevision !== plan.revision || collision && collision.revision !== scene.collisionRevision) value.failure = 'revision-mismatch';
  else if (!collision) value.failure = 'no-collision';
  if (value.failure) return value;
  // Once gather installs a clearing its props deliberately occupy this space. A fresh empty-site search
  // must never move it. Gather must provide a stored authored anchor and its own installed-content validator.
  if (scene.placements.some(p => p.id.startsWith('gather:campfire:'))) { value.failure = 'installed-campfire'; return value; }
  const count = plan.reservations.length + plan.streets.reduce((n, s) => n + s.points.length, 0) + scene.placements.length + plan.courts.length + scene.assets.length;
  if (count > PLACE_SITE_BUDGET.primitives) { value.failure = 'budget-exceeded'; return value; }
  for (const plot of plan.reservations) value.blockers.push({ bounds: plot.lot, reason: 'reserved-lot' });
  value.blockers.push({ bounds: plan.castle.bounds, reason: 'civic-overlap' });
  for (const square of [plan.market, plan.castle.court, ...plan.courts]) {
    const xs = square.boundary.map(p => p[0]), zs = square.boundary.map(p => p[1]);
    value.blockers.push({ bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }, reason: 'civic-overlap' });
  }
  const solid = new Set(scene.materials.materials.filter(m => m.solid).map(m => m.id));
  const assets = new Map(scene.assets.map(a => [a.assetHash, a.blueprint]));
  for (const placement of scene.placements) {
    const bp = assets.get(placement.assetHash);
    if (!bp) { value.failure = 'invalid-site'; return value; }
    if (!bp.boxes.some(b => solid.has(b.material))) continue;
    // Conservative envelope retains every installed item, including trees. Never clear or move one here.
    const scale = VOXEL_METRES[bp.lattice];
    value.blockers.push({ bounds: placeSiteBounds({ origin: placement.position, turn: placement.rotation,
      footprint: [bp.size[0] * scale, bp.size[2] * scale] }), reason: 'placement-overlap' });
  }
  const active = new Set(plan.activeStreetIds);
  for (const street of plan.streets) for (let i = 1; i < street.points.length; i++) value.roads.push({
    a: street.points[i - 1]!, b: street.points[i]!, radius: street.width / 2, active: active.has(street.id),
  });
  return value;
}
function tickExclusion(p: Prepared): boolean { if (p.work.exclusionChecks >= PLACE_SITE_BUDGET.exclusionChecks) return false; p.work.exclusionChecks++; return true; }
function clearBounds(p: Prepared, bounds: BoundsXZ, roads: boolean): PlaceSiteFailure | undefined {
  if (!inside(bounds, p.context.scene.plan.bounds)) return 'outside-plan';
  for (const item of p.blockers) {
    if (!tickExclusion(p)) return 'budget-exceeded';
    if (overlap(item.bounds, bounds)) return item.reason;
  }
  if (roads) for (const road of p.roads) {
    if (!tickExclusion(p)) return 'budget-exceeded';
    if (roadDistance(road, bounds) < road.radius - EPS) return 'road-overlap';
  }
  return undefined;
}

/** Cover the whole rectangle with actual solid tops. Point probes alone can miss a hole between samples. */
export function fullySupported(bounds: BoundsXZ, boxes: readonly SolidBox[], y: number): boolean | 'budget-exceeded' {
  const tops = boxes.filter(b => Math.abs(b.max[1] - y) <= EPS && b.min[1] < y && overlap(xz(b), bounds));
  const edges = [...new Set([bounds.minX, bounds.maxX, ...tops.flatMap(b => [Math.max(bounds.minX, b.min[0]), Math.min(bounds.maxX, b.max[0])])])].sort((a, b) => a - b);
  if (edges.length > PLACE_SITE_BUDGET.coverageSlabs + 1) return 'budget-exceeded';
  for (let i = 1; i < edges.length; i++) {
    const min = edges[i - 1]!, max = edges[i]!;
    if (max - min <= EPS) continue;
    const spans = tops.filter(b => b.min[0] <= min + EPS && b.max[0] >= max - EPS).sort((a, b) => a.min[2] - b.min[2]);
    let covered = bounds.minZ;
    for (const span of spans) {
      if (span.min[2] > covered + EPS) break;
      covered = Math.max(covered, span.max[2]);
      if (covered >= bounds.maxZ - EPS) break;
    }
    if (covered < bounds.maxZ - EPS) return false;
  }
  return true;
}
function sample(p: Prepared, x: number, z: number): Vec3 | null | 'budget-exceeded' {
  if (p.work.groundSamples >= PLACE_SITE_BUDGET.groundSamples) return 'budget-exceeded';
  p.work.groundSamples++;
  const v = p.context.groundAt(x, z);
  return finiteVec3(v) && v[0] === x && v[2] === z ? v : null;
}
function physical(p: Prepared, bounds: BoundsXZ, y: number, height: number): PlaceSiteFailure | undefined {
  // Sample each intersecting half-metre terrain column at its clipped centre, including fractional edges.
  for (let x = Math.floor(bounds.minX * 2) / 2; x < bounds.maxX; x += .5) for (let z = Math.floor(bounds.minZ * 2) / 2; z < bounds.maxZ; z += .5) {
    const point = sample(p, (Math.max(x, bounds.minX) + Math.min(x + .5, bounds.maxX)) / 2,
      (Math.max(z, bounds.minZ) + Math.min(z + .5, bounds.maxZ)) / 2);
    if (point === 'budget-exceeded') return point;
    if (!point) return 'unknown-ground';
    if (Math.abs(point[1] - y) > EPS) return 'uneven-ground';
  }
  if (p.work.collisionQueries >= PLACE_SITE_BUDGET.collisionQueries) return 'budget-exceeded';
  p.work.collisionQueries++;
  const query = { min: [bounds.minX, y - .05, bounds.minZ] as Vec3, max: [bounds.maxX, y + height, bounds.maxZ] as Vec3 };
  const boxes = p.context.collision!.query(query);
  if (boxes.length > PLACE_SITE_BUDGET.collisionBoxes) return 'budget-exceeded';
  // Unknown-volume barriers overlap the space above the floor and therefore fail closed too.
  if (boxes.some(b => b.min[1] < y + height - EPS && b.max[1] > y + EPS && overlap(xz(b), bounds))) return 'solid-overlap';
  const support = fullySupported(bounds, boxes, y);
  return support === 'budget-exceeded' ? support : support ? undefined : 'no-physical-support';
}
function validate(p: Prepared, site: PlaceSite): PlaceSiteFailure | undefined {
  if (p.failure) return p.failure;
  if (!finiteVec3(site.origin) || site.origin.some(n => Math.abs(n) > 1_000_000) || !TURNS.includes(site.turn) || !footprintValid(site.footprint)) return 'invalid-site';
  if (site.footprint[0] !== 18 || site.footprint[1] !== 18) return 'footprint-mismatch';
  const bounds = placeSiteBounds(site), blocked = clearBounds(p, bounds, true);
  return blocked ?? physical(p, bounds, site.origin[1], WALK_BODY.height);
}

export function validatePlaceSite(context: PlaceSiteContext, site: PlaceSite): { readonly ok: true } | { readonly ok: false; readonly reason: PlaceSiteFailure } {
  const failure = validate(prepare(context), site);
  return failure ? { ok: false, reason: failure } : { ok: true };
}
function makeSite(p: Prepared, door: Vec3, turn: CardinalTurn, footprint: readonly [number, number]): PlaceSite {
  const origin = transformCardinalPoint(door, turn, [-footprint[0] / 2, 0, -footprint[1]]);
  const centre = transformCardinalPoint(origin, turn, [footprint[0] / 2, 0, footprint[1] / 2]);
  const ground = sample(p, centre[0], centre[2]);
  return { origin: [origin[0], ground && ground !== 'budget-exceeded' ? ground[1] : door[1], origin[2]], turn, footprint };
}
function* campfireCandidates(p: Prepared): Generator<PlaceSite> {
  const square = p.context.scene.plan.market, node = p.context.scene.plan.nodes.find(n => n.id === square.nodeId);
  const centre = node?.position ?? [0, square.elevation, 0];
  // The Wilds edge first (spec 21: the clearing at the edge of the Wilds): squares just inside the plan's own edge,
  // their front (local +Z) toward the town, nearest the market first, so the town's lights stay in sight. The
  // inner fields between the quarters are the old near-town rings, bounded to 96 m. Each 18 m square
  // conservatively contains the 9 m ring.
  const [fw, fd] = CAMPFIRE_SITE_FOOTPRINT, b = p.context.scene.plan.bounds, edge: { front: Vec3; turn: CardinalTurn; d: number }[] = [];
  for (const inset of EDGE_INSETS) for (const turn of TURNS) {
    // Local -Z of each turn points out through one side: 0 → min Z, 1 → min X, 2 → max Z, 3 → max X.
    const alongX = turn % 2 === 0, lo = (alongX ? b.minX : b.minZ) + fw / 2, hi = (alongX ? b.maxX : b.maxZ) - fw / 2;
    const depth = inset + fd, line = turn === 0 ? b.minZ + depth : turn === 1 ? b.minX + depth : turn === 2 ? b.maxZ - depth : b.maxX - depth;
    for (let along = lo; along <= hi + EPS; along += EDGE_STEP) {
      const front: Vec3 = alongX ? [along, centre[1], line] : [line, centre[1], along];
      edge.push({ front, turn, d: Math.hypot(front[0] - centre[0], front[2] - centre[2]) });
    }
  }
  edge.sort((a, c) => a.d - c.d || a.turn - c.turn || a.front[0] - c.front[0] || a.front[2] - c.front[2]);
  for (const item of edge) yield makeSite(p, item.front, item.turn, CAMPFIRE_SITE_FOOTPRINT);
  for (let radius = 24; radius <= 96; radius += 8) for (const turn of TURNS) for (let along = -radius; along < radius; along += 8) {
    const front = transformCardinalPoint(centre, turn, [along, 0, -radius + 9]);
    yield makeSite(p, front, turn, CAMPFIRE_SITE_FOOTPRINT);
  }
}
/** How far inside the plan's edge a Wilds-edge clearing may sit, metres, and its step along the edge. */
const EDGE_INSETS = [1, 7] as const, EDGE_STEP = 6;
function freezeSite(site: PlaceSite): PlaceSite {
  return Object.freeze({ origin: Object.freeze([...site.origin]) as Vec3, turn: site.turn,
    footprint: Object.freeze([...site.footprint]) as readonly [number, number] });
}
/** Construction/installation-time only. Does not alter terrain, plantings, roads, lots or placements.
 * Persistence owns accepted anchors; pass them back as pinned on growth/revision changes. */
export function planPlaceSites(context: PlaceSiteContext, options: PlaceSitePlanningOptions = {}): PlaceSitePlan {
  const limit = options.maxCandidates ?? PLACE_SITE_BUDGET.candidatesPerPlace;
  if (!Number.isInteger(limit) || limit < 1 || limit > PLACE_SITE_BUDGET.candidatesPerPlace) throw new Error('Place site candidate budget must be 1..512');
  const prepared = prepare(context), diagnostics: PlaceSiteDiagnostic[] = [];
  const pinned = options.pinned, candidates = pinned ? [pinned] : options.candidates ?? campfireCandidates(prepared);
  const rejected: Partial<Record<PlaceSiteFailure, number>> = {};
  let checked = 0, exhausted = false, campfire: PlaceSite | undefined;
  if (prepared.failure) rejected[prepared.failure] = 1;
  else for (const site of candidates) {
    if (checked >= limit) { exhausted = true; break; }
    checked++; prepared.work.candidates++;
    const reason = validate(prepared, site);
    if (!reason) { campfire = freezeSite(site); break; }
    rejected[reason] = (rejected[reason] ?? 0) + 1;
    if (reason === 'budget-exceeded') { exhausted = true; break; }
  }
  if (!campfire) diagnostics.push(Object.freeze({ place: 'campfire', reason: pinned ? 'pinned-invalid' : exhausted || rejected['budget-exceeded'] ? 'budget-exceeded' : 'unavailable', checked, rejected: Object.freeze(rejected) }));
  return Object.freeze({ places: Object.freeze(campfire ? { campfire } : {}), diagnostics: Object.freeze(diagnostics), work: Object.freeze(prepared.work) });
}
