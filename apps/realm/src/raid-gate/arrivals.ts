/**
 * The arrival witness for the welcome and visitor gifts (spec 23 R9, RG10): what the realm's own travel records say about
 * an acknowledged arrival, and who stands in a kingdom because of one. Read-only; it never moves anyone.
 *
 * An arrival is `present` while the person's one authoritative whereabouts still names it, in its destination, with no
 * journey fenced. The moment they step back through the gate (or a commit for them is in flight), it is not.
 */
import type { KingdomId } from '../../../../packages/shared/src/identity';
import type { ArrivalWitness, GiftArrivals } from '../../../api/src/raid-gate/gifts';
import type { ArrivalRecord, RecordOrigin, TravelRepository, TravelTransaction, WhereaboutsRecord } from './records';

const OWN = new AbortController().signal;

function witness(arrival: ArrivalRecord, where: WhereaboutsRecord | null): ArrivalWitness {
  const present = where !== null && where.arrivalId === arrival.arrivalId && where.kingdomId === arrival.to && where.fence === null;
  return {
    arrivalId: arrival.arrivalId, personId: arrival.personId, from: arrival.from, to: arrival.to, role: arrival.role, reason: arrival.reason,
    committedAt: arrival.committedAt, present, origin: arrival.origin,
  };
}

export function createArrivalWitness(deps: Readonly<{ repository: TravelRepository; origin: RecordOrigin }>): GiftArrivals {
  const { repository, origin } = deps;
  const read = <T>(work: (tx: TravelTransaction) => Promise<T>, signal: AbortSignal) => repository.transaction(work, signal.aborted ? signal : OWN);
  return {
    origin,
    async read(arrivalId, signal) {
      signal.throwIfAborted();
      return read(async tx => {
        const arrival = await tx.getArrival(arrivalId);
        if (!arrival || arrival.origin !== origin) return null;
        return witness(arrival, await tx.getWhereabouts(arrival.personId));
      }, signal);
    },
    async present(kingdomId: KingdomId, limit, signal) {
      signal.throwIfAborted();
      return read(async tx => {
        const out: ArrivalWitness[] = [];
        for (const where of await tx.listArrivedIn(kingdomId, limit)) {
          const arrival = where.arrivalId === null ? null : await tx.getArrival(where.arrivalId);
          if (!arrival || arrival.origin !== origin) continue;
          const seen = witness(arrival, where);
          if (seen.present) out.push(seen);
        }
        return out;
      }, signal);
    },
  };
}
