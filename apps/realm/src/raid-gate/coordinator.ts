/**
 * The raid travel coordinator (spec 23 R5, R6, R12): one person's journey between kingdoms, reserved, readied,
 * committed once and acknowledged, or rolled back with the source intact.
 *
 * - Reserve checks who may go (a marcher on a witnessed raid, a visitor, or someone returning from their own arrival),
 *   looks at the destination's door, then records the ticket before asking the room transport to hold a place.
 * - Prepare asks the destination to ready its world; readiness is the destination's answer, never a timer.
 * - Commit fences the person's whereabouts in the same transaction that marks the ticket `committing`, then hands the
 *   room transport one commit with the next membership generation. Only the destination's acknowledgment moves the
 *   whereabouts and creates the arrival; only then is the retained source released.
 * - An ambiguous commit is `unknown` and stays fenced: nothing else moves this person and the commit is never handed
 *   over again. Reconcile asks the room transport what became of the ticket and settles it either way.
 * - Cancel, a lapsed lease, a destination refusal or a different session before commit releases the destination's
 *   hold and leaves the person where they were. A late answer for a ticket that already ended is ignored and released.
 * - Waiting land has no room: a raid to an unfounded channel never reserves anything.
 */
import { kingdomForBroadcaster, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';
import type { GateContext, GateDenial, TravelReason, TravelView } from '../../../api/src/raid-gate/contracts';
import { epoch, fields, oneOf } from '../../../api/src/raid-gate/guard';
import type { RaidTravel, TravelReply } from '../../../api/src/raid-gate/ports';
import type {
  AdmissionOutcome, CommitOutcome, HoldOutcome, PrepareOutcome, RaidTravelDeps, ReleaseOutcome, TicketStatus, TravelRecovery, TravelTicketRef,
} from './ports';
import {
  arrivalIdFor, OPEN_STATES, PRE_COMMIT_STATES, sameReason,
  type ArrivalRecord, type Stored, type TravelRecord, type TravelRole, type TravelTransaction, type WhereaboutsRecord,
} from './records';

export interface RaidTravelCoordinator extends RaidTravel {
  /**
   * One recovery pass for main's timer and start-up: lapse expired reservations, reconcile commits that may have
   * happened, and retry owed releases. Continues where the previous pass stopped, so a stuck ticket cannot starve others.
   */
  recover(now: number, limit: number): Promise<TravelRecovery>;
}

export const TRAVEL_LIMITS = Object.freeze({
  /** How long a reservation the destination has not yet acknowledged is kept. */
  unheldLeaseMs: 30_000,
  /** The longest hold a destination may grant before commit. */
  maxLeaseMs: 5 * 60_000,
  /** A commit with no answer after this long is told as unknown and reconciled. */
  commitStallMs: 20_000,
});

const CALL_TIMEOUT_MS = 10_000;
const CONFLICT_RETRIES = 3;
const OWN = new AbortController().signal;
const ROLES = ['monarch', 'citizen', 'visitor'] as const;

class Denied extends Error {
  constructor(readonly code: GateDenial) { super(code); }
}
class Conflict extends Error {}

function stored<T>(result: Stored<T>): T {
  if (result.kind === 'conflict') throw new Conflict();
  return result.record;
}

const view = (record: TravelRecord): TravelView => ({
  ticket: record.ticket, revision: record.revision, from: record.from, to: record.to, state: record.state,
  leaseUntil: record.leaseUntil, role: record.role, arrivalId: record.arrivalId,
});
const travel = (record: TravelRecord): TravelReply => ({ kind: 'travel', value: view(record) });
const denied = (code: GateDenial): TravelReply => ({ kind: 'denied', code });

const refOf = (record: TravelRecord): TravelTicketRef => ({
  ticket: record.ticket, personId: record.personId, sessionId: record.sessionId, from: record.from, to: record.to,
  generation: record.baseGeneration + 1, kind: record.reason.kind,
});

// ---- Strict readers for the room transport's answers: anything outside the contract is an answer nobody vouches for.

const kindOf = (value: unknown): unknown => typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
const bare = <K extends string>(value: unknown, kinds: readonly K[]): K | undefined => {
  const kind = oneOf(kindOf(value), kinds);
  return kind && fields(value, ['kind']) ? kind : undefined;
};

function readAdmission(value: unknown): AdmissionOutcome {
  return { kind: bare(value, ['admitted', 'full', 'denied'] as const) ?? 'unknown' };
}
function readHold(value: unknown): HoldOutcome {
  if (kindOf(value) === 'acknowledged') {
    const f = fields(value, ['kind', 'leaseUntil']);
    const leaseUntil = f && epoch(f.leaseUntil);
    return leaseUntil ? { kind: 'acknowledged', leaseUntil } : { kind: 'unknown' };
  }
  if (kindOf(value) === 'denied') {
    const f = fields(value, ['kind', 'code']);
    const code = f && oneOf(f.code, ['full', 'refused'] as const);
    return code ? { kind: 'denied', code } : { kind: 'unknown' };
  }
  return { kind: bare(value, ['pending'] as const) ?? 'unknown' };
}
function readPrepare(value: unknown): PrepareOutcome {
  return { kind: bare(value, ['acknowledged', 'pending', 'denied'] as const) ?? 'unknown' };
}
function readRoleAt(value: unknown, kind: string): Readonly<{ role: TravelRole; committedAt: number }> | undefined {
  const f = kindOf(value) === kind ? fields(value, ['kind', 'role', 'committedAt']) : undefined;
  const role = f && oneOf(f.role, ROLES), committedAt = f && epoch(f.committedAt);
  return role && committedAt !== undefined ? { role, committedAt } : undefined;
}
function readCommit(value: unknown): CommitOutcome {
  const acknowledged = readRoleAt(value, 'acknowledged');
  if (acknowledged) return { kind: 'acknowledged', ...acknowledged };
  return { kind: bare(value, ['pending', 'denied'] as const) ?? 'unknown' };
}
function readStatus(value: unknown): TicketStatus {
  const committed = readRoleAt(value, 'committed');
  if (committed) return { kind: 'committed', ...committed };
  return { kind: bare(value, ['held', 'released'] as const) ?? 'unknown' };
}
function readRelease(value: unknown): ReleaseOutcome {
  return { kind: bare(value, ['acknowledged'] as const) ?? 'unknown' };
}

export function createRaidTravelCoordinator(deps: RaidTravelDeps): RaidTravelCoordinator {
  const { repository, rooms, marches, clock, origin } = deps;
  const tickets = deps.tickets ?? (() => crypto.randomUUID());
  const callTimeoutMs = deps.callTimeoutMs ?? CALL_TIMEOUT_MS;
  if (typeof clock !== 'function') throw new Error('The travel coordinator needs main\'s server clock.');
  // A live journey never moves through a controlled room transport, and a simulated one never reaches real rooms.
  if (rooms.origin !== origin) throw new Error(`The travel coordinator is ${origin}, but its room transport is ${rooms.origin}.`);
  /** Where the previous recovery pass stopped, per listing. */
  const cursors: Record<'open' | 'release', string | null> = { open: null, release: null };

  async function transact<T>(work: (tx: TravelTransaction) => Promise<T>, signal: AbortSignal = OWN): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await repository.transaction(work, signal);
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (attempt + 1 >= CONFLICT_RETRIES) throw new Denied('stale');
      }
    }
  }

  /** One room call with a server-owned deadline: a viewer leaving cannot abort a move that may be happening. */
  async function ask<T>(call: (signal: AbortSignal) => Promise<unknown>, read: (value: unknown) => T, unknown: T): Promise<T> {
    try {
      return read(await call(AbortSignal.timeout(callTimeoutMs)));
    } catch {
      return unknown;
    }
  }

  async function advance(tx: TravelTransaction, record: TravelRecord, change: Partial<TravelRecord>): Promise<TravelRecord> {
    const now = clock();
    return stored(await tx.putTravel({ ...record, ...change, revision: record.revision + 1, updatedAt: Math.max(now, record.updatedAt) }, record.revision));
  }

  /** Clears this ticket from the person's whereabouts (it is no longer outstanding, and no longer fences anything). */
  async function unfence(tx: TravelTransaction, record: TravelRecord): Promise<void> {
    const here = await tx.getWhereabouts(record.personId);
    if (!here || here.active !== record.ticket) return;
    stored(await tx.putWhereabouts({ ...here, revision: here.revision + 1, active: null, fence: null, updatedAt: Math.max(clock(), here.updatedAt) }, here.revision));
  }

  /** Ends a ticket that never committed. A destination that may hold a place for it is owed a release. */
  async function rollBack(tx: TravelTransaction, record: TravelRecord, state: 'cancelled' | 'expired' | 'denied', holds: boolean): Promise<TravelRecord> {
    await unfence(tx, record);
    return advance(tx, record, { state, release: holds ? 'destination' : 'none', settledAt: clock() });
  }

  async function read(ticket: string): Promise<TravelRecord | null> {
    return transact(tx => tx.getTravel(ticket));
  }

  /** The ticket, if it is this person's. */
  async function own(context: GateContext, ticket: string): Promise<TravelRecord> {
    const record = await transact(tx => tx.getTravel(ticket), context.signal);
    if (!record) throw new Denied('stale');
    if (record.personId !== context.principal.personId) throw new Denied('unauthorized');
    return record;
  }

  // ---- Room steps ------------------------------------------------------------------------------------------------

  /** Pays any release this ticket still owes. Idempotent at the room transport; retried by recovery. */
  async function releaseOwed(ticket: string): Promise<boolean> {
    const record = await read(ticket);
    if (!record || record.release === 'none') return false;
    const side = record.release;
    const outcome = await ask(signal => rooms.release(refOf(record), side, signal), readRelease, { kind: 'unknown' } as ReleaseOutcome);
    if (outcome.kind !== 'acknowledged') return false;
    return transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || current.release !== side) return false;
      await advance(tx, current, { release: 'none' });
      return true;
    });
  }

  /** Asks the destination to hold a place. Safe to repeat: the hold is keyed by ticket. */
  async function hold(ticket: string): Promise<void> {
    const record = await read(ticket);
    if (!record || record.state !== 'reserved' || record.held) return;
    const outcome = await ask(signal => rooms.reserve(refOf(record), signal), readHold, { kind: 'unknown' } as HoldOutcome);
    const late = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current) return false;
      if (current.state !== 'reserved') {
        // This ticket ended while the destination was answering: whatever it holds is released.
        if (outcome.kind !== 'denied' && !OPEN_STATES.has(current.state) && current.state !== 'committed' && current.release === 'none') {
          await advance(tx, current, { release: 'destination' });
          return true;
        }
        return false;
      }
      if (outcome.kind === 'acknowledged') {
        const now = clock();
        await advance(tx, current, { held: true, leaseUntil: Math.min(Math.max(outcome.leaseUntil, now), now + TRAVEL_LIMITS.maxLeaseMs) });
      } else if (outcome.kind === 'denied') {
        await rollBack(tx, current, 'denied', false);
      }
      return false;
    });
    if (late) await releaseOwed(ticket);
  }

  /** Asks the destination whether its world is ready for this person. */
  async function ready(ticket: string): Promise<void> {
    const record = await read(ticket);
    if (!record || record.state !== 'preparing') return;
    const outcome = await ask(signal => rooms.prepare(refOf(record), signal), readPrepare, { kind: 'unknown' } as PrepareOutcome);
    if (outcome.kind === 'pending' || outcome.kind === 'unknown') return;
    const owed = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || current.state !== 'preparing') return false;
      if (outcome.kind === 'acknowledged') { await advance(tx, current, { state: 'ready' }); return false; }
      await rollBack(tx, current, 'denied', true);
      return true;
    });
    if (owed) await releaseOwed(ticket);
  }

  /** A reservation whose lease ran out before commit ends, and its hold is released. */
  async function expire(ticket: string, now: number): Promise<boolean> {
    const ended = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || !PRE_COMMIT_STATES.has(current.state) || now < current.leaseUntil) return false;
      await rollBack(tx, current, 'expired', true);
      return true;
    });
    if (ended) await releaseOwed(ticket);
    return ended;
  }

  async function cancelBeforeCommit(ticket: string): Promise<void> {
    const owed = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || !PRE_COMMIT_STATES.has(current.state)) return false;
      await rollBack(tx, current, 'cancelled', true);
      return true;
    });
    if (owed) await releaseOwed(ticket);
  }

  /**
   * The destination acknowledged the commit: the arrival exists, the person stands at the destination at the next
   * generation, and only now is the retained source let go. Repeating this (a reconciled commit) changes nothing.
   */
  async function arrive(ticket: string, role: TravelRole, committedAt: number): Promise<void> {
    const owed = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || current.state === 'committed') return false;
      if (current.state !== 'committing' && current.state !== 'unknown') {
        throw new Error(`The room transport committed ticket ${ticket} after it ${current.state}; its contract forbids that.`);
      }
      // The destination's authority names the role; a foreign monarch never arrives crowned.
      const crowned = role === 'monarch' && kingdomForBroadcaster(current.personId) !== current.to ? 'visitor' : role;
      const arrivalId = arrivalIdFor(ticket);
      const generation = current.baseGeneration + 1;
      const arrival: ArrivalRecord = {
        arrivalId, revision: 1, personId: current.personId, ticket, from: current.from, to: current.to, role: crowned, reason: current.reason,
        generation, committedAt, origin: current.origin,
      };
      const written = await tx.putArrival(arrival, 0);
      if (written.kind === 'conflict' && written.current?.ticket !== ticket) throw new Conflict();
      const here = await tx.getWhereabouts(current.personId);
      if (!here || here.fence !== ticket || here.generation !== current.baseGeneration) {
        throw new Error(`Ticket ${ticket} committed without holding its person's fence.`);
      }
      stored(await tx.putWhereabouts({
        personId: current.personId, revision: here.revision + 1, kingdomId: current.to, generation, arrivalId, active: null, fence: null,
        updatedAt: Math.max(clock(), here.updatedAt),
      }, here.revision));
      await advance(tx, current, { state: 'committed', role: crowned, arrivalId, release: 'source', settledAt: clock() });
      return true;
    });
    if (owed) await releaseOwed(ticket);
  }

  /** Asks what became of a commit that may have happened. Never hands the commit over again. */
  async function settleCommit(ticket: string): Promise<boolean> {
    const record = await read(ticket);
    if (!record || (record.state !== 'committing' && record.state !== 'unknown')) return false;
    // A commit handed over moments ago is still being answered; asking now would race its own reply.
    if (record.state === 'committing' && clock() - record.committingAt! < TRAVEL_LIMITS.commitStallMs) return false;
    const status = await ask(signal => rooms.reconcile(refOf(record), signal), readStatus, { kind: 'unknown' } as TicketStatus);
    if (status.kind === 'committed') { await arrive(ticket, status.role, status.committedAt); return true; }
    if (status.kind === 'unknown') {
      // Still nobody can tell. After a while the viewer is told so plainly; the fence stays.
      const now = clock();
      if (record.state === 'committing' && now - record.committingAt! >= TRAVEL_LIMITS.commitStallMs) {
        await transact(async tx => {
          const current = await tx.getTravel(ticket);
          if (current?.state === 'committing') await advance(tx, current, { state: 'unknown' });
        });
      }
      return false;
    }
    const owed = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || (current.state !== 'committing' && current.state !== 'unknown')) return false;
      if (status.kind === 'held' && clock() < current.leaseUntil) {
        // Known not to have committed, and the place is still held: the walker may step through again.
        const here = await tx.getWhereabouts(current.personId);
        if (here?.fence === ticket) stored(await tx.putWhereabouts({ ...here, revision: here.revision + 1, fence: null, updatedAt: Math.max(clock(), here.updatedAt) }, here.revision));
        await tx.putTravel({ ...current, revision: current.revision + 1, state: 'ready', committingAt: null, updatedAt: Math.max(clock(), current.updatedAt) }, current.revision).then(stored);
        return false;
      }
      await rollBack(tx, current, 'expired', true);
      return true;
    });
    if (owed) await releaseOwed(ticket);
    return true;
  }

  // ---- Who may go ------------------------------------------------------------------------------------------------

  /** Checks the journey's reason against this person's own records. Returns where it must leave from. */
  async function eligible(context: GateContext, here: WhereaboutsRecord | null, target: KingdomId, reason: TravelReason): Promise<KingdomId> {
    const person: PersonId = context.principal.personId;
    const from = here?.kingdomId ?? context.principal.sourceKingdomId;
    if (reason.kind === 'raid') {
      const verdict = await marches.check(person, reason.requestId, reason.raidId, context.now, context.signal);
      if (verdict.kind === 'refused') throw new Denied(verdict.code);
      if (verdict.origin !== origin) throw new Denied('unavailable');
      if (verdict.to !== target) throw new Denied('invalid');
      // A marcher leaves from the raid's source; one who already went elsewhere is no longer at this gate.
      if (verdict.from !== from) throw new Denied('stale');
      // Waiting land has no world to enter: the raid lands on Twitch and the road on the Atlas, nobody moves.
      if (!verdict.founded) throw new Denied('unavailable');
      return from;
    }
    if (reason.kind === 'return') {
      if (!here || here.arrivalId !== reason.arrivalId) throw new Denied('stale');
      const arrival = await transact(tx => tx.getArrival(reason.arrivalId), context.signal);
      if (!arrival || arrival.personId !== person || arrival.to !== here.kingdomId) throw new Denied('stale');
      // Coming home goes back where that journey began, even after the source's retention ran out.
      if (arrival.from !== target) throw new Denied('invalid');
      return from;
    }
    return from;
  }

  // ---- Viewer operations -----------------------------------------------------------------------------------------

  async function reserve(context: GateContext, requestId: string, target: KingdomId, reason: TravelReason): Promise<TravelReply> {
    const person = context.principal.personId;
    const existing = await transact(tx => tx.findTravel(person, requestId), context.signal);
    if (existing) {
      // One request, one ticket: a retry returns it, a different journey under the same key is refused.
      if (existing.to !== target || !sameReason(existing.reason, reason)) return denied('invalid');
      return travel(existing);
    }
    const here = await transact(tx => tx.getWhereabouts(person), context.signal);
    if (here?.active) {
      const active = await transact(tx => tx.getTravel(here.active!), context.signal);
      if (active && OPEN_STATES.has(active.state)) return denied('stale');
    }
    const from = await eligible(context, here, target, reason);
    if (from === target) return denied('invalid');
    const door = await ask(signal => rooms.checkAdmission(person, target, signal), readAdmission, { kind: 'unknown' } as AdmissionOutcome);
    if (door.kind === 'full') return denied('full');
    if (door.kind === 'denied') return denied('unauthorized');
    if (door.kind === 'unknown') return denied('unavailable');

    const ticket = tickets();
    const now = clock();
    const created = await transact(async tx => {
      const again = await tx.findTravel(person, requestId);
      if (again) return again;
      const current = await tx.getWhereabouts(person);
      // Nothing moved this person since we looked.
      if ((current?.revision ?? 0) !== (here?.revision ?? 0) || (current?.active && current.active !== here?.active)) throw new Denied('stale');
      const record = stored(await tx.putTravel({
        ticket, revision: 1, personId: person, sessionId: context.principal.sessionId, requestId, from, to: target, reason, state: 'reserved',
        baseGeneration: current?.generation ?? 0, held: false, leaseUntil: now + TRAVEL_LIMITS.unheldLeaseMs, role: null, arrivalId: null,
        release: 'none', createdAt: now, updatedAt: now, committingAt: null, settledAt: null, origin,
      }, 0));
      stored(await tx.putWhereabouts(current
        ? { ...current, revision: current.revision + 1, active: ticket, fence: null, updatedAt: Math.max(now, current.updatedAt) }
        : { personId: person, revision: 1, kingdomId: from, generation: 0, arrivalId: null, active: ticket, fence: null, updatedAt: now },
      current?.revision ?? 0));
      return record;
    }, context.signal);
    if (created.ticket === ticket) await hold(ticket);
    return travel(await read(created.ticket) ?? created);
  }

  async function prepare(context: GateContext, ticket: string): Promise<TravelReply> {
    let record = await own(context, ticket);
    if (record.sessionId !== context.principal.sessionId) return denied('unauthorized');
    if (PRE_COMMIT_STATES.has(record.state) && clock() >= record.leaseUntil) {
      await expire(ticket, clock());
      return travel(await read(ticket) ?? record);
    }
    if (record.state === 'reserved' && !record.held) {
      await hold(ticket);
      record = await read(ticket) ?? record;
    }
    if (record.state === 'reserved' && record.held) {
      await transact(async tx => {
        const current = await tx.getTravel(ticket);
        if (current?.state === 'reserved' && current.held) await advance(tx, current, { state: 'preparing' });
      });
    }
    await ready(ticket);
    return travel(await read(ticket) ?? record);
  }

  async function commit(context: GateContext, ticket: string): Promise<TravelReply> {
    const record = await own(context, ticket);
    if (record.sessionId !== context.principal.sessionId) return denied('unauthorized');
    // A commit already handed over is reconciled, never handed over twice.
    if (record.state !== 'ready') return travel(record);
    if (clock() >= record.leaseUntil) {
      await expire(ticket, clock());
      return travel(await read(ticket) ?? record);
    }
    // A walker who chose to stay home since reserving is not moved.
    if (record.reason.kind === 'raid') {
      const verdict = await marches.check(record.personId, record.reason.requestId, record.reason.raidId, context.now, context.signal);
      if (verdict.kind === 'refused') {
        await cancelBeforeCommit(ticket);
        return travel(await read(ticket) ?? record);
      }
    }
    const fenced = await transact(async tx => {
      const current = await tx.getTravel(ticket);
      if (!current || current.state !== 'ready') return null;
      const here = await tx.getWhereabouts(current.personId);
      if (!here || here.active !== ticket || here.fence !== null || here.kingdomId !== current.from || here.generation !== current.baseGeneration) {
        // The person is no longer where this journey began.
        await rollBack(tx, current, 'cancelled', true);
        return null;
      }
      if (current.reason.kind === 'return' && here.arrivalId !== current.reason.arrivalId) {
        await rollBack(tx, current, 'cancelled', true);
        return null;
      }
      stored(await tx.putWhereabouts({ ...here, revision: here.revision + 1, fence: ticket, updatedAt: Math.max(clock(), here.updatedAt) }, here.revision));
      return advance(tx, current, { state: 'committing', committingAt: clock() });
    }, context.signal);
    if (!fenced) {
      await releaseOwed(ticket);
      return travel(await read(ticket) ?? record);
    }
    const outcome = await ask(signal => rooms.commit(refOf(fenced), signal), readCommit, { kind: 'unknown' } as CommitOutcome);
    if (outcome.kind === 'acknowledged') {
      await arrive(ticket, outcome.role, outcome.committedAt);
    } else if (outcome.kind === 'denied') {
      // The destination refused at the door: the person never left, and the source was never released.
      const owed = await transact(async tx => {
        const current = await tx.getTravel(ticket);
        if (current?.state !== 'committing') return false;
        await rollBack(tx, current, 'denied', true);
        return true;
      });
      if (owed) await releaseOwed(ticket);
    } else if (outcome.kind === 'unknown') {
      await transact(async tx => {
        const current = await tx.getTravel(ticket);
        if (current?.state === 'committing') await advance(tx, current, { state: 'unknown' });
      });
    }
    return travel(await read(ticket) ?? fenced);
  }

  async function cancel(context: GateContext, ticket: string): Promise<TravelReply> {
    const record = await own(context, ticket);
    if (PRE_COMMIT_STATES.has(record.state)) await cancelBeforeCommit(ticket);
    // A commit that may have happened cannot be cancelled, only found out.
    else if (record.state === 'committing' || record.state === 'unknown') await settleCommit(ticket);
    else if (record.release !== 'none') await releaseOwed(ticket);
    return travel(await read(ticket) ?? record);
  }

  async function reconcile(context: GateContext, ticket: string): Promise<TravelReply> {
    const record = await own(context, ticket);
    const now = clock();
    if (PRE_COMMIT_STATES.has(record.state)) {
      if (now >= record.leaseUntil) await expire(ticket, now);
      // Another session found a journey this one began: the walker left before stepping through.
      else if (record.sessionId !== context.principal.sessionId) await cancelBeforeCommit(ticket);
      else if (record.state === 'reserved') await hold(ticket);
      else if (record.state === 'preparing') await ready(ticket);
    } else if (record.state === 'committing' || record.state === 'unknown') {
      await settleCommit(ticket);
    } else if (record.release !== 'none') {
      await releaseOwed(ticket);
    }
    return travel(await read(ticket) ?? record);
  }

  async function whereabouts(context: GateContext): Promise<TravelReply> {
    const found = await transact(async tx => {
      const here = await tx.getWhereabouts(context.principal.personId);
      if (!here) return null;
      if (here.active) return tx.getTravel(here.active);
      const arrival = here.arrivalId ? await tx.getArrival(here.arrivalId) : null;
      return arrival ? tx.getTravel(arrival.ticket) : null;
    }, context.signal);
    return found ? travel(found) : denied('stale');
  }

  async function recover(now: number, limit: number): Promise<TravelRecovery> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('A travel recovery pass takes 1–100 records per listing.');
    const report = { expired: 0, reconciled: 0, released: 0 };
    const page = async (listing: 'open' | 'release') => {
      let batch = await transact(tx => tx.listTravel(listing, cursors[listing], limit));
      // Wrap around once the end is reached, so every ticket gets its turn across passes.
      if (batch.length < limit && cursors[listing] !== null) {
        const head = await transact(tx => tx.listTravel(listing, null, limit - batch.length));
        batch = [...batch, ...head.filter(each => !batch.some(seen => seen.ticket === each.ticket))];
      }
      cursors[listing] = batch.length === limit ? batch[batch.length - 1]!.ticket : null;
      return batch;
    };
    for (const record of await page('open')) {
      if (PRE_COMMIT_STATES.has(record.state)) { if (await expire(record.ticket, now)) report.expired++; }
      else if (record.state === 'unknown' || now - record.committingAt! >= TRAVEL_LIMITS.commitStallMs) {
        if (await settleCommit(record.ticket)) report.reconciled++;
      }
    }
    for (const record of await page('release')) if (await releaseOwed(record.ticket)) report.released++;
    return report;
  }

  /** Runs a viewer operation, turning a refusal into its reply. */
  const guarded = <A extends unknown[]>(operation: (context: GateContext, ...args: A) => Promise<TravelReply>) =>
    async (context: GateContext, ...args: A): Promise<TravelReply> => {
      context.signal.throwIfAborted();
      try {
        return await operation(context, ...args);
      } catch (error) {
        if (error instanceof Denied) return denied(error.code);
        throw error;
      }
    };

  return {
    origin,
    reserve: guarded(reserve),
    prepare: guarded(prepare),
    commit: guarded(commit),
    cancel: guarded(cancel),
    reconcile: guarded(reconcile),
    whereabouts: guarded(whereabouts),
    recover,
  };
}
