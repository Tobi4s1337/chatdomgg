import { describe, expect, it } from 'vitest';
import { PassportBookSchema } from '@chatdom/shared/passport';
import type { CardSource } from '../citizen-card/contracts';
import { readPassportReply, type PassportReply, type VisiblePassportBook } from './contracts';
import { createPassportReader, type PassportPorts, type PassportReadFault } from './read';
import { simulatedPassportAuthorities, type SimulatedScenario } from './simulated';

const SHOWN: SimulatedScenario = { signedIn: true, travelsHidden: false };

function setup(name: 'none' | 'few' | 'many', scenario: SimulatedScenario = SHOWN, patch: (ports: PassportPorts) => Partial<PassportPorts> = () => ({})) {
  const sim = simulatedPassportAuthorities(name, scenario);
  const calls: string[] = [];
  const base = sim.ports;
  const ports: PassportPorts = {
    origin: base.origin,
    card: (key, signal) => { calls.push('card'); return base.card(key, signal); },
    stamps: (person, cursor, signal) => { calls.push(`stamps:${cursor}`); return base.stamps(person, cursor, signal); },
    visits: (person, cursor, signal) => { calls.push(`kingdoms:${cursor}`); return base.visits(person, cursor, signal); },
    bonds: (person, cursor, signal) => { calls.push(`bonds:${cursor}`); return base.bonds(person, cursor, signal); },
    keepsakes: (person, cursor, signal) => { calls.push(`keepsakes:${cursor}`); return base.keepsakes(person, cursor, signal); },
    kingdoms: (ids, signal) => { calls.push('directory'); return base.kingdoms(ids, signal); },
    roads: (ids, signal) => { calls.push('roads'); return base.roads(ids, signal); },
    gifts: (holder, ids, signal) => { calls.push('gifts'); return base.gifts(holder, ids, signal); },
  };
  Object.assign(ports, patch(base));
  const faults: PassportReadFault[] = [];
  const reader = createPassportReader(ports, { report: fault => faults.push(fault) });
  const read = (request: unknown) => reader.handle({ key: sim.key, now: sim.now, signal: new AbortController().signal }, request);
  return { sim, ports, reader, read, calls, faults };
}

const visible = (reply: PassportReply): VisiblePassportBook => {
  if (reply.kind !== 'book' || reply.book.visibility !== 'visible') throw new Error(`expected a visible book, got ${JSON.stringify(reply)}`);
  return reply.book;
};

