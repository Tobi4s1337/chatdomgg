import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import type { PanelSettingsReading, PanelSettingsSync } from '../../../../../packages/shared/src/panel';
import type { RealmDatabase } from '../../persistence';

type Sql = Pick<PoolClient, 'query'>;
type Origin = 'live' | 'simulated';
export const PANEL_MIRROR_LEASE_MS = 30_000;
export const PANEL_MIRROR_INTERVAL_MS = 6_500;
export const PANEL_MIRROR_AUDIT_MS = 60_000;
export const PANEL_MIRROR_HTTP_INTERVAL_MS = 3_100;
const NOW = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const Extension = z.strictObject({ extensionId: z.string().regex(/^[a-zA-Z0-9]{1,100}$/) });
const Channel = Extension.extend({ kingdomId: KingdomIdSchema });
const Binding = Extension.extend({ bindingId: z.uuid() });
const Permit = Channel.extend({ bindingId: z.uuid(), claimId: z.uuid() });
const Finish = Permit.extend({ content: z.string().max(3072).optional() });

/** The only public segment representation. No identity, credentials, or worker state enters it. */
export function panelMirrorContent(reading: PanelSettingsReading): string {
  const content = JSON.stringify({ version: 1, status: 'settings', revision: reading.revision,
    settings: reading.settings, connected: reading.connected });
  if (Buffer.byteLength(content, 'utf8') > 3072) throw new Error('Panel configuration exceeds its budget.');
  return content;
}

/** Called inside the very same transaction as a preference save. Preserve any running lease. */
export async function dirtyPanelMirror(sql: Sql, origin: Origin, kingdomId: KingdomId): Promise<void> {
  await sql.query(`INSERT INTO realm_panel_settings_mirror (origin, kingdom_id) VALUES ($1,$2)
    ON CONFLICT (origin, kingdom_id) DO UPDATE SET verified_content = NULL, verified_ms = NULL,
      next_attempt_ms = LEAST(realm_panel_settings_mirror.next_attempt_ms, ${NOW}), attempts = 0`, [origin, kingdomId]);
}

