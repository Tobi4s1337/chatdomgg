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

/** Walker requests over the 'items' room channel (section 5a). Grants never come from a browser. */
export const ItemRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('items.list'), id: z.string().min(1).max(64) }),
  z.strictObject({ type: z.literal('items.move'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(), to: z.enum(ITEM_PLACES), slot: z.number().int().min(0).max(63).nullable() }),
  z.strictObject({ type: z.literal('items.release'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(), count: z.number().int().min(1).max(999) }),
  z.strictObject({ type: z.literal('items.history'), id: z.string().min(1).max(64), itemId: z.string().min(1).max(64) }),
]);
export type ItemRequest = z.infer<typeof ItemRequestSchema>;
export type ItemReply =
  | { readonly type: 'items.list'; readonly id: string; readonly items: readonly ItemRecord[] }
  | { readonly type: 'items.changed'; readonly items: readonly ItemRecord[] }            // pushed after any change
  | { readonly type: 'items.history'; readonly id: string; readonly itemId: ItemId; readonly events: readonly ItemEvent[] }
  | { readonly type: 'items.refused'; readonly id: string; readonly message: string };   // plain words for the person
