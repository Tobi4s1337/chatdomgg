import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { parseCardSource, type CitizenKey } from '../../citizen-card/contracts';
import { readPanelReading } from './contracts';
import { createPanelAuthority } from './reading';
import type { PanelViewer } from './token';
import type { TwitchPerson } from './twitch-users';

const KINGDOM = '1001', ELSEWHERE = '3003', NAMELESS = '4004', WREN = '2002';
const PUBLIC_ORIGIN = 'https://chatdom.io';
const RAISED = Date.UTC(2026, 10, 1, 18, 30);
const ALLOCATED = Date.UTC(2026, 9, 12, 9);
const SIGNED_IN = Date.UTC(2026, 8, 3);

interface Deed { kingdom: string; placement: unknown; settled?: number | null; allocated?: number }
interface World {
  kingdoms?: Record<string, { homes: number; plots: number }>;
  names?: Record<string, string>;
  deeds?: Record<string, Deed[]>;
  guests?: Record<string, string[]>;
  persons?: Record<string, { created: number; name: string | null }>;
  chatNames?: Record<string, string>;
  twitch?: Record<string, TwitchPerson>;
}

/**
 * A stand-in for the realm schema: it answers each query the authority makes by recognising which table it reads,
 * with rows shaped as Postgres returns them (counts and bigints as text).
 */
