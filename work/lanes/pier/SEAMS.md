# pier: our side of each seam

Frozen on Sun 1 Nov 2026 for this round. A seam changes only when both lanes write the change into their SEAMS.md.
When another lane or the integrator must act, pier writes `needs: <who> <what>` in its progress with the exact patch,
and keeps going on its fallback. Every ask below has a fallback; pier uses it until the seam lands and never ships
both. Section 1 is what pier provides; sections 2 to 4 are what pier asks for; section 5 is the small realm hooks pier
writes itself; section 6 lists the other lanes that touch this one.

## PI10 physical pier checkpoint — 2 November 2026

The fallback site is now implemented in `apps/realm/src/fishing/site.ts`. It reads only the adopted plan's
lake, actual drawn water and founded ground. It checks the dry approach, roads, civic reservations, full head
and casting water, then refuses if any existing piece obstructs that fixed site. Obstructions never move it.
`FishingPierSite` is an additive shared type; `root` is the dry-end centre at physical ground height and
`deckY` is the separate timber datum. `walk` is in metres; content factory coordinates are build cells.
Grand-world's anchor has not landed in this checkout; there is one fallback, never a second competing anchor.

The founded assembler now imports `pierFurnishings` and adds the section 5c placement call. The new content
reuses the places-water deck modules and merges furnishings into their collision blueprints. The source kit
is unchanged. Its scenery gateway is lifted one metre locally, extending its posts so a walking body clears
the board over a half-metre terrain step. IDs start with `pier:lake:`. No prior placement is edited.

The only web entry hook is `lanePaths['/-/pier']` in `apps/web/src/main.tsx`. This is an isolated review
surface, with a hash-verified read-only copy of founded geometry. Its warm glass panes and light-field
contribution run there. **The production kingdom layer is not mounted yet.** There is no completed
`mountPierLayer(host)` to request at this checkpoint; section 3's eventual mount ask still applies once
the fishing layer exists. Static timber renders through the ordinary founded placements already.

No room channel, fishing intent, public feed, clock mapping, bag or tool registration is added yet. This
checkpoint does not change any existing API in sections 1–6. No other lane's SEAMS file is present here;
there is no additional cross-lane contract change to write into another scope.

## 1. The items API (pier provides; gather, forge-wish, play, raid-show and panel-window call it)

Owner: pier. Every thing a person owns has one record: what it is, where it came from (who, where, when) and where it
lives now. Other lanes write into it through the realm service below, never through SQL, and never edit pier's files:
they register their own item definitions with one import line in pier's `providers.ts` files.

### 1a. The contract: `packages/shared/src/items.ts` (new, additive, exported from `packages/shared/src/index.ts`)

```ts
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
  readonly source?: ItemSource;                       // the catch or other fact added to a stack
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
```

The exact field names may be refined while PI10 is built, as long as the shape stays this: definitions, records with
story, source, place and revision, an append-only history, and requests that never grant. Any refinement is written
here before another lane builds on it.

### 1b. The realm service: `apps/realm/src/items/index.ts`

