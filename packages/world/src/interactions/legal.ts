import type { RealmInteractionAction, RealmInteractionResult, RealmInteractionState, RealmSeat } from '@chatdom/shared/realm';
import { ACTION_FOR_KIND } from './ids';
import type { InteractionRecord } from './registry';

/** What the rules need to know about the person acting. Server: authoritative. Browser: a hint only. */
export interface InteractionActor {
  readonly walkerId: string;
  /** The zone the body is in now (`street`, `tavern:<id>`, `home:<plot>`). */
  readonly zone: string;
  readonly state: RealmInteractionState;
  /** Plot of the installed deed this person owns, or null. Never a slot, a name or a browser choice. */
  readonly ownedPlotId: string | null;
}
export type InteractionBlock = 'seated' | 'wrong-zone' | 'occupied' | 'not-yours' | 'not-inside';
export type InteractionLegality =
  | { readonly legal: true; readonly action: RealmInteractionAction }
  | { readonly legal: false; readonly action: RealmInteractionAction; readonly reason: InteractionBlock };

export const STANDING: RealmInteractionState = Object.freeze({ revision: 0, mode: 'standing', targetId: null, plotId: null });

/**
 * The one action E would perform on this target for this actor, and whether the rules allow it right now.
 * Reach, occlusion and approach clearance are physical checks made separately; this is the family/state law.
 * While seated, your own seat offers `stand` and everything else waits until you stand.
 */
export function interactionLegality(actor: InteractionActor, record: Pick<InteractionRecord, 'target' | 'zone'>, occupant: RealmSeat | null): InteractionLegality {
  const { target } = record;
  const action = ACTION_FOR_KIND[target.kind];
  if (actor.state.mode === 'seated') {
    return actor.state.targetId === target.id ? { legal: true, action: 'stand' } : { legal: false, action, reason: 'seated' };
  }
  if (record.zone !== actor.zone) return { legal: false, action, reason: 'wrong-zone' };
  switch (target.kind) {
    case 'campfire-seat': case 'tavern-seat':
      return occupant && occupant.walkerId !== actor.walkerId ? { legal: false, action, reason: 'occupied' } : { legal: true, action };
    case 'anvil':
      return { legal: true, action };
    case 'home-door':
      return actor.ownedPlotId !== null && target.plotId === actor.ownedPlotId ? { legal: true, action } : { legal: false, action, reason: 'not-yours' };
    case 'home-exit':
      return actor.state.mode === 'interior' && actor.state.plotId === target.plotId ? { legal: true, action } : { legal: false, action, reason: 'not-inside' };
  }
}
/** The legal actions for this target: empty, or exactly one. */
export function legalInteractionActions(actor: InteractionActor, record: Pick<InteractionRecord, 'target' | 'zone'>, occupant: RealmSeat | null): readonly RealmInteractionAction[] {
  const legality = interactionLegality(actor, record, occupant);
  return legality.legal ? [legality.action] : [];
}
/** The frozen refusal vocabulary for each blocked rule. */
export function refusalFor(reason: InteractionBlock): Extract<RealmInteractionResult, { kind: 'refused' }>['reason'] {
  return reason === 'occupied' ? 'occupied' : reason === 'not-yours' || reason === 'seated' ? 'forbidden' : 'unreachable';
}
