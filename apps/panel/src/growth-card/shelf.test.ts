import { expect, it } from 'vitest';
import { simulatedPassport } from '../../../../packages/ui/src/passport/fixtures';
import type { PassportReplyView, PassportTransport } from '../../../../packages/ui/src/passport/session';
import { createEarnedShelf, type ShelfState } from './shelf';

it('requires disclosure, replaces subjects safely, and distinguishes empty, invalid and unavailable', async () => {
  const flush = () => new Promise<void>(done => setImmediate(done));
  const few = simulatedPassport('few'), none = simulatedPassport('none'), many = simulatedPassport('many');
  const shown = { origin: 'simulated', travels: 'shown', revision: 1 } as const;
  let resolve!: (value: PassportReplyView | undefined) => void;
  const deferred: PassportTransport = () => new Promise(done => { resolve = done; });
  const states: ShelfState[] = [];
  const shelf = createEarnedShelf(state => states.push(state));
  shelf.replace(few.holder.personId, null, deferred);
  expect(states.at(-1)).toEqual({ kind: 'unavailable' });
  shelf.replace(few.holder.personId, shown, deferred);
  const old = resolve;
  shelf.replace(few.holder.personId, { ...shown, travels: 'hidden', revision: 2 }, deferred);
  old({ kind: 'book', book: few }); await flush();
  expect(states.at(-1)).toEqual({ kind: 'hidden', origin: 'simulated' });
  shelf.replace(few.holder.personId, shown, deferred);
  expect(states.at(-1)).toEqual({ kind: 'hidden', origin: 'simulated' });
  shelf.replace(none.holder.personId, shown, deferred);
  resolve({ kind: 'book', book: none }); await flush();
  expect(states.at(-1)).toEqual({ kind: 'empty', origin: 'simulated' });
  shelf.replace(few.holder.personId, shown, deferred);
  expect(states.at(-1)).toEqual({ kind: 'hidden', origin: 'simulated' });
  shelf.replace(few.holder.personId, { ...shown, revision: 3 }, deferred);
  resolve({ kind: 'book', book: none }); await flush();
  expect(states.at(-1)).toEqual({ kind: 'invalid', origin: 'simulated' });
  shelf.replace(few.holder.personId, { ...shown, revision: 3 }, deferred);
  resolve({ kind: 'book', book: few }); await flush();
  expect(states.at(-1)).toMatchObject({ kind: 'ready', origin: 'simulated', items: few.keepsakes.items });
  shelf.replace(few.holder.personId, { ...shown, revision: 3 }, deferred);
  resolve({ kind: 'book', book: { ...few, keepsakes: null } } as unknown as PassportReplyView); await flush();
  expect(states.at(-1)).toEqual({ kind: 'invalid', origin: 'simulated' });
  shelf.replace(few.holder.personId, { ...shown, revision: 3 }, async () => { throw new Error('offline'); }); await flush();
  expect(states.at(-1)).toEqual({ kind: 'unavailable', origin: 'simulated' });
  shelf.replace(few.holder.personId, { ...shown, travels: 'hidden', revision: 4 }, null);
  expect(states.at(-1)).toEqual({ kind: 'hidden', origin: 'simulated' });
  shelf.replace(many.holder.personId, shown, deferred);
  resolve({ kind: 'book', book: many }); await flush();
  expect(states.at(-1)).toMatchObject({ kind: 'ready', items: many.keepsakes.items.slice(0, 3), hasMore: true });
  shelf.replace(few.holder.personId, { origin: 'live', travels: 'shown', revision: 1 }, deferred);
  expect(states.at(-1)).toEqual({ kind: 'loading', origin: 'live' });
  shelf.close(); expect(states.at(-1)).toEqual({ kind: 'unavailable' });
});

it('does not start a read if disclosure changes synchronously during loading', () => {
  let reads = 0;
  const states: ShelfState[] = [];
  const transport: PassportTransport = async () => { reads++; return undefined; };
  const shelf = createEarnedShelf(state => {
    states.push(state);
    if (state.kind === 'loading') shelf.replace('930000002', { origin: 'simulated', travels: 'hidden', revision: 2 }, null);
  });
  shelf.replace('930000002', { origin: 'simulated', travels: 'shown', revision: 1 }, transport);
  expect(reads).toBe(0);
  expect(states.at(-1)).toEqual({ kind: 'hidden', origin: 'simulated' });
});

it('snapshots disclosure origin before an asynchronous read', async () => {
  const book = simulatedPassport('few');
  const disclosure: { origin: 'live' | 'simulated'; travels: 'shown' | 'hidden'; revision: number } = { origin: 'simulated', travels: 'shown', revision: 1 };
  let resolve!: (value: PassportReplyView | undefined) => void;
  const states: ShelfState[] = [];
  const shelf = createEarnedShelf(state => states.push(state));
  shelf.replace(book.holder.personId, disclosure, () => new Promise(done => { resolve = done; }));
  disclosure.origin = 'live';
  resolve({ kind: 'book', book: { ...book, origin: 'live' } });
  await new Promise<void>(done => setImmediate(done));
  expect(states.at(-1)).toEqual({ kind: 'invalid', origin: 'simulated' });
});

it('rejects an invalid subject before invoking the passport transport', () => {
  let reads = 0;
  const states: ShelfState[] = [];
  const shelf = createEarnedShelf(state => states.push(state));
  shelf.replace('not-a-twitch-id', { origin: 'simulated', travels: 'shown', revision: 1 }, async () => { reads++; return undefined; });
  expect(reads).toBe(0);
  expect(states.at(-1)).toEqual({ kind: 'invalid' });
});

it('rejects a hidden passport from a different origin without exposing it as an empty shelf', async () => {
  const states: ShelfState[] = [];
  const shelf = createEarnedShelf(state => states.push(state));
  shelf.replace('930000002', { origin: 'simulated', travels: 'shown', revision: 1 }, async () => ({ kind: 'book', book: { version: 1, origin: 'live', visibility: 'hidden' } }));
  await new Promise<void>(done => setImmediate(done));
  expect(states.at(-1)).toEqual({ kind: 'invalid', origin: 'simulated' });
});
