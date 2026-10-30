import { performance } from 'node:perf_hooks';
import type { RealmAuthenticator, RealmPrincipal } from '@chatdom/shared/realm';

/**
 * Spec 34 R8: a reconnect is a checked lease on one seat, never a second way in.
 *
 * A seat is one person's walker in one kingdom room. It survives a dropped socket for at most the grace below, and only
 * while that person's Chatdom session stays current. Everything here is transport-free policy: the room supplies the
 * Colyseus calls (`close` a socket, `allowReconnection`) and reports what happened.
 */

/** How long a dropped seat waits for its own reconnect. Never longer than the session that admitted it. */
export const REALM_RECONNECT_GRACE_MS = 30_000;
/** Every seat, connected or dropped, has its session asked again this often. */
export const REALM_SESSION_CHECK_MS = 1_000;
/** One session question gets this long before it counts as unanswered. */
export const REALM_SESSION_CHECK_TIMEOUT_MS = 3_000;
/** Unanswered session questions hold walking; after this long without an answer the seat ends. */
export const REALM_SESSION_UNAVAILABLE_MS = 15_000;

/**
 * Why the server ended a seat, as the WebSocket close code and reason the browser receives. None of these codes is in
 * the SDK's automatic-reconnect set (1001, 1005, 1006, 4010), so the SDK reports them through `onLeave` and stops.
 * Colyseus' own 4001 (server shutdown) and 4003 (failed reconnect, or the kingdom's writer moved) keep their meaning.
 */
export const REALM_SEAT_ENDINGS = {
  /** Signed out, revoked, moderated or expired. Clear this account's reconnect storage and read the session again. */
  'session-ended': { code: 4401, reason: 'Your Chatdom session has ended. Sign in again to walk here.' },
  /** The same person walked in from another window, which now holds the seat. Do not rejoin on your own. */
  replaced: { code: 4409, reason: 'You are walking in this kingdom from another window now.' },
  /** The session store did not answer for 15 s. Nothing changed; a fresh entry may be tried after a pause. */
  unavailable: { code: 4503, reason: 'The kingdom could not check your session. Nothing has changed; walk in again shortly.' },
} as const;
export type RealmSeatEnding = keyof typeof REALM_SEAT_ENDINGS;

/** A refused reconnect. `code` and `reason` reach the SDK as its `ServerError`. */
export class RealmSeatRefusedError extends Error {
  readonly code: number;
  constructor(ending: RealmSeatEnding | 'gone') {
    const refusal = ending === 'gone'
      ? { code: 4410, reason: 'This seat has ended. Walk in again to continue.' }
      : REALM_SEAT_ENDINGS[ending];
    super(refusal.reason);
    this.name = 'RealmSeatRefusedError';
    this.code = refusal.code;
  }
}

export interface RealmSeatsOptions {
  readonly auth: Pick<RealmAuthenticator, 'current'>;
  /** Close a connected walker's socket with this code and reason. The room then sees the drop and asks `dropped`. */
  readonly close: (walkerId: string, code: number, reason: string) => void;
  /** Wall clock handed to `current`; the session store judges it against its own clock. */
  readonly now?: () => number;
  /** Monotonic clock for local deadlines. */
  readonly monotonic?: () => number;
}

interface Seat {
  readonly walkerId: string;
  readonly principal: RealmPrincipal;
  connected: boolean;
  ending: RealmSeatEnding | null;
  /** Ends a pending reconnection grace. Present only while dropped. */
  cancel: (() => void) | null;
  asking: boolean;
  /** Monotonic time the session last answered `true`. */
  confirmedAt: number;
  /** Walking is held while the session cannot be confirmed. */
  held: boolean;
}

/**
 * One seat per person per kingdom room. A fresh authenticated entry by the same person replaces the old seat (newest
 * window wins, the old socket closes with 4409, its reconnect token dies); a reconnect resumes only the seat it left,
 * only while that seat is still this person's, and only after the session store says the session is current.
 */
export class RealmSeats {
  private readonly seats = new Map<string, Seat>();
  private readonly people = new Map<string, string>();
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private disposed = false;

  constructor(private readonly options: RealmSeatsOptions) {
    this.now = options.now ?? Date.now;
    this.monotonic = options.monotonic ?? (() => performance.now());
  }

  /** The walker currently seated for this person, if any. */
  seatOf(personId: string): string | undefined { return this.people.get(personId); }

  get size(): number { return this.seats.size; }

  /** A freshly authenticated, current entry takes this person's seat. Returns the walker it replaced, if any. */
  seat(principal: RealmPrincipal, walkerId: string): string | null {
    const previous = this.people.get(principal.personId) ?? null;
    if (previous !== null && previous !== walkerId) this.end(previous, 'replaced');
    this.seats.set(walkerId, { walkerId, principal, connected: true, ending: null, cancel: null, asking: false, confirmedAt: this.monotonic(), held: false });
    this.people.set(principal.personId, walkerId);
    return previous === walkerId ? null : previous;
  }

