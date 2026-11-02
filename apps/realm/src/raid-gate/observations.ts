import { createHash } from 'node:crypto';
import { AtlasRaidSchema, type AtlasRaid, KingdomIdSchema, type KingdomId,
  parseRaidPennantArchiveCursor, RaidPennantArchivePageSchema, type RaidPennantArchivePage } from '@chatdom/shared';
import { RealmMomentObservationSchema, type RealmMomentObservation } from '@chatdom/shared/realm';
import { RaidObservationSchema, RAID_BEAT_WINDOW_MS, type RaidObservation } from '../../../api/src/raid-gate/observations';
import { correlateObservedRaid, recordObservedRaid, RaidObservationConflict } from '../../../api/src/raid-gate/observed-raid';
import { createRaidGateTransaction, serializable, type SqlClient, type SqlPool } from '../../../api/src/raid-gate/postgres-repository';
import type { AtlasRoadIngress, RaidObservationReceipt } from '../../../api/src/raid-gate/ports';
import { queueRaidWelcome } from './crier';

const OWN = new AbortController().signal;
const COLUMNS = 'origin, sequence::text AS sequence, event_id, raid_id, kingdom_id, direction, from_kingdom_id, to_kingdom_id, occurred_ms::text AS occurred_ms, received_ms::text AS received_ms, action_request_id, observation, raid';
export const raidIdForEvent = (id: string): string => `raid.${createHash('sha256').update(id, 'utf8').digest('hex')}`;

export class RaidObservationError extends Error {
  constructor(readonly kind: 'invalid' | 'origin' | 'conflict' | 'storage', message: string) { super(message); this.name = 'RaidObservationError'; }
}
export interface RecordedRaid {
  readonly sequence: number;
  readonly observation: RaidObservation;
  readonly raid: AtlasRaid;
  readonly actionRequestId: string | null;
}
export interface RaidRoadPage { readonly version: 1; readonly items: readonly AtlasRaid[]; readonly next: string | null }
export interface RaidPennant {
  readonly raidId: string; readonly from: RaidObservation['from']; readonly occurredAt: number;
}
export interface RaidObservationLedgerOptions {
  readonly pool: SqlPool;
  readonly origin: 'live' | 'simulated';
  readonly clock: () => number;
  /** The existing realm's durable moment authority, idempotent under the original EventSub message ID. */
  readonly moment: (observation: RealmMomentObservation) => Promise<{ readonly http: number; readonly body: { readonly status: string } }>;
}

function raidOf(observation: RaidObservation): AtlasRaid {
  return AtlasRaidSchema.parse({ version: 1, id: raidIdForEvent(observation.id), fromKingdomId: observation.from.kingdomId,
    toKingdomId: observation.to.kingdomId, viewers: observation.viewers, observedAt: observation.receivedAt,
    occurredAt: observation.occurredAt, delivery: 'resumable', source: observation.origin === 'live' ? 'herald' : 'simulation',
    evidence: observation.origin === 'live' ? { kind: 'observed', asOf: observation.receivedAt }
      : { kind: 'simulated', asOf: observation.receivedAt, label: 'SIMULATED' } });
}

/** Receipt time may change on a provider redelivery; it never refreshes the first observation or its beat. */
function fingerprint(observation: RaidObservation): string {
  return JSON.stringify({ ...observation, receivedAt: undefined });
}

function readRow(raw: unknown): RecordedRaid {
  const row = raw as Record<string, unknown> | null;
  try {
    if (!row || typeof row.observation !== 'string' || typeof row.raid !== 'string') throw new Error();
    const observation = RaidObservationSchema.parse(JSON.parse(row.observation));
    const raid = AtlasRaidSchema.parse(JSON.parse(row.raid));
    const sequence = Number(row.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== row.sequence || observation.origin !== row.origin
      || observation.id !== row.event_id || raid.id !== row.raid_id || raid.id !== raidIdForEvent(observation.id)
      || observation.kingdomId !== row.kingdom_id || observation.direction !== row.direction
      || observation.from.kingdomId !== row.from_kingdom_id || observation.to.kingdomId !== row.to_kingdom_id
      || String(observation.occurredAt) !== row.occurred_ms || String(observation.receivedAt) !== row.received_ms
      || JSON.stringify(raid) !== JSON.stringify(raidOf(observation))
      || (row.action_request_id !== null && typeof row.action_request_id !== 'string')) throw new Error();
    return { sequence, observation, raid, actionRequestId: row.action_request_id as string | null };
  } catch { throw new RaidObservationError('storage', 'Stored raid history failed its reader.'); }
}

