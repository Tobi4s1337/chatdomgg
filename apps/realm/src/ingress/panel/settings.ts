import type { PoolClient } from 'pg';
import { z } from 'zod';
import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '@chatdom/shared';
import type { RealmWriterLease } from '@chatdom/shared/realm';
import type { PanelSettings, PanelSettingsReading } from '../../../../../packages/shared/src/panel';
import { DEFAULT_SETTINGS, parsePanelSettings } from '../../../../panel/src/settings/schema';
import { RealmCommitUncertainError, RealmWriterFencedError,
  type DurableKingdom, type DurableRealmServices, type RealmDatabase } from '../../persistence';

type Sql = Pick<PoolClient, 'query'>;
type Origin = 'live' | 'simulated';
export interface RealmPanelSettingsOptions {
  readonly db: RealmDatabase;
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly origin: Origin;
}
export type PanelSettingsBody = PanelSettingsReading
  | { readonly version: 1; readonly status: 'conflict'; readonly current: PanelSettingsReading }
  | { readonly version: 1; readonly status: 'refused' | 'unavailable'; readonly message: string };
export interface PanelSettingsReply { readonly http: 200 | 400 | 503; readonly body: PanelSettingsBody }
export interface PanelWriterContext {
  readonly sql: Sql;
  readonly kingdom: DurableKingdom;
  readonly lease: RealmWriterLease;
  readonly now: number;
  current(): boolean;
}
export class MissingPanelKingdom extends Error {}
class KingdomWasFounded extends Error {}
const NOW = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const MAX_PENDING = 32;
const Request = z.strictObject({ kingdomId: KingdomIdSchema });
const Revision = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) < 9_223_372_036_854_775_807n);
const Save = Request.extend({ personId: PersonIdSchema, expectedRevision: Revision, settings: z.unknown() });

/** A missing row is the only default. Corrupt or unsupported persisted preferences close the door. */
export async function readPanelSettings(sql: Sql, origin: Origin, kingdomId: KingdomId, connected: boolean): Promise<PanelSettingsReading> {
  const row = (await sql.query<{ revision: string; settings: string }>(
    'SELECT revision::text, settings FROM realm_panel_settings WHERE origin = $1 AND kingdom_id = $2', [origin, kingdomId])).rows[0];
  const settings = row ? parsePanelSettings(JSON.parse(row.settings) as unknown) : parsePanelSettings(DEFAULT_SETTINGS);
  if (!settings || row && (!/^[1-9][0-9]{0,18}$/.test(row.revision) || BigInt(row.revision) > 9_223_372_036_854_775_807n)) {
    throw new Error('The saved panel settings cannot be read.');
  }
  return { version: 1, status: 'settings', revision: row?.revision ?? '0', settings, connected };
}

/** Gifts and unfounded saves take this same lock; a hash collision only delays an unrelated channel. */
async function lockSettings(sql: Sql, origin: Origin, kingdomId: KingdomId): Promise<void> {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`panel-settings:${origin}:${kingdomId}`]);
}

/** One existing realm writer queue and fence for both Hide and gift commits. No parallel world writer. */
export async function withPanelKingdom<T>(options: RealmPanelSettingsOptions, kingdomId: KingdomId,
  work: (ctx: PanelWriterContext) => Promise<T>): Promise<T> {
  const exists = await options.db.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdomId, options.origin]);
  if (!exists.rowCount) throw new MissingPanelKingdom();
  const hold = await options.services.retain(kingdomId);
  try {
    const kingdom = hold.kingdom;
    if (!kingdom.current || kingdom.origin !== options.origin) throw new RealmWriterFencedError(kingdomId);
    return await kingdom.writeMoments(async (lease, current) => {
      const sql = await options.db.connect(); let committing = false;
      try {
        await sql.query('BEGIN');
        const fence = (await sql.query<{ now: string; sequence: string; mine: boolean }>(`SELECT ${NOW} AS now, sequence,
          (writer_epoch = $2 AND lease_expires_ms > ${NOW} AND origin = $3) IS TRUE AS mine
          FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE`, [kingdomId, lease.epoch, options.origin])).rows[0];
        if (!fence?.mine || !current() || Number(fence.sequence) !== kingdom.sequence) throw new RealmWriterFencedError(kingdomId);
        // Lock order is always the kingdom writer row, then settings. The unfounded path never locks a writer row.
        await lockSettings(sql, options.origin, kingdomId);
        const result = await work({ sql, kingdom, lease, now: Number(fence.now), current });
        const final = await sql.query(`SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND writer_epoch = $2
          AND lease_expires_ms > ${NOW} AND origin = $3 AND sequence = $4`, [kingdomId, lease.epoch, options.origin, fence.sequence]);
        if (final.rowCount !== 1 || !current()) throw new RealmWriterFencedError(kingdomId);
        committing = true; await sql.query('COMMIT'); committing = false;
        return result;
      } catch (error) {
        if (committing) throw new RealmCommitUncertainError(kingdomId, 'panel-write');
        await sql.query('ROLLBACK').catch(() => {}); throw error;
      } finally { sql.release(committing ? true : undefined); }
    });
  } finally { await hold.release(); }
}

