import { z } from 'zod';
import type { Pool } from 'pg';
import type { RealmReadiness } from '../diagnostics/readiness';
import type { RealmChannelSender } from '../room-channels';
import type { ItemTransaction } from '../items/store';
import { createPostgresItemAdmission } from '../items/entry';
import { postgresItemClient } from '../items/postgres';

/** Real session admission on the catch transaction. Revocation/identity changes serialize with commit. */
export function createPostgresFishingAdmission(options: { pool: Pool; origin: 'live' | 'simulated'; readiness: Pick<RealmReadiness, 'held'> }) {
  const current = createPostgresItemAdmission(options);
  return async (from: RealmChannelSender, tx: ItemTransaction): Promise<{ readonly name: string } | null> => {
    const principal = from.principal;
    if (!from.present() || options.readiness.held() || principal.origin !== options.origin
      || principal.kingdomId !== tx.kingdomId || !z.uuid().safeParse(principal.sessionId).success) return null;
    // The principal contains an entry id, never the private Chatdom session id. The real authenticator
    // below remains the source of session policy; this query only locks identity and reads its name.
    const sql = postgresItemClient(tx);
    const local = () => from.present() && !options.readiness.held();
    // Sign-in upserts the person before revoking an old session. Separate statements force that
    // same person -> session -> entry order; one joined FOR SHARE query cannot guarantee row-mark order.
    const people = await sql.query<{ public_name: string | null }>(`
      SELECT p.public_name FROM realm_persons p WHERE p.person_id=$1 AND p.origin=$2 FOR SHARE OF p`,
    [principal.personId, options.origin]);
    const row = people.rows[0];
    if (!row || !local()) return null;
    const sessions = await sql.query<{ session_id: string }>(`
      SELECT s.session_id FROM realm_sessions s JOIN realm_entries e ON e.session_id=s.session_id
      WHERE e.entry_id=$1 AND e.person_id=$2 AND e.kingdom_id=$3 AND e.origin=$4
        AND s.person_id=$2 AND s.origin=$4 FOR SHARE OF s`,
    [principal.sessionId, principal.personId, principal.kingdomId, options.origin]);
    const session = sessions.rows[0];
    if (!session || !local()) return null;
    const entry = await sql.query(`SELECT e.entry_id FROM realm_entries e
      WHERE e.entry_id=$1 AND e.session_id=$2 AND e.person_id=$3 AND e.kingdom_id=$4 AND e.origin=$5 FOR SHARE OF e`,
    [principal.sessionId, session.session_id, principal.personId, principal.kingdomId, options.origin]);
    if (entry.rowCount !== 1 || !await current(from, tx)) return null;
    // Name withdrawal changes presentation, never ownership. A socket's old cached name is not authoritative.
    return { name: row.public_name ?? 'a citizen' };
  };
}
