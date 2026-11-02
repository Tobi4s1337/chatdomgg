import { z } from 'zod';
import type { KingdomId, PersonId } from './identity';

/** World-Tree §4: where a thing lives decides its branch. */
export const ITEM_BRANCHES = ['worn', 'held', 'placed', 'kept', 'gathered', 'used-up'] as const;
export type ItemBranch = (typeof ITEM_BRANCHES)[number];

/** Where one copy lives now. 'away' is put away (never destroyed); 'spent' is a used-up thing whose record stays. */
export const ITEM_PLACES = ['worn', 'hand', 'hotbar', 'lot', 'shelf', 'bag', 'away', 'spent'] as const;
export type ItemPlace = (typeof ITEM_PLACES)[number];

/** Every writer is listed now, so no lane has to edit this file later. */
export const ITEM_SOURCE_KINDS = ['fishing', 'pier', 'game', 'campfire', 'forge', 'wardrobe', 'moment', 'gift',
  'presence', 'tenure', 'raid'] as const;
export type ItemSourceKind = (typeof ITEM_SOURCE_KINDS)[number];

/** ids: 'fish:copper-perch', 'tool:rod.willow', 'keepsake:mount.moonlit-pike', 'game:pong.ribbon', 'forge:<pieceId>'. */
export const ItemDefIdSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]{0,63}$/);
export type ItemDefId = z.infer<typeof ItemDefIdSchema>;
export type ItemId = string;                         // opaque, server-made

export interface ItemDefinition {
  readonly id: ItemDefId;
  readonly branch: ItemBranch;
  readonly title: string;                            // 'Copper Perch', sentence or title case, never an id
  readonly lore: string;                             // one line, authored, never free text
  /** null: every copy is its own storied record. A number: copies stack up to it. */
  readonly stack: number | null;
  /** Keepsakes are numbered per kingdom and definition ("No. 3"): only moments are scarce. */
  readonly keepsake: boolean;
  /** How the client draws it: a registered voxel model id the client catalogue resolves. */
  readonly model: string;
  /** Places this kind of thing may live in. */
  readonly places: readonly ItemPlace[];
}

export interface ItemSource {
  readonly kind: ItemSourceKind;
  /** The writer's own reference: catch id, match id, piece id, moment id. Part of the idempotency key. */
  readonly ref: string;
}

export interface ItemStory {
  /** Who caught, made or won it. null for a thing the kingdom itself gives. Name is the approved public name. */
  readonly by: { readonly personId: PersonId; readonly name: string } | null;
  readonly kingdomId: KingdomId;
  readonly where: string;                            // 'Willowmere pier', 'the tavern', 'the Forge square'
  readonly at: number;                               // epoch ms, server time
  readonly line: string;                             // the card's sentence: 'Caught at dusk in the mist'
  readonly forPersonId?: PersonId;                   // gifts
}

export interface ItemRecord {
  readonly version: 1;
  readonly id: ItemId;
  readonly defId: ItemDefId;
  readonly branch: ItemBranch;
  readonly ownerId: PersonId;
  /** The kingdom it belongs to (World-Tree rule 9). Worn things travel; the rest stay here. */
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly place: ItemPlace;
  /** Position in the hotbar or on the shelf; null elsewhere. */
  readonly slot: number | null;
  readonly count: number;                            // 1 for storied things
  readonly storied: boolean;                         // a storied thing is never destroyed
  readonly number: number | null;                    // keepsake number, or null
  readonly story: ItemStory;
  readonly source: ItemSource;
  /** Small typed facts for the card: { weightG: 2140, lengthMm: 610, hour: 'dusk', mood: 'mist' }. */
  readonly detail: Readonly<Record<string, string | number>>;
  readonly createdAt: number;
  readonly revision: number;
}

export type ItemEventKind = 'granted' | 'stacked' | 'moved' | 'released' | 'put-away' | 'spent' | 'given';
export interface ItemEvent {
  readonly itemId: ItemId; readonly kind: ItemEventKind; readonly at: number;
  readonly from?: ItemPlace; readonly to?: ItemPlace; readonly count?: number;
  readonly actor: 'owner' | 'kingdom' | { readonly personId: PersonId };
  /** The fact that changed a stack; its original catch remains traceable after merging. */
  readonly source?: ItemSource;
}
export interface ItemListPage { readonly items: readonly ItemRecord[]; readonly next: string | null }
export interface ItemHistoryPage { readonly events: readonly ItemEvent[]; readonly next: string | null }
export const ItemListCursorSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
export const ItemHistoryCursorSchema = z.string().refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);

