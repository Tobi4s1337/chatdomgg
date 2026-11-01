import type { Vec3 } from '@chatdom/shared';
import { WALK_BODY, WALK_HZ, type CollisionWorld, type PlayerState, type SolidBox } from '@chatdom/shared/realm';
import { bodyBox, bodyClear } from '../interactions/geometry';
import { embeddedSolids, stepPlayer, supported } from '../movement/step';
import type { BoundsXZ } from '../settlement/types';
import { fullySupported } from './place-sites';
import { AUTHORED_PIER_BUDGET as B, type AuthoredPierProposal, type AuthoredPierWork } from './pier-authored-types';
import { deny, EPS } from './pier-authored-checks';

const intersects = (a: SolidBox, b: SolidBox) => a.min.every((v, i) => v < b.max[i]! && a.max[i]! > b.min[i]!);
const BIN = 4;
const finiteBox = (box: SolidBox): boolean => box.min.length === 3 && box.max.length === 3 && box.min.every(Number.isFinite) && box.max.every(Number.isFinite);
const binRange = (box: SolidBox, query: boolean) => ({ x0: Math.floor(box.min[0] / BIN),
  x1: query ? Math.floor(box.max[0] / BIN) + 1 : Math.ceil(box.max[0] / BIN),
  z0: Math.floor(box.min[2] / BIN), z1: query ? Math.floor(box.max[2] / BIN) + 1 : Math.ceil(box.max[2] / BIN) });