```ts
export interface GrantInput {
  /** `${source.kind}:${source.ref}:${ownerId}` unless the writer has a better one. The same key never makes a second copy. */
  readonly key: string;
  readonly ownerId: PersonId;
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly defId: ItemDefId;
  readonly count?: number;                           // stacks only; default 1
  readonly place?: ItemPlace;                        // default: the definition's first place ('bag' for gathered)
  readonly storied?: true;                           // a personal first stays its own protected record
  readonly story: ItemStory;
  readonly source: ItemSource;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export interface RealmItems {
  /** Idempotent. Stackable definitions merge into the owner's stack in that kingdom; storied ones make one record. */
  grant(input: GrantInput, tx?: ItemTransaction): Promise<ItemRecord>;
  /** G06: the same dated keepsake to everyone who took part, one record each, in one transaction, idempotent per person. */
  grantShared(input: Omit<GrantInput, 'ownerId' | 'key' | 'story'> & {
    readonly key: string;
    readonly people: readonly { readonly personId: PersonId; readonly name: string }[];
    readonly story: Omit<ItemStory, 'by'>;
  }): Promise<readonly ItemRecord[]>;
  /** Owner-only, revision-checked. Refuses a place the definition does not allow. */
  move(ownerId: PersonId, itemId: ItemId, to: { place: ItemPlace; slot: number | null }, revision: number): Promise<ItemResult>;
  /** Owner-only. Only spare stacks of gathered things; a storied thing is refused. */
  release(ownerId: PersonId, itemId: ItemId, count: number, revision: number): Promise<ItemResult>;
  list(ownerId: PersonId, kingdomId: KingdomId, filter?: { readonly place?: ItemPlace }): Promise<readonly ItemRecord[]>;
  get(itemId: ItemId): Promise<ItemRecord | null>;
  history(itemId: ItemId): Promise<readonly ItemEvent[]>;
  /** Pushes 'items.changed' to the owner's seat after commit. */
  onChange(listener: (ownerId: PersonId, kingdomId: KingdomId, items: readonly ItemRecord[]) => void): () => void;
  /** For panel-window's forget: hides the person's name from public pages; their records stay theirs. */
  forgetName(personId: PersonId): Promise<void>;
}
export type ItemResult = { readonly ok: true; readonly item: ItemRecord } | { readonly ok: false; readonly message: string };
export interface ItemTransaction { /* the store's kingdom-scoped unit of work; see the transaction recipe below */ }

export function createRealmItems(options: { store: ItemStore; catalogue: ItemCatalogue; clock: () => number }): RealmItems;
export function registerItemDefinitions(definitions: readonly ItemDefinition[]): () => void;   // server catalogue
```

How another lane writes into it:
- Define your items in your own content folder (gather: `packages/content/src/tavern/**`; forge-wish: its Forge content)
  as `ItemDefinition[]`.
- Server: add exactly one import line to `apps/realm/src/items/providers.ts` that registers them. That file holds import
  lines only, like play's `providers.ts`.
- Client: add exactly one import line to `apps/web/src/bag/providers.ts` that registers the same definitions with their
  voxel models (`registerItemModels(models)`), so the bag, the hotbar, the shelf and the cards can draw them.
- Call `items.grant(...)` (or `grantShared`) from your realm module when the thing is really earned, with a stable key.
  Pass your transaction when the grant must commit with your own rows.
- The composed `RealmItems` instance is created once in `apps/realm/src/main.ts`; pier exports a getter for it
  (`realmItems()`), and other realm modules take it as a constructor option from the composition, never a second instance.

Rules the service enforces (tested by pier):
- Only server modules grant. The 'items' room channel only lists, moves, releases and reads history.
- Every change appends an `ItemEvent` in the same transaction.
- A storied record is never deleted: the database refuses the delete. It can only be put away.
- Only spare stacks of gathered things can be released (a fish let go back into the water).
- Keepsake numbers are unique and gapless per kingdom and definition, under concurrency.
- Nothing for sale buys an advantage: no grant path takes payment, and no definition's use depends on money, subs or rank.

### 1d. Item foundation checkpoint (PI10, 1 November)

The service and both stores exist. The durable process composes exactly one instance through
`composeRealmItems(pool)` in `apps/realm/src/main.ts`; `realmItems()` returns that instance. The composition also
returns its `store` for a fishing/catch transaction. `providers.ts` is intentionally empty until actual definitions
with real models register; no made-up inventory is granted at startup. No browser channel is mounted yet.

Decisions frozen by the implementation:
- Grant keys are scoped by kingdom, owner and origin. The same key returns the current record, even after release;
  it cannot resurrect a spent stack. Reusing a key with changed facts is refused. Approved display names are
  presentation and excluded from the fingerprint; the maker's identity remains part of it.
- Storied definitions have `stack: null`; keepsakes are always storied and in the `kept` branch. All definitions
  permit `away`. A common personal first uses `storied: true`, count one, independently of ordinary stacks.
- Each ordinary grant must fit one definition-sized stack. It fills an existing bag stack with room, or starts
  another; it never silently drops overflow. The first story and source are immutable. Gathered stack details hold
  `firstCaughtAt`, `lastCaughtAt`, `firstCaughtWhere`, `lastCaughtWhere`, and best `weightG`; every added source is
  also in ordered history. Only ordinary gathered stacks in the bag or put away may be released.