  /**
   * The socket dropped. Returns the reconnection grace in seconds, or 0 when the seat ends now: it was ended by the
   * server, replaced, or its session has run out. Movement input must already have stopped.
   */
  dropped(walkerId: string): number {
    const seat = this.seats.get(walkerId);
    if (!seat || this.disposed) return 0;
    seat.connected = false;
    if (seat.ending || this.people.get(seat.principal.personId) !== walkerId) return 0;
    const remaining = Math.min(REALM_RECONNECT_GRACE_MS, seat.principal.expiresAt - this.now());
    if (remaining <= 0) { seat.ending = 'session-ended'; return 0; }
    return remaining / 1_000;
  }

  /** While dropped, `cancel` ends the grace early (revocation, replacement, expiry). */
  awaiting(walkerId: string, cancel: () => void): void {
    const seat = this.seats.get(walkerId);
    if (!seat) { cancel(); return; }
    if (seat.ending) { cancel(); return; }
    seat.cancel = cancel;
  }

  /**
   * A reconnect handshake for a dropped seat. Resolves only when the seat is still this person's and the session
   * store confirms the session now; otherwise throws `RealmSeatRefusedError` and the room ends the seat.
   */
  async reconnected(walkerId: string): Promise<void> {
    const seat = this.seats.get(walkerId);
    if (!seat || this.disposed) throw new RealmSeatRefusedError('gone');
    if (seat.ending) throw new RealmSeatRefusedError(seat.ending);
    if (this.people.get(seat.principal.personId) !== walkerId) throw new RealmSeatRefusedError('replaced');
    let current: boolean;
    try { current = await this.ask(seat.principal); } catch { throw new RealmSeatRefusedError('unavailable'); }
    // The seat may have been ended while the store answered.
    if (seat.ending) throw new RealmSeatRefusedError(seat.ending);
    if (!current) { seat.ending = 'session-ended'; throw new RealmSeatRefusedError('session-ended'); }
    seat.connected = true; seat.cancel = null; seat.held = false; seat.confirmedAt = this.monotonic();
  }

  /** The room removed the walker. */
  left(walkerId: string): void {
    const seat = this.seats.get(walkerId);
    if (!seat) return;
    this.seats.delete(walkerId);
    if (this.people.get(seat.principal.personId) === walkerId) this.people.delete(seat.principal.personId);
  }

  /** End a seat for good: close its socket, or end its reconnection grace. Idempotent. */
  end(walkerId: string, ending: RealmSeatEnding): void {
    const seat = this.seats.get(walkerId);
    if (!seat || seat.ending) return;
    seat.ending = ending;
    seat.held = true;
    if (seat.connected) {
      const { code, reason } = REALM_SEAT_ENDINGS[ending];
      this.options.close(walkerId, code, reason);
    } else {
      const cancel = seat.cancel;
      seat.cancel = null;
      cancel?.();
    }
  }

  /** True while this seat may not move: dropped, ending, or its session is unconfirmed. */
  held(walkerId: string): boolean {
    const seat = this.seats.get(walkerId);
    return !seat || !seat.connected || seat.held;
  }

  /**
   * Ask the session store about every seat, connected or dropped, at most one question per seat at a time. Expired
   * principals end without asking. A `false` ends the seat; no answer holds walking, then ends it after 15 s.
   */
  check(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const seat of this.seats.values()) {
      if (seat.ending || seat.asking) continue;
      if (seat.principal.expiresAt <= now) { this.end(seat.walkerId, 'session-ended'); continue; }
      seat.asking = true;
      void this.ask(seat.principal).then(current => {
        if (current) { seat.held = seat.ending !== null; seat.confirmedAt = this.monotonic(); }
        else this.end(seat.walkerId, 'session-ended');
      }, () => {
        seat.held = true;
        if (this.monotonic() - seat.confirmedAt >= REALM_SESSION_UNAVAILABLE_MS) this.end(seat.walkerId, 'unavailable');
      }).finally(() => { seat.asking = false; });
    }
  }

  /** The room is going away: end every pending grace so no reconnect lands in a disposed room. */
  dispose(): void {
    this.disposed = true;
    for (const seat of this.seats.values()) { const cancel = seat.cancel; seat.cancel = null; cancel?.(); }
  }

  private ask(principal: RealmPrincipal): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('session check timed out')), REALM_SESSION_CHECK_TIMEOUT_MS);
      timer.unref?.();
    });
    return Promise.race([this.options.auth.current(principal, this.now()), timeout]).finally(() => clearTimeout(timer));
  }
}
