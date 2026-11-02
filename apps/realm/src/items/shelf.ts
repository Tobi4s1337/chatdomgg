import { Buffer } from 'node:buffer';
import { SHELF_CHANNEL, ShelfRequestSchema, type KingdomId, type PersonId, type ShelfDoor, type ShelfPiece, type ShelfReply,
  type Vec3 } from '@chatdom/shared';
import type { RealmChannelSender, RealmRoomChannel } from '../room-channels';
import type { ItemChannelAdmission } from './entry';
import type { RealmItems } from './index';
import type { ItemTransaction } from './store';

/** One adopted home of the kingdom: its plot, its owner (null while unowned) and the step in front of its door. */
export interface ShelfHome { readonly plotId: string; readonly ownerId: PersonId | null; readonly at: Vec3 }

export interface ShelfChannelOptions {
  readonly items: RealmItems;
  readonly admit: ItemChannelAdmission;
  /** The kingdom's adopted homes with their doors and owners, from its own deeds and plan; empty when none. */
  homes(kingdomId: KingdomId): readonly ShelfHome[];
}

/** A visitor stands at the door to look at the shelf behind it. */
export const SHELF_DOOR_REACH_M = 4;
const MAX_DOORS = 256, REPLY_BYTES = 48 * 1024, DETAIL_BYTES = 1024;

/**
 * Pure: the homes of a founded plan with the deeds that own them, current layout only. The door step is the home's
 * approach node, as the way home finds it; the plot's centre when the plan has no such node.
 */
export function shelfHomes(plan: { readonly homes: readonly { readonly id: string; readonly approachId: string; readonly position: Vec3 }[];
  readonly nodes: readonly { readonly id: string; readonly position: Vec3 }[] },
owned: Readonly<Record<string, { readonly id: string; readonly ownerId: PersonId; readonly layoutRevision: string }>>, layoutRevision: string): readonly ShelfHome[] {
  const nodes = new Map(plan.nodes.map(node => [node.id, node.position]));
  const owners = new Map<string, PersonId>();
  for (const home of Object.values(owned)) if (home.layoutRevision === layoutRevision) owners.set(home.id, home.ownerId);
  return plan.homes.map(home => Object.freeze({ plotId: home.id, ownerId: owners.get(home.id) ?? null,
    at: Object.freeze([...(nodes.get(home.approachId) ?? home.position)]) as unknown as Vec3 }));
}

const near = (from: RealmChannelSender, at: Vec3) => {
  const pose = from.pose();
  return !!pose && Math.hypot(pose.position[0] - at[0], pose.position[2] - at[2]) <= SHELF_DOOR_REACH_M && Math.abs(pose.position[1] - at[1]) <= 3;
};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
/** A visitor's copy: small typed facts only, so one large record never hides the rest of the shelf. */
const trimmed = (piece: ShelfPiece): ShelfPiece => bytes(piece.detail) <= DETAIL_BYTES ? piece : { ...piece, detail: {} };

/**
 * The 'shelf' room channel (PI12): your shelf's settings and door, arranging your shelf and belt (a taken slot swaps),
 * showing the shelf to visitors, the doors with shelves you may look at, and a visitor's look from a door. Grants never
 * come from here; every write is the owner's, revision-checked and admitted inside the kingdom's item transaction.
 */
