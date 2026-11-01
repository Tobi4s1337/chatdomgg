import type { EventCause } from '@chatdom/shared';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import type { NormalizedFact } from '../../../herald/src/twitch-moments/normalizer';
import type { MomentRecordTransaction } from '../../../herald/src/twitch-moments/ports';
import type { MomentRepository } from '../../../herald/src/twitch-moments/records';

/**
 * Append normalized facts and keep current state the way the moment ingest does: a slotted family (the one Hype Train,
 * the one battle) has a single current fact, which a finished occupant releases; any other current fact replaces the
 * public state for its key. Exceeding the current-state budget fails the whole transaction.
 */
export async function commitFacts(tx: MomentRecordTransaction, repository: MomentRepository, facts: readonly NormalizedFact[],
  clocks: { readonly occurredAt: number; readonly receivedAt: number }, cause: EventCause, origin: 'live' | 'simulated'): Promise<TwitchMomentFact[]> {
  const out: TwitchMomentFact[] = [];
  for (const { body, current, slot } of facts) {
    const fact = await tx.appendFact(body, clocks, cause, origin);
    if (slot && !current) await repository.releaseSlot(slot.name, fact.body.key);
    else if (slot ? await repository.setSlotCurrent(slot.name, fact, slot.order) === 'full' : current && !await repository.setCurrent(fact)) {
      throw new Error('Moment current state exceeds its budget');
    }
    out.push(fact);
  }
  return out;
}
