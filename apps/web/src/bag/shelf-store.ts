import type { ItemRecord, ShelfDoor, ShelfPiece, ShelfReply, ShelfRequest, ShelfSettings } from '@chatdom/shared';
import { requestId, type ShelfLink } from '../fishing/link';
import type { OwnShelfSource, ShelfResult, VisitShelfSource } from './shelf/types';
import type { BagStore } from './store';

export type ShelfVisit = { readonly ok: true; readonly source: VisitShelfSource; readonly plotId: string } | { readonly ok: false; readonly message: string };

/** Your shelf and belt as the kingdom keeps them, the doors whose shelves you may look at, and a visitor's look. */
export interface ShelfStore extends OwnShelfSource {
  /** The step in front of your own door, once the kingdom has answered; null when you have no home here. */
  door(): ShelfDoor | null;
  /** Your door first, then every door whose owner shows their shelf. */
  doors(): readonly ShelfDoor[];
  /** Read the doors again (after showing or hiding, or as people show theirs). */
  refreshDoors(): void;
  /** Reorder your belt: the tool goes to `slot`, a tool already there takes its old place. */
  arrangeBelt(itemId: string, slot: number): Promise<ShelfResult>;
  /** Look at the shelf behind a door you stand at; your own door shows yours as visitors see it. */
  visit(plotId: string): Promise<ShelfVisit>;
  dispose(): void;
}

export interface ShelfStoreOptions {
  readonly personId: string;
  readonly timeoutMs?: number;
}

const WORDS = {
  unanswered: 'The kingdom has not answered yet. Look at your shelf again in a moment.',
  missing: 'This keepsake is no longer with you.',
  closed: 'The shelf was closed before the kingdom answered.',
  loading: 'Your shelf is still being read. Try again in a moment.',
} as const;

type Pending = { readonly kind: ShelfRequest['type']; readonly resolve: (reply: ShelfReply) => void; readonly timer: ReturnType<typeof setTimeout> };

/**
 * One person's shelf over the realm's `shelf` channel. Records stay in the bag store (the items channel pushes every
 * arranged record to its owner); this keeps the shelf's own facts: shown or not, the door, and the shown doors.
 */
export function createShelfStore(link: ShelfLink, bag: BagStore, options: ShelfStoreOptions): ShelfStore {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const listeners = new Set<() => void>();
  const pending = new Map<string, Pending>();
  let settings: ShelfSettings | null = null, door: ShelfDoor | null = null, doors: readonly ShelfDoor[] = Object.freeze([]);
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('A shelf listener failed.', error); }
    }
  };
  const ask = (request: ShelfRequest): Promise<ShelfReply> => new Promise(resolve => {
    if (disposed) { resolve({ type: 'shelf.refused', id: request.id, message: WORDS.closed }); return; }
    const timer = setTimeout(() => { if (pending.delete(request.id)) resolve({ type: 'shelf.refused', id: request.id, message: WORDS.unanswered }); }, timeoutMs);
    pending.set(request.id, { kind: request.type, resolve, timer });
    link.send(request);
  });
  const result = (reply: ShelfReply): ShelfResult => reply.type === 'shelf.refused' ? { ok: false, message: reply.message } : { ok: true };
  const read = () => { void ask({ type: 'shelf.read', id: requestId('shelf') }); };
  const refreshDoors = () => { void ask({ type: 'shelf.doors', id: requestId('doors') }); };
  const sameDoors = (a: readonly ShelfDoor[], b: readonly ShelfDoor[]) => a.length === b.length
    && a.every((door, index) => JSON.stringify(door) === JSON.stringify(b[index]));

  const unsubscribe = link.subscribe(reply => {
    if (disposed || !reply || typeof reply !== 'object') return;
    let changed = false;
    if (reply.type === 'shelf.state') {
      if (!settings || reply.settings.revision >= settings.revision) { settings = Object.freeze({ ...reply.settings }); changed = true; }
      if (JSON.stringify(door) !== JSON.stringify(reply.door)) { door = reply.door ? Object.freeze({ ...reply.door }) : null; changed = true; }
    } else if (reply.type === 'shelf.doors') {
      const next = Object.freeze(reply.doors.map(entry => Object.freeze({ ...entry })));
      if (!sameDoors(doors, next)) { doors = next; changed = true; }
      const mine = next.find(entry => entry.mine) ?? null;
      if (mine && JSON.stringify(door) !== JSON.stringify(mine)) { door = mine; changed = true; }
    }
    const id = 'id' in reply ? reply.id : undefined;
    const waiting = id === undefined ? undefined : pending.get(id);
    if (waiting && id !== undefined) { pending.delete(id); clearTimeout(waiting.timer); waiting.resolve(reply); }
    if (changed) emit();
  });
  const unbag = bag.subscribe(emit);

  const arrange = async (itemId: string, to: 'shelf' | 'hotbar', slot: number): Promise<ShelfResult> => {
    const item: ItemRecord | undefined = bag.item(itemId);
    if (!item) return { ok: false, message: WORDS.missing };
    const reply = await ask({ type: 'shelf.arrange', id: requestId('arrange'), itemId, revision: item.revision, to, slot });
    // A refusal may mean our copy is behind; the bag reads itself again so the next try carries the kingdom's revision.
    if (reply.type === 'shelf.refused') bag.refresh();
    return result(reply);
  };

  read(); refreshDoors();

  return {
    mode: 'own',
    personId: options.personId,
    items: () => bag.items(),
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    settings: () => settings,
    door: () => door,
    doors: () => doors,
    refreshDoors,
    arrange: (itemId, slot) => arrange(itemId, 'shelf', slot),
    arrangeBelt: (itemId, slot) => arrange(itemId, 'hotbar', slot),
    async takeDown(itemId) {
      const moved = await bag.move(itemId, 'bag', null);
      return moved.ok ? { ok: true } : { ok: false, message: moved.message };
    },
    async show(shown) {
      if (!settings) return { ok: false, message: WORDS.loading };
      const reply = await ask({ type: 'shelf.show', id: requestId('show'), shown, revision: settings.revision });
      if (reply.type === 'shelf.refused') read();
      else refreshDoors();
      return result(reply);
    },
    history: itemId => bag.history(itemId),
    async visit(plotId) {
      const reply = await ask({ type: 'shelf.visit', id: requestId('visit'), plotId });
      if (reply.type === 'shelf.refused') return { ok: false, message: reply.message };
      if (reply.type !== 'shelf.view') return { ok: false, message: WORDS.unanswered };
      const pieces: readonly ShelfPiece[] = Object.freeze([...reply.pieces]);
      return { ok: true, plotId: reply.plotId, source: { mode: 'visit', name: reply.name, pieces } };
    },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); unbag(); listeners.clear();
      for (const [id, waiting] of pending) { clearTimeout(waiting.timer); waiting.resolve({ type: 'shelf.refused', id, message: WORDS.closed }); }
      pending.clear();
    },
  };
}
