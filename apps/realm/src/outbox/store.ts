import type { KingdomId } from '@chatdom/shared';
import type { RealmPublicMessage, RealmWriterLease } from '@chatdom/shared/realm';
import { RealmWriterFencedError, type RealmDatabase } from '../persistence/database';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import type { PublicPrefix, RealmPublicHome, RealmPublicPresence } from './projection';

const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
/** Rows one dispatch pass reads and hands to the transport before acknowledging them. */
export const OUTBOX_DISPATCH_BATCH = 256;

/** Durable delivery bookkeeping for committed public outbox rows. */
export interface RealmOutboxStore {
  read(kingdomId: KingdomId, afterId: number, limit?: number): Promise<RealmOutboxRow[]>;
  /** Claims the delivery cursor for this writer and returns it. A kingdom seen for the first time starts at its newest row. */
  open(lease: RealmWriterLease): Promise<number>;
  /** Records delivery through `throughId`. Only the current unexpired epoch may move it, and only forward. */
  acknowledge(lease: RealmWriterLease, throughId: number): Promise<void>;
  /**
   * The public views rows at or below `throughId` left standing, plus the newest committed row id. `sequence` is the
   * domain sequence of the newest row in the prefix (0 for none); the caller knows any later fact-only sequence.
   */
  prefix(kingdomId: KingdomId, throughId: number): Promise<Omit<PublicPrefix, 'cursor'> & { readonly committed: number }>;
}

export class PostgresOutboxStore implements RealmOutboxStore {
  constructor(private readonly db: RealmDatabase) {}

  async read(kingdomId: KingdomId, afterId: number, limit = OUTBOX_DISPATCH_BATCH): Promise<RealmOutboxRow[]> {
    const rows = await this.db.query<{ id: string; sequence: string; event_id: string; plot_id: string | null; message: string }>(
      'SELECT id, sequence, event_id, plot_id, message FROM realm_outbox WHERE kingdom_id = $1 AND id > $2 ORDER BY id LIMIT $3',
      [kingdomId, afterId, Math.min(Math.max(1, limit), 1_024)]);
    return rows.rows.map(r => ({ id: Number(r.id), sequence: Number(r.sequence), eventId: r.event_id, plotId: r.plot_id, message: JSON.parse(r.message) as RealmPublicMessage }));
  }

  async prefix(kingdomId: KingdomId, throughId: number) {
    const homes = await this.db.query<{ message: string }>(`SELECT DISTINCT ON (plot_id) message FROM realm_outbox
      WHERE kingdom_id = $1 AND kind = 'home' AND id <= $2 ORDER BY plot_id, id DESC`, [kingdomId, throughId]);
    const presence = await this.db.query<{ message: string }>(`SELECT message FROM realm_outbox
      WHERE kingdom_id = $1 AND kind = 'presence' AND id <= $2 ORDER BY id DESC LIMIT 1`, [kingdomId, throughId]);
    const bounds = await this.db.query<{ sequence: string | null; committed: string | null }>(`SELECT
      (SELECT sequence FROM realm_outbox WHERE kingdom_id = $1 AND id <= $2 ORDER BY id DESC LIMIT 1) AS sequence,
      (SELECT max(id) FROM realm_outbox WHERE kingdom_id = $1) AS committed`, [kingdomId, throughId]);
    return {
      homes: homes.rows.map(r => JSON.parse(r.message) as RealmPublicHome),
      presence: presence.rows[0] ? JSON.parse(presence.rows[0].message) as RealmPublicPresence : null,
      sequence: Number(bounds.rows[0]?.sequence ?? 0),
      committed: Number(bounds.rows[0]?.committed ?? 0),
    };
  }

  async open(lease: RealmWriterLease): Promise<number> {
    // Before this table existed nothing promised delivery, so an absent cursor starts at the present, not at history.
    await this.db.query(`INSERT INTO realm_outbox_cursors (kingdom_id, delivered_id, writer_epoch, updated_ms)
      SELECT k.kingdom_id, coalesce((SELECT max(id) FROM realm_outbox o WHERE o.kingdom_id = k.kingdom_id), 0), $2, ${NOW_MS}
      FROM realm_kingdoms k WHERE k.kingdom_id = $1 AND k.writer_epoch = $2 AND k.lease_expires_ms > ${NOW_MS}
      ON CONFLICT (kingdom_id) DO NOTHING`, [lease.kingdomId, lease.epoch]);
    const row = (await this.db.query<{ delivered_id: string }>('SELECT delivered_id FROM realm_outbox_cursors WHERE kingdom_id = $1', [lease.kingdomId])).rows[0];
    if (!row) throw new RealmWriterFencedError(lease.kingdomId);
    return Number(row.delivered_id);
  }

  async acknowledge(lease: RealmWriterLease, throughId: number): Promise<void> {
    const moved = await this.db.query(`UPDATE realm_outbox_cursors c SET delivered_id = greatest(c.delivered_id, $3), writer_epoch = $2, updated_ms = ${NOW_MS}
      FROM realm_kingdoms k WHERE c.kingdom_id = $1 AND k.kingdom_id = c.kingdom_id AND k.writer_epoch = $2 AND k.lease_expires_ms > ${NOW_MS}`,
    [lease.kingdomId, lease.epoch, throughId]);
    if (moved.rowCount !== 1) throw new RealmWriterFencedError(lease.kingdomId);
  }
}
