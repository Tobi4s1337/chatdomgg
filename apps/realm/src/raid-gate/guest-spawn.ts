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
  return incomingRaidRouteOf(plan)?.[0] ?? null;
}

/** The caravan's road from that junction in towards the market, gate first: web giftRouteOf(...).inbound. */
export function incomingRaidRouteOf(plan: SettlementPlan): readonly Vec3[] | null {
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
  if (!entry || !best.has(gate) || !point?.every(Number.isFinite)) return null;
  return Object.freeze([...entry.points].reverse().map(value => Object.freeze([...value]) as Vec3));
}

/**
 * The column's swept half-width on the ground: a 1.5 m wagon with its pennant overhang, or banner ponies two abreast
 * 0.56 m either side of the road line, plus a walker's body and a margin so a guest is never brushed by a wheel.
 */
export const RAID_COLUMN_CLEARANCE = 1.3 + WALK_BODY.radius + .45;
/** The caravan comes up the road from outside the gate before it enters; that stretch is swept too. */
const APPROACH = 24;

/**
 * The raid layer's gate furniture in metres (apps/web/src/twitch-moments/raid-view.ts: RAID_GATE_LAYOUT,
 * RAID_TORCH_LAYOUT, RAID_CHAT_GATE_LAYOUT; the cross-surface test compares them). The realm does not draw it,
 * but every stream and every guest sees it, so a guest is never seated inside a brazier, the standard's pole, a
 * torch post or a chat-lantern stand. Radii are each piece's footprint.
 */
export const RAID_GATE_FURNITURE = {
  gate: { poleAside: 2.4, brazierAside: 2, brazierIn: 1.2 },
  brazier: .6, pole: .2,
  torches: { start: 4.2, spacing: 3.4, aside: [2.75, 3.05, 3.35] as const, notBefore: 1.2 + 1, post: .35 },
  chat: { aside: 5, spacing: 1.4, start: 1.6, slots: 32, stand: .3 },
  // The dated pennant wall's candidate bays (RAID_PENNANT_WALL_LAYOUT): the bay's own footprint plus room to stand
  // back and read it, so a guest never arrives with their face in a raider's cloth.
  pennants: { rows: 12, spacing: 3.5, aside: 6, outward: [0, 3.5, 7] as const, bay: 1.5, reading: 1.2 },
} as const;
const FURNITURE_MARGIN = WALK_BODY.radius + .1;

/** Gate-relative ground positions (x, z) and radii of every piece the raid layer can stand at this gate. */
export function raidGateFurnitureOf(route: readonly Vec3[]): readonly { x: number; z: number; radius: number }[] {
  const gate = route[0], ahead = route.find(point => Math.hypot(point[0] - gate![0], point[2] - gate![2]) > .05);
  if (!gate || !ahead) return [];
  const length = Math.hypot(ahead[0] - gate[0], ahead[2] - gate[2]);
  // The layer's gate frame: facing along the road into the town, side = up × facing.
  const fx = (ahead[0] - gate[0]) / length, fz = (ahead[2] - gate[2]) / length, sx = fz, sz = -fx;
  const F = RAID_GATE_FURNITURE, pieces: { x: number; z: number; radius: number }[] = [];
  const at = (along: number, aside: number, radius: number) => pieces.push({ x: gate[0] + fx * along + sx * aside, z: gate[2] + fz * along + sz * aside, radius });
  at(0, F.gate.poleAside, F.pole);
  for (const sign of [-1, 1]) at(F.gate.brazierIn, F.gate.brazierAside * sign, F.brazier);
  for (let slot = 0; slot < F.chat.slots; slot++) at(F.chat.start + Math.floor(slot / 2) * F.chat.spacing, F.chat.aside * (slot % 2 ? 1 : -1), F.chat.stand);
  for (let row = 0; row < F.pennants.rows; row++) for (const side of [-1, 1]) for (const outward of F.pennants.outward) {
    at(row === 0 ? 0 : Math.ceil(row / 2) * F.pennants.spacing * (row % 2 ? 1 : -1), side * (F.pennants.aside + outward), F.pennants.bay + F.pennants.reading);
  }
  // Torch pairs stand along the road itself; which of the three offsets a pair takes depends on the ground the
  // browser finds, so every candidate is kept clear.
  const reach = SEARCH_RINGS * SPACING + 2;
  for (let distance = F.torches.start; distance <= reach; distance += F.torches.spacing) {
    let walked = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!, b = route[i]!, span = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (span < 1e-6) continue;
      if (walked + span < distance) { walked += span; continue; }
      const t = (distance - walked) / span, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      const ax = (b[2] - a[2]) / span, az = -(b[0] - a[0]) / span;
      for (const sign of [-1, 1]) for (const aside of F.torches.aside) {
        const px = x + ax * aside * sign, pz = z + az * aside * sign;
        if ((px - gate[0]) * fx + (pz - gate[2]) * fz >= F.torches.notBefore) pieces.push({ x: px, z: pz, radius: F.torches.post });
      }
      break;
    }
  }
  return pieces;
}

