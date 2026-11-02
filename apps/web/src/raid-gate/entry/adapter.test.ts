import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomEntryConnection } from '../../kingdom-entry/types';
import { RealmEntryError } from '../../realm/adapters/entry';
import { createRaidWelcomeEntry, type RaidWelcomeStatus } from './adapter';

// SIMULATED checked transport and room; no Twitch or realm writes.
const kingdomId = KingdomIdSchema.parse('129634568'), raidId = `raid.${'a'.repeat(64)}`;
const pathname = `/raid/${kingdomId}/${'a'.repeat(32)}/${'a'.repeat(32)}`;
const now = 1_800_000_000_000;
const from = { kingdomId: KingdomIdSchema.parse('23'), login: 'raider', name: 'Raider' };
const to = { kingdomId, login: 'host_channel', name: 'Host Channel' };
const session = { version: 1, status: 'authenticated', csrfToken: 'c'.repeat(32), resumeScope: 's'.repeat(32), expiresAt: now + 60_000 };
const invitation = { raidId, kingdomId, from, expiresAt: now + 60_000 };
const projection = { version: 1, origin: 'live', raidId, kingdomId, from, to, personId: PersonIdSchema.parse('44'),
  entryId: '11111111-1111-4111-8111-111111111111', arrivedAt: now, raidOccurredAt: now - 1_000 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(overrides: { session?: unknown; begin?: unknown; read?: unknown; status?: number; opening?: Promise<KingdomEntryConnection>;
  origin?: 'live' | 'simulated'; infoOrigin?: string; roomOrigin?: string } = {}) {
  const events: string[] = [], statuses: RaidWelcomeStatus[] = [];
  const dispose = vi.fn();
  const connection = { client: { selfId: 'self', room: { state: { kingdomId, origin: overrides.roomOrigin ?? 'live', walkers: new Map([['self', { name: 'Ash' }]]) } } }, dispose } as unknown as KingdomEntryConnection;
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const event = path.endsWith('/session') ? 'session' : path.includes('/entry/') ? 'info' : init?.method === 'POST' ? 'begin' : 'read';
    events.push(event);
    if (event === 'session') return json(overrides.session ?? session);
    if (event === 'info') return json({ version: 1, kingdomId, origin: overrides.infoOrigin ?? 'live', name: 'Lanternmere' });
    if (event === 'begin') return json(overrides.begin ?? { version: 1, status: 'pending', invitation }, overrides.status ?? 200);
    return json(overrides.read ?? { version: 1, guest: null });
  });
  const openKingdom = vi.fn((info: { kingdomName: string }) => async () => {
    expect(info.kingdomName).toBe('Lanternmere'); events.push('open');
    return overrides.opening ? overrides.opening : connection;
  });
  const entry = createRaidWelcomeEntry({ pathname, fetcher, openKingdom, status: value => statuses.push(value), now: () => now,
    pollMs: 1, confirmationMs: 3, ...(overrides.origin ? { origin: overrides.origin } : {}) });
  return { entry, events, statuses, fetcher, openKingdom, connection, dispose };
}

