import type { Vec3 } from '@chatdom/shared';
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';
import { randomUnit, seedHash } from '../layout';
import { expandBounds, homeFrame, pointBounds, SpatialIndex, transformCardinalPoint } from '../settlement/geometry';
import { settlementTerrainHeight } from '../settlement/terrain';
import type { BoundsXZ, SettlementPlan, StreetEdge, XZ } from '../settlement/types';
import type { CitizenDestination, CitizenRoute } from './types';

const BODY_RADIUS = .28;
const DOOR_CLEARANCE = .55;
const EPSILON = 1e-8;
interface Link { edge: StreetEdge; other: string; length: number }
interface Parent { edge: StreetEdge; previous: string }
const length2 = (a: XZ, b: XZ): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const xz = (p: Vec3): XZ => [p[0], p[2]];

/** A deterministic heap avoids a whole-graph scan per home or per frame. */
class MinQueue {
  private readonly values: { node: string; distance: number }[] = [];
  push(node: string, distance: number): void {
    const item = { node, distance }; this.values.push(item);
    let i = this.values.length - 1;
    while (i) {
      const parent = (i - 1) >> 1;
      if (this.values[parent]!.distance <= distance) break;
      this.values[i] = this.values[parent]!; i = parent;
    }
    this.values[i] = item;
  }
  pop(): { node: string; distance: number } | undefined {
    const first = this.values[0], last = this.values.pop();
    if (!first || !this.values.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.values.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.values.length && this.values[child + 1]!.distance < this.values[child]!.distance) child++;
      if (this.values[child]!.distance >= last!.distance) break;
      this.values[i] = this.values[child]!; i = child;
    }
    this.values[i] = last!; return first;
  }
}

function shortestPaths(plan: SettlementPlan, root = plan.market.nodeId): { parents: Map<string, Parent>; distances: Map<string, number> } {
  const active = new Set(plan.activeStreetIds), adjacency = new Map<string, Link[]>();
  for (const edge of [...plan.streets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (!active.has(edge.id)) continue;
    let length = 0;
    for (let i = 1; i < edge.points.length; i++) length += length2(xz(edge.points[i - 1]!), xz(edge.points[i]!));
    for (const [node, other] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const list = adjacency.get(node!) ?? []; list.push({ edge, other: other!, length }); adjacency.set(node!, list);
    }
  }
  const distances = new Map([[root, 0]]), parents = new Map<string, Parent>();
  const queue = new MinQueue(); queue.push(root, 0);
  for (let next = queue.pop(); next; next = queue.pop()) {
    if (next.distance !== distances.get(next.node)) continue;
    for (const link of adjacency.get(next.node) ?? []) {
      const distance = next.distance + link.length;
      if (distance >= (distances.get(link.other) ?? Infinity) - EPSILON) continue;
      distances.set(link.other, distance); parents.set(link.other, { edge: link.edge, previous: next.node });
      queue.push(link.other, distance);
    }
  }
  return { parents, distances };
}

function trimEnd(points: readonly XZ[], remove: number): XZ[] {
  const result = [...points];
  while (result.length > 1 && remove > 0) {
    const b = result.pop()!, a = result.at(-1)!, length = length2(a, b);
    if (length > remove) {
      const t = (length - remove) / length;
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); break;
    }
    remove -= length;
  }
  return result;
}

function roundCorners(points: readonly XZ[]): XZ[] {
  const result: XZ[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const ab = length2(a, b), bc = length2(b, c), radius = Math.min(.4, ab * .3, bc * .3);
    if (radius < EPSILON) continue;
    const start: XZ = [b[0] + (a[0] - b[0]) * radius / ab, b[1] + (a[1] - b[1]) * radius / ab];
    const end: XZ = [b[0] + (c[0] - b[0]) * radius / bc, b[1] + (c[1] - b[1]) * radius / bc];
    for (let j = 0; j <= 4; j++) {
      const t = j / 4, s = 1 - t;
      result.push([s * s * start[0] + 2 * s * t * b[0] + t * t * end[0], s * s * start[1] + 2 * s * t * b[1] + t * t * end[1]]);
    }
  }
  result.push(points.at(-1)!); return result;
}