/**
 * The point a guest arriving with the raid faces: out through the gate, down the road the caravan comes in on, so the
 * walker's own camera (which settles behind them) sees the column ride towards them. World (x, z); null without a
 * road. The room turns the seated walker towards it (SEAMS §11, the arrival facing).
 */
export const RAID_GUEST_LOOK_OUT = 12;
export function raidGuestFaceToward(plan: SettlementPlan): readonly [number, number] | null {
  const route = incomingRaidRouteOf(plan), gate = route?.[0], inward = route?.find(point => gate && Math.hypot(point[0] - gate[0], point[2] - gate[2]) > .05);
  if (!gate || !inward) return null;
  const length = Math.hypot(inward[0] - gate[0], inward[2] - gate[2]);
  return [gate[0] - (inward[0] - gate[0]) / length * RAID_GUEST_LOOK_OUT, gate[2] - (inward[2] - gate[2]) / length * RAID_GUEST_LOOK_OUT];
}

/** Horizontal distance from the caravan's road line, including its straight approach outside the gate. */
export function raidColumnDistance(route: readonly Vec3[], x: number, z: number): number {
  const first = route[0]!, next = route.find(point => Math.hypot(point[0] - first[0], point[2] - first[2]) > .05) ?? first;
  const length = Math.hypot(next[0] - first[0], next[2] - first[2]) || 1;
  const outside: Vec3 = [first[0] - (next[0] - first[0]) / length * APPROACH, first[1], first[2] - (next[2] - first[2]) / length * APPROACH];
  let best = Infinity;
  const line = [outside, ...route];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!, dx = b[0] - a[0], dz = b[2] - a[2], span = dx * dx + dz * dz;
    const t = span > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / span)) : 0;
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t));
  }
  return best;
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

/**
 * At most 6 m from the actual arrival junction, on real ground. Empty is unavailable, never a market fallback.
 * Order is the room's preference (it seats the first free one): beside the road inside the gate, clear of the
 * caravan's swept column and of the gate's braziers, standard, torches and lantern stands, so a guest watches it
 * pass; points in the column's path or that furniture come last, only when nothing else at the gate is safe.
 */
export function raidGuestSpawnAnchors(plan: SettlementPlan, world: CollisionWorld): readonly Vec3[] {
  const route = incomingRaidRouteOf(plan), gate = route?.[0];
  if (!route || !gate) return Object.freeze([]);
  const inward = route.find(point => Math.hypot(point[0] - gate[0], point[2] - gate[2]) > .05);
  const along = (point: Vec3) => {
    if (!inward) return 0;
    const dx = inward[0] - gate[0], dz = inward[2] - gate[2], length = Math.hypot(dx, dz);
    return ((point[0] - gate[0]) * dx + (point[2] - gate[2]) * dz) / length;
  };
  const furniture = raidGateFurnitureOf(route);
  const furnished = (point: Vec3) => furniture.some(piece => Math.hypot(point[0] - piece.x, point[2] - piece.z) < piece.radius + FURNITURE_MARGIN);
  const found: { point: Vec3; rank: number }[] = [];
  for (let ring = 0; ring <= SEARCH_RINGS; ring++) for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== ring || Math.hypot(x, z) > SEARCH_RINGS) continue;
    const ground = foundedGroundAt(plan, gate[0] + x * SPACING, gate[2] + z * SPACING);
    // Probe only the actual terrain and up to one step of built pavement, never roofs or an invented floor.
    for (const dy of [0, .125, .25, .375, .5]) {
      const point: Vec3 = [ground[0], ground[1] + dy, ground[2]];
      if (!clear(world, point) || !found.every(other => separated(point, other.point)) || !clearEgress(world, point)) continue;
      const aside = raidColumnDistance(route, point[0], point[2]);
      // 0: roadside inside the gate; 1: roadside outside it; 2: in the column's path or the gate's furniture (last resort).
      const rank = aside < RAID_COLUMN_CLEARANCE || furnished(point) ? 2 : along(point) >= .5 ? 0 : 1;
      found.push({ point: Object.freeze(point), rank: rank * 1_000 + Math.hypot(point[0] - gate[0], point[2] - gate[2]) });
    }
  }
  return Object.freeze(found.sort((a, b) => a.rank - b.rank).slice(0, MAX_ANCHORS).map(entry => entry.point));
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
  const cache = new Map<string, { world: WeakRef<CollisionWorld>; positions: readonly Vec3[]; faceToward: readonly [number, number] | null }>();
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
      cached = { world: new WeakRef(context.world), positions: raidGuestSpawnAnchors(snapshot!.plan, context.world), faceToward: raidGuestFaceToward(snapshot!.plan) };
      cache.set(key, cached);
      while (cache.size > CACHE_GEOMETRIES) cache.delete(cache.keys().next().value!);
    }
    const preparation = { positions: cached.positions, expiresAt: pending.expiresAt,
      current: () => pending.expiresAt > now() && matches(options.current(principal.kingdomId)) };
    // The arrival facing travels beside the port's fields until the room reads it (SEAMS §11 needs: arrival facing).
    return cached.faceToward ? Object.assign(preparation, { faceToward: cached.faceToward }) : preparation;
  };
}