describe('the raid welcome-link entry adapter', () => {
  it('records a CSRF-bound intent before standard entry and greets only a committed guest with the room’s own name', async () => {
    const test = harness({ read: { version: 1, guest: projection } });
    const connection = await test.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(test.statuses.at(-1)?.kind).toBe('confirmed'));
    expect(test.events).toEqual(['session', 'info', 'begin', 'open', 'read']);
    expect(test.fetcher.mock.calls.find(call => call[1]?.method === 'POST')?.[1]).toMatchObject({ credentials: 'same-origin',
      headers: { 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify({ version: 1, raidId }) });
    expect(test.statuses.at(-1)).toMatchObject({ message: 'Welcome, Ash, with Raider’s raid.', watchUrl: 'https://www.twitch.tv/host_channel' });
    expect(test.statuses.at(-1)).not.toHaveProperty('watchUrl', 'https://www.twitch.tv/raider');
    connection.dispose(); expect(test.dispose).toHaveBeenCalledOnce();
  });

  it('does not greet or read evidence while the actual room is still opening', async () => {
    let resolve!: (connection: KingdomEntryConnection) => void;
    const opening = new Promise<KingdomEntryConnection>(done => { resolve = done; });
    const test = harness({ opening, read: { version: 1, guest: projection } });
    const pending = test.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(test.events).toContain('open'));
    expect(test.events).not.toContain('read');
    expect(test.statuses.some(value => value.kind === 'confirmed')).toBe(false);
    resolve(test.connection); const connection = await pending;
    await vi.waitFor(() => expect(test.statuses.at(-1)?.kind).toBe('confirmed')); connection.dispose();
  });

  it('never polls if room entry fails', async () => {
    const test = harness();
    test.openKingdom.mockImplementation(() => async () => { throw new RealmEntryError('unavailable', 'Room unavailable'); });
    await expect(test.entry.open(new AbortController().signal)).rejects.toThrow('Room unavailable');
    expect(test.events).not.toContain('read');
    expect(test.statuses.some(value => value.kind === 'confirmed')).toBe(false);
  });

  it.each([
    { session: { version: 1, status: 'anonymous' }, expected: 'unauthenticated' },
    { session: { version: 1, status: 'authenticated' }, expected: 'unavailable' },
    { begin: { version: 1, status: 'pending' }, expected: 'unavailable' },
    { status: 404, expected: 'unavailable' },
    { begin: { version: 1, status: 'refused', reason: 'session' }, expected: 'unauthenticated' },
  ])('fails honestly before room entry for $expected', async value => {
    const test = harness(value);
    await expect(test.entry.open(new AbortController().signal)).rejects.toMatchObject({ status: value.expected });
    expect(test.openKingdom).not.toHaveBeenCalled();
    expect(test.events).not.toContain('read');
  });

  it('brings an existing citizen home through ordinary entry without raid attribution', async () => {
    const test = harness({ begin: { version: 1, status: 'refused', reason: 'citizen_here' } });
    await test.entry.open(new AbortController().signal);
    expect(test.openKingdom).toHaveBeenCalledOnce(); expect(test.events).not.toContain('read');
    expect(test.statuses.at(-1)?.kind).toBe('ordinary');
  });

  it.each(['expired', 'unknown_raid'])('requires explicit ordinary-entry choice after %s', async reason => {
    const test = harness({ begin: { version: 1, status: 'refused', reason } });
    await expect(test.entry.open(new AbortController().signal)).rejects.toMatchObject({ status: 'refused' });
    expect(test.statuses.at(-1)?.kind).toBe('choice'); expect(test.openKingdom).not.toHaveBeenCalled();
    test.entry.enterOrdinarily(); await test.entry.open(new AbortController().signal);
    expect(test.events.filter(value => value === 'begin')).toHaveLength(1);
    expect(test.openKingdom).toHaveBeenCalledOnce(); expect(test.events).not.toContain('read');
  });

  it('bounds confirmation polling and keeps a good room open when no committed guest appears', async () => {
    const test = harness(); const connection = await test.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(test.statuses.at(-1)?.message).toContain('not confirmed'));
    expect(test.events.filter(value => value === 'read').length).toBeLessThanOrEqual(4);
    expect(test.statuses.some(value => value.kind === 'confirmed')).toBe(false);
    expect(test.dispose).not.toHaveBeenCalled(); connection.dispose();
  });

  it.each([
    { ...projection, origin: 'simulated' }, { ...projection, kingdomId: '22' }, { ...projection, raidId: `raid.${'b'.repeat(64)}` },
    { ...projection, to: { ...to, kingdomId: '22' } }, { ...projection, to: undefined },
    { ...projection, assertedByLink: true },
  ])('withholds greetings for a malformed or mismatched committed projection', async guest => {
    const test = harness({ read: { version: 1, guest } }); const connection = await test.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(test.statuses.at(-1)?.kind).toBe('unavailable'));
    expect(test.statuses.some(value => value.kind === 'confirmed')).toBe(false);
    expect(test.dispose).not.toHaveBeenCalled(); connection.dispose();
  });

  it('never admits a simulated kingdom at the live gate', async () => {
    const test = harness({ infoOrigin: 'simulated' });
    await expect(test.entry.open(new AbortController().signal)).rejects.toMatchObject({ status: 'unavailable' });
    expect(test.events).toEqual(['session', 'info']); expect(test.openKingdom).not.toHaveBeenCalled();
  });

  it('lets a private bench gate admit only its own simulated stack, end to end', async () => {
    const simulatedGuest = { ...projection, origin: 'simulated' };
    const bench = harness({ origin: 'simulated', infoOrigin: 'simulated', roomOrigin: 'simulated', read: { version: 1, guest: simulatedGuest } });
    const connection = await bench.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(bench.statuses.at(-1)?.kind).toBe('confirmed'));
    expect(bench.openKingdom.mock.calls[0]?.[0]).toMatchObject({ origin: 'simulated' });
    connection.dispose();
    const mixed = harness({ origin: 'simulated', infoOrigin: 'live' });
    await expect(mixed.entry.open(new AbortController().signal)).rejects.toMatchObject({ status: 'unavailable' });
    const liveGuest = harness({ origin: 'simulated', infoOrigin: 'simulated', roomOrigin: 'simulated', read: { version: 1, guest: projection } });
    const other = await liveGuest.entry.open(new AbortController().signal);
    await vi.waitFor(() => expect(liveGuest.statuses.at(-1)?.kind).toBe('unavailable'));
    expect(liveGuest.statuses.some(value => value.kind === 'confirmed')).toBe(false); other.dispose();
  });

  it('cancels confirmation when its room is disposed', async () => {
    const test = harness(); const connection = await test.entry.open(new AbortController().signal);
    connection.dispose(); const count = test.statuses.length;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(test.statuses).toHaveLength(count); expect(test.dispose).toHaveBeenCalledOnce();
  });
});
