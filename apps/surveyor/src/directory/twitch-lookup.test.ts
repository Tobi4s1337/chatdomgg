import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTwitchLookup, LookupUnavailable, twitchLookupFromEnv, type TwitchLookup } from './twitch-lookup';

// All identities and responses in this test are SIMULATED; no requests leave the process.
const DAY = 86_400_000;
const cleanup: TwitchLookup[] = [];
afterEach(() => { cleanup.splice(0).forEach(value => value.close()); vi.useRealTimers(); });
function fixture() {
  let time = 1_800_000_000_000;
  let remaining = 700;
  let fail = 0;
  let missing = false;
  const calls: URL[] = [];
  const user = { id: '123', login: 'simulated_channel', display_name: 'SIMULATED Channel', profile_image_url: 'https://static-cdn.jtvnw.net/simulated.png' };
  const fetch = vi.fn(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'SIMULATED_TOKEN', token_type: 'bearer', expires_in: 100_000 });
    if (url.pathname === '/oauth2/validate') return Response.json({ client_id: 'SIMULATED_CLIENT', expires_in: 100_000, scopes: [] });
    calls.push(url);
    const headers = { 'Ratelimit-Remaining': String(remaining), 'Ratelimit-Reset': String(Math.ceil((time + 60_000) / 1000)) };
    if (fail) return new Response(null, { status: fail, headers });
    let data: unknown[] = [];
    if (url.pathname.endsWith('/users') && !missing) data = [user];
    if (url.pathname.endsWith('/search/channels') && !missing) data = [{ id: user.id }];
    if (url.pathname.endsWith('/channels') && !url.pathname.includes('/search/')) data = [{ broadcaster_id: user.id, broadcaster_language: 'en', game_id: '456', game_name: 'SIMULATED Game', title: 'SIMULATED Title' }];
    if (url.pathname.endsWith('/streams')) data = [{ user_id: user.id, type: 'live', viewer_count: 12, started_at: '2027-01-15T08:00:00Z' }];
    return Response.json({ data }, { headers });
  });
  const lookup = createTwitchLookup({ clientId: 'SIMULATED_CLIENT', clientSecret: 'SIMULATED_SECRET', fetch, now: () => time, random: () => 0.5 });
  cleanup.push(lookup);
  return { lookup, calls, fetch, advance: (ms: number) => { time += ms; }, remaining: (value: number) => { remaining = value; }, fail: (value: number) => { fail = value; }, missing: (value: boolean) => { missing = value; } };
}
describe('public Twitch channel lookup', () => {
  it('gets exact identity, language/game, portrait and live state using public reads, then caches for a day', async () => {
    const f = fixture();
    const facts = await f.lookup.lookup('SIMULATED_CHANNEL');
    expect(facts).toMatchObject([{ id: '123', login: 'simulated_channel', language: 'en', gameId: '456', live: true, viewers: 12, avatarUrl: 'https://static-cdn.jtvnw.net/simulated.png' }]);
    expect(f.calls.map(url => url.pathname)).toEqual(['/helix/users', '/helix/channels', '/helix/streams']);
    facts[0]!.name = 'mutated';
    f.advance(DAY - 1);
    expect((await f.lookup.lookup('simulated_channel'))[0]!.name).toBe('SIMULATED Channel');
    expect(f.calls).toHaveLength(3);
    f.advance(2);
    await f.lookup.lookup('simulated_channel');
    expect(f.calls).toHaveLength(6);
  });
  it('hydrates partial search and preserves numeric logins while explicit IDs use id parameters', async () => {
    const f = fixture();
    await f.lookup.lookup('SIMULATED Channel');
    expect(f.calls[0]!.pathname).toBe('/helix/search/channels');
    expect(f.calls[0]!.searchParams.get('live_only')).toBe('false');
    expect(f.calls[1]!.searchParams.get('id')).toBe('123');
    await f.lookup.lookup('4567');
    expect(f.calls[4]!.searchParams.get('login')).toBe('4567');
    await f.lookup.lookup('id:123');
    expect(f.calls).toHaveLength(7); // ID alias was cached when the login was resolved.
  });
  it('answers a batch of IDs in two public reads, naming the IDs Twitch does not know as absent, without live state or caching', async () => {
    const f = fixture();
    const answer = await f.lookup.channels!(['123', '999', '123', 'not-an-id']);
    expect(answer.absent).toEqual(['999']);
    expect(answer.found).toMatchObject([{ id: '123', login: 'simulated_channel', language: 'en', gameId: '456', live: false, viewers: null }]);
    expect(f.calls.map(url => url.pathname)).toEqual(['/helix/users', '/helix/channels']);
    expect(f.calls[0]!.searchParams.getAll('id')).toEqual(['123', '999']);
    // A batch answer never stands in for a search answer, which carries live state.
    await f.lookup.lookup('id:123');
    expect(f.calls).toHaveLength(5);
    f.missing(true);
    expect(await f.lookup.channels!(['555'])).toEqual({ found: [], absent: ['555'] });
    f.remaining(150);
    await f.lookup.channels!(['555']);
    await expect(f.lookup.channels!(['555'])).rejects.toMatchObject({ reason: 'limited' });
  });
  it('caches absent logins for one hour and deduplicates concurrent misses', async () => {
    const f = fixture(); f.missing(true);
    const [one, two] = await Promise.all([f.lookup.lookup('simulated_missing'), f.lookup.lookup('simulated_missing')]);
    expect(one).toEqual([]); expect(two).toEqual([]); expect(f.calls).toHaveLength(2);
    f.advance(3_599_999); await f.lookup.lookup('simulated_missing'); expect(f.calls).toHaveLength(2);
    f.advance(2); await f.lookup.lookup('simulated_missing'); expect(f.calls).toHaveLength(4);
  });
  it('resolves an internal strict login without partial neighbours and caches its absence for an hour', async () => {
    const f = fixture(); f.missing(true);
    expect(await f.lookup.lookup('login:simulated_missing')).toEqual([]);
    expect(f.calls.map(url => url.pathname)).toEqual(['/helix/users']);
    expect(f.calls[0]!.searchParams.get('login')).toBe('simulated_missing');
    expect(f.lookup.cached?.('LOGIN:SIMULATED_MISSING')).toBe(true);
    await f.lookup.lookup('login:simulated_missing'); expect(f.calls).toHaveLength(1);
    f.advance(3_600_000); expect(f.lookup.cached?.('login:simulated_missing')).toBe(false);
    await f.lookup.lookup('login:simulated_missing'); expect(f.calls).toHaveLength(2);
    expect(await f.lookup.lookup('login:invalid login')).toEqual([]);
    expect(await f.lookup.lookup('login:')).toEqual([]);
    expect(await f.lookup.lookup(`login:${'a'.repeat(51)}`)).toEqual([]);
    expect(f.calls).toHaveLength(2);
  });
  it('shares successful strict login aliases for a day with ordinary login lookups', async () => {
    const f = fixture();
    await f.lookup.lookup('login:simulated_channel');
    expect(f.calls.map(url => url.pathname)).toEqual(['/helix/users', '/helix/channels', '/helix/streams']);
    expect(f.lookup.cached?.('login:simulated_channel')).toBe(true);
    await f.lookup.lookup('simulated_channel'); expect(f.calls).toHaveLength(3);
    f.advance(DAY); expect(f.lookup.cached?.('login:simulated_channel')).toBe(false);
    await f.lookup.lookup('simulated_channel');
    expect(f.lookup.cached?.('login:simulated_channel')).toBe(true);
    await f.lookup.lookup('login:simulated_channel'); expect(f.calls).toHaveLength(6);
  });
  it('reports cache admission without fetching, including aliases, negative answers and exact expiry', async () => {
    const f = fixture();
    expect(f.lookup.cached?.('simulated_channel')).toBe(false);
    expect(f.calls).toHaveLength(0);
    await f.lookup.lookup('simulated_channel');
    expect(f.lookup.cached?.('  SIMULATED_CHANNEL  ')).toBe(true);
    expect(f.lookup.cached?.('id:123')).toBe(true);
    expect(f.calls).toHaveLength(3);
    f.missing(true);
    await f.lookup.lookup('simulated_missing');
    expect(f.lookup.cached?.('simulated_missing')).toBe(true);
    f.advance(3_600_000);
    expect(f.lookup.cached?.('simulated_missing')).toBe(false);
    expect(f.lookup.cached?.('simulated_channel')).toBe(true);
    f.advance(DAY - 3_600_000);
    expect(f.lookup.cached?.('simulated_channel')).toBe(false);
    expect(f.lookup.cached?.('id:123')).toBe(false);
    expect(f.calls).toHaveLength(5);
    f.lookup.close(); expect(f.lookup.cached?.('simulated_channel')).toBe(false);
  });
  it('stops before another request at the reserve floor and resumes after the reported reset', async () => {
    const f = fixture(); f.remaining(199);
    await expect(f.lookup.lookup('simulated_channel')).rejects.toMatchObject({ reason: 'limited' });
    expect(f.calls).toHaveLength(1);
    await expect(f.lookup.lookup('another_channel')).rejects.toMatchObject({ reason: 'limited' });
    expect(f.calls).toHaveLength(1);
    f.advance(60_001); f.remaining(700);
    await f.lookup.lookup('another_channel'); expect(f.calls).toHaveLength(4);
  });
  it('spends at most sixty actual Helix attempts per rolling minute, then fails fast', async () => {
    const f = fixture(); f.missing(true);
    for (let i = 0; i < 30; i++) await f.lookup.lookup(`simulated_missing_${i}`);
    expect(f.calls).toHaveLength(60);
    await expect(f.lookup.lookup('simulated_over_limit')).rejects.toMatchObject({ reason: 'limited', retryAfter: 60 });
    expect(f.calls).toHaveLength(60);
    f.advance(60_001); await f.lookup.lookup('simulated_over_limit'); expect(f.calls).toHaveLength(62);
  });
  it.each([429, 500, 503])('backs off a %i without retrying or caching a false absence', async status => {
    const f = fixture(); f.fail(status);
    await expect(f.lookup.lookup('simulated_channel')).rejects.toBeInstanceOf(LookupUnavailable);
    expect(f.calls).toHaveLength(1);
    await expect(f.lookup.lookup('simulated_channel')).rejects.toBeInstanceOf(LookupUnavailable);
    expect(f.calls).toHaveLength(1);
    f.fail(0); f.advance(60_001);
    expect(await f.lookup.lookup('simulated_channel')).toHaveLength(1); expect(f.calls).toHaveLength(4);
  });
  it('keeps successful cache answers available through upstream backoff', async () => {
    const f = fixture(); await f.lookup.lookup('simulated_channel'); f.fail(500);
    await expect(f.lookup.lookup('another_channel')).rejects.toMatchObject({ reason: 'upstream' });
    expect(await f.lookup.lookup('simulated_channel')).toHaveLength(1); expect(f.calls).toHaveLength(4);
  });
  it('validates a held token hourly and cancels maintenance on close', async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.lookup.lookup('simulated_channel');
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith('/oauth2/validate'))).toHaveLength(1);
    f.advance(3_600_000); await vi.advanceTimersByTimeAsync(3_600_000);
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith('/oauth2/validate'))).toHaveLength(2);
    f.lookup.close(); expect(vi.getTimerCount()).toBe(0);
    await expect(f.lookup.lookup('simulated_channel')).rejects.toMatchObject({ reason: 'disabled' });
  });
  it('disables only the lookup when credentials are missing or incomplete', async () => {
    await expect(twitchLookupFromEnv({}).lookup('simulated_channel')).rejects.toMatchObject({ reason: 'disabled' });
    await expect(twitchLookupFromEnv({ TWITCH_CLIENT_ID: 'SIMULATED_CLIENT' }).lookup('simulated_channel')).rejects.toMatchObject({ reason: 'disabled' });
  });
});
