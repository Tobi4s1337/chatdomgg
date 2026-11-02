import { describe, expect, it } from 'vitest';
import { acknowledgesDisclosure } from '../../../../packages/ui/src/passport/session';
import { gateTravelsOwner } from './gate-owner';

const session = (csrfToken: string) => ({ version: 1, status: 'authenticated', expiresAt: 1_900_000_000_000, resumeScope: 'scope-for-the-bench-0001', csrfToken });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the holder’s clasp over the gate’s record of the choice', () => {
  it('posts the choice with the session’s CSRF token and answers the committed disclosure', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const owner = gateTravelsOwner({ fetch: async (url, init) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return String(url) === '/api/realm/session'
        ? json(session('c'.repeat(40)))
        : json({ version: 1, origin: 'simulated', travels: 'hidden', revision: 1_800_000_000_500 });
    } });
    const answer = await owner.setTravels('hidden', new AbortController().signal);
    expect(answer).toEqual({ origin: 'simulated', travels: 'hidden', revision: 1_800_000_000_500 });
    expect(acknowledgesDisclosure({ origin: 'simulated', travels: 'shown', revision: 1_800_000_000_000 }, 'hidden', answer)).toBe(true);
    expect(calls[1]).toMatchObject({ url: '/api/raid-gate/passport/travels', init: { method: 'POST', body: JSON.stringify({ version: 1, travels: 'hidden' }) } });
    expect((calls[1]!.init!.headers as Record<string, string>)['x-csrf-token']).toBe('c'.repeat(40));
  });

  it('claims nothing when signed out or refused', async () => {
    const signedOut = gateTravelsOwner({ fetch: async () => json({ version: 1, status: 'anonymous' }) });
    await expect(signedOut.setTravels('hidden', new AbortController().signal)).rejects.toThrow();
    let n = 0;
    const refused = gateTravelsOwner({ fetch: async () => (n++ === 0
      ? json(session('d'.repeat(40)))
      : json({ version: 1, status: 'refused' }, 403)) });
    await expect(refused.setTravels('hidden', new AbortController().signal)).rejects.toThrow('403');
  });
});
