import { describe, expect, it, vi } from 'vitest';
import type { Directory, DirectoryRefusal, Lookup } from './directory';
import { DirectoryFallback } from './fallback';
import { queryKey } from './normalize';
import { CardReplySchema, SearchReplySchema, type CardReply, type SearchReply } from './schema';
import { LookupUnavailable, type TwitchChannelFacts, type TwitchLookup } from './twitch-lookup';

const NOW = 1_800_000_000_000;
const NONE = new Set<string>();
const FACTS: TwitchChannelFacts = {
  id: '12345', login: 'small_channel', name: 'Small Channel', avatarUrl: null, language: 'en',
  gameId: '509658', game: 'Just Chatting', title: 'A quiet evening', live: false, viewers: null,
  startedAt: null, fetchedAt: NOW,
};

function external(facts: TwitchChannelFacts, portraits = true): CardReply {
  return CardReplySchema.parse({
    version: 1, preview: 'pv-20270115T080000Z-0123456789ab', revision: 'obs-20270115T080000Z-0123456789ab',
    servedAt: NOW, asOf: NOW, kind: 'chatdom-atlas-card',
    channel: { id: facts.id, login: facts.login, name: facts.name, freshUntil: NOW + 86_400_000,
      place: 'waiting', ordinal: null, tier: null, region: 0, realm: 1 },
    ...(portraits ? { portrait: null } : {}),
    position: { x: 120, y: 240 }, average: null, language: facts.language,
    firstSeenAt: null, lastLiveAt: null,
    stream: { live: facts.live, game: facts.game, title: facts.title, viewers: facts.viewers, startedAt: facts.startedAt },
    roads: null, coverage: { raidWatch: { enabled: false, watching: 0, liveCandidates: 0 }, contentLabels: 'not-collected' },
  });
}

function empty(query: string): SearchReply | DirectoryRefusal {
  const key = queryKey(query);
  if (!key.ok) return key.reason;
  return SearchReplySchema.parse({
    version: 1, preview: 'pv-20270115T080000Z-0123456789ab', revision: 'obs-20270115T080000Z-0123456789ab',
    servedAt: NOW, asOf: NOW, kind: 'chatdom-atlas-search', key: key.key, results: [], more: false,
  });
}

function fixture() {
  const known = new Set<string>();
  const denied = new Set<string>();
  const search = vi.fn((query: string): SearchReply | DirectoryRefusal => empty(query));
  const card = vi.fn((): CardReply | DirectoryRefusal => 'not-found');
  const project = vi.fn((facts: TwitchChannelFacts, withheld: ReadonlySet<string>, _at: number, portraits: boolean) =>
    denied.has(facts.id) || withheld.has(facts.id) ? null : external(facts, portraits));
  const register = {
    search, card,
    has: (lookup: Lookup) => known.has('id' in lookup ? lookup.id : 'login' in lookup ? lookup.login : lookup.dab),
    allowed: (id: string, withheld: ReadonlySet<string>) => !denied.has(id) && !withheld.has(id),
    external: project,
  } as unknown as Directory;
  const lookup = vi.fn<(query: string) => Promise<TwitchChannelFacts[]>>(async () => [FACTS]);
  const cached = vi.fn<(query: string) => boolean>(() => false);
  const twitch: TwitchLookup = { lookup, cached, close: () => {} };
  let now = NOW;
  const fallback = new DirectoryFallback(twitch, { now: () => now });
  return { register, search, card, project, known, denied, lookup, cached, fallback, advance: (ms: number) => { now += ms; } };
}

function reply<T>(value: T | DirectoryRefusal): T {
  if (typeof value === 'string') throw new Error(`Refused ${value}`);
  return value;
}

