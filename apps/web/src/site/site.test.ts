import { describe, expect, it } from 'vitest';
import { REALM_AUTH_ROUTES } from '@chatdom/shared/realm';
import { RETURN_VIEW_KEY, rememberReturnView, takeReturnView } from './return-view';
import { forgetSeats, parseKingdoms, parseSession } from './session';
import { SIGNIN_NOTICES, SIGNIN_ROUTES, readOutcome, signInHref, signInReturnPath } from './signin';

/** A Storage in memory, as sessionStorage behaves. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: key => { items.delete(key); },
    clear: () => items.clear(),
  };
}

describe('the sign-in seal’s address', () => {
  it('speaks the frozen sign-in routes', () => {
    expect(SIGNIN_ROUTES.session).toBe(REALM_AUTH_ROUTES.session);
    expect(SIGNIN_ROUTES.start).toBe(REALM_AUTH_ROUTES.start);
    expect(SIGNIN_ROUTES.signout).toBe(REALM_AUTH_ROUTES.signout);
  });

  it('returns to the same page where sign-in can, and to the front page where it cannot', () => {
    for (const path of ['/', '/imprint', '/privacy', '/terms', '/map', '/map/tobi4s_']) expect(signInReturnPath(path), path).toBe(path);
    // The sign-in service refuses hyphenated first segments; the stored view carries the visitor on from /.
    for (const path of ['/how-it-works', '/-/grand', '/Map', '/a/b/c/d/e']) expect(signInReturnPath(path), path).toBe('/');
    expect(signInHref('/privacy')).toBe('/api/realm/auth/start?returnTo=%2Fprivacy');
    expect(signInHref('/how-it-works')).toBe('/api/realm/auth/start?returnTo=%2F');
  });

  it('reads each way back from Twitch and nothing else', () => {
    for (const outcome of ['declined', 'expired', 'refused', 'unavailable'] as const) {
      expect(readOutcome(`?signin=${outcome}`)).toBe(outcome);
      expect(SIGNIN_NOTICES[outcome].length).toBeGreaterThan(20);
    }
    for (const search of ['', '?signin=ok', '?signin=', '?signin=DECLINED', '?other=declined']) expect(readOutcome(search), search).toBeNull();
  });
});

describe('the view kept across the trip to Twitch', () => {
  it('comes back once, as it was left', () => {
    const store = memory();
    rememberReturnView({ path: '/', section: 'atlas', view: { x: 1, zoom: 2 } }, store, 1_000);
    expect(takeReturnView(store, 2_000)).toEqual({ path: '/', section: 'atlas', view: { x: 1, zoom: 2 } });
    expect(takeReturnView(store, 2_000)).toBeNull();
    expect(store.getItem(RETURN_VIEW_KEY)).toBeNull();
  });

  it('keeps a rounded scroll position for pages without sections', () => {
    const store = memory();
    rememberReturnView({ path: '/privacy', scrollY: 1234.6 }, store, 0);
    expect(takeReturnView(store, 0)).toEqual({ path: '/privacy', scrollY: 1235 });
  });

  it('forgets a view older than a sign-in can take', () => {
    const store = memory();
    rememberReturnView({ path: '/', section: 'forge' }, store, 0);
    expect(takeReturnView(store, 15 * 60_000 + 1)).toBeNull();
    expect(store.getItem(RETURN_VIEW_KEY)).toBeNull();
  });

  it('refuses anything that is not a plain path on this origin, or not well formed', () => {
    const store = memory();
    for (const path of ['https://evil.example/', '//evil.example', '/a?b=1', '/a#b', 'privacy']) {
      rememberReturnView({ path }, store, 0);
      expect(store.getItem(RETURN_VIEW_KEY), path).toBeNull();
    }
    rememberReturnView({ path: '/', section: '"><script>' }, store, 0);
    expect(takeReturnView(store, 0)).toEqual({ path: '/' });
    for (const raw of ['not json', '[]', '{"path":"//evil","at":0}', '{"path":"/"}', '{"path":"/","at":120001}']) {
      store.setItem(RETURN_VIEW_KEY, raw);
      expect(takeReturnView(store, 0), raw).toBeNull();
    }
  });

  it('carries on without storage', () => {
    expect(() => rememberReturnView({ path: '/' }, null)).not.toThrow();
    expect(takeReturnView(null)).toBeNull();
  });
});

describe('the session as the seal reads it', () => {
  const AUTH = { version: 1, status: 'authenticated', expiresAt: 10_000, resumeScope: 'scope-0123456789abcdef', csrfToken: 'c'.repeat(32) };

  it('reads a signed-in session, with the name once the reply carries one', () => {
    expect(parseSession(AUTH, 0)).toEqual({ status: 'authenticated', csrfToken: AUTH.csrfToken, resumeScope: AUTH.resumeScope, name: null });
    expect(parseSession({ ...AUTH, name: ' tobi4s_ ' }, 0)).toMatchObject({ name: 'tobi4s_' });
  });

  it('reads anything else as signed out', () => {
    for (const body of [null, 'x', {}, { version: 1, status: 'anonymous' }, { ...AUTH, csrfToken: 1 }, { ...AUTH, expiresAt: 'soon' }]) {
      expect(parseSession(body, 0)).toEqual({ status: 'anonymous' });
    }
    expect(parseSession(AUTH, 10_000)).toEqual({ status: 'anonymous' });
  });

  it('keeps only well-formed kingdoms from the door data', () => {
    expect(parseKingdoms({ version: 1, kingdoms: [
      { kingdomId: '129634568', name: ' Willowmere ', login: 'tobi4s_' },
      { kingdomId: '0123', name: 'Bad id', login: 'x' },
      { kingdomId: '1', name: '', login: 'x' },
      { kingdomId: '2', name: 'Bad login', login: 'Not A Login' },
      null,
    ] })).toEqual([{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }]);
    expect(parseKingdoms(null)).toEqual([]);
    expect(parseKingdoms({ kingdoms: 'x' })).toEqual([]);
  });

  it('forgets only this session’s reconnect seats on sign-out', () => {
    const store = memory();
    const seat = (scope: string) => `chatdom:realm:v1:${JSON.stringify(['http://realm', '1001', scope])}`;
    store.setItem(seat('mine'), 'a');
    store.setItem(seat('theirs'), 'b');
    store.setItem('chatdom:realm:v1:not json', 'c');
    store.setItem('other', 'd');
    forgetSeats('mine', store);
    expect(store.getItem(seat('mine'))).toBeNull();
    expect(store.getItem(seat('theirs'))).toBe('b');
    expect(store.getItem('chatdom:realm:v1:not json')).toBe('c');
    expect(store.getItem('other')).toBe('d');
  });
});