function lane(points: readonly XZ[], offset: number, preserveStart = false): XZ[] {
  let remaining = 0;
  for (let i = 1; i < points.length; i++) remaining += length2(points[i - 1]!, points[i]!);
  const total = remaining;
  return points.map((p, i) => {
    if (i) remaining -= length2(points[i - 1]!, p);
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const length = length2(a, b), t = Math.max(0, Math.min(1, remaining / 2));
    const startT = preserveStart ? Math.max(0, Math.min(1, (total - remaining) / 2)) : 1;
    const fade = t * t * (3 - 2 * t) * startT * startT * (3 - 2 * startT), amount = length ? offset * fade / length : 0;
    return [p[0] + (b[1] - a[1]) * amount, p[1] - (b[0] - a[0]) * amount];
  });
}

function intersects(a: XZ, b: XZ, bounds: BoundsXZ): boolean {
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[a[0], b[0], bounds.minX, bounds.maxX], [a[1], b[1], bounds.minZ, bounds.maxZ]]) {
    const delta = end! - start!;
    if (Math.abs(delta) < EPSILON) { if (start! < min! || start! > max!) return false; continue; }
    const x = (min! - start!) / delta, y = (max! - start!) / delta;
    low = Math.max(low, Math.min(x, y)); high = Math.min(high, Math.max(x, y));
    if (low > high) return false;
  }
  return true;
}

