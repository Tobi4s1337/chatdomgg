import { describe, expect, it, vi } from 'vitest';
import { csrfFor } from '../realm-auth/secrets';
import { dockMutationAllowed, dockPrincipal, type DockSessionPool } from './auth';

describe('dock session security', () => {
  it('uses the deployment cookie and a live, origin-bound database lookup', async () => {
    const query = vi.fn<DockSessionPool['query']>(async () => ({ rows: [{ person_id: '42', session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }));
    expect(await dockPrincipal({ query }, 'live', true, '__Host-chatdom_session=secret')).toMatchObject({ principal: { personId: '42' } });
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at is null and expires_at > now()');
    expect(await dockPrincipal({ query }, 'live', true, 'chatdom_session=secret')).toBeNull();
  });
  it('refuses forged identities and requires both same origin and session CSRF', async () => {
    expect(await dockPrincipal({ query: async () => ({ rows: [{ person_id: 'no', session_id: 'bad' }] }) }, 'live', false, 'chatdom_session=secret')).toBeNull();
    const headers = { origin: 'https://chatdom.gg', 'x-csrf-token': csrfFor('secret') };
    expect(dockMutationAllowed(headers, 'https://chatdom.gg', 'secret')).toBe(true);
    expect(dockMutationAllowed({ ...headers, origin: 'https://evil.test' }, 'https://chatdom.gg', 'secret')).toBe(false);
    expect(dockMutationAllowed({ ...headers, 'sec-fetch-site': 'cross-site' }, 'https://chatdom.gg', 'secret')).toBe(false);
    expect(dockMutationAllowed(headers, 'https://chatdom.gg', 'different')).toBe(false);
  });
});

it('uses only the first duplicate cookie and passes the deployment origin to the session lookup', async () => {
  const query = vi.fn<DockSessionPool['query']>(async () => ({ rows: [] }));
  await dockPrincipal({ query }, 'simulated', false, 'chatdom_session=first; chatdom_session=second');
  expect(query.mock.calls[0]?.[1][1]).toBe('simulated');
  const other = vi.fn<DockSessionPool['query']>(async () => ({ rows: [] }));
  await dockPrincipal({ query: other }, 'simulated', false, 'chatdom_session=first');
  expect(query.mock.calls[0]?.[1][0]).toEqual(other.mock.calls[0]?.[1][0]);
});