export class RealmPanelSettings {
  private pending = 0;
  constructor(private readonly options: RealmPanelSettingsOptions) {}

  async read(raw: unknown): Promise<PanelSettingsReply> {
    const parsed = Request.safeParse(raw); if (!parsed.success) return invalid();
    try {
      const { kingdomId } = parsed.data;
      const exists = await this.options.db.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.options.origin]);
      if (!exists.rowCount) return ok(await readPanelSettings(this.options.db, this.options.origin, kingdomId, false));
      // Actual local authority, including resting kingdoms. A preference cannot claim this connection exists.
      const hold = await this.options.services.retain(kingdomId);
      try {
        if (!hold.kingdom.current || hold.kingdom.origin !== this.options.origin) return unavailable();
        const reading = await readPanelSettings(this.options.db, this.options.origin, kingdomId, true);
        if (!hold.kingdom.current) return unavailable();
        return ok(reading);
      } finally { await hold.release(); }
    } catch { return unavailable(); }
  }

  async save(raw: unknown): Promise<PanelSettingsReply> {
    const parsed = Save.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data, settings = parsePanelSettings(input.settings);
    if (String(input.personId) !== String(input.kingdomId) || !settings) return invalid();
    if (this.pending >= MAX_PENDING) return unavailable();
    this.pending++;
    const save = (sql: Sql, connected: boolean) => this.compareAndSave(sql, input.kingdomId, input.expectedRevision, settings, connected);
    try {
      try { return await withPanelKingdom(this.options, input.kingdomId, ctx => save(ctx.sql, true)); }
      catch (error) { if (!(error instanceof MissingPanelKingdom)) throw error; }
      try { return await this.beforeFounding(input.kingdomId, sql => save(sql, false)); }
      catch (error) {
        if (!(error instanceof KingdomWasFounded)) throw error;
        return await withPanelKingdom(this.options, input.kingdomId, ctx => save(ctx.sql, true));
      }
    } catch {
      // An uncertain COMMIT is never a fabricated success. A new read tells the page the actual revision.
      return unavailable();
    } finally { this.pending--; }
  }

  private async compareAndSave(sql: Sql, kingdomId: KingdomId, expected: string, settings: PanelSettings, connected: boolean): Promise<PanelSettingsReply> {
    const current = await readPanelSettings(sql, this.options.origin, kingdomId, connected);
    if (current.revision !== expected) return ok({ version: 1, status: 'conflict', current });
    const result = await sql.query<{ revision: string }>(`INSERT INTO realm_panel_settings (origin, kingdom_id, revision, settings, updated_ms)
      VALUES ($1,$2,1,$3,${NOW}) ON CONFLICT (origin, kingdom_id) DO UPDATE
      SET revision = realm_panel_settings.revision + 1, settings = excluded.settings, updated_ms = excluded.updated_ms
      WHERE realm_panel_settings.revision = $4::bigint RETURNING revision::text`,
    [this.options.origin, kingdomId, JSON.stringify(settings), expected]);
    if (!result.rows[0]) return ok({ version: 1, status: 'conflict', current: await readPanelSettings(sql, this.options.origin, kingdomId, connected) });
    return ok({ version: 1, status: 'settings', revision: result.rows[0].revision, settings, connected });
  }

  private async beforeFounding<T>(kingdomId: KingdomId, work: (sql: Sql) => Promise<T>): Promise<T> {
    const sql = await this.options.db.connect(); let committing = false;
    try {
      await sql.query('BEGIN');
      await lockSettings(sql, this.options.origin, kingdomId);
      // Never retain or lock a writer here. If founding won, release this lock and join its existing queue.
      if ((await sql.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.options.origin])).rowCount) throw new KingdomWasFounded();
      const result = await work(sql);
      committing = true; await sql.query('COMMIT'); committing = false;
      return result;
    } catch (error) {
      if (committing) throw new RealmCommitUncertainError(kingdomId, 'panel-settings');
      await sql.query('ROLLBACK').catch(() => {}); throw error;
    } finally { sql.release(committing ? true : undefined); }
  }
}
const ok = (body: PanelSettingsBody): PanelSettingsReply => ({ http: 200, body });
const invalid = (): PanelSettingsReply => ({ http: 400, body: { version: 1, status: 'refused', message: 'Only the broadcaster can save valid panel settings.' } });
const unavailable = (): PanelSettingsReply => ({ http: 503, body: { version: 1, status: 'unavailable', message: 'The panel settings are out of reach. Try again shortly.' } });
