# forge-wish seams

What this lane offers other lanes and what it needs from them. A seam is frozen once both lanes' `SEAMS.md` say
the same thing. To change a frozen seam, write the change in both files and add a `needs:` line to progress.
Shapes below are this lane's proposal until the other lane confirms them; names may change, the meaning should not.

## 1. The HUD slot (play offers, forge-wish fills)

play owns the in-world HUD, the Esc menu, the minimap and pointer lock (mouse capture is always locked while
walking, decision 2). forge-wish provides the Forge panel and an `openForge()` entry, and mounts only inside the
node play hands it.

forge-wish exports from `apps/web/src/forge/play/index.ts`:

```ts
export interface ForgeHost {
  /** An empty node in play's HUD layer. play owns it; the Forge renders only inside it. */
  readonly root: HTMLElement;
  readonly kingdomId: string;
  /** play unlocks the pointer while the wish box is open and locks it again on close. */
  releasePointer(): void;
  restorePointer(): void;
  /** Called once when the panel has closed (Esc, the close button, or after the reveal). */
  onClosed(): void;
}
export interface ForgeHandle { readonly isOpen: () => boolean; close(): void; dispose(): void }
export function openForge(host: ForgeHost, from: 'anvil' | 'hud'): ForgeHandle;

/** The Esc menu page for "The forge remembers" (FW12). Returns its own cleanup. */
export function mountForgeLedgerPage(root: HTMLElement, kingdomId: string): () => void;

/** What play shows in its slot: a label and an optional key hint. */
export const FORGE_HUD_ENTRY: { readonly id: 'forge'; readonly label: string };
```

Rules:
- play routes Escape: while the Forge panel is open, Esc closes it first, then the Esc menu works as usual.
- While the wish box has focus, typed keys never reach the walk controller. forge-wish stops propagation only
  inside `root`; it adds no window-level listeners and never calls the pointer-lock API itself.
