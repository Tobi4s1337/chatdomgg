import type { Pool } from 'pg';
import type { PersonId } from '@chatdom/shared';
import type { LookOrigin, LookRepository, StoredGrant, StoredLook } from './ports';

const NOW_MS = '(extract(epoch from now()) * 1000)::bigint';
type LookRow = { token: string; recipe: string; saved_ms: string };
type GrantRow = { piece_id: string; slot: StoredGrant['slot']; source: 'forge'; title: string; recipe: string; granted_ms: string };

const look = (row: LookRow): StoredLook => ({ token: row.token, recipe: row.recipe, savedAt: Number(row.saved_ms) });
const grant = (row: GrantRow): StoredGrant => ({ pieceId: row.piece_id, slot: row.slot, source: row.source, title: row.title, recipe: row.recipe, grantedAt: Number(row.granted_ms) });

/** Look storage in the shared realm schema (migration 0013). The pool's search_path is the realm schema. */
export class PostgresLookRepository implements LookRepository {
  constructor(private readonly pool: Pool) {}

  async recipe(token: string) {
    const result = await this.pool.query<{ recipe: string }>('SELECT recipe FROM realm_look_recipes WHERE token = $1', [token]);
    return result.rows[0]?.recipe ?? null;
  }

  async current(personId: PersonId, origin: LookOrigin) {
    const result = await this.pool.query<LookRow>(`SELECT l.token, r.recipe, l.saved_ms::text AS saved_ms
      FROM realm_citizen_looks l JOIN realm_look_recipes r ON r.token = l.token WHERE l.person_id = $1 AND l.origin = $2`, [personId, origin]);
    return result.rows[0] ? look(result.rows[0]) : null;
  }

  async save(personId: PersonId, origin: LookOrigin, token: string, recipe: string) {
    // The recipe row (never rewritten) and the person's current look commit together or not at all.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO realm_look_recipes (token, recipe) VALUES ($1, $2) ON CONFLICT (token) DO NOTHING', [token, recipe]);
      const stored = await client.query<{ recipe: string }>('SELECT recipe FROM realm_look_recipes WHERE token = $1', [token]);
      if (stored.rows[0]?.recipe !== recipe) throw new Error('A stored recipe disagrees with its token.');
      const saved = await client.query<LookRow>(`INSERT INTO realm_citizen_looks (person_id, origin, token, saved_ms) VALUES ($1, $2, $3, ${NOW_MS})
        ON CONFLICT (person_id) DO UPDATE SET token = EXCLUDED.token, saved_ms = EXCLUDED.saved_ms WHERE realm_citizen_looks.origin = EXCLUDED.origin
        RETURNING token, $4::text AS recipe, saved_ms::text AS saved_ms`, [personId, origin, token, recipe]);
      if (!saved.rows[0]) throw new Error('The look was not saved for this origin.');
      await client.query('COMMIT');
      return look(saved.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async grant(personId: PersonId, origin: LookOrigin, value: Omit<StoredGrant, 'grantedAt'>) {
    await this.pool.query(`INSERT INTO realm_wardrobe_grants (person_id, piece_id, origin, slot, source, title, recipe, granted_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, ${NOW_MS}) ON CONFLICT (person_id, piece_id) DO NOTHING`,
    [personId, value.pieceId, origin, value.slot, value.source, value.title, value.recipe]);
    const result = await this.pool.query<GrantRow>(`SELECT piece_id, slot, source, title, recipe, granted_ms::text AS granted_ms
      FROM realm_wardrobe_grants WHERE person_id = $1 AND piece_id = $2 AND origin = $3`, [personId, value.pieceId, origin]);
    if (!result.rows[0]) throw new Error('The piece is granted to this person under another origin.');
    return grant(result.rows[0]);
  }

  async grants(personId: PersonId, origin: LookOrigin, limit: number) {
    const result = await this.pool.query<GrantRow>(`SELECT piece_id, slot, source, title, recipe, granted_ms::text AS granted_ms
      FROM realm_wardrobe_grants WHERE person_id = $1 AND origin = $2 ORDER BY granted_ms DESC, piece_id LIMIT $3`, [personId, origin, limit]);
    return result.rows.map(grant);
  }
}
