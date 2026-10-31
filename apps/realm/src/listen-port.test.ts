import { expect, it } from 'vitest';
import { realmListenPort } from './listen-port';

it('binds the advertised local realm unless an explicit port wins, and rejects invalid listen ports', () => {
  expect(realmListenPort({ CHATDOM_REALM_TARGET: 'http://127.0.0.1:5197' })).toBe(5197);
  expect(realmListenPort({ REALM_PORT: '5185', CHATDOM_REALM_TARGET: 'http://127.0.0.1:5197' })).toBe(5185);
  expect(realmListenPort({})).toBe(5191);
  for (const env of [{ REALM_PORT: '' }, { REALM_PORT: '5197.5' }, { REALM_PORT: '80' },
    { CHATDOM_REALM_TARGET: 'http://127.0.0.1' }, { CHATDOM_REALM_TARGET: 'not a URL' }]) {
    expect(() => realmListenPort(env)).toThrow();
  }
});
