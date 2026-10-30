import { randomUUID } from 'node:crypto';
import type { JWTVerifyGetKey } from 'jose';
import type { Pool, PoolClient } from 'pg';
import {
  RealmTicketRequestSchema,
  type RealmSessionReply, type RealmSignoutReply, type RealmTicketReply,
} from '@chatdom/shared/realm';
import { authorizationUrl, exchangeCode, OidcError, verifyIdToken, type OidcProvider } from './oidc';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from './presentation';
import { csrfFor, sameHash, sameText, secret, sha256 } from './secrets';

export const REALM_AUTH_LIMITS = {
  sessionTtlMs: 14 * 24 * 60 * 60_000,
  ticketTtlMs: 60_000,
  attemptTtlMs: 10 * 60_000,
  /** Tickets one session may request per rolling minute. */
  ticketsPerMinute: 20,
  /** Unfinished sign-ins held at once across the service; beyond this new ones wait. */
  openAttempts: 20_000,
} as const;
/** The schema migration this service was written against. Startup refuses an unmigrated database. */
export const REALM_AUTH_MIGRATION = '0001_realm_auth';

export type RealmAuthStatus = 'unauthenticated' | 'refused' | 'unavailable';
export class RealmAuthError extends Error {
  constructor(readonly status: RealmAuthStatus, message: string, readonly httpStatus = status === 'unauthenticated' ? 401 : status === 'refused' ? 403 : 503) {
    super(message); this.name = 'RealmAuthError';
  }
}

/**
 * The browser comes back to a kingdom page, never to an arbitrary URL: `/<login>` with up to three plain
 * sub-paths, `/map/<login>` or the development realm page. Anything else returns to the front page.
 */
const RETURN_PATH = /^\/(?:-\/realm|map(?:\/[a-z0-9_]{1,25})?|[a-z0-9_]{1,25}(?:\/[a-z0-9-]{1,32}){0,3})?$/;
export function safeReturnPath(value: string | null): string | null {
  if (value === null || value === '') return '/';
  return RETURN_PATH.test(value) ? value : null;
}
function withSignin(path: string, outcome: 'declined' | 'expired' | 'refused' | 'unavailable'): string {
  return `${path}?signin=${outcome}`;
}

export interface RealmAuthServiceOptions {
  /** search_path is the shared realm schema (migrated by the realm). */
  readonly pool: Pool;
  readonly provider: OidcProvider;
  readonly keys: JWTVerifyGetKey;
  /** Registered with the provider; points at `REALM_AUTH_ROUTES.callback` on the public origin. */
  readonly redirectUri: string;
  readonly fetch?: typeof fetch;
}

interface SessionRow { readonly session_id: string; readonly person_id: string; readonly resume_scope: string; readonly expires_ms: string }

