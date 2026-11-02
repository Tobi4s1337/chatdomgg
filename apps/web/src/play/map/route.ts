import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import { homeDoor } from './town';

/**
 * The real street route from where you stand to your own door, over the plan's street graph: the open streets only,
 * walked from the nearest point of the nearest street, shortest by length (Dijkstra). The lantern trail and the big
 * map both draw exactly this.
 */

export interface HomeRoute {
  readonly plotId: string;
  /** World points from the street beside you to your front step. Heights are the streets' own. */
  readonly points: readonly Vec3[];
  /** Metres along the streets, from the first point to the door. */
  readonly length: number;
  /** Your front step (the frontage end of your approach). */
  readonly door: Vec3;
  /** The streets walked, in order, each named once ("Crown Road", "Hearthward Lane"). */
  readonly streets: readonly string[];
  /** How far you stand from the first point of the route (off the street). */
  readonly offStreet: number;
}

interface Edge { readonly id: string; readonly from: string; readonly to: string; readonly name: string; readonly points: readonly Vec3[]; readonly length: number }
export interface StreetGraph {
  readonly revision: string;
  readonly edges: readonly Edge[];
  readonly byNode: ReadonlyMap<string, readonly Edge[]>;
  readonly nodes: ReadonlyMap<string, Vec3>;
}

const finite = (point: readonly number[]) => point.length >= 3 && point.every(Number.isFinite);
const polylineLength = (points: readonly Vec3[]) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]);
  return total;
};

/** The open streets as a graph. Pure; cache it per plan revision. */
export function streetGraph(plan: Pick<SettlementPlan, 'revision' | 'nodes' | 'streets' | 'activeStreetIds'>): StreetGraph {
  const active = new Set(plan.activeStreetIds);
  const nodes = new Map(plan.nodes.filter(node => finite(node.position)).map(node => [node.id, node.position] as const));
  const edges: Edge[] = [];
  const byNode = new Map<string, Edge[]>();
  for (const street of plan.streets) {
    if (!active.has(street.id) || !nodes.has(street.from) || !nodes.has(street.to)) continue;
    const points = street.points.filter(finite);
    if (points.length < 2) continue;
    const edge: Edge = { id: street.id, from: street.from, to: street.to, name: street.name, points, length: polylineLength(points) };
    edges.push(edge);
    for (const id of [street.from, street.to]) { const list = byNode.get(id) ?? []; list.push(edge); byNode.set(id, list); }
  }
  return { revision: plan.revision, edges, byNode, nodes };
}

interface Projection { readonly edge: Edge; readonly segment: number; readonly t: number; readonly point: Vec3; readonly distance: number }

/** The nearest point on any open street to (x, z). */
export function nearestOnStreets(graph: StreetGraph, x: number, z: number): Projection | null {
  let best: Projection | null = null;
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!;
      const dx = b[0] - a[0], dz = b[2] - a[2], span = dx * dx + dz * dz;
      const t = span > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / span)) : 0;
      const px = a[0] + dx * t, pz = a[2] + dz * t, distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance - 1e-9) best = { edge, segment: i, t, point: [px, a[1] + (b[1] - a[1]) * t, pz], distance };
    }
  }
  return best;
}

/** The part of an edge's polyline from the projection to one end, in walking order. */
function partial(projection: Projection, toward: 'from' | 'to'): Vec3[] {
  const { edge, segment, point } = projection;
  return toward === 'to' ? [point, ...edge.points.slice(segment)] : [point, ...edge.points.slice(0, segment).reverse()];
}

/** The edge's points walked away from `node`. */
const walked = (edge: Edge, node: string): readonly Vec3[] => (edge.from === node ? edge.points : [...edge.points].reverse());

function join(into: Vec3[], points: readonly Vec3[]) {
  for (const point of points) {
    const last = into[into.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[2] - point[2]) < 1e-3) continue;
    into.push(point);
  }
}