/** One commit-ordered feed, also the durable source for dated pennants and future witnessed guest evidence. */
export class RaidObservationLedger {
  private recovering: Promise<{ delivered: number; expired: number; waiting: number }> | null = null;
  readonly roads: AtlasRoadIngress;
  constructor(readonly options: RaidObservationLedgerOptions) {
    this.roads = { origin: options.origin, observe: async (raw, signal) => {
      signal.throwIfAborted();
      const raid = AtlasRaidSchema.parse(raw);
      const found = await this.withClient(client => client.query(`SELECT ${COLUMNS} FROM realm_raid_observations WHERE origin = $1 AND raid_id = $2`, [options.origin, raid.id]));
      if (!found.rows[0] || JSON.stringify(readRow(found.rows[0]).raid) !== JSON.stringify(raid)) {
        throw new RaidObservationError('invalid', 'A road needs a raid the realm durably witnessed.');
      }
    } };
  }

  async record(raw: unknown): Promise<{ readonly status: 'accepted' | 'duplicate'; readonly raidId: string; readonly gate: RaidObservationReceipt | null }> {
    const parsed = RaidObservationSchema.safeParse(raw);
    if (!parsed.success) throw new RaidObservationError('invalid', 'The raid observation is malformed.');
    const observation = parsed.data;
    if (observation.origin !== this.options.origin) throw new RaidObservationError('origin', 'The raid belongs to another origin.');
    if (Math.max(observation.receivedAt, observation.occurredAt) > this.options.clock() + 5_000) throw new RaidObservationError('invalid', 'The raid time exceeds the clock allowance.');
    return serializable(this.options.pool, client => client, async client => {
      // Holding this row until commit orders sequence allocation with visibility, rather than relying on a sequence
      // whose later transaction could commit first and make an earlier row disappear behind a consumer's cursor.
      const head = await client.query('SELECT sequence::text AS sequence FROM realm_raid_feed_heads WHERE origin = $1 FOR UPDATE', [this.options.origin]);
      const previous = (head.rows[0] as { sequence?: unknown } | undefined)?.sequence;
      if (typeof previous !== 'string' || !/^\d+$/u.test(previous)) throw new RaidObservationError('storage', 'The raid feed has no valid head.');
      const existing = await client.query(`SELECT ${COLUMNS} FROM realm_raid_observations WHERE origin = $1 AND event_id = $2`, [observation.origin, observation.id]);
      if (existing.rows[0]) {
        const first = readRow(existing.rows[0]);
        if (fingerprint(first.observation) !== fingerprint(observation)) throw new RaidObservationError('conflict', 'This EventSub ID already names different raid facts.');
        return { status: 'duplicate' as const, raidId: first.raid.id, gate: null };
      }
      const sequence = Number(previous) + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RaidObservationError('storage', 'The raid feed sequence is exhausted.');
      const raid = raidOf(observation), tx = createRaidGateTransaction(client);
      const actionRequestId = observation.direction === 'outgoing' ? await correlateObservedRaid(tx, raid, observation.origin) : null;
      await client.query(`INSERT INTO realm_raid_observations
        (origin, sequence, event_id, raid_id, kingdom_id, direction, from_kingdom_id, to_kingdom_id, occurred_ms, received_ms, action_request_id, observation, raid)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [observation.origin, sequence, observation.id, raid.id, observation.kingdomId, observation.direction,
        observation.from.kingdomId, observation.to.kingdomId, observation.occurredAt, observation.receivedAt, actionRequestId, JSON.stringify(observation), JSON.stringify(raid)]);
      const beat = observation.direction === 'outgoing' ? 'none' : this.options.clock() >= observation.occurredAt + RAID_BEAT_WINDOW_MS ? 'expired' : 'pending';
      await client.query('INSERT INTO realm_raid_observation_effects (origin, event_id, beat_state) VALUES ($1,$2,$3)', [observation.origin, observation.id, beat]);
      await queueRaidWelcome(client, observation);
      let gate: RaidObservationReceipt | null = null;
      if (actionRequestId !== null) {
        try {
          gate = (await recordObservedRaid(tx, { raid, upstreamEventId: observation.id, actionRequestId, receivedAt: observation.receivedAt },
            { origin: observation.origin, now: this.options.clock(), roadRecorded: true })).receipt;
        } catch (error) {
          if (error instanceof RaidObservationConflict) throw Object.assign(new Error('The gate changed during raid ingestion.'), { code: '40001' });
          throw error;
        }
      }
      await client.query('UPDATE realm_raid_feed_heads SET sequence = $2 WHERE origin = $1', [observation.origin, sequence]);
      return { status: 'accepted' as const, raidId: raid.id, gate };
    }, OWN);
  }

  /** `next` is a durable tail cursor, including on the final nonempty page; an empty poll preserves it. */
  async page(after: string | null = null, limit = 200): Promise<RaidRoadPage> {
    const sequence = this.cursor(after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RaidObservationError('invalid', 'A road page takes 1–200 raids.');
    const result = await this.withClient(client => client.query(`SELECT ${COLUMNS} FROM realm_raid_observations WHERE origin = $1 AND sequence > $2 ORDER BY realm_raid_observations.sequence LIMIT $3`, [this.options.origin, sequence, limit]));
    const rows = result.rows.map(readRow);
    if (rows.some(row => row.observation.origin !== this.options.origin)) throw new RaidObservationError('storage', 'A road crossed origins.');
    return { version: 1, items: rows.map(row => row.raid), next: rows.length ? `${this.options.origin}:${rows.at(-1)!.sequence}` : after };
  }

  async pennants(kingdomId: KingdomId, limit = 24): Promise<readonly RaidPennant[]> {
    KingdomIdSchema.parse(kingdomId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new RaidObservationError('invalid', 'A wall shows 1–64 pennants.');
    const result = await this.withClient(client => client.query(`SELECT ${COLUMNS} FROM realm_raid_observations
      WHERE origin = $1 AND to_kingdom_id = $2 AND direction = 'incoming' ORDER BY realm_raid_observations.sequence DESC LIMIT $3`, [this.options.origin, kingdomId, limit]));
    return result.rows.map(raw => { const row = readRow(raw); return { raidId: row.raid.id, from: row.observation.from, occurredAt: row.observation.occurredAt }; });
  }

  /** Earlier incoming commits within the first read's ceiling, independent of provider time or process lifetime. */
  async pennantArchive(kingdomId: KingdomId, before: string | null, limit = 12): Promise<RaidPennantArchivePage> {
    if (!KingdomIdSchema.safeParse(kingdomId).success || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new RaidObservationError('invalid', 'A pennant archive needs a kingdom and 1–64 visits.');
    }
    const cursor = before === null ? null : parseRaidPennantArchiveCursor(before);
    if (before !== null && (!cursor || cursor.origin !== this.options.origin || cursor.kingdomId !== kingdomId)) {
      throw new RaidObservationError('invalid', 'The pennant cursor is invalid for this archive.');
    }
    // The first row and lookahead come from one statement snapshot: no separate head read can admit a
    // later commit. Following pages use that same public ceiling and the last returned commit position.
    const result = await this.withClient(client => cursor
      ? client.query(`SELECT ${COLUMNS} FROM realm_raid_observations
        WHERE origin = $1 AND to_kingdom_id = $2 AND direction = 'incoming' AND sequence <= $3 AND sequence < $4
        ORDER BY realm_raid_observations.sequence DESC LIMIT $5`, [this.options.origin, kingdomId, cursor.ceiling, cursor.before, limit + 1])
      : client.query(`SELECT ${COLUMNS} FROM realm_raid_observations
        WHERE origin = $1 AND to_kingdom_id = $2 AND direction = 'incoming' ORDER BY realm_raid_observations.sequence DESC LIMIT $3`,
      [this.options.origin, kingdomId, limit + 1]));
    const rows = result.rows.map(readRow), items = rows.slice(0, limit);
    if (rows.some(row => row.observation.origin !== this.options.origin || row.observation.to.kingdomId !== kingdomId || row.observation.direction !== 'incoming')) {
      throw new RaidObservationError('storage', 'A pennant archive crossed its scope.');
    }
    const ceiling = cursor?.ceiling ?? rows[0]?.sequence;
    return RaidPennantArchivePageSchema.parse({ version: 1, origin: this.options.origin, kingdomId, asOf: this.options.clock(),
      items: items.map(row => ({ raidId: row.raid.id, from: row.observation.from, occurredAt: row.observation.occurredAt })),
      next: rows.length > limit ? `pennants:1:${this.options.origin}:${kingdomId}:${ceiling}:${items.at(-1)!.sequence}` : null });
  }

  recover(limit = 32): Promise<{ delivered: number; expired: number; waiting: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Promise.reject(new RaidObservationError('invalid', 'A recovery pass takes 1–100 raids.'));
    if (this.recovering) return this.recovering;
    const run = this.recoverBeats(limit).finally(() => { if (this.recovering === run) this.recovering = null; });
    this.recovering = run;
    return run;
  }

  private async recoverBeats(limit: number) {
    const now = this.options.clock();
    const found = await this.withClient(client => client.query(`SELECT event_id FROM realm_raid_observation_effects
      WHERE origin = $1 AND beat_state = 'pending' AND retry_at <= $2 ORDER BY retry_at, event_id COLLATE "C" LIMIT $3`, [this.options.origin, now, limit]));
    const report = { delivered: 0, expired: 0, waiting: 0 };
    for (const entry of found.rows as { event_id: string }[]) {
      const row = await this.withClient(client => client.query(`SELECT ${COLUMNS} FROM realm_raid_observations WHERE origin = $1 AND event_id = $2`, [this.options.origin, entry.event_id]));
      const record = readRow(row.rows[0]), observation = record.observation;
      if (this.options.clock() >= observation.occurredAt + RAID_BEAT_WINDOW_MS) {
        await this.setBeat(observation.id, 'expired'); report.expired++; continue;
      }
      const moment = RealmMomentObservationSchema.parse({ version: 1, id: observation.id, origin: observation.origin,
        kingdomId: observation.to.kingdomId, occurredAt: observation.occurredAt, receivedAt: observation.receivedAt,
        notice: { kind: 'raid', from: observation.from, viewers: Math.min(observation.viewers, 10_000_000) } });
      try {
        const reply = await this.options.moment(moment);
        if (reply.http !== 202 || !['accepted', 'duplicate'].includes(reply.body.status)) throw new Error('The raid beat was not acknowledged.');
        await this.setBeat(observation.id, 'complete'); report.delivered++;
      } catch {
        await this.withClient(client => client.query(`UPDATE realm_raid_observation_effects SET retry_at = $3
          WHERE origin = $1 AND event_id = $2 AND beat_state = 'pending'`, [this.options.origin, observation.id, this.options.clock() + 1_000]));
        report.waiting++;
      }
    }
    return report;
  }

  private async setBeat(id: string, state: 'expired' | 'complete') {
    await this.withClient(client => client.query(`UPDATE realm_raid_observation_effects SET beat_state = $3
      WHERE origin = $1 AND event_id = $2 AND beat_state = 'pending'`, [this.options.origin, id, state]));
  }
  private cursor(after: string | null): number {
    if (after === null) return 0;
    const match = /^(live|simulated):([1-9][0-9]{0,15})$/u.exec(after);
    const value = match ? Number(match[2]) : NaN;
    if (!match || match[1] !== this.options.origin || !Number.isSafeInteger(value)) throw new RaidObservationError('invalid', 'The road cursor is invalid for this feed.');
    return value;
  }
  private async withClient<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect();
    try { return await work(client); } finally { client.release(); }
  }
}
