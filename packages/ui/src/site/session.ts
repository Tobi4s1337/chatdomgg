import { SIGNIN_ROUTES } from './signin';

/**
 * Who this browser is, read from our own origin, and the kingdom the front page can walk into. Both answers are
 * checked by shape; anything unexpected reads as signed out or as no kingdom, never as a guess.
 */
export type Session =
  | { readonly status: 'anonymous' }
  | { readonly status: 'authenticated'; readonly csrfToken: string; readonly resumeScope: string; readonly name: string | null };
export interface OpenKingdom { readonly kingdomId: string; readonly name: string; readonly login: string }

const LOGIN = /^[a-z0-9_]{1,25}$/, ID = /^[1-9][0-9]{0,31}$/;

export function parseSession(body: unknown, now = Date.now()): Session {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.status !== 'authenticated' || typeof b.csrfToken !== 'string' || typeof b.resumeScope !== 'string'
    || typeof b.expiresAt !== 'number' || b.expiresAt <= now) return { status: 'anonymous' };
  // The reply names the person only once the sign-in service sends it; until then the seal says "signed in".
  const name = typeof b.name === 'string' && b.name.trim() && b.name.length <= 40 ? b.name.trim() : null;
  return { status: 'authenticated', csrfToken: b.csrfToken, resumeScope: b.resumeScope, name };
}

export function parseKingdoms(body: unknown): OpenKingdom[] {
  const list = body && typeof body === 'object' ? (body as { kingdoms?: unknown }).kingdoms : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap(raw => {
    const k = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return typeof k.kingdomId === 'string' && ID.test(k.kingdomId) && typeof k.login === 'string' && LOGIN.test(k.login)
      && typeof k.name === 'string' && k.name.trim() && k.name.length <= 80 ? [{ kingdomId: k.kingdomId, login: k.login, name: k.name.trim() }] : [];
  });
}

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
};
export const readSession = async (): Promise<Session> => parseSession(await getJson(SIGNIN_ROUTES.session));
export const readKingdoms = async (): Promise<OpenKingdom[]> => parseKingdoms(await getJson('/api/public/door'));

/** The walk page keeps reconnect seats per tab under this prefix; signing out forgets this session's seats. */
export function forgetSeats(resumeScope: string, store: Storage = sessionStorage): void {
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (!key?.startsWith('chatdom:realm:v1:')) continue;
    try { const parts: unknown = JSON.parse(key.slice('chatdom:realm:v1:'.length)); if (Array.isArray(parts) && parts[2] === resumeScope) store.removeItem(key); }
    catch { /* not a seat */ }
  }
}

export async function signOut(session: Extract<Session, { status: 'authenticated' }>): Promise<boolean> {
  const response = await fetch(SIGNIN_ROUTES.signout, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'X-CSRF-Token': session.csrfToken } });
  if (!response.ok) return false;
  try { forgetSeats(session.resumeScope); } catch { /* storage off */ }
  return true;
}
