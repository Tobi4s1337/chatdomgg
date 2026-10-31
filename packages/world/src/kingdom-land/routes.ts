import type { Vec3 } from '@chatdom/shared';
import { expandBounds, pointBounds, polygonDistance, rectangleDistance, segmentProjection, smoothstep, SpatialIndex,
  transformCardinalPoint } from '../settlement/geometry';
import { traceRoute } from '../settlement/routing';
import type { BoundsXZ, CardinalTurn, PlotReservation, PublicSquare, StreetEdge, StreetNode, XZ } from '../settlement/types';
import { BRIDGE_SPAN, LAND_FRAME, signedArea, type KingdomGeography } from './geography';
import { naturalLandHeight, waterKeepOut } from './surface';
import type { LandDressing, LandPath, LandSite, LandViewId } from './types';

/**
 * Where people walk beyond the streets. Each walk leaves the market along the town's own streets, then follows
 * earth trails the land offers: down to the mill's door, on to the one millstream bridge (along the bank from the
 * mill where it leaves room) and along the shore to the pier, meeting the lookout path at a fork when that path
 * already climbs across the shore; from the pier's landing up the lookout; out past the elder oak's roots, into
 * the campfire clearing and home again through the beacon gap; and up Crown Road to the court when the town has
 * not already built it. Destinations stay open: trails end at a site's edge or a place's rim. Benches and
 * fingerposts are pacing furniture, placed where a walker would want them; trees, water, lamps and place
 * buildings belong to their own lanes.
 *
 * Orientation follows geography: -Z is north (the castle), +X is east, bearings are atan2(dx, dz).
 */

export const EXPLORE_PACE_MPS = 4;
/** A bend, corner, bench, sign, site or landmark at least every 20 s of walking. */
export const BEAT_SPACING = 20 * EXPLORE_PACE_MPS;
/** Earth trails are 2.5 m wide; Crown Road, where land supplies it, is a 6 m main street with 1 m verges. */
export const TRAIL_WIDTH = 2.5;
export const CROWN_ROAD = { width: 6, verge: 1, grade: .12 } as const;
/** Grading reach of an earth trail's shelf, as settlement/terrain.ts applies it. */
const TRAIL_FEATHER = 5;
/** Earth trails climb no steeper than one in four; Crown Road keeps its own gentler grade. */
const TRAIL_GRADE = .25;
/** Spec 29: the pier deck stands 0.6–0.8 m above the water. */
export const PIER_DECK_HEIGHT = .7;
/** The elder oak's roots and root seat: trail edges keep this far from its trunk. */
export const OAK_ROOT_CLEARANCE = 4;
/** The walking circle in the clearing, between the campfire's envelope and the clearing's rim. */
export const CLEARING_ROUND = 13.5;
/** Civic furniture footprints in metres (spec 10 sizes): bench 32×16 cells, fingerpost 16×8 cells. */
export const DRESSING_FOOTPRINT = { bench: [4, 2], 'direction-sign': [2, 1] } as const;

/** The founded town as routing sees it: its streets and nodes, and every lot it will ever hold. */
export interface RouteTown {
  nodes: readonly StreetNode[];
  streets: readonly StreetEdge[];
  reservations: readonly PlotReservation[];
  market: PublicSquare;
}
export interface KingdomRoutes {
  /** New public ground: earth trails, the bridge and pier decks, and Crown Road where the town lacks one. */
  nodes: readonly StreetNode[];
  streets: readonly StreetEdge[];
  paths: readonly LandPath[];
  dressings: readonly LandDressing[];
  /** Earth trail centrelines: planting keeps trunks off them, ground-dressing wears their verges. */
  footways: readonly (readonly XZ[])[];
}

const round8 = (value: number) => Math.round(value * 8) / 8;
const xz = (p: readonly number[]): XZ => [p[0]!, p[2]!];
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const along = (from: XZ, bearing: number, metres: number): XZ => [from[0] + Math.sin(bearing) * metres, from[1] + Math.cos(bearing) * metres];
/** The cardinal turn whose local +Z faces closest to a bearing. */
const facingTurn = (bearing: number): CardinalTurn => ((Math.round(bearing / (Math.PI / 2)) % 4 + 4) % 4) as CardinalTurn;
const polylineLength = (points: readonly (readonly number[])[], y: 1 | 2 = 2) =>
  points.slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0]! - points[k]![0]!, p[y]! - points[k]![y]!), 0);

/** Tread tops of the interim civic footbridge above its landing datum (spec 10): four-cell treads to a one-metre crown. */
function footbridgeTread(metres: number): number {
  const x = Math.max(0, Math.min(63, Math.floor(metres * 8))), d = x < 32 ? x : 63 - x;
  return (d < 4 ? 1 : Math.min(8, 2 + Math.floor((d - 4) / 4))) * .125;
}

interface Join { at: XZ; radius: number }
/** Landmarks whose first sighting along a walk is a beat; `replaces` names a walk's own reveal that already marks it. */
type LandMarker = 'beacon' | 'lake' | 'mill-wheel' | 'summit' | 'elder-oak' | 'market-square';
const MARKERS: readonly { id: LandMarker; replaces?: LandViewId }[] = [
  { id: 'beacon', replaces: 'clearing-gap' }, { id: 'lake', replaces: 'lake-reveal' }, { id: 'mill-wheel' },
  { id: 'summit', replaces: 'lookout' }, { id: 'elder-oak', replaces: 'forest-approach' }, { id: 'market-square' },
];

