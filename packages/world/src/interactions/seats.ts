import type { PersonId } from '@chatdom/shared';
import type { RealmInteractionLease, RealmSeat } from '@chatdom/shared/realm';

/**
 * Room-ephemeral physical seats. At most one lease per target and at most one per person. Every change returns a
 * new book with the revision advanced; nothing here is durable, paid or ranked. Leases are fenced by the room's
 * writer epoch, the authenticated session and a generation that never repeats inside one book.
 */
export interface SeatBook {
  readonly writerEpoch: string; readonly revision: number; readonly nextGeneration: number;
  /** Sorted by target ID. */
  readonly leases: readonly RealmInteractionLease[];
}
export interface SeatClaim {
  readonly targetId: string; readonly walkerId: string; readonly sessionId: string; readonly personId: PersonId;
  readonly writerEpoch: string;
}
export type SeatClaimResult =
  | { readonly kind: 'seated'; readonly book: SeatBook; readonly lease: RealmInteractionLease; readonly replaced: RealmInteractionLease | null }
  | { readonly kind: 'already'; readonly book: SeatBook; readonly lease: RealmInteractionLease }
  | { readonly kind: 'occupied' | 'elsewhere' | 'stale'; readonly book: SeatBook };

/** An occupied lease lives while its session does; only a dropped one has a finite expiry. */
export const CONNECTED = Number.POSITIVE_INFINITY;

export function createSeatBook(writerEpoch: string): SeatBook {
  return Object.freeze({ writerEpoch, revision: 0, nextGeneration: 1, leases: Object.freeze([]) });
}
function next(book: SeatBook, leases: readonly RealmInteractionLease[], generation = book.nextGeneration): SeatBook {
  const sorted = [...leases].sort((a, b) => a.seat.targetId < b.seat.targetId ? -1 : a.seat.targetId > b.seat.targetId ? 1 : 0);
  return Object.freeze({ writerEpoch: book.writerEpoch, revision: book.revision + 1, nextGeneration: generation, leases: Object.freeze(sorted) });
}
function lease(seat: RealmSeat, sessionId: string, personId: PersonId, writerEpoch: string, expiresAt: number): RealmInteractionLease {
  return Object.freeze({ seat: Object.freeze(seat), sessionId, personId, writerEpoch, expiresAt });
}

export function seatAt(book: SeatBook, targetId: string): RealmInteractionLease | null {
  return book.leases.find(entry => entry.seat.targetId === targetId) ?? null;
}
export function seatOfSession(book: SeatBook, sessionId: string): RealmInteractionLease | null {
  return book.leases.find(entry => entry.sessionId === sessionId) ?? null;
}
export function seatOfPerson(book: SeatBook, personId: PersonId): RealmInteractionLease | null {
  return book.leases.find(entry => entry.personId === personId) ?? null;
}

/**
 * Claim in the room's serialized order. The first legal claimant wins; a later one is told the seat is occupied.
 * The same session claiming its own seat again is idempotent. A person's lease held by an older session (a
 * replaced tab) is released by the new claim, so one person never seats twice; a live session already seated
 * elsewhere must stand first.
 */
export function claimSeat(book: SeatBook, claim: SeatClaim): SeatClaimResult {
  if (claim.writerEpoch !== book.writerEpoch) return { kind: 'stale', book };
  const holder = seatAt(book, claim.targetId);
  if (holder) {
    if (holder.sessionId === claim.sessionId && holder.personId === claim.personId) return { kind: 'already', book, lease: holder };
    if (holder.personId !== claim.personId) return { kind: 'occupied', book };
  }
  const mine = seatOfPerson(book, claim.personId);
  if (mine && mine.sessionId === claim.sessionId && mine.seat.targetId !== claim.targetId) return { kind: 'elsewhere', book };
  const replaced = mine && mine.sessionId !== claim.sessionId ? mine : null;
  const seat: RealmSeat = { targetId: claim.targetId, walkerId: claim.walkerId, generation: book.nextGeneration, status: 'occupied' };
  const granted = lease(seat, claim.sessionId, claim.personId, book.writerEpoch, CONNECTED);
  const leases = book.leases.filter(entry => entry !== replaced && entry.seat.targetId !== claim.targetId);
  return { kind: 'seated', book: next(book, [...leases, granted], book.nextGeneration + 1), lease: granted, replaced };
}