export function createRealmAuthService(options: RealmAuthServiceOptions) {
  const { pool, provider, keys, redirectUri } = options;
  const fetcher = options.fetch ?? fetch;
  const origin = provider.origin;

  const database = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) {
      if (error instanceof RealmAuthError) throw error;
      throw new RealmAuthError('unavailable', 'The sign-in service cannot reach its records right now. Nothing has changed; try again shortly.');
    }
  };
  const transaction = <T>(work: (client: PoolClient) => Promise<T>) => database(async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  });
  const liveSession = async (handle: string | null, client: Pick<Pool, 'query'> = pool): Promise<SessionRow | null> => {
    if (!handle || handle.length > 128) return null;
    const result = await client.query<SessionRow>(`
      select session_id::text, person_id, resume_scope, floor(extract(epoch from expires_at) * 1000)::bigint::text as expires_ms
      from realm_sessions where handle_hash = $1 and origin = $2 and revoked_at is null and expires_at > now()`, [sha256(handle), origin]);
    return result.rows[0] ?? null;
  };
  const requireCsrf = (handle: string, csrf: string | null) => {
    if (!csrf || !sameText(csrfFor(handle), csrf)) throw new RealmAuthError('refused', 'This request did not come from your Chatdom page. Reload and try again.');
  };
  const revokeWhere = async (client: Pick<Pool, 'query'>, where: string, params: unknown[], reason: 'signout' | 'revoked' | 'replaced' | 'moderated') => {
    const revoked = await client.query<{ session_id: string }>(`
      update realm_sessions set revoked_at = now(), revoked_reason = $${params.length + 1}
      where ${where} and revoked_at is null returning session_id`, [...params, reason]);
    const ids = revoked.rows.map(row => row.session_id);
    if (ids.length) await client.query('update realm_tickets set consumed_at = now() where session_id = any($1::uuid[]) and consumed_at is null', [ids]);
    return ids.length;
  };

  return {
    provider,
    /** Fails unless the shared realm schema carries this service's migration. */
    async ready(): Promise<void> {
      const result = await database(() => pool.query("select 1 from realm_schema_migrations where id = $1", [REALM_AUTH_MIGRATION]));
      if (result.rowCount !== 1) throw new RealmAuthError('unavailable', 'The realm schema is not migrated. Run the realm migration first.');
    },

    async session(handle: string | null): Promise<RealmSessionReply> {
      const row = await database(() => liveSession(handle));
      if (!row || !handle) return { version: 1, status: 'anonymous' };
      return { version: 1, status: 'authenticated', expiresAt: Number(row.expires_ms), resumeScope: row.resume_scope, csrfToken: csrfFor(handle) };
    },

    /** Begins sign-in: one-use state and nonce bound to this server and to the browser's binding cookie. */
    async start(returnTo: string | null): Promise<{ location: string; binding: string }> {
      const path = safeReturnPath(returnTo);
      if (path === null) throw new RealmAuthError('refused', 'Sign-in can only return to a kingdom page', 400);
      const state = secret(), nonce = secret(), binding = secret();
      await database(async () => {
        await pool.query('delete from realm_sign_in_attempts where expires_at < now() - interval \'1 hour\'');
        const inserted = await pool.query(`
          insert into realm_sign_in_attempts (state_hash, nonce_hash, binding_hash, return_to, expires_at)
          select $1, $2, $3, $4, now() + $5 * interval '1 millisecond'
          where (select count(*) from realm_sign_in_attempts where consumed_at is null and expires_at > now()) < $6`,
        [sha256(state), sha256(nonce), sha256(binding), path, REALM_AUTH_LIMITS.attemptTtlMs, REALM_AUTH_LIMITS.openAttempts]);
        if (inserted.rowCount !== 1) throw new RealmAuthError('unavailable', 'Too many people are signing in at once. Try again in a minute.');
      });
      return { location: authorizationUrl(provider, { redirectUri, state, nonce }), binding };
    },

    /**
     * Finishes sign-in. The attempt is consumed before anything else, so a replayed callback can never mint a
     * second session. Only the verified subject chooses the person; query parameters other than code/state are
     * ignored. A previous session presented by the same browser is replaced, rotating its resume scope.
     */
    async callback(query: URLSearchParams, binding: string | null, previous: string | null): Promise<{ location: string; session: string | null }> {
      const state = query.get('state');
      if (!state || !binding || state.length > 128 || binding.length > 128) return { location: withSignin('/', 'expired'), session: null };
      const attempt = await database(async () => (await pool.query<{ binding_hash: Buffer; nonce_hash: Buffer; return_to: string; live: boolean }>(`
        update realm_sign_in_attempts set consumed_at = now() where state_hash = $1 and consumed_at is null
        returning binding_hash, nonce_hash, return_to, expires_at > now() as live`, [sha256(state)])).rows[0]);
      if (!attempt || !attempt.live || !sameHash(attempt.binding_hash, sha256(binding))) return { location: withSignin('/', 'expired'), session: null };
      const back = attempt.return_to;
      if (query.get('error')) return { location: withSignin(back, 'declined'), session: null };
      const code = query.get('code');
      if (!code || code.length > 512) return { location: withSignin(back, 'refused'), session: null };
      let identity;
      try {
        const idToken = await exchangeCode(provider, { code, redirectUri }, fetcher);
        identity = await verifyIdToken(idToken, { provider, keys, nonceHash: attempt.nonce_hash });
      } catch (error) {
        return { location: withSignin(back, error instanceof OidcError && error.kind === 'rejected' ? 'refused' : 'unavailable'), session: null };
      }
      const publicName = approvedPublicName(identity.preferredUsername);
      const handle = secret(), resumeScope = secret(24);
      try {
        await transaction(async client => {
          const person = await client.query<{ origin: string }>(`
            insert into realm_persons as p (person_id, origin, identity_issuer, public_name, name_approval, name_approved_at, last_sign_in_at)
            values ($1, $2, $3, $4::text, case when $4::text is null then null else $5 end, case when $4::text is null then null else now() end, now())
            on conflict (person_id) do update set last_sign_in_at = now(), public_name = excluded.public_name,
              name_approval = excluded.name_approval, name_approved_at = case when p.public_name is not distinct from excluded.public_name then p.name_approved_at else excluded.name_approved_at end
            where p.origin = excluded.origin and p.identity_issuer = excluded.identity_issuer
            returning origin`, [identity.subject, origin, provider.issuer, publicName, DISPLAY_NAME_APPROVAL]);
          if (person.rowCount !== 1) throw new RealmAuthError('refused', 'This person is held by another identity provider');
          if (previous) await revokeWhere(client, 'handle_hash = $1', [sha256(previous)], 'replaced');
          await client.query(`
            insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at)
            values ($1, $2, $3, $4, $5, now() + $6 * interval '1 millisecond')`,
          [randomUUID(), sha256(handle), identity.subject, origin, resumeScope, REALM_AUTH_LIMITS.sessionTtlMs]);
        });
      } catch (error) {
        return { location: withSignin(back, error instanceof RealmAuthError && error.status === 'refused' ? 'refused' : 'unavailable'), session: null };
      }
      return { location: back, session: handle };
    },

    /** Issues an opaque, hashed, one-use, short-lived ticket bound to this session, kingdom, protocol and origin. */
    async ticket(handle: string | null, csrf: string | null, requestedBy: string, body: unknown): Promise<RealmTicketReply> {
      const session = await database(() => liveSession(handle));
      if (!session || !handle) throw new RealmAuthError('unauthenticated', 'Sign in with Twitch to walk in this kingdom.');
      requireCsrf(handle, csrf);
      const request = RealmTicketRequestSchema.safeParse(body);
      if (!request.success) throw new RealmAuthError('refused', 'This entry request is malformed', 400);
      const ticket = secret();
      const issued = await database(() => pool.query<{ expires_ms: string }>(`
        insert into realm_tickets (ticket_hash, session_id, person_id, kingdom_id, protocol, origin, requested_by, expires_at)
        select $1, s.session_id, s.person_id, $3, $4, s.origin, $5, least(now() + $6 * interval '1 millisecond', s.expires_at)
        from realm_sessions s where s.session_id = $2 and s.revoked_at is null and s.expires_at > now()
          and (select count(*) from realm_tickets t where t.session_id = s.session_id and t.issued_at > now() - interval '1 minute') < $7
        returning floor(extract(epoch from expires_at) * 1000)::bigint::text as expires_ms`,
      [sha256(ticket), session.session_id, request.data.kingdomId, request.data.protocol, requestedBy, REALM_AUTH_LIMITS.ticketTtlMs, REALM_AUTH_LIMITS.ticketsPerMinute]));
      const row = issued.rows[0];
      if (!row) throw new RealmAuthError('refused', 'Too many entries were requested. Wait a moment, then walk in again.');
      return { version: 1, status: 'issued', join: { kingdomId: request.data.kingdomId, ticket, protocol: 1 }, expiresAt: Number(row.expires_ms) };
    },

    /** Revokes the session and every ticket it still holds. Idempotent for a browser whose session already ended. */
    async signout(handle: string | null, csrf: string | null): Promise<RealmSignoutReply> {
      const session = await database(() => liveSession(handle));
      if (session && handle) {
        requireCsrf(handle, csrf);
        await transaction(client => revokeWhere(client, 'session_id = $1', [session.session_id], 'signout'));
      }
      return { version: 1, status: 'signed-out' };
    },

    /** Internal revocation (moderation, account removal, compromise). Realm `current` checks see it at once. */
    revoke(target: { readonly personId: string } | { readonly sessionId: string }, reason: 'revoked' | 'moderated'): Promise<number> {
      return transaction(client => 'personId' in target
        ? revokeWhere(client, 'person_id = $1', [target.personId], reason)
        : revokeWhere(client, 'session_id = $1::uuid', [target.sessionId], reason));
    },

    /** Forgets finished sign-in attempts and spent tickets; ended sessions stay for 30 days as revocation evidence. */
    sweep(): Promise<void> {
      return database(async () => {
        await pool.query("delete from realm_sign_in_attempts where expires_at < now() - interval '1 hour'");
        await pool.query("delete from realm_tickets where expires_at < now() - interval '1 day'");
        // Entries end with their session; the session row itself stays as revocation evidence (below).
        await pool.query(`delete from realm_entries e using realm_sessions s
          where s.session_id = e.session_id and (s.revoked_at is not null or s.expires_at < now())`);
        await pool.query(`delete from realm_sessions s where coalesce(s.revoked_at, s.expires_at) < now() - interval '30 days'
          and not exists (select 1 from realm_tickets t where t.session_id = s.session_id)`);
      });
    },
  };
}
export type RealmAuthService = ReturnType<typeof createRealmAuthService>;
