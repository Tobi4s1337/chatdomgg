import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from '../../../../packages/shared/src/identity';
import {
  CrierModeSchema, RAID_CRIER_ALLOWED_LIVE_KINGDOM, RAID_CRIER_LIFETIME_MS,
  RaidCrierClaimRequestSchema, RaidCrierClaimSchema, RaidCrierOutcomeSchema, RaidCrierReceiptSchema, RaidCrierSettingSchema,
  type CrierMode, type RaidCrierClaim, type RaidCrierOutcome, type RaidCrierSetting,
} from '../../../api/src/raid-gate/crier-contracts';
import { RaidObservationSchema, type RaidObservation } from '../../../api/src/raid-gate/observations';
import { raidWelcomePath } from '../../../api/src/raid-gate/guest-contracts';
import { serializable, type SqlClient, type SqlPool } from '../../../api/src/raid-gate/postgres-repository';

const OWN = new AbortController().signal;
const OriginSchema = z.enum(['live', 'simulated']);
const IntegerText = z.string().regex(/^(0|[1-9][0-9]*)$/u).refine(value => Number.isSafeInteger(Number(value)));
const JobRowSchema = z.strictObject({ origin: OriginSchema, event_id: z.string(), raid_id: z.string(), kingdom_id: KingdomIdSchema,
  occurred_ms: IntegerText, state: z.enum(['queued', 'claimed', 'sent', 'refused', 'unknown', 'expired', 'suppressed']),
  claim_id: z.uuid().nullable(), sender_id: z.string().nullable(), claimed_ms: IntegerText.nullable(), claim: z.string().nullable(),
  outcome: z.string().nullable(), observation: z.string() });
const COLUMNS = 'j.origin, j.event_id, j.raid_id, j.kingdom_id, j.occurred_ms::text AS occurred_ms, j.state, j.claim_id, j.sender_id, j.claimed_ms::text AS claimed_ms, j.claim, j.outcome, o.observation';
const JOIN = 'realm_raid_crier_jobs j JOIN realm_raid_observations o ON o.origin = j.origin AND o.event_id = j.event_id';
const raidId = (id: string) => `raid.${createHash('sha256').update(id, 'utf8').digest('hex')}`;

export class CrierError extends Error {
  constructor(readonly kind: 'invalid' | 'origin' | 'conflict' | 'storage', message: string, options?: ErrorOptions) { super(message, options); this.name = 'CrierError'; }
}
export interface RaidCrierAuthorityOptions {
  readonly pool: SqlPool;
  readonly origin: 'live' | 'simulated';
  readonly publicOrigin: string;
  readonly clock: () => number;
}

function invalid<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CrierError('invalid', 'The crier request is malformed.');
  return result.data;
}
function stored<T>(read: () => T): T {
  try { return read(); } catch { throw new CrierError('storage', 'Stored crier data failed its reader.'); }
}
function readJob(raw: unknown) {
  return stored(() => {
    const row = JobRowSchema.parse(raw);
    const observation = RaidObservationSchema.parse(JSON.parse(row.observation));
    const claim = row.claim === null ? null : RaidCrierClaimSchema.parse(JSON.parse(row.claim));
    const outcome = row.outcome === null ? null : RaidCrierOutcomeSchema.parse(JSON.parse(row.outcome));
    const attempted = ['claimed', 'sent', 'refused', 'unknown'].includes(row.state);
    if (observation.origin !== row.origin || observation.id !== row.event_id || observation.direction !== 'incoming'
      || observation.viewers < 3 || observation.kingdomId !== row.kingdom_id || observation.occurredAt !== Number(row.occurred_ms)
      || raidId(observation.id) !== row.raid_id || attempted !== (claim !== null)
      || (claim === null && (row.claim_id !== null || row.sender_id !== null || row.claimed_ms !== null || outcome !== null))
      || (claim !== null && (claim.origin !== row.origin || claim.claimId !== row.claim_id || claim.senderId !== row.sender_id
        || String(claim.senderId) === row.kingdom_id || claim.kingdomId !== row.kingdom_id || claim.raidId !== row.raid_id
        || row.claimed_ms === null || claim.expiresAt !== Math.min(observation.occurredAt + RAID_CRIER_LIFETIME_MS, Number(row.claimed_ms) + 5_000)))
      || (row.state === 'claimed' && outcome !== null)
      || (row.state === 'sent' && outcome?.status !== 'sent') || (row.state === 'refused' && outcome?.status !== 'refused')
      || (row.state === 'unknown' && outcome !== null && outcome.status !== 'unknown')) throw new Error();
    return { ...row, observation, claim, outcome };
  });
}

