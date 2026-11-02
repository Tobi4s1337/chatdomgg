import type { ItemEvent, ItemPlace, ItemRecord, ItemReply } from '@chatdom/shared';
import { requestId, type ItemLink } from '../fishing/link';

export type BagStatus = 'loading' | 'ready' | 'unavailable';
export interface BagRefusal { readonly id: string; readonly itemId: string | null; readonly message: string; readonly at: number }
export type BagMoveResult = { readonly ok: true; readonly item: ItemRecord } | { readonly ok: false; readonly message: string };

export interface BagStore {
  /** The person's things, oldest first. A fresh frozen array after every change; the same array between changes. */
  items(): readonly ItemRecord[];
  item(itemId: string): ItemRecord | undefined;
  status(): BagStatus;
  /** Plain words the kingdom answered with when it refused something, newest last. */
  refused(): readonly BagRefusal[];
  subscribe(listener: () => void): () => void;
  move(itemId: string, to: ItemPlace, slot: number | null): Promise<BagMoveResult>;
  /** The whole recorded history of one thing, oldest first. Rejects with plain words. */
  history(itemId: string): Promise<readonly ItemEvent[]>;
  /** Reads every page again, as after `items.invalidated`. */
  refresh(): void;
  dispose(): void;
}

export interface BagStoreOptions {
  /** Only records owned by this person are kept. */
  readonly personId?: string;
  /** How long one request may go unanswered. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export const BAG_MAX_RECORDS = 2000;
const MAX_LIST_PAGES = Math.ceil(BAG_MAX_RECORDS / 32) + 8;
const MAX_HISTORY_EVENTS = 640;
const MAX_REFUSALS = 6;
const MAX_TOMBSTONES = 2000;

const WORDS = {
  unanswered: 'The kingdom has not answered yet. Open your bag again to check your things.',
  missing: 'This thing is no longer in your bag.',
  closed: 'The bag was closed before the kingdom answered.',
  history: 'Its story could not be read just now.',
} as const;

const held = (item: ItemRecord) => item.place !== 'spent';

/** Keeps one person's records in step with the realm's `items` channel. Pure logic: no DOM, no timers at rest. */
export function createBagStore(link: ItemLink, options: BagStoreOptions = {}): BagStore {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const now = options.now ?? Date.now;
  const records = new Map<string, ItemRecord>();
  /** Revisions of records that left (let go to nothing), so a slower page cannot bring them back. */
  const tombstones = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshot: readonly ItemRecord[] = Object.freeze([]);
  let dirty = false;
  let state: BagStatus = 'loading';
  let loaded = false;
  let refusals: readonly BagRefusal[] = Object.freeze([]);
  let disposed = false;

  interface Load { id: string; pages: number; seen: Set<string>; rows: Map<string, ItemRecord>; touched: Map<string, ItemRecord>; timer: ReturnType<typeof setTimeout> | null }
  let load: Load | null = null;
  const moves = new Map<string, { itemId: string; resolve: (result: BagMoveResult) => void; timer: ReturnType<typeof setTimeout> }>();
  const histories = new Map<string, { itemId: string; events: ItemEvent[]; pages: number; resolve: (events: readonly ItemEvent[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('A bag listener failed.', error); }
    }
  };
  const mine = (item: ItemRecord) => !!item && typeof item.id === 'string' && Number.isInteger(item.revision)
    && (options.personId === undefined || item.ownerId === options.personId);
  const newer = (item: ItemRecord, current: ItemRecord | undefined) => {
    const gone = tombstones.get(item.id);
    if (gone !== undefined && gone >= item.revision) return false;
    // An equal revision is the same commit (the direct reply and its push): keep the copy we have.
    return !current || current.revision < item.revision;
  };
  const bury = (id: string, revision: number) => {
    tombstones.delete(id); tombstones.set(id, revision);
    if (tombstones.size > MAX_TOMBSTONES) tombstones.delete(tombstones.keys().next().value!);
  };
  /** Merges one record into a map by revision. Never regresses; a spent record leaves. */
  const mergeInto = (target: Map<string, ItemRecord>, item: ItemRecord): boolean => {
    if (!mine(item) || !newer(item, target.get(item.id))) return false;
    if (!held(item)) {
      bury(item.id, item.revision);
      return target.delete(item.id);
    }
    if (!target.has(item.id) && target.size >= BAG_MAX_RECORDS) return false;
    target.set(item.id, item);
    return true;
  };
  const changed = () => { dirty = true; };
  const setStatus = (next: BagStatus) => { if (state !== next) { state = next; changed(); } };
  const refuse = (id: string, itemId: string | null, message: string) => {
    refusals = Object.freeze([...refusals, Object.freeze({ id, itemId, message, at: now() })].slice(-MAX_REFUSALS));
    changed();
  };
  const settle = () => { if (dirty) { dirty = false; snapshot = Object.freeze([...records.values()].sort(byAge)); emit(); } };

  const finishLoad = (current: Load) => {
    if (current.timer) clearTimeout(current.timer);
    load = null;
    // A list is a consistent page walk; anything pushed while it ran is newer evidence and wins by revision.
    const next = new Map<string, ItemRecord>();
    for (const item of current.rows.values()) mergeInto(next, item);
    for (const item of current.touched.values()) mergeInto(next, item);
    for (const [id, item] of next) {
      const kept = records.get(id);
      if (kept && kept.revision > item.revision) next.set(id, kept);
    }
    const same = next.size === records.size && [...next].every(([id, item]) => records.get(id) === item);
    if (!same) {
      records.clear();
      for (const [id, item] of next) records.set(id, item);
      changed();
    }
    loaded = true;
    setStatus('ready');
  };
  const failLoad = (current: Load, message: string | null) => {
    if (current.timer) clearTimeout(current.timer);
    load = null;
    if (message) refuse(current.id, null, message);
    setStatus(loaded ? 'ready' : 'unavailable');
  };
  const arm = (current: Load) => {
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => { if (load === current) { failLoad(current, loaded ? WORDS.unanswered : null); settle(); } }, timeoutMs);
  };
  const page = (current: Load, after?: string) => {
    current.pages++;
    arm(current);
    link.send(after === undefined ? { type: 'items.list', id: current.id } : { type: 'items.list', id: current.id, after });
  };
  const startLoad = () => {
    if (disposed) return;
    if (load?.timer) clearTimeout(load.timer);
    load = { id: requestId('bag'), pages: 0, seen: new Set(), rows: new Map(), touched: new Map(), timer: null };
    if (!loaded) setStatus('loading');
    page(load);
  };

