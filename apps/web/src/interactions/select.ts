import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmInteractionAction, RealmSeat } from '@chatdom/shared/realm';
import { horizontalDistance, interactionLegality, segmentClear, standingClear, withinReach, type InteractionActor, type InteractionBlock, type InteractionRecord } from '../../../../packages/world/src/interactions';
import type { LookFrame, PointerRay } from './ports';

/**
 * Which one thing E (or a click, a tap, a gamepad press) would use. Pure: explicit frame, records, collision and
 * seats in, one decision out; no DOM, clock or authority. Look and pointer both judge a target with the same
 * `assessTarget`, so every input resolves through one registry and one set of rules. The room checks reach and
 * occlusion again on its own pose.
 */

/** A target must lie within this half-angle of the view to be chosen (34°). */
export const LOOK_CONE = Math.cos(34 * Math.PI / 180);
/** The current choice is kept while it stays within this wider half-angle (42°)… */
export const KEEP_CONE = Math.cos(42 * Math.PI / 180);
/** …and is no more than this much farther than the best new candidate, so the prompt never flickers on a tie. */
export const KEEP_SLACK = .4;
/** A click or tap within this many metres of a target's authored point means that target. */
export const PICK_RADIUS = .5;
/** Closer than this the target is underfoot and counts as straight ahead. */
const UNDERFOOT = .3;

export interface InteractionCandidate {
  readonly record: InteractionRecord;
  readonly action: RealmInteractionAction;
  readonly distance: number;
  readonly alignment: number;
}
/**
 * Why a seen target is not offered. Only `occupied`, `not-yours` and an owner's `blocked` doorway are ever said on the
 * look; a pick can say `far`.
 */
export type InteractionHold = Extract<InteractionBlock, 'occupied' | 'not-yours' | 'blocked'> | 'far';
export interface InteractionQuiet {
  readonly record: InteractionRecord;
  readonly reason: InteractionHold;
  readonly distance: number;
}
export interface InteractionSelection {
  /** The actionable target, or null. Never occluded, out of reach, unsupported or illegal. */
  readonly focus: InteractionCandidate | null;
  /** When nothing is actionable: the nearest visible target that is taken or someone else's, said quietly. */
  readonly quiet: InteractionQuiet | null;
}
interface Situation {
  readonly records: readonly InteractionRecord[];
  readonly world: CollisionWorld | null;
  readonly actor: InteractionActor;
  readonly seats: readonly RealmSeat[];
}
export interface SelectInput extends Situation {
  readonly frame: LookFrame;
  /** Last frame's focus ID, for hysteresis. */
  readonly previous: string | null;
}
export interface PickInput extends Situation {
  /** The body's feet this frame (the same feet the look uses). */
  readonly feet: Vec3;
  /** The camera ray under the cursor or finger. */
  readonly ray: PointerRay;
}
/** What a click or tap landed on: the target it meant, and the candidate if it can be used now. */
export interface InteractionPick {
  readonly record: InteractionRecord;
  readonly candidate: InteractionCandidate | null;
  readonly hold: InteractionHold | null;
}

/** Cosine between the horizontal view direction and the horizontal direction from the feet to the target. */
export function viewAlignment(frame: LookFrame, target: Vec3): number {
  const fx = frame.forward[0], fz = frame.forward[2], fl = Math.hypot(fx, fz);
  const dx = target[0] - frame.feet[0], dz = target[2] - frame.feet[2], dl = Math.hypot(dx, dz);
  if (dl < UNDERFOOT) return 1;
  if (fl < 1e-6) return -1;
  return (fx * dx + fz * dz) / (fl * dl);
}

/** Rank: nearer first, then better aligned, then the stable authored ID. */
function better(a: InteractionCandidate, b: InteractionCandidate): boolean {
  if (Math.abs(a.distance - b.distance) > 1e-6) return a.distance < b.distance;
  if (Math.abs(a.alignment - b.alignment) > 1e-6) return a.alignment > b.alignment;
  return a.record.target.id < b.record.target.id;
}

export type TargetAssessment =
  | { readonly usable: true; readonly action: RealmInteractionAction; readonly distance: number }
  | { readonly usable: false; readonly hold: InteractionHold | null; readonly distance: number };

/**
 * The physical and legal judgement of one target from these feet, shared by the look and the pointer: reach with a
 * clear eye line, the family/state law, and a supported, full-body-clear approach. Seated, only your own seat (to
 * stand) is usable.
 */
