import type { PersonId } from '@chatdom/shared';
import type { RealmInteractionLease } from '@chatdom/shared/realm';
import { campfireSeatOf, tavernSeatOf } from '../../../../packages/world/src/interactions/places';
import type { InteractionAdmission, InteractionHosts, InteractionReleaseCause } from './ports';

/**
 * The two existing seat owners as the room sees them. Each producer keeps its own policy, lottery, voice and game
 * seats; these are only the seams a physical log or chair needs. Nothing here grants a voice, a game seat or a
 * table view: a social sit is a physical lease and nothing more.
 */

/** A lease as its producer names it, with the exact generation a later `endSeat` must quote. */
export interface HostedSeat<Place> {
  readonly place: Place;
  readonly personId: PersonId;
  readonly sessionId: string;
  readonly generation: number;
}

/**
 * The campfire's physical-seat policy (spec 21). `admit` is asked before a walk-up sit only when present: the fire
 * refuses a log its match holds (seating/playing), says unavailable when it cannot answer, and otherwise lets the
 * person sit socially. `released` reaches its voice/admission supervisor in the same turn a log lease ends (stand,
 * expiry, moderation), which enforces any voice removal within its own one-second policy.
 */
export interface CampfireSeatHost {
  admit?(request: { readonly site: string; readonly seat: number; readonly personId: PersonId; readonly signal: AbortSignal }): Promise<InteractionAdmission>;
  released?(seat: HostedSeat<{ readonly site: string; readonly seat: number }>, why: InteractionReleaseCause): void;
}

/**
 * A tavern table's existing match host (spec 22, the Trestle seat lease service). `admit` reserves the server-bound
 * table seat for this person or declines; `cancel` on the answer returns that reservation (the room calls it when
 * the physical claim fails, or when the lease later ends). `released` lets the host close the guest's table view
 * and leave its match seat; durable match state stays with the host.
 */
export interface TableSeatHost {
  admit(request: { readonly table: string; readonly seat: string; readonly personId: PersonId; readonly signal: AbortSignal }): Promise<InteractionAdmission>;
  released?(seat: HostedSeat<{ readonly table: string; readonly seat: string }>, why: InteractionReleaseCause): void;
}

const NOT_HERE: InteractionAdmission = { admitted: false, reason: 'unavailable' };

/**
 * `InteractionAuthorityOptions.hosts` from whichever producers are installed. A missing tavern host leaves every
 * chair honestly unavailable (no table opens); a missing campfire host leaves logs social-only with nobody told.
 * A host that throws is treated as unable to answer, never as a yes.
 */
export function composeInteractionHosts(producers: { readonly campfire?: CampfireSeatHost; readonly tavern?: TableSeatHost }): InteractionHosts {
  const { campfire, tavern } = producers;
  const decides: ('campfire-seat' | 'tavern-seat')[] = [];
  if (tavern) decides.push('tavern-seat');
  if (campfire?.admit) decides.push('campfire-seat');
  const ask = async (call: () => Promise<InteractionAdmission>): Promise<InteractionAdmission> => {
    try { return await call(); } catch { return NOT_HERE; }
  };
  return {
    decides,
    ...(campfire?.admit || tavern ? {
      async admit({ targetId, personId, signal }) {
        const log = campfireSeatOf(targetId);
        if (log) return campfire?.admit ? ask(() => campfire.admit!({ ...log, personId, signal })) : NOT_HERE;
        const chair = tavernSeatOf(targetId);
        if (chair) return tavern ? ask(() => tavern.admit({ ...chair, personId, signal })) : NOT_HERE;
        return NOT_HERE;
      },
    } : {}),
    released(lease: RealmInteractionLease, why: InteractionReleaseCause) {
      const { personId, sessionId } = lease, generation = lease.seat.generation;
      // The lease has already ended in the room; a failing host must not stop the room from publishing it.
      try {
        const log = campfireSeatOf(lease.seat.targetId);
        if (log) { campfire?.released?.({ place: log, personId, sessionId, generation }, why); return; }
        const chair = tavernSeatOf(lease.seat.targetId);
        if (chair) tavern?.released?.({ place: chair, personId, sessionId, generation }, why);
      } catch (error) { console.error('A seat host failed to hear a released seat', error); }
    },
  };
}
