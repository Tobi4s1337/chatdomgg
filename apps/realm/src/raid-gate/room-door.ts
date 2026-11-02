/**
 * The realm's actual rooms answering the travel coordinator (RS11). `RealmRoomTravel` keeps the durable ledger (holds,
 * the fenced membership move, the role); this door is what makes each answer true of the rooms people walk in:
 *
 * - **Admission** asks the realm's own allocation whether the destination is founded. Waiting land has no room, so
 *   nothing is reserved for it and no world is manufactured.
 * - **Readiness** retains the destination's writer (which loads its adopted geometry), checks the writer is current
 *   and that the scene it serves is the geometry it holds, and that a visitor has a safe, clear place at its gate. Only
 *   then is the ticket prepared. A writer still loading answers pending; an unfounded one refuses.
 * - **Commit** moves the membership in the ledger, then fences the source: every seat this person held in the source
 *   room from before the commit stops being current (the rooms ask the session check every second and end the seat on
 *   `false`). The commit is acknowledged only once no such seat remains, so the API never reports an arrival while the
 *   walker still stands in the source room. If the seat outlives the wait, the answer is `pending` and `reconcile`
 *   says `unknown` until the room lets go; the coordinator stays fenced meanwhile.
 * - A fresh entry after the commit is ordinary: anyone may walk back in whenever they like.
 *
 * One realm process holds every room of its origin (writer leases), so the departures kept here in memory cover every
 * seat that can exist; after a restart no seat predates any commit.
 */
import type { KingdomId, PersonId } from '@chatdom/shared';
import type { RealmAuthenticator, RealmPrincipal } from '@chatdom/shared/realm';
import type { SettlementPlan } from '@chatdom/world';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { performance } from 'node:perf_hooks';
import { FoundedUnavailableError } from '../founded/load';
import type { DurableKingdom, DurableKingdomHold } from '../persistence/kingdom';
import { raidGuestSpawnAnchors } from './guest-spawn';
import type { CommitOutcome, PrepareOutcome, RealmTravelTransport, TicketStatus, TravelTicketRef } from './ports';
import type { RealmRoomTravel } from './room-travel';

/** How long a commit waits for the source room to let the walker go before answering `pending`. */
export const ROOM_DOOR_SEAT_WAIT_MS = 5_000;
/** Departures are forgotten once their source seats are gone, and in any case after this long. */
export const ROOM_DOOR_DEPARTURE_MS = 6 * 60 * 60_000;
const MAX_DEPARTURES = 10_000;

export interface RoomDoorRooms {
  /** The realm's allocation authority: a kingdom with an adopted layout is founded. */
  founded(kingdomId: KingdomId): Promise<boolean>;
  /** The existing counted writer hold (`boot.services.retain`); loads adopted geometry before it resolves. */
  retain(kingdomId: KingdomId): Promise<DurableKingdomHold>;
  /** The prepared founded scene (`boot.loader.current`): its plan and the collision world it was compiled to. */
  scene(kingdomId: KingdomId): Readonly<{ world: CollisionWorld; plan: SettlementPlan }> | undefined;
}

export interface RealmRoomDoorOptions {
  readonly travel: Pick<RealmRoomTravel, 'transport' | 'roleAt'>;
  readonly rooms: RoomDoorRooms;
  readonly clock?: () => number;
  readonly seatWaitMs?: number;
  readonly pollMs?: number;
}

type SeatRecord = { readonly walkerId: string; readonly joinedAt: number };
type Departure = { readonly from: KingdomId; readonly committedAt: number; readonly recordedAt: number };

