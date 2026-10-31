import { shelfOf, type Loaded, type PassportShelf } from './pages';
import type { PageView, PassportCollection, PassportItemView, PassportView, VisiblePassportView } from './types';

/**
 * Reading one passport from its owner, the way every surface (panel, card page, bench) does it.
 *
 * The session never decides what a reply means on its own: a transport reads the wire with the passport boundary
 * reader (`readPassportReply` in `apps/api/src/passport/contracts.ts`) and hands over either a checked reply or
 * `undefined` for one the reader refused. The session then keeps four promises:
 *
 * - **Distinct states.** Pending, unavailable, hidden and visible are different states; a refused or failed first
 *   read is unavailable, never an empty book.
 * - **Independent pages.** Each collection turns to its next page on its own, with its own cursor and its own
 *   in-flight read; one failing leaves the others as they were.
 * - **One snapshot.** A page that belongs to another revision, repeats a loaded record or postdates the book is
 *   stale: the whole book is read again and replaces what was shown, never mixed with it.
 * - **No late arrivals.** Opening again, closing or turning hidden aborts every read in flight, and a reply that
 *   still arrives afterwards is dropped. Hidden replaces a visible book whole.
 */
export type PassportRequestView =
  | { readonly op: 'book' }
  | { readonly op: 'page'; readonly collection: PassportCollection; readonly cursor: string; readonly revision: string };

export type PassportPageReplyView = {
  [K in PassportCollection]: { readonly kind: 'page'; readonly collection: K; readonly revision: string; readonly page: PageView<PassportItemView<K>> }
}[PassportCollection];

export type PassportReplyView =
  | { readonly kind: 'book'; readonly book: PassportView }
  | PassportPageReplyView
  | { readonly kind: 'denied'; readonly code: 'stale' | 'unavailable' | 'invalid' };

/** Sends one read. Resolves `undefined` when the boundary reader refused the reply; rejects when the read failed. */
export type PassportTransport = (request: PassportRequestView, signal: AbortSignal) => Promise<PassportReplyView | undefined>;

export type PassportReadState =
  | { readonly kind: 'pending' }
  /** `malformed`: the owner answered something the boundary refused. `unavailable`: no answer could be had. */
  | { readonly kind: 'unavailable'; readonly cause: 'malformed' | 'unavailable' }
  | { readonly kind: 'hidden'; readonly origin: 'live' | 'simulated' }
  | { readonly kind: 'visible'; readonly book: VisiblePassportView; readonly shelf: PassportShelf };

export interface PassportSession {
  readonly state: () => PassportReadState;
  subscribe(listener: (state: PassportReadState) => void): () => void;
  /** Read the book from the start. Anything shown before is dropped first. */
  open(): void;
  /** Turn one collection to its next page. */
  more(collection: PassportCollection): void;
  /** Stop: every read in flight is aborted and nothing that arrives later lands. */
  close(): void;
}

const RECORD_KEY: { readonly [K in PassportCollection]: (item: PassportItemView<K>) => string } = {
  stamps: stamp => stamp.id, kingdoms: visit => visit.kingdom.kingdomId, bonds: bond => bond.id, keepsakes: keepsake => keepsake.id,
};
const RECORD_TIME: { readonly [K in PassportCollection]: (item: PassportItemView<K>) => number } = {
  stamps: stamp => stamp.at, kingdoms: visit => visit.lastAt, bonds: bond => bond.since, keepsakes: keepsake => keepsake.earnedAt,
};

/** Whether a page can continue this book's collection without mixing snapshots. */
export function continuesBook(book: VisiblePassportView, loaded: Loaded<unknown>, reply: PassportPageReplyView, collection: PassportCollection): boolean {
  if (reply.collection !== collection || reply.revision !== book.revision) return false;
  const key = RECORD_KEY[collection] as (item: unknown) => string;
  const time = RECORD_TIME[collection] as (item: unknown) => number;
  const seen = new Set(loaded.items.map(key));
  return reply.page.items.every(item => !seen.has(key(item)) && time(item) <= book.asOf);
}

