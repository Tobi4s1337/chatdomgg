import { describe, expect, it } from 'vitest';
import { readPassportReply, readPassportRequest } from './contracts';
import { simulatedPassportAuthorities } from './simulated';
import { createPassportReader } from './read';

async function fewBook() {
  const sim = simulatedPassportAuthorities('few', { signedIn: true, travelsHidden: false });
  const reply = await createPassportReader(sim.ports).handle({ key: sim.key, now: sim.now, signal: new AbortController().signal }, { op: 'book' });
  return JSON.parse(JSON.stringify(reply)) as { kind: 'book'; book: Record<string, unknown> & { stamps: { items: Record<string, unknown>[] } } };
}

describe('the passport boundary reader', () => {
  it('accepts exactly the hidden variant and refuses one that carries anything more', () => {
    expect(readPassportReply({ kind: 'book', book: { version: 1, origin: 'live', visibility: 'hidden' } })).toEqual({ kind: 'book', book: { version: 1, origin: 'live', visibility: 'hidden' } });
    for (const extra of [{ holder: { personId: '1', name: 'A' } }, { revision: 'p1.1.1.1.1' }, { stamps: { items: [], nextCursor: null } }]) {
      expect(readPassportReply({ kind: 'book', book: { version: 1, origin: 'live', visibility: 'hidden', ...extra } })).toBeUndefined();
    }
  });

  it('refuses a malformed book instead of reading it as empty', async () => {
    const good = await fewBook();
    expect(readPassportReply(good)?.kind).toBe('book');
    const broken = [
      { ...good, book: { ...good.book, asOf: 'yesterday' } },
      { ...good, book: { ...good.book, stamps: { items: good.book.stamps.items.map(stamp => ({ ...stamp, kingdom: { ...(stamp.kingdom as object), crest: 'red' } })), nextCursor: null } } },
      { ...good, book: { ...good.book, stamps: { items: [...good.book.stamps.items, good.book.stamps.items[0]], nextCursor: null } } },
      { ...good, book: { ...good.book, origin: 'imagined' } },
      { ...good, extra: true },
    ];
    for (const reply of broken) expect(readPassportReply(reply)).toBeUndefined();
  });

  it('checks a page record by record: bounded, unique, and never an empty page that claims more', async () => {
    const { book } = await fewBook();
    const stamps = book.stamps.items;
    const page = (items: unknown[], nextCursor: string | null = null) => ({ kind: 'page', collection: 'stamps', revision: 'p1.1.1.1.1', page: { items, nextCursor } });
    expect(readPassportReply(page(stamps))?.kind).toBe('page');
    expect(readPassportReply(page([...stamps, stamps[0]]))).toBeUndefined();
    expect(readPassportReply(page([], 'sim.stamps.1.50'))).toBeUndefined();
    expect(readPassportReply(page(Array.from({ length: 51 }, (_, i) => ({ ...stamps[1], id: `arrival:x${i}` }))))).toBeUndefined();
    expect(readPassportReply({ ...page(stamps), collection: 'bonds' })).toBeUndefined();
    expect(readPassportReply({ ...page(stamps), revision: '../p1' })).toBeUndefined();
    expect(readPassportReply({ kind: 'denied', code: 'stale' })).toEqual({ kind: 'denied', code: 'stale' });
    expect(readPassportReply({ kind: 'denied', code: 'forbidden' })).toBeUndefined();
  });

  it('reads requests with no room for a subject, an actor or a write', () => {
    expect(readPassportRequest({ op: 'book' })).toEqual({ op: 'book' });
    expect(readPassportRequest({ op: 'page', collection: 'keepsakes', cursor: 'sim.keepsakes.1.6', revision: 'p1.1.1.1.1' })).toBeDefined();
    expect(readPassportRequest({ op: 'book', personId: '1' })).toBeUndefined();
    expect(readPassportRequest({ op: 'page', collection: 'homes', cursor: 'x', revision: 'p1.1.1.1.1' })).toBeUndefined();
    expect(readPassportRequest({ op: 'page', collection: 'stamps', cursor: 'x'.repeat(257), revision: 'p1.1.1.1.1' })).toBeUndefined();
    expect(readPassportRequest({ op: 'hide-travels' })).toBeUndefined();
  });
});
