import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmInteractionAction, RealmSeat } from '@chatdom/shared/realm';
import { horizontalDistance, interactionLegality, standingClear, withinReach, type InteractionActor, type InteractionBlock, type InteractionRecord } from '../../../../packages/world/src/interactions';
import type { LookFrame } from './ports';

/**
 * Per-frame choice of the one thing E would use. Pure: explicit frame, records, collision and seats in, one
 * decision out; no DOM, clock or authority. The room checks the same reach and occlusion again on its own pose.
 */

/** A target must lie within this half-angle of the view to be chosen (34°). */
export const LOOK_CONE = Math.cos(34 * Math.PI / 180);
/** The current choice is kept while it stays within this wider half-angle (42°)… */
export const KEEP_CONE = Math.cos(42 * Math.PI / 180);
/** …and is no more than this much farther than the best new candidate, so the prompt never flickers on a tie. */
export const KEEP_SLACK = .4;
/** Closer than this the target is underfoot and counts as straight ahead. */
const UNDERFOOT = .3;

export interface InteractionCandidate {
  readonly record: InteractionRecord;
  readonly action: RealmInteractionAction;
  readonly distance: number;
  readonly alignment: number;
}
export interface InteractionQuiet {
  readonly record: InteractionRecord;
  readonly reason: Extract<InteractionBlock, 'occupied' | 'not-yours'>;
  readonly distance: number;
}
export interface InteractionSelection {
  /** The actionable target, or null. Never occluded, out of reach, unsupported or illegal. */
  readonly focus: InteractionCandidate | null;
  /** When nothing is actionable: the nearest visible target that is taken or someone else's, said quietly. */
  readonly quiet: InteractionQuiet | null;
}
export interface SelectInput {
  readonly frame: LookFrame;
  readonly records: readonly InteractionRecord[];
  readonly world: CollisionWorld | null;
  readonly actor: InteractionActor;
  readonly seats: readonly RealmSeat[];
  /** Last frame's focus ID, for hysteresis. */
  readonly previous: string | null;
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
    if (!withinReach(world, frame.feet, target)) continue;
    const distance = horizontalDistance(frame.feet, target.position);
    const legality = interactionLegality(actor, record, seatOf.get(target.id) ?? null);
    if (!legality.legal) {
      if ((legality.reason === 'occupied' || legality.reason === 'not-yours') && alignment >= LOOK_CONE && (!quiet || distance < quiet.distance)) quiet = { record, reason: legality.reason, distance };
      continue;
    }
    if (!standingClear(world, target.approach)) continue;
    const candidate: InteractionCandidate = { record, action: legality.action, distance, alignment };
    if (previous) kept = candidate;
    if (alignment >= LOOK_CONE && (!best || better(candidate, best))) best = candidate;
  }
  const focus = kept && (!best || kept.distance <= best.distance + KEEP_SLACK) ? kept : best;
  return { focus, quiet: focus ? null : quiet };
}