async function lockHead(client: SqlClient, origin: 'live' | 'simulated') {
  const result = await client.query('UPDATE realm_raid_crier_heads SET origin = origin WHERE origin = $1 RETURNING origin', [origin]);
  stored(() => { if (z.strictObject({ origin: OriginSchema }).parse(result.rows[0]).origin !== origin) throw new Error(); });
}
async function readSetting(client: SqlClient, origin: 'live' | 'simulated', kingdomId: string): Promise<RaidCrierSetting> {
  const result = await client.query('SELECT origin, kingdom_id, revision::text AS revision, mode FROM realm_raid_crier_settings WHERE origin = $1 AND kingdom_id = $2 FOR UPDATE', [origin, kingdomId]);
  if (!result.rows.length) return RaidCrierSettingSchema.parse({ version: 1, origin, kingdomId, revision: 0, mode: 'rare' });
  return stored(() => {
    const row = z.strictObject({ origin: OriginSchema, kingdom_id: KingdomIdSchema, revision: IntegerText, mode: CrierModeSchema }).parse(result.rows[0]);
    if (row.origin !== origin || row.kingdom_id !== kingdomId || Number(row.revision) < 1) throw new Error();
    return RaidCrierSettingSchema.parse({ version: 1, origin: row.origin, kingdomId: row.kingdom_id, revision: Number(row.revision), mode: row.mode });
  });
}

/** Called inside the observation transaction. A silent interval cannot be replayed when the crier is enabled. */
export async function queueRaidWelcome(client: SqlClient, raw: RaidObservation): Promise<void> {
  const observation = invalid(RaidObservationSchema, raw);
  if (observation.direction !== 'incoming' || observation.viewers < 3) return;
  await lockHead(client, observation.origin);
  const setting = await readSetting(client, observation.origin, observation.kingdomId);
  await client.query(`INSERT INTO realm_raid_crier_jobs (origin, event_id, raid_id, kingdom_id, occurred_ms, state)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (origin, event_id) DO NOTHING`,
  [observation.origin, observation.id, raidId(observation.id), observation.kingdomId, observation.occurredAt,
    setting.mode === 'silent' ? 'suppressed' : 'queued']);
}

/** One durable attempt per witnessed incoming raid. Claims are never reclaimed, even after an uncertain reply. */
export class RaidCrierAuthority {
  private readonly publicOrigin: string;
  private recovering: Promise<{ expired: number; unknown: number }> | null = null;
  constructor(readonly options: RaidCrierAuthorityOptions) {
    invalid(OriginSchema, options.origin);
    try {
      const url = new URL(options.publicOrigin);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      this.publicOrigin = url.origin;
    } catch { throw new CrierError('invalid', 'The crier needs a public HTTPS origin, or loopback HTTP for development.'); }
  }