export async function ensurePanelMirror(sql: Sql, origin: Origin, kingdomId: KingdomId): Promise<void> {
  await sql.query('INSERT INTO realm_panel_settings_mirror (origin, kingdom_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [origin, kingdomId]);
}

export type PanelMirrorBody = PanelSettingsSync
  | { readonly version: 1; readonly status: 'activated'; readonly bindingId: string }
  | { readonly version: 1; readonly status: 'claimed'; readonly kingdomId: KingdomId; readonly claimId: string; readonly reading: PanelSettingsReading }
  | { readonly version: 1; readonly status: 'idle' | 'finished' | 'fenced'; readonly publication?: 'pending' | 'verified' }
  | { readonly version: 1; readonly status: 'permit'; readonly allowed: boolean; readonly retryAfterMs: number }
  | { readonly version: 1; readonly status: 'unavailable' | 'refused'; readonly message: string };
export interface PanelMirrorReply { readonly http: 200 | 400 | 503; readonly body: PanelMirrorBody }
export interface PanelMirrorOptions {
  readonly db: RealmDatabase;
  readonly origin: Origin;
  /** Current realm authority plus the settings lock; never a transaction around external HTTP. */
  readonly withReading: <T>(id: KingdomId, work: (sql: Sql, reading: PanelSettingsReading) => Promise<T>) => Promise<T>;
}

/** Durable claim tokens fence completion across processes, crashes, and expired requests. */
export class RealmPanelMirror {
  constructor(private readonly options: PanelMirrorOptions) {}

  /** Trusted publisher startup is the deployment's active Extension binding. Never browser supplied. */
  async activate(raw: unknown): Promise<PanelMirrorReply> {
    const input = Extension.safeParse(raw); if (!input.success) return refused();
    try {
      const row = (await this.options.db.query<{ binding_id: string }>(`UPDATE realm_panel_settings_mirror_quota
        SET extension_id = $2, binding_id = CASE WHEN extension_id = $2 THEN binding_id ELSE $3::uuid END
        WHERE origin = $1 RETURNING binding_id`, [this.options.origin, input.data.extensionId, randomUUID()])).rows[0];
      return row ? ok({ version: 1, status: 'activated', bindingId: row.binding_id }) : unavailable();
    } catch { return unavailable(); }
  }

  async sync(raw: unknown): Promise<PanelMirrorReply> {
    const input = Channel.safeParse(raw); if (!input.success) return refused();
    try {
      return await this.options.withReading(input.data.kingdomId, async (sql, reading) => {
        await ensurePanelMirror(sql, this.options.origin, input.data.kingdomId);
        // Reading a panel cannot activate an Extension or resurrect a superseded publisher generation.
        const binding = (await sql.query<{ extension_id: string | null; binding_id: string | null }>(
          'SELECT extension_id, binding_id FROM realm_panel_settings_mirror_quota WHERE origin = $1 FOR SHARE', [this.options.origin])).rows[0]!;
        const row = (await sql.query<{ verified_content: string | null; verified_ms: string | null; fresh: boolean }>(
          `SELECT verified_content, verified_ms::text, (verified_ms + ${PANEL_MIRROR_AUDIT_MS} > ${NOW}) IS TRUE AS fresh
            FROM realm_panel_settings_mirror WHERE origin = $1 AND kingdom_id = $2 AND extension_id = $3 AND binding_id = $4`,
          [this.options.origin, input.data.kingdomId, input.data.extensionId, binding.binding_id])).rows[0];
        const verified = binding.extension_id === input.data.extensionId && !!row
          && row.verified_content === panelMirrorContent(reading) && row.verified_ms !== null && row.fresh;
        // Connection changes are authoritative too, even without a preference revision change.
        if (!verified && row && row.verified_content !== null && binding.extension_id === input.data.extensionId) await dirtyPanelMirror(sql, this.options.origin, input.data.kingdomId);
        return ok({ version: 1, status: 'sync', reading, publication: verified ? 'verified' : 'pending', verifiedAt: verified ? Number(row!.verified_ms) : null });
      });
    } catch { return unavailable(); }
  }

  async claim(raw: unknown): Promise<PanelMirrorReply> {
    const input = Binding.safeParse(raw); if (!input.success) return refused();
    const claimId = randomUUID();
    try {
      // Binding lock is held only for the short atomic claim, never while reading a realm or doing HTTP.
      const sql = await this.options.db.connect();
      let row: { kingdom_id: string } | undefined;
      try {
        await sql.query('BEGIN');
        if (!await this.active(sql, input.data, true)) { await sql.query('COMMIT'); return ok({ version: 1, status: 'fenced' }); }
        // Two claims across all replicas fit the shared HTTP quota and 30s lease, not two per process.
        const running = await sql.query(`SELECT 1 FROM realm_panel_settings_mirror WHERE origin = $1 AND binding_id = $2
          AND claim_id IS NOT NULL AND lease_until_ms > ${NOW} LIMIT 2`, [this.options.origin, input.data.bindingId]);
        if (running.rowCount === 2) { await sql.query('COMMIT'); return ok({ version: 1, status: 'idle' }); }
        row = (await sql.query<{ kingdom_id: string }>(`WITH candidate AS (
        SELECT origin, kingdom_id FROM realm_panel_settings_mirror WHERE origin = $1
          AND (binding_id IS DISTINCT FROM $6 OR
            (next_attempt_ms <= ${NOW} AND not_before_ms <= ${NOW} AND lease_until_ms <= ${NOW}))
        -- New settings and deployment rebinding precede routine audits; each class stays oldest-first.
        ORDER BY CASE WHEN verified_content IS NULL OR binding_id IS DISTINCT FROM $6 THEN 0 ELSE 1 END,
          next_attempt_ms, kingdom_id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE realm_panel_settings_mirror AS m SET claim_id = $2, lease_until_ms = ${NOW} + $3,
          extension_id = $5, binding_id = $6, not_before_ms = ${NOW} + $4, next_attempt_ms = ${NOW} + $3,
          attempts = LEAST(m.attempts + 1, 31), verified_content = NULL, verified_ms = NULL
        FROM candidate c WHERE m.origin = c.origin AND m.kingdom_id = c.kingdom_id RETURNING m.kingdom_id`,
        [this.options.origin, claimId, PANEL_MIRROR_LEASE_MS, PANEL_MIRROR_INTERVAL_MS, input.data.extensionId, input.data.bindingId])).rows[0];
        await sql.query('COMMIT');
      } catch (error) { await sql.query('ROLLBACK').catch(() => {}); throw error; }
      finally { sql.release(); }
      if (!row) return ok({ version: 1, status: 'idle' });
      const kingdomId = KingdomIdSchema.parse(row.kingdom_id);
      return await this.options.withReading(kingdomId, async (sql, reading) => {
        if (!await this.active(sql, input.data)) return ok({ version: 1, status: 'fenced' });
        const current = await sql.query(`SELECT 1 FROM realm_panel_settings_mirror WHERE origin = $1 AND kingdom_id = $2
          AND claim_id = $3 AND lease_until_ms > ${NOW} AND extension_id = $4 AND binding_id = $5`,
        [this.options.origin, kingdomId, claimId, input.data.extensionId, input.data.bindingId]);
        if (!current.rowCount) return ok({ version: 1, status: 'idle' });
        panelMirrorContent(reading);
        return ok({ version: 1, status: 'claimed', kingdomId, claimId, reading });
      });
    } catch { return unavailable(); } // A lost claim response recovers after the persisted lease expires.
  }

  async permit(raw: unknown): Promise<PanelMirrorReply> {
    const input = Permit.safeParse(raw); if (!input.success) return refused();
    const sql = await this.options.db.connect();
    try {
      await sql.query('BEGIN');
      const quota = (await sql.query<{ wait: string; extension_id: string | null; binding_id: string | null }>(`SELECT extension_id, binding_id, GREATEST(0, next_http_ms - ${NOW})::text AS wait
        FROM realm_panel_settings_mirror_quota WHERE origin = $1 FOR UPDATE`, [this.options.origin])).rows[0]!;
      const valid = await sql.query(`SELECT 1 FROM realm_panel_settings_mirror WHERE origin = $1 AND kingdom_id = $2
        AND claim_id = $3 AND lease_until_ms > ${NOW} AND extension_id = $4 AND binding_id = $5`,
      [this.options.origin, input.data.kingdomId, input.data.claimId, input.data.extensionId, input.data.bindingId]);
      const current = valid.rowCount === 1 && quota.extension_id === input.data.extensionId && quota.binding_id === input.data.bindingId;
      const allowed = current && Number(quota.wait) === 0;
      if (allowed) await sql.query(`UPDATE realm_panel_settings_mirror_quota SET next_http_ms = ${NOW} + $2 WHERE origin = $1`,
        [this.options.origin, PANEL_MIRROR_HTTP_INTERVAL_MS]);
      await sql.query('COMMIT');
      // A zero retry on refusal means the claim is fenced, never permission to send.
      return ok({ version: 1, status: 'permit', allowed, retryAfterMs: current ? Number(quota.wait) : 0 });
    } catch { await sql.query('ROLLBACK').catch(() => {}); return unavailable(); }
    finally { sql.release(); }
  }

  async finish(raw: unknown): Promise<PanelMirrorReply> {
    const input = Finish.safeParse(raw); if (!input.success || input.data.content && Buffer.byteLength(input.data.content, 'utf8') > 3072) return refused();
    const { kingdomId, claimId, content } = input.data;
    try {
      return await this.options.withReading(kingdomId, async (sql, reading) => {
        if (!await this.active(sql, input.data)) return ok({ version: 1, status: 'finished', publication: 'pending' });
        const matches = content === panelMirrorContent(reading);
        const answer = await sql.query(`UPDATE realm_panel_settings_mirror SET claim_id = NULL, lease_until_ms = 0,
          verified_content = CASE WHEN $4 THEN $5 ELSE NULL END, verified_ms = CASE WHEN $4 THEN ${NOW} ELSE NULL END,
          next_attempt_ms = ${NOW} + CASE WHEN $4 THEN $6 WHEN $5::text IS NOT NULL THEN 0
            ELSE LEAST(300000, $7 * power(2, LEAST(attempts - 1, 6)))::bigint END,
          attempts = CASE WHEN $4 THEN 0 ELSE attempts END
          WHERE origin = $1 AND kingdom_id = $2 AND claim_id = $3 AND lease_until_ms > ${NOW} AND extension_id = $8 AND binding_id = $9`,
        [this.options.origin, kingdomId, claimId, matches, content ?? null, PANEL_MIRROR_AUDIT_MS, PANEL_MIRROR_INTERVAL_MS, input.data.extensionId, input.data.bindingId]);
        return ok({ version: 1, status: 'finished', publication: answer.rowCount === 1 && matches ? 'verified' : 'pending' });
      });
    } catch { return unavailable(); }
  }

  private async active(sql: Sql, binding: { extensionId: string; bindingId: string }, exclusive = false): Promise<boolean> {
    return (await sql.query(`SELECT 1 FROM realm_panel_settings_mirror_quota WHERE origin = $1 AND extension_id = $2
      AND binding_id = $3 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [this.options.origin, binding.extensionId, binding.bindingId])).rowCount === 1;
  }
}
const ok = (body: PanelMirrorBody): PanelMirrorReply => ({ http: 200, body });
const refused = (): PanelMirrorReply => ({ http: 400, body: { version: 1, status: 'refused', message: 'These panel settings could not be read.' } });
const unavailable = (): PanelMirrorReply => ({ http: 503, body: { version: 1, status: 'unavailable', message: 'The panel settings are out of reach. Try again shortly.' } });
