import type { KingdomId, Vec3 } from '@chatdom/shared';
import { WALK_BODY, type CollisionWorld } from '@chatdom/shared/realm';
import type { SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmRoomServices, RealmSpawnContext } from '../ports';
import type { RaidGuestAuthority } from './guests';

const MAX_ANCHORS = 128, CACHE_GEOMETRIES = 8, SEARCH_RINGS = 8, SPACING = .75;

/**
 * The caravan's actual entry junction, NOT castle.gateNodeId. Keep the active-street shortest-road selection
 * identical to web/kingdom/moments/anchors.ts giftRouteOf; the cross-surface test calls that actual function.
 * No scene renderer or three.js enters the server's authority path.
 */
export function incomingRaidGateOf(plan: SettlementPlan): Vec3 | null {
  const active = new Set(plan.activeStreetIds), market = plan.market.nodeId;
  const nodes = new Map(plan.nodes.map(node => [node.id, node]));
  const centre = nodes.get(market)?.position;
  if (!centre?.every(Number.isFinite)) return null;
  const edges = plan.streets.filter(street => active.has(street.id) && street.kind !== 'approach' && street.kind !== 'trail');
  if (edges.some(edge => edge.points.some(point => !point.every(Number.isFinite)))) return null;
  const length = (points: readonly Vec3[]) => points.reduce((sum, point, i) => i
    ? sum + Math.hypot(point[0] - points[i - 1]![0], point[2] - points[i - 1]![2]) : 0, 0);
  const best = new Map<string, { distance: number; points: Vec3[] }>([[market, { distance: 0, points: [centre] }]]);
  const open = [market];
  while (open.length) {
    open.sort((a, b) => best.get(a)!.distance - best.get(b)!.distance);
    const here = open.shift()!, from = best.get(here)!;
    for (const edge of edges) {
      if (edge.from !== here && edge.to !== here) continue;
      const there = edge.from === here ? edge.to : edge.from;
      const points = edge.from === here ? [...edge.points] : [...edge.points].reverse();
      const distance = from.distance + length(points);
      if ((best.get(there)?.distance ?? Infinity) <= distance) continue;
      best.set(there, { distance, points: [...from.points, ...points.slice(1)] });
      if (!open.includes(there)) open.push(there);
    }
  }
  const gate = plan.castle.gateNodeId;
  const entries = [...best.entries()].filter(([id, entry]) => id !== market && id !== gate && entry.distance > 30);
  const [, entry] = entries.sort((a, b) => Math.abs(a[1].distance - 55) - Math.abs(b[1].distance - 55))[0] ?? [];
  const point = entry?.points.at(-1);
  return best.has(gate) && point?.every(Number.isFinite) ? Object.freeze([...point]) as Vec3 : null;
}

const clear = (world: CollisionWorld, point: Vec3) => {
  const body = { x: point[0], y: point[1], z: point[2] };
  return point.every(Number.isFinite) && !embeddedSolids(body, world).length && supported(body, world);
};
const separated = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) >= WALK_BODY.radius * 2 + .05
  || Math.abs(a[2] - b[2]) >= WALK_BODY.radius * 2 + .05 || Math.abs(a[1] - b[1]) >= WALK_BODY.height;

/** Same supported neighbour and full-body sweep as founded/anchors.ts; an isolated pedestal is not an exit. */
function clearEgress(world: CollisionWorld, point: Vec3): boolean {
  return [[SPACING, 0], [-SPACING, 0], [0, SPACING], [0, -SPACING]].some(([dx, dz]) => {
    const next: Vec3 = [point[0] + dx!, point[1], point[2] + dz!];
    if (!clear(world, next)) return false;
    const r = WALK_BODY.radius;
    return !world.query({ min: [Math.min(point[0], next[0]) - r, point[1] + 1e-6, Math.min(point[2], next[2]) - r],
      max: [Math.max(point[0], next[0]) + r, point[1] + WALK_BODY.height, Math.max(point[2], next[2]) + r] }).length;
  });
}

/** At most 6 m from the actual arrival junction, on real ground. Empty is unavailable, never a market fallback. */
export function raidGuestSpawnAnchors(plan: SettlementPlan, world: CollisionWorld): readonly Vec3[] {
  const gate = incomingRaidGateOf(plan);
  if (!gate) return Object.freeze([]);
  const result: Vec3[] = [];
  for (let ring = 0; ring <= SEARCH_RINGS; ring++) for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== ring || Math.hypot(x, z) > SEARCH_RINGS) continue;
    const ground = foundedGroundAt(plan, gate[0] + x * SPACING, gate[2] + z * SPACING);
    // Probe only the actual terrain and up to one step of built pavement, never roofs or an invented floor.
    for (const dy of [0, .125, .25, .375, .5]) {
      const point: Vec3 = [ground[0], ground[1] + dy, ground[2]];
      if (clear(world, point) && result.every(other => separated(point, other)) && clearEgress(world, point)) result.push(Object.freeze(point));
      if (result.length === MAX_ANCHORS) return Object.freeze(result);
    }
  }
  return Object.freeze(result);
}

export interface RaidGuestSpawnWorld extends RealmSpawnContext {
  readonly plan: SettlementPlan;
}
export interface RaidGuestSpawnOptions {
  readonly authority: Pick<RaidGuestAuthority, 'pendingEntry'>;
  /** Only the retained, unexpired writer's ADOPTED geometry. Never a prospective/prepared scene. */
  readonly current: (kingdomId: KingdomId) => RaidGuestSpawnWorld | undefined;
  readonly clock?: () => number;
}

/** Read-only composition for RealmRoomServices.prepareSpawn. The room alone picks against current walkers. */
export function createRaidGuestSpawn(options: RaidGuestSpawnOptions): NonNullable<RealmRoomServices['prepareSpawn']> {
  // Eight small coordinate lists, without retaining eight entire retired collision worlds.
  const cache = new Map<string, { world: WeakRef<CollisionWorld>; positions: readonly Vec3[] }>();
  const now = options.clock ?? Date.now;
  return async (principal, context) => {
    const pending = await options.authority.pendingEntry({ version: 1, origin: principal.origin, entryId: principal.sessionId,
      personId: principal.personId, kingdomId: principal.kingdomId, at: Math.floor(now()) });
    if (pending.status === 'refused') {
      if (pending.reason === 'citizen_here' || pending.reason === 'no_intent') return null;
      throw new Error('This raid invitation can no longer admit you. Open the kingdom again to enter.');
    }
    const matches = (snapshot: RaidGuestSpawnWorld | undefined) => !!snapshot && snapshot.world === context.world
      && snapshot.world.revision === context.world.revision && snapshot.layoutRevision === context.layoutRevision
      && snapshot.plan.revision === context.layoutRevision && snapshot.writerEpoch === context.writerEpoch;
    const snapshot = options.current(principal.kingdomId);
    if (!matches(snapshot) || pending.expiresAt <= now()) throw new Error('The kingdom gate changed while entry was being checked. Try again.');
    const key = JSON.stringify([principal.kingdomId, context.writerEpoch, context.layoutRevision, context.world.revision]);
    let cached = cache.get(key);
    if (!cached || cached.world.deref() !== context.world) {
      cached = { world: new WeakRef(context.world), positions: raidGuestSpawnAnchors(snapshot!.plan, context.world) };
      cache.set(key, cached);
      while (cache.size > CACHE_GEOMETRIES) cache.delete(cache.keys().next().value!);
    }
    return { positions: cached.positions, expiresAt: pending.expiresAt,
      current: () => pending.expiresAt > now() && matches(options.current(principal.kingdomId)) };
  };
}
