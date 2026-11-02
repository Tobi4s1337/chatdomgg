/**
 * The durable ledger of journeys between kingdoms (RS11; the `RealmTravelTransport` contract in `ports.ts`). It runs in
 * the realm, behind `room-door.ts`, which makes every answer true of the actual rooms: the door checks founding and
 * readiness against the realm's writers and fences the source seat before a commit is acknowledged. The API reaches it
 * only through the realm's private door route; it never binds this ledger on its own.
 *
 * - A destination is a kingdom this realm holds (`realm_kingdoms`, same origin). Waiting land has no room: nothing is
 *   reserved for it and no world is manufactured.
 * - Capacity counts the people whose membership already names the destination plus the places still held for it.
 * - `commit` moves the one walking membership atomically, honouring the fencing generation, and answers the role the
 *   destination's own records give: monarch only at home, citizen at a non-void deed, otherwise visitor.
 * - `reconcile` never moves anyone. Once it answers `released`, the ticket is released for good, so a commit that
 *   arrives later is refused and the answer stays true.
 * - The destination room admits a committed visitor at its gate (`arrivalAt`, read by the room's spawn preparation),
 *   so a marcher steps in under the gate, not at an ordinary spawn.
 *
 * Every operation is idempotent by ticket; every answer it cannot vouch for (a storage fault) throws, which the
 * coordinator counts as unknown.
 */
import { kingdomForBroadcaster, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';
import { parseRaidGuestVisualMark, RAID_GUEST_VISUAL_LEASE_MS, type RaidGuestVisualMark } from '../../../../packages/shared/src/raid-show';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { serializable, type SqlClient, type SqlPool } from '../../../api/src/raid-gate/postgres-repository';
import type {
  AdmissionOutcome, CommitOutcome, HoldOutcome, PrepareOutcome, RealmTravelTransport, ReleaseOutcome, TicketStatus, TravelTicketRef,
} from './ports';
import { readTravelRecord, type RecordOrigin, type TravelRole } from './records';

/** How long a destination keeps a place for a ticket that has not committed. */
export const ROOM_HOLD_MS = 120_000;
/** Walkers a kingdom takes through its doors from journeys at once (the room's own walker budget is larger). */
export const ROOM_TRAVEL_CAPACITY = 240;
/** A membership older than this no longer counts against capacity: the person has long since walked on or left. */
export const ROOM_PRESENCE_MS = 6 * 60 * 60_000;
/** How long after a committed arrival the destination's room still admits the walker at its gate. */
export const ROOM_GATE_ADMISSION_MS = 10 * 60_000;

export interface RealmRoomTravelOptions {
  readonly pool: SqlPool;
  readonly origin: RecordOrigin;
  readonly clock: () => number;
  readonly capacity?: number;
}

type Row = Record<string, unknown>;
const OWN = new AbortController().signal;
const first = (result: { rows: unknown[] }): Row | undefined => result.rows[0] as Row | undefined;
const integer = (value: unknown): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Stored room travel number is invalid.');
  return number;
};

/** The arrival a room admits at its gate: a committed visitor whose membership still names this kingdom. */
export type GateAdmission = Readonly<{ ticket: string; from: KingdomId; committedAt: number; expiresAt: number }>;

export class RealmRoomTravel {
  readonly transport: RealmTravelTransport;
  constructor(private readonly options: RealmRoomTravelOptions) {
    this.transport = {
      origin: options.origin,
      checkAdmission: (personId, kingdomId) => this.checkAdmission(personId, kingdomId),
      reserve: ref => this.reserve(ref),
      prepare: ref => this.prepare(ref),
      commit: ref => this.commit(ref),
      reconcile: ref => this.reconcile(ref),
      release: (ref, side) => this.release(ref, side),
    };
  }

