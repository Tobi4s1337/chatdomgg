import { PersonIdSchema } from '@chatdom/shared';
import { csrfFor, sameText, sha256 } from '../realm-auth/secrets';
import { readCookie } from '../raid-gate/session';

/** Server-side identity only. The browser cannot choose the broadcaster or its role. */
export interface DockPrincipal { readonly personId: string; readonly sessionId: string }
export interface DockSessionPool {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

export async function dockPrincipal(
  pool: DockSessionPool, origin: 'live' | 'simulated', secureCookies: boolean, cookie: string | undefined,
): Promise<{ principal: DockPrincipal; handle: string } | null> {
  const handle = readCookie(cookie ?? null, secureCookies ? '__Host-chatdom_session' : 'chatdom_session');
  if (!handle) return null;
  const result = await pool.query(`select session_id::text as session_id, person_id from realm_sessions
    where handle_hash = $1 and origin = $2 and revoked_at is null and expires_at > now()`, [sha256(handle), origin]);
  const row = result.rows[0] as { person_id?: unknown; session_id?: unknown } | undefined;
  const person = PersonIdSchema.safeParse(row?.person_id);
  if (!person.success || typeof row?.session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.session_id)) return null;
  return { principal: { personId: person.data, sessionId: row.session_id }, handle };
}

/** Origin and session-bound token are both required for any state-changing request. */
export function dockMutationAllowed(headers: import('node:http').IncomingHttpHeaders, publicOrigin: string, handle: string): boolean {
  return headers.origin === publicOrigin && headers['sec-fetch-site'] !== 'cross-site'
    && typeof headers['x-csrf-token'] === 'string' && sameText(headers['x-csrf-token'], csrfFor(handle));
}
