import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import { twitchOidc } from './oidc';
import { sha256 } from './secrets';
import { createRealmAuthService, safeReturnPath } from './service';

it('accepts only the plain root walking entry and emits its canonical parameter order', () => {
  const canonical = '/?walk=1&kingdom=129634568';
  expect(safeReturnPath(canonical)).toBe(canonical);
  expect(safeReturnPath('/?kingdom=129634568&walk=1')).toBe(canonical);
  for (const value of [
    '/?walk=1', '/?kingdom=129634568', '/?walk=0&kingdom=129634568', '/?walk=1&kingdom=tobi4s_',
    '/?walk=1&kingdom=0012', '/?walk=1&kingdom=0', '/?walk=1&kingdom=1&next=/map',
    '/?walk=1&kingdom=1&walk=1', '/?walk=1&kingdom=1&', '/?walk=1&&kingdom=1',
    '//evil.example/?walk=1&kingdom=1', 'https://evil.example/?walk=1&kingdom=1',
    '/\\evil.example/?walk=1&kingdom=1', '/tobi4s_?walk=1&kingdom=1',
    '/%3fwalk=1&kingdom=1', '/?%77alk=1&kingdom=1', '/?walk=%31&kingdom=1',
    '/?walk=1&kingdom=%31', '/?walk=1&kingdom=%2531', '/?walk=1&kingdom=1%26next=x',
    '/?walk=1&kingdom=1#', '/?walk=1&kingdom=1#fragment', '/?walk=1&kingdom=1\n',
    '/?walk=1&kingdom=1+00', '/?walk=1&kingdom=1;next=x',
  ]) expect(safeReturnPath(value), value).toBeNull();
});

it('appends a declined sign-in outcome with the correct separator on the actual callback path', async () => {
  for (const returnTo of ['/', '/tobi4s_', '/?walk=1&kingdom=129634568']) {
    const binding = 'test-browser-binding';
    const pool = { query: async () => ({ rows: [{ binding_hash: sha256(binding), nonce_hash: sha256('nonce'), return_to: returnTo, live: true }] }) } as unknown as Pool;
    const service = createRealmAuthService({ pool, provider: twitchOidc('test-client', 'test-secret'),
      keys: async () => { throw new Error('Declined sign-in must not verify a token'); },
      redirectUri: 'http://localhost:5190/api/realm/auth/callback' });
    const result = await service.callback(new URLSearchParams({ state: 'test-state', error: 'access_denied' }), binding, null);
    expect(result).toEqual({ location: `${returnTo}${returnTo.includes('?') ? '&' : '?'}signin=declined`, session: null });
    const location = new URL(result.location, 'http://localhost:5190');
    expect(location.searchParams.get('signin')).toBe('declined');
    if (returnTo.includes('?')) expect(Object.fromEntries(location.searchParams)).toEqual({ walk: '1', kingdom: '129634568', signin: 'declined' });
  }
});
