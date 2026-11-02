import { createHash } from 'node:crypto';
import { KingdomIdSchema, PersonIdSchema, PRESENCE_LEASE_MS, PresenceInputSchema, type KingdomId, type PersonId, type PresenceInput } from '@chatdom/shared';
import { RaidObservationSchema, type RaidObservation } from '../../../api/src/raid-gate/observations';
import { serializable, type SqlClient, type SqlPool } from '../../../api/src/raid-gate/postgres-repository';
import type { RaidChatQualification } from './raid-chat-contracts';
import { RAID_GUEST_CLOCK_ALLOWANCE_MS, RAID_GUEST_WINDOW_MS, RaidGuestBeginSchema, RaidGuestChatSchema,
  RaidGuestProjectionSchema, RaidGuestReadSchema, RaidGuestRewardSchema, RaidGuestRoomReceiptSchema, RaidGuestStampSchema,
  type RaidGuestBeginReply, type RaidGuestChat, type RaidGuestProjection, type RaidGuestRefusalReason,
  type RaidGuestReward, type RaidGuestRoomReceipt, type RaidGuestStamp } from '../../../api/src/raid-gate/guest-contracts';

const OWN = new AbortController().signal;
const DAY_MS = 86_400_000;
type Row = Record<string, unknown>;
type Raid = { readonly raidId: string; readonly observation: RaidObservation };
type Refusal = { readonly status: 'refused'; readonly reason: RaidGuestRefusalReason };
export type RaidGuestArrivalResult = Refusal | { readonly status: 'accepted' | 'duplicate'; readonly guest: RaidGuestProjection; readonly stamp: RaidGuestStamp };
export type RaidGuestChatResult = { readonly status: 'ignored'; readonly reason: RaidGuestRefusalReason }
  | { readonly status: 'accepted' | 'duplicate'; readonly guest: RaidGuestProjection | null; readonly stamp: RaidGuestStamp;
    readonly presentation?: RaidChatQualification };
export type RaidGuestPendingEntry = Refusal | { readonly status: 'pending'; readonly raidId: string; readonly expiresAt: number };
export interface RaidGuestAuthorityOptions { readonly pool: SqlPool; readonly origin: 'live' | 'simulated'; readonly clock: () => number }
export class RaidGuestError extends Error {
  constructor(readonly kind: 'invalid' | 'origin' | 'conflict' | 'storage', message: string) { super(message); this.name = 'RaidGuestError'; }
}
const refused = (reason: RaidGuestRefusalReason): Refusal => ({ status: 'refused', reason });
const ignored = (reason: RaidGuestRefusalReason): Extract<RaidGuestChatResult, { status: 'ignored' }> => ({ status: 'ignored', reason });
const first = (result: { rows: unknown[] }): Row | undefined => result.rows[0] as Row | undefined;
function integer(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new RaidGuestError('storage', 'Stored guest time or sequence is invalid.');
  return number;
}
function readRaid(row: Row): Raid {
  try {
    const observation = RaidObservationSchema.parse(JSON.parse(String(row.observation)));
    const raidId = `raid.${createHash('sha256').update(observation.id).digest('hex')}`;
    if (row.raid_id !== raidId || row.origin !== observation.origin || row.direction !== 'incoming'
      || row.to_kingdom_id !== observation.to.kingdomId || row.from_kingdom_id !== observation.from.kingdomId
      || integer(row.occurred_ms) !== observation.occurredAt) throw new Error();
    return { raidId, observation };
  } catch { throw new RaidGuestError('storage', 'Stored guest raid failed its reader.'); }
}
function projection(arrival: Row, raid: Raid): RaidGuestProjection {
  return RaidGuestProjectionSchema.parse({ version: 1, origin: arrival.origin, entryId: arrival.entry_id,
    personId: arrival.person_id, kingdomId: arrival.kingdom_id, raidId: raid.raidId, from: raid.observation.from, to: raid.observation.to,
    arrivedAt: integer(arrival.arrived_ms), raidOccurredAt: raid.observation.occurredAt });
}
function readStamp(row: Row): RaidGuestStamp {
  try {
    const stamp = RaidGuestStampSchema.parse(JSON.parse(String(row.record)));
    if (stamp.kind !== row.kind || stamp.kingdomId !== row.kingdom_id || stamp.occurredAt !== integer(row.at_ms)
      || (stamp.raidId ?? stamp.arrivedWith?.raidId) !== row.raid_id) throw new Error();
    return stamp;
  } catch { throw new RaidGuestError('storage', 'Stored guest stamp failed its reader.'); }
}

