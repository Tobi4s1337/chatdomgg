import { KingdomIdSchema } from '@chatdom/shared';
import type { RealmPublicMessage, RealmWriterLease } from '@chatdom/shared/realm';
import { MOMENT_FACT_TYPE, MOMENT_MESSAGE_BYTES, TwitchMomentFactSchema, type TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import type pg from 'pg';
import type { MomentRecordPort, MomentRecordTransaction } from '../../../herald/src/twitch-moments/ports';
import { CurrentIndexSchema, ForwardRecordSchema, GiftGroupRecordSchema, GifterWindowRecordSchema, SubscriberRecordSchema,
  WatermarkSchema, WrappingRecordSchema, momentRepository } from '../../../herald/src/twitch-moments/records';
import { RealmCommitUncertainError, RealmStorageUnavailableError, RealmWriterFencedError, type RealmDatabase } from '../persistence/database';

const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const KEY = /^twitch-moments:([a-z-]+)(?::([A-Za-z0-9_.:-]{1,160}))?$/u;
// The bounded private gift ledger can contain 100,000 recipients. Public facts remain capped at 256 KiB.
const RECORD_BYTES = 32 * 1024 * 1024;

/**
 * A writer-scoped durable binding for Herald's normalized moment repository. The kingdom row lock orders it
 * against domain writes and writer takeovers. Delivery claims, domain state, current state, facts and outbox
 * either all commit or all roll back; the separate moment head never changes the realm domain sequence.
 */
export function createPostgresMomentRecords(db: RealmDatabase, lease: RealmWriterLease, origin: 'live' | 'simulated', current: () => boolean): MomentRecordPort {
  KingdomIdSchema.parse(lease.kingdomId);
  return {
    async transact<T>(kingdomId: typeof lease.kingdomId, work: (tx: MomentRecordTransaction) => Promise<T>): Promise<T> {
      if (kingdomId !== lease.kingdomId || !current()) throw new RealmWriterFencedError(kingdomId);
      let sql: pg.PoolClient;
      try { sql = await db.connect(); }
      catch { throw new RealmStorageUnavailableError('The moment database is unavailable.'); }
      let phase: 'open' | 'committing' | 'committed' = 'open', active = true;
      try {
        await sql.query('BEGIN');
        const fence = (await sql.query<{ origin: string; mine: boolean; sequence: string }>(
          `SELECT origin, sequence, (writer_epoch = $2 AND lease_expires_ms > ${NOW_MS}) IS TRUE AS mine
           FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE`, [kingdomId, lease.epoch])).rows[0];
        if (!fence?.mine || fence.origin !== origin || !current()) throw new RealmWriterFencedError(kingdomId);
        await sql.query('INSERT INTO realm_moment_heads (kingdom_id) VALUES ($1) ON CONFLICT DO NOTHING', [kingdomId]);
        let seq = Number((await sql.query<{ sequence: string }>('SELECT sequence FROM realm_moment_heads WHERE kingdom_id = $1', [kingdomId])).rows[0]!.sequence);
        const facts: TwitchMomentFact[] = [];
        const check = () => { if (!active) throw new Error('Moment transaction has ended'); };
        const normalize = (key: string, value: unknown) => normalizedRecord(key, value, kingdomId, origin);
        const tx: MomentRecordTransaction = {
          async get(key) {
            check(); recordKey(key);
            const row = (await sql.query<{ value: string }>('SELECT value FROM realm_moment_values WHERE kingdom_id = $1 AND record_key = $2', [kingdomId, key])).rows[0];
            return row ? normalize(key, JSON.parse(row.value)) : undefined;
          },
          async put(key, value) {
            check();
            const parsed = normalize(key, value);
            if (recordKey(key).family === 'delivery' || recordKey(key).family === 'observation') throw new TypeError('Claims use claim()');
            const encoded = boundedJson(parsed, RECORD_BYTES);
            await sql.query(`INSERT INTO realm_moment_values (kingdom_id, record_key, value) VALUES ($1, $2, $3)
              ON CONFLICT (kingdom_id, record_key) DO UPDATE SET value = excluded.value`, [kingdomId, key, encoded]);
          },
          async claim(key) {
            check(); const { family, id } = recordKey(key);
            if (!id || (family !== 'delivery' && family !== 'observation')) throw new TypeError('Only delivery and observation keys are claims');
            const claimed = await sql.query('INSERT INTO realm_moment_values (kingdom_id, record_key, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [kingdomId, key, 'true']);
            return claimed.rowCount === 1;
          },
          async appendFact(body, clocks, cause, factOrigin) {
            check();
            if (factOrigin !== origin) throw new TypeError('Moment origin must match its writer');
            if (facts.length >= 1024 || !Number.isSafeInteger(seq + 1)) throw new RangeError('Moment transaction exceeds its fact budget');
            const next = ++seq;
            const now = Number((await sql.query<{ now: string }>(`SELECT ${NOW_MS} AS now`)).rows[0]!.now);
            const fact = TwitchMomentFactSchema.parse({ version: 1, kingdomId, seq: next, occurredAt: clocks.occurredAt, receivedAt: clocks.receivedAt,
              committedAt: now, origin, type: MOMENT_FACT_TYPE, actor: null, body, cause });
            const encoded = boundedJson(fact, MOMENT_MESSAGE_BYTES);
            await sql.query('INSERT INTO realm_moment_facts (kingdom_id, seq, writer_epoch, fact, committed_ms) VALUES ($1, $2, $3, $4, $5)',
              [kingdomId, fact.seq, lease.epoch, encoded, now]);
            facts.push(fact);
            return structuredClone(fact);
          },
        };
        const result = await work(tx);
        const repository = momentRepository(tx);
        if (facts.length) await repository.putWatermark(seq);
        const currentFacts = new Set((await repository.currentFacts()).map(f => f.seq));
        for (const fact of facts.sort((a, b) => a.seq - b.seq)) {
          const message: RealmPublicMessage = { type: 'moment', fact, current: currentFacts.has(fact.seq) };
          await sql.query(`INSERT INTO realm_outbox (kingdom_id, sequence, event_id, kind, plot_id, message, created_ms)
            VALUES ($1, $2, $3, 'moment', NULL, $4, $5)`, [kingdomId, fence.sequence, `${kingdomId}:m:${fact.seq}`, boundedJson(message, MOMENT_MESSAGE_BYTES), fact.committedAt]);
        }
        await sql.query('UPDATE realm_moment_heads SET sequence = $2 WHERE kingdom_id = $1', [kingdomId, seq]);
        active = false;
        // Last SQL before COMMIT. A takeover requires this same row lock; expiry uses authoritative DB time.
        const final = await sql.query(`SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND writer_epoch = $2
          AND lease_expires_ms > ${NOW_MS} AND origin = $3 AND sequence = $4`, [kingdomId, lease.epoch, origin, fence.sequence]);
        if (final.rowCount !== 1 || !current()) throw new RealmWriterFencedError(kingdomId);
        phase = 'committing';
        await sql.query('COMMIT');
        phase = 'committed';
        return result;
      } catch (error) {
        if (phase === 'committing') throw new RealmCommitUncertainError(kingdomId, 'twitch-moments');
        await sql.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { active = false; sql.release(phase === 'committing' ? true : undefined); }
    },
  };
}

function recordKey(key: string): { family: string; id: string | undefined } {
  const match = KEY.exec(key);
  if (!match) throw new TypeError('Record key escapes the twitch-moments namespace');
  return { family: match[1]!, id: match[2] };
}

/** Strict record schemas are the only storage entrance: extra provider fields are rejected, never serialized. */
function normalizedRecord(key: string, value: unknown, kingdomId: string, origin: string): unknown {
  const { family, id } = recordKey(key);
  switch (family) {
    case 'delivery': case 'observation':
      if (!id || value !== true) break;
      return true;
    case 'subscriber': { const r = SubscriberRecordSchema.parse(value); if (id === r.personId) return r; break; }
    case 'gift-group': { const r = GiftGroupRecordSchema.parse(value); if (id === r.groupKey) return r; break; }
    case 'wrapping': { const r = WrappingRecordSchema.parse(value); if (id === `${r.personId}:${r.groupKey}`) return r; break; }
    case 'forward': { const r = ForwardRecordSchema.parse(value); if (id === r.giverId) return r; break; }
    case 'gifter-window': { const r = GifterWindowRecordSchema.parse(value); if (id === r.giverId) return r; break; }
    case 'current-index': if (id === undefined) return CurrentIndexSchema.parse(value); break;
    case 'watermark': if (id === undefined) return WatermarkSchema.parse(value); break;
    case 'current': {
      const r = TwitchMomentFactSchema.parse(value);
      if (id === r.body.key && r.kingdomId === kingdomId && r.origin === origin) return r;
      break;
    }
  }
  throw new TypeError('Unknown or mismatched normalized moment record');
}

function boundedJson(value: unknown, limit: number): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > limit) throw new RangeError('Moment record exceeds its JSON budget');
  return encoded;
}
