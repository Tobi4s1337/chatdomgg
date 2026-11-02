import type { ItemEvent, ItemId, ItemRecord, KingdomId, PersonId } from '@chatdom/shared';
import { redactItem, type GrantReceipt, type ItemStore, type ItemTransaction, type ShelfRow } from './store';
import { ITEM_PAGE_ROWS } from './pages';

interface MemoryState {
  items: Map<string, ItemRecord>;
  events: Map<string, ItemEvent[]>;
  receipts: Map<string, GrantReceipt>;
  numbers: Map<string, number>;
  shared: Map<string, { defId: string; fingerprint: string; number: number }>;
  shelves: Map<string, ShelfRow & { kingdomId: KingdomId }>;
}

/** Test store with transactional snapshots, rollback and the same ordering as Postgres. Not a durable fallback. */
export function createMemoryItemStore(): ItemStore {
  let state: MemoryState = { items: new Map(), events: new Map(), receipts: new Map(), numbers: new Map(), shared: new Map(), shelves: new Map() };
  const hidden = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const rawList = (state: MemoryState, ownerId: PersonId, kingdomId: KingdomId) => [...state.items.values()]
    .filter(item => item.ownerId === ownerId && item.kingdomId === kingdomId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const shelfKey = (kingdomId: KingdomId, ownerId: PersonId, origin: ItemRecord['origin']) => JSON.stringify([kingdomId, ownerId, origin]);
  const plainShelf = (row: ShelfRow & { kingdomId: KingdomId }): ShelfRow => {
    const { kingdomId: _kingdom, ...rest } = row; void _kingdom;
    return structuredClone(rest);
  };
  const receiptKey = (kingdomId: KingdomId, ownerId: PersonId, origin: ItemRecord['origin'], key: string) => JSON.stringify([kingdomId, ownerId, origin, key]);
  const rawAtPlace = (state: MemoryState, ownerId: PersonId, kingdomId: KingdomId, origin: ItemRecord['origin'], place: 'hand' | 'hotbar' | 'shelf') => {
    const items: ItemRecord[] = [];
    const maximum = place === 'hand' ? 1 : 64;
    for (const item of state.items.values()) {
      if (item.ownerId !== ownerId || item.kingdomId !== kingdomId || item.origin !== origin || item.place !== place) continue;
      items.push(item);
      if (items.length > maximum) throw new Error('The item placement exceeds its capacity.');
    }
    return items.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  };
  const store: ItemStore = {
    async transaction(kingdomId, work) {
      const callbacks: (() => void)[] = [];
      const job = tail.then(async () => {
        const draft = structuredClone(state);
        let active = true;
        const check = () => { if (!active) throw new Error('The item transaction has ended.'); };
        const tx: ItemTransaction = {
          store, kingdomId,
          async get(id) { check(); const item = draft.items.get(id); return item?.kingdomId === kingdomId ? structuredClone(item) : null; },
          async list(ownerId) { check(); return structuredClone(rawList(draft, ownerId, kingdomId)); },
          async atPlace(ownerId, origin, place) { check(); return structuredClone(rawAtPlace(draft, ownerId, kingdomId, origin, place)); },
          async visible(item) { check(); return structuredClone(redactItem(item, hidden)); },
          async save(item) {
            check();
            if (item.kingdomId !== kingdomId) throw new Error('An item cannot move to another kingdom.');
            const previous = draft.items.get(item.id);
            if (previous && (previous.kingdomId !== kingdomId || previous.revision + 1 !== item.revision)) throw new Error('The item revision changed.');
            if (!previous && item.revision !== 0) throw new Error('A new item starts at revision zero.');
            draft.items.set(item.id, structuredClone(item));
          },
          async append(event) {
            check();
            if (draft.items.get(event.itemId)?.kingdomId !== kingdomId) throw new Error('History belongs to this kingdom.');
            const events = draft.events.get(event.itemId) ?? [];
            events.push(structuredClone(event)); draft.events.set(event.itemId, events);
          },
          async receipt(owner, origin, key) { check(); return structuredClone(draft.receipts.get(receiptKey(kingdomId, owner, origin, key)) ?? null); },
          async saveReceipt(receipt) {
            check();
            const key = receiptKey(kingdomId, receipt.ownerId, receipt.origin, receipt.key);
            if (draft.receipts.has(key)) throw new Error('This grant was already recorded.');
            draft.receipts.set(key, structuredClone(receipt));
          },
          async nextNumber(defId) {
            check(); const key = JSON.stringify([kingdomId, defId]);
            const next = (draft.numbers.get(key) ?? 0) + 1; draft.numbers.set(key, next); return next;
          },
          async sharedNumber(key, defId, fingerprint) {
            check(); const sharedKey = JSON.stringify([kingdomId, key]);
            const previous = draft.shared.get(sharedKey);
            if (previous) {
              if (previous.defId !== defId || previous.fingerprint !== fingerprint) throw new Error('This shared grant key was used for a different moment.');
              return previous.number;
            }
            const number = await tx.nextNumber(defId);
            draft.shared.set(sharedKey, { defId, fingerprint, number }); return number;
          },
          afterCommit(callback) { check(); callbacks.push(callback); },
          // The test store keeps no slot index; the service's own checks and the Postgres suite cover the constraint.
          async deferSlots() { check(); },
          async shelf(ownerId, origin) { check(); const row = draft.shelves.get(shelfKey(kingdomId, ownerId, origin)); return row ? plainShelf(row) : null; },
          async saveShelf(row) {
            check();
            const key = shelfKey(kingdomId, row.ownerId, row.origin), previous = draft.shelves.get(key);
            if ((previous?.revision ?? 0) + 1 !== row.revision) throw new Error('The shelf revision changed.');
            draft.shelves.set(key, structuredClone({ ...row, kingdomId }));
          },
        };
        try {
          const value = await work(tx);
          state = draft;
          return value;
        } finally { active = false; }
      });
      tail = job.catch(() => {});
      const value = await job;
      for (const callback of callbacks) { try { callback(); } catch { /* A notification cannot undo a commit. */ } }
      return value;
    },
    async get(id: ItemId) { const item = state.items.get(id); return item ? structuredClone(redactItem(item, hidden)) : null; },
    async list(ownerId, kingdomId) { return rawList(state, ownerId, kingdomId).map(item => structuredClone(redactItem(item, hidden))); },
    async atPlace(ownerId, kingdomId, origin, place) { return rawAtPlace(state, ownerId, kingdomId, origin, place).map(item => structuredClone(redactItem(item, hidden))); },
    async history(id) { return structuredClone(state.events.get(id) ?? []); },
    async listPage(owner, kingdom, origin, after) {
      return [...state.items.values()].filter(item => item.ownerId === owner && item.kingdomId === kingdom && item.origin === origin
        && item.place !== 'spent' && (!after || item.id > after)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .slice(0, ITEM_PAGE_ROWS + 1).map(item => structuredClone(redactItem(item, hidden)));
    },
    async historyPage(id, after) {
      return (state.events.get(id) ?? []).map((event, i) => ({ cursor: String(i + 1), value: event }))
        .filter(row => !after || BigInt(row.cursor) > BigInt(after)).slice(0, ITEM_PAGE_ROWS + 1).map(row => structuredClone(row));
    },
    async forgetName(personId) { hidden.add(personId); },
    async shelf(ownerId, kingdomId, origin) { const row = state.shelves.get(shelfKey(kingdomId, ownerId, origin)); return row ? plainShelf(row) : null; },
    async shownShelves(kingdomId, origin) {
      return [...state.shelves.values()].filter(row => row.kingdomId === kingdomId && row.origin === origin && row.shown)
        .sort((a, b) => a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0).slice(0, 512)
        .map(row => ({ ...plainShelf(row), name: hidden.has(row.ownerId) ? null : row.name }));
    },
  };
  return store;
}