  async claim(raw: unknown): Promise<RaidCrierClaim | null> {
    const request = invalid(RaidCrierClaimRequestSchema, raw);
    this.origin(request.origin);
    if (String(request.senderId) === request.kingdomId) throw new CrierError('invalid', 'The crier must speak as the bot account.');
    if (request.origin === 'live' && request.kingdomId !== RAID_CRIER_ALLOWED_LIVE_KINGDOM) throw new CrierError('origin', 'This kingdom is not enabled for live crier writes.');
    return this.transaction(async client => {
      await lockHead(client, request.origin);
      const now = this.now();
      await this.age(client, now);
      const setting = await readSetting(client, request.origin, request.kingdomId);
      if (setting.mode === 'silent') {
        await this.suppress(client, request.kingdomId);
        return null;
      }
      // All attempts count, including refused and unknown sends; kingdom limits span bot identities.
      // Five extra seconds reserve dispatch headroom before the nominal Twitch and kingdom windows.
      const budget = await client.query(`SELECT
        count(*) FILTER (WHERE sender_id = $3 AND claimed_ms > $2::bigint - 35000)::text AS global_count,
        count(*) FILTER (WHERE kingdom_id = $4 AND claimed_ms > $2::bigint - 3605000)::text AS kingdom_count,
        count(*) FILTER (WHERE kingdom_id = $4 AND claimed_ms > $2::bigint - 65000)::text AS minute_count
        FROM realm_raid_crier_jobs WHERE origin = $1 AND claimed_ms > $2::bigint - 3605000`,
      [request.origin, now, request.senderId, request.kingdomId]);
      const counts = stored(() => z.strictObject({ global_count: IntegerText, kingdom_count: IntegerText, minute_count: IntegerText }).parse(budget.rows[0]));
      if (Number(counts.global_count) >= 20 || Number(counts.kingdom_count) >= 6 || Number(counts.minute_count) > 0) return null;
      const found = await client.query(`SELECT ${COLUMNS} FROM ${JOIN} WHERE j.origin = $1 AND j.kingdom_id = $2
        AND j.state = 'queued' ORDER BY j.occurred_ms, j.event_id COLLATE "C" LIMIT 1 FOR UPDATE OF j`, [request.origin, request.kingdomId]);
      if (!found.rows.length) return null;
      const job = readJob(found.rows[0]);
      if (job.origin !== request.origin || job.kingdom_id !== request.kingdomId || job.state !== 'queued') throw new CrierError('storage', 'The crier selected a different job.');
      const text = `Welcome, ${job.observation.from.name} and raiders! Walk into the kingdom: ${this.publicOrigin}${raidWelcomePath(request.kingdomId, job.raid_id)}`;
      const parsed = RaidCrierClaimSchema.safeParse({ version: 1, origin: request.origin, claimId: randomUUID(), raidId: job.raid_id,
        kingdomId: request.kingdomId, senderId: request.senderId, expiresAt: Math.min(job.observation.occurredAt + RAID_CRIER_LIFETIME_MS, now + 5_000), text });
      if (!parsed.success) {
        await client.query("UPDATE realm_raid_crier_jobs SET state = 'suppressed' WHERE origin = $1 AND event_id = $2 AND state = 'queued'", [request.origin, job.event_id]);
        return null;
      }
      const claim = parsed.data;
      const changed = await client.query(`UPDATE realm_raid_crier_jobs SET state = 'claimed', claim_id = $3, sender_id = $4, claimed_ms = $5, claim = $6
        WHERE origin = $1 AND event_id = $2 AND state = 'queued'`, [request.origin, job.event_id, claim.claimId, claim.senderId, now, JSON.stringify(claim)]);
      if (changed.rowCount !== 1) throw new CrierError('storage', 'The crier could not durably claim its job.');
      return claim;
    });
  }

  async receipt(raw: unknown): Promise<'accepted' | 'duplicate'> {
    const input = invalid(RaidCrierReceiptSchema, raw);
    this.origin(input.origin);
    return this.transaction(async client => {
      await lockHead(client, input.origin);
      const found = await client.query(`SELECT ${COLUMNS} FROM ${JOIN} WHERE j.origin = $1 AND j.claim_id = $2 FOR UPDATE OF j`, [input.origin, input.claimId]);
      if (!found.rows.length) throw new CrierError('conflict', 'The crier claim does not exist.');
      const job = readJob(found.rows[0]);
      if (!job.claim || job.claim.origin !== input.origin || job.claim.kingdomId !== input.kingdomId || job.claim.senderId !== input.senderId) {
        throw new CrierError('conflict', 'The receipt does not own this crier claim.');
      }
      if (job.outcome && sameOutcome(job.outcome, input.outcome)) return 'duplicate';
      if (job.state !== 'claimed' && !(job.state === 'unknown' && input.outcome.status === 'sent')
        && !(job.state === 'unknown' && job.outcome === null && ['unknown', 'refused'].includes(input.outcome.status))) {
        throw new CrierError('conflict', 'The crier claim already has a different final receipt.');
      }
      await client.query('UPDATE realm_raid_crier_jobs SET state = $3, outcome = $4 WHERE origin = $1 AND event_id = $2',
        [input.origin, job.event_id, input.outcome.status, JSON.stringify(input.outcome)]);
      return 'accepted';
    });
  }