describe('the passport reader: disclosure first', () => {
  it('answers the hidden variant before the first sign-in and never asks a history authority', async () => {
    const { read, calls } = setup('many', { signedIn: false, travelsHidden: false });
    const reply = await read({ op: 'book' });
    expect(reply).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
    expect(calls.every(call => call === 'card')).toBe(true);
  });

  it('answers hidden for hidden travels with nothing travel-derived anywhere in the payload', async () => {
    const { read, calls } = setup('many', { signedIn: true, travelsHidden: true });
    const book = await read({ op: 'book' });
    const page = await read({ op: 'page', collection: 'stamps', cursor: 'sim.stamps.1.50', revision: 'p1.1.1.1.1' });
    for (const reply of [book, page]) {
      expect(reply).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
      const wire = JSON.stringify(reply);
      for (const leak of ['Wren', 'Tarnwalker', 'Hollowmere', 'Copperleaf', 'raid', 'cursor', 'revision', 'holder']) expect(wire).not.toContain(leak);
    }
    expect(calls.filter(call => call !== 'card')).toEqual([]);
  });

  it('lets a hide that lands while the history is read win over the history', async () => {
    let reads = 0;
    const { read } = setup('few', SHOWN, ports => ({
      card: async (key, signal): Promise<CardSource> => {
        const source = await ports.card(key, signal);
        return ++reads === 1 ? source : { ...source, travelsHidden: true };
      },
    }));
    expect(await read({ op: 'book' })).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
  });

  it('treats a Gate that keeps the passport hidden as hidden, whatever the card says', async () => {
    const { read } = setup('few', SHOWN, ports => ({
      stamps: async (person, cursor, signal) => ({ ...await ports.stamps(person, cursor, signal), hidden: true, stamps: [], nextCursor: null }),
    }));
    expect(await read({ op: 'book' })).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
  });

  it('refuses a simulated authority answering for a live card, a card for someone else and an unreadable card', async () => {
    const live = setup('few', SHOWN, ports => ({ card: async (key, signal) => { const s = await ports.card(key, signal); return { ...s, document: { ...s.document, origin: 'live' } }; } }));
    expect(await live.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(live.faults[0]?.kind).toBe('origin');

    const other = setup('few', SHOWN, ports => ({
      card: async (key, signal) => { const s = await ports.card(key, signal); return { ...s, document: { ...s.document, key: { ...s.document.key, personId: '930000099' as typeof key.personId } } }; },
    }));
    expect(await other.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });

    const corrupt = setup('few', SHOWN, ports => ({ card: async (key, signal) => ({ ...await ports.card(key, signal), travelsHidden: 'no' as unknown as boolean }) }));
    expect(await corrupt.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(corrupt.faults[0]?.kind).toBe('source');
  });
});

describe('the passport reader: witnessed records', () => {
  it('opens the few-journeys book from minimal Gate stamps joined to their kingdom, road, leader and accepted gifts', async () => {
    const { read } = setup('few');
    const book = visible(await read({ op: 'book' }));
    expect(PassportBookSchema.safeParse(book).success).toBe(true);
    expect(book.holder).toEqual({ personId: '930000002', name: 'Pellam Rook' });
    expect(book.revision).toBe('p1.1.1.1.1');
    expect(book.stamps.items.map(stamp => stamp.id)).toEqual(['arrival:f5', 'arrival:f4', 'arrival:f3', 'arrival:f2', 'arrival:f1']);
    const [hollowmere, copperleafVisit, brindlewick, , copperleafRaid] = book.stamps.items;
    expect(hollowmere).toMatchObject({ kind: 'raid', raidId: 'raid:f5', road: { from: '910000101', to: '910000002' }, leader: { name: 'Maple Wren' }, kingdom: { name: 'Hollowmere' } });
    expect(hollowmere!.gifts).toEqual([{ id: 'gift:f5a', name: 'A jar of heather honey', direction: 'left', keepsakeId: null }]);
    // A refused offer stays in the gift ledger and never reaches the page.
    expect(copperleafVisit).toMatchObject({ kind: 'visit', gifts: [] });
    // An unknown leader stays unknown.
    expect(brindlewick).toMatchObject({ kind: 'raid', leader: null });
    expect(copperleafRaid!.gifts.map(gift => gift.direction)).toEqual(['left', 'brought-back']);
    expect(book.kingdoms.items).toHaveLength(4);
    expect(book.bonds.items).toHaveLength(2);
    expect(book.keepsakes.items).toHaveLength(2);
  });

  it('opens the empty book as a valid empty book, not an unavailable one', async () => {
    const book = visible(await setup('none').read({ op: 'book' }));
    for (const collection of ['stamps', 'kingdoms', 'bonds', 'keepsakes'] as const) expect(book[collection]).toEqual({ items: [], nextCursor: null });
  });

  it('makes the read unavailable instead of drawing a stamp whose kingdom, road or gift it cannot vouch for', async () => {
    const noKingdom = setup('few', SHOWN, ports => ({ kingdoms: async (ids, signal) => { const map = new Map(await ports.kingdoms(ids, signal)); map.delete('910000005'); return map; } }));
    expect(await noKingdom.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(noKingdom.faults[0]).toEqual({ kind: 'enrichment', collection: 'stamps', missing: { gap: 'kingdom', stampId: 'arrival:f2' } });

    const noRoad = setup('few', SHOWN, () => ({ roads: async () => new Map() }));
    expect(await noRoad.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(noRoad.faults[0]).toMatchObject({ missing: { gap: 'road', stampId: 'arrival:f5' } });

    const wrongRoad = setup('few', SHOWN, ports => ({
      roads: async (ids, signal) => new Map([...await ports.roads(ids, signal)].map(([id, road]) => [id, { ...road, road: { ...road.road, to: '910000009' as typeof road.road.to } }])),
    }));
    expect(await wrongRoad.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });

    const strangersGift = setup('few', SHOWN, ports => ({
      gifts: async (holder, ids, signal) => (await ports.gifts(holder, ids, signal)).map(record => ({ ...record, gift: { ...record.gift, from: '940000002' as typeof holder, to: '940000003' as typeof holder } })),
    }));
    expect(await strangersGift.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(strangersGift.faults[0]).toMatchObject({ missing: { gap: 'gift' } });

    const failing = setup('few', SHOWN, () => ({ bonds: async () => { throw new Error('bonds authority down'); } }));
    expect(await failing.read({ op: 'book' })).toEqual({ kind: 'denied', code: 'unavailable' });
  });

  it('refuses a book whose records postdate the moment it is read at', async () => {
    const sim = simulatedPassportAuthorities('few', SHOWN);
    const reader = createPassportReader(sim.ports);
    const reply = await reader.handle({ key: sim.key, now: sim.now - 5 * 86_400_000, signal: new AbortController().signal }, { op: 'book' });
    expect(reply).toEqual({ kind: 'denied', code: 'unavailable' });
  });
});

describe('the passport reader: pages and snapshots', () => {
  it('pages each collection on its own cursor, never more than 50 records, until the history ends', async () => {
    const { read } = setup('many');
    const book = visible(await read({ op: 'book' }));
    const counts: Record<string, number> = {};
    for (const collection of ['stamps', 'bonds', 'keepsakes'] as const) {
      let cursor = book[collection].nextCursor, total = book[collection].items.length, pages = 1;
      const ids = new Set<string>();
      while (cursor) {
        const reply = await read({ op: 'page', collection, cursor, revision: book.revision });
        if (reply.kind !== 'page' || reply.collection !== collection) throw new Error(JSON.stringify(reply));
        expect(reply.revision).toBe(book.revision);
        expect(reply.page.items.length).toBeLessThanOrEqual(50);
        for (const item of reply.page.items) ids.add((item as { id: string }).id);
        total += reply.page.items.length; cursor = reply.page.nextCursor; pages++;
      }
      expect(ids.size).toBe(total - book[collection].items.length);
      counts[collection] = total;
      expect(pages).toBeGreaterThan(1);
    }
    expect(counts).toEqual({ stamps: 90, bonds: 11, keepsakes: counts.keepsakes });
    expect(counts.keepsakes).toBeGreaterThan(6);
  });

  it('answers stale when a collection moved on since the book was read, and the reopened book carries the new journey', async () => {
    const { read } = setup('many', { ...SHOWN, revisedWhileReading: true });
    const first = visible(await read({ op: 'book' }));
    expect(await read({ op: 'page', collection: 'stamps', cursor: first.stamps.nextCursor!, revision: first.revision })).toEqual({ kind: 'denied', code: 'stale' });
    const second = visible(await read({ op: 'book' }));
    expect(second.revision).not.toBe(first.revision);
    expect(second.stamps.items[0]).toMatchObject({ id: 'arrival:sim-fresh', kind: 'visit' });
    // Bonds did not move: their pages still read against the reopened book.
    const bonds = await read({ op: 'page', collection: 'bonds', cursor: second.bonds.nextCursor!, revision: second.revision });
    expect(bonds.kind).toBe('page');
  });

  it('refuses requests it does not know, and revisions it never wrote', async () => {
    const { read } = setup('many');
    for (const request of [{ op: 'book', personId: '930000003' }, { op: 'page', collection: 'stamps', cursor: '' , revision: 'p1.1.1.1.1' }, { op: 'erase' }, null]) {
      expect(await read(request)).toEqual({ kind: 'denied', code: 'invalid' });
    }
    expect(await read({ op: 'page', collection: 'stamps', cursor: 'sim.stamps.1.50', revision: 'some-other' })).toEqual({ kind: 'denied', code: 'invalid' });
  });

  it('only sends replies that its own boundary reader accepts', async () => {
    const { read } = setup('many');
    const reply = await read({ op: 'book' });
    expect(readPassportReply(JSON.parse(JSON.stringify(reply)))).toEqual(reply);
  });
});
