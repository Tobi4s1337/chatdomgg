import { describe, expect, it } from 'vitest';
import { TINCTURES, shieldDesign } from '../../../web/src/atlas/heraldry/design';
import type { CardSource } from '../citizen-card/contracts';
import type { PassportReply, VisiblePassportBook } from '../passport/contracts';
import { createPassportReader, type PassportPorts, type PassportReadFault } from '../passport/read';
import { simulatedPassportAuthorities } from '../passport/simulated';
import type { PersonId } from './contracts';
import type { RaidGuestStamp } from './guest-contracts';
import { cardTravels, createMemoryGatePassport, gateCrest, gateKingdom, gatePassportPorts, type GatePassportStore } from './passport';

const DAY = 86_400_000;
const raidId = (hex: string) => `raid.${hex.repeat(64 / hex.length)}`;
const channel = (kingdomId: string, name: string) => ({ kingdomId, login: name.toLowerCase(), name });

function setup(options: { pageSize?: number; wrap?: (store: GatePassportStore) => GatePassportStore; stale?: () => boolean } = {}) {
  const sim = simulatedPassportAuthorities('none', { signedIn: true, travelsHidden: false });
  const person = sim.key.personId as unknown as PersonId;
  const home = channel(sim.key.kingdomId, 'Larkspur Hollow');
  const gate = createMemoryGatePassport();
  const store = options.wrap ? options.wrap(gate.store) : gate.store;
  let now = sim.now - 40 * DAY;
  /** A witnessed raid, and the stamp the gate's authority recorded for the holder from it. */
  const ride = (hex: string, from: ReturnType<typeof channel>, to: ReturnType<typeof channel>, kind: 'raid' | 'visit') => {
    now += 3 * DAY;
    const id = raidId(hex);
    gate.witness({ raidId: id, from, to });
    const stamp: RaidGuestStamp = {
      id: `raid-stamp.${id.slice(5)}`, kind, kingdomId: to.kingdomId as RaidGuestStamp['kingdomId'], occurredAt: now + 60_000,
      raidId: kind === 'raid' ? id : null, arrivedWith: kind === 'visit' ? { raidId: id, from, to, occurredAt: now } as RaidGuestStamp['arrivedWith'] : null,
      reward: { eligible: true, reason: 'eligible', day: Math.floor(now / DAY) },
    };
    gate.stamp(person, stamp);
    return stamp;
  };
  let older: CardSource | null = null;
  const card = async (): Promise<CardSource> => {
    const source = sim.card();
    const travels = cardTravels(await store.choice(person), source.document.revision.person);
    const current = { ...source, travelsHidden: travels.travelsHidden, document: { ...source.document, revision: { ...source.document.revision, person: travels.personRevision } } };
    if (options.stale?.() && older) return older;
    older ??= current;
    return current;
  };
  const empty = { revision: 0, items: [], nextCursor: null } as const;
  const ports: PassportPorts = {
    ...gatePassportPorts(store, options.pageSize ? { pageSize: options.pageSize } : {}),
    origin: 'simulated', card: () => card(), bonds: async () => empty, keepsakes: async () => empty,
  };
  const faults: PassportReadFault[] = [];
  const reader = createPassportReader(ports, { report: fault => faults.push(fault) });
  const read = (request: unknown) => reader.handle({ key: sim.key, now: sim.now, signal: new AbortController().signal }, request);
  return { sim, person, home, gate, store, ride, read, faults };
}

const visible = (reply: PassportReply): VisiblePassportBook => {
  if (reply.kind !== 'book' || reply.book.visibility !== 'visible') throw new Error(`expected a visible book, got ${JSON.stringify(reply)}`);
  return reply.book;
};

describe('the gate passport: arms', () => {
  it('draws a channel in the Atlas arms seeded from its ID, in the Atlas pigments', () => {
    const crest = gateCrest('129634568')!;
    const design = shieldDesign('129634568');
    expect(crest).toMatchObject({ shape: 'heater', assetHash: null, key: 'atlas-arms.1.129634568' });
    expect(crest.colours).toEqual([TINCTURES[design.field].pigment, TINCTURES[design.second].pigment]);
    expect(gateCrest('129634568')).toEqual(crest);
    expect(gateCrest('4363967')).not.toEqual(crest);
    expect(['oak', 'star', 'wave', 'mountain']).toContain(crest.charge);
  });

  it('invents nothing: no arms for what is not a channel ID, no kingdom without a witnessed name', () => {
    expect(gateCrest('tobi4s_')).toBeNull();
    expect(gateKingdom('129634568', undefined)).toBeNull();
    expect(gateKingdom('129634568', 'tobi4s_')).toMatchObject({ kingdomId: '129634568', name: 'tobi4s_' });
  });
});