export function assessTarget(world: CollisionWorld, feet: Vec3, record: InteractionRecord, actor: InteractionActor, occupant: RealmSeat | null): TargetAssessment {
  const distance = horizontalDistance(feet, record.target.position);
  if (actor.state.mode === 'seated') {
    return actor.state.targetId === record.target.id ? { usable: true, action: 'stand', distance } : { usable: false, hold: null, distance };
  }
  if (!withinReach(world, feet, record.target)) return { usable: false, hold: 'far', distance };
  const legality = interactionLegality(actor, record, occupant);
  if (!legality.legal) return { usable: false, hold: legality.reason === 'occupied' || legality.reason === 'not-yours' || legality.reason === 'blocked' ? legality.reason : null, distance };
  if (!standingClear(world, record.target.approach)) return { usable: false, hold: null, distance };
  return { usable: true, action: legality.action, distance };
}

export function selectInteraction(input: SelectInput): InteractionSelection {
  const { frame, actor, world } = input;
  const seatOf = new Map(input.seats.map(seat => [seat.targetId, seat]));
  // Seated: E stands you up from your own seat wherever you look; nothing else is offered until you do.
  if (actor.state.mode === 'seated') {
    const own = input.records.find(record => record.target.id === actor.state.targetId);
    return { focus: own ? { record: own, action: 'stand', distance: horizontalDistance(frame.feet, own.target.position), alignment: viewAlignment(frame, own.target.position) } : null, quiet: null };
  }
  if (!world) return { focus: null, quiet: null };
  let best: InteractionCandidate | null = null, kept: InteractionCandidate | null = null, quiet: InteractionQuiet | null = null;
  for (const record of input.records) {
    const { target } = record;
    const alignment = viewAlignment(frame, target.position);
    const previous = target.id === input.previous;
    if (alignment < (previous ? KEEP_CONE : LOOK_CONE)) continue;
    const judged = assessTarget(world, frame.feet, record, actor, seatOf.get(target.id) ?? null);
    if (!judged.usable) {
      // Out of reach says nothing on the look: only what you could reach but may not use is said, quietly.
      if (judged.hold && judged.hold !== 'far' && alignment >= LOOK_CONE && (!quiet || judged.distance < quiet.distance)) quiet = { record, reason: judged.hold, distance: judged.distance };
      continue;
    }
    const candidate: InteractionCandidate = { record, action: judged.action, distance: judged.distance, alignment };
    if (previous) kept = candidate;
    if (alignment >= LOOK_CONE && (!best || better(candidate, best))) best = candidate;
  }
  const focus = kept && (!best || kept.distance <= best.distance + KEEP_SLACK) ? kept : best;
  return { focus, quiet: focus ? null : quiet };
}

/**
 * The target a click/tap/ray meant: the nearest authored point within `PICK_RADIUS` of the ray, seen from the
 * camera without a solid in between. It is usable only if the same judgement as the look allows it from the feet.
 */
export function pickInteraction(input: PickInput): InteractionPick | null {
  const { ray, world, feet } = input;
  if (!world) return null;
  const length = Math.hypot(ray.direction[0], ray.direction[1], ray.direction[2]);
  if (!(length > 1e-9)) return null;
  const d: Vec3 = [ray.direction[0] / length, ray.direction[1] / length, ray.direction[2] / length];
  const seatOf = new Map(input.seats.map(seat => [seat.targetId, seat]));
  let hit: { record: InteractionRecord; t: number } | null = null;
  for (const record of input.records) {
    const p = record.target.position;
    const ox = p[0] - ray.origin[0], oy = p[1] - ray.origin[1], oz = p[2] - ray.origin[2];
    const t = ox * d[0] + oy * d[1] + oz * d[2];
    if (t <= 0) continue;
    const miss = Math.hypot(ox - d[0] * t, oy - d[1] * t, oz - d[2] * t);
    if (miss > PICK_RADIUS || (hit && t >= hit.t)) continue;
    if (!segmentClear(world, ray.origin, p)) continue;
    hit = { record, t };
  }
  if (!hit) return null;
  const { record } = hit;
  const judged = assessTarget(world, feet, record, input.actor, seatOf.get(record.target.id) ?? null);
  if (!judged.usable) return { record, candidate: null, hold: judged.hold };
  const alignment = viewAlignment({ feet, forward: d }, record.target.position);
  return { record, candidate: { record, action: judged.action, distance: judged.distance, alignment }, hold: null };
}
