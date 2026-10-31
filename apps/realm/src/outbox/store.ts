import type { KingdomId } from '@chatdom/shared';
import type { RealmFact, RealmPublicMessage, RealmWriterLease } from '@chatdom/shared/realm';
import { RealmRecoveryError, RealmWriterFencedError, type RealmDatabase } from '../persistence/database';
import { sha256Hex } from '../persistence/codec';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { PublicProjection, type PublicPrefix, type RealmPublicCastle, type RealmPublicHome, type RealmPublicPresence } from './projection';

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
    // A first Forge publishes its allocated home without a preceding home row. Read immutable allocation
    // bases, then fold only public home/Forge rows through the delivered cursor; current private builds may be ahead.
    const allocations = await this.db.query<{ fact: string; digest: string }>(`SELECT f.fact, f.digest FROM realm_deeds d
      JOIN realm_facts f ON f.kingdom_id = d.kingdom_id AND f.seq = d.installed_seq
      WHERE d.kingdom_id = $1 AND d.status = 'installed' ORDER BY d.installed_seq`, [kingdomId]);
    const bases: RealmPublicHome[] = allocations.rows.map(row => {
      if (sha256Hex(row.fact) !== row.digest) throw new RealmRecoveryError(kingdomId, 'allocation fact fails its digest');
      const fact = JSON.parse(row.fact) as RealmFact;
      if (fact.version !== 1 || fact.kingdomId !== kingdomId || fact.body.type !== 'home.installAllocated') throw new RealmRecoveryError(kingdomId, 'invalid allocated home fact');
      const home = fact.body.home;
      return { type: 'home', plotId: home.id, revision: home.revision, assetHash: home.digest, attachments: [] };
    });
    // The keep is independent of street deeds. Its installation row is public and needs no allocation base.
    const projection = new PublicProjection({ bases, homes: [], presence: null, cursor: 0, sequence: 0 });
    let after = 0;
    while (after < throughId) {
      const found = await this.db.query<{ id: string; sequence: string; event_id: string; plot_id: string | null; message: string }>(
        `SELECT id, sequence, event_id, plot_id, message FROM realm_outbox
         WHERE kingdom_id = $1 AND id > $2 AND id <= $3 AND kind IN ('home', 'castle', 'forge', 'moment') ORDER BY id LIMIT $4`,
        [kingdomId, after, throughId, OUTBOX_DISPATCH_BATCH]);
      const rows = found.rows.map(r => ({ id: Number(r.id), sequence: Number(r.sequence), eventId: r.event_id, plotId: r.plot_id, message: JSON.parse(r.message) as RealmPublicMessage }));
      const prefix = rows.filter(row => row.id <= throughId);
      projection.adopt(prefix);
      if (!prefix.length) break;
      after = prefix.at(-1)!.id;
    }
    const presence = await this.db.query<{ message: string }>(`SELECT message FROM realm_outbox
      WHERE kingdom_id = $1 AND kind = 'presence' AND id <= $2 ORDER BY id DESC LIMIT 1`, [kingdomId, throughId]);
    const bounds = await this.db.query<{ sequence: string | null; committed: string | null }>(`SELECT
      (SELECT sequence FROM realm_outbox WHERE kingdom_id = $1 AND id <= $2 ORDER BY id DESC LIMIT 1) AS sequence,
      (SELECT max(id) FROM realm_outbox WHERE kingdom_id = $1) AS committed`, [kingdomId, throughId]);
    return {
      homes: projection.current().filter((message): message is RealmPublicHome => message.type === 'home'),
      bases,
      castle: projection.current().find((message): message is RealmPublicCastle => message.type === 'castle') ?? null,
      presence: presence.rows[0] ? JSON.parse(presence.rows[0].message) as RealmPublicPresence : null,
      moments: (() => {
        const state = projection.current().find(message => message.type === 'moments.current');
        return state?.type === 'moments.current' ? { throughSeq: state.throughSeq, facts: state.facts } : { throughSeq: 0, facts: [] };
      })(),
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