describe('the gate passport: witnessed stamps in the book', () => {
  it('reads raid and visit stamps newest first, each in its kingdom’s arms, with the witnessed road and no invented leader', async () => {
    const { ride, read, home, faults } = setup();
    const thornwick = channel('910000201', 'Thornwick'), saltreach = channel('910000203', 'Saltreach');
    ride('e7', home, thornwick, 'raid');
    ride('5c', channel('910000202', 'Brackenmoor'), saltreach, 'visit');
    const book = visible(await read({ op: 'book' }));
    expect(faults).toEqual([]);
    expect(book.stamps.items.map(stamp => [stamp.kind, stamp.kingdom.name])).toEqual([['visit', 'Saltreach'], ['raid', 'Thornwick']]);
    const raid = book.stamps.items[1]!;
    if (raid.kind !== 'raid') throw new Error('expected a raid stamp');
    expect(raid.road).toEqual({ id: raidId('e7'), from: home.kingdomId, to: thornwick.kingdomId });
    expect(raid.leader).toBeNull();
    expect(raid.gifts).toEqual([]);
    expect(raid.kingdom.crest).toEqual(gateCrest(thornwick.kingdomId));
    expect(book.kingdoms.items.map(visit => visit.kingdom.name)).toEqual(['Saltreach', 'Thornwick']);
  });

  it('an empty gate history is a valid empty book', async () => {
    const book = visible(await setup().read({ op: 'book' }));
    expect(book.stamps).toEqual({ items: [], nextCursor: null });
    expect(book.kingdoms).toEqual({ items: [], nextCursor: null });
  });

  it('pages under one revision and calls a page stale once a new stamp lands', async () => {
    const { ride, read, home } = setup({ pageSize: 2 });
    for (const [i, hex] of ['a1', 'b2', 'c3'].entries()) ride(hex, home, channel(`91000030${i}`, `Fen ${i}`), 'raid');
    const book = visible(await read({ op: 'book' }));
    expect(book.stamps.items.map(stamp => stamp.kingdom.name)).toEqual(['Fen 2', 'Fen 1']);
    expect(book.stamps.nextCursor).toBe('gate-stamps.2');
    const page = await read({ op: 'page', collection: 'stamps', cursor: book.stamps.nextCursor, revision: book.revision });
    expect(page).toMatchObject({ kind: 'page', collection: 'stamps', page: { nextCursor: null } });
    expect((page as Extract<PassportReply, { kind: 'page' }>).page.items.map(item => (item as { kingdom: { name: string } }).kingdom.name)).toEqual(['Fen 0']);
    ride('d4', home, channel('910000309', 'Fen 9'), 'raid');
    expect(await read({ op: 'page', collection: 'stamps', cursor: book.stamps.nextCursor, revision: book.revision })).toEqual({ kind: 'denied', code: 'stale' });
  });

  it('refuses a stamp whose kingdom the witnessed raids cannot name, rather than drawing an invented one', async () => {
    const { gate, person, read, faults } = setup();
    gate.stamp(person, { id: 'raid-stamp.orphan', kind: 'raid', kingdomId: '910000401' as RaidGuestStamp['kingdomId'], occurredAt: 1, raidId: raidId('ff'),
      arrivedWith: null, reward: { eligible: false, reason: 'small_raid', day: 0 } });
    expect(await read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(faults.map(fault => fault.kind)).toEqual([expect.stringMatching(/^(enrichment|port)$/)]);
  });
});

describe('the gate passport: Hide my travels', () => {
  it('closes the book and every page with nothing travel-derived, and opens it again when shown', async () => {
    const { ride, read, store, person, home, sim } = setup({ pageSize: 1 });
    ride('e7', home, channel('910000201', 'Thornwick'), 'raid');
    ride('a3', home, channel('910000204', 'Kestrel Fen'), 'raid');
    const book = visible(await read({ op: 'book' }));
    const hidden = await store.choose(person, true, sim.now);
    expect(hidden).toEqual({ hidden: true, changedAt: sim.now });
    for (const reply of [await read({ op: 'book' }),
      await read({ op: 'page', collection: 'stamps', cursor: book.stamps.nextCursor, revision: book.revision }),
      await read({ op: 'page', collection: 'kingdoms', cursor: book.kingdoms.nextCursor, revision: book.revision })]) {
      expect(reply).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
      for (const leak of ['Thornwick', 'Kestrel', 'raid', 'gate-', 'revision']) expect(JSON.stringify(reply)).not.toContain(leak);
    }
    // The same choice again changes nothing; showing moves the moment forward even on a clock that stepped back.
    expect(await store.choose(person, true, sim.now + 5)).toEqual(hidden);
    expect(await store.choose(person, false, sim.now - 10)).toEqual({ hidden: false, changedAt: sim.now + 1 });
    expect(visible(await read({ op: 'book' })).stamps.items).toHaveLength(1);
  });

  it('lets a hide that lands while the stamps are read win over the history', async () => {
    let hideMidRead = true;
    const race = setup({ wrap: store => ({ ...store, stamps: async (...args) => {
      const page = await store.stamps(...args);
      if (hideMidRead) await store.choose(args[0], true, 1_900_000_000_000);
      return page;
    } }) });
    race.ride('e7', race.home, channel('910000201', 'Thornwick'), 'raid');
    // The stamps were read while still shown; the card read after them says hidden, and that wins.
    expect(await race.read({ op: 'book' })).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
    hideMidRead = false;
    await race.store.choose(race.person, false, 1_900_000_000_001);
    expect(visible(await race.read({ op: 'book' })).stamps.items).toHaveLength(1);
  });

  it('refuses a stale card that still says shown after a hide was read', async () => {
    let replay = false;
    const { ride, read, store, person, home, sim } = setup({ stale: () => replay });
    ride('e7', home, channel('910000201', 'Thornwick'), 'raid');
    visible(await read({ op: 'book' }));
    await store.choose(person, true, sim.now);
    expect(await read({ op: 'book' })).toMatchObject({ book: { visibility: 'hidden' } });
    replay = true;
    expect(await read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
  });
});