  const onList = (reply: Extract<ItemReply, { type: 'items.list' }>) => {
    const current = load;
    if (!current || reply.id !== current.id) return;
    for (const item of Array.isArray(reply.items) ? reply.items : []) mergeInto(current.rows, item);
    const next = typeof reply.next === 'string' && reply.next.length > 0 ? reply.next : null;
    if (next && !current.seen.has(next) && current.pages < MAX_LIST_PAGES && current.rows.size < BAG_MAX_RECORDS) {
      current.seen.add(next);
      page(current, next);
      return;
    }
    finishLoad(current);
  };
  const onChanged = (reply: Extract<ItemReply, { type: 'items.changed' }>) => {
    const items = Array.isArray(reply.items) ? reply.items : [];
    for (const item of items) {
      if (mergeInto(records, item)) changed();
      if (load && mine(item)) {
        const prior = load.touched.get(item.id);
        if (!prior || prior.revision <= item.revision) load.touched.set(item.id, item);
      }
    }
    const move = reply.id === undefined ? undefined : moves.get(reply.id);
    if (move && reply.id !== undefined) {
      moves.delete(reply.id); clearTimeout(move.timer);
      const item = items.find(entry => entry.id === move.itemId) ?? records.get(move.itemId);
      move.resolve(item ? { ok: true, item: records.get(item.id) ?? item } : { ok: false, message: WORDS.missing });
    }
  };
  const onRefused = (reply: Extract<ItemReply, { type: 'items.refused' }>) => {
    const message = typeof reply.message === 'string' && reply.message.trim() ? reply.message : WORDS.unanswered;
    if (load && reply.id === load.id) { failLoad(load, message); return; }
    const move = moves.get(reply.id);
    if (move) {
      moves.delete(reply.id); clearTimeout(move.timer);
      refuse(reply.id, move.itemId, message);
      move.resolve({ ok: false, message });
      // The refusal may mean our copy is behind ("This thing has changed"). Read the bag again, bounded by pages.
      startLoad();
      return;
    }
    const history = histories.get(reply.id);
    if (history) { histories.delete(reply.id); clearTimeout(history.timer); history.reject(new Error(message)); }
  };
  const onHistory = (reply: Extract<ItemReply, { type: 'items.history' }>) => {
    const history = histories.get(reply.id);
    if (!history || reply.itemId !== history.itemId) return;
    for (const event of Array.isArray(reply.events) ? reply.events : []) {
      if (history.events.length >= MAX_HISTORY_EVENTS) break;
      if (event && event.itemId === history.itemId) history.events.push(event);
    }
    const next = typeof reply.next === 'string' && reply.next.length > 0 ? reply.next : null;
    if (next && history.pages < MAX_HISTORY_EVENTS / 32 && history.events.length < MAX_HISTORY_EVENTS) {
      histories.delete(reply.id);
      clearTimeout(history.timer);
      requestHistory(history.itemId, history.events, history.pages, history.resolve, history.reject, next);
      return;
    }
    histories.delete(reply.id); clearTimeout(history.timer);
    history.resolve(Object.freeze([...history.events]));
  };