- The anvil is also an entry: walking up to it opens the same panel with `from: 'anvil'`. Until play's slot
  lands, the anvil card (`apps/web/src/interactions/places/AnvilVisit.tsx`, this lane's) opens it directly.
- The panel uses the carved kit from `packages/ui` (front-door's), read-only.

## 2. The wardrobe catalogue (forge-wish and play)

play owns the avatar catalogue (`packages/content/src/avatars/**`), the builder, the wardrobe and look storage
(`apps/realm/src/look/**`). forge-wish makes worn pieces (FW13): worn twins of house parts, and hats, capes,
held toys and pins wished for directly. forge-wish never edits play's catalogue; play never edits Forge content.

forge-wish provides:
- a new additive contract `packages/shared/src/forge-wear.ts`:
  ```ts
  ForgedWearable {
    id; ownerId;                      // opaque ids, as elsewhere in the realm
    kind: 'hat' | 'cape' | 'held' | 'pin';
    attachment: AvatarAttachmentId;   // an existing socket: 'hat', 'face', 'back', 'gripLeft', 'gripRight' or a bone
    part: AvatarPartBlueprint;        // the existing shared avatar part contract, within AVATAR_PART_LIMITS
    cape?: AvatarCapeBlueprint;       // only for capes, the existing cloth contract
    twinOf?: string;                  // the house piece it matches, when it is a worn twin
    title; firstForgedAt;
  }
  ```
- the composed parts, in the accepted character style, from `packages/content/src/forge-wear/**`;
- a realm read that lists a person's forged wearables and answers "does this person own this item".

play provides:
- a way for its catalogue to show items from a second source (`forge:<id>`) next to its own pieces, resolved
  through the read above, and the look storage accepting such an id only after the ownership check;
- the fit check it already runs (`validateLook`, part and look budgets) on forged items like any other.

Open until play confirms: where in the wardrobe forged items appear, and whether the realm read lives in a
`apps/realm/src/forge-*` module (this lane) or behind play's look module.

## 3. The scene mount for placed pieces (grand-world owns `scene.ts`)

`apps/web/src/kingdom/scene.ts` and its composition belong to grand-world. Today it creates the Forge through
`createKingdomForge(...)` (`apps/web/src/forge/scene.ts`) and `createRealmForgeScene(...)`
(`apps/web/src/forge/realm-scene/index.ts`). A piece attaches by host id, socket and origin in the home's own
blueprint frame, and the scene hides a superseded attachment through the `hideAttachment` callback.

- forge-wish keeps both factory signatures stable. New options are optional and additive.
- grand-world keeps calling them, and on the grand land passes each home's transform from its settlement, so a
  piece lands on the same socket wherever the home stands.
- The ledger wall (FW12) is built from Forge content in `packages/content/src/forge-square/**`. If the grand land
  places the forge square without that content, forge-wish asks grand-world for a small typed mount (for example
  `mountForgeWall(group, anchor)`) with a `needs:` line, and never edits `scene.ts`.
- Several queued wishes reuse the same ritual mount, one ritual at a time. No new scene mount is needed for that.
- Worn twins render on walkers through play's avatar path, not through the kingdom scene.

## 4. The chat path (raid-show owns `apps/herald`; front-door owns sign-in)

- The Herald already hears `!forge` in chat and sends a `RealmHeraldForgeCommand` to the realm. forge-wish reads
  that path and never edits the Herald.
- The wish box posts the words as the citizen's own `!forge` chat message through Twitch's Send Chat Message
  API with the citizen's own token. That needs the `user:write:chat` scope, asked the first time through a
  separate, Forge-owned authorization, never folded into sign-in (which stays `openid` only).
- Tobias must register the redirect URI for that authorization on the Twitch app. forge-wish writes the exact URI
  as a `needs:` line. Until it is registered, the box explains how to wish in chat, and the proof runs through the
  realm's authenticated test ingress with the same Herald-shaped command.
- Twitch writes in tests go only to tobi4s_'s channel.

## 5. The panel (panel-window owns `apps/panel`)

forge-wish serves a public read route from the realm for "The forge remembers" (FW12), for example
`GET /forge/ledger?kingdom=<id>` returning `{ entries: [{ title, plaque, slot, maker: { name }, at }] }`, newest
first. It never contains a wish's words, refused, held or cold wishes, or private reasons. panel-window may mount
it as a page or tab; forge-wish never edits the panel.

## 6. Main and the integrator (shared contracts and the reducer)

- `packages/shared` is additive. New Forge contracts are new `forge-*.ts` files plus one export line each.
- Widening an existing export (`HousePartPlanSchema`, `ComposedHousePartPlanSchema`, `FORGE_MOTIFS`,
  `ForgeDraftSchema`, `ForgePlacementSchema`) and teaching the realm reducer in `packages/world` new piece kinds,
  the choice at the reveal and kept pieces are `needs:` lines with the patch written out.
- One-line route registrations in `apps/realm/src/main.ts` or `server.ts` and the `CHATDOM_FORGE_TARGET` proxy
  setting in `apps/web/vite.config.ts` are small additive edits this lane makes itself and lists in progress.

## 7. Private landed-piece explanation (FW10, additive)

The round notes allow new optional shared fields. The existing committed arm of `RealmReceipt` now has
`message?: string`. The Forge bridge sends it only through `toOwner`, after an actual durable commit, so the
maker can hear what a closest piece shares with the wish and why it was adapted. It is absent from the public
attachment, ritual, outbox and ledger. Existing consumers remain compatible; play may display this optional
private receipt line in its own receipt surface. No new public outcome or changed export is required.

The web proxy reads `CHATDOM_FORGE_TARGET` (default unchanged). A standalone `src/forge-wish-bench/index.html`
build entry renders authored pieces through the production voxel material for visual review. It has no product
navigation, authority, citizens or successful-wish claim.
