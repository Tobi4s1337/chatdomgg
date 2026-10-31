import { describe, expect, it } from 'vitest';
import { simulatedPassport, simulatedPassportPage } from './fixtures';
import {
  acknowledgesDisclosure, createPassportSession, followDisclosure, newerDisclosure,
  type PassportDisclosureView, type PassportReadState, type PassportReplyView, type PassportRequestView,
} from './session';
import type { PassportCollection, VisiblePassportView } from './types';

/** A transport whose replies the test hands out one by one, recording every request and abort. */
function scripted() {
  const pending: { request: PassportRequestView; signal: AbortSignal; resolve: (reply: PassportReplyView | undefined) => void; reject: (error: Error) => void }[] = [];
  const transport = (request: PassportRequestView, signal: AbortSignal) =>
    new Promise<PassportReplyView | undefined>((resolve, reject) => { pending.push({ request, signal, resolve, reject }); });
  const take = (match: (request: PassportRequestView) => boolean = () => true) => {
    const index = pending.findIndex(entry => match(entry.request));
    if (index < 0) throw new Error('no such request in flight');
    return pending.splice(index, 1)[0]!;
  };
  return { transport, pending, take };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const visible = (state: PassportReadState) => {
  if (state.kind !== 'visible') throw new Error(`expected visible, got ${state.kind}`);
  return state;
};
const many = simulatedPassport('many');
const pageOf = (collection: PassportCollection, book: VisiblePassportView = many) =>
  ({ kind: 'page', collection, revision: book.revision, page: simulatedPassportPage('many', collection, book[collection].nextCursor!)! }) as PassportReplyView;
const isPage = (collection: PassportCollection) => (request: PassportRequestView) => request.op === 'page' && request.collection === collection;

describe('a passport reading session', () => {
  it('starts pending and keeps pending, unavailable, hidden and visible distinct', async () => {
    const cases: [PassportReplyView | undefined | Error, PassportReadState['kind'], string?][] = [
      [{ kind: 'book', book: many }, 'visible'],
      [{ kind: 'book', book: { version: 1, origin: 'live', visibility: 'hidden' } }, 'hidden'],
      [undefined, 'unavailable', 'malformed'],
      [{ kind: 'denied', code: 'unavailable' }, 'unavailable', 'unavailable'],
      [new Error('offline'), 'unavailable', 'unavailable'],
    ];
    for (const [reply, kind, cause] of cases) {
      const wire = scripted();
      const session = createPassportSession(wire.transport);
      session.open();
      expect(session.state().kind).toBe('pending');
      const entry = wire.take();
      if (reply instanceof Error) entry.reject(reply); else entry.resolve(reply);
      await flush();
      expect(session.state().kind).toBe(kind);
      if (cause) expect(session.state()).toEqual({ kind: 'unavailable', cause });
    }
  });

  it('opens an empty book as visible and empty, never as unavailable', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    session.open();
    wire.take().resolve({ kind: 'book', book: simulatedPassport('none') });
    await flush();
    expect(visible(session.state()).shelf.stamps).toEqual({ items: [], nextCursor: null });
  });

  it('turns each collection on its own: one failing leaves the other loading and then loaded', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    session.open();
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    session.more('stamps'); session.more('bonds'); session.more('stamps');
    expect(wire.pending.map(entry => entry.request)).toEqual([
      { op: 'page', collection: 'stamps', cursor: many.stamps.nextCursor, revision: many.revision },
      { op: 'page', collection: 'bonds', cursor: many.bonds.nextCursor, revision: many.revision },
    ]);
    expect(visible(session.state()).shelf.stamps.pending).toBe(true);
    wire.take(isPage('bonds')).reject(new Error('bonds authority down'));
    await flush();
    expect(visible(session.state()).shelf.bonds).toMatchObject({ failed: true, pending: false, items: many.bonds.items });
    expect(visible(session.state()).shelf.stamps.pending).toBe(true);
    wire.take(isPage('stamps')).resolve(pageOf('stamps'));
    await flush();
    const stamps = visible(session.state()).shelf.stamps;
    expect(stamps.items).toHaveLength(90);
    expect(stamps).toMatchObject({ nextCursor: null, pending: false, failed: false });
    expect(visible(session.state()).shelf.bonds.failed).toBe(true);
  });

  it('reopens the whole book when a page belongs to another revision, then turns again once', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    session.open();
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    session.more('keepsakes');
    wire.take(isPage('keepsakes')).resolve({ ...pageOf('keepsakes'), revision: 'sim:many:2' } as PassportReplyView);
    await flush();
    // Nothing of the other snapshot was stitched on; the book is being read again.
    expect(visible(session.state()).shelf.keepsakes.items).toHaveLength(many.keepsakes.items.length);
    const reopened = { ...many, revision: 'sim:many:2' };
    wire.take(request => request.op === 'book').resolve({ kind: 'book', book: reopened });
    await flush();
    expect(visible(session.state()).book.revision).toBe('sim:many:2');
    const again = wire.take(isPage('keepsakes'));
    expect(again.request).toMatchObject({ revision: 'sim:many:2' });
    again.resolve(pageOf('keepsakes', reopened));
    await flush();
    expect(visible(session.state()).shelf.keepsakes.items.length).toBeGreaterThan(many.keepsakes.items.length);
  });

  it('treats a page that repeats a loaded record or postdates the book as another snapshot', async () => {
    for (const reply of [
      { kind: 'page', collection: 'stamps', revision: many.revision, page: { items: [many.stamps.items[0]!], nextCursor: null } },
      { kind: 'page', collection: 'stamps', revision: many.revision, page: { items: [{ ...many.stamps.items[0]!, id: 'arrival:later', at: many.asOf + 1 }], nextCursor: null } },
      { kind: 'denied', code: 'stale' },
    ] as PassportReplyView[]) {
      const wire = scripted();
      const session = createPassportSession(wire.transport);
      session.open();
      wire.take().resolve({ kind: 'book', book: many });
      await flush();
      session.more('stamps');
      wire.take(isPage('stamps')).resolve(reply);
      await flush();
      expect(wire.pending.map(entry => entry.request.op)).toEqual(['book']);
      expect(visible(session.state()).shelf.stamps.items).toHaveLength(50);
    }
  });

  it('keeps the consistent book it has when reopening after a stale page fails, and says the turn failed', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    session.open();
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    session.more('stamps');
    wire.take().resolve({ kind: 'denied', code: 'stale' });
    await flush();
    wire.take().reject(new Error('offline'));
    await flush();
    expect(visible(session.state()).shelf.stamps).toMatchObject({ failed: true, pending: false });
  });

  it('drops the whole book when a page read answers hidden, and aborts every other read', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    session.open();
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    session.more('stamps'); session.more('bonds');
    const bonds = wire.take(isPage('bonds'));
    wire.take(isPage('stamps')).resolve({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
    await flush();
    expect(session.state()).toEqual({ kind: 'hidden', origin: 'simulated' });
    expect(bonds.signal.aborted).toBe(true);
    bonds.resolve(pageOf('bonds'));
    await flush();
    expect(session.state()).toEqual({ kind: 'hidden', origin: 'simulated' });
  });

  it('never lets a late reply land after close or after opening again', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    const seen: string[] = [];
    session.subscribe(state => seen.push(state.kind));
    session.open();
    const first = wire.take();
    session.open();
    expect(first.signal.aborted).toBe(true);
    first.resolve({ kind: 'book', book: simulatedPassport('few') });
    await flush();
    expect(session.state().kind).toBe('pending');
    const second = wire.take();
    session.close();
    second.resolve({ kind: 'book', book: many });
    await flush();
    expect(session.state().kind).toBe('pending');
    expect(seen).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('following the card’s disclosure', () => {
  const shown = (revision: number): PassportDisclosureView => ({ origin: 'simulated', travels: 'shown', revision });
  const hidden = (revision: number): PassportDisclosureView => ({ origin: 'simulated', travels: 'hidden', revision });

  it('never asks for a book the card already hides', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    followDisclosure(session)(hidden(3));
    await flush();
    expect(wire.pending).toHaveLength(0);
    expect(session.state()).toEqual({ kind: 'hidden', origin: 'simulated' });
  });

  it('a hide that lands while the book is being read wins: the read is aborted and its late reply never lands', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    const follow = followDisclosure(session);
    follow(shown(3));
    const read = wire.take();
    follow(hidden(4));
    expect(read.signal.aborted).toBe(true);
    read.resolve({ kind: 'book', book: many });
    await flush();
    expect(session.state().kind).toBe('hidden');
    expect(JSON.stringify(session.state())).not.toMatch(/Wren|Tarnwalker|stamp|revision/);
  });

  it('a hide while older pages are out drops the open book and every page read with it', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    const follow = followDisclosure(session);
    follow(shown(3));
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    session.more('stamps');
    session.more('bonds');
    const pages = [wire.take(isPage('stamps')), wire.take(isPage('bonds'))];
    follow(hidden(4));
    expect(pages.every(page => page.signal.aborted)).toBe(true);
    pages[0]!.resolve(pageOf('stamps'));
    pages[1]!.resolve(pageOf('bonds'));
    await flush();
    expect(session.state()).toEqual({ kind: 'hidden', origin: 'simulated' });
  });

  it('reads a fresh snapshot when the travels are shown again, and ignores a stale shown from before the hide', async () => {
    const wire = scripted();
    const session = createPassportSession(wire.transport);
    const follow = followDisclosure(session);
    follow(shown(3));
    wire.take().resolve({ kind: 'book', book: many });
    await flush();
    follow(hidden(4));
    // A cached card from before the hide: ignored, nothing is read, the book stays closed.
    follow(shown(3));
    follow(shown(4));
    await flush();
    expect(wire.pending).toHaveLength(0);
    expect(session.state().kind).toBe('hidden');
    // Shown again at a newer revision: the book is read from the start, pending until it answers.
    follow(shown(5));
    expect(session.state().kind).toBe('pending');
    expect(wire.take().request).toEqual({ op: 'book' });
    // The same disclosure again is not a reason to read again.
    follow(shown(5));
    expect(wire.pending).toHaveLength(0);
  });

  it('with no disclosure to follow, the book is read once', () => {
    const wire = scripted();
    const follow = followDisclosure(createPassportSession(wire.transport));
    follow(undefined);
    follow(undefined);
    expect(wire.pending).toHaveLength(1);
  });

  it('takes the newer disclosure, and hidden at the same revision', () => {
    expect(newerDisclosure(shown(3), hidden(4))).toEqual(hidden(4));
    expect(newerDisclosure(shown(5), hidden(4))).toEqual(shown(5));
    expect(newerDisclosure(shown(4), hidden(4))).toEqual(hidden(4));
    expect(newerDisclosure(hidden(4), shown(4))).toEqual(hidden(4));
    expect(newerDisclosure(undefined, shown(2))).toEqual(shown(2));
  });

  it('counts only an answer with the travels as asked, at a newer revision, as an acknowledged change', () => {
    expect(acknowledgesDisclosure(shown(3), 'hidden', hidden(4))).toBe(true);
    expect(acknowledgesDisclosure(shown(3), 'hidden', shown(4))).toBe(false);
    expect(acknowledgesDisclosure(shown(3), 'hidden', hidden(3))).toBe(false);
    expect(acknowledgesDisclosure(shown(3), 'hidden', { ...hidden(4), origin: 'live' })).toBe(false);
    expect(acknowledgesDisclosure(shown(3), 'hidden', { ...hidden(4), revision: 4.5 })).toBe(false);
    for (const nothing of [undefined, null, 'ok', true, {}]) expect(acknowledgesDisclosure(shown(3), 'hidden', nothing)).toBe(false);
    expect(acknowledgesDisclosure(undefined, 'shown', shown(0))).toBe(true);
  });
});
