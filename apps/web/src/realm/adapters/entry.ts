import { REALM_AUTH_ROUTES, RealmApiErrorSchema, RealmSessionReplySchema, RealmSignoutReplySchema, RealmTicketReplySchema,
  RealmTicketRequestSchema, type RealmApiError, type RealmJoin } from '@chatdom/shared/realm';
import type { KingdomId } from '@chatdom/shared';
import type { RealmClient, RealmEntry } from '../client';

/** A truthful entry failure in the kingdom's own words. Never a reason to mount another court. */
export class RealmEntryError extends Error {
  constructor(readonly status: RealmApiError['status'], message: string) { super(message); this.name = 'RealmEntryError'; }
}

export type RealmApiSession =
  | { readonly status: 'anonymous'; signInUrl(returnTo: string): string }
  | { readonly status: 'authenticated'; readonly expiresAt: number; readonly entry: RealmEntry;
      /** Revokes the API session, disposes the room client and clears this scope's reconnect seats. */
      signOut(client?: RealmClient | null, storage?: Storage): Promise<void> };

export type RealmFetch = (input: string, init?: RequestInit) => Promise<Response>;
const PRIVATE: RequestInit = { credentials: 'same-origin', cache: 'no-store' };

async function failure(response: Response, fallback: string): Promise<RealmEntryError> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* an unreadable error stays a generic unavailable gate */ }
  const parsed = RealmApiErrorSchema.safeParse(body);
  if (parsed.success) return new RealmEntryError(parsed.data.status, parsed.data.message);
  return new RealmEntryError(response.status === 401 ? 'unauthenticated' : response.status === 403 || response.status === 400 ? 'refused' : 'unavailable', fallback);
}

/** Only a local kingdom path may be a return destination; the API validates it again. */
export function realmSignInUrl(returnTo: string): string {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) throw new RealmEntryError('refused', 'That gate leads somewhere outside Chatdom.');
  return `${REALM_AUTH_ROUTES.start}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Clears every reconnect seat stored for one opaque API session scope (all endpoints and kingdoms). */
export function clearRealmScope(storage: Storage, resumeScope: string): void {
  const prefix = 'chatdom:realm:v1:';
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try { const parts: unknown = JSON.parse(key.slice(prefix.length)); if (Array.isArray(parts) && parts[2] === resumeScope) storage.removeItem(key); }
    catch { /* not ours */ }
  }
}

/**
 * Reads the same-origin Chatdom session and, when signed in, builds the frozen `RealmEntry`: the
 * session's opaque `resumeScope` keys reconnect storage, and each fresh entry lazily requests a new
 * single-use ticket. A ticket authorizes entry only; it never chooses a home, trust or coal.
 */
export async function openRealmApiSession(kingdomId: KingdomId, fetcher: RealmFetch = (input, init) => fetch(input, init), signal?: AbortSignal): Promise<RealmApiSession> {
  let response: Response;
  try { response = await fetcher(REALM_AUTH_ROUTES.session, { ...PRIVATE, ...(signal ? { signal } : {}), method: 'GET', headers: { Accept: 'application/json' } }); }
  catch { throw new RealmEntryError('unavailable', 'The kingdom gate cannot be reached right now.'); }
  if (!response.ok) throw await failure(response, 'The kingdom gate cannot read your visit right now.');
  const session = RealmSessionReplySchema.safeParse(await response.json().catch(() => null));
  if (!session.success) throw new RealmEntryError('unavailable', 'The kingdom gate answered in a way we cannot trust.');
  if (session.data.status === 'anonymous') return { status: 'anonymous', signInUrl: realmSignInUrl };
  const { csrfToken, resumeScope, expiresAt } = session.data;
  if (expiresAt <= Date.now()) throw new RealmEntryError('unauthenticated', 'Your visit has ended. Sign in with Twitch again.');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
  const entry: RealmEntry = {
    kingdomId, resumeScope,
    async ticket(): Promise<RealmJoin> {
      const body = RealmTicketRequestSchema.parse({ version: 1, kingdomId, protocol: 1 });
      let reply: Response;
      try { reply = await fetcher(REALM_AUTH_ROUTES.ticket, { ...PRIVATE, ...(signal ? { signal } : {}), method: 'POST', headers, body: JSON.stringify(body) }); }
      catch { throw new RealmEntryError('unavailable', 'The kingdom gate cannot be reached right now.'); }
      if (!reply.ok) throw await failure(reply, 'The kingdom gate did not open.');
      const issued = RealmTicketReplySchema.safeParse(await reply.json().catch(() => null));
      if (!issued.success || issued.data.join.kingdomId !== kingdomId) throw new RealmEntryError('unavailable', 'The gate offered an entry for another kingdom.');
      if (issued.data.expiresAt <= Date.now()) throw new RealmEntryError('unavailable', 'The gate entry expired before you reached it. Try again.');
      return issued.data.join;
    },
  };
  return {
    status: 'authenticated', expiresAt, entry,
    async signOut(client, storage) {
      client?.dispose();
      if (storage) clearRealmScope(storage, resumeScope);
      let reply: Response;
      try { reply = await fetcher(REALM_AUTH_ROUTES.signout, { ...PRIVATE, ...(signal ? { signal } : {}), method: 'POST', headers }); }
      catch { throw new RealmEntryError('unavailable', 'You left the kingdom here, but the gate could not be told. Try signing out again.'); }
      if (!reply.ok) throw await failure(reply, 'You left the kingdom here, but the gate could not be told. Try signing out again.');
      if (!RealmSignoutReplySchema.safeParse(await reply.json().catch(() => null)).success) throw new RealmEntryError('unavailable', 'The gate answered in a way we cannot trust.');
    },
  };
}
