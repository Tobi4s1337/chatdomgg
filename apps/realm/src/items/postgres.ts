import type { ItemEvent, ItemRecord, KingdomId, PersonId } from '@chatdom/shared';
import type { PoolClient } from 'pg';
import type { RealmDatabase } from '../persistence/database';
import { ItemCommitUncertainError, redactItem, type GrantReceipt, type ItemStore, type ItemTransaction } from './store';
import { ITEM_PAGE_ROWS } from './pages';

const clients = new WeakMap<ItemTransaction, { client: PoolClient; active: boolean; guards: (() => boolean)[] }>();

/** The caller may use this client only during the item transaction callback. */
export function postgresItemClient(tx: ItemTransaction): Pick<PoolClient, 'query'> {
  const state = clients.get(tx);
  if (!state?.active) throw new Error('Item transaction is not active');
  return { query: new Proxy(state.client.query, {
    apply(target, _thisArg, args) {
      if (!state.active) throw new Error('Item transaction is not active');
      return Reflect.apply(target, state.client, args);
    },
  }) };
}

/** Trusted synchronous guards run after the work callback settles, immediately before COMMIT is sent.
 * They may inspect local authority/candidate state, never await or issue SQL. Session rows must already
 * be locked and the database lease checked by the transaction's last SQL statement. */
export function postgresItemCommitGuard(tx: ItemTransaction, current: () => boolean): void {
  const state = clients.get(tx);
  if (!state?.active) throw new Error('Item transaction is not active');
  if (state.guards.length >= 16) throw new Error('Too many item commit guards');
  state.guards.push(current);
}

