import { ItemRequestSchema, type ItemRecord, type ItemReply, type PersonId } from '@chatdom/shared';
import { Buffer } from 'node:buffer';
import type { RealmChannelSender, RealmRoomChannel } from '../room-channels';
import type { RealmItems } from './index';
import type { ItemChannelAdmission } from './entry';
import { itemPage, ITEM_PAGE_ROWS, ITEM_REPLY_BYTES } from './pages';

/** The browser can only inspect and rearrange its own things. Grants remain a server capability. */
export function createItemRoomChannel(items: RealmItems, admit: ItemChannelAdmission): RealmRoomChannel {
  return { type: 'items', rate: 8, attach(room) {
    let active = true;
    const owned = (from: RealmChannelSender, item: ItemRecord | null): item is ItemRecord => !!item
      && item.ownerId === from.principal.personId && item.kingdomId === room.kingdomId && item.origin === room.origin;
    const answer = async (from: RealmChannelSender, reply: ItemReply) => {
      if (Buffer.byteLength(JSON.stringify(reply), 'utf8') > ITEM_REPLY_BYTES) reply = { type: 'items.refused',
        id: 'id' in reply && reply.id ? reply.id : 'bag', message: 'This record is too large to show here. Your things are still kept by the kingdom.' };
      if (active && await from.current() && active) room.toPerson(from.principal.personId, reply);
    };
    const pending = new Map<PersonId, { records: Map<string, ItemRecord>; invalidated: boolean }>();
    const flush = async (owner: PersonId, batch: { records: Map<string, ItemRecord>; invalidated: boolean }) => {
      try {
        while (active && (batch.records.size || batch.invalidated)) {
          const person = room.person(owner);
          if (!person || !await person.current() || !active) return;
          const records = [...batch.records.values()], invalidated = batch.invalidated;
          batch.records.clear(); batch.invalidated = false;
          const page = invalidated ? null : itemPage(records.map(item => ({ cursor: item.id, value: item })));
          if (person.present()) room.toPerson(owner, !page || page.next
            ? { type: 'items.invalidated' } satisfies ItemReply
            : { type: 'items.changed', items: page.values } satisfies ItemReply);
        }
      } finally { if (pending.get(owner) === batch) pending.delete(owner); }
    };
    const stop = items.onChange((owner, kingdom, changed) => {
      if (!active || kingdom !== room.kingdomId) return;
      const visible = changed.filter(item => item.ownerId === owner && item.kingdomId === kingdom && item.origin === room.origin);
      if (!visible.length || !room.person(owner)) return;
      let batch = pending.get(owner);
      const start = !batch;
      if (!batch) {
        if (pending.size >= 300) return; // A reconnect/list recovers a missed notification; never queue without a ceiling.
        batch = { records: new Map(), invalidated: false }; pending.set(owner, batch);
      }
      if (!batch.invalidated) for (const item of visible) {
        if ((batch.records.get(item.id)?.revision ?? -1) <= item.revision) batch.records.set(item.id, item);
        if (batch.records.size > ITEM_PAGE_ROWS) { batch.records.clear(); batch.invalidated = true; break; }
      }
      if (start) void flush(owner, batch).catch(() => { /* The sender ends an unavailable session; lists recover pushes. */ });
    });
    room.onMessage(async (from, raw) => {
      const parsed = ItemRequestSchema.safeParse(raw);
      const id = parsed.success ? parsed.data.id : requestId(raw);
      const refuse = (message: string) => answer(from, { type: 'items.refused', id, message });
      if (!parsed.success) { await refuse('Choose a valid bag request.'); return; }
      const request = parsed.data, owner = from.principal.personId;
      try {
        if (!active || !await from.current()) return;
        if (request.type === 'items.list') {
          const page = await items.listPage(owner, room.kingdomId, room.origin, request.after);
          await answer(from, { type: 'items.list', id, items: page.items.filter(item => owned(from, item)), next: page.next });
          return;
        }
        if (request.type === 'items.history') {
          if (!owned(from, await items.get(request.itemId))) { await refuse('This thing is not yours here.'); return; }
          const page = await items.historyPage(request.itemId, request.after);
          await answer(from, { type: 'items.history', id, itemId: request.itemId, events: page.events, next: page.next });
          return;
        }
        const access = { kingdomId: room.kingdomId, origin: room.origin, current: (tx: Parameters<ItemChannelAdmission>[1]) =>
          active && from.present() ? admit(from, tx).then(current => current && active && from.present()) : Promise.resolve(false) };
        const result = request.type === 'items.move'
          ? await items.move(owner, request.itemId, { place: request.to, slot: request.slot }, request.revision, access)
          : await items.release(owner, request.itemId, request.count, request.revision, access);
        if (result.ok) await answer(from, { type: 'items.changed', id, items: [result.item] });
        else await refuse(result.message);
      } catch {
        await refuse('The kingdom could not confirm that request. Open your bag again to check your things before trying again.');
      }
    });
    return () => { active = false; pending.clear(); stop(); };
  } };
}
function requestId(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64) return raw.id;
  return 'bag';
}
