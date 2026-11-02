import type { KingdomId, Vec3 } from '@chatdom/shared';
import { WALK_BODY, isVerifiedMonarch, type CollisionWorld } from '@chatdom/shared/realm';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import type { RealmRoomServices, RealmSpawnContext, RealmSpawnPreparation } from '../ports';

/** The castle is the monarch's home (Monarch.md §7.6): they step out at its gate, looking down into their town. */
const SPACING = .75, RINGS = 8, MAX_ANCHORS = 32, LOOK_OUT = 12, HOLD_MS = 10_000;

const clear = (world: CollisionWorld, point: Vec3) => {
  const body = { x: point[0], y: point[1], z: point[2] };
  return point.every(Number.isFinite) && !embeddedSolids(body, world).length && supported(body, world);
};
const separated = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) >= WALK_BODY.radius * 2 + .05
  || Math.abs(a[2] - b[2]) >= WALK_BODY.radius * 2 + .05 || Math.abs(a[1] - b[1]) >= WALK_BODY.height;
/** A walker must be able to step off: one clear supported neighbour, swept with the full body. */
function egress(world: CollisionWorld, point: Vec3): boolean {
  return [[SPACING, 0], [-SPACING, 0], [0, SPACING], [0, -SPACING]].some(([dx, dz]) => {
    const next: Vec3 = [point[0] + dx!, point[1], point[2] + dz!];
    if (!clear(world, next)) return false;
    const r = WALK_BODY.radius;
    return !world.query({ min: [Math.min(point[0], next[0]) - r, point[1] + 1e-6, Math.min(point[2], next[2]) - r],
      max: [Math.max(point[0], next[0]) + r, point[1] + WALK_BODY.height, Math.max(point[2], next[2]) + r] }).length;
  });
}

const node = (plan: SettlementPlan, id: string) => plan.nodes.find(candidate => candidate.id === id)?.position;

/** The point the monarch faces on arrival: from the castle gate out toward the market, LOOK_OUT metres on. */
export function castleGateFacing(plan: SettlementPlan): readonly [number, number] | null {
  const gate = node(plan, plan.castle.gateNodeId), market = node(plan, plan.market.nodeId);
  if (!gate || !market) return null;
  const dx = market[0] - gate[0], dz = market[2] - gate[2], length = Math.hypot(dx, dz);
  if (length < 1e-3) return null;
  return [gate[0] + dx / length * LOOK_OUT, gate[2] + dz / length * LOOK_OUT];
}

/**
 * Supported, clear, steppable points at most 6 m from the castle gate on real ground, nearest the town side first.
 * Empty means the gate has no safe arrival at this geometry; the room then uses its ordinary entry.
 */
export function castleGateAnchors(plan: SettlementPlan, world: CollisionWorld): readonly Vec3[] {
  const gate = node(plan, plan.castle.gateNodeId), toward = castleGateFacing(plan);
  if (!gate) return Object.freeze([]);
  const outward = toward ? [toward[0] - gate[0], toward[1] - gate[2]] as const : [0, 0] as const;
  const length = Math.hypot(outward[0], outward[1]) || 1;
  const found: { point: Vec3; rank: number }[] = [];
  for (let ring = 0; ring <= RINGS; ring++) for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== ring || Math.hypot(x, z) > RINGS) continue;
    const ground = foundedGroundAt(plan, gate[0] + x * SPACING, gate[2] + z * SPACING);
    for (const dy of [0, .125, .25, .375, .5]) {
      const point: Vec3 = [ground[0], ground[1] + dy, ground[2]];
      if (!clear(world, point) || !found.every(other => separated(point, other.point)) || !egress(world, point)) continue;
      // Just outside the gate, on the town side, before the castle side; nearer before farther.
      const along = ((point[0] - gate[0]) * outward[0] + (point[2] - gate[2]) * outward[1]) / length;
      found.push({ point: Object.freeze(point), rank: (along >= .5 ? 0 : 1) * 1_000 + Math.hypot(point[0] - gate[0], point[2] - gate[2]) });
      break;
    }
  }
  return Object.freeze(found.sort((a, b) => a.rank - b.rank).slice(0, MAX_ANCHORS).map(entry => entry.point));
}

export interface MonarchArrivalWorld extends RealmSpawnContext { readonly plan: SettlementPlan }
type PrepareSpawn = NonNullable<RealmRoomServices['prepareSpawn']>;

/**
 * Read-only composition for RealmRoomServices.prepareSpawn: the verified broadcaster arrives at their castle gate,
 * facing their town. Everyone else keeps the inner preparation (raid guests at the Raid Gate, others at their door
 * or the market). A gate with no safe point never refuses the monarch: it falls back to the ordinary entry.
 */
export function withMonarchArrival(inner: PrepareSpawn | undefined, current: (kingdomId: KingdomId) => MonarchArrivalWorld | undefined,
  clock: () => number = Date.now): PrepareSpawn {
  const cache = new Map<string, { world: WeakRef<CollisionWorld>; positions: readonly Vec3[]; faceToward: readonly [number, number] | null }>();
  return async (principal, context) => {
    if (!isVerifiedMonarch(principal)) return inner ? inner(principal, context) : null;
    const matches = (snapshot: MonarchArrivalWorld | undefined) => !!snapshot && snapshot.world === context.world
      && snapshot.world.revision === context.world.revision && snapshot.layoutRevision === context.layoutRevision
      && snapshot.plan.revision === context.layoutRevision && snapshot.writerEpoch === context.writerEpoch;
    const snapshot = current(principal.kingdomId);
    if (!matches(snapshot)) return inner ? inner(principal, context) : null;
    const key = JSON.stringify([principal.kingdomId, context.writerEpoch, context.layoutRevision, context.world.revision]);
    let cached = cache.get(key);
    if (!cached || cached.world.deref() !== context.world) {
      cached = { world: new WeakRef(context.world), positions: castleGateAnchors(snapshot!.plan, context.world), faceToward: castleGateFacing(snapshot!.plan) };
      cache.set(key, cached);
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
    }
    if (!cached.positions.length) return inner ? inner(principal, context) : null;
    const expiresAt = clock() + HOLD_MS;
    const preparation: RealmSpawnPreparation = { positions: cached.positions, expiresAt,
      current: () => expiresAt > clock() && matches(current(principal.kingdomId)),
      ...(cached.faceToward ? { faceToward: cached.faceToward } : {}) };
    return preparation;
  };
}