function setup(world: World = {}) {
  const queries: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    const [first, second] = params as string[];
    if (sql.includes('FROM realm_kingdoms')) {
      const kingdom = world.kingdoms?.[first!];
      return { rows: kingdom ? [{ homes: String(kingdom.homes), plots: String(kingdom.plots) }] : [] };
    }
    if (sql.includes('FROM realm_deeds') && sql.includes('person_id = $1')) {
      return {
        rows: (world.deeds?.[first!] ?? []).map(deed => ({
          kingdom_id: deed.kingdom, placement: typeof deed.placement === 'string' ? deed.placement : JSON.stringify(deed.placement),
          settled_ms: deed.settled === undefined ? String(RAISED) : deed.settled === null ? null : String(deed.settled),
          allocated_ms: String(deed.allocated ?? ALLOCATED), status: 'installed',
        })),
      };
    }
    if (sql.includes('FROM realm_guests')) return { rows: world.guests?.[first!]?.includes(second!) ? [{ reason: 'three homes elsewhere' }] : [] };
    if (sql.includes('FROM realm_persons')) {
      const person = world.persons?.[first!];
      return { rows: person ? [{ created_ms: String(person.created), public_name: person.name }] : [] };
    }
    if (sql.includes('FROM realm_citizen_names')) {
      const name = world.chatNames?.[first!];
      return { rows: name ? [{ public_name: name }] : [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const twitch = vi.fn(async (personId: string) => world.twitch?.[personId] ?? null);
  const names: Record<string, string> = { [KINGDOM]: 'Lanternmere', [ELSEWHERE]: 'Millbrook', ...world.names };
  const authority = createPanelAuthority({
    pool: { query } as unknown as Pool, origin: 'live', publicOrigin: PUBLIC_ORIGIN,
    users: { person: twitch },
    kingdomName: async id => names[id] ?? null,
  });
  return { authority, queries, twitch };
}

const shared = (personId: string, channelId = KINGDOM): PanelViewer => ({ channelId, role: 'viewer', kind: 'shared', personId });
const key = (personId: string, kingdomId = KINGDOM) => ({ personId, kingdomId }) as CitizenKey;
const WREN_TWITCH: TwitchPerson = { login: 'wren_tarn', displayName: 'Wren', colour: '#8a2be2' };
const LANTERN_ROW = { street: 'Lantern Row', ordinal: 4, tier: 'cottage', quarterYear: 2026, style: 'hearth' };
const MILL_LANE = { street: 'Mill Lane', ordinal: 1, tier: 'hut' };
const LANTERNMERE = { kingdoms: { [KINGDOM]: { homes: 1, plots: 12 } } };

/** The reading also has to cross the panel's own boundary reader unchanged. */
function crossesTheWire(reading: unknown) {
  expect(readPanelReading(JSON.parse(JSON.stringify(reading)))).toEqual(reading);
}

describe('the kingdom under the panel', () => {
  it('counts the homes lit by chat in its motto', async () => {
    const cases: [number, number, string][] = [
      [0, 12, '12 homes waiting for chat'],
      [1, 12, 'One home lit by chat, of 12'],
      [7, 12, '7 homes lit by chat, of 12'],
    ];
    for (const [homes, plots, motto] of cases) {
      const { authority } = setup({ kingdoms: { [KINGDOM]: { homes, plots } } });
      const reading = await authority.reading({ channelId: KINGDOM, role: 'viewer', kind: 'anonymous' });
      expect(reading.kingdom).toEqual({ name: 'Lanternmere', tier: 'hamlet', motto, walk: `${PUBLIC_ORIGIN}/?walk=1&kingdom=${KINGDOM}` });
      crossesTheWire(reading);
    }
  });

  it('is a town once it has more than 64 plots', async () => {
    const at = async (plots: number) => (await setup({ kingdoms: { [KINGDOM]: { homes: 3, plots } } }).authority
      .reading({ channelId: KINGDOM, role: 'viewer', kind: 'anonymous' })).kingdom?.tier;
    expect(await at(64)).toBe('hamlet');
    expect(await at(65)).toBe('town');
  });

  it('is absent for a channel without a kingdom, or one without an approved name', async () => {
    const none = await setup().authority.reading({ channelId: KINGDOM, role: 'viewer', kind: 'anonymous' });
    expect(none).toEqual({ version: 1, kingdom: null, viewer: { kind: 'anonymous' } });
    const unnamed = await setup({ kingdoms: { [NAMELESS]: { homes: 1, plots: 4 } } }).authority
      .reading({ channelId: NAMELESS, role: 'viewer', kind: 'anonymous' });
    expect(unnamed.kingdom).toBeNull();
  });

  it('is read once and then remembered for a while', async () => {
    const { authority, queries } = setup(LANTERNMERE);
    await authority.reading({ channelId: KINGDOM, role: 'viewer', kind: 'anonymous' });
    await authority.reading({ channelId: KINGDOM, role: 'viewer', kind: 'unshared' });
    expect(queries.filter(sql => sql.includes('FROM realm_kingdoms'))).toHaveLength(1);
  });
});

describe('the viewer\'s reading', () => {
  it('reads nobody\'s records for a viewer who is logged out or has not shared who they are', async () => {
    for (const kind of ['anonymous', 'unshared'] as const) {
      const { authority, queries, twitch } = setup({ ...LANTERNMERE, deeds: { [WREN]: [{ kingdom: KINGDOM, placement: LANTERN_ROW }] } });
      const reading = await authority.reading({ channelId: KINGDOM, role: 'viewer', kind });
      expect(reading.viewer).toEqual({ kind });
      expect(queries.every(sql => sql.includes('FROM realm_kingdoms'))).toBe(true);
      expect(twitch).not.toHaveBeenCalled();
      crossesTheWire(reading);
    }
  });

  it('shows a citizen their home here, by its street number and quarter', async () => {
    const { authority } = setup({
      ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH },
      deeds: { [WREN]: [{ kingdom: KINGDOM, placement: LANTERN_ROW }, { kingdom: ELSEWHERE, placement: MILL_LANE }, { kingdom: NAMELESS, placement: MILL_LANE }] },
    });
    const reading = await authority.reading(shared(WREN));
    expect(reading.viewer).toEqual({
      kind: 'citizen',
      card: {
        name: 'Wren', colour: '#8a2be2', standing: 'Citizen of Lanternmere', following: null, subscribed: null,
        home: { name: 'Number 5', tier: 'cottage' },
        // A home in a kingdom with no approved public name stays off the card.
        elsewhere: [{ kingdom: 'Millbrook', home: 'Number 2, Mill Lane' }],
      },
      home: {
        street: 'Lantern Row',
        place: 'Number 5 on Lantern Row, in the 2026 quarter',
        description: 'A cottage of warm timber and plaster, with a deep hearth. The kingdom raised it for you on 1 Nov 2026.',
        since: '1 Nov 2026',
      },
    });
    crossesTheWire(reading);
  });

  it('describes a home plainly when the plan gave it no quarter, tier or style', async () => {
    const { authority } = setup({
      ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH },
      deeds: { [WREN]: [{ kingdom: KINGDOM, placement: { street: 'Lantern Row', ordinal: 0 }, settled: null }] },
    });
    const reading = await authority.reading(shared(WREN));
    if (reading.viewer.kind !== 'citizen') throw new Error(`expected a citizen, got ${reading.viewer.kind}`);
    // An unsettled deed dates from its allocation.
    expect(reading.viewer.home).toEqual({
      street: 'Lantern Row', place: 'Number 1 on Lantern Row',
      description: 'The kingdom raised it for you on 12 Oct 2026.', since: '12 Oct 2026',
    });
    expect(reading.viewer.card.home).toEqual({ name: 'Number 1', tier: null });

    const styled = setup({
      ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH },
      deeds: { [WREN]: [{ kingdom: KINGDOM, placement: { street: 'Lantern Row', ordinal: 2, tier: 'manor', style: 'unknown-style' } }] },
    });
    const manor = await styled.authority.reading(shared(WREN));
    if (manor.viewer.kind !== 'citizen') throw new Error(`expected a citizen, got ${manor.viewer.kind}`);
    expect(manor.viewer.home.description).toBe('A manor house of the kingdom’s own style. The kingdom raised it for you on 1 Nov 2026.');
  });

  it('ignores a deed whose placement cannot be read, rather than guessing a home', async () => {
    const { authority } = setup({
      ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH },
      deeds: { [WREN]: [{ kingdom: KINGDOM, placement: '{not json' }, { kingdom: KINGDOM, placement: { street: '', ordinal: 3 } }, { kingdom: KINGDOM, placement: { street: 'Lantern Row', ordinal: -1 } }] },
    });
    expect((await authority.reading(shared(WREN))).viewer.kind).toBe('newcomer');
  });

  it('shows a guest as a guest, with no home here', async () => {
    const { authority } = setup({ ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH }, guests: { [KINGDOM]: [WREN] } });
    const reading = await authority.reading(shared(WREN));
    expect(reading.viewer).toEqual({
      kind: 'guest', card: { name: 'Wren', colour: '#8a2be2', standing: 'Guest of Lanternmere', following: null, subscribed: null, home: null, elsewhere: [] },
    });
    crossesTheWire(reading);
  });

  it('welcomes a newcomer known to Twitch but without a home here', async () => {
    const { authority } = setup({ ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH }, deeds: { [WREN]: [{ kingdom: ELSEWHERE, placement: MILL_LANE }] } });
    const reading = await authority.reading(shared(WREN));
    expect(reading.viewer).toEqual({
      kind: 'newcomer',
      card: {
        name: 'Wren', colour: '#8a2be2', standing: 'Welcome to Lanternmere', following: null, subscribed: null, home: null,
        elsewhere: [{ kingdom: 'Millbrook', home: 'Number 2, Mill Lane' }],
      },
    });
    crossesTheWire(reading);
  });

  it('crowns the streamer, whose home is the castle', async () => {
    const { authority } = setup({
      ...LANTERNMERE, twitch: { [KINGDOM]: { login: 'tobi4s_', displayName: 'tobi4s_', colour: null } },
      deeds: { [KINGDOM]: [{ kingdom: KINGDOM, placement: LANTERN_ROW }] },
    });
    const reading = await authority.reading(shared(KINGDOM));
    expect(reading.viewer).toEqual({
      kind: 'monarch',
      card: { name: 'tobi4s_', colour: null, standing: 'Monarch of Lanternmere', following: null, subscribed: null, home: { name: 'The castle', tier: null }, elsewhere: [] },
    });
    crossesTheWire(reading);
  });

  it('falls back to the name the kingdom already approved when Twitch does not answer', async () => {
    const signedIn = await setup({ ...LANTERNMERE, persons: { [WREN]: { created: SIGNED_IN, name: 'Wren (signed in)' } }, chatNames: { [WREN]: 'wren_from_chat' } })
      .authority.reading(shared(WREN));
    expect(signedIn.viewer).toMatchObject({ kind: 'newcomer', card: { name: 'Wren (signed in)', colour: null } });
    const fromChat = await setup({ ...LANTERNMERE, chatNames: { [WREN]: 'wren_from_chat' } }).authority.reading(shared(WREN));
    expect(fromChat.viewer).toMatchObject({ kind: 'newcomer', card: { name: 'wren_from_chat' } });
  });

  it('says honestly when it cannot name the viewer, or the channel has no kingdom', async () => {
    const nameless = await setup(LANTERNMERE).authority.reading(shared(WREN));
    expect(nameless.kingdom?.name).toBe('Lanternmere');
    expect(nameless.viewer).toEqual({ kind: 'unknown', reason: 'Twitch has not told us your name just now. Try again in a moment.' });
    crossesTheWire(nameless);
    const homeless = await setup({ twitch: { [WREN]: WREN_TWITCH } }).authority.reading(shared(WREN));
    expect(homeless).toEqual({ version: 1, kingdom: null, viewer: { kind: 'unknown', reason: 'This channel has no kingdom yet, so there is no card to show here.' } });
    crossesTheWire(homeless);
  });

  it('strips control and direction-override characters from a display name', async () => {
    const { authority } = setup({ ...LANTERNMERE, twitch: { [WREN]: { ...WREN_TWITCH, displayName: 'Wr‮en\u0007' } } });
    const reading = await authority.reading(shared(WREN));
    expect(reading.viewer).toMatchObject({ card: { name: 'Wren' } });
    crossesTheWire(reading);
  });
});

