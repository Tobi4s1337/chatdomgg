import type { KingdomId, PresenceInput } from '@chatdom/shared';
import type { RealmStoredOutcome } from '@chatdom/shared/realm';
import { canonicalJson } from '../persistence/codec';
import { RealmStorageUnavailableError, type RealmDatabase } from '../persistence/database';
import type { AdmittedObservation } from './gate';
import type { IngressService } from './transition';

const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
/** Unsettled observations one kingdom may hold. A full inbox answers `busy`; the service retries, nothing is dropped. */
export const INGRESS_INBOX_CAPACITY = 4_096;
/** Rows one drain pass hands to the writer. */
export const INGRESS_DRAIN_BATCH = 64;

export interface PendingObservation {
  readonly inboxId: number; readonly service: IngressService; readonly digest: string;
  readonly receivedAt: number; readonly observation: PresenceInput;
}
export type InboxAnswer = 'accepted' | 'duplicate' | 'conflict' | 'busy' | 'wrong-origin';

/**
 * The durable door between an authenticated service and a kingdom's writer. Accepting an observation commits it here,
 * whichever process holds the kingdom, so a crash or a missing writer cannot lose it. The writer drains rows in
 * acceptance order through `executeIngress`, whose receipt (source, observation id, digest) is the single answer: a
 * row drained twice returns the stored outcome and applies nothing new.
 */
export class PostgresIngressInbox {
  constructor(private readonly db: RealmDatabase, private readonly origin: 'live' | 'simulated') {}

  async accept(admitted: AdmittedObservation): Promise<InboxAnswer> {
    const tx = await this.connect();
    try {
      await tx.query('BEGIN');
      await tx.query(`INSERT INTO realm_kingdoms (kingdom_id, origin, created_ms) VALUES ($1, $2, ${NOW_MS}) ON CONFLICT (kingdom_id) DO NOTHING`, [admitted.kingdomId, this.origin]);
      const kingdom = (await tx.query<{ origin: string }>('SELECT origin FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE', [admitted.kingdomId])).rows[0];
      if (kingdom?.origin !== this.origin) { await tx.query('ROLLBACK'); return 'wrong-origin'; }
      const prior = (await tx.query<{ digest: string }>('SELECT digest FROM realm_ingress_inbox WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3',
        [admitted.kingdomId, admitted.service, admitted.observation.id])).rows[0];
      if (prior) { await tx.query('ROLLBACK'); return prior.digest === admitted.digest ? 'duplicate' : 'conflict'; }
      const waiting = (await tx.query<{ n: string }>(`SELECT count(*) AS n FROM (SELECT 1 FROM realm_ingress_inbox WHERE kingdom_id = $1 AND settled_ms IS NULL LIMIT $2) AS w`,
        [admitted.kingdomId, INGRESS_INBOX_CAPACITY])).rows[0]!;
      if (Number(waiting.n) >= INGRESS_INBOX_CAPACITY) { await tx.query('ROLLBACK'); return 'busy'; }
      const inserted = await tx.query(`INSERT INTO realm_ingress_inbox (kingdom_id, source, observation_id, digest, capability, observation, received_ms)
        VALUES ($1, $2, $3, $4, $5, $6, ${NOW_MS}) ON CONFLICT (kingdom_id, source, observation_id) DO NOTHING`,
      [admitted.kingdomId, admitted.service, admitted.observation.id, admitted.digest, admitted.capability, canonicalJson(admitted.observation)]);
      await tx.query('COMMIT');
      // A concurrent identical accept won the insert: same digest is a duplicate, anything else was caught above.
      return inserted.rowCount === 1 ? 'accepted' : 'duplicate';
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { tx.release(); }
  }

  /** Unsettled rows in acceptance order. */
  async pending(kingdomId: KingdomId, limit = INGRESS_DRAIN_BATCH): Promise<PendingObservation[]> {
    const rows = await this.db.query<{ inbox_id: string; source: IngressService; digest: string; received_ms: string; observation: string }>(
      `SELECT inbox_id, source, digest, received_ms, observation FROM realm_ingress_inbox WHERE kingdom_id = $1 AND settled_ms IS NULL ORDER BY inbox_id LIMIT $2`,
      [kingdomId, Math.min(Math.max(1, limit), 1_024)]);
    return rows.rows.map(r => ({ inboxId: Number(r.inbox_id), service: r.source, digest: r.digest, receivedAt: Number(r.received_ms), observation: JSON.parse(r.observation) as PresenceInput }));
  }

  /** Marks a row finished once its receipt (or a final refusal) exists. Idempotent; the receipt stays authoritative. */
  async settle(kingdomId: KingdomId, row: PendingObservation, outcome: RealmStoredOutcome): Promise<void> {
    await this.db.query(`UPDATE realm_ingress_inbox SET settled_ms = ${NOW_MS}, settled_status = $4, settled_reason = $5
      WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3 AND settled_ms IS NULL`,
    [kingdomId, row.service, row.observation.id, outcome.status, outcome.status === 'committed' ? null : outcome.reason]);
  }

  /** Kingdoms of this origin with unsettled observations, oldest first. */
  async waiting(limit = 64): Promise<KingdomId[]> {
    const rows = await this.db.query<{ kingdom_id: KingdomId }>(`SELECT i.kingdom_id FROM realm_ingress_inbox i JOIN realm_kingdoms k USING (kingdom_id)
      WHERE i.settled_ms IS NULL AND k.origin = $1 GROUP BY i.kingdom_id ORDER BY min(i.inbox_id) LIMIT $2`, [this.origin, limit]);
    return rows.rows.map(r => r.kingdom_id);
  }

  private async connect() {
    try { return await this.db.connect(); }
    catch { throw new RealmStorageUnavailableError('The realm database is unavailable.'); }
  }
}
