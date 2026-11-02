import { CAMPFIRE_CLEARING_ID, createCampfireClearing } from '@chatdom/content/campfire';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { samplePublicGround, terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '../founded/collision';

/*
 * The kingdom's campfire clearing on founded land. One authored piece (packages/content/src/campfire) is put at the
 * edge of the town toward the woods, on one physical terrain height, clear of everything installed or reserved, and
 * reachable on foot from the nearest street. A kingdom with no such ground gets no clearing, never a substitute.
 */

const M = VOXEL_METRES.build;
type XZ = readonly [number, number];
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export interface ClearingHostPiece {
  readonly id: string; readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly rotation: CardinalTurn; readonly plotId?: string;
}
export interface ClearingPiece { id: string; blueprint: VoxelBlueprint; position: Vec3; rotation: CardinalTurn }

export interface CampfireClearingSite {
  readonly piece: ClearingPiece;
  /** The hearth centre on the ground, world metres: the clearing frame's origin. */
  readonly hearth: Vec3;
  readonly rotation: CardinalTurn;
  /** Metres from the hearth to the nearest home's footprint. */
  readonly nearestHome: number;
  /** The active street the footpath starts on, and the walk's length to the clearing's gap. */
  readonly street: { readonly id: string; readonly walk: number };
  /** Standing waypoints on the physical terrain, world XZ, from the street to just outside the footpath gap. */
  readonly footpath: readonly XZ[];
}

/** How far from the nearest home the fire may sit: out of the gardens, still in sight of the windows. */
export const CLEARING_HOME_DISTANCE = { min: 20, max: 60, ideal: 30 } as const;
/** Flat, clear ground kept beyond the clearing's own radius. */
const MARGIN = 1;
/**
 * The drawn ground under the furniture may stray from the physical floor by at most this much. Physical floors are
 * half-metre steps of the same surface, so a level patch always undulates a little; the clearing's pieces are sunk
 * two rows (a quarter metre) so a dip never shows daylight, and a rise never buries more than a sliver of a log.
 */
const SURFACE_TOLERANCE = .1875;
/** The longest footpath the site may need, measured straight to the street's centre line. */
const MAX_STREET = 35;
const EYE = 1.6;
const BODY = WALK_BODY.radius + .05;

/* ---------- Small geometry ---------- */

function boundsOf(points: readonly Vec3[]): Bounds {
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) };
}
const grow = (b: Bounds, by: number): Bounds => ({ minX: b.minX - by, maxX: b.maxX + by, minZ: b.minZ - by, maxZ: b.maxZ + by });
const overlaps = (a: Bounds, b: Bounds) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** Distance from a point to a rectangle, zero inside. */
const boxDistance = (b: Bounds, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
function segmentDistance(a: Vec3, b: Vec3, x: number, z: number): number {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
}

/** Items bucketed by the 8 m squares their bounds touch. */
class Buckets<T> {
  private readonly cells = new Map<string, T[]>();
  constructor(private readonly size = 8) {}
  add(item: T, b: Bounds): void {
    for (let z = Math.floor(b.minZ / this.size); z <= Math.floor(b.maxZ / this.size); z++)
      for (let x = Math.floor(b.minX / this.size); x <= Math.floor(b.maxX / this.size); x++) {
        const key = `${x},${z}`, list = this.cells.get(key);
        if (list) list.push(item); else this.cells.set(key, [item]);
      }
  }
  at(x: number, z: number): readonly T[] { return this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`) ?? []; }
  near(b: Bounds): T[] {
    const seen = new Set<T>();
    for (let z = Math.floor(b.minZ / this.size); z <= Math.floor(b.maxZ / this.size); z++)
      for (let x = Math.floor(b.minX / this.size); x <= Math.floor(b.maxX / this.size); x++)
        for (const item of this.cells.get(`${x},${z}`) ?? []) seen.add(item);
    return [...seen];
  }
}

/** Local solid bounds of a blueprint, in build cells, cached per blueprint object. */
const localBounds = new WeakMap<VoxelBlueprint, { min: Vec3; max: Vec3 } | null>();
function solidBounds(blueprint: VoxelBlueprint): { min: Vec3; max: Vec3 } | null {
  if (localBounds.has(blueprint)) return localBounds.get(blueprint)!;
  let result: { min: [number, number, number]; max: [number, number, number] } | null = null;
  for (const box of blueprint.boxes) {
    if (!box.material) continue;
    if (!result) result = { min: [box.from[0], box.from[1], box.from[2]], max: [box.to[0], box.to[1], box.to[2]] };
    else for (let axis = 0; axis < 3; axis++) { result.min[axis] = Math.min(result.min[axis]!, box.from[axis]!); result.max[axis] = Math.max(result.max[axis]!, box.to[axis]!); }
  }
  localBounds.set(blueprint, result);
  return result;
}
/** World footprint of a piece's solid boxes. */
function footprint(piece: ClearingHostPiece): Bounds | null {
  const local = solidBounds(piece.blueprint);
  if (!local) return null;
  return boundsOf([local.min[0], local.max[0]].flatMap(x => [local.min[2], local.max[2]].map(z =>
    transformCardinalPoint(piece.position, piece.rotation, [x * M, 0, z * M]))));
}

/** World solid boxes of the pieces near a window, for body tests against the installed geometry. */
interface Solid { readonly min: Vec3; readonly max: Vec3 }
function solidsNear(pieces: readonly ClearingHostPiece[], window: Bounds): Buckets<Solid> {
  const index = new Buckets<Solid>(2);
  for (const piece of pieces) {
    const area = footprint(piece);
    if (!area || !overlaps(area, window)) continue;
    for (const box of piece.blueprint.boxes) {
      if (!box.material) continue;
      const a = transformCardinalPoint(piece.position, piece.rotation, [box.from[0] * M, box.from[1] * M, box.from[2] * M]);
      const b = transformCardinalPoint(piece.position, piece.rotation, [box.to[0] * M, box.to[1] * M, box.to[2] * M]);
      const solid: Solid = { min: [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])] };
      if (!overlaps({ minX: solid.min[0], maxX: solid.max[0], minZ: solid.min[2], maxZ: solid.max[2] }, window)) continue;
      index.add(solid, { minX: solid.min[0], maxX: solid.max[0], minZ: solid.min[2], maxZ: solid.max[2] });
    }
  }
  return index;
}

/* ---------- The site ---------- */

/**
 * The clearing's site on this founded plan, or null. Candidates sit on a metre grid round the town; the cheap
 * exclusions (homes, reserved lots, castle, lake, streets, installed pieces, public ground) run first, then the best
 * scored candidates are proven: one physical height across the clearing and its margin with the drawn ground close
 * under the furniture, the town in sight over the terrain, and a footpath on half-metre terrain cells from the
 * clearing's gap to an active street with no step over half a metre and room for a body all the way.
 */
export function campfireClearingSite(plan: SettlementPlan, pieces: readonly ClearingHostPiece[]): CampfireClearingSite | null {
  if (plan.version !== 2 || plan.landform.version !== 1 || pieces.some(piece => piece.id === CAMPFIRE_CLEARING_ID)) return null;
  const clearing = createCampfireClearing(), R = clearing.radius;
  const homes = pieces.filter(piece => piece.plotId && piece.blueprint.kind === 'home').map(footprint).filter((b): b is Bounds => !!b);
  if (!homes.length) return null;
  const centreOf = (b: Bounds): XZ => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const town = homes.map(centreOf).reduce<[number, number]>((sum, c) => [sum[0] + c[0] / homes.length, sum[1] + c[1] / homes.length], [0, 0]);

  // Everything the clearing must keep clear of, bucketed by where it could matter.
  const keepOut = new Buckets<(x: number, z: number) => boolean>();
  for (const piece of pieces) {
    const area = footprint(piece);
    if (area) keepOut.add((x, z) => boxDistance(area, x, z) < R + MARGIN, grow(area, R + MARGIN));
  }
  for (const reservation of plan.reservations) keepOut.add((x, z) => boxDistance(reservation.lot, x, z) < R + 2, grow(reservation.lot, R + 2));
  for (const street of plan.streets) {
    const reach = street.width / 2 + street.verge + R + MARGIN;
    street.points.forEach((point, i) => {
      if (!i) return;
      const a = street.points[i - 1]!;
      keepOut.add((x, z) => segmentDistance(a, point, x, z) < reach, grow(boundsOf([a, point]), reach));
    });
  }
  const flora = new Buckets<XZ>(), streets = new Buckets<{ x: number; z: number; id: string; half: number }>();
  for (const piece of pieces) if (piece.blueprint.kind === 'flora') { const area = footprint(piece); if (area) { const c = centreOf(area); flora.add(c, { minX: c[0], maxX: c[0], minZ: c[1], maxZ: c[1] }); } }
  const active = new Set(plan.activeStreetIds);
  for (const street of plan.streets) {
    if (!active.has(street.id)) continue;
    street.points.forEach((point, i) => {
      if (!i) return;
      const a = street.points[i - 1]!, steps = Math.max(1, Math.ceil(Math.hypot(point[0] - a[0], point[2] - a[2]) / .5));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
        const x = a[0] + (point[0] - a[0]) * s / steps, z = a[2] + (point[2] - a[2]) * s / steps;
        streets.add({ x, z, id: street.id, half: street.width / 2 }, { minX: x, maxX: x, minZ: z, maxZ: z });
      }
    });
  }
  const nearestStreet = (x: number, z: number, within: number) => {
    let best: { x: number; z: number; id: string; half: number } | undefined, distance = within;
    for (const point of streets.near({ minX: x - within, maxX: x + within, minZ: z - within, maxZ: z + within })) {
      const d = Math.hypot(point.x - x, point.z - z);
      if (d < distance || (d === distance && best && (point.x < best.x || (point.x === best.x && point.z < best.z)))) { best = point; distance = d; }
    }
    return best ? { point: best, distance } : undefined;
  };

  const span = grow(homes.reduce((all, b) => ({ minX: Math.min(all.minX, b.minX), maxX: Math.max(all.maxX, b.maxX),
    minZ: Math.min(all.minZ, b.minZ), maxZ: Math.max(all.maxZ, b.maxZ) })), CLEARING_HOME_DISTANCE.max + R);
  const known = grow(plan.bounds, -(R + 8)), castle = plan.castle.bounds, lake = plan.lake;
  const candidates: { x: number; z: number; score: number; home: number; nearest: Bounds; street: number }[] = [];
  for (let z = Math.ceil(Math.max(span.minZ, known.minZ)); z <= Math.min(span.maxZ, known.maxZ); z++)
    for (let x = Math.ceil(Math.max(span.minX, known.minX)); x <= Math.min(span.maxX, known.maxX); x++) {
      let home = Infinity, nearest = homes[0]!;
      for (const b of homes) { const d = boxDistance(b, x, z); if (d < home) { home = d; nearest = b; } }
      if (home < CLEARING_HOME_DISTANCE.min || home > CLEARING_HOME_DISTANCE.max) continue;
      // At the edge of the town, beyond its nearest home rather than in a gap between homes.
      const [hx, hz] = centreOf(nearest);
      if (Math.hypot(x - town[0], z - town[1]) < Math.hypot(hx - town[0], hz - town[1]) + 6) continue;
      if (boxDistance(castle, x, z) < R + 6) continue;
      if (Math.hypot((x - lake.x) / (lake.radiusX + R + 3), (z - lake.z) / (lake.radiusZ + R + 3)) < 1) continue;
      if (keepOut.at(x, z).some(test => test(x, z))) continue;
      if ((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity) < R + MARGIN) continue;
      const street = nearestStreet(x, z, MAX_STREET);
      if (!street) continue;
      const woods = flora.near({ minX: x - 30, maxX: x + 30, minZ: z - 30, maxZ: z + 30 }).filter(c => Math.hypot(c[0] - x, c[1] - z) <= 30).length;
      candidates.push({ x, z, home, nearest, street: street.distance,
        score: street.distance + .4 * Math.abs(home - CLEARING_HOME_DISTANCE.ideal) - 1.5 * Math.min(woods, 8) });
    }
  candidates.sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z);

  const physical = (x: number, z: number) => foundedGroundAt(plan, x, z)[1];
  const level = (x: number, z: number, h: number): boolean => {
    const outer = R + MARGIN, inner = R - .75;
    for (let cz = Math.floor((z - outer) * 2); cz < Math.ceil((z + outer) * 2); cz++)
      for (let cx = Math.floor((x - outer) * 2); cx < Math.ceil((x + outer) * 2); cx++) {
        const px = (cx + .5) / 2, pz = (cz + .5) / 2, d = Math.hypot(px - x, pz - z);
        if (d > outer + .36) continue;
        if (physical(px, pz) !== h) return false;
        if (d < inner && Math.abs(terrainHeight(plan, px, pz) - h) > SURFACE_TOLERANCE) return false;
      }
    return true;
  };
  const inSight = (x: number, z: number, h: number, home: Bounds): boolean => {
    const [hx, hz] = centreOf(home), target = physical(hx, hz) + 3, from = h + EYE, length = Math.hypot(hx - x, hz - z);
    for (let t = 1; t < length - 4; t += 1) {
      const f = t / length;
      if (terrainHeight(plan, x + (hx - x) * f, z + (hz - z) * f) > from + (target - from) * f - .1) return false;
    }
    return true;
  };

  const entryZ = clearing.seats[0]!.approach[0]![1];
  for (const candidate of candidates) {
    const { x, z } = candidate, h = physical(x, z);
    if (!level(x, z, h)) continue;
    if (!inSight(x, z, h, candidate.nearest)) continue;
    // The open side faces the town: the cardinal turn nearest to the nearest home.
    const [hx, hz] = centreOf(candidate.nearest), toward = [hx - x, hz - z] as const;
    const rotation = ([0, 1, 2, 3] as const).map(turn => {
      const front = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
      return { turn, dot: front[0] * toward[0] + front[2] * toward[1] };
    }).sort((a, b) => b.dot - a.dot || a.turn - b.turn)[0]!.turn;
    const hearth: Vec3 = [x, h, z], pivot = clearing.pivot;
    const offset = transformCardinalPoint([0, 0, 0], rotation, [pivot[0] * M, pivot[1] * M, pivot[2] * M]);
    const piece: ClearingPiece = { id: CAMPFIRE_CLEARING_ID, blueprint: clearing.blueprint, position: [x - offset[0], h - offset[1], z - offset[2]], rotation };
    const entry = transformCardinalPoint(hearth, rotation, [0, 0, entryZ]);
    const footpath = walkTo(plan, [...pieces, piece], [entry[0], entry[2]], nearestStreet, candidate.street);
    if (!footpath) continue;
    return { piece, hearth, rotation, nearestHome: candidate.home, street: { id: footpath.street, walk: footpath.length }, footpath: footpath.points };
  }
  return null;
}

/**
 * Breadth-first walk on half-metre terrain cells from the clearing's gap to the nearest active street's carriageway:
 * every cell holds a whole body clear of installed solids above its own physical floor and out of the lake, and
 * every move, diagonals included, climbs or drops at most one step. The cell route is then pulled straight where a
 * body can walk the straight line, checked every eighth of a metre.
 */
function walkTo(plan: SettlementPlan, pieces: readonly ClearingHostPiece[], start: XZ,
  nearestStreet: (x: number, z: number, within: number) => { point: { x: number; z: number; id: string; half: number }; distance: number } | undefined,
  streetDistance: number): { points: XZ[]; street: string; length: number } | null {
  const reach = streetDistance + 18, window: Bounds = { minX: start[0] - reach, maxX: start[0] + reach, minZ: start[1] - reach, maxZ: start[1] + reach };
  const solids = solidsNear(pieces, grow(window, 1)), lake = plan.lake;
  const floor = (x: number, z: number) => foundedGroundAt(plan, x, z)[1];
  const clear = (x: number, z: number): boolean => {
    if (Math.hypot((x - lake.x) / (lake.radiusX + 1), (z - lake.z) / (lake.radiusZ + 1)) < 1) return false;
    let h = -Infinity;
    for (const dx of [-BODY, BODY]) for (const dz of [-BODY, BODY]) h = Math.max(h, floor(x + dx, z + dz));
    for (const solid of solids.near({ minX: x - BODY, maxX: x + BODY, minZ: z - BODY, maxZ: z + BODY }))
      if (solid.min[0] < x + BODY && solid.max[0] > x - BODY && solid.min[2] < z + BODY && solid.max[2] > z - BODY
        && solid.max[1] > h + .02 && solid.min[1] < h + WALK_BODY.height) return false;
    return true;
  };
  const key = (i: number, k: number) => `${i},${k}`, centre = (i: number, k: number): XZ => [(i + .5) / 2, (k + .5) / 2];
  const si = Math.floor(start[0] * 2), sk = Math.floor(start[1] * 2);
  const parent = new Map<string, string | null>([[key(si, sk), null]]), queue: [number, number][] = [[si, sk]];
  const passable = new Map<string, boolean>();
  const open = (i: number, k: number) => {
    const id = key(i, k);
    let value = passable.get(id);
    if (value === undefined) {
      const [x, z] = centre(i, k);
      value = x > window.minX && x < window.maxX && z > window.minZ && z < window.maxZ && clear(x, z);
      passable.set(id, value);
    }
    return value;
  };
  const step = (a: XZ, b: XZ) => Math.abs(floor(a[0], a[1]) - floor(b[0], b[1])) <= WALK_BODY.stepHeight;
  let goal: { i: number; k: number; street: string } | undefined;
  for (let head = 0; head < queue.length && !goal; head++) {
    const [i, k] = queue[head]!, here = centre(i, k);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ni = i + di, nk = k + dk, id = key(ni, nk);
      if (parent.has(id) || !open(ni, nk)) continue;
      const there = centre(ni, nk);
      if (!step(here, there)) continue;
      if (di && dk && !(open(i + di, k) && open(i, k + dk) && step(here, centre(i + di, k)) && step(here, centre(i, k + dk)))) continue;
      parent.set(id, key(i, k)); queue.push([ni, nk]);
      const street = nearestStreet(there[0], there[1], 4);
      if (street && street.distance <= street.point.half - WALK_BODY.radius - .25) { goal = { i: ni, k: nk, street: street.point.id }; break; }
    }
  }
  if (!goal) return null;
  const cells: XZ[] = [];
  for (let id: string | null = key(goal.i, goal.k); id; id = parent.get(id) ?? null) {
    const [i, k] = id.split(',').map(Number) as [number, number];
    cells.push(centre(i, k));
  }
  cells[cells.length - 1] = start;
  // Pull the route straight wherever a body can walk the straight line without a taller step.
  const straight = (a: XZ, b: XZ): boolean => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / M));
    let last = a;
    for (let s = 1; s <= steps; s++) {
      const p: XZ = [a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps];
      if (!clear(p[0], p[1])) return false;
      if (!step(last, p)) return false;
      last = p;
    }
    return true;
  };
  const points: XZ[] = [cells[0]!];
  for (let at = 0; at < cells.length - 1;) {
    let next = at + 1;
    for (let far = cells.length - 1; far > at + 1; far--) if (straight(cells[at]!, cells[far]!)) { next = far; break; }
    points.push(cells[next]!);
    at = next;
  }
  let length = 0;
  for (let n = 1; n < points.length; n++) length += Math.hypot(points[n]![0] - points[n - 1]![0], points[n]![1] - points[n - 1]![1]);
  return { points, street: goal.street, length };
}

/** Zero or one piece: the campfire clearing, appended after every other founded piece. */
export function campfireClearingPieces(plan: SettlementPlan, pieces: readonly ClearingHostPiece[]): ClearingPiece[] {
  const site = campfireClearingSite(plan, pieces);
  return site ? [site.piece] : [];
}
