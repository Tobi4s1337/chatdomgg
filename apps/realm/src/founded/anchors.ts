import type { Vec3 } from '@chatdom/shared';
import { WALK_BODY, type CollisionWorld } from '@chatdom/shared/realm';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from './collision';

export interface FoundedWalker { readonly id: string; readonly position: Vec3 }
const pose = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });
const clear = (world: CollisionWorld, p: Vec3) => embeddedSolids(pose(p), world).length === 0 && supported(pose(p), world);
const separate = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) >= WALK_BODY.radius * 2 + .05 || Math.abs(a[2] - b[2]) >= WALK_BODY.radius * 2 + .05 || Math.abs(a[1] - b[1]) >= WALK_BODY.height;

/** Bounded deterministic search on real ground; no rooftop, water-sheet or unknown-space spawn. */
function candidates(plan: SettlementPlan, near: Vec3): Vec3[] {
  const result: Vec3[] = [];
  for (let ring = 0; ring <= 16; ring++) for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
    const ground = foundedGroundAt(plan, near[0] + x * .75, near[2] + z * .75);
    // Paved squares and home floors may stand one build cell above the terrain. Test actual support, never hover.
    for (const dy of [0, .125, .25, .375, .5]) result.push([ground[0], ground[1] + dy, ground[2]]);
  }
  return result;
}
function egress(world: CollisionWorld, p: Vec3): boolean {
  return [[.75, 0], [-.75, 0], [0, .75], [0, -.75]].some(([dx, dz]) => {
    const next: Vec3 = [p[0] + dx!, p[1], p[2] + dz!];
    // Check the entire body swept to a clear supported neighbour, so a small isolated support is not an anchor.
    if (!clear(world, next)) return false;
    const r = WALK_BODY.radius;
    return !world.query({ min: [Math.min(p[0], next[0]) - r, p[1] + 1e-6, Math.min(p[2], next[2]) - r],
      max: [Math.max(p[0], next[0]) + r, p[1] + WALK_BODY.height, Math.max(p[2], next[2]) + r] }).length;
  });
}

/** Safe market anchors for the room's existing spawn/recover seam. Empty means unavailable, never a debug floor. */
export function foundedSpawnAnchors(plan: SettlementPlan, world: CollisionWorld, limit = 128): readonly Vec3[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new Error('Invalid founded spawn anchor limit.');
  const result: Vec3[] = [], near: Vec3 = [0, plan.market.elevation, 0];
  for (const p of candidates(plan, near)) {
    if (clear(world, p) && result.every(other => separate(p, other)) && egress(world, p)) result.push(Object.freeze(p));
    if (result.length >= limit) break;
  }
  if (!result.length) throw new Error('The founded market has no supported clear arrival anchor.');
  return Object.freeze(result);
}

/**
 * Preparation only: the authority rechecks poses/revision and invokes adoptWorld itself. Every input walker is
 * covered. Supported, clear, nonoverlapping walkers stay exactly in place; affected neighbours relocate too.
 */
export function prepareFoundedWalkerPositions(plan: SettlementPlan, world: CollisionWorld, walkers: readonly FoundedWalker[]): ReadonlyMap<string, Vec3> {
  if (walkers.length > 1024 || new Set(walkers.map(w => w.id)).size !== walkers.length) throw new Error('Invalid founded walker set.');
  const result = new Map<string, Vec3>(), displaced: FoundedWalker[] = [];
  for (const walker of [...walkers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (walker.position.length !== 3 || !walker.position.every(Number.isFinite)) throw new Error('Invalid founded walker position.');
    if (clear(world, walker.position) && [...result.values()].every(p => separate(p, walker.position))) result.set(walker.id, Object.freeze([...walker.position]) as unknown as Vec3);
    else displaced.push(walker);
  }
  for (const walker of displaced) {
    const next = candidates(plan, walker.position).find(p => clear(world, p) && [...result.values()].every(other => separate(p, other)) && egress(world, p));
    if (!next) throw new Error('The founded revision has no safe nearby placement for an affected walker.');
    result.set(walker.id, Object.freeze(next));
  }
  return result;
}