/** Walker requests over the 'items' room channel (section 5a). Grants never come from a browser. */
export const ItemRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('items.list'), id: z.string().min(1).max(64), after: ItemListCursorSchema.optional() }),
  z.strictObject({ type: z.literal('items.move'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(), to: z.enum(ITEM_PLACES), slot: z.number().int().min(0).max(63).nullable() }),
  z.strictObject({ type: z.literal('items.release'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(), count: z.number().int().min(1).max(999) }),
  z.strictObject({ type: z.literal('items.history'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64), after: ItemHistoryCursorSchema.optional() }),
]);
export type ItemRequest = z.infer<typeof ItemRequestSchema>;
export type ItemReply =
  | { readonly type: 'items.list'; readonly id: string; readonly items: readonly ItemRecord[]; readonly next?: string | null }
  | { readonly type: 'items.changed'; readonly id?: string; readonly items: readonly ItemRecord[] } // id on a direct reply
  | { readonly type: 'items.history'; readonly id: string; readonly itemId: ItemId; readonly events: readonly ItemEvent[]; readonly next?: string | null }
  | { readonly type: 'items.invalidated' } // coalesced overflow; refresh the bag using bounded pages
  | { readonly type: 'items.refused'; readonly id: string; readonly message: string };   // plain words for the person

/*
 * The keepsake shelf at home and the belt's order (PI12). A separate 'shelf' room channel, so the closed item request
 * union stays as it is. The shelf and the belt are the two slotted places; arranging into a taken slot swaps the two
 * things, so nothing is ever lost or pushed out. Visitors see a shelf only while its owner shows it, from the owner's
 * door, and only as `ShelfPiece`s: approved names, never a person id.
 */
export const SHELF_CHANNEL = 'shelf';
/** Slots 0..63 on the shelf, as on the belt. The shelf is drawn in bays of `SHELF_BAY_SLOTS`. */
export const SHELF_SLOTS = 64;
export const SHELF_BAY_SLOTS = 12;
const shelfRequestId = z.string().min(1).max(64);
export const ShelfRequestSchema = z.discriminatedUnion('type', [
  /** Your own shelf's settings and your door. Your things themselves come over the 'items' channel. */
  z.strictObject({ type: z.literal('shelf.read'), id: shelfRequestId }),
  /** Put one of your things into a shelf or belt slot. A taken slot swaps the two things. */
  z.strictObject({ type: z.literal('shelf.arrange'), id: shelfRequestId, itemId: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(), to: z.enum(['shelf', 'hotbar']), slot: z.number().int().min(0).max(SHELF_SLOTS - 1) }),
  /** Show your shelf to visitors at your door, or keep it to yourself. Revision-checked. */
  z.strictObject({ type: z.literal('shelf.show'), id: shelfRequestId, shown: z.boolean(), revision: z.number().int().nonnegative() }),
  /** The doors in this kingdom whose shelves you may look at, your own included. */
  z.strictObject({ type: z.literal('shelf.doors'), id: shelfRequestId }),
  /** Look at the shelf behind one door, as a visitor sees it. */
  z.strictObject({ type: z.literal('shelf.visit'), id: shelfRequestId, plotId: z.string().min(1).max(128) }),
]);
export type ShelfRequest = z.infer<typeof ShelfRequestSchema>;
export interface ShelfSettings {
  /** Visitors may look at the shelf from your door. Off until you choose. */
  readonly shown: boolean;
  readonly revision: number;
}
/** A door with a shelf behind it: yours, or one its owner shows. `at` is the step in front of the door, in metres. */
export interface ShelfDoor {
  readonly plotId: string;
  readonly at: readonly [number, number, number];
  /** The owner's approved public name; null for your own door or a hidden name ("a neighbour"). */
  readonly name: string | null;
  readonly mine: boolean;
  readonly shown: boolean;
}
/** A keepsake as a visitor sees it: what it is and its story, never whose id it is. */
export interface ShelfPiece {
  readonly id: ItemId;
  readonly defId: ItemDefId;
  readonly slot: number;
  readonly number: number | null;
  readonly story: { readonly name: string | null; readonly where: string; readonly at: number; readonly line: string };
  readonly detail: Readonly<Record<string, string | number>>;
}
export type ShelfReply =
  | { readonly type: 'shelf.state'; readonly id?: string; readonly settings: ShelfSettings; readonly door: ShelfDoor | null }
  | { readonly type: 'shelf.arranged'; readonly id: string; readonly items: readonly ItemRecord[] }
  | { readonly type: 'shelf.doors'; readonly id: string; readonly doors: readonly ShelfDoor[] }
  | { readonly type: 'shelf.view'; readonly id: string; readonly plotId: string; readonly name: string | null; readonly pieces: readonly ShelfPiece[] }
  | { readonly type: 'shelf.refused'; readonly id: string; readonly message: string };