  /**
   * Read by the destination room's spawn preparation: a fresh committed visit by this person to this kingdom, still
   * where the membership says they walk. Citizens and the monarch are not admitted here: they enter at their own door.
   */
  async arrivalAt(personId: PersonId, kingdomId: KingdomId, at: number): Promise<GateAdmission | null> {
    const row = first(await this.read(client => client.query(`SELECT t.ticket, t.from_kingdom_id, t.committed_ms FROM realm_raid_room_tickets t
      JOIN realm_raid_room_members m ON m.origin = t.origin AND m.person_id = t.person_id AND m.ticket = t.ticket AND m.kingdom_id = t.to_kingdom_id
      WHERE t.origin = $1 AND t.person_id = $2 AND t.to_kingdom_id = $3 AND t.state = 'committed' AND t.role = 'visitor'
      ORDER BY t.committed_ms DESC LIMIT 1`, [this.options.origin, personId, kingdomId])));
    if (!row) return null;
    const committedAt = integer(row.committed_ms), expiresAt = committedAt + ROOM_GATE_ADMISSION_MS;
    return at >= committedAt - 5_000 && at < expiresAt ? { ticket: String(row.ticket), from: String(row.from_kingdom_id) as KingdomId, committedAt, expiresAt } : null;
  }

  /**
   * The source's crest a marcher wears at the destination for the visit: the witnessed raid they rode out on and the
   * source's own Twitch name. Only for a committed visitor still standing here; refreshed by the room's presence.
   */
  async marchMark(personId: PersonId, kingdomId: KingdomId, at: number): Promise<RaidGuestVisualMark | null> {
    const admission = await this.arrivalAt(personId, kingdomId, at);
    if (!admission) return null;
    const row = first(await this.read(client => client.query(`SELECT t.record, o.observation FROM realm_raid_travel t
      LEFT JOIN realm_raid_observations o ON o.origin = $3 AND o.raid_id = (t.record::jsonb -> 'reason' ->> 'raidId') AND o.direction = 'outgoing'
      WHERE t.ticket = $1 AND t.person_id = $2`, [admission.ticket, personId, this.options.origin])));
    if (!row || row.observation === null || row.observation === undefined) return null;
    const travel = readTravelRecord(JSON.parse(String(row.record)));
    const observation = RaidObservationSchema.safeParse(JSON.parse(String(row.observation)));
    if (!travel || travel.reason.kind !== 'raid' || !observation.success || observation.data.from.kingdomId !== admission.from
      || observation.data.to.kingdomId !== kingdomId) return null;
    return parseRaidGuestVisualMark({ raidId: travel.reason.raidId, fromKingdomId: admission.from, fromName: observation.data.from.name,
      expiresAt: at + RAID_GUEST_VISUAL_LEASE_MS }, at);
  }

  /** The role the destination's own records give this person: monarch only at home, citizen at a deed, else visitor. */
  async roleAt(personId: PersonId, kingdomId: KingdomId): Promise<TravelRole> {
    return this.read(client => this.role(client, personId, kingdomId));
  }

  private async checkAdmission(personId: PersonId, kingdomId: KingdomId): Promise<AdmissionOutcome> {
    return this.read(async client => {
      if (!await this.held(client, kingdomId)) return { kind: 'denied' };
      const here = first(await client.query('SELECT kingdom_id FROM realm_raid_room_members WHERE origin = $1 AND person_id = $2', [this.options.origin, personId]));
      if (here?.kingdom_id === kingdomId) return { kind: 'admitted' };
      return await this.occupancy(client, kingdomId, null) >= this.capacity ? { kind: 'full' } : { kind: 'admitted' };
    });
  }

  private async reserve(ref: TravelTicketRef): Promise<HoldOutcome> {
    const now = this.now();
    return this.tx(async client => {
      const existing = await this.ticket(client, ref);
      if (existing) {
        if (existing.state === 'released') return { kind: 'denied', code: 'refused' };
        if (existing.state === 'committed') return { kind: 'acknowledged', leaseUntil: integer(existing.lease_until_ms) };
        if (integer(existing.lease_until_ms) <= now) { await this.settle(client, ref.ticket, now); return { kind: 'denied', code: 'refused' }; }
        return { kind: 'acknowledged', leaseUntil: integer(existing.lease_until_ms) };
      }
      if (!await this.held(client, ref.to)) { await this.tombstone(client, ref, now); return { kind: 'denied', code: 'refused' }; }
      // Serialise holds per destination so two last places are never both given out.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`raid-room:${this.options.origin}:${ref.to}`]);
      if (await this.occupancy(client, ref.to, ref.personId) >= this.capacity) { await this.tombstone(client, ref, now); return { kind: 'denied', code: 'full' }; }
      const leaseUntil = now + ROOM_HOLD_MS;
      await client.query(`INSERT INTO realm_raid_room_tickets (origin, ticket, person_id, session_id, from_kingdom_id, to_kingdom_id, generation, kind,
        state, lease_until_ms, created_ms, updated_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'held',$9,$10,$10)`,
      [this.options.origin, ref.ticket, ref.personId, ref.sessionId, ref.from, ref.to, ref.generation, ref.kind, leaseUntil, now]);
      return { kind: 'acknowledged', leaseUntil };
    });
  }

