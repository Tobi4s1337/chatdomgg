import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { REALM_AUTH_ROUTES } from '@chatdom/shared/realm';
import { clearRealmScope, openRealmApiSession, realmSignInUrl, realmEntryFailureMessage, RealmEntryError } from './entry';

const K = KingdomIdSchema.parse('129634568');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000, resumeScope: 'opaque-scope-0123456789', csrfToken: 'c'.repeat(40) };
const memory = (): Storage => {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.get(k) ?? null,
    setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear() };
};

describe('realm API entry', () => {
  it('keeps the actual SDK failure and code readable without exposing entry credentials', () => {
    expect(realmEntryFailureMessage(Object.assign(new Error('Bad Gateway'), { code: 502 }))).toBe('Bad Gateway (code 502)');
    expect(realmEntryFailureMessage(new TypeError('The room has no walker'))).toBe('The room has no walker');
    expect(realmEntryFailureMessage({ message: 'Entry expired', code: 403 })).toBe('Entry expired (code 403)');
    expect(realmEntryFailureMessage(new Error('Failed https://localhost:5190/live-realm-data?ticket=private#token'))).not.toContain('private');
    expect(realmEntryFailureMessage('ticket=private')).toBe('ticket=[redacted]');
  });
  it('retries sign-in from a callback outcome using the canonical walk destination', () => {
    const link = new URL(realmSignInUrl('/?walk=1&kingdom=129634568&signin=declined'), 'http://localhost:5190');
    expect(link.searchParams.get('returnTo')).toBe('/?walk=1&kingdom=129634568');
  });
  it('reads the frozen session DTO and requests a fresh ticket only when asked, with CSRF and no-store', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let issued = 0;
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === REALM_AUTH_ROUTES.session) return json(200, session);
      if (url === REALM_AUTH_ROUTES.ticket) { issued++; return json(200, { version: 1, status: 'issued', join: { kingdomId: K, ticket: `ticket-${issued}-0123456789abcdef`, protocol: 1 }, expiresAt: Date.now() + 60_000 }); }
      return json(200, { version: 1, status: 'signed-out' });
    };
    const opened = await openRealmApiSession(K, fetcher);
    if (opened.status !== 'authenticated') throw new Error('expected a session');
    expect(opened.entry.resumeScope).toBe(session.resumeScope);
    expect(issued).toBe(0);
    const first = await opened.entry.ticket(), second = await opened.entry.ticket();
    expect(first.ticket).not.toBe(second.ticket);
    const ticketCall = calls.find(c => c.url === REALM_AUTH_ROUTES.ticket)!;
    expect(ticketCall.init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect((ticketCall.init!.headers as Record<string, string>)['X-CSRF-Token']).toBe(session.csrfToken);
    expect(JSON.parse(String(ticketCall.init!.body))).toEqual({ version: 1, kingdomId: K, protocol: 1 });
    expect(calls.every(c => c.init?.cache === 'no-store')).toBe(true);

    // Signout disposes the client and clears every reconnect seat of this scope only.
    const storage = memory();
    storage.setItem(`chatdom:realm:v1:${JSON.stringify(['http://realm', K, session.resumeScope])}`, 'seat');
    storage.setItem(`chatdom:realm:v1:${JSON.stringify(['http://realm', K, 'another-scope-0123456'])}`, 'other');
    let disposed = false;
    await opened.signOut({ dispose: () => { disposed = true; } } as never, storage);
    expect(disposed).toBe(true);
    expect(storage.length).toBe(1);
  });

  it('fails truthfully: anonymous, strict DTOs, wrong kingdom, API errors', async () => {
    const anonymous = await openRealmApiSession(K, async () => json(200, { version: 1, status: 'anonymous' }));
    expect(anonymous.status).toBe('anonymous');
    if (anonymous.status === 'anonymous') expect(anonymous.signInUrl('/k/129634568')).toBe(`${REALM_AUTH_ROUTES.start}?returnTo=%2Fk%2F129634568`);
    expect(() => realmSignInUrl('//evil.example')).toThrow(RealmEntryError);
    await expect(openRealmApiSession(K, async () => json(200, { ...session, personId: '1' }))).rejects.toThrow(RealmEntryError);
    const wrong = await openRealmApiSession(K, async url => url === REALM_AUTH_ROUTES.session ? json(200, session)
      : json(200, { version: 1, status: 'issued', join: { kingdomId: '129634569', ticket: 'ticket-0123456789abcdef', protocol: 1 }, expiresAt: Date.now() + 60_000 }));
    if (wrong.status !== 'authenticated') throw new Error('expected a session');
    await expect(wrong.entry.ticket()).rejects.toThrow('another kingdom');
    const refused = await openRealmApiSession(K, async url => url === REALM_AUTH_ROUTES.session ? json(200, session) : json(401, { version: 1, status: 'unauthenticated', message: 'Your visit has ended. Sign in again.' }));
    if (refused.status !== 'authenticated') throw new Error('expected a session');
    await expect(refused.entry.ticket()).rejects.toMatchObject({ status: 'unauthenticated', message: 'Your visit has ended. Sign in again.' });
    await expect(openRealmApiSession(K, async () => { throw new TypeError('offline'); })).rejects.toMatchObject({ status: 'unavailable' });
  });
});

describe('clearRealmScope', () => {
  it('ignores keys that are not reconnect seats', () => {
    const storage = memory();
    storage.setItem('chatdom:realm:v1:not-json', 'x'); storage.setItem('elsewhere', 'y');
    clearRealmScope(storage, 'opaque-scope-0123456789');
    expect(storage.length).toBe(2);
  });
});