- A wholly released stack remains at `spent`, count zero; ordinary lists omit it. Records, grant receipts and
  events cannot be deleted through SQL. Existing stories cannot be rewritten, nor can storied status be removed.
- `hotbar` and `shelf` require an integer slot 0–63. Other places require null. Occupied slots and hands refuse the
  move, preserving both things; no automatic swap is shipped at this checkpoint. A grant into a slotted place
  selects its first free slot. Owner writes are revision-checked inside the transaction.
- `grantShared` is for keepsakes: one dated moment gets one number for every person in its fixed participant set.
  Duplicate participants are collapsed; participant order does not matter. All recipients, receipts and the
  allocation commit together. Distinct moments get consecutive numbers, including after rollback.
- Name withdrawal is an enduring redaction on service reads, grant replies and notifications, including future
  grants. Raw provenance remains internal to a transaction. Public routes must still omit person ids; they do not
  exist yet. `onChange` is at least once: a retry also notifies so a lost commit acknowledgement cannot lose a push.

Atomic writer recipe (no nested transaction, no separately committed catch):

```ts
import { postgresItemClient } from './items/postgres';
// items and store are the process's composed instances, passed to the feature constructor.
await store.transaction(kingdomId, async tx => {
  const sql = postgresItemClient(tx);   // scoped query-only capability, invalid after this callback
  // Insert the authoritative catch with sql.query(...) here, using the feature's stable catch id.
  return items.grant(grantForThatCatch, tx);
});
```

`ItemTransaction` is the store capability, not a naked `pg.PoolClient`. It binds the kingdom and the store and
expires after the callback. Its SQL capability exposes only `query`, with no client release method; the store
owns transaction lifecycle and the caller must not issue transaction-control SQL.
All item mutations serialize on a kingdom advisory lock. Nothing notifies before a confirmed commit. An
`ItemCommitUncertainError` means to retry the same grant key; never mint a replacement key. A rollback failure
destroys the pooled connection. The memory store is explicitly for tests, never a durability fallback.

Migration `0017_realm_pier.sql` is already applied to the lane's isolated `pier` schema. Do not edit it: use `0017b`
for catch/Almanac tables and any further changes. Focused checks are recorded in `work/evidence/pier/README.md`.

### 1c. Client pieces other lanes may mount (`apps/web/src/bag/`)

```ts
export function mountItemCard(host: HTMLElement, item: ItemRecord): () => void;      // the story card, in the carved kit
export function itemPortrait(defId: ItemDefId, size: number): Promise<ImageBitmap>;  // the real voxel item, lit like the world
```

## 2. What pier asks of play (play provides; pier mounts)

Owner: play (`apps/web/src/play/slots.ts`). pier never edits play's files. pier registers from
`apps/web/src/bag/play-slot.ts` and `apps/web/src/fishing/play-slot.ts`, with one import line in
`apps/web/src/play/providers.ts`.

Used as play already froze them:
- `registerLedgerPage({ id: 'bag', title: 'Bag', order: 25, ... })` and `registerLedgerPage({ id: 'almanac', title: 'Almanac', order: 35, ... })`.
- `registerHudPiece` for the hotbar, and `ctx.requestCursor('bag')` while the bag or the Almanac is open.

Asked of play (additive to `slots.ts`), each with pier's fallback:

