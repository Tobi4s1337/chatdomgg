/**
 * Turns a realm-auth session cookie into the Raid Gate's `GatePrincipal`. The cookie is the only credential: the
 * request body is never read, and nothing the browser sends picks the person, the role or the session.
 *
 * - The session is looked up the way realm-auth stores it (SHA-256 of the handle in `realm_sessions.handle_hash`),
 *   unrevoked and unexpired by database time, and of this deployment's origin. A live gate never admits a
 *   SIMULATED session, and the reverse.
 * - The kingdom comes from the gate URL (`gateKingdomFromPath`) and must be a realm kingdom of the same origin.
 * - The role is derived here: `monarch` only for the channel's own Twitch account, `citizen` for a person holding a
 *   live deed in this kingdom, otherwise `guest`. The application still asks the policy before any royal act.
 *
 * `sessionId` is the Chatdom session's UUID. It is a server-side handle (records keep it, browsers never see
 * records), which lets the policy recheck that exact session at every command. The cookie itself is never logged.
 */
import { KingdomIdSchema, PersonIdSchema, kingdomForBroadcaster, type KingdomId } from '../../../../packages/shared/src/identity';
import { sha256 } from '../realm-auth/secrets';
import type { GatePrincipal, GateRole } from './contracts';
import { token } from './guard';
import type { GateAuthenticator } from './http';
import type { RecordOrigin } from './repository';

/** The part of `pg.Pool` the authenticator and the policy use. */
export interface SqlQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type RealmSessionAuthenticatorOptions = Readonly<{
  pool: SqlQueryable;
  origin: RecordOrigin;
  /** realm-auth's session cookie name: `__Host-chatdom_session` over HTTPS, `chatdom_session` on loopback HTTP. */
  sessionCookie: string;
  /** The kingdom this request is for, from server routing only. Null refuses the request. */
  kingdomOf: (request: Request) => KingdomId | null;
}>;

/** realm-auth refuses longer handles; its own are 43 characters. */
export const SESSION_HANDLE_LIMIT = 128;
/** A Cookie header beyond this is not one our pages send. */
export const COOKIE_HEADER_LIMIT = 8192;
const COOKIE_NAME = /^(?:__Host-)?[A-Za-z0-9_]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIX = /^(?:\/[a-z0-9][a-z0-9-]{0,31}){1,4}$/;

/**
 * The first value of `name` in a Cookie header, as realm-auth reads it (first occurrence wins, value trimmed).
 * Undefined when absent, empty or longer than a session handle can be.
 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header || header.length > COOKIE_HEADER_LIMIT) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return value.length > 0 && value.length <= SESSION_HANDLE_LIMIT ? value : undefined;
  }
  return undefined;
}

/**
 * The gate lives at `${prefix}/<kingdomId>` (for example `/api/raid-gate/41000001`); the kingdom is in the path
 * because the stream refuses extra query keys. Exactly one canonical decimal ID segment, nothing after it.
 */
export function kingdomFromGatePath(prefix: string, pathname: string): KingdomId | null {
  if (!PREFIX.test(prefix) || !pathname.startsWith(`${prefix}/`)) return null;
  const parsed = KingdomIdSchema.safeParse(pathname.slice(prefix.length + 1));
  return parsed.success ? parsed.data : null;
}

/** `kingdomOf` for `createRealmSessionAuthenticator`, reading the request's URL path under `prefix`. */
export function gateKingdomFromPath(prefix: string): (request: Request) => KingdomId | null {
  if (!PREFIX.test(prefix)) throw new Error('The Raid Gate path prefix is a plain absolute path such as /api/raid-gate.');
  return request => {
    let pathname: string;
    try { pathname = new URL(request.url).pathname; } catch { return null; }
    return kingdomFromGatePath(prefix, pathname);
  };
}

type SessionRow = { session_id?: unknown; person_id?: unknown; kingdom?: unknown; citizen?: unknown };

export function createRealmSessionAuthenticator(options: RealmSessionAuthenticatorOptions): GateAuthenticator {
  const { pool, origin, sessionCookie, kingdomOf } = options;
  if (!COOKIE_NAME.test(sessionCookie)) throw new Error('The session cookie name is not one realm-auth issues.');
  if (origin !== 'live' && origin !== 'simulated') throw new Error('The Raid Gate origin is live or simulated.');

  return async (request, signal) => {
    signal.throwIfAborted();
    const kingdomId = kingdomOf(request);
    if (!kingdomId) return null;
    const handle = readCookie(request.headers.get('cookie'), sessionCookie);
    if (!handle) return null;
    const result = await pool.query(`
      select s.session_id::text as session_id, s.person_id,
        exists (select 1 from realm_kingdoms k where k.kingdom_id = $3 and k.origin = $2) as kingdom,
        exists (select 1 from realm_deeds d where d.kingdom_id = $3 and d.person_id = s.person_id and d.origin = $2 and d.status <> 'void') as citizen
      from realm_sessions s
      where s.handle_hash = $1 and s.origin = $2 and s.revoked_at is null and s.expires_at > now()`, [sha256(handle), origin, kingdomId]);
    signal.throwIfAborted();
    const row = result.rows[0] as SessionRow | undefined;
    if (!row || row.kingdom !== true) return null;
    const person = PersonIdSchema.safeParse(row.person_id);
    const sessionId = typeof row.session_id === 'string' && UUID.test(row.session_id) ? token(row.session_id) : undefined;
    if (!person.success || !sessionId) return null;
    const sourceRole: GateRole = kingdomForBroadcaster(person.data) === kingdomId ? 'monarch' : row.citizen === true ? 'citizen' : 'guest';
    const principal: GatePrincipal = { personId: person.data, sessionId, sourceKingdomId: kingdomId, sourceRole };
    return principal;
  };
}