describe('the card source for the passport reader', () => {
  const citizen = () => setup({
    ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH }, persons: { [WREN]: { created: SIGNED_IN, name: 'Wren' } },
    deeds: { [WREN]: [{ kingdom: KINGDOM, placement: LANTERN_ROW }, { kingdom: ELSEWHERE, placement: MILL_LANE, settled: RAISED + 5_000 }] },
  });

  it('describes a citizen from witnessed records only, with honest nulls for what nobody has witnessed', async () => {
    const source = await citizen().authority.cardSource(key(WREN), Date.UTC(2026, 10, 2));
    expect(parseCardSource(source)).toEqual(source);
    const { document } = source;
    expect(document.key).toEqual({ personId: WREN, kingdomId: KINGDOM });
    expect(document.kingdomName).toBe('Lanternmere');
    expect(document.origin).toBe('live');
    expect(document.identity).toEqual({ login: 'wren_tarn', name: 'Wren', colour: '#8a2be2', office: null, portrait: null });
    expect(document.tenure).toEqual({ followedAt: null, subscribedMonths: null, activeTier: null });
    expect(document.citizenNumber).toBeNull();
    expect(document.address).toEqual({ home: 'Number 5', street: 'Lantern Row' });
    expect(document.homes).toEqual([
      { kingdomId: KINGDOM, kingdomName: 'Lanternmere', home: 'Number 5', street: 'Lantern Row', image: null, path: null },
      { kingdomId: ELSEWHERE, kingdomName: 'Millbrook', home: 'Number 2', street: 'Mill Lane', image: null, path: null },
    ]);
    expect(document.castle).toBeNull();
    expect(document.passport).toEqual({ hidden: false, stamps: { availability: 'known', entries: [], next: null } });
    expect(document.pieces).toEqual({ availability: 'unavailable' });
    expect(document.honours).toEqual({ availability: 'unavailable' });
    expect(document.house).toBeNull();
    expect(document.revision).toEqual({ person: RAISED + 5_000, citizen: RAISED + 5_000 });
    expect(source.subjectFirstSignedInAt).toBe(SIGNED_IN);
    expect(source.travelsHidden).toBe(false);
    expect(source.dependencies).toEqual([]);
  });

  it('uses the moment of sharing as the first sign-in for someone who never signed in to Chatdom', async () => {
    const sharedAt = Date.UTC(2026, 10, 2);
    const { authority } = setup({ ...LANTERNMERE, twitch: { [WREN]: WREN_TWITCH } });
    const source = await authority.cardSource(key(WREN), sharedAt);
    expect(parseCardSource(source)).toEqual(source);
    expect(source.subjectFirstSignedInAt).toBe(sharedAt);
    expect(source.document.revision).toEqual({ person: 0, citizen: 0 });
    expect(source.document.address).toBeNull();
    expect(source.document.homes).toEqual([]);
  });

  it('seats the monarch in the castle, not on a street', async () => {
    const { authority } = setup({
      ...LANTERNMERE, twitch: { [KINGDOM]: { login: 'tobi4s_', displayName: 'tobi4s_', colour: null } },
      deeds: { [KINGDOM]: [{ kingdom: KINGDOM, placement: LANTERN_ROW }, { kingdom: ELSEWHERE, placement: MILL_LANE }] },
    });
    const source = await authority.cardSource(key(KINGDOM), Date.UTC(2026, 10, 2));
    expect(parseCardSource(source)).toEqual(source);
    expect(source.document.identity.office).toBe('monarch');
    expect(source.document.address).toBeNull();
    expect(source.document.castle).toEqual({ kingdomId: KINGDOM, kingdomName: 'Lanternmere', home: 'The castle', street: null, image: null, path: null });
    expect(source.document.homes).toEqual([{ kingdomId: ELSEWHERE, kingdomName: 'Millbrook', home: 'Number 2', street: 'Mill Lane', image: null, path: null }]);
  });

  it('carries nothing beyond the public card: no opaque id, role or private record', async () => {
    const source = await citizen().authority.cardSource(key(WREN), Date.UTC(2026, 10, 2));
    const text = JSON.stringify(source);
    for (const secret of ['three homes elsewhere', 'installed', 'quarterYear', 'hearth', 'opaque', 'role']) expect(text).not.toContain(secret);
  });

  it('refuses to build a card without a kingdom or without Twitch\'s word on who the person is', async () => {
    await expect(setup({ twitch: { [WREN]: WREN_TWITCH } }).authority.cardSource(key(WREN), Date.now())).rejects.toThrow('This channel has no kingdom');
    await expect(setup(LANTERNMERE).authority.cardSource(key(WREN), Date.now())).rejects.toThrow('Twitch did not answer for this person');
  });
});