/**
 * Durable incoming-raid evidence. No public method trusts a browser identity or an asserted raid roster.
 * begin/guest are called by the same-origin cookie+CSRF host. chat/observePresence are called only after Herald
 * authentication. arrived/departed are ONLY called from DurableKingdom.onLifecycle join/leave: room onJoin has
 * already checked safe spawn and committed the seat, walker, district and control before emitting join.
 * principal.sessionId is the persisted realm_entries.entry_id, not the Colyseus socket id. An auth row alone never
 * calls arrived. Keep failed callback receipts (including their original at) in the host's retry queue.
 *
 * Hot paths take a per-person serializable write lock, never a global raid/crowd lock. History uses commit-ordered
 * per-person sequence (50/page, 4 KiB/record); no text, roster or animation loop is persisted. Reward decisions are
 * once/person/raid, two slots per UTC day, and never mint coal, standing or inventory. Guests and source-chat stamp
 * facts remain after departure/session cleanup. Presentation reads additionally require a live session, entry and
 * room-owned presence lease. Only actual joined seats call present; restart never refreshes leases from auth rows.
 */
export class RaidGuestAuthority {
  constructor(readonly options: RaidGuestAuthorityOptions) {}

  /**
   * Server-only, read-only spawn eligibility. The entry binds the browser session, person and destination; its
   * last intent BEFORE entry opened selects the witnessed raid. This grants no arrival, stamp or presentation.
   * One SQL snapshot checks citizenship and session together; the room still rechecks its session after awaiting.
   */
  async pendingEntry(raw: unknown): Promise<RaidGuestPendingEntry> {
    const input = this.parse(RaidGuestRoomReceiptSchema, raw); this.time(input.at);
    return this.read(async client => {
      const row = first(await client.query(`SELECT o.*, i.raid_id AS intent_raid_id, i.begun_ms,
        floor(extract(epoch FROM e.opened_at) * 1000)::bigint AS opened_ms,
        EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = e.origin AND d.person_id = e.person_id
          AND d.kingdom_id = e.kingdom_id AND d.status <> 'void') AS citizen_here
        FROM realm_entries e JOIN realm_sessions s
          ON s.session_id = e.session_id AND s.person_id = e.person_id AND s.origin = e.origin
        JOIN realm_persons p ON p.person_id = e.person_id AND p.origin = e.origin
        LEFT JOIN LATERAL (SELECT raid_id, begun_ms FROM realm_raid_guest_intents i
          WHERE i.origin = e.origin AND i.session_id = e.session_id AND i.person_id = e.person_id
            AND i.kingdom_id = e.kingdom_id AND i.begun_ms <= floor(extract(epoch FROM e.opened_at) * 1000)::bigint
          ORDER BY sequence DESC LIMIT 1) i ON true
        LEFT JOIN realm_raid_observations o ON o.origin = e.origin AND o.raid_id = i.raid_id
          AND o.to_kingdom_id = e.kingdom_id AND o.direction = 'incoming'
        WHERE e.entry_id = $1 AND e.person_id = $2 AND e.kingdom_id = $3 AND e.origin = $4
          AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp($5::double precision / 1000))`,
      [input.entryId, input.personId, input.kingdomId, input.origin, this.now()]));
      if (!row || integer(row.opened_ms) > input.at) return refused('entry');
      if (row.citizen_here === true) return refused('citizen_here');
      if (row.intent_raid_id === null) return refused('no_intent');
      const raid = readRaid(row);
      // An old invitation cannot capture every future ordinary entry on this browser session. A fresh ticket
      // opened after its window is ordinary; an entry opened inside it must still fail if admission runs late.
      if (integer(row.opened_ms) >= raid.observation.occurredAt + RAID_GUEST_WINDOW_MS) return refused('no_intent');
      if (!this.within(raid, input.at) || !this.within(raid, this.now()) || input.at < integer(row.begun_ms)) return refused('expired');
      return { status: 'pending', raidId: raid.raidId, expiresAt: raid.observation.occurredAt + RAID_GUEST_WINDOW_MS };
    });
  }

  async begin(raw: unknown): Promise<RaidGuestBeginReply> {
    const input = this.parse(RaidGuestBeginSchema, raw), now = this.now();
    return this.tx(async client => {
      if (!await this.session(client, input.sessionId, input.personId, now)) return { version: 1, ...refused('session') };
      await this.lock(client, input.personId);
      const raid = await this.raid(client, input.raidId, input.kingdomId);
      if (!raid) return { version: 1, ...refused('unknown_raid') };
      if (!this.within(raid, now)) return { version: 1, ...refused('expired') };
      if (await this.citizen(client, input.personId, input.kingdomId)) return { version: 1, ...refused('citizen_here') };
      const old = first(await client.query(`SELECT sequence FROM realm_raid_guest_intents WHERE origin = $1 AND session_id = $2 AND raid_id = $3`,
        [input.origin, input.sessionId, input.raidId]));
      if (old) {
        const latest = first(await client.query(`SELECT sequence FROM realm_raid_guest_intents WHERE origin = $1 AND session_id = $2 AND kingdom_id = $3 ORDER BY sequence DESC LIMIT 1`,
          [input.origin, input.sessionId, input.kingdomId]));
        // An old retried link cannot silently acknowledge one invitation while the next entry follows another.
        if (latest && integer(latest.sequence) !== integer(old.sequence)) return { version: 1, ...refused('superseded') };
      }
      await client.query(`INSERT INTO realm_raid_guest_intents (origin, session_id, person_id, kingdom_id, raid_id, begun_ms)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (origin, session_id, raid_id) DO NOTHING`,
      [input.origin, input.sessionId, input.personId, input.kingdomId, input.raidId, now]);
      return { version: 1, status: 'pending', invitation: { raidId: raid.raidId, kingdomId: input.kingdomId,
        from: raid.observation.from, expiresAt: raid.observation.occurredAt + RAID_GUEST_WINDOW_MS } };
    });
  }

