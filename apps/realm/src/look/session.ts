import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { PersonIdSchema } from '@chatdom/shared';
import type { LookOrigin, LookSession, LookSessions } from './ports';

/*
 * The realm's read of the browser's Chatdom session. The API issues sessions and keeps only SHA-256 of the handle in
 * `realm_sessions.handle_hash`; the realm looks the hash up the same way, so a session ended, expired or of the other
 * origin is no session here. The CSRF derivation below is the API's (`apps/api/src/realm-auth/secrets.ts` `csrfFor`),
 * re-implemented so the realm never imports the API: a write must carry the token the API gave that same session.
 */

/** realm-auth refuses longer handles; its own are 43 characters. A Cookie header beyond 8 KB is not one our pages send. */
const HANDLE_LIMIT = 128, COOKIE_LIMIT = 8_192;

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The API's CSRF token for a session handle: derived under its own label, so it cannot be computed from the stored hash. */
export function csrfFor(handle: string): string {
  return createHash('sha256').update('chatdom.realm.csrf.v1\0').update(handle, 'utf8').digest('base64url');
}

/** Constant-time text comparison (hashes first, so lengths never leak). */
export function sameSecret(a: string, b: string): boolean {
  const x = sha256(a), y = sha256(b);
  return timingSafeEqual(x, y);
}

/**
 * The session cookie name, by the same rule the API uses: `__Host-chatdom_session` when the public origin is https,
 * `chatdom_session` on plain-HTTP loopback development (`REALM_PUBLIC_ORIGIN`, default `http://localhost:5190`).
 */
export function lookSessionCookie(publicOrigin: string | undefined): '__Host-chatdom_session' | 'chatdom_session' {
  let secure: boolean;
  // An origin that cannot be read is treated as a deployment: the stricter cookie.
  try { secure = new URL(publicOrigin ?? 'http://localhost:5190').protocol === 'https:'; } catch { secure = true; }
  return secure ? '__Host-chatdom_session' : 'chatdom_session';
}

/** The first value of `name` in a Cookie header (first occurrence wins, value trimmed), as realm-auth reads it. */
export function readCookie(header: string, name: string): string | undefined {
  if (!header || header.length > COOKIE_LIMIT) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return value.length > 0 && value.length <= HANDLE_LIMIT ? value : undefined;
  }
  return undefined;
}

/** Sessions from the shared realm schema: the same rows the kingdom entry trusts. */
export function createPostgresLookSessions(input: { readonly pool: Pool; readonly origin: LookOrigin; readonly cookie: string }): LookSessions {
  const { pool, origin, cookie } = input;
  return {
    async resolve(cookieHeader) {
      const handle = readCookie(cookieHeader, cookie);
      if (!handle) return null;
      const result = await pool.query<{ person_id: string }>(`
        SELECT s.person_id FROM realm_sessions s JOIN realm_persons p ON p.person_id = s.person_id
        WHERE s.handle_hash = $1 AND s.origin = $2 AND p.origin = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(handle), origin]);
      const person = PersonIdSchema.safeParse(result.rows[0]?.person_id);
      return person.success ? { personId: person.data, csrfToken: csrfFor(handle) } satisfies LookSession : null;
    },
  };
}