export function createShelfRoomChannel(options: ShelfChannelOptions): RealmRoomChannel {
  const { items, admit } = options;
  return { type: SHELF_CHANNEL, rate: 6, attach(room) {
    let active = true;
    const answer = async (from: RealmChannelSender, reply: ShelfReply) => {
      if (bytes(reply) > REPLY_BYTES) reply = { type: 'shelf.refused', id: 'id' in reply && reply.id ? reply.id : 'shelf',
        message: 'This shelf is too full to show here just now. Everything on it is still kept.' };
      if (active && await from.current() && active) room.toPerson(from.principal.personId, reply);
    };
    const doorOf = (owner: PersonId) => options.homes(room.kingdomId).find(home => home.ownerId === owner) ?? null;
    room.onMessage(async (from, raw) => {
      const parsed = ShelfRequestSchema.safeParse(raw);
      const id = parsed.success ? parsed.data.id : requestId(raw);
      const refuse = (message: string) => answer(from, { type: 'shelf.refused', id, message });
      if (!parsed.success) { await refuse('Choose a valid shelf request.'); return; }
      const request = parsed.data, owner = from.principal.personId;
      const access = { kingdomId: room.kingdomId, origin: room.origin, current: (tx: ItemTransaction) =>
        active && from.present() ? admit(from, tx).then(current => current && active && from.present()) : Promise.resolve(false) };
      try {
        if (!active || !await from.current()) return;
        switch (request.type) {
          case 'shelf.read': {
            const settings = await items.shelf(owner, room.kingdomId, room.origin), home = doorOf(owner);
            await answer(from, { type: 'shelf.state', id, settings,
              door: home ? { plotId: home.plotId, at: home.at, name: null, mine: true, shown: settings.shown } : null });
            return;
          }
          case 'shelf.arrange': {
            const result = await items.arrange(owner, request.itemId, { place: request.to, slot: request.slot }, request.revision, access);
            if (result.ok) await answer(from, { type: 'shelf.arranged', id, items: result.items });
            else await refuse(result.message);
            return;
          }
          case 'shelf.show': {
            const result = await items.showShelf(owner, room.kingdomId, room.origin, request.shown, request.revision, from.principal.publicName, access);
            if (!result.ok) { await refuse(result.message); return; }
            const home = doorOf(owner);
            await answer(from, { type: 'shelf.state', id, settings: result.settings,
              door: home ? { plotId: home.plotId, at: home.at, name: null, mine: true, shown: result.settings.shown } : null });
            return;
          }
          case 'shelf.doors': {
            const homes = options.homes(room.kingdomId), shown = await items.shownShelves(room.kingdomId, room.origin);
            const byOwner = new Map(homes.filter(home => home.ownerId).map(home => [home.ownerId!, home]));
            const doors: ShelfDoor[] = [];
            const mine = byOwner.get(owner);
            if (mine) doors.push({ plotId: mine.plotId, at: mine.at, name: null, mine: true,
              shown: shown.some(shelf => shelf.ownerId === owner) });
            for (const shelf of shown) {
              if (shelf.ownerId === owner || doors.length >= MAX_DOORS) continue;
              const home = byOwner.get(shelf.ownerId);
              if (home) doors.push({ plotId: home.plotId, at: home.at, name: shelf.name, mine: false, shown: true });
            }
            await answer(from, { type: 'shelf.doors', id, doors });
            return;
          }
          case 'shelf.visit': {
            const home = options.homes(room.kingdomId).find(candidate => candidate.plotId === request.plotId);
            const closed = 'This shelf is kept by its owner.';
            if (!home?.ownerId) { await refuse(closed); return; }
            const mine = home.ownerId === owner;
            if (!mine && !near(from, home.at)) { await refuse('Stand at the door to look at the shelf inside.'); return; }
            const pieces = await items.visitShelf(home.ownerId, room.kingdomId, room.origin);
            if (!pieces && !mine) { await refuse(closed); return; }
            const name = mine ? from.principal.publicName
              : (await items.shownShelves(room.kingdomId, room.origin)).find(shelf => shelf.ownerId === home.ownerId)?.name ?? null;
            // Your own preview reads your shelf as a visitor would see it, shown or not.
            const view = pieces ?? (await items.atPlace(owner, room.kingdomId, room.origin, 'shelf')).filter(item => item.slot !== null)
              .map((item): ShelfPiece => ({ id: item.id, defId: item.defId, slot: item.slot!, number: item.number,
                story: { name: item.story.by?.name ?? null, where: item.story.where, at: item.story.at, line: item.story.line }, detail: { ...item.detail } }));
            await answer(from, { type: 'shelf.view', id, plotId: home.plotId, name, pieces: view.map(trimmed) });
            return;
          }
        }
      } catch {
        await refuse('The kingdom could not confirm that just now. Look at your shelf again before trying again.');
      }
    });
    return () => { active = false; };
  } };
}

function requestId(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64) return raw.id;
  return 'shelf';
}