export function createPostgresItemStore({ pool }: { pool: RealmDatabase }): ItemStore {
  const store: ItemStore = {
    async transaction<T>(kingdomId: KingdomId, work: (tx: ItemTransaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const state = { client, active: true, guards: [] as (() => boolean)[] };
      const callbacks: (() => void)[] = [];
      let commitSent = false;
      let uncertain = false;
      const check = () => { if (!state.active) throw new Error('Item transaction is not active'); };
      const tx: ItemTransaction = {
        store, kingdomId,
        async visible(item) {
          check();
          if (item.kingdomId !== kingdomId) throw new Error('Item belongs to another kingdom');
          const personId = item.story.by?.personId;
          if (!personId) return structuredClone(item);
          const result = await client.query('SELECT 1 FROM realm_item_hidden_names WHERE person_id=$1', [personId]);
          return structuredClone(redactItem(item, new Set(result.rowCount ? [personId] : [])));
        },
        async get(id) { check(); const r = await client.query<{ record: ItemRecord }>('SELECT record FROM realm_items WHERE id=$1 AND kingdom_id=$2', [id, kingdomId]); return r.rows[0]?.record ?? null; },
        async list(ownerId) { check(); const r = await client.query<{ record: ItemRecord }>("SELECT record FROM realm_items WHERE kingdom_id=$1 AND record->>'ownerId'=$2 ORDER BY id", [kingdomId, ownerId]); return r.rows.map(row => row.record); },
        async save(item) {
          check(); if (item.kingdomId !== kingdomId || item.story.kingdomId !== kingdomId) throw new Error('Item belongs to another kingdom');
          if (item.revision === 0) await client.query('INSERT INTO realm_items (id, kingdom_id, record) VALUES ($1,$2,$3)', [item.id, kingdomId, item]);
          else {
            const r = await client.query("UPDATE realm_items SET record=$1 WHERE id=$2 AND kingdom_id=$3 AND (record->>'revision')::integer=$4", [item, item.id, kingdomId, item.revision - 1]);
            if (r.rowCount !== 1) throw new Error('Item revision conflict');
          }
        },
        async append(event) { check(); const r = await client.query('INSERT INTO realm_item_events (item_id,event) SELECT id,$1 FROM realm_items WHERE id=$2 AND kingdom_id=$3', [event, event.itemId, kingdomId]); if (r.rowCount !== 1) throw new Error('Item belongs to another kingdom or does not exist'); },
        async receipt(ownerId, origin, key) { check(); const r = await client.query<{ fingerprint: string; item_id: string }>('SELECT fingerprint,item_id FROM realm_item_grants WHERE kingdom_id=$1 AND owner_id=$2 AND origin=$3 AND key=$4', [kingdomId, ownerId, origin, key]); const row = r.rows[0]; return row ? { ownerId, origin, key, fingerprint: row.fingerprint, itemId: row.item_id } : null; },
        async saveReceipt(receipt: GrantReceipt) { check(); const r = await client.query("INSERT INTO realm_item_grants (kingdom_id,owner_id,origin,key,fingerprint,item_id) SELECT $1,$2,$3,$4,$5,id FROM realm_items WHERE id=$6 AND kingdom_id=$1 AND record->>'ownerId'=$2 AND record->>'origin'=$3", [kingdomId, receipt.ownerId, receipt.origin, receipt.key, receipt.fingerprint, receipt.itemId]); if (r.rowCount !== 1) throw new Error('Item belongs to another kingdom or does not exist'); },
        async nextNumber(defId) { check(); const r = await client.query<{ number: number }>('INSERT INTO realm_item_numbers (kingdom_id,def_id,number) VALUES ($1,$2,1) ON CONFLICT (kingdom_id,def_id) DO UPDATE SET number=realm_item_numbers.number+1 RETURNING number', [kingdomId, defId]); return r.rows[0]!.number; },
        async sharedNumber(key, defId, fingerprint) {
          check();
          const existing = await client.query<{ def_id: string; fingerprint: string; number: number }>('SELECT def_id,fingerprint,number FROM realm_item_shared_numbers WHERE kingdom_id=$1 AND key=$2', [kingdomId, key]);
          const row = existing.rows[0];
          if (row) {
            if (row.def_id !== defId || row.fingerprint !== fingerprint) throw new Error('Shared item key was already used for a different grant');
            return row.number;
          }
          const number = await tx.nextNumber(defId);
          await client.query('INSERT INTO realm_item_shared_numbers (kingdom_id,key,def_id,fingerprint,number) VALUES ($1,$2,$3,$4,$5)', [kingdomId, key, defId, fingerprint, number]);
          return number;
        },
        afterCommit(callback) { check(); callbacks.push(callback); },
      };
      clients.set(tx, state);
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('chatdom.items:' || $1, 0))", [kingdomId]);
        const result = await work(tx);
        // Commit guards are local checks only. Close even escaped query capabilities before invoking them,
        // so a guard cannot sneak another SQL write behind a feature's declared final database fence.
        state.active = false;
        // No await separates these local checks from sending COMMIT. A callback's resolved result
        // alone does not prove that its controlling seat or retained authority is still current.
        for (const current of state.guards) if (current() !== true) throw new Error('Item commit guard refused');
        commitSent = true;
        await client.query('COMMIT');
        for (const callback of callbacks) { try { callback(); } catch { /* commit is already durable */ } }
        return result;
      } catch (error) {
        state.active = false;
        if (commitSent) { uncertain = true; throw new ItemCommitUncertainError(); }
        await client.query('ROLLBACK').catch(() => { uncertain = true; });
        throw error;
      } finally { state.active = false; state.guards.length = 0; client.release(uncertain); }
    },
    async get(id) { const r = await pool.query<{ record: ItemRecord; hidden: boolean }>("SELECT i.record, (h.person_id IS NOT NULL) AS hidden FROM realm_items i LEFT JOIN realm_item_hidden_names h ON h.person_id=i.record->'story'->'by'->>'personId' WHERE i.id=$1", [id]); const row = r.rows[0]; return row ? redactItem(row.record, new Set(row.hidden && row.record.story.by ? [row.record.story.by.personId] : [])) : null; },
    async list(ownerId: PersonId, kingdomId: KingdomId) { const r = await pool.query<{ record: ItemRecord; hidden: boolean }>("SELECT i.record, (h.person_id IS NOT NULL) AS hidden FROM realm_items i LEFT JOIN realm_item_hidden_names h ON h.person_id=i.record->'story'->'by'->>'personId' WHERE i.kingdom_id=$1 AND i.record->>'ownerId'=$2 ORDER BY i.id", [kingdomId, ownerId]); return r.rows.map(row => redactItem(row.record, new Set(row.hidden && row.record.story.by ? [row.record.story.by.personId] : []))); },
    async history(id) { const r = await pool.query<{ event: ItemEvent }>('SELECT event FROM realm_item_events WHERE item_id=$1 ORDER BY sequence', [id]); return r.rows.map(row => row.event); },
    async listPage(ownerId, kingdomId, origin, after) {
      const r = await pool.query<{ record: ItemRecord; hidden: boolean }>(`SELECT i.record, (h.person_id IS NOT NULL) AS hidden FROM realm_items i
        LEFT JOIN realm_item_hidden_names h ON h.person_id=i.record->'story'->'by'->>'personId'
        WHERE i.kingdom_id=$1 AND i.record->>'ownerId'=$2 AND i.record->>'origin'=$3 AND i.record->>'place'<>'spent'
          AND i.id > $4 ORDER BY i.id LIMIT $5`, [kingdomId, ownerId, origin, after ?? '', ITEM_PAGE_ROWS + 1]);
      return r.rows.map(row => redactItem(row.record, new Set(row.hidden && row.record.story.by ? [row.record.story.by.personId] : [])));
    },
    async historyPage(id, after) {
      const r = await pool.query<{ sequence: string; event: ItemEvent }>('SELECT e.sequence::text AS sequence, e.event FROM realm_item_events e WHERE e.item_id=$1 AND e.sequence>$2::bigint ORDER BY e.sequence LIMIT $3', [id, after ?? '0', ITEM_PAGE_ROWS + 1]);
      return r.rows.map(row => ({ cursor: row.sequence, value: row.event }));
    },
    async forgetName(personId) { await pool.query('INSERT INTO realm_item_hidden_names (person_id) VALUES ($1) ON CONFLICT DO NOTHING', [personId]); },
  };
  return store;
}