  private async prepare(ref: TravelTicketRef): Promise<PrepareOutcome> {
    const now = this.now();
    return this.tx(async client => {
      const ticket = await this.ticket(client, ref);
      if (!ticket || ticket.state === 'released') return { kind: 'denied' };
      if (ticket.state === 'committed') return { kind: 'acknowledged' };
      if (integer(ticket.lease_until_ms) <= now) { await this.settle(client, ref.ticket, now); return { kind: 'denied' }; }
      // The destination's world is the kingdom the realm holds; its room adopts the founded scene on entry.
      if (!await this.held(client, ref.to)) return { kind: 'denied' };
      await client.query('UPDATE realm_raid_room_tickets SET prepared = true, updated_ms = $3 WHERE origin = $1 AND ticket = $2', [this.options.origin, ref.ticket, now]);
      return { kind: 'acknowledged' };
    });
  }

  private async commit(ref: TravelTicketRef): Promise<CommitOutcome> {
    const now = this.now();
    return this.tx(async client => {
      const ticket = await this.ticket(client, ref, true);
      if (ticket?.state === 'committed') return { kind: 'acknowledged', role: ticket.role as TravelRole, committedAt: integer(ticket.committed_ms) };
      if (!ticket || ticket.state === 'released' || !ticket.prepared || integer(ticket.lease_until_ms) <= now) return { kind: 'denied' };
      const member = first(await client.query('SELECT kingdom_id, generation FROM realm_raid_room_members WHERE origin = $1 AND person_id = $2 FOR UPDATE',
        [this.options.origin, ref.personId]));
      const current = member ? { kingdomId: String(member.kingdom_id), generation: integer(member.generation) } : { kingdomId: ref.from, generation: 0 };
      // The fence: only a person still at the generation this journey left from moves, and only from where it began.
      if (current.generation !== ref.generation - 1 || current.kingdomId !== ref.from) {
        await this.settle(client, ref.ticket, now);
        return { kind: 'denied' };
      }
      const role = await this.role(client, ref.personId, ref.to);
      await client.query(`INSERT INTO realm_raid_room_members (origin, person_id, kingdom_id, generation, ticket, updated_ms) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (origin, person_id) DO UPDATE SET kingdom_id = EXCLUDED.kingdom_id, generation = EXCLUDED.generation, ticket = EXCLUDED.ticket, updated_ms = EXCLUDED.updated_ms`,
      [this.options.origin, ref.personId, ref.to, ref.generation, ref.ticket, now]);
      await client.query(`UPDATE realm_raid_room_tickets SET state = 'committed', role = $3, committed_ms = $4, updated_ms = $4 WHERE origin = $1 AND ticket = $2`,
        [this.options.origin, ref.ticket, role, now]);
      return { kind: 'acknowledged', role, committedAt: now };
    });
  }

  private async reconcile(ref: TravelTicketRef): Promise<TicketStatus> {
    const now = this.now();
    return this.tx(async client => {
      const ticket = await this.ticket(client, ref, true);
      if (ticket?.state === 'committed') return { kind: 'committed', role: ticket.role as TravelRole, committedAt: integer(ticket.committed_ms) };
      // From here a later commit for this ticket is refused, so this answer stays true.
      if (ticket) await this.settle(client, ref.ticket, now);
      else await this.tombstone(client, ref, now);
      return { kind: 'released' };
    });
  }