  const requestHistory = (itemId: string, events: ItemEvent[], pages: number, resolve: (events: readonly ItemEvent[]) => void, reject: (error: Error) => void, after?: string) => {
    const id = requestId('story');
    const timer = setTimeout(() => { if (histories.delete(id)) reject(new Error(WORDS.history)); }, timeoutMs);
    histories.set(id, { itemId, events, pages: pages + 1, resolve, reject, timer });
    link.send(after === undefined ? { type: 'items.history', id, itemId } : { type: 'items.history', id, itemId, after });
  };

  const unsubscribe = link.subscribe(reply => {
    if (disposed || !reply || typeof reply !== 'object') return;
    switch (reply.type) {
      case 'items.list': onList(reply); break;
      case 'items.changed': onChanged(reply); break;
      case 'items.invalidated': startLoad(); break;
      case 'items.refused': onRefused(reply); break;
      case 'items.history': onHistory(reply); break;
      default: break;
    }
    settle();
  });

  startLoad();
  settle();

  return {
    items: () => snapshot,
    item: itemId => records.get(itemId),
    status: () => state,
    refused: () => refusals,
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    move(itemId, to, slot) {
      if (disposed) return Promise.resolve({ ok: false, message: WORDS.closed });
      const item = records.get(itemId);
      if (!item) return Promise.resolve({ ok: false, message: WORDS.missing });
      const id = requestId('move');
      return new Promise<BagMoveResult>(resolve => {
        const timer = setTimeout(() => {
          if (!moves.delete(id)) return;
          refuse(id, itemId, WORDS.unanswered);
          resolve({ ok: false, message: WORDS.unanswered });
          startLoad(); settle();
        }, timeoutMs);
        moves.set(id, { itemId, resolve, timer });
        link.send({ type: 'items.move', id, itemId, revision: item.revision, to, slot });
      });
    },
    history(itemId) {
      if (disposed) return Promise.reject(new Error(WORDS.closed));
      return new Promise<readonly ItemEvent[]>((resolve, reject) => requestHistory(itemId, [], 0, resolve, reject));
    },
    refresh() { startLoad(); settle(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (load?.timer) clearTimeout(load.timer);
      load = null;
      for (const move of moves.values()) { clearTimeout(move.timer); move.resolve({ ok: false, message: WORDS.closed }); }
      for (const history of histories.values()) { clearTimeout(history.timer); history.reject(new Error(WORDS.closed)); }
      moves.clear(); histories.clear(); listeners.clear();
    },
  };
}

function byAge(a: ItemRecord, b: ItemRecord): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