export function createPassportSession(transport: PassportTransport): PassportSession {
  let state: PassportReadState = { kind: 'pending' };
  const listeners = new Set<(state: PassportReadState) => void>();
  /** Bumped by every open, close and hide: a reply from an earlier generation is never applied. */
  let generation = 0;
  const reads = new Set<AbortController>();
  const pages = new Map<PassportCollection, AbortController>();

  const set = (next: PassportReadState) => { state = next; for (const listener of [...listeners]) listener(next); };
  const abortAll = () => { for (const read of reads) read.abort(); reads.clear(); pages.clear(); };
  const send = async (request: PassportRequestView, controller: AbortController) => {
    reads.add(controller);
    try { return { ok: true as const, reply: await transport(request, controller.signal) }; }
    catch { return { ok: false as const }; }
    finally { reads.delete(controller); }
  };
  const hide = (origin: 'live' | 'simulated') => { abortAll(); generation++; set({ kind: 'hidden', origin }); };
  const show = (book: VisiblePassportView) => { abortAll(); set({ kind: 'visible', book, shelf: shelfOf(book) }); };
  const mark = (collection: PassportCollection, patch: Partial<Loaded<unknown>>) => {
    if (state.kind !== 'visible') return;
    const loaded = state.shelf[collection] as Loaded<unknown>;
    set({ ...state, shelf: { ...state.shelf, [collection]: { ...loaded, pending: false, failed: false, ...patch } } as PassportShelf });
  };

  /** A whole book replaces whatever was shown. `then` turns a collection again once a fresh snapshot is open. */
  async function readBook(then?: { collection: PassportCollection; retry: boolean }) {
    const at = generation;
    const result = await send({ op: 'book' }, new AbortController());
    if (at !== generation) return;
    const reply = result.ok ? result.reply : undefined;
    if (reply?.kind === 'book') {
      if (reply.book.visibility === 'hidden') return hide(reply.book.origin);
      show(reply.book);
      if (then?.retry) turn(then.collection, false);
      return;
    }
    // The first read fails closed. A reopen after a stale page keeps the consistent book already shown.
    if (then && state.kind === 'visible') return mark(then.collection, { failed: true });
    set({ kind: 'unavailable', cause: result.ok && (reply === undefined || reply.kind === 'page') ? 'malformed' : 'unavailable' });
  }

  function turn(collection: PassportCollection, retryOnStale: boolean) {
    if (state.kind !== 'visible' || pages.has(collection)) return;
    const { book } = state;
    const loaded = state.shelf[collection] as Loaded<unknown>;
    if (!loaded.nextCursor) return;
    const controller = new AbortController();
    pages.set(collection, controller);
    mark(collection, { pending: true });
    const at = generation;
    void send({ op: 'page', collection, cursor: loaded.nextCursor, revision: book.revision }, controller).then(result => {
      if (at !== generation || pages.get(collection) !== controller || state.kind !== 'visible' || state.book !== book) return;
      pages.delete(collection);
      const reply = result.ok ? result.reply : undefined;
      if (reply?.kind === 'book') {
        if (reply.book.visibility === 'hidden') return hide(reply.book.origin);
        return show(reply.book);
      }
      const current = state.shelf[collection] as Loaded<unknown>;
      const stale = reply?.kind === 'denied' ? reply.code === 'stale' : reply?.kind === 'page' && !continuesBook(book, current, reply, collection);
      if (stale) {
        // Another snapshot: read the whole book again instead of stitching this page onto the old one.
        mark(collection, { pending: true });
        return void readBook({ collection, retry: retryOnStale });
      }
      if (reply?.kind !== 'page') return mark(collection, { failed: true });
      mark(collection, { items: [...current.items, ...reply.page.items], nextCursor: reply.page.nextCursor });
    });
  }

  return {
    state: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open() { abortAll(); generation++; set({ kind: 'pending' }); void readBook(); },
    more(collection) { turn(collection, true); },
    close() { abortAll(); generation++; set({ kind: 'pending' }); },
  };
}