/**
 * Release exactly this session's current lease. A generation, when given, must match: a stale callback or an
 * older tab cannot unseat the replacement occupant. Unchanged books are returned as-is (idempotent).
 */
export function standSeat(book: SeatBook, input: { readonly sessionId: string; readonly writerEpoch: string; readonly generation?: number }): { readonly book: SeatBook; readonly released: RealmInteractionLease | null } {
  if (input.writerEpoch !== book.writerEpoch) return { book, released: null };
  const mine = seatOfSession(book, input.sessionId);
  if (!mine || (input.generation !== undefined && mine.seat.generation !== input.generation)) return { book, released: null };
  return { book: next(book, book.leases.filter(entry => entry !== mine)), released: mine };
}
/** A transport drop keeps the seat for the realm's reconnect grace, recorded as an absolute room-clock expiry. */
export function dropSession(book: SeatBook, sessionId: string, expiresAt: number): SeatBook {
  const mine = seatOfSession(book, sessionId);
  if (!mine || mine.seat.status === 'reconnecting' || !Number.isFinite(expiresAt)) return book;
  const held = lease({ ...mine.seat, status: 'reconnecting' }, mine.sessionId, mine.personId, mine.writerEpoch, expiresAt);
  return next(book, book.leases.map(entry => entry === mine ? held : entry));
}
/** A verified reconnect inside grace resumes the same generation. After expiry there is nothing to resume. */
export function reconnectSession(book: SeatBook, sessionId: string, now: number): SeatBook {
  const mine = seatOfSession(book, sessionId);
  if (!mine || mine.seat.status !== 'reconnecting') return book;
  if (mine.expiresAt <= now) return next(book, book.leases.filter(entry => entry !== mine));
  const resumed = lease({ ...mine.seat, status: 'occupied' }, mine.sessionId, mine.personId, mine.writerEpoch, CONNECTED);
  return next(book, book.leases.map(entry => entry === mine ? resumed : entry));
}
/**
 * A verified reload of the same authenticated session draws its body under a new opaque walker key. The lease,
 * its generation and its expiry stay; only the public render key follows the body.
 */
export function rebindWalker(book: SeatBook, sessionId: string, walkerId: string): SeatBook {
  const mine = seatOfSession(book, sessionId);
  if (!mine || mine.seat.walkerId === walkerId) return book;
  const moved = lease({ ...mine.seat, walkerId }, mine.sessionId, mine.personId, mine.writerEpoch, mine.expiresAt);
  return next(book, book.leases.map(entry => entry === mine ? moved : entry));
}
/** Leave, logout, failed reauthentication: the session's lease ends now. */
export function releaseSession(book: SeatBook, sessionId: string): { readonly book: SeatBook; readonly released: RealmInteractionLease | null } {
  const mine = seatOfSession(book, sessionId);
  return mine ? { book: next(book, book.leases.filter(entry => entry !== mine)), released: mine } : { book, released: null };
}
/** Moderation or revoked rights: every lease of this person ends in this same turn. */
export function releasePerson(book: SeatBook, personId: PersonId): { readonly book: SeatBook; readonly released: readonly RealmInteractionLease[] } {
  const released = book.leases.filter(entry => entry.personId === personId);
  return released.length ? { book: next(book, book.leases.filter(entry => entry.personId !== personId)), released } : { book, released };
}
/** Targets that no longer exist (a removed log, a new layout) lose their sitters. */
export function releaseTargets(book: SeatBook, keep: (targetId: string) => boolean): { readonly book: SeatBook; readonly released: readonly RealmInteractionLease[] } {
  const released = book.leases.filter(entry => !keep(entry.seat.targetId));
  return released.length ? { book: next(book, book.leases.filter(entry => keep(entry.seat.targetId))), released } : { book, released };
}
/** Reconnect grace that ran out on the room clock, with or without any connected browser. */
export function expireSeats(book: SeatBook, now: number): { readonly book: SeatBook; readonly released: readonly RealmInteractionLease[] } {
  const released = book.leases.filter(entry => entry.expiresAt <= now);
  return released.length ? { book: next(book, book.leases.filter(entry => entry.expiresAt > now)), released } : { book, released };
}
/** The public projection: opaque walker keys and status only. No person, session or expiry. */
export function publicSeats(book: SeatBook): readonly RealmSeat[] {
  return book.leases.map(entry => entry.seat);
}