/** Every split is inside one rendered 00→11 terrain triangle: linear Y is exact. */
function conformToTerrain(plan: SettlementPlan, route: readonly XZ[]): Vec3[] {
  const result: Vec3[] = [];
  const append = (x: number, z: number): void => { result.push([x, settlementTerrainHeight(plan, x, z), z]); };
  append(...route[0]!);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!, splits = [1];
    if (length2(a, b) < EPSILON) continue;
    for (const [start, end] of [[a[0], b[0]], [a[1], b[1]], [a[0] - a[1], b[0] - b[1]]]) {
      const delta = end! - start!;
      if (Math.abs(delta) < EPSILON) continue;
      for (let cell = Math.floor(Math.min(start!, end!)) + 1; cell < Math.max(start!, end!); cell++) {
        const t = (cell - start!) / delta;
        if (t > EPSILON && t < 1 - EPSILON) splits.push(t);
      }
    }
    splits.sort((a, b) => a - b);
    let previous = 0;
    for (const t of splits) {
      if (t - previous < EPSILON) continue; previous = t;
      append(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }
  return result;
}

export function createCitizenRoutes(plan: SettlementPlan, entryDistance?: number, castleHome = false): {
  routeForSlot(slot: number): CitizenRoute | undefined;
  destinationsForSlot(slot: number): readonly CitizenDestination[];
  routeTo(slot: number, position: Vec3, nodeId: string): CitizenRoute | undefined;
} {
  const homes = new Map(plan.homes.map(home => [home.slot, home])), { parents } = shortestPaths(plan);
  const active = new Set(plan.activeStreetIds), activeEdges = plan.streets.filter(edge => active.has(edge.id));
  const nodes = new Map(plan.nodes.map(node => [node.id, node]));
  // The route's presentation home is an installed graph anchor, independent of street tenure/ownership.
  const anchor = (slot: number): { nodeId: string; position: Vec3; heading: number } | undefined => {
    const home = homes.get(slot);
    if (home) {
      const approach = activeEdges.find(edge => edge.id === home.approachId);
      if (!approach) return undefined;
      const nodeId = nodes.get(approach.from)?.kind === 'frontage' ? approach.from : approach.to;
      const { front, outward } = homeFrame(home);
      return { nodeId, position: [front[0] + outward[0] * DOOR_CLEARANCE, front[1], front[2] + outward[2] * DOOR_CLEARANCE],
        heading: Math.atan2(-outward[0], -outward[2]) };
    }
    if (!castleHome || slot !== REALM_CASTLE_SLOT) return undefined;
    const gate = nodes.get(plan.castle.gateNodeId), keep = plan.castle.modules.find(module => module.id === plan.castle.beaconModuleId);
    const road = activeEdges.find(edge => edge.from === gate?.id || edge.to === gate?.id);
    if (!gate || !keep || !road) return undefined;
    const neighbour = road.from === gate.id ? road.points[1] : road.points.at(-2);
    if (!neighbour) return undefined;
    const distance = Math.hypot(neighbour[0] - gate.position[0], neighbour[2] - gate.position[2]);
    if (distance < EPSILON) return undefined;
    const x = gate.position[0] + (neighbour[0] - gate.position[0]) / distance * DOOR_CLEARANCE;
    const z = gate.position[2] + (neighbour[2] - gate.position[2]) / distance * DOOR_CLEARANCE;
    const centre = transformCardinalPoint(keep.position, keep.rotation, [keep.size[0] / 2, 0, keep.size[2] / 2]);
    return { nodeId: gate.id, position: [x, settlementTerrainHeight(plan, x, z), z],
      heading: Math.atan2(centre[0] - x, centre[2] - z) };
  };
  const activeNodes = new Set(activeEdges.flatMap(edge => [edge.from, edge.to]));
  const publicDestinations: CitizenDestination[] = plan.nodes.filter(node => activeNodes.has(node.id) && node.kind !== 'frontage')
    .map(node => ({ nodeId: node.id, kind: node.id === plan.market.nodeId ? 'market' : 'street', position: node.position }));
  const routes = new Map<number, CitizenRoute>(), blocked = new SpatialIndex<BoundsXZ>();
  const destinations = new Map<number, readonly CitizenDestination[]>();
  for (const plot of plan.reservations) {
    const box = expandBounds(plot.lot, BODY_RADIUS); blocked.add(box, box);
  }
  const clear = (points: readonly XZ[]): boolean => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      for (const box of blocked.within(pointBounds([a, b]))) if (intersects(a, b, box)) return false;
    }
    return true;
  };
  const bake = (slot: number, raw: readonly XZ[], streetIds: readonly string[], destination: CitizenDestination, preserveStart = false): CitizenRoute | undefined => {
    const local = raw.filter((point, index) => !index || length2(point, raw[index - 1]!) > EPSILON);
    if (!local.length) return undefined;
    // People use the width of a street, rather than queue along its centre line.
    // The final approach still tapers to the doorstep; the existing lot check
    // pulls a tight corner back onto its safe centre path when needed.
    const ribbons = streetIds.map(id => plan.streets.find(edge => edge.id === id)).filter(edge => edge && edge.kind !== 'approach');
    const halfWidth = Math.min(1.1, ...ribbons.map(edge => edge!.width / 2 - BODY_RADIUS));
    const offset = (randomUnit(seedHash(`${plan.config.seed}:lane:${slot}`)) - .5) * 2 * Math.max(.22, halfWidth);
    let shaped = local.length > 1 ? lane(roundCorners(local), offset, preserveStart) : local;
    if (!clear(shaped)) shaped = roundCorners(local);
    if (!clear(shaped)) shaped = local;
    if (!clear(shaped)) return undefined;
    const points = conformToTerrain(plan, shaped), cumulativeDistances = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      cumulativeDistances[i] = cumulativeDistances[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const a = points[Math.max(0, points.length - 2)]!, b = points.at(-1)!;
    return { slot, streetIds, points, cumulativeDistances, length: cumulativeDistances.at(-1)!,
      homeHeading: destination.kind === 'home' ? anchor(slot)!.heading : Math.atan2(b[0] - a[0], b[2] - a[2]),
      destinationNodeId: destination.nodeId, destinationKind: destination.kind };
  };
  const destinationsForSlot = (slot: number): readonly CitizenDestination[] => {
    const cached = destinations.get(slot); if (cached) return cached;
    const home = anchor(slot); if (!home) return [];
    const list: readonly CitizenDestination[] = [{ nodeId: home.nodeId, kind: 'home', position: home.position },
      ...publicDestinations.filter(destination => destination.nodeId !== home.nodeId)];
    destinations.set(slot, list); return list;
  };
  const routeForSlot = (slot: number): CitizenRoute | undefined => {
    const cached = routes.get(slot); if (cached) return cached;
    const home = anchor(slot); if (!home) return undefined;
    let node = home.nodeId;
    const edges: { edge: StreetEdge; reverse: boolean }[] = [];
    while (node !== plan.market.nodeId) {
      const parent = parents.get(node);
      if (!parent) throw new Error(`Home slot ${slot} has no installed street route`);
      edges.push({ edge: parent.edge, reverse: parent.edge.from !== parent.previous }); node = parent.previous;
    }
    edges.reverse();
    const raw: XZ[] = [];
    for (const { edge, reverse } of edges) {
      const points = reverse ? [...edge.points].reverse() : edge.points;
      for (const point of points) { const p = xz(point); if (!raw.length || length2(raw.at(-1)!, p) > EPSILON) raw.push(p); }
    }
    const walkLength = entryDistance ?? 12 + 18 * randomUnit(seedHash(`${plan.config.seed}:entry:${slot}`));
    const end = trimEnd(raw, DOOR_CLEARANCE);
    let fullLength = 0;
    for (let i = 1; i < end.length; i++) fullLength += length2(end[i - 1]!, end[i]!);
    const local = trimEnd([...end].reverse(), Math.max(0, fullLength - walkLength)).reverse();
    const route = bake(slot, local, edges.map(item => item.edge.id), destinationsForSlot(slot)[0]!);
    if (!route) throw new Error(`Home slot ${slot} route intersects a reserved lot`);
    routes.set(slot, route); return route;
  };
  const routeTo = (slot: number, position: Vec3, nodeId: string): CitizenRoute | undefined => {
    const destination = destinationsForSlot(slot).find(item => item.nodeId === nodeId);
    if (!destination) return undefined;
    // Only this core's current actor position is projected. Callers supply a node ID,
    // never coordinates. The nearest ribbon offers two real graph directions.
    let nearest: { edge: StreetEdge; index: number; point: XZ; along: number; length: number; distance: number } | undefined;
    for (const edge of activeEdges) {
      let along = 0, length = 0;
      for (let i = 1; i < edge.points.length; i++) length += length2(xz(edge.points[i - 1]!), xz(edge.points[i]!));
      for (let i = 1; i < edge.points.length; i++) {
        const a = xz(edge.points[i - 1]!), b = xz(edge.points[i]!), segment = length2(a, b);
        if (segment < EPSILON) continue;
        const t = Math.max(0, Math.min(1, ((position[0] - a[0]) * (b[0] - a[0]) + (position[2] - a[1]) * (b[1] - a[1])) / segment ** 2));
        const point: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], distance = length2(xz(position), point);
        if (!nearest || distance < nearest.distance - EPSILON) nearest = { edge, index: i, point, along: along + segment * t, length, distance };
        along += segment;
      }
    }
    if (!nearest || nearest.distance > .8) return undefined;
    const paths = shortestPaths(plan, nodeId), edge = nearest.edge;
    const towardFrom = nearest.along + (paths.distances.get(edge.from) ?? Infinity)
      < nearest.length - nearest.along + (paths.distances.get(edge.to) ?? Infinity);
    let node = towardFrom ? edge.from : edge.to;
    const raw: XZ[] = [xz(position), nearest.point];
    const partial = towardFrom ? edge.points.slice(0, nearest.index).reverse() : edge.points.slice(nearest.index);
    raw.push(...partial.map(xz));
    const streetIds = [edge.id];
    while (node !== nodeId) {
      const parent = paths.parents.get(node); if (!parent) return undefined;
      const points = parent.edge.from === node ? parent.edge.points : [...parent.edge.points].reverse();
      raw.push(...points.map(xz)); streetIds.push(parent.edge.id); node = parent.previous;
    }
    const route = destination.kind === 'home' ? trimEnd(raw, DOOR_CLEARANCE) : raw;
    return bake(slot, route, streetIds, destination, true);
  };
  return { routeForSlot, destinationsForSlot, routeTo };
}

export function sampleRoute(route: CitizenRoute, distance: number): Vec3 {
  if (route.points.length === 1) return route.points[0]!;
  const distances = route.cumulativeDistances;
  const clamped = Math.max(0, Math.min(route.length, distance));
  let low = 1, high = distances.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (distances[middle]! < clamped) low = middle + 1; else high = middle; }
  const a = route.points[low - 1]!, b = route.points[low]!;
  const segment = distances[low]! - distances[low - 1]!;
  const t = segment ? (clamped - distances[low - 1]!) / segment : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function routeHeading(route: CitizenRoute, distance: number): number {
  if (route.points.length === 1) return route.homeHeading;
  const a = sampleRoute(route, distance - .22), b = sampleRoute(route, distance + .22);
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}