function binCount(range: ReturnType<typeof binRange>): number {
  const count = (range.x1 - range.x0) * (range.z1 - range.z0);
  if (!Object.values(range).every(Number.isSafeInteger) || !Number.isSafeInteger(count) || count < 1)
    deny('budget-exceeded', { stage: 'walk', message: 'Candidate broadphase range is not bounded.' });
  return count;
}
/** Base owns unknown space once. Candidate interiors add solids only, never erase a base barrier. */
export function authoredCollision(base: CollisionWorld, boxes: readonly SolidBox[], work: AuthoredPierWork): CollisionWorld {
  if (boxes.length > B.compiledBoxes) deny('budget-exceeded', { stage: 'compile', message: 'Candidate solid count exceeds its budget.' });
  let insertions = 0;
  // Count every index insertion before allocating bins, even for a long box crossing many empty metres.
  for (const box of boxes) {
    if (!finiteBox(box) || box.min.some((n, i) => n >= box.max[i]!)) deny('invalid-proposal', { stage: 'compile' });
    insertions += binCount(binRange(box, false));
    if (insertions > B.overlayBinEntries) deny('budget-exceeded', { stage: 'compile', message: 'Candidate spatial index exceeds its budget.' });
  }
  const bins = new Map<string, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const r = binRange(boxes[i]!, false);
    for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) {
      const key = `${x},${z}`, bin = bins.get(key);
      if (bin) bin.push(i); else bins.set(key, [i]);
    }
  }
  let broadphaseVisits = 0;
  return { revision: base.revision, query(bounds) {
    if (!finiteBox(bounds) || bounds.min.some((n, i) => n > bounds.max[i]!)) deny('invalid-proposal', { stage: 'walk' });
    const range = binRange(bounds, true), cells = binCount(range);
    if (cells > B.overlayQueryBins) deny('budget-exceeded', { stage: 'walk', message: 'Collision query crosses too many spatial bins.' });
    // Preflight each query before asking the base or allocating a candidate set. Repeated hits of a spanning
    // box cost visits even though its exact intersection is checked only once below.
    let visits = cells;
    for (let z = range.z0; z < range.z1; z++) for (let x = range.x0; x < range.x1; x++) visits += bins.get(`${x},${z}`)?.length ?? 0;
    if (broadphaseVisits + visits > B.overlayBoxChecks) deny('budget-exceeded', { stage: 'walk', message: 'Candidate spatial-bin visit budget exhausted.' });
    broadphaseVisits += visits;
    if (work.collisionQueries >= B.collisionQueries) deny('budget-exceeded', { stage: 'walk', message: 'Collision query budget exhausted.' });
    work.collisionQueries++;
    const original = base.query(bounds);
    if (original.length > B.queryBoxes || work.collisionBoxes + original.length > B.collisionBoxes) deny('budget-exceeded', { stage: 'walk', message: 'Collision box budget exhausted.' });
    work.collisionBoxes += original.length;
    const added: SolidBox[] = [], seen = new Set<number>();
    for (let z = range.z0; z < range.z1; z++) for (let x = range.x0; x < range.x1; x++)
      for (const index of bins.get(`${x},${z}`) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        if (work.overlayBoxChecks >= B.overlayBoxChecks) deny('budget-exceeded', { stage: 'walk', message: 'Candidate broadphase budget exhausted.' });
        work.overlayBoxChecks++;
        const box = boxes[index]!;
        if (!intersects(bounds, box)) continue;
        if (original.length + added.length >= B.queryBoxes || work.collisionBoxes >= B.collisionBoxes) deny('budget-exceeded', { stage: 'walk' });
        added.push(box); work.collisionBoxes++;
      }
    if (!added.length) return original;
    const combined = [...original, ...added];
    combined.sort((a, b) => { for (let i = 0; i < 3; i++) { const d = a.min[i]! - b.min[i]!; if (d) return d; } for (let i = 0; i < 3; i++) { const d = a.max[i]! - b.max[i]!; if (d) return d; } return 0; });
    return combined.filter((b, i) => !i || b.min.some((n, k) => n !== combined[i - 1]!.min[k]) || b.max.some((n, k) => n !== combined[i - 1]!.max[k]));
  } };
}
export function requireDrySupport(world: CollisionWorld, at: Vec3): BoundsXZ {
  const body = bodyBox(at), bounds = { minX: body.min[0], maxX: body.max[0], minZ: body.min[2], maxZ: body.max[2] };
  if (!bodyClear(world, at)) deny('solid-overlap', { stage: 'root', at });
  const boxes = world.query({ min: [body.min[0], at[1] - .05, body.min[2]], max: [body.max[0], at[1] + EPS, body.max[2]] });
  const support = fullySupported(bounds, boxes, at[1]);
  if (support === 'budget-exceeded') deny(support, { stage: 'root', at });
  if (!support) deny('no-physical-support', { stage: 'root', at });
  return bounds;
}
const pointOf = (s: PlayerState): Vec3 => [s.x, s.y, s.z];
function visit(world: CollisionWorld, s: PlayerState, at: Vec3, routeId: string, work: AuthoredPierWork): void {
  let stalled = 0, previous = Infinity;
  for (let tick = 0; tick < 900; tick++) {
    const dx = at[0] - s.x, dz = at[2] - s.z, distance = Math.hypot(dx, dz);
    if (distance < .07 && Math.hypot(s.vx, s.vz) < .05) {
      if (Math.abs(s.y - at[1]) > WALK_BODY.stepHeight + EPS || !s.grounded || !supported(s, world)) deny('route-unsupported', { stage: 'walk', routeId, at: pointOf(s) });
      return;
    }
    if (embeddedSolids(s, world).length) deny('route-blocked', { stage: 'walk', routeId, at: pointOf(s) });
    // Brake as the target approaches; all integration remains the exact shared walking law at 30 Hz.
    const magnitude = Math.min(127, distance * 127 * 5);
    const moveX = distance > .03 ? Math.round(dx / distance * magnitude) : 0;
    const moveZ = distance > .03 ? Math.round(dz / distance * magnitude) : 0;
    if (work.movementTicks >= B.movementTicks) deny('budget-exceeded', { stage: 'walk', routeId });
    work.movementTicks++;
    stepPlayer(s, { moveX, moveZ, buttons: 0, yaw: 0, collisionRevision: world.revision }, 1 / WALK_HZ, world);
    if (!s.grounded || Math.abs(s.y - at[1]) > 1 + WALK_BODY.stepHeight) deny('route-unsupported', { stage: 'walk', routeId, at: pointOf(s) });
    const after = Math.hypot(at[0] - s.x, at[2] - s.z);
    stalled = after >= previous - 1e-5 ? stalled + 1 : 0; previous = after;
    if (stalled >= 30) deny('route-blocked', { stage: 'walk', routeId, at: pointOf(s) });
  }
  deny('route-blocked', { stage: 'walk', routeId, at: pointOf(s), message: 'A route segment did not settle within its tick limit.' });
}
export function walkAuthoredPier(world: CollisionWorld, p: AuthoredPierProposal, work: AuthoredPierWork): void {
  const s: PlayerState = { x: p.entry[0], y: p.entry[1], z: p.entry[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision };
  if (!supported(s, world) || embeddedSolids(s, world).length) deny('route-unsupported', { stage: 'walk', routeId: 'entry', at: p.entry });
  for (const point of p.route) visit(world, s, point, 'main', work);
  for (const fishing of p.fishing) {
    for (const point of fishing.route) visit(world, s, point, fishing.id, work);
    // Rest still to prove the final fishing position is supported rather than a transient falling position.
    for (let i = 0; i < WALK_HZ; i++) {
      if (work.movementTicks >= B.movementTicks) deny('budget-exceeded', { stage: 'walk', routeId: fishing.id });
      work.movementTicks++;
      stepPlayer(s, { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: world.revision }, 1 / WALK_HZ, world);
      if (!s.grounded || embeddedSolids(s, world).length || Math.abs(s.y - fishing.position[1]) > WALK_BODY.stepHeight + EPS) deny('route-unsupported', { stage: 'walk', routeId: fishing.id, at: pointOf(s) });
    }
    for (let i = fishing.route.length - 1; i >= 0; i--) visit(world, s, fishing.route[i]!, `${fishing.id}:return`, work);
  }
  for (let i = p.route.length - 1; i >= 0; i--) visit(world, s, p.route[i]!, 'main:return', work);
  if (Math.hypot(s.x - p.entry[0], s.z - p.entry[2]) > .1 || Math.abs(s.y - p.entry[1]) > EPS) deny('route-unsupported', { stage: 'walk', routeId: 'return', at: pointOf(s) });
}