export function createRealmRoomDoor(options: RealmRoomDoorOptions) {
  const ledger = options.travel.transport;
  const now = options.clock ?? Date.now;
  const seatWaitMs = options.seatWaitMs ?? ROOM_DOOR_SEAT_WAIT_MS, pollMs = options.pollMs ?? 100;
  /** kingdom → person → the seat the actual room holds (connected or dropped in grace), by its join time. */
  const seats = new Map<string, Map<string, SeatRecord>>();
  /** The principal object the room seated, with the time it was seated; reconnects keep their seat's time. */
  const seatedAt = new WeakMap<RealmPrincipal, number>();
  const departures = new Map<string, Departure>();

  const depart = (ref: TravelTicketRef, committedAt: number) => {
    const known = departures.get(ref.personId);
    if (known && known.committedAt >= committedAt) return;
    departures.delete(ref.personId);
    departures.set(ref.personId, { from: ref.from, committedAt, recordedAt: now() });
    const cutoff = now() - ROOM_DOOR_DEPARTURE_MS;
    for (const [person, departure] of departures) {
      if (departures.size <= MAX_DEPARTURES && departure.recordedAt >= cutoff) break;
      departures.delete(person);
    }
  };
  /** A seat in the source room that this person took before the commit, still held by the room. */
  const lingering = (personId: PersonId, from: KingdomId, committedAt: number): boolean => {
    const seat = seats.get(from)?.get(personId);
    return !!seat && seat.joinedAt <= committedAt;
  };
  const cleared = async (ref: TravelTicketRef, committedAt: number): Promise<boolean> => {
    // A real wait on the process's own timer, whatever clock the ledger's dates come from.
    const deadline = performance.now() + seatWaitMs;
    while (lingering(ref.personId, ref.from, committedAt)) {
      if (performance.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    const departure = departures.get(ref.personId);
    if (departure && departure.committedAt === committedAt && departure.from === ref.from) departures.delete(ref.personId);
    return true;
  };

  async function prepare(ref: TravelTicketRef, signal: AbortSignal): Promise<PrepareOutcome> {
    let hold: DurableKingdomHold;
    try { hold = await options.rooms.retain(ref.to); }
    catch (error) {
      if (error instanceof FoundedUnavailableError) return { kind: 'denied' };
      throw error;
    }
    try {
      const kingdom = hold.kingdom, scene = options.rooms.scene(ref.to);
      if (!kingdom.current || !scene || scene.world !== kingdom.world) return { kind: 'pending' };
      // Citizens and the monarch enter at their own doors; a visitor needs a safe, clear place at the gate.
      const role = await options.travel.roleAt(ref.personId, ref.to);
      if (role === 'visitor' && raidGuestSpawnAnchors(scene.plan, kingdom.world).length === 0) return { kind: 'pending' };
    } finally { await hold.release(); }
    return ledger.prepare(ref, signal);
  }

  async function commit(ref: TravelTicketRef, signal: AbortSignal): Promise<CommitOutcome> {
    const outcome = await ledger.commit(ref, signal);
    if (outcome.kind !== 'acknowledged') return outcome;
    depart(ref, outcome.committedAt);
    return await cleared(ref, outcome.committedAt) ? outcome : { kind: 'pending' };
  }

  async function reconcile(ref: TravelTicketRef, signal: AbortSignal): Promise<TicketStatus> {
    const status = await ledger.reconcile(ref, signal);
    if (status.kind !== 'committed') return status;
    depart(ref, status.committedAt);
    return await cleared(ref, status.committedAt) ? status : { kind: 'unknown' };
  }

  const transport: RealmTravelTransport = {
    origin: ledger.origin,
    async checkAdmission(personId, kingdomId, signal) {
      if (!await options.rooms.founded(kingdomId)) return { kind: 'denied' };
      return ledger.checkAdmission(personId, kingdomId, signal);
    },
    async reserve(ref, signal) {
      if (!await options.rooms.founded(ref.to)) return { kind: 'denied', code: 'refused' };
      return ledger.reserve(ref, signal);
    },
    prepare, commit, reconcile,
    release: (ref, side, signal) => ledger.release(ref, side, signal),
  };

  return {
    transport,
    /** Follow one kingdom's actual room: who is seated there, since when. Wire beside the other `attach` hooks. */
    attach(kingdom: Pick<DurableKingdom, 'kingdomId' | 'onLifecycle'>): () => void {
      const here = new Map<string, SeatRecord>();
      seats.set(kingdom.kingdomId, here);
      const off = kingdom.onLifecycle((event, principal, walkerId, at) => {
        if (event === 'join') { seatedAt.set(principal, at); here.set(principal.personId, { walkerId, joinedAt: at }); }
        else if (event === 'reconnect') {
          const joinedAt = seatedAt.get(principal) ?? at;
          here.set(principal.personId, { walkerId, joinedAt });
        } else if (event === 'leave' && here.get(principal.personId)?.walkerId === walkerId) here.delete(principal.personId);
      });
      return () => { off(); if (seats.get(kingdom.kingdomId) === here) seats.delete(kingdom.kingdomId); };
    },
    /**
     * The rooms' session check, fenced by committed journeys: a seat taken in the source before its person's commit is
     * no longer current, so the room ends it within a second. Every other answer is the inner authenticator's.
     */
    fence(inner: RealmAuthenticator): RealmAuthenticator {
      return {
        authenticate: join => inner.authenticate(join),
        current: async (principal, at) => {
          const departure = departures.get(principal.personId), seated = seatedAt.get(principal);
          if (departure && departure.from === principal.kingdomId && seated !== undefined && seated <= departure.committedAt) return false;
          return inner.current(principal, at);
        },
      };
    },
    /** For health and tests: seats followed and departures still fencing. */
    health: () => ({ rooms: seats.size, departures: departures.size }),
  };
}
export type RealmRoomDoor = ReturnType<typeof createRealmRoomDoor>;
