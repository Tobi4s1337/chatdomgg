/**
 * A SIMULATED room membership transport for tests and the labelled bench. It keeps what main's real transport must
 * keep: one walking membership per person with a fencing generation, holds keyed by ticket, an atomic commit that
 * honours the generation, a reconcile that never moves anyone and refuses later commits once it has answered, and
 * idempotent releases. Its origin is always `simulated`, so a live coordinator refuses it.
 */
import { kingdomForBroadcaster, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';
import type {
  AdmissionOutcome, CommitOutcome, HoldOutcome, PrepareOutcome, RealmTravelTransport, ReleaseOutcome, TicketStatus, TravelTicketRef,
} from './ports';
import type { TravelRole } from './records';

type Hold = { ref: TravelTicketRef; leaseUntil: number; prepares: number; committed: Readonly<{ role: TravelRole; committedAt: number }> | null; settled: boolean };

export type SimulatedRoomsOptions = Readonly<{
  clock: () => number;
  /** Destinations that have a founded kingdom room. Anything else has no room to enter. */
  rooms: readonly KingdomId[];
  /** People who hold a deed in a kingdom and arrive there as citizens. */
  citizens?: ReadonlyMap<PersonId, KingdomId>;
  /** How many `prepare` calls answer pending before the world is ready. */
  prepareSteps?: number;
  leaseMs?: number;
}>;

export interface SimulatedRooms {
  readonly transport: RealmTravelTransport;
  /** Every call in order, for assertions: `reserve t1`, `commit t1`, `release-source t1`… */
  readonly calls: readonly string[];
  /** Where each person walks, by the transport's own membership table. */
  membership(personId: PersonId): Readonly<{ kingdomId: KingdomId; generation: number }> | null;
  /** Active walking leases for a person: always 0 or 1. */
  leases(personId: PersonId): number;
  /** Places still held for tickets that will not commit (should drain to 0). */
  openHolds(): number;
  /** Retained source places not yet released after a committed move. */
  retainedSources(): number;
  place(personId: PersonId, kingdomId: KingdomId): void;
  /** The next commit happens, but its answer is lost on the way back. */
  loseNextCommitAnswer(): void;
  /** The destination refuses at the door on the next commit. */
  denyNextCommit(): void;
  /** The destination is full for the next admission check. */
  fillNextAdmission(): void;
  /** Releases fail while true (the room server is away). */
  failReleases(on: boolean): void;
  /** The next reserve answer is lost (the hold still happens). */
  loseNextReserveAnswer(): void;
}

export function createSimulatedRooms(options: SimulatedRoomsOptions): SimulatedRooms {
  const { clock } = options;
  const leaseMs = options.leaseMs ?? 120_000;
  const calls: string[] = [];
  const members = new Map<PersonId, { kingdomId: KingdomId; generation: number }>();
  const holds = new Map<string, Hold>();
  const retained = new Set<string>();
  let loseCommit = false, denyCommit = false, full = false, releasesFail = false, loseReserve = false;

  const roleAt = (personId: PersonId, kingdomId: KingdomId): TravelRole =>
    kingdomForBroadcaster(personId) === kingdomId ? 'monarch' : options.citizens?.get(personId) === kingdomId ? 'citizen' : 'visitor';

  const transport: RealmTravelTransport = {
    origin: 'simulated',
    async checkAdmission(personId, kingdomId): Promise<AdmissionOutcome> {
      calls.push(`admission ${kingdomId}`);
      if (!options.rooms.includes(kingdomId)) return { kind: 'denied' };
      if (full) { full = false; return { kind: 'full' }; }
      return { kind: 'admitted' };
    },
    async reserve(ref): Promise<HoldOutcome> {
      calls.push(`reserve ${ref.ticket}`);
      if (!options.rooms.includes(ref.to)) return { kind: 'denied', code: 'refused' };
      const existing = holds.get(ref.ticket);
      if (existing?.settled) return { kind: 'denied', code: 'refused' };
      const hold = existing ?? { ref, leaseUntil: clock() + leaseMs, prepares: 0, committed: null, settled: false };
      holds.set(ref.ticket, hold);
      if (loseReserve) { loseReserve = false; throw new Error('SIMULATED: the reserve answer was lost'); }
      return { kind: 'acknowledged', leaseUntil: hold.leaseUntil };
    },
    async prepare(ref): Promise<PrepareOutcome> {
      calls.push(`prepare ${ref.ticket}`);
      const hold = holds.get(ref.ticket);
      if (!hold || hold.settled) return { kind: 'denied' };
      hold.prepares++;
      return hold.prepares > (options.prepareSteps ?? 0) ? { kind: 'acknowledged' } : { kind: 'pending' };
    },
    async commit(ref): Promise<CommitOutcome> {
      calls.push(`commit ${ref.ticket}`);
      const hold = holds.get(ref.ticket);
      if (hold?.committed) return { kind: 'acknowledged', ...hold.committed };
      if (!hold || hold.settled) return { kind: 'denied' };
      if (denyCommit) { denyCommit = false; return { kind: 'denied' }; }
      const current = members.get(ref.personId) ?? { kingdomId: ref.from, generation: 0 };
      // The fence: only a person still at the generation this journey left from moves, and only from where it began.
      if (current.generation !== ref.generation - 1 || current.kingdomId !== ref.from) return { kind: 'denied' };
      members.set(ref.personId, { kingdomId: ref.to, generation: ref.generation });
      hold.committed = { role: roleAt(ref.personId, ref.to), committedAt: clock() };
      retained.add(ref.ticket);
      if (loseCommit) { loseCommit = false; throw new Error('SIMULATED: the commit answer was lost'); }
      return { kind: 'acknowledged', ...hold.committed };
    },
    async reconcile(ref): Promise<TicketStatus> {
      calls.push(`reconcile ${ref.ticket}`);
      const hold = holds.get(ref.ticket);
      if (hold?.committed) return { kind: 'committed', ...hold.committed };
      if (!hold || hold.settled) return { kind: 'released' };
      // From here a later commit for this ticket is refused, so this answer stays true.
      hold.settled = true;
      holds.delete(ref.ticket);
      return { kind: 'released' };
    },
    async release(ref, side): Promise<ReleaseOutcome> {
      calls.push(`release-${side} ${ref.ticket}`);
      if (releasesFail) return { kind: 'unknown' };
      if (side === 'source') retained.delete(ref.ticket);
      else {
        const hold = holds.get(ref.ticket);
        if (hold && !hold.committed) { hold.settled = true; holds.delete(ref.ticket); }
      }
      return { kind: 'acknowledged' };
    },
  };

  return {
    transport, calls,
    membership: personId => members.get(personId) ?? null,
    leases: personId => members.has(personId) ? 1 : 0,
    openHolds: () => [...holds.values()].filter(hold => !hold.committed && !hold.settled).length,
    retainedSources: () => retained.size,
    place(personId, kingdomId) { members.set(personId, { kingdomId, generation: 0 }); },
    loseNextCommitAnswer() { loseCommit = true; },
    denyNextCommit() { denyCommit = true; },
    fillNextAdmission() { full = true; },
    failReleases(on) { releasesFail = on; },
    loseNextReserveAnswer() { loseReserve = true; },
  };
}