  private async release(ref: TravelTicketRef, side: 'destination' | 'source'): Promise<ReleaseOutcome> {
    const now = this.now();
    return this.tx(async client => {
      const ticket = await this.ticket(client, ref, true);
      if (side === 'source') {
        if (ticket?.state === 'committed') await client.query('UPDATE realm_raid_room_tickets SET source_released = true, updated_ms = $3 WHERE origin = $1 AND ticket = $2',
          [this.options.origin, ref.ticket, now]);
      } else if (ticket && ticket.state === 'held') await this.settle(client, ref.ticket, now);
      else if (!ticket) await this.tombstone(client, ref, now);
      return { kind: 'acknowledged' };
    });
  }

  /** A held ticket either matches the ref exactly or is someone else's: never answer for a foreign ticket. */
  private async ticket(client: SqlClient, ref: TravelTicketRef, lock = false): Promise<Row | undefined> {
    const row = first(await client.query(`SELECT * FROM realm_raid_room_tickets WHERE origin = $1 AND ticket = $2${lock ? ' FOR UPDATE' : ''}`, [this.options.origin, ref.ticket]));
    if (row && (row.person_id !== ref.personId || row.from_kingdom_id !== ref.from || row.to_kingdom_id !== ref.to || integer(row.generation) !== ref.generation)) {
      throw new Error('This ticket already names another journey.');
    }
    return row;
  }
  private async settle(client: SqlClient, ticket: string, now: number): Promise<void> {
    await client.query(`UPDATE realm_raid_room_tickets SET state = 'released', updated_ms = greatest(updated_ms, $3) WHERE origin = $1 AND ticket = $2 AND state = 'held'`,
      [this.options.origin, ticket, now]);
  }
  /** A ticket the door never held is still remembered as released, so a late reserve or commit cannot revive it. */
  private async tombstone(client: SqlClient, ref: TravelTicketRef, now: number): Promise<void> {
    await client.query(`INSERT INTO realm_raid_room_tickets (origin, ticket, person_id, session_id, from_kingdom_id, to_kingdom_id, generation, kind,
      state, lease_until_ms, created_ms, updated_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'released',$9,$9,$9) ON CONFLICT (origin, ticket) DO NOTHING`,
    [this.options.origin, ref.ticket, ref.personId, ref.sessionId, ref.from, ref.to, ref.generation, ref.kind, now]);
  }
  private async held(client: SqlClient, kingdomId: KingdomId): Promise<boolean> {
    return !!first(await client.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.options.origin]));
  }
  private async occupancy(client: SqlClient, kingdomId: KingdomId, except: PersonId | null): Promise<number> {
    const now = this.now();
    const row = first(await client.query(`SELECT
      (SELECT count(*) FROM realm_raid_room_members WHERE origin = $1 AND kingdom_id = $2 AND updated_ms > $3 AND person_id IS DISTINCT FROM $5)
      + (SELECT count(*) FROM realm_raid_room_tickets WHERE origin = $1 AND to_kingdom_id = $2 AND state = 'held' AND lease_until_ms > $4 AND person_id IS DISTINCT FROM $5) AS n`,
    [this.options.origin, kingdomId, now - ROOM_PRESENCE_MS, now, except]));
    return integer(row?.n ?? 0);
  }
  private async role(client: SqlClient, personId: PersonId, kingdomId: KingdomId): Promise<TravelRole> {
    if (kingdomForBroadcaster(personId) === kingdomId) return 'monarch';
    const deed = first(await client.query(`SELECT 1 FROM realm_deeds WHERE origin = $1 AND person_id = $2 AND kingdom_id = $3 AND status <> 'void' LIMIT 1`,
      [this.options.origin, personId, kingdomId]));
    return deed ? 'citizen' : 'visitor';
  }
  private get capacity(): number { return this.options.capacity ?? ROOM_TRAVEL_CAPACITY; }
  private now(): number { const now = Math.floor(this.options.clock()); if (!Number.isSafeInteger(now) || now < 0) throw new Error('The room clock is unavailable.'); return now; }
  private tx<T>(work: (client: SqlClient) => Promise<T>): Promise<T> { return serializable(this.options.pool, client => client, work, OWN); }
  private async read<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect(); try { return await work(client); } finally { client.release(); }
  }
}