  /** Trusted post-admission room callback. An entry row is necessary but never sufficient to call this method. */
  async arrived(raw: unknown): Promise<RaidGuestArrivalResult> {
    const input = this.parse(RaidGuestRoomReceiptSchema, raw); this.time(input.at);
    return this.tx(async client => {
      await this.lock(client, input.personId);
      const existing = first(await client.query('SELECT * FROM realm_raid_guest_arrivals WHERE origin = $1 AND entry_id = $2', [input.origin, input.entryId]));
      if (existing) {
        this.sameEntry(existing, input, 'arrived_ms');
        const raid = await this.requiredRaid(client, String(existing.raid_id), input.kingdomId);
        return { status: 'duplicate', guest: projection(existing, raid), stamp: await this.existingStamp(client, input.personId, raid.raidId, 'visit') };
      }
      const entry = await this.entry(client, input, true);
      if (!entry || integer(entry.opened_ms) > input.at) return refused('entry');
      if (await this.citizen(client, input.personId, input.kingdomId)) return refused('citizen_here');
      const intent = first(await client.query(`SELECT * FROM realm_raid_guest_intents WHERE origin = $1 AND session_id = $2
        AND person_id = $3 AND kingdom_id = $4 AND begun_ms <= $5 ORDER BY sequence DESC LIMIT 1`,
      [input.origin, entry.session_id, input.personId, input.kingdomId, integer(entry.opened_ms)]));
      if (!intent) return refused('no_intent');
      const raid = await this.requiredRaid(client, String(intent.raid_id), input.kingdomId);
      if (!this.within(raid, input.at) || input.at < integer(intent.begun_ms)) return refused('expired');
      const arrival = { origin: input.origin, entry_id: input.entryId, session_id: entry.session_id,
        person_id: input.personId, kingdom_id: input.kingdomId, raid_id: raid.raidId, arrived_ms: input.at };
      await client.query(`INSERT INTO realm_raid_guest_arrivals
        (origin, entry_id, session_id, person_id, kingdom_id, raid_id, intent_sequence, arrived_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.origin, input.entryId, entry.session_id, input.personId, input.kingdomId, raid.raidId, intent.sequence, input.at]);
      await client.query('INSERT INTO realm_raid_guest_presence (origin, entry_id, last_seen_ms) VALUES ($1,$2,$3)', [input.origin, input.entryId, input.at]);
      const stamp = await this.stamp(client, input.personId, raid, 'visit', input.at, input.entryId, null);
      return { status: 'accepted', guest: projection(arrival, raid), stamp };
    });
  }

  /** Process-local heartbeat from an ACTUAL joined room seat, never from HTTP, auth rows or a recovery scan. */
  async present(raw: unknown): Promise<{ readonly status: 'accepted' | 'duplicate' } | Refusal> {
    const input = this.parse(RaidGuestRoomReceiptSchema, raw); this.time(input.at);
    return this.tx(async client => {
      await this.lock(client, input.personId);
      const entry = await this.entry(client, input, true);
      if (!entry || integer(entry.opened_ms) > input.at) return refused('entry');
      const arrival = first(await client.query(`SELECT a.*, p.last_seen_ms FROM realm_raid_guest_arrivals a
        JOIN realm_raid_guest_presence p ON p.origin = a.origin AND p.entry_id = a.entry_id
        WHERE a.origin = $1 AND a.entry_id = $2 AND a.person_id = $3 AND a.kingdom_id = $4
          AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_departures d WHERE d.origin = a.origin AND d.entry_id = a.entry_id)`,
      [input.origin, input.entryId, input.personId, input.kingdomId]));
      if (!arrival || integer(arrival.arrived_ms) > input.at) return refused('entry');
      if (integer(arrival.last_seen_ms) >= input.at) return { status: 'duplicate' };
      await client.query('UPDATE realm_raid_guest_presence SET last_seen_ms = $3 WHERE origin = $1 AND entry_id = $2', [input.origin, input.entryId, input.at]);
      return { status: 'accepted' };
    });
  }

  /** Trusted room leave callback. A tombstone can commit before a queued join; history is still repaired later. */
  async departed(raw: unknown): Promise<{ readonly status: 'accepted' | 'duplicate' } | Refusal> {
    const input = this.parse(RaidGuestRoomReceiptSchema, raw); this.time(input.at);
    return this.tx(async client => {
      await this.lock(client, input.personId);
      const previous = first(await client.query('SELECT * FROM realm_raid_guest_departures WHERE origin = $1 AND entry_id = $2', [input.origin, input.entryId]));
      if (previous) { this.sameEntry(previous, input); return { status: 'duplicate' }; }
      const entry = await this.entry(client, input, false);
      if (!entry || integer(entry.opened_ms) > input.at) return refused('entry');
      const arrival = first(await client.query('SELECT arrived_ms FROM realm_raid_guest_arrivals WHERE origin = $1 AND entry_id = $2', [input.origin, input.entryId]));
      if (arrival && integer(arrival.arrived_ms) > input.at) return refused('entry');
      if (!arrival && !first(await client.query(`SELECT sequence FROM realm_raid_guest_intents WHERE origin = $1 AND session_id = $2
        AND person_id = $3 AND kingdom_id = $4 AND begun_ms <= $5 LIMIT 1`,
      [input.origin, entry.session_id, input.personId, input.kingdomId, integer(entry.opened_ms)]))) return refused('no_intent');
      await client.query(`INSERT INTO realm_raid_guest_departures (origin, entry_id, person_id, kingdom_id, departed_ms) VALUES ($1,$2,$3,$4,$5)`,
        [input.origin, input.entryId, input.personId, input.kingdomId, input.at]);
      return { status: 'accepted' };
    });
  }

  async chat(raw: unknown): Promise<RaidGuestChatResult> {
    const input = this.parse(RaidGuestChatSchema, raw); this.time(input.at);
    return this.tx(async client => {
      const signedIn = first(await client.query(`SELECT person_id FROM realm_persons WHERE person_id = $1 AND origin = $2
        AND floor(extract(epoch FROM created_at) * 1000)::bigint <= $3`, [input.personId, input.origin, input.at]));
      if (!signedIn) return ignored('not_signed_in');
      await this.lock(client, input.personId);
      const previous = first(await client.query(`SELECT * FROM realm_raid_guest_chat WHERE origin = $1 AND kingdom_id = $2 AND message_id = $3`,
        [input.origin, input.kingdomId, input.messageId]));
      if (previous) {
        if (previous.person_id !== input.personId || integer(previous.at_ms) !== input.at) throw new RaidGuestError('conflict', 'This chat ID already names another fact.');
        return this.chatResult(client, input, previous, 'duplicate');
      }
      // Explicit committed visit attribution wins over a different recent raid. Citizenship is checked separately:
      // a real source citizen may earn a raid stamp even if they also have a home at the destination.
      const row = first(await client.query(`SELECT o.*, g.entry_id AS guest_entry_id,
        EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = o.origin AND d.person_id = $3
          AND d.kingdom_id = o.from_kingdom_id AND d.status <> 'void' AND d.allocated_ms <= $4) AS source_citizen
        FROM realm_raid_observations o LEFT JOIN LATERAL (
          SELECT a.entry_id FROM realm_raid_guest_arrivals a WHERE a.origin = o.origin AND a.person_id = $3
            AND a.raid_id = o.raid_id AND a.arrived_ms <= $4 ORDER BY a.arrived_ms DESC, a.entry_id LIMIT 1
        ) g ON true WHERE o.origin = $1 AND o.to_kingdom_id = $2 AND o.direction = 'incoming'
          AND o.occurred_ms <= $4 AND o.occurred_ms + $5 > $4
          AND (g.entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = o.origin
            AND d.person_id = $3 AND d.kingdom_id = o.from_kingdom_id AND d.status <> 'void' AND d.allocated_ms <= $4))
        ORDER BY (g.entry_id IS NOT NULL) DESC, o.occurred_ms DESC, o.sequence DESC LIMIT 1`,
      [input.origin, input.kingdomId, input.personId, input.at, RAID_GUEST_WINDOW_MS]));
      if (!row) return this.continueChatVisit(client, input);
      const raid = readRaid(row), source = row.source_citizen === true;
      const chat = { origin: input.origin, kingdom_id: input.kingdomId, message_id: input.messageId,
        person_id: input.personId, raid_id: raid.raidId, at_ms: input.at,
        basis: source ? 'source_citizen' : 'guest', entry_id: source ? null : row.guest_entry_id };
      await client.query(`INSERT INTO realm_raid_guest_chat (origin, kingdom_id, message_id, person_id, raid_id, at_ms, basis, entry_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [input.origin, input.kingdomId, input.messageId, input.personId,
        raid.raidId, input.at, chat.basis, chat.entry_id]);
      if (source) await this.stamp(client, input.personId, raid, 'raid', input.at, null, input.messageId);
      await client.query(`INSERT INTO realm_raid_guest_chat_visits
        (origin, person_id, kingdom_id, raid_id, proof_message_id, last_message_id, last_seen_ms) VALUES ($1,$2,$3,$4,$5,$5,$6)
        ON CONFLICT (origin, person_id, kingdom_id, raid_id) DO UPDATE SET
          last_message_id = CASE WHEN excluded.last_seen_ms > realm_raid_guest_chat_visits.last_seen_ms
            THEN excluded.last_message_id ELSE realm_raid_guest_chat_visits.last_message_id END,
          last_seen_ms = greatest(realm_raid_guest_chat_visits.last_seen_ms, excluded.last_seen_ms)`,
      [input.origin, input.personId, input.kingdomId, raid.raidId, input.messageId, input.at]);
      return this.chatResult(client, input, chat, 'accepted');
    });
  }

  /** Preserve the verified normalized provider ID/time; a snapshot or chatters list is never chat evidence. */
  async observePresence(raw: PresenceInput): Promise<RaidGuestChatResult | null> {
    const input = PresenceInputSchema.parse(raw);
    if (input.origin !== this.options.origin) throw new RaidGuestError('origin', 'Presence belongs to another realm origin.');
    if (input.kind !== 'observe' || input.source !== 'chat') return null;
    if (input.people.length !== 1) throw new RaidGuestError('invalid', 'One verified chat message names exactly one person.');
    return this.chat({ version: 1, origin: input.origin, kingdomId: input.kingdomId,
      messageId: input.id, personId: input.people[0]!.personId, at: input.providerAt ?? input.observedAt });
  }

  /** Cookie-owned read, not a room membership claim. The committed entry and live session are both rechecked. */
  async guest(raw: unknown): Promise<RaidGuestProjection | null> {
    const input = this.parse(RaidGuestReadSchema, raw), now = this.now();
    return this.read(async client => {
      if (!await this.session(client, input.sessionId, input.personId, now)) return null;
      if (await this.citizen(client, input.personId, input.kingdomId)) return null;
      const row = first(await client.query(`SELECT a.* FROM realm_raid_guest_arrivals a JOIN realm_entries e
        ON e.entry_id = a.entry_id AND e.session_id = a.session_id AND e.person_id = a.person_id
          AND e.kingdom_id = a.kingdom_id AND e.origin = a.origin
        JOIN realm_raid_guest_presence p ON p.origin = a.origin AND p.entry_id = a.entry_id
        JOIN realm_sessions s ON s.session_id = a.session_id AND s.person_id = a.person_id AND s.origin = a.origin
        WHERE a.origin = $1 AND a.session_id = $2 AND a.person_id = $3 AND a.kingdom_id = $4
          AND ($5::uuid IS NULL OR a.entry_id = $5) AND ($6::text IS NULL OR a.raid_id = $6)
          AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_departures d WHERE d.origin = a.origin AND d.entry_id = a.entry_id)
          AND p.last_seen_ms + $8 > $7
          AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp($7::double precision / 1000))
        ORDER BY a.arrived_ms DESC, a.entry_id LIMIT 1`,
      [input.origin, input.sessionId, input.personId, input.kingdomId, input.entryId ?? null, input.raidId ?? null, now, PRESENCE_LEASE_MS]));
      return row ? projection(row, await this.requiredRaid(client, String(row.raid_id), input.kingdomId)) : null;
    });
  }

  /**
   * Exclude known guests and unexpired session-bound visiting intents from automatic home allocation. An intent
   * only withholds allocation while the room callback commits; it never creates a guest, stamp, light or crest.
   * Original presence still goes to the lights. This closes chat racing the asynchronous join persistence.
   */
  async visitors(kingdomId: string, people: readonly string[], at: number): Promise<readonly PersonId[]> {
    KingdomIdSchema.parse(kingdomId); this.time(at);
    if (people.length > 512) throw new RaidGuestError('invalid', 'A visitor check takes at most 512 people.');
    const ids = [...new Set(people.map(value => PersonIdSchema.parse(value)))];
    if (!ids.length) return [];
    return this.read(async client => {
      const found = await client.query(`SELECT p.person_id FROM realm_persons p WHERE p.origin = $1 AND p.person_id = ANY($3::text[])
        AND NOT EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = p.origin AND d.person_id = p.person_id
          AND d.kingdom_id = $2 AND d.status <> 'void') AND (
        EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a JOIN realm_entries e ON e.entry_id = a.entry_id
          AND e.session_id = a.session_id AND e.person_id = a.person_id AND e.origin = a.origin AND e.kingdom_id = a.kingdom_id
          JOIN realm_sessions s ON s.session_id = a.session_id AND s.person_id = a.person_id AND s.origin = a.origin
          JOIN realm_raid_guest_presence gp ON gp.origin = a.origin AND gp.entry_id = a.entry_id
          WHERE a.origin = p.origin AND a.person_id = p.person_id AND a.kingdom_id = $2 AND a.arrived_ms <= $4
            AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp($5::double precision / 1000))
            AND gp.last_seen_ms + $7 > greatest($4, $5)
            AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_departures d WHERE d.origin = a.origin AND d.entry_id = a.entry_id))
        OR EXISTS (SELECT 1 FROM realm_raid_guest_chat_visits v JOIN realm_raid_guest_chat c
          ON c.origin = v.origin AND c.kingdom_id = v.kingdom_id AND c.message_id = v.proof_message_id
          WHERE v.origin = p.origin AND v.person_id = p.person_id AND v.kingdom_id = $2
            AND c.at_ms <= $4 AND v.last_seen_ms + $7 > $4)
        OR EXISTS (SELECT 1 FROM realm_raid_guest_intents i JOIN realm_sessions s
          ON s.session_id = i.session_id AND s.person_id = i.person_id AND s.origin = i.origin
          JOIN realm_raid_observations o ON o.origin = i.origin AND o.raid_id = i.raid_id
          WHERE i.origin = p.origin AND i.person_id = p.person_id AND i.kingdom_id = $2 AND i.begun_ms <= $4
            AND o.occurred_ms <= $4 AND o.occurred_ms + $6 > $4
            AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = i.origin AND a.intent_sequence = i.sequence)
            AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp($5::double precision / 1000)))) ORDER BY p.person_id`,
      [this.options.origin, kingdomId, ids, at, this.now(), RAID_GUEST_WINDOW_MS, PRESENCE_LEASE_MS]);
      return found.rows.map(row => PersonIdSchema.parse((row as Row).person_id));
    });
  }

  /** Private authority read. The passport host still applies first-sign-in disclosure and Hide my travels. */
  async history(personId: string, cursor: string | null = null, limit = 50): Promise<{
    readonly version: 1; readonly items: readonly RaidGuestStamp[]; readonly next: string | null; readonly revision: number;
  }> {
    PersonIdSchema.parse(personId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RaidGuestError('invalid', 'A stamp page takes 1–50 records.');
    const prefix = `${this.options.origin}:${personId}:`;
    if (cursor !== null && (!cursor.startsWith(prefix) || !/^[1-9][0-9]{0,15}$/u.test(cursor.slice(prefix.length)))) throw new RaidGuestError('invalid', 'The stamp cursor belongs to another passport.');
    const after = cursor === null ? 0 : integer(cursor.slice(prefix.length));
    return this.tx(async client => {
      const head = first(await client.query('SELECT stamp_sequence FROM realm_raid_guest_heads WHERE origin = $1 AND person_id = $2', [this.options.origin, personId]));
      const found = await client.query(`SELECT * FROM realm_raid_guest_stamps WHERE origin = $1 AND person_id = $2 AND sequence > $3 ORDER BY sequence LIMIT $4`,
        [this.options.origin, personId, after, limit]);
      const rows = found.rows as Row[];
      return { version: 1, items: rows.map(readStamp), next: rows.length ? `${prefix}${integer(rows.at(-1)!.sequence)}` : cursor,
        revision: head ? integer(head.stamp_sequence) : 0 };
    });
  }

  private async chatResult(client: SqlClient, input: RaidGuestChat, chat: Row, status: 'accepted' | 'duplicate'): Promise<RaidGuestChatResult> {
    const raid = await this.requiredRaid(client, String(chat.raid_id), input.kingdomId);
    const kind = chat.basis === 'source_citizen' ? 'raid' : 'visit';
    const stamp = await this.existingStamp(client, input.personId, raid.raidId, kind);
    let guest: RaidGuestProjection | null = null;
    if (!await this.citizen(client, input.personId, input.kingdomId)) {
      const arrival = first(await client.query(`SELECT a.* FROM realm_raid_guest_arrivals a
        JOIN realm_entries e ON e.entry_id = a.entry_id AND e.session_id = a.session_id AND e.person_id = a.person_id
          AND e.origin = a.origin AND e.kingdom_id = a.kingdom_id
        JOIN realm_sessions s ON s.session_id = a.session_id AND s.person_id = a.person_id AND s.origin = a.origin
        JOIN realm_raid_guest_presence gp ON gp.origin = a.origin AND gp.entry_id = a.entry_id
        WHERE a.origin = $1 AND a.person_id = $2
        AND a.raid_id = $3 AND a.arrived_ms <= $4 AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_departures d
          WHERE d.origin = a.origin AND d.entry_id = a.entry_id)
          AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp($5::double precision / 1000))
          AND gp.last_seen_ms + $6 > greatest($4, $5)
        ORDER BY a.arrived_ms DESC, a.entry_id LIMIT 1`,
      [input.origin, input.personId, raid.raidId, input.at, this.now(), PRESENCE_LEASE_MS]));
      if (arrival) guest = projection(arrival, raid);
    }
    return { status, guest, stamp, presentation: {
      origin: input.origin, kingdomId: input.kingdomId, personId: input.personId, messageId: input.messageId, at: input.at,
      proofMessageId: String(chat.message_id), proofAt: integer(chat.at_ms), raidOccurredAt: raid.observation.occurredAt,
      raid: { raidId: raid.raidId, fromKingdomId: raid.observation.from.kingdomId, fromName: raid.observation.from.name },
    } };
  }

  private async continueChatVisit(client: SqlClient, input: RaidGuestChat): Promise<RaidGuestChatResult> {
    const visit = first(await client.query(`SELECT c.*, v.last_message_id, v.last_seen_ms FROM realm_raid_guest_chat_visits v
      JOIN realm_raid_guest_chat c ON c.origin = v.origin AND c.kingdom_id = v.kingdom_id AND c.message_id = v.proof_message_id
      WHERE v.origin = $1 AND v.person_id = $2 AND v.kingdom_id = $3 AND c.at_ms <= $4 AND v.last_seen_ms + $5 > $4
      ORDER BY v.last_seen_ms DESC, v.raid_id LIMIT 1`, [input.origin, input.personId, input.kingdomId, input.at, PRESENCE_LEASE_MS]));
    if (!visit) return ignored('not_tied');
    const duplicate = visit.last_message_id === input.messageId;
    if (duplicate && integer(visit.last_seen_ms) !== input.at) throw new RaidGuestError('conflict', 'This visitor chat ID already names another time.');
    await client.query(`UPDATE realm_raid_guest_chat_visits SET last_seen_ms = greatest(last_seen_ms, $5),
      last_message_id = CASE WHEN $5 > last_seen_ms THEN $6 ELSE last_message_id END
      WHERE origin = $1 AND person_id = $2 AND kingdom_id = $3 AND raid_id = $4`,
    [input.origin, input.personId, input.kingdomId, visit.raid_id, input.at, input.messageId]);
    // A continued visit can withhold automatic settlement, but it never issues fresh history or rewards.
    return this.chatResult(client, input, visit, duplicate ? 'duplicate' : 'accepted');
  }

  private async stamp(client: SqlClient, personId: PersonId, raid: Raid, kind: 'visit' | 'raid', at: number, entryId: string | null, messageId: string | null): Promise<RaidGuestStamp> {
    const prior = first(await client.query('SELECT * FROM realm_raid_guest_stamps WHERE origin = $1 AND person_id = $2 AND raid_id = $3 AND kind = $4',
      [this.options.origin, personId, raid.raidId, kind]));
    if (prior) return readStamp(prior);
    const reward = await this.reward(client, personId, raid, at), observation = raid.observation;
    const stamp = RaidGuestStampSchema.parse({ id: `raid-stamp.${createHash('sha256').update(JSON.stringify([this.options.origin, personId, raid.raidId, kind])).digest('hex')}`,
      kind, kingdomId: observation.to.kingdomId, occurredAt: at, raidId: kind === 'raid' ? raid.raidId : null,
      arrivedWith: kind === 'visit' ? { raidId: raid.raidId, from: observation.from, to: observation.to, occurredAt: observation.occurredAt } : null, reward });
    const head = first(await client.query(`UPDATE realm_raid_guest_heads SET stamp_sequence = stamp_sequence + 1
      WHERE origin = $1 AND person_id = $2 RETURNING stamp_sequence`, [this.options.origin, personId]));
    if (!head) throw new RaidGuestError('storage', 'The passport sequence is unavailable.');
    await client.query(`INSERT INTO realm_raid_guest_stamps
      (origin, person_id, sequence, raid_id, kingdom_id, kind, at_ms, entry_id, message_id, record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [this.options.origin, personId, integer(head.stamp_sequence), raid.raidId, observation.to.kingdomId, kind, at, entryId, messageId, JSON.stringify(stamp)]);
    return stamp;
  }
  private async existingStamp(client: SqlClient, personId: PersonId, raidId: string, kind: 'visit' | 'raid'): Promise<RaidGuestStamp> {
    const row = first(await client.query('SELECT * FROM realm_raid_guest_stamps WHERE origin = $1 AND person_id = $2 AND raid_id = $3 AND kind = $4',
      [this.options.origin, personId, raidId, kind]));
    if (!row) throw new RaidGuestError('storage', 'Committed guest evidence has no stamp.');
    return readStamp(row);
  }
  private async reward(client: SqlClient, personId: PersonId, raid: Raid, at: number): Promise<RaidGuestReward> {
    let row = first(await client.query('SELECT * FROM realm_raid_guest_rewards WHERE origin = $1 AND person_id = $2 AND raid_id = $3', [this.options.origin, personId, raid.raidId]));
    if (!row) {
      const day = Math.floor(at / DAY_MS);
      const used = (await client.query(`SELECT reward_slot FROM realm_raid_guest_rewards WHERE origin = $1 AND person_id = $2 AND utc_day = $3 AND reward_slot IS NOT NULL`,
        [this.options.origin, personId, day])).rows.length;
      const reason = raid.observation.viewers < 3 ? 'small_raid' : used >= 2 ? 'day_cap' : 'eligible';
      row = { utc_day: day, reason, reward_slot: reason === 'eligible' ? used + 1 : null };
      await client.query(`INSERT INTO realm_raid_guest_rewards (origin, person_id, raid_id, awarded_ms, utc_day, reward_slot, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [this.options.origin, personId, raid.raidId, at, day, row.reward_slot, reason]);
    }
    return RaidGuestRewardSchema.parse({ eligible: row.reward_slot !== null, reason: row.reason, day: integer(row.utc_day) });
  }
  private async lock(client: SqlClient, personId: PersonId): Promise<void> {
    await client.query(`INSERT INTO realm_raid_guest_heads (origin, person_id) VALUES ($1,$2)
      ON CONFLICT (origin, person_id) DO UPDATE SET lock_revision = realm_raid_guest_heads.lock_revision + 1`, [this.options.origin, personId]);
  }
  private async session(client: SqlClient, sessionId: string, personId: PersonId, now: number): Promise<boolean> {
    return !!first(await client.query(`SELECT s.session_id FROM realm_sessions s JOIN realm_persons p ON p.person_id = s.person_id
      WHERE s.session_id = $1 AND s.person_id = $2 AND s.origin = $3 AND p.origin = $3 AND s.revoked_at IS NULL
        AND s.expires_at > greatest(now(), to_timestamp($4::double precision / 1000))`, [sessionId, personId, this.options.origin, now]));
  }
  private async entry(client: SqlClient, input: RaidGuestRoomReceipt, live: boolean): Promise<Row | undefined> {
    const row = first(await client.query(`SELECT e.*, floor(extract(epoch FROM e.opened_at) * 1000)::bigint AS opened_ms
      FROM realm_entries e WHERE entry_id = $1 AND person_id = $2 AND kingdom_id = $3 AND origin = $4`,
    [input.entryId, input.personId, input.kingdomId, input.origin]));
    return row && (!live || await this.session(client, String(row.session_id), input.personId, this.now())) ? row : undefined;
  }
  private async citizen(client: SqlClient, personId: PersonId, kingdomId: KingdomId): Promise<boolean> {
    return !!first(await client.query(`SELECT deed_id FROM realm_deeds WHERE origin = $1 AND person_id = $2 AND kingdom_id = $3 AND status <> 'void' LIMIT 1`,
      [this.options.origin, personId, kingdomId]));
  }
  private async raid(client: SqlClient, raidId: string, kingdomId: KingdomId): Promise<Raid | null> {
    const row = first(await client.query(`SELECT * FROM realm_raid_observations WHERE origin = $1 AND raid_id = $2 AND to_kingdom_id = $3 AND direction = 'incoming'`,
      [this.options.origin, raidId, kingdomId]));
    return row ? readRaid(row) : null;
  }
  private async requiredRaid(client: SqlClient, raidId: string, kingdomId: KingdomId): Promise<Raid> {
    const raid = await this.raid(client, raidId, kingdomId);
    if (!raid) throw new RaidGuestError('storage', 'Guest history lost its witnessed raid.');
    return raid;
  }
  private sameEntry(row: Row, input: RaidGuestRoomReceipt, timeColumn?: 'arrived_ms'): void {
    if (row.person_id !== input.personId || row.kingdom_id !== input.kingdomId || (timeColumn && integer(row[timeColumn]) !== input.at)) {
      throw new RaidGuestError('conflict', 'This room entry already names another fact.');
    }
  }
  private within(raid: Raid, at: number): boolean { return at >= raid.observation.occurredAt && at < raid.observation.occurredAt + RAID_GUEST_WINDOW_MS; }
  private parse<T extends { origin: 'live' | 'simulated' }>(schema: { safeParse(raw: unknown): { success: true; data: T } | { success: false } }, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new RaidGuestError('invalid', 'The guest evidence is malformed.');
    if (result.data.origin !== this.options.origin) throw new RaidGuestError('origin', 'Guest evidence belongs to another realm origin.');
    return result.data;
  }
  private now(): number { const now = this.options.clock(); if (!Number.isSafeInteger(now) || now < 0) throw new RaidGuestError('storage', 'The guest authority clock is unavailable.'); return now; }
  private time(at: number): void {
    if (!Number.isSafeInteger(at) || at < 0 || at > this.now() + RAID_GUEST_CLOCK_ALLOWANCE_MS) throw new RaidGuestError('invalid', 'Guest evidence exceeds the clock allowance.');
  }
  private tx<T>(work: (client: SqlClient) => Promise<T>): Promise<T> { return serializable(this.options.pool, client => client, work, OWN); }
  private async read<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect(); try { return await work(client); } finally { client.release(); }
  }
}