```ts
// 1. A bottom-centre HUD region for the hotbar.
type HudRegion = 'top-left' | 'top-centre' | 'top-right' | 'bottom-left' | 'bottom-centre' | 'bottom-right';

// 2. Key bindings other lanes register, listed and rebindable in play's controls page.
export interface ActionBinding {
  readonly id: string;                 // 'bag', 'hotbar.1' .. 'hotbar.9'
  readonly label: string;              // 'Open your bag'
  readonly defaultCode: string;        // KeyboardEvent.code: 'KeyB', 'Digit1'
  onPress(ctx: PlayContext): void;
}
export function registerActionBinding(binding: ActionBinding): () => void;

// 3. Held tools: play routes the primary button (and a touch button) to the equipped tool, and draws it in the hand.
export interface HeldToolProvider {
  readonly id: string;                 // 'rod'
  equip(ctx: ToolContext): HeldToolHandle;
}
export interface HeldToolHandle {
  /** Primary button or touch, down and up, with the room clock's time; play does not use them for anything else. */
  press(at: number): void; release(at: number): void;
  /** Secondary button: put the tool down or reel in. */
  cancel(): void;
  update(dt: number): void;
  dispose(): void;
}
export interface ToolContext extends PlayContext {
  /** The same retained walking room as movement (as in walk-interactions): typed message channel, never a second socket. */
  readonly room: { onMessage<T>(type: string, cb: (message: T) => void): () => void; send(type: string, payload: unknown): void };
  /** The walker's own pose, read each frame. */
  pose(): { readonly position: readonly [number, number, number]; readonly yaw: number; readonly lookUp: number; readonly grounded: boolean } | null;
  /** World matrix of the walker's right-hand grip, third or first person; null while not drawn. */
  hand(): THREE.Matrix4 | null;
  /** A short pose the body holds while the tool is used. */
  holdPose(pose: 'cast' | 'hold' | 'reel' | null): void;
  /** The three.js scene, camera and per-frame hour the tool draws in (from grand-world's mount, passed through). */
  readonly scene: THREE.Scene; readonly camera: THREE.Camera;
}
export function registerHeldTool(provider: HeldToolProvider): () => void;
export function equipTool(id: string | null): void;           // called by pier's hotbar

// 4. Prompts at places that are not realm interaction targets: "Take a rod", "Read the Almanac", "Your shelf".
export interface WorldPromptProvider {
  readonly id: string;
  /** Called a few times a second with the walker's pose; return the nearest prompt or null. */
  prompt(pose: { position: readonly [number, number, number]; yaw: number }): { readonly label: string; readonly at: readonly [number, number, number] } | null;
  use(ctx: PlayContext): void;          // on play's 'use' action
}
export function registerWorldPrompt(provider: WorldPromptProvider): () => void;

// 5. Other walkers' hands, so their rods and lines can be drawn.
export function observedWalkerHand(walkerId: string): THREE.Matrix4 | null;
export function observedWalkerPose(walkerId: string, pose: 'cast' | 'hold' | 'reel' | null): void;
```