export function foundKingdomRoutes(geography: KingdomGeography, town: RouteTown): KingdomRoutes {
  const { landform, sites, castle, places } = geography;
  const ground = (x: number, z: number) => naturalLandHeight(landform, x, z);
  const site = (id: string): LandSite => {
    const found = sites.find(item => item.id === id);
    if (!found) throw new Error(`Routes need the founded site ${id}`);
    return found;
  };
  const half = TRAIL_WIDTH / 2;

  // Town graph: public streets only; approaches belong to their homes.
  const nodeById = new Map(town.nodes.map(node => [node.id, node]));
  const publicStreets = town.streets.filter(street => street.kind !== 'approach');
  const incident = new Map<string, StreetEdge[]>();
  for (const street of publicStreets) for (const id of [street.from, street.to]) (incident.get(id) ?? incident.set(id, []).get(id)!).push(street);
  const reach = new Map<string, { metres: number; via?: StreetEdge }>([[town.market.nodeId, { metres: 0 }]]);
  {
    const open = new Set([town.market.nodeId]);
    while (open.size) {
      let id = '', best = Infinity;
      for (const item of open) { const metres = reach.get(item)!.metres; if (metres < best || (metres === best && item < id)) { best = metres; id = item; } }
      open.delete(id);
      for (const street of incident.get(id) ?? []) {
        const other = street.from === id ? street.to : street.from, metres = best + polylineLength(street.points);
        if (metres < (reach.get(other)?.metres ?? Infinity) - 1e-9) { reach.set(other, { metres, via: street }); open.add(other); }
      }
    }
  }
  const townWay = (to: string): string[] => {
    const ids: string[] = [];
    for (let at = to, step = reach.get(at); step?.via; at = step.via.from === at ? step.via.to : step.via.from, step = reach.get(at)) ids.unshift(step.via.id);
    return ids;
  };

  // Keep-outs for a centreline of a given half-width. Joins excuse streets and trails near where a trail meets
  // them; nothing excuses water, lots, sites, the castle or a place's own footprint.
  const lots = new SpatialIndex<BoundsXZ>(16), ways = new SpatialIndex<{ a: XZ; b: XZ; reach: number }>(16);
  for (const plot of town.reservations) lots.add(expandBounds(plot.lot, 8), plot.lot);
  const addWay = (points: readonly XZ[], wayReach: number) => {
    for (let k = 1; k < points.length; k++) ways.add(expandBounds(pointBounds([points[k - 1]!, points[k]!]), wayReach + 8), { a: points[k - 1]!, b: points[k]!, reach: wayReach });
  };
  for (const street of town.streets) addWay(street.points.map(xz), street.width / 2 + street.verge);
  addWay(places.lookout.trail.map(xz), half);
  const oak = xz(places.forest.oak), clearing = xz(places.forest.clearing.centre), clearingRadius = places.forest.clearing.radius;
  const lookoutHill = landform.hills.find(hill => hill.id === 'lookout')!;
  const open = (x: number, z: number, joins: readonly Join[], width = half): boolean => {
    if (x < LAND_FRAME.minX + 6 || x > LAND_FRAME.maxX - 6 || z < LAND_FRAME.minZ + 6 || z > LAND_FRAME.maxZ - 6) return false;
    if (waterKeepOut(landform, x, z, width + 1.5)) return false;
    for (const lot of lots.at(x, z)) if (rectangleDistance(lot, x, z) < width + 1) return false;
    for (const item of sites) if (polygonDistance(item.footprint, x, z) < width + 1) return false;
    const b = castle.bounds;
    if (x > b.minX - width - 3 && x < b.maxX + width + 3 && z > b.minZ - width - 3 && z < b.maxZ + width + 3) return false;
    if (Math.hypot(x - oak[0], z - oak[1]) < OAK_ROOT_CLEARANCE + width) return false;
    if (Math.hypot(x - clearing[0], z - clearing[1]) < clearingRadius + 1) return false;
    if (Math.hypot(x - lookoutHill.centre[0], z - lookoutHill.centre[1]) < lookoutHill.plateau + 2) return false;
    if (joins.some(join => Math.hypot(x - join.at[0], z - join.at[1]) < join.radius)) return true;
    // A trail's edge may meet a street's verge, never run onto it.
    for (const way of ways.at(x, z)) if (segmentProjection(way.a, way.b, x, z).distance < way.reach + width + .25) return false;
    return true;
  };
  const trace = (from: XZ, to: XZ, joins: readonly Join[], label: string): XZ[] => {
    const path = traceRoute(from, to, (x, z) => open(x, z, joins), ground);
    if (!path) throw new Error(`No clear walk for ${label}`);
    return path;
  };
  const chain = (...parts: XZ[][]): XZ[] => parts.reduce<XZ[]>((all, part) => all.length ? [...all, ...part.slice(distance(all.at(-1)!, part[0]!) < 1e-6 ? 1 : 0)] : [...part], []);
  const straight = (a: XZ, b: XZ): XZ[] => {
    const n = Math.max(1, Math.ceil(distance(a, b)));
    return Array.from({ length: n + 1 }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] as XZ);
  };

  // A trail is a shelf on its hillside: smoothed ground, pinned to whatever it meets at each end, every 2 m, never
  // steeper than TRAIL_GRADE. Each height is held inside the cones both pins allow, then limited walking forward.
  const profile = (path: readonly XZ[], start?: number, end?: number): Vec3[] => {
    const raw = path.map(p => ground(p[0], p[1]));
    const along = path.map((p, k) => k ? distance(path[k - 1]!, p) : 0).map((sum => (d: number) => sum += d)(0));
    const smooth = raw.map((_, k) => { let sum = 0, n = 0; for (let j = Math.max(0, k - 3); j <= Math.min(raw.length - 1, k + 3); j++) { sum += raw[j]!; n++; } return sum / n; });
    // A point every 2 m of walking, the last run 1–3 m; grades are held on the chords actually laid.
    const kept = [0];
    for (let k = 1; k < path.length - 1; k++) if (along[k]! - along[kept.at(-1)!]! >= 2 && along.at(-1)! - along[k]! >= 1) kept.push(k);
    kept.push(path.length - 1);
    const points = kept.map(k => [round8(path[k]![0]), round8(path[k]![1])] as XZ);
    const run = points.map((p, k) => k ? distance(points[k - 1]!, p) : 0).map((sum => (d: number) => sum += d)(0)), total = run.at(-1)!;
    const first = start ?? smooth[0]!, last = end ?? smooth.at(-1)!;
    const grade = Math.max(TRAIL_GRADE, Math.abs(last - first) / Math.max(total, 1e-6));
    const heights = kept.map((k, j) => Math.min(Math.max(smooth[k]!, first - grade * run[j]!, last - grade * (total - run[j]!)), first + grade * run[j]!, last + grade * (total - run[j]!)));
    for (let j = 1; j < heights.length; j++) {
      const rise = grade * (run[j]! - run[j - 1]!);
      heights[j] = Math.min(Math.max(heights[j]!, heights[j - 1]! - rise), heights[j - 1]! + rise);
    }
    // Heights to 1/32 m, so rounding never tips a run measurably past its grade.
    return points.map((p, j) => [p[0], Math.round(heights[j]! * 32) / 32, p[1]] as Vec3);
  };

  const nodes: StreetNode[] = [], streets: StreetEdge[] = [], dressings: LandDressing[] = [], footways: XZ[][] = [];
  const node = (id: string, position: Vec3, kind: StreetNode['kind'] = 'junction') => {
    if (!nodeById.has(id)) { const made = { id, kind, position }; nodes.push(made); nodeById.set(id, made); }
    return id;
  };
  // The ground beside an earth trail as its grading leaves it: the trail's shelf easing back to the hillside
  // over the shared 5 m trail feather (settlement/terrain.ts), so furniture stands on the ground people see.
  const shelves = new SpatialIndex<readonly [Vec3, Vec3]>(16), vertices = new SpatialIndex<{ edgeId: string; vertex: number; at: Vec3 }>(8);
  const shelfGround = (x: number, z: number) => {
    let nearest: { d: number; y: number } | undefined;
    for (const [a, b] of shelves.at(x, z)) {
      const p = segmentProjection(xz(a), xz(b), x, z), d = p.distance - half;
      if (!nearest || d < nearest.d) nearest = { d, y: a[1] + (b[1] - a[1]) * p.t };
    }
    const natural = ground(x, z);
    if (!nearest || nearest.d >= TRAIL_FEATHER) return natural;
    if (nearest.d <= 0) return nearest.y;
    const w = 1 - smoothstep(0, TRAIL_FEATHER, nearest.d), odds = w / (1 - w);
    return (natural + odds * nearest.y) / (1 + odds);
  };
  const trail = (id: string, name: string, from: string, to: string, points: Vec3[], footway = true) => {
    streets.push({ id, from, to, kind: 'trail', name, points, width: TRAIL_WIDTH, verge: 0 });
    if (footway) {
      footways.push(points.map(xz));
      for (let k = 1; k < points.length; k++) shelves.add(expandBounds(pointBounds([xz(points[k - 1]!), xz(points[k]!)]), TRAIL_FEATHER + half), [points[k - 1]!, points[k]!]);
      points.forEach((at, vertex) => { if (vertex > 0 && vertex < points.length - 1) vertices.add(pointBounds([xz(at)]), { edgeId: id, vertex, at }); });
    }
    addWay(points.map(xz), half);
    return id;
  };

  // Where a trail leaves the town: the street node with the shortest whole walk to its first waypoint.
  // `arrive` lets the trail meet other ways close to its target, where it joins a landing.
  const leaveTown = (target: XZ, label: string, arrive = 0) => {
    const candidates = [...reach.entries()].flatMap(([id, step]) => {
      const at = nodeById.get(id);
      return at && at.kind !== 'frontage' && at.kind !== 'castle-gate' ? [{ id, at, score: step.metres + 1.5 * distance(xz(at.position), target) }] : [];
    }).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id)).slice(0, 6);
    let best: { id: string; at: StreetNode; path: XZ[]; total: number } | undefined;
    for (const candidate of candidates) {
      const start = xz(candidate.at.position), path = traceRoute(start, target, (x, z) => open(x, z, [{ at: start, radius: 8 }, { at: target, radius: arrive }]), ground);
      if (!path) continue;
      const total = reach.get(candidate.id)!.metres + polylineLength(path.map(p => [p[0], 0, p[1]]));
      if (!best || total < best.total - 1e-6) best = { id: candidate.id, at: candidate.at, path, total };
    }
    if (!best) throw new Error(`No street reaches out toward ${label}`);
    return best;
  };

  // ── Plaza to court: the town's own Crown Road, or one land lays around the rise's flank. ──
  const courtWay = reach.has(castle.gateNodeId) ? townWay(castle.gateNodeId) : [crownRoad()];

  // ── Plaza, past the mill, over the bridge, along the shore to the pier. ──
  const mill = site('water:mill'), bridge = site('water:bridge'), pier = site('water:pier');
  const millFront = xz(transformCardinalPoint(mill.position, mill.turn, [5.5, 0, 9 + 4]));
  const deckZ = bridge.position[2] + BRIDGE_SPAN.width / 2, deckY = bridge.position[1];
  const westLanding: XZ = [bridge.position[0], deckZ], eastLanding: XZ = [bridge.position[0] + BRIDGE_SPAN.length, deckZ];
  // Each landing is met by a straight run, square to the deck, that the trail reaches from open ground.
  const westApproach: XZ = [westLanding[0] - 5, deckZ], eastApproach: XZ = [eastLanding[0] + 5, deckZ];
  const pierLanding = xz(transformCardinalPoint(pier.position, pier.turn, [1.25, 0, -3.5]));
  const startHeight = (id: string) => nodeById.get(id)!.position[1];
  const millStart = leaveTown(millFront, 'the mill');
  const millDoor = node('land:mill:front', [round8(millFront[0]), round8(ground(...millFront)), round8(millFront[1])], 'frontier');
  trail('land:mill-walk', 'Mill Walk', millStart.id, millDoor, profile(millStart.path, startHeight(millStart.id), startHeight(millDoor)));
  // On down the bank to the bridge where the bank leaves room; otherwise the nearest street runs out to it.
  const bridgeWest = node('land:bridge:west', [westLanding[0], deckY + footbridgeTread(0), deckZ]);
  const bridgeEast = node('land:bridge:east', [eastLanding[0], deckY + footbridgeTread(BRIDGE_SPAN.length), deckZ]);
  const bank = traceRoute(millFront, westApproach, (x, z) => open(x, z, [{ at: millFront, radius: 5 }, { at: westApproach, radius: 6 }]), ground);
  const toBridge = bank ? { id: millDoor, path: bank, way: [...townWay(millStart.id), 'land:mill-walk'] }
    : (start => ({ id: start.id, path: start.path, way: townWay(start.id) }))(leaveTown(westApproach, 'the bridge', 6));
  trail('land:millstream-walk', 'Millstream Walk', toBridge.id, bridgeWest,
    profile(chain(toBridge.path, straight(westApproach, westLanding)), startHeight(toBridge.id), deckY + footbridgeTread(0)));
  const deck = Array.from({ length: BRIDGE_SPAN.length + 1 }, (_, k) => [westLanding[0] + k, round8(deckY + footbridgeTread(Math.min(k, BRIDGE_SPAN.length - .01))), deckZ] as Vec3);
  trail('land:bridge', 'Millstream Bridge', bridgeWest, bridgeEast, deck, false);
  const landingY = round8(ground(...pierLanding));
  const landing = node('land:pier:landing', [round8(pierLanding[0]), landingY, round8(pierLanding[1])]);
  const lookoutStart = xz(places.lookout.trail[0]!);
  // The shore path runs to the pier's landing; where the lookout path already climbs across the shore between
  // them, the two meet at a fork and share the lookout path's foot down to the landing.
  const climb = places.lookout.trail, climbRun = climb.map((p, k) => k ? distance(xz(climb[k - 1]!), xz(p)) : 0).map((sum => (d: number) => sum += d)(0));
  const shoreTo = (to: XZ, radius: number) => traceRoute(eastApproach, to, (x, z) => open(x, z, [{ at: eastApproach, radius: 6 }, { at: to, radius }, { at: lookoutStart, radius: 3 }]), ground);
  const direct = shoreTo(pierLanding, 7);
  let forked: { k: number; path: XZ[]; total: number } | undefined;
  // Straight-line distance bounds each walk from below, so the search stops once no fork can beat the best.
  if (!direct) for (const option of climb.map((p, k) => ({ k, score: distance(eastApproach, xz(p)) + climbRun[k]! }))
    .filter(option => option.k > 0 && climbRun[option.k]! < 90).sort((a, b) => a.score - b.score)) {
    if (forked && option.score >= forked.total) break;
    const path = shoreTo(xz(climb[option.k]!), 5), total = path ? polylineLength(path.map(p => [p[0], 0, p[1]])) + climbRun[option.k]! : Infinity;
    if (path && (!forked || total < forked.total)) forked = { k: option.k, path, total };
  }
  if (!direct && !forked) throw new Error('No clear walk for the bridge to the pier');
  const fork = forked ? node('land:lookout:fork', [...climb[forked.k]!] as Vec3) : landing;
  trail('land:shore-path', 'Shore Path', bridgeEast, fork,
    profile(chain(straight(eastLanding, eastApproach), direct ?? forked!.path), deckY + footbridgeTread(BRIDGE_SPAN.length), nodeById.get(fork)!.position[1]));
  const deckHeight = pier.position[1] + PIER_DECK_HEIGHT;
  // Along the pier's walk strip to the middle of its head; the deck itself is places-water's.
  const headAt = transformCardinalPoint(pier.position, pier.turn, [1.25, 0, 26]);
  const pierHead = node('land:pier:head', [round8(headAt[0]), round8(deckHeight), round8(headAt[2])], 'frontier');
  trail('land:pier', 'Pier', landing, pierHead, [-3.5, 0, 4, 8, 12, 16, 20, 24, 26].map((z, k) => {
    const p = transformCardinalPoint(pier.position, pier.turn, [1.25, 0, z]);
    return [round8(p[0]), k ? round8(deckHeight) : landingY, round8(p[2])] as Vec3;
  }), false);

  // ── From the pier's landing up the lookout: the land's own winding trail. ──
  // It arrives at the summit plateau's rim; the plateau itself stays open for the cairn, seat and pine.
  const summit = node('land:lookout:summit', [...places.lookout.trail.at(-1)!] as Vec3, 'frontier');
  // The land's line, laid as a shelf at the trails' own grade from the landing (or the fork) to the rim.
  const climbFrom = [pierLanding, ...climb.map(xz)], forkY = nodeById.get(fork)!.position[1], rimY = climb.at(-1)![1];
  if (forked) trail('land:lookout-foot', 'Lookout Path', landing, fork, profile(climbFrom.slice(0, forked.k + 2), landingY, forkY));
  trail('land:lookout', 'Lookout Path', fork, summit, profile(forked ? climbFrom.slice(forked.k + 1) : climbFrom, forkY, rimY));
  const footWay = forked ? ['land:lookout-foot'] : [];

  // ── Out to the elder oak and into the clearing; home through the beacon gap. ──
  const entry = places.forest.entryBearing, side = (sign: number) => entry + sign * Math.PI / 2;
  const forest = [1, -1].map(sign => {
    // The meadow below the oak and the shoulder the path rounds it by: the nearest open ground to each ideal.
    const nearestOpen = (ideal: XZ) => [0, 1, 2, 3].flatMap(ring => ring ? Array.from({ length: 8 * ring }, (_, k) =>
      along(ideal, k * Math.PI / (4 * ring), 1.5 * ring)) : [ideal]).find(p => distance(p, oak) >= OAK_ROOT_CLEARANCE + half + .5 && open(p[0], p[1], []));
    const meadow = nearestOpen(along(along(oak, entry + Math.PI, 9), side(sign), 5.5)), past = nearestOpen(along(along(oak, entry, 3), side(sign), OAK_ROOT_CLEARANCE + half + 1.25));
    // Where homes already crowd the oak's meadow, the path leaves the street straight for the shoulder.
    return past ? [{ meadow, past, rim: along(clearing, Math.atan2(past[0] - clearing[0], past[1] - clearing[1]), clearingRadius + 1.5) }] : [];
  }).flat().flatMap(option => {
    try {
      const start = leaveTown(option.meadow ?? option.past, 'the elder oak'), rim = trace(option.past, option.rim, [], 'into the clearing');
      const woods = option.meadow ? trace(option.meadow, option.past, [], 'past the oak') : [option.past];
      return [{ ...option, start, path: chain(start.path, woods, rim), total: start.total + polylineLength([...woods, ...rim].map(p => [p[0], 0, p[1]])) }];
    } catch { return []; }
  }).sort((a, b) => a.total - b.total)[0];
  if (!forest) throw new Error('No clear walk past the elder oak into the clearing');
  const clearingLevel = places.forest.clearing.centre[1];
  const rimBearing = Math.atan2(forest.rim[0] - clearing[0], forest.rim[1] - clearing[1]), gapBearing = places.forest.clearing.gapBearing;
  const clearingEntry = node('land:clearing:entry', [round8(along(clearing, rimBearing, clearingRadius)[0]), clearingLevel, round8(along(clearing, rimBearing, clearingRadius)[1])]);
  trail('land:oak-path', 'Oak Path', forest.start.id, clearingEntry, profile(chain(forest.path, straight(forest.rim, along(clearing, rimBearing, clearingRadius))), startHeight(forest.start.id), clearingLevel));
  // The walking circle passes between the fire's envelope and the rim, on the shorter side, to the gap.
  const sweep = wrap(gapBearing - rimBearing), round: XZ[] = [along(clearing, rimBearing, clearingRadius)];
  for (let k = 0, n = Math.max(2, Math.ceil(Math.abs(sweep) * CLEARING_ROUND / 2)); k <= n; k++) round.push(along(clearing, rimBearing + sweep * k / n, CLEARING_ROUND));
  round.push(along(clearing, gapBearing, clearingRadius));
  const clearingGap = node('land:clearing:gap', [round8(round.at(-1)![0]), clearingLevel, round8(round.at(-1)![1])]);
  trail('land:clearing-round', 'Fireside Round', clearingEntry, clearingGap, round.map(p => [round8(p[0]), clearingLevel, round8(p[1])] as Vec3));
  const gapEnd = along(clearing, gapBearing, clearingRadius + 22), home = leaveTown(gapEnd, 'the beacon gap');
  const beaconWalk = chain(straight(along(clearing, gapBearing, clearingRadius), gapEnd), [...home.path].reverse());
  trail('land:beacon-path', 'Beacon Path', clearingGap, home.id, profile(beaconWalk, clearingLevel, startHeight(home.id)));

  // Fingerposts where a trail leaves the streets or trails part: 4 m along, beside it, facing the arriving walker.
  const occupied: XZ[][] = [];
  // Furniture stands a metre off any way, on dry level ground, clear of sites, lots and other furniture.
  const furnitureClear = (footprint: readonly XZ[]) => footprint.every(([x, z]) =>
    !waterKeepOut(landform, x, z, 1) && open(x, z, [], .25) && occupied.every(other => polygonDistance(other, x, z) > 1.5));
  // A fingerpost stands a metre off the trail's edge, a bench half a metre off it on its lay-by: measured to the
  // nearest corner of its cardinal footprint, however the trail runs past it.
  const setBack = (form: keyof typeof DRESSING_FOOTPRINT, turn: CardinalTurn, outward: number) => {
    const [width, depth] = DRESSING_FOOTPRINT[form], local = outward - turn * Math.PI / 2;
    return half + (form === 'bench' ? .6 : 1.1) + width / 2 * Math.abs(Math.sin(local)) + depth / 2 * Math.abs(Math.cos(local));
  };
  const rectangle = (origin: Vec3, turn: CardinalTurn, width: number, depth: number): XZ[] => {
    const corners = ([[0, 0], [0, depth], [width, depth], [width, 0]] as const).map(([x, z]) => xz(transformCardinalPoint(origin, turn, [x, 0, z])));
    return signedArea(corners) > 0 ? corners : corners.reverse();
  };
  const furniture = (form: 'direction-sign', from: XZ, outward: number, facing: number): number | undefined => {
    const turn = facingTurn(facing), [width, depth] = DRESSING_FOOTPRINT[form], centre = along(from, outward, setBack(form, turn, outward));
    const offset = transformCardinalPoint([0, 0, 0], turn, [width / 2, 0, depth / 2]);
    const origin: Vec3 = [round8(centre[0] - offset[0]), 0, round8(centre[1] - offset[2])];
    const footprint = rectangle(origin, turn, width, depth), heights = footprint.map(([x, z]) => shelfGround(x, z));
    if (Math.max(...heights) - Math.min(...heights) > .6 || !furnitureClear(footprint)) return undefined;
    occupied.push(footprint);
    dressings.push({ form, style: 'hearth', position: [origin[0], round8(Math.min(...heights)), origin[2]], turn });
    return dressings.length - 1;
  };
  // A bench stands in a lay-by: a short level spur of trail, joined at one of the trail's own points, whose
  // shared grading cuts a pad into the hillside beneath it. The spur runs along the bench's length.
  const pads: { index: number; edgeId: string; vertex: number; points: Vec3[] }[] = [];
  const bench = (anchor: { edgeId: string; vertex: number; at: Vec3 }, facing: number): number | undefined => {
    const turn = facingTurn(facing), [width, depth] = DRESSING_FOOTPRINT.bench, centre = along(xz(anchor.at), facing, setBack('bench', turn, facing));
    const offset = transformCardinalPoint([0, 0, 0], turn, [width / 2, 0, depth / 2]), length = transformCardinalPoint([0, 0, 0], turn, [1, 0, 0]);
    const origin: Vec3 = [round8(centre[0] - offset[0]), 0, round8(centre[1] - offset[2])];
    const footprint = rectangle(origin, turn, width, depth), heights = footprint.map(([x, z]) => ground(x, z));
    // The lay-by grades as trail, so its pad eases back over the 5 m feather; at most 3 m of cut or fill at any
    // corner keeps that ease no steeper than the hillside the trail already climbs.
    if (heights.some(h => Math.abs(h - anchor.at[1]) > 3) || !furnitureClear(footprint)) return undefined;
    const ends = ([-1, 1] as const).map(sign => [round8(centre[0] + length[0] * sign * (width / 2 + .5)), anchor.at[1], round8(centre[1] + length[2] * sign * (width / 2 + .5))] as Vec3)
      .sort((a, b) => distance(xz(a), xz(anchor.at)) - distance(xz(b), xz(anchor.at)));
    const spur: Vec3[] = [[...anchor.at] as Vec3, ...ends];
    for (let k = 1; k < spur.length; k++) for (const [x, z] of straight(xz(spur[k - 1]!), xz(spur[k]!)))
      if (waterKeepOut(landform, x, z, half + .5) || [...lots.at(x, z)].some(lot => rectangleDistance(lot, x, z) < half + .5)
        || sites.some(item => polygonDistance(item.footprint, x, z) < half + .5)) return undefined;
    occupied.push(footprint);
    dressings.push({ form: 'bench', style: 'hearth', position: [origin[0], anchor.at[1], origin[2]], turn });
    pads.push({ index: dressings.length - 1, edgeId: anchor.edgeId, vertex: anchor.vertex, points: spur });
    return dressings.length - 1;
  };
  // The interim civic footbridge carries the walk until the stone crossing replaces it at the same site.
  dressings.push({ form: 'footbridge', style: 'hearth', position: [...bridge.position], turn: bridge.turn, siteId: bridge.id });
  occupied.push([...bridge.footprint]);
  const signpost = (edgeId: string, fromEnd: boolean) => {
    const edge = streets.find(street => street.id === edgeId)!, points = (fromEnd ? [...edge.points].reverse() : edge.points).map(xz);
    // As near the junction as it finds room: clear of the street it leaves and the lots along it.
    for (let k = 1; k < Math.min(points.length - 1, 12); k++) {
      const a = points[k]!, b = points[k + 1]!, heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (const sign of [1, -1]) {
        if (furniture('direction-sign', a, heading + sign * Math.PI / 2, heading + Math.PI) !== undefined) return;
      }
    }
  };
  signpost('land:mill-walk', false);
  if (!bank) signpost('land:millstream-walk', false);
  signpost('land:shore-path', true);
  signpost('land:oak-path', false);
  signpost('land:beacon-path', true);

  // Walks, each from a named place to the next, with the beats a walker meets along them.
  const lakeBody = landform.waters.find(body => body.id === 'lake')!, keep = castle.modules.find(module => module.id === castle.beaconModuleId)!;
  const beacon: Vec3 = [keep.position[0] + keep.size[0] / 2, keep.position[1] + keep.size[1], keep.position[2] + keep.size[2] / 2];
  const lakeTargets: Vec3[] = [[lakeBody.x, lakeBody.level, lakeBody.z], ...[0, 1, 2, 3].map(k => [lakeBody.x + Math.cos(k * Math.PI / 2) * lakeBody.radiusX * .5, lakeBody.level, lakeBody.z + Math.sin(k * Math.PI / 2) * lakeBody.radiusZ * .5] as Vec3)];
  const markers: Record<LandMarker, Vec3> = {
    beacon, lake: lakeTargets[0]!, 'mill-wheel': transformCardinalPoint(site('water:wheel').position, site('water:wheel').turn, [1.25, 2.5, 3.5]),
    summit: [places.lookout.summit[0], places.lookout.summit[1] + 9, places.lookout.summit[2]], 'elder-oak': [oak[0], places.forest.oak[1] + 12, oak[1]],
    'market-square': [...nodeById.get(town.market.nodeId)!.position] as Vec3,
  };
  const sees = (eye: Vec3, target: Vec3) => {
    const span = Math.hypot(target[0] - eye[0], target[2] - eye[2]), steps = Math.ceil(span / 1.5);
    for (let k = 1; k < steps; k++) {
      const t = k / steps, x = eye[0] + (target[0] - eye[0]) * t, z = eye[2] + (target[2] - eye[2]) * t, y = eye[1] + (target[1] - eye[1]) * t;
      if (span * t < 2 || span * (1 - t) < 3) continue;
      let top = ground(x, z);
      for (const lot of lots.at(x, z)) if (rectangleDistance(lot, x, z) <= 0) top += 7;
      if (y < top) return false;
    }
    return true;
  };
  const allStreets = new Map([...publicStreets, ...streets].map(street => [street.id, street]));
  const walk = (id: string, from: string, to: string, edgeIds: readonly string[], surface: LandPath['surface'],
    reveals: readonly { id: LandViewId; at: 'end' | 'start' | ((eye: Vec3) => boolean) }[],
    views: readonly { after: string; target: Vec3 }[] = []): LandPath => {
    // The walked line, every metre, in the direction of travel.
    const line: Vec3[] = [];
    let at = from;
    for (const edgeId of edgeIds) {
      const edge = allStreets.get(edgeId)!, points = edge.from === at ? edge.points : [...edge.points].reverse();
      if (edge.from !== at && edge.to !== at) throw new Error(`Walk ${id} breaks at ${edgeId}`);
      at = edge.from === at ? edge.to : edge.from;
      for (let k = line.length ? 1 : 0; k < points.length; k++) {
        const a = points[Math.max(0, k - 1)]!, b = points[k]!, n = k ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]))) : 1;
        for (let j = k ? 1 : n; j <= n; j++) line.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, a[2] + (b[2] - a[2]) * j / n]);
      }
    }
    if (at !== to) throw new Error(`Walk ${id} ends at ${at}, not ${to}`);
    const metres = line.map((_, k) => k ? Math.hypot(line[k]![0] - line[k - 1]![0], line[k]![2] - line[k - 1]![2]) : 0).map((sum => (d: number) => sum += d)(0));
    const length = metres.at(-1)!, beats: { at: number; siteId?: string; dressingIndex?: number; reveal?: string }[] = [];
    const nearest = (outline: readonly XZ[] | XZ, within: number) => {
      let best = -1, gap = within;
      for (let k = 0; k < line.length; k++) {
        const d = Array.isArray(outline[0]) ? polygonDistance(outline as readonly XZ[], line[k]![0], line[k]![2]) : distance(outline as XZ, xz(line[k]!));
        if (d < gap) { gap = d; best = k; }
      }
      return best;
    };
    // Bends: where the way turns at least 30° within a dozen metres.
    const heading = (k: number) => { const a = line[Math.max(0, k - 5)]!, b = line[Math.min(line.length - 1, k + 5)]!; return Math.atan2(b[0] - a[0], b[2] - a[2]); };
    let lastBend = -Infinity;
    for (let k = 6; k < line.length - 6; k++) {
      const turn = Math.abs(wrap(heading(k + 6) - heading(k - 6)));
      if (turn >= Math.PI / 6 && turn >= Math.abs(wrap(heading(k + 7) - heading(k - 5))) && turn >= Math.abs(wrap(heading(k + 5) - heading(k - 7))) && metres[k]! - lastBend >= 12) {
        beats.push({ at: metres[k]! }); lastBend = metres[k]!;
      }
    }
    // Street corners where three or more ways meet.
    for (const [k, p] of line.entries()) for (const item of town.nodes) if ((incident.get(item.id)?.length ?? 0) >= 3 && Math.hypot(item.position[0] - p[0], item.position[2] - p[2]) < .5) beats.push({ at: metres[k]! });
    for (const item of sites) { const k = nearest(item.footprint, 10); if (k >= 0) beats.push({ at: metres[k]!, siteId: item.id }); }
    for (const [index, dressing] of dressings.entries()) {
      const k = nearest(dressing.siteId ? site(dressing.siteId).footprint : occupied[index]!, 5);
      if (k >= 0 && !dressing.siteId) beats.push({ at: metres[k]!, dressingIndex: index });
    }
    for (const reveal of reveals) {
      if (reveal.at === 'end' || reveal.at === 'start') { beats.push({ at: reveal.at === 'end' ? length : 0, reveal: reveal.id }); continue; }
      const test = reveal.at, k = line.findIndex(p => test([p[0], p[1] + 1.6, p[2]]));
      if (k >= 0) beats.push({ at: metres[k]!, reveal: reveal.id });
    }
    // Landmarks first coming into sight: hidden where the walk begins, then seen.
    for (const marker of MARKERS) {
      if (reveals.some(reveal => reveal.id === marker.replaces)) continue;
      const target = markers[marker.id], eye = (p: Vec3): Vec3 => [p[0], p[1] + 1.6, p[2]];
      if (sees(eye(line[0]!), target)) continue;
      const k = line.findIndex((p, j) => j % 2 === 0 && sees(eye(p), target));
      if (k > 0) beats.push({ at: metres[k]!, reveal: marker.id });
    }
    // Where a stretch of trail would still run on with nothing to meet, a bench looks out at the best view.
    const targets: Vec3[] = [lakeTargets[0]!, beacon, [mill.position[0] + 5.5, mill.position[1] + 6, mill.position[2] + 4.5], [...places.lookout.summit] as Vec3, [oak[0], places.forest.oak[1] + 10, oak[1]]];
    // Seats are offered only beside the earth trail's own points, where a lay-by can join it.
    const anchorAt = (k: number) => vertices.at(line[k]![0], line[k]![2]).find(item => distance(xz(item.at), xz(line[k]!)) < .05);
    const onTrail = (k: number) => anchorAt(k) !== undefined && dressings.length < 64;
    const seatAt = (k: number, side: number) => {
      const ahead = line[Math.min(line.length - 1, k + 2)]!, facing = Math.atan2(ahead[0] - line[k]![0], ahead[2] - line[k]![2]) + side * Math.PI / 2;
      return { facing, centre: along(xz(line[k]!), facing, setBack('bench', facingTurn(facing), facing)) };
    };
    const sorted = () => [...beats].sort((a, b) => a.at - b.at);
    // A bench just past what a reveal opens up, turned toward it, so a walker can stop and take it in.
    for (const view of views) {
      const met = beats.find(beat => view.after === beat.reveal || view.after === beat.siteId);
      if (!met) continue;
      const seats: { k: number; side: number; score: number }[] = [];
      for (let k = 0; k < line.length - 2; k++) {
        if (metres[k]! < met.at + 3 || metres[k]! > met.at + 30 || !onTrail(k)) continue;
        for (const side of [1, -1]) {
          const { facing, centre } = seatAt(k, side), eye: Vec3 = [centre[0], line[k]![1] + 1.2, centre[1]];
          const off = Math.abs(wrap(Math.atan2(view.target[0] - eye[0], view.target[2] - eye[2]) - facingTurn(facing) * Math.PI / 2));
          if (off < Math.PI / 3 && sees(eye, view.target)) seats.push({ k, side, score: -off - (metres[k]! - met.at) / 25 });
        }
      }
      seats.sort((a, b) => b.score - a.score || a.k - b.k || a.side - b.side);
      for (const seat of seats) {
        const index = bench(anchorAt(seat.k)!, seatAt(seat.k, seat.side).facing);
        if (index !== undefined) { beats.push({ at: metres[seat.k]!, dressingIndex: index }); break; }
      }
    }
    const tried = new Set<string>();
    for (let progressed = true; progressed;) {
      progressed = false;
      const marks = [0, ...sorted().map(beat => beat.at), length];
      for (let g = 1; g < marks.length && !progressed; g++) {
        const from = marks[g - 1]!, until = marks[g]!, key = `${from}:${until}`;
        if (until - from <= BEAT_SPACING || tried.has(key)) continue;
        tried.add(key);
        const seats: { k: number; side: number; score: number }[] = [];
        for (let k = 0; k < line.length - 2; k++) {
          if (metres[k]! < from + 12 || metres[k]! > until - 12 || !onTrail(k)) continue;
          for (const side of [1, -1]) {
            const { facing, centre } = seatAt(k, side), eye: Vec3 = [centre[0], line[k]![1] + 1.2, centre[1]];
            let score = -Math.abs(metres[k]! - (from + until) / 2) / 30;
            for (const target of targets)
              if (Math.abs(wrap(Math.atan2(target[0] - eye[0], target[2] - eye[2]) - facingTurn(facing) * Math.PI / 2)) < Math.PI * .3 && sees(eye, target)) score += 2;
            seats.push({ k, side, score });
          }
        }
        seats.sort((a, b) => b.score - a.score || a.k - b.k || a.side - b.side);
        for (const seat of seats) {
          const index = bench(anchorAt(seat.k)!, seatAt(seat.k, seat.side).facing);
          if (index !== undefined) { beats.push({ at: metres[seat.k]!, dressingIndex: index }); progressed = true; break; }
        }
      }
    }
    // One beat per moment: the same place met twice keeps its first reason.
    const seen = new Set<string>();
    const unique = sorted().filter(beat => {
      const key = beat.siteId ?? (beat.dressingIndex !== undefined ? `d${beat.dressingIndex}` : beat.reveal ?? '');
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    }).filter((beat, k, all) => beat.siteId || beat.dressingIndex !== undefined || beat.reveal || !all.some((other, j) => j !== k && Math.abs(other.at - beat.at) < 6 && (other.siteId || other.dressingIndex !== undefined || other.reveal || j < k)));
    return { id, from, to, edgeIds: [...edgeIds], surface, length: round8(length), beats: unique.map(beat => ({ ...beat, at: round8(beat.at) })) };
  };

  const oakWay = townWay(forest.start.id), homeWay = townWay(home.id).reverse();
  const wheel = site('water:wheel'), wheelHub = transformCardinalPoint(wheel.position, wheel.turn, [1.25, 2.5, 3.5]);
  // The gate's own opening at court level: hidden by the brow until the last turn of the climb.
  const gate: Vec3 = [places.court.gate[0], places.court.gate[1] + 2, places.court.gate[2] + .5];
  const paths: LandPath[] = [
    walk('walk:court', town.market.nodeId, castle.gateNodeId, courtWay, 'paving', [
      { id: 'crown-road-bend', at: eye => sees(eye, gate) }, { id: 'court-wall-walk', at: 'end' }]),
    walk('walk:pier', town.market.nodeId, pierHead, [...toBridge.way, 'land:millstream-walk', 'land:bridge', 'land:shore-path', ...footWay, 'land:pier'], 'packed-earth', [
      { id: 'lake-reveal', at: eye => lakeTargets.filter(target => sees(eye, target)).length >= 2 }, { id: 'bridge', at: eye => distance(xz(eye), [(westLanding[0] + eastLanding[0]) / 2, deckZ]) < 1 },
      { id: 'pier-end', at: 'end' }], [{ after: 'water:wheel', target: wheelHub }, { after: 'lake-reveal', target: lakeTargets[0]! }]),
    walk('walk:lookout', landing, summit, [...footWay, 'land:lookout'], 'packed-earth', [{ id: 'lookout', at: 'end' }], [{ after: 'beacon', target: beacon }]),
    walk('walk:clearing', town.market.nodeId, clearingEntry, [...oakWay, 'land:oak-path'], 'trodden-grass', [
      { id: 'forest-approach', at: eye => distance(xz(eye), oak) < OAK_ROOT_CLEARANCE + half + 2.5 }, { id: 'clearing-gap', at: 'end' }]),
    walk('walk:homeward', clearingEntry, town.market.nodeId, ['land:clearing-round', 'land:beacon-path', ...homeWay], 'trodden-grass', [
      { id: 'clearing-gap', at: eye => distance(xz(eye), along(clearing, gapBearing, clearingRadius)) < 1 }]),
    // When the pier walk does not pass the mill, the mill is a walk of its own.
    ...(bank ? [] : [walk('walk:mill', town.market.nodeId, millDoor, [...townWay(millStart.id), 'land:mill-walk'], 'packed-earth', [], [{ after: 'water:wheel', target: wheelHub }])]),
  ];
  // Each lay-by joins its trail at a node: the trail is cut there, and every walk takes the parts in order.
  const parts = new Map<string, string[]>();
  for (const [edgeId, group] of [...new Set(pads.map(pad => pad.edgeId))].map(edgeId => [edgeId, pads.filter(pad => pad.edgeId === edgeId).sort((a, b) => a.vertex - b.vertex)] as const)) {
    const index = streets.findIndex(street => street.id === edgeId), edge = streets[index]!, made: StreetEdge[] = [];
    let from = edge.from, begin = 0;
    for (const pad of group) {
      const foot = node(`land:bench:${pad.index}:foot`, [...edge.points[pad.vertex]!] as Vec3);
      made.push({ ...edge, id: `${edgeId}:${made.length + 1}`, from, to: foot, points: edge.points.slice(begin, pad.vertex + 1) });
      from = foot; begin = pad.vertex;
    }
    made.push({ ...edge, id: `${edgeId}:${made.length + 1}`, from, points: edge.points.slice(begin) });
    streets.splice(index, 1, ...made);
    parts.set(edgeId, made.map(part => part.id));
  }
  for (const pad of pads) {
    const seat = node(`land:bench:${pad.index}`, pad.points.at(-1)!, 'frontier');
    streets.push({ id: `land:bench:${pad.index}`, from: `land:bench:${pad.index}:foot`, to: seat, kind: 'trail', name: 'Bench', points: pad.points, width: TRAIL_WIDTH, verge: 0 });
  }
  const split = paths.map(path => {
    let at = path.from;
    const edgeIds = path.edgeIds.flatMap(edgeId => {
      const original = allStreets.get(edgeId)!, forward = original.from === at;
      at = forward ? original.to : original.from;
      const list = parts.get(edgeId) ?? [edgeId];
      return forward ? list : [...list].reverse();
    });
    return { ...path, edgeIds };
  });
  return { nodes, streets, paths: split, dressings, footways };

  /**
   * Crown Road up the castle rise: legs that ride the slope at a steady grade, a hairpin uphill wherever a leg
   * meets a lot, a street or its own earlier bend, then along the brow to the gate.
   */
  function crownRoad(): string {
    const rise = landform.hills.find(hill => hill.id === 'castle-rise')!, market = town.market, gateAt = xz(places.court.gate);
    const marketCentre = xz(nodeById.get(market.nodeId)!.position), width = CROWN_ROAD.width / 2 + CROWN_ROAD.verge, hairpin = 7.5;
    // Leave the square from the middle of the side facing the castle.
    const rim: XZ[] = [];
    for (let k = 0; k < market.boundary.length; k++) {
      const a = market.boundary[k]!, b = market.boundary[(k + 1) % market.boundary.length]!, n = Math.ceil(distance(a, b));
      for (let j = 0; j < n; j++) rim.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
    const start = [...rim].sort((p, q) => distance(p, rise.centre) - distance(q, rise.centre) || p[0] - q[0])[0]!;
    const clear = (p: XZ) => open(p[0], p[1], [{ at: start, radius: 6 }], width) && (distance(p, start) < 6 || polygonDistance(market.boundary, p[0], p[1]) > width);
    const options: { path: XZ[]; heights: number[] }[] = [];
    // The castle fills its plateau, so the road climbs the rise's face: out along the lower slope, one hairpin
    // partway up, and back along the brow's contour to the front. Each turning level and side is tried.
    const turning = [.5, .42, .58, .34, .66, 1].flatMap(fraction => [1, -1].map(first => ({ first, at: market.elevation + fraction * (rise.height - market.elevation), forced: fraction < 1 })));
    for (const { first, at: turnLevel, forced } of turning) {
      // A short stub straight out of the square, then the legs.
      const out = distance(start, rise.centre), climb: XZ[] = [], heights: number[] = [];
      for (let j = 0; j <= 3; j++) { climb.push([start[0] + (rise.centre[0] - start[0]) * j / out, start[1] + (rise.centre[1] - start[1]) * j / out]); heights.push(market.elevation + CROWN_ROAD.grade * j); }
      let turn = first, bends = 0, leg = 0;
      // Earlier legs stay clear by both reaches plus a cut bank no steeper than three in two between their levels:
      // a castle mound's terraced face, within the terrain skin's two metres per metre.
      const apart = (p: XZ, level: number, recent = 14) => climb.slice(0, -recent).every((q, j) => distance(q, p) >= width * 2 + Math.max(3, Math.abs(level - heights[j]!) / 1.5));
      const rise1 = () => Math.min(rise.height, heights.at(-1)! + CROWN_ROAD.grade);
      while (heights.at(-1)! < rise.height && climb.length < 500) {
        const p = climb.at(-1)!, radius = distance(p, rise.centre), angle = Math.atan2(p[1] - rise.centre[1], p[0] - rise.centre[0]), level = rise1();
        let best: { at: XZ; error: number } | undefined;
        // Never back down the slope: a road cut into the hill keeps climbing into it.
        for (let k = 0; k <= 24; k++) {
          const dr = -k / 24, next = radius + dr, nextAngle = angle + turn * Math.sqrt(Math.max(0, 1 - dr * dr)) / Math.max(next, 1);
          const at: XZ = [rise.centre[0] + Math.cos(nextAngle) * next, rise.centre[1] + Math.sin(nextAngle) * next];
          if (!clear(at) || !apart(at, level)) continue;
          const error = Math.abs(ground(...at) - level);
          if (!best || error < best.error - 1e-9) best = { at, error };
        }
        if (best && !(forced && bends === 0 && level >= turnLevel)) { climb.push(best.at); heights.push(level); continue; }
        // Blocked: turn uphill through a hairpin and ride back the other way.
        if (++bends > 4 || climb.length < 2) break;
        const inward: XZ = [(rise.centre[0] - p[0]) / radius, (rise.centre[1] - p[1]) / radius], hub: XZ = [p[0] + inward[0] * hairpin, p[1] + inward[1] * hairpin];
        const from = Math.atan2(p[1] - hub[1], p[0] - hub[0]), travel: XZ = [p[0] - climb.at(-2)![0], p[1] - climb.at(-2)![1]];
        const sense = -Math.sin(from) * travel[0] + Math.cos(from) * travel[1] > 0 ? 1 : -1, steps = Math.ceil(Math.PI * hairpin);
        const arc = Array.from({ length: steps }, (_, j) => { const a = from + sense * Math.PI * (j + 1) / steps; return [hub[0] + Math.cos(a) * hairpin, hub[1] + Math.sin(a) * hairpin] as XZ; });
        if (!arc.every((at, j) => clear(at) && apart(at, Math.min(rise.height, heights.at(-1)! + CROWN_ROAD.grade * (j + 1))))) break;
        for (const at of arc) { climb.push(at); heights.push(rise1()); }
        turn = -turn; leg = climb.length;
      }
      if (heights.at(-1)! < rise.height || distance(climb.at(-1)!, rise.centre) > rise.plateau + 4) continue;
      // Along the brow to the forecourt before the gate, then straight in: the gate shows itself at the last turn.
      // The brow keeps to the plateau, where court level is the ground itself, clear of the legs below; the last
      // leg is the road it continues, not a leg below it.
      const forecourt: XZ = [gateAt[0], gateAt[1] + 9];
      const below = (p: XZ) => climb.slice(0, leg).every((q, j) => distance(q, p) >= width * 2 + Math.max(3, (rise.height - heights[j]!) / 1.5));
      const brow = traceRoute(climb.at(-1)!, forecourt, (x, z) => open(x, z, [], width) && below([x, z])
        && (distance([x, z], rise.centre) <= rise.plateau - 1 || distance([x, z], climb.at(-1)!) < 6), ground);
      if (!brow) continue;
      const path = chain(climb, brow, straight(forecourt, gateAt));
      options.push({ path, heights: [...heights, ...path.slice(climb.length).map(() => rise.height)] });
    }
    const chosen = options.sort((a, b) => a.path.length - b.path.length)[0];
    if (!chosen) throw new Error('Crown Road finds no clear climb around the castle rise');
    const points = [nodeById.get(market.nodeId)!.position, ...chosen.path.map((p, k) => [round8(p[0]), round8(chosen.heights[k]!), round8(p[1])] as Vec3)]
      .filter((_, k, all) => k % 2 === 0 || k === all.length - 1);
    points[0] = [marketCentre[0], market.elevation, marketCentre[1]];
    streets.push({ id: 'land:crown-road', from: market.nodeId, to: castle.gateNodeId, kind: 'main', name: 'Crown Road', points, width: CROWN_ROAD.width, verge: CROWN_ROAD.verge });
    addWay(points.map(xz), width);
    if (!nodeById.has(castle.gateNodeId)) node(castle.gateNodeId, [...places.court.gate] as Vec3, 'castle-gate');
    return 'land:crown-road';
  }
}