  /** Aging is independent of polling for work; it never makes a previous attempt eligible again. */
  recover(): Promise<{ expired: number; unknown: number }> {
    if (this.recovering) return this.recovering;
    const run = this.transaction(async client => {
      await lockHead(client, this.options.origin);
      return this.age(client, this.now());
    }).finally(() => { if (this.recovering === run) this.recovering = null; });
    this.recovering = run;
    return run;
  }

  async setting(rawKingdomId: unknown): Promise<RaidCrierSetting> {
    const kingdomId = invalid(KingdomIdSchema, rawKingdomId);
    return this.transaction(async client => readSetting(client, this.options.origin, kingdomId));
  }

  async configure(rawKingdomId: unknown, rawMode: unknown, rawExpectedRevision: unknown): Promise<RaidCrierSetting> {
    const kingdomId = invalid(KingdomIdSchema, rawKingdomId), mode = invalid(CrierModeSchema, rawMode);
    const expectedRevision = invalid(RaidCrierSettingSchema.shape.revision, rawExpectedRevision);
    return this.transaction(async client => {
      await lockHead(client, this.options.origin);
      const current = await readSetting(client, this.options.origin, kingdomId);
      if (current.revision !== expectedRevision) throw new CrierError('conflict', 'The crier setting changed.');
      const next = invalid(RaidCrierSettingSchema, { ...current, mode, revision: current.revision + 1 });
      const changed = await client.query(`INSERT INTO realm_raid_crier_settings (origin, kingdom_id, revision, mode) VALUES ($1,$2,$3,$4)
        ON CONFLICT (origin, kingdom_id) DO UPDATE SET revision = EXCLUDED.revision, mode = EXCLUDED.mode
        WHERE realm_raid_crier_settings.revision = $5`, [next.origin, kingdomId, next.revision, mode, expectedRevision]);
      if (changed.rowCount !== 1) throw new CrierError('conflict', 'The crier setting changed.');
      if (mode === 'silent') await this.suppress(client, kingdomId);
      return next;
    });
  }

  private async age(client: SqlClient, now: number): Promise<{ expired: number; unknown: number }> {
    const expired = await client.query(`UPDATE realm_raid_crier_jobs SET state = 'expired'
      WHERE origin = $1 AND state = 'queued' AND occurred_ms <= $2`, [this.options.origin, now - RAID_CRIER_LIFETIME_MS]);
    const unknown = await client.query(`UPDATE realm_raid_crier_jobs SET state = 'unknown'
      WHERE origin = $1 AND state = 'claimed' AND claimed_ms <= $2`, [this.options.origin, now - 15_000]);
    return stored(() => z.strictObject({ expired: z.number().int().min(0), unknown: z.number().int().min(0) })
      .parse({ expired: expired.rowCount, unknown: unknown.rowCount }));
  }
  private suppress(client: SqlClient, kingdomId: string) {
    return client.query("UPDATE realm_raid_crier_jobs SET state = 'suppressed' WHERE origin = $1 AND kingdom_id = $2 AND state = 'queued'", [this.options.origin, kingdomId]);
  }
  private origin(origin: 'live' | 'simulated') {
    if (origin !== this.options.origin) throw new CrierError('origin', 'The crier request belongs to another origin.');
  }
  private now(): number { return invalid(EpochMsSchema, this.options.clock()); }
  private async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    try { return await serializable(this.options.pool, client => client, work, OWN); }
    catch (error) { if (error instanceof CrierError) throw error; throw new CrierError('storage', 'The crier transaction could not be stored.', { cause: error }); }
  }
}
function sameOutcome(a: RaidCrierOutcome, b: RaidCrierOutcome): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export type { CrierMode, RaidCrierSetting };
