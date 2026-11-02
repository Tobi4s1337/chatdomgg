import { ItemRequestSchema, type ItemEvent, type ItemPlace, type ItemRecord, type ItemReply, type ItemRequest } from '@chatdom/shared';
import type { ItemLink } from '../fishing/link';
import { itemDefinition } from './definitions';

/** The realm's page size (apps/realm/src/items/pages.ts). */
const PAGE_ROWS = 32;

export interface StagedItemLinkOptions {
  /** Recorded history for the initial records, oldest first. A record without one gets its grant. */
  readonly history?: Readonly<Record<string, readonly ItemEvent[]>>;
  readonly now?: () => number;
}
export type StagedItemLink = ItemLink & { grant(record: ItemRecord): void };

/**
 * An in-memory `items` channel for the `/-/pier` bench and tests. It answers as the realm does: bounded pages with a
 * cursor, revision-checked moves with the realm's own refusal words, and history appended for every change. It never
 * reaches a kingdom.
 */
export function createStagedItemLink(initial: readonly ItemRecord[] = [], options: StagedItemLinkOptions = {}): StagedItemLink {
  const now = options.now ?? Date.now;
  const records = new Map<string, ItemRecord>();
  const events = new Map<string, ItemEvent[]>();
  const listeners = new Set<(reply: ItemReply) => void>();
  let closed = false;

  for (const record of initial) {
    records.set(record.id, structuredClone(record));
    const recorded = options.history?.[record.id];
    events.set(record.id, recorded ? recorded.map(event => structuredClone(event))
      : [{ itemId: record.id, kind: 'granted', at: record.story.at, to: record.place, count: record.count, actor: 'kingdom', source: record.source }]);
  }

  const deliver = (reply: ItemReply) => {
    queueMicrotask(() => {
      if (closed) return;
      const copy = structuredClone(reply);
      for (const listener of [...listeners]) {
        try { listener(copy); } catch (error) { console.error('A staged bag listener failed.', error); }
      }
    });
  };
  const append = (event: ItemEvent) => {
    const list = events.get(event.itemId) ?? [];
    list.push(event); events.set(event.itemId, list);
  };
  type Outcome = { ok: true; item: ItemRecord } | { ok: false; message: string };
  const refusal = (message: string): Outcome => ({ ok: false, message });

  const move = (request: Extract<ItemRequest, { type: 'items.move' }>): Outcome => {
    const item = records.get(request.itemId);
    if (!item) return refusal('This thing is not yours here.');
    if (item.revision !== request.revision) return refusal('This thing has changed. Open your bag again.');
    if (item.place === 'spent') return refusal('This thing has already been let go.');
    const definition = itemDefinition(item.defId);
    if (!definition) return refusal('This thing is not in the kingdom’s catalogue.');
    if (!definition.places.includes(request.to) || request.to === 'spent') return refusal('This thing cannot live there.');
    const slotted = request.to === 'shelf' || request.to === 'hotbar';
    if (slotted ? !Number.isInteger(request.slot) || request.slot! < 0 || request.slot! > 63 : request.slot !== null) return refusal('Choose a valid place for this thing.');
    if (item.place === request.to && item.slot === request.slot) return { ok: true, item };
    const taken = [...records.values()].some(other => other.id !== item.id && other.origin === item.origin && other.place === request.to
      && (slotted ? other.slot === request.slot : request.to === 'hand'));
    if (taken) return refusal('Another thing is already there. Choose a free place.');
    const moved: ItemRecord = { ...item, place: request.to, slot: request.slot, revision: item.revision + 1 };
    records.set(moved.id, moved);
    append({ itemId: moved.id, kind: request.to === 'away' ? 'put-away' : 'moved', from: item.place, to: request.to, at: now(), actor: 'owner' });
    return { ok: true, item: moved };
  };
  const release = (request: Extract<ItemRequest, { type: 'items.release' }>): Outcome => {
    const item = records.get(request.itemId);
    if (!item) return refusal('This thing is not yours here.');
    if (item.revision !== request.revision) return refusal('This thing has changed. Open your bag again.');
    if (item.place === 'spent') return refusal('This thing has already been let go.');
    if (item.storied || item.branch !== 'gathered' || !['bag', 'away'].includes(item.place)) return refusal('A thing with a story stays yours. You can put it away.');
    if (request.count > item.count) return refusal('Choose how many to let go from this stack.');
    const remaining = item.count - request.count;
    const released: ItemRecord = { ...item, count: remaining, place: remaining === 0 ? 'spent' : item.place, revision: item.revision + 1 };
    records.set(released.id, released);
    append({ itemId: released.id, kind: 'released', from: item.place, to: released.place, count: request.count, at: now(), actor: 'owner' });
    return { ok: true, item: released };
  };

  const answer = (request: ItemRequest) => {
    if (request.type === 'items.list') {
      const rows = [...records.values()].filter(item => item.place !== 'spent' && (!request.after || item.id > request.after))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, PAGE_ROWS + 1);
      const items = rows.slice(0, PAGE_ROWS);
      deliver({ type: 'items.list', id: request.id, items, next: rows.length > items.length ? items[items.length - 1]!.id : null });
      return;
    }
    if (request.type === 'items.history') {
      if (!records.has(request.itemId)) { deliver({ type: 'items.refused', id: request.id, message: 'This thing is not yours here.' }); return; }
      const rows = (events.get(request.itemId) ?? []).map((event, index) => ({ cursor: String(index + 1), event }))
        .filter(row => !request.after || BigInt(row.cursor) > BigInt(request.after)).slice(0, PAGE_ROWS + 1);
      const page = rows.slice(0, PAGE_ROWS);
      deliver({ type: 'items.history', id: request.id, itemId: request.itemId, events: page.map(row => row.event),
        next: rows.length > page.length ? page[page.length - 1]!.cursor : null });
      return;
    }
    const before = records.get(request.itemId);
    const outcome = request.type === 'items.move' ? move(request) : release(request);
    if (!outcome.ok) { deliver({ type: 'items.refused', id: request.id, message: outcome.message }); return; }
    deliver({ type: 'items.changed', id: request.id, items: [outcome.item] });
    // The realm also pushes every committed change to the owner's seats.
    if (outcome.item !== before) deliver({ type: 'items.changed', items: [outcome.item] });
  };

  return {
    send(raw: ItemRequest) {
      if (closed) return;
      const parsed = ItemRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const id = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : 'bag';
        deliver({ type: 'items.refused', id, message: 'Choose a valid bag request.' });
        return;
      }
      answer(parsed.data);
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { closed = true; listeners.clear(); },
    grant(record) {
      if (closed) return;
      const existing = records.get(record.id);
      if (existing && existing.revision >= record.revision) return;
      const item = structuredClone(record);
      records.set(item.id, item);
      if (existing) {
        const added = item.count - existing.count;
        append({ itemId: item.id, kind: 'stacked', at: typeof item.detail.lastCaughtAt === 'number' ? item.detail.lastCaughtAt : now(),
          to: item.place, count: Math.max(1, added), actor: 'kingdom', source: item.source });
      } else {
        append({ itemId: item.id, kind: 'granted', at: item.story.at, to: item.place as ItemPlace, count: item.count, actor: 'kingdom', source: item.source });
      }
      deliver({ type: 'items.changed', items: [item] });
    },
  };
}