describe('survey-first directory fallback', () => {
  it('returns survey hits unchanged without spending a client or Twitch lookup', async () => {
    const f = fixture();
    const found = reply(empty('small_channel'));
    const surveyed = external(FACTS);
    found.results = [{ channel: surveyed.channel, average: 40, language: 'en' }];
    f.search.mockReturnValue(found);
    f.card.mockReturnValue(surveyed);
    for (let i = 0; i < 10; i++) expect(await f.fallback.search(f.register, 'small_channel', NONE, 'client-a', true)).toBe(found);
    expect(await f.fallback.card(f.register, { id: FACTS.id }, NONE, 'client-a', true)).toBe(surveyed);
    expect(f.lookup).not.toHaveBeenCalled();
    // Survey traffic did not exhaust the fallback allowance.
    f.search.mockImplementation(empty);
    expect(reply(await f.fallback.search(f.register, 'new', NONE, 'client-a', true)).results).toHaveLength(1);
  });

  it('projects fallback search results with a stable point and no invented history or source marker', async () => {
    const f = fixture();
    const found = reply(await f.fallback.search(f.register, 'small_channel', NONE, 'client-a', true));
    expect(f.lookup).toHaveBeenCalledWith('small_channel');
    expect(found.results).toEqual([{ channel: external(FACTS).channel, portrait: null, position: { x: 120, y: 240 }, average: null, language: 'en' }]);
    expect(SearchReplySchema.parse(found)).toEqual(found);
    expect(JSON.stringify(found)).not.toMatch(/source|fallback|Twitch/);
    expect(await f.fallback.card(f.register, { login: 'small_channel' }, NONE, 'client-a', true)).toEqual(external(FACTS));
  });

  it('puts an outside-survey exact login ahead of local prefix rows and keeps the merged result bounded', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue([FACTS, FACTS]);
    const local = reply(empty('small_channel'));
    local.results = Array.from({ length: 8 }, (_, index) => ({
      channel: { ...external(FACTS).channel, id: String(20_000 + index) as CardReply['channel']['id'], login: `small_channel_${index}` },
      average: 100 - index, language: 'en',
    }));
    f.search.mockReturnValue(local);
    const found = reply(await f.fallback.search(f.register, 'SMALL_CHANNEL', NONE, 'client-a', true));
    expect(f.lookup).toHaveBeenCalledWith('login:small_channel');
    expect(found.results.map(result => result.channel.login)).toEqual([
      'small_channel', 'small_channel_0', 'small_channel_1', 'small_channel_2',
      'small_channel_3', 'small_channel_4', 'small_channel_5', 'small_channel_6',
    ]);
    expect(found.more).toBe(true);
    expect(SearchReplySchema.parse(found)).toEqual(found);
  });

  it.each(['disabled', 'limited', 'upstream', 'missing'] as const)('preserves local prefix rows when the exact probe is %s', async reason => {
    const f = fixture();
    const local = reply(empty('small_channel'));
    local.results = [{ channel: { ...external(FACTS).channel, login: 'small_channel_extra' }, average: 50, language: 'en' }];
    f.search.mockReturnValue(local);
    if (reason === 'missing') f.lookup.mockResolvedValue([]);
    else f.lookup.mockRejectedValue(new LookupUnavailable(reason, 30));
    expect(await f.fallback.search(f.register, 'small_channel', NONE, 'client-a', true)).toBe(local);
    expect(local).not.toHaveProperty('unavailable');
  });

  it('does not spend another client allowance for a cached strict probe over local prefix rows', async () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) await f.fallback.search(f.register, `new${i}`, NONE, 'client-a', true);
    const local = reply(empty('small_channel'));
    local.results = [{ channel: { ...external(FACTS).channel, id: '20000' as CardReply['channel']['id'], login: 'small_channel_extra' }, average: 50, language: 'en' }];
    f.search.mockReturnValue(local);
    f.cached.mockImplementation(query => query === 'login:small_channel');
    const found = reply(await f.fallback.search(f.register, 'small_channel', NONE, 'client-a', true));
    expect(found.results.map(result => result.channel.login)).toEqual(['small_channel', 'small_channel_extra']);
    expect(f.lookup).toHaveBeenLastCalledWith('login:small_channel');
    f.known.add('small_channel');
    const calls = f.lookup.mock.calls.length;
    expect(await f.fallback.search(f.register, 'small_channel', NONE, 'client-a', true)).toBe(local);
    expect(f.lookup).toHaveBeenCalledTimes(calls);
  });

  it('does not replace invalid input or an authoritative missing channel with a fabricated result', async () => {
    const f = fixture();
    expect(await f.fallback.search(f.register, ' ', NONE, 'client-a', true)).toBe('empty');
    expect(await f.fallback.search(f.register, 'a'.repeat(51), NONE, 'client-a', true)).toBe('too-long');
    expect(f.lookup).not.toHaveBeenCalled();
    f.lookup.mockResolvedValue([]);
    expect(reply(await f.fallback.search(f.register, 'missing', NONE, 'client-a', true)).results).toEqual([]);
    expect(await f.fallback.card(f.register, { login: 'missing' }, NONE, 'client-a', true)).toBe('not-found');
  });

  it('does not interpret private adapter selectors in public search text', async () => {
    const f = fixture();
    for (const query of ['id:12345', 'login:small_channel', ' ID:12345 ', 'LOGIN:small_channel']) {
      expect(reply(await f.fallback.search(f.register, query, NONE, 'client-a', true)).results).toEqual([]);
    }
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it('uses explicit IDs and refuses a partial-name match for an exact card URL', async () => {
    const f = fixture();
    expect(reply(await f.fallback.card(f.register, { id: FACTS.id }, NONE, 'client-a', true)).channel.id).toBe(FACTS.id);
    expect(f.lookup).toHaveBeenLastCalledWith(`id:${FACTS.id}`);
    expect(await f.fallback.card(f.register, { id: '67890' }, NONE, 'client-a', true)).toBe('not-found');
    expect(await f.fallback.card(f.register, { login: 'small' }, NONE, 'client-a', true)).toBe('not-found');
  });

  it('limits external queries per IP while allowing other clients and refilling over time', async () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) expect(reply(await f.fallback.search(f.register, `new${i}`, NONE, 'client-a', true)).results).toHaveLength(1);
    const held = reply(await f.fallback.search(f.register, 'new7', NONE, 'client-a', true));
    expect(held).toMatchObject({ results: [], unavailable: 'limited' });
    expect(f.lookup).toHaveBeenCalledTimes(6);
    await expect(f.fallback.card(f.register, { login: 'new' }, NONE, 'client-a', true)).rejects.toMatchObject({ reason: 'limited', retryAfter: 10 });
    expect(reply(await f.fallback.search(f.register, 'new8', NONE, 'client-b', true)).results).toHaveLength(1);
    f.advance(10_000);
    expect(reply(await f.fallback.search(f.register, 'new9', NONE, 'client-a', true)).results).toHaveLength(1);
  });

  it('lets the sixth search result open and cached cards repeat after the external allowance is exhausted', async () => {
    const f = fixture();
    const answers = new Map<string, TwitchChannelFacts[]>();
    f.cached.mockImplementation(query => answers.has(query));
    f.lookup.mockImplementation(async query => {
      const held = answers.get(query);
      if (held) return held;
      const facts = { ...FACTS, id: String(100_000 + answers.size), login: query };
      const found = [facts];
      answers.set(query, found);
      answers.set(`id:${facts.id}`, found);
      return found;
    });
    let sixth: TwitchChannelFacts | null = null;
    for (let i = 0; i < 6; i++) {
      const found = reply(await f.fallback.search(f.register, `new_channel_${i}`, NONE, 'client-a', true));
      expect(found.results).toHaveLength(1);
      if (i === 5) sixth = answers.get('new_channel_5')![0]!;
    }
    const selected = sixth!;
    for (let i = 0; i < 10; i++) {
      expect(reply(await f.fallback.card(f.register, { id: selected.id }, NONE, 'client-a', true)).channel.id).toBe(selected.id);
      expect(reply(await f.fallback.card(f.register, { login: selected.login }, NONE, 'client-a', true)).channel.id).toBe(selected.id);
    }
    expect(reply(await f.fallback.search(f.register, selected.login, NONE, 'client-a', true)).results[0]!.channel.id).toBe(selected.id);
    const calls = f.lookup.mock.calls.length;
    expect(reply(await f.fallback.search(f.register, 'seventh_new_channel', NONE, 'client-a', true))).toMatchObject({ results: [], unavailable: 'limited' });
    expect(f.lookup).toHaveBeenCalledTimes(calls);
    // Expired answers again need an external allowance.
    answers.clear();
    await expect(f.fallback.card(f.register, { id: selected.id }, NONE, 'client-a', true)).rejects.toMatchObject({ reason: 'limited' });
  });

  it('keeps blocked known IDs, names and anonymous dabs from triggering a second-source lookup', async () => {
    const f = fixture();
    f.known.add(FACTS.id);
    f.known.add(FACTS.login);
    expect(await f.fallback.card(f.register, { id: FACTS.id }, NONE, 'client-a', true)).toBe('not-found');
    expect(await f.fallback.card(f.register, { login: FACTS.login }, NONE, 'client-a', true)).toBe('not-found');
    expect(reply(await f.fallback.search(f.register, FACTS.login, NONE, 'client-a', true)).results).toEqual([]);
    expect(await f.fallback.card(f.register, { dab: '0123456789abcdef' }, NONE, 'client-a', true)).toBe('not-found');
    expect(await f.fallback.card(f.register, { id: '98765' }, new Set(['98765']), 'client-a', true)).toBe('not-found');
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it('reprojects every answer through withholding, including cached facts and an in-flight moderation change', async () => {
    const f = fixture();
    const withheld = new Set<string>();
    expect(reply(await f.fallback.search(f.register, 'new', withheld, 'client-a', true)).results).toHaveLength(1);
    withheld.add(FACTS.id);
    expect(reply(await f.fallback.search(f.register, 'new', withheld, 'client-a', true)).results).toEqual([]);
    withheld.clear();
    f.lookup.mockImplementation(async () => {
      withheld.add(FACTS.id);
      return [FACTS];
    });
    expect(reply(await f.fallback.search(f.register, 'new', withheld, 'client-a', true)).results).toEqual([]);
    f.denied.add(FACTS.id);
    expect(await f.fallback.card(f.register, { login: FACTS.login }, NONE, 'client-a', true)).toBe('not-found');
  });

  it.each(['disabled', 'limited', 'upstream'] as const)('keeps survey search available when external lookup is %s', async reason => {
    const f = fixture();
    f.lookup.mockRejectedValue(new LookupUnavailable(reason, 30));
    expect(reply(await f.fallback.search(f.register, 'new', NONE, 'client-a', true))).toMatchObject({ results: [], unavailable: reason });
    await expect(f.fallback.card(f.register, { login: 'new' }, NONE, 'client-a', true)).rejects.toMatchObject({ reason });
  });

  it('deduplicates external identities and omits portrait fields for clients that did not request them', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue([FACTS, FACTS]);
    const found = reply(await f.fallback.search(f.register, 'new', NONE, 'client-a', false));
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).not.toHaveProperty('portrait');
    expect(f.project).toHaveBeenCalledWith(FACTS, NONE, NOW, false);
  });
});