/** The route home from feet (world metres) to the plot's front step, or null when the plot or its street is unknown. */
export function routeHome(plan: Pick<SettlementPlan, 'homes' | 'streets' | 'nodes'>, graph: StreetGraph, feet: readonly [number, number, number],
  plotId: string): HomeRoute | null {
  const home = plan.homes.find(candidate => candidate.id === plotId);
  if (!home || !feet.every(Number.isFinite)) return null;
  const door = homeDoor(plan, home);
  // The goal is the front node of the home's approach; a plan without one walks to the street node nearest the door.
  const approach = graph.edges.find(edge => edge.id === home.approachId);
  const goal = approach
    ? (graph.nodes.get(approach.from) && Math.hypot(graph.nodes.get(approach.from)![0] - door[0], graph.nodes.get(approach.from)![2] - door[2]) < 1e-3 ? approach.from : approach.to)
    : nearestNode(graph, door[0], door[2]);
  const start = nearestOnStreets(graph, feet[0], feet[2]);
  if (!start || !goal) return null;

  // Dijkstra from the two ends of the start edge, each costed by the partial walk to reach it.
  const cost = new Map<string, number>(), previous = new Map<string, { node: string | null; edge: Edge | null }>();
  const open = new Set<string>();
  const startCosts: Record<'from' | 'to', number> = {
    from: polylineLength(partial(start, 'from')), to: polylineLength(partial(start, 'to')),
  };
  for (const end of ['from', 'to'] as const) {
    const node = start.edge[end];
    if ((cost.get(node) ?? Infinity) > startCosts[end]) { cost.set(node, startCosts[end]); previous.set(node, { node: null, edge: null }); open.add(node); }
  }
  const done = new Set<string>();
  while (open.size) {
    let at: string | null = null, low = Infinity;
    for (const node of open) { const c = cost.get(node)!; if (c < low || (c === low && at !== null && node < at)) { low = c; at = node; } }
    if (at === null) break;
    open.delete(at); done.add(at);
    if (at === goal) break;
    for (const edge of graph.byNode.get(at) ?? []) {
      const next = edge.from === at ? edge.to : edge.from;
      if (done.has(next)) continue;
      const c = low + edge.length;
      if (c < (cost.get(next) ?? Infinity) - 1e-9) { cost.set(next, c); previous.set(next, { node: at, edge }); open.add(next); }
    }
  }

  const points: Vec3[] = [];
  const names: string[] = [];
  const name = (street: string) => { if (street && names[names.length - 1] !== street) names.push(street); };
  // Already on your own approach: walk straight along it to the door.
  if (start.edge.id === home.approachId) {
    const toward = start.edge.from === goal ? 'from' : 'to';
    join(points, partial(start, toward));
    name(start.edge.name);
  } else {
    if (!cost.has(goal)) return null;
    const chain: Edge[] = [];
    let node = goal;
    for (let guard = 0; guard < graph.edges.length + 2; guard++) {
      const step = previous.get(node);
      if (!step || !step.edge || step.node === null) break;
      chain.unshift(step.edge); node = step.node;
    }
    const first = node;
    join(points, partial(start, start.edge.from === first ? 'from' : 'to'));
    name(start.edge.name);
    let at = first;
    for (const edge of chain) { join(points, walked(edge, at)); name(edge.name); at = edge.from === at ? edge.to : edge.from; }
  }
  join(points, [door]);
  return { plotId, points, length: polylineLength(points), door, streets: names, offStreet: start.distance };
}

function nearestNode(graph: StreetGraph, x: number, z: number): string | null {
  let best: string | null = null, low = Infinity;
  for (const [id, position] of graph.nodes) {
    if (!graph.byNode.has(id)) continue;
    const d = Math.hypot(position[0] - x, position[2] - z);
    if (d < low) { low = d; best = id; }
  }
  return best;
}

export interface TrailStop {
  /** Where the post stands, beside the street, at street level. */
  readonly position: Vec3;
  /** Along the street, toward your door (unit, in x and z). */
  readonly forward: readonly [number, number];
  /** Metres from the start of the route. */
  readonly at: number;
}

/**
 * Stops along a route every `spacing` metres, set to alternate sides of the street by `side` metres, so the trail
 * reads as lanterns the town set out, not a line drawn on the ground. The door itself is lit by its plaque.
 */
export function trailStops(route: Pick<HomeRoute, 'points' | 'length'>, spacing = 7, side = 1.6): TrailStop[] {
  const stops: TrailStop[] = [];
  const points = route.points;
  if (points.length < 2 || !(route.length > 0)) return stops;
  let segment = 1, segmentStart = 0;
  const segmentLength = (i: number) => Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]);
  const count = Math.max(1, Math.floor(route.length / spacing));
  // Start a short step ahead of you, so the first lantern is in front of you, not under your feet.
  const first = Math.min(route.length, Math.max(2.5, (route.length - count * spacing) / 2 + spacing * .5));
  for (let index = 0, at = first; at < route.length - 1.5; index++, at += spacing) {
    while (segment < points.length - 1 && segmentStart + segmentLength(segment) < at) { segmentStart += segmentLength(segment); segment++; }
    const a = points[segment - 1]!, b = points[segment]!, span = segmentLength(segment) || 1;
    const t = Math.max(0, Math.min(1, (at - segmentStart) / span));
    const fx = (b[0] - a[0]) / span, fz = (b[2] - a[2]) / span;
    const sign = index % 2 === 0 ? 1 : -1;
    // Right of a walk along (fx, fz) is (-fz, fx).
    stops.push({ position: [a[0] + (b[0] - a[0]) * t - fz * side * sign, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + fx * side * sign],
      forward: [fx, fz], at });
  }
  return stops;
}