pier's fallbacks until each lands:
1. The hotbar mounts in `bottom-left` (play's existing region) and moves to `bottom-centre` when it exists.
2. The bag opens from the ledger page only, and the rod is the only tool, selected by taking it.
3. pier's fishing input listens for the primary button only while the rod is equipped and the cursor is locked, on the
   kingdom canvas, and takes the room from the walk debug handle the page already exposes; the rod is drawn at an
   offset from the walker's pose instead of the hand. This fallback is never merged as the final state:
   `needs: play held tools`.
4. "Take a rod" uses a small in-world sign on the rack that pier draws, triggered by the 'use' action through the same
   fallback listener.
5. Other walkers' rods are drawn from their published pose with a fixed hand offset.

What pier guarantees play: pier never moves the camera, never takes pointer lock itself, releases every cursor lease it
takes, consumes the primary button only while its tool is equipped, and draws nothing in the stream view's HUD.

## 3. What pier asks of grand-world (grand-world provides; pier mounts)

Owner: grand-world (`apps/web/src/kingdom/scene.ts`, the land, the water surface, the stream director,
`packages/world/src/land-interface.ts`). pier never edits those files.

```ts
// 1. Pier anchors on the water, on the old land and on the grand land (additive to KingdomLandInterface).
export interface PierAnchor {
  readonly id: string;                                  // stable: 'pier:lake', 'pier:harbour'
  /** Where the deck meets dry, walkable ground, in world metres. */
  readonly root: readonly [number, number, number];
  readonly turn: 0 | 1 | 2 | 3;                         // local +Z points out over the water
  /** The water surface height, and the bed depth at 1 m steps along the deck's centreline from the root. */
  readonly waterY: number;
  readonly depth: readonly number[];
  readonly water: 'lake' | 'river' | 'sea';
  readonly biome: string;                               // the Genesis biome id at this water
}
// KingdomLandInterface.piers?: readonly PierAnchor[]   (at least one per founded kingdom, inside the walkable region,
// matching the drawn water on both lands; a pure function of the founded plan, so it never moves)

// 2. A typed mount for a lane's world layer, in the kingdom page and the stream view alike.
export interface KingdomLayerMount {
  readonly scene: THREE.Scene; readonly camera: THREE.Camera;
  readonly mode: 'walking' | 'watching' | 'stream';
  readonly kingdomId: KingdomId; readonly founded: RealmFoundedScene;
  hour(): number;                                       // the scene's current hour
  waterHeight(x: number, z: number): number | null;     // the drawn water surface
  onTick(listener: (dt: number, now: number) => void): () => void;
  readonly quality: 'high' | 'balanced' | 'low';
  readonly signal: AbortSignal;                         // dispose
}
// export function registerKingdomLayer(id: string, mount: (host: KingdomLayerMount) => () => void): () => void;

// 3. Director attention for a moment at the pier on stream.
// requestAttention({ id, at: Vec3, radius: number, seconds: number, priority: 'first' | 'rare' }): void

// 4. The kingdom clock (decision 15): kingdomHour(serverTime: number): number, from grand-world when it exists.
// 5. The water mood for the sky: pier exports kingdomWaterMood(kingdomId, serverTime); grand-world may adopt it.
```

pier's fallbacks until each lands:
1. pier derives its site itself, read-only, in `apps/realm/src/fishing/site.ts` from the founded plan's lake
   (`plan.landform.lake`) and `foundedGroundAt`, with a deterministic search for a straight shore whose root meets the
   deck height and whose water is deep enough under the head, inside the walkable region and clear of every lot, road,
   civic site and placement. Where nothing fits it places nothing and writes `needs: grand-world pier anchor <kingdom>`.
   On tobi4s_'s grand land it checks the drawn water matches before it trusts the site.
2. The pier layer mounts from the founded scene the page already loads: `apps/web/src/fishing` exports
   `mountPierLayer(host)`, and pier writes `needs: grand-world mount kingdom-layer pier` with the exact one-line call.
   Until grand-world adds it, the pier's voxel pieces still show (they are founded placements) and the layer runs on
   pier's bench and in the lane's own build only; nothing half-mounted ships.
3. No director hook: a first or rare catch's tag is drawn large enough to read in the existing wide shots.
4. No kingdom clock: one documented mapping of realm time in `packages/shared/src/fishing.ts`.
5. The mood shows only at the pier.

What pier tells grand-world:
- The pier is a founded placement (section 5c). It adds placements to every founded kingdom and changes the geometry
  digest once, through the existing revision handshake. It changes no terrain column, plot, door or other placement.
  grand-world's "placements unchanged" tests should allow placements whose id starts with `pier:`.
- Nothing pier draws is solid without a collider: every walkable plank, rail and post is in the founded placement, and
  the layer draws only lines, floats, splashes, fish, glow and mist.

## 4. Stream and public reads (pier provides; front-door carries one allowlist line)

- `GET /api/realm/pier/almanac/:kingdomId`: the kingdom's Almanac as JSON. Public, cacheable for a few seconds,
  approved names only, no person ids.
- `GET /api/realm/pier/watch/:kingdomId`: server-sent events of public pier beats (a float cast by a named light, a
  bite, a catch, a first, a broken line). No person ids; a light is named by its home slot and approved name.
- One proxy entry in `apps/web/vite.config.ts` (`'/api/realm/pier': realmTarget`) and one additive line in
  `apps/api/src/public/routes.ts`'s realm read pattern for `pier/(almanac|watch)/<kingdomId>`. If front-door prefers to
  add the line itself, pier writes `needs: front-door allowlist /api/realm/pier/(almanac|watch)/<id>`.

## 5. Small realm hooks pier writes itself (additive, typed; the integrator is told)

### 5a. The room channel hook (realm core; gather may reuse it)

`RealmIntentSchema` and `RealmTransientMessage` are closed shared unions, so features get their own Colyseus message
types instead.

```ts
// apps/realm/src/room-channels.ts (new)
export interface RealmRoomChannel {
  /** Colyseus message type, unique per room: 'items', 'pier'. */
  readonly type: string;
  /** Messages per second per walker; more are dropped and counted. */
  readonly rate: number;
  attach(room: RealmChannelRoom): () => void;
}
export interface RealmChannelRoom {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  onMessage(listener: (from: RealmChannelSender, raw: unknown) => void): void;
  broadcast(message: unknown): void;                        // everyone in the room, under `type`
  toPerson(personId: PersonId, message: unknown): void;     // that person's seat, under `type`
  world(): CollisionWorld;
}
export interface RealmChannelSender {
  readonly principal: RealmPrincipal; readonly walkerId: string;
  pose(): { readonly position: Vec3; readonly yaw: number; readonly grounded: boolean; readonly collisionRevision: number } | null;
  current(): Promise<boolean>;                              // session and rights still valid
}
// apps/realm/src/ports.ts:  RealmRoomServices gains   readonly channels?: readonly RealmRoomChannel[];
// apps/realm/src/kingdom-room.ts, in onCreate after the 'intent' handler: one loop that registers each channel's
// onMessage with the rate limit and the same auth checks as 'intent', and detaches on dispose.
```

If gather lands an equivalent hook first, pier uses gather's and the integrator keeps one.

### 5b. The chat command hook (realm core, `apps/realm/src/evening/bridge.ts`)

Herald already forwards every ordinary chat message with its text. pier never edits Herald.

```ts
// RealmEveningOptions gains:
readonly chatCommands?: {
  /** Called once the chatter has a lit window. Return true to claim the message: no speech bubble is shown. */
  chat(input: RealmHeraldChat, kingdom: DurableKingdom, slot: number): boolean;
  /** Deletion, author clear and room clear, as the bridge already receives them. */
  cleanup(kingdomId: KingdomId, filter: { readonly messageIds?: readonly string[]; readonly personId?: string }): void;
};
// In waitForChat, where speechHost(...) first resolves: if chatCommands?.chat(input, host.kingdom, host.slot) is true,
// return true without calling this.chat(input). In accept's chatCleanup branch: also call chatCommands?.cleanup(...).
```

`apps/realm/src/evening/**` belongs to main and the integrator; pier writes exactly these lines and nothing else there.
If the integrator would rather apply them, pier writes `needs: integrator chat command hook` with this patch.

### 5c. The pier placement (`apps/realm/src/founded/scene.ts`)

One line after `pieces.push(...arrivalFurnishings(plan, pieces));`:

```ts
pieces.push(...pierFurnishings(plan, pieces));   // from '../fishing/site'; pure, deterministic, ids start with 'pier:'
```

### 5d. Composition (`apps/realm/src/main.ts`) and migration

- One block of additive lines: create the item store and service on the realm pool, the fishing service, pass
  `chatCommands` to `RealmEveningBridge`, pass `channels` to the room services, and mount the pier routes.
- Migration `0017_realm_pier.sql`: items, item events, grant keys, keepsake numbers, catches, Almanac firsts. Storied
  item rows refuse deletion in the database.

## 6. Other lanes

- **gather** writes game and campfire keepsakes through section 1 (`source.kind: 'game' | 'campfire'`) and may reuse the
  room channel hook (5a). It needs nothing else from pier.
- **forge-wish** may record a forged piece as an item (`source.kind: 'forge'`, `place: 'lot'`) when it is attached, and
  its worn twin (`place: 'worn'`), without changing where the Forge keeps the piece. Optional this round.
- **play** may record wardrobe pieces it grants (`source.kind: 'wardrobe'`); its look storage stays the truth for what is
  worn. Optional this round.
- **raid-show** owns Herald; pier needs no Herald change. If Herald ever stops forwarding `!`-prefixed chat, pier writes
  `needs: raid-show forward !fish`. Visitor gifts may later write `source.kind: 'gift'`.
- **panel-window**: when its forget lands, it calls `items.forgetName(personId)`; the Almanac then shows "a fisher" for
  that person. A panel tab for the Almanac is in pier's Backlog.
- **front-door**: one allowlist line (section 4). pier draws its UI with the carved kit read-only.
