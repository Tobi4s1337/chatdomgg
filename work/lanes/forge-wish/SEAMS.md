# forge-wish seams

What this lane offers other lanes and what it needs from them. A seam is frozen once both lanes' `SEAMS.md` say
the same thing. To change a frozen seam, write the change in both files and add a `needs:` line to progress.
Shapes below are this lane's proposal until the other lane confirms them; names may change, the meaning should not.

## FW11 recovery core checkpoint (2026-11-02)

`apps/codex/src/wish-queue` now exports the private `FileForgeWishQueue` core. It preserves canonical source
bindings, attempt IDs, arrival order, spent-call debits and immutable stage snapshots under one filesystem owner.
Its `get` and `list` projections contain private identities and outcomes; neither is a public queue API.

This module is not mounted by realm boot or the Herald handoff. No new route, configuration or shared contract
has been activated. The lane owns the remaining adapter in the Forge-only evening path: durable admission before
202, stable reservation/run recovery, persisted actual provider responses and budgets, uncertain-commit recovery,
durable moderation revocation, owner-only outcome delivery and ordered single rituals. See [RECOVERY.md](RECOVERY.md).
Calling the current coordinator on a saved command unchanged would reset its budget and release interrupted
attempts terminally. Keep that integration closed until the complete recovery path is verified together.

The queue core's process-kill evidence is [fw11-queue-process.json](../../evidence/forge-wish/fw11-queue-process.json).
It proves private file recovery only; it does not establish served Forge/realm recovery, coal, outbox behavior,
warm-worker latency or the anvil queue view. Named broadcaster and private maker-position views still need their
own authorized projections through the existing play host from section 1.

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

## 8. Separate chat grant and the walk panel (FW10 checkpoint)

The exported `openForge`/`ForgeHost` API in section 1 now exists. `AnvilVisit` accepts optional `forgeHost` and
opens that same panel. No actual play host exists on this checkout, so its default remains channel-chat guidance.
`needs: play` must supply its empty HUD root and real pointer callbacks, route Escape before its menu, and pass
the host through its anvil place options to `AnvilVisit`. This lane does not install no-op callbacks or change
the walk controller. The isolated `forge-wish-panel-bench` proves layout/HTTP behavior, not the walk integration.

New `packages/shared/src/forge-chat.ts` freezes the five exact routes under `/api/realm/forge/chat/`:
`status`, `authorize`, `callback`, `wish`, `revoke`. The public gateway permits only these literal doors; the web
proxy sends this prefix to `CHATDOM_REALM_TARGET`. Existing sign-in remains `openid` only. The separate grant
adds `user:write:chat`, preserving the same person's already-authorized client scopes.

`apps/realm/src/forge-chat` owns encrypted grants, private send receipts and migration `0014-forge-chat.sql`.
Its own checksum ledger avoids changing the core migration registry. `wiring/forge-chat-runtime.ts` composes it
through small typed registrations in realm main: setup, mount, startup validation, observer and shutdown.
The Forge-only evening path emits `working` after witnessed ingress/live checks and a finite owner-only outcome
after authority work. An observer failure cannot change that work. Exact owner/message recovery reads committed
attachments; released or sent requests never become invented deliveries.

`needs: configuration` — register `https://chatdom.gg/api/realm/forge/chat/callback` on the Twitch app. An isolated
loopback preview on this checkpoint's port instead needs `http://localhost:5172/api/realm/forge/chat/callback`,
with `REALM_PUBLIC_ORIGIN=http://localhost:5172`. Preview hosts require their own exact URI. Configure the existing
client credentials, `FORGE_CHAT_ENABLED=1`, `FORGE_CHAT_REDIRECT_URI` and an external mode-0600
`FORGE_CHAT_TOKEN_KEY_FILE` containing a base64 32-byte key. No configuration or registration was changed here.

**Isolated database available (2026-11-02).** The existing connection can be loaded privately from the integration
checkout's ignored environment file. The lane created only its authorized `realm_forge_wish` schema and installed
the additive realm/Forge migrations there. Real SQL race tests now pass; the production realm schema and its rows
were not read or changed. The opt-in harness checks the exact search path before migrations and the current schema
afterwards, and cleans up only its unique fixture rows. A private served realm/API session setup and actual Forge
service wish proof remain to be built in this namespace, with data under `/tmp/chatdom-forge-wish/`.

`needs: intake` — the exact coordinated 240→493 patch for the existing Herald/run contracts and Herald guards
is written in [fw10-panel-contract.md](fw10-panel-contract.md#exact-integration-needs). Current intake rejects
longer text before posting; it never truncates a wish. The frozen overlong fixture remains unsupported.

## 9. Preserve the kit that made a piece (FW10)

`forgeStyleKit(family, revision?)` now registers revisions **1** and **2**. The default remains **1**. Revision
one reproduces the committed geometry, including version-two plans. Revision two gives version-two lanterns
a framed glass chamber and moves their glow anchor into it; the sleeping fox gains a clearer muzzle, ears and curled tail. Other shapes retain their geometry. Unknown
revisions fail closed. Review fixtures select revision two explicitly; they are not a product rollout.

`findForgeSockets(home, profile, kitRevision = 1)` also resolves the saved revision. Revision two surveys the
complete authored lantern envelope, including every registered motif and family, so a neighboring gable cannot
intersect the raised ornament. Revision one's socket positions and geometry remain unchanged. Future vocabulary
changes must preserve the envelope membership and socket outputs of every already-persisted revision.

The owned browser Forge scene uses each attachment's saved kit and socket revision. Local restore/refit does
the same. New authority work captures one trusted kit across result rendering, approval binding and final
assembly. A result receipt must not approve another kit revision; legacy digest-only receipts may authorize
revision one only. Commit fit checks still require the current kit, so a preview cannot opt into publishing
revision two while the default is one.

`needs: main` — before changing `CURRENT_FORGE_STYLE_KIT_REVISION` to 2, update both core-owned reconstruction
paths and demonstrate native growth of a home carrying mixed revision-one and revision-two attachments. This
lane does not edit those files.

In `apps/realm/src/founded/scene.ts`, replace the shared current socket list with per-part resolution. Compute
`fingerprint` from `Object.keys(home.attachments).length`, independently of a current socket list. Inside the
loop, before selecting the socket:

```ts
const kit = forgeStyleKit(part.family, part.kitRevision);
if (kit.id !== part.kitId) fail(`part ${id} names an unregistered kit`);
const sockets = findForgeSockets(blueprint, profile, kit.revision);
```

Keep the existing socket origin, host fingerprint, profile and fit guards. Remove the later current-kit lookup.

In `apps/realm/src/growth/native.ts`, remove the shared current `kit` and `sockets`. Keep the attachment's
owner/family/slot/kingdom/profile checks, removing only their comparison against the shared current kit. After
those checks, resolve each part's persisted kit and survey:

```ts
const kit = forgeStyleKit(home.family, part.attachment.kitRevision);
if (part.attachment.kitId !== kit.id) return { kind: 'held', reason: 'unsafe-part' };
const sockets = findForgeSockets(target.blueprint, 'street-home', kit.revision);
```

Unknown revisions remain an unsafe-part hold through the existing catch. Retain the fitted-slot uniqueness
and canonical fit guards. Then change only the exported current revision in `packages/forge/src/plan.ts`.
Do not relabel old attachments, overwrite their plans, or let a revision-one approval authorize revision two.
Old and new pieces must reconstruct their own geometry and sockets through snapshots, arrival, reload,
displacement/refit and growth.

## 10. Durable wish execution boundary (FW11)

The new private `createQueuedKingdomForgeApplication` consumes a `FileForgeWishQueue` claim and an authority
with the existing `status` extension. It preserves attempt identity and completed stage expenditure, binds
current authority/home/kit input before model recovery, and saves the exact full commit command before SQL.
The ordinary application accepts optional trusted execution hooks; no browser or model supplies them.

Shutdown suspends a claim; the separate withdrawal signal records a witnessed terminal decision and reconciles
commit status before release. Confirmed committed recovery still asks the authority to verify the exact
original repository command. The adapter suppresses its own committed callback and never calls `queue.finish`.
The existing realm outbox remains the only durable committed-piece publication.

No lifecycle, production Herald, public route or shared contract is activated by this checkpoint. Before
admission is wired, the Forge-owned bridge must persist authenticated arrivals, replay moderation revocations,
durably deliver one owner outcome, and coordinate an ordered presentation cursor before terminal cleanup.
Public queue counts/own position and the authenticated broadcaster's named view still need their projections.
The run module's independent read gates, five/seven-call limits and failed FW10 visual calibration remain intact.

## 11. Durable worker and witnessed cleanup (FW11, private checkpoint)

`wish-worker/ForgeWishWorker` now wraps the queue-backed coordinator with bounded model work and separate
bounded owner projections. Carry its lifetime lease, withdrawal and `canReserve`/`canCommit` predicates into
`createQueuedKingdomForgeApplication`. The actual authority still owns each reservation, piece, coal and
outbox row. Terminal completion atomically erases queued words/checkpoints and stores one finite private
reply. Neither the observer nor `kingdom.toOwner` is an owner's acknowledgement. No production setup line,
Herald route, shared/browser contract or UI was changed here.

The remaining Herald handoff requires these exact additive changes, owned with raid-show:

- In `packages/shared/src/realm/herald.ts`, add optional stable `sourceId` and original `observedAt` fields to
  the Forge cancel and clear variants; new senders must supply both. Keep all old exports and required fields.
  The stable source ID is the normalized deletion/clear event's ID; the timestamp is its original `at`, never
  the time of an HTTP retry. Message deletion may persist its permanent exact-message predicate without a
  timestamp, but person/room cutoff cleanup cannot infer one from arrival time.
- In `apps/herald/src/ingest/ingest.ts`, pass that existing normalized ID/`at` through `#delete`, `#userClear`
  and `#roomClear`. Presence remove, offline and source-lost already carry stable source IDs and observation
  times; preserve those identities. Do not infer a moderation decision from a service lease becoming false.
- In `apps/herald/src/realm-delivery/delivery.ts`, put wishes and their cleanup into a durable retryable private
  handoff, replacing the current transient post-only path. Remove queued wish words after a confirmed durable
  realm acknowledgement; never make them a permanent public delivery ledger. A timeout retries the same exact
  source command. The realm's 202 must follow its synced enqueue/withdrawal, not the start of an async run.
  Storage/capacity failure returns a retryable failure. Original source order must survive retries, including
  deletion before wish arrival; the realm's predicates are idempotent and never evicted.
- The in-process Forge sink currently receives only `{ signal, current() }`, which combines shutdown,
  freshness and moderation. Keep that as suspension and use explicit witnessed cleanup for withdrawal. A
  false lease alone has no durable reason or cutoff and cannot safely cancel a resumed wish.

Until that reliable producer and the owned realm adapter are integrated together, the current production
Herald path remains unchanged and its ACK must not be described as durable wish acceptance. This is an exact
handoff requirement, not a claim that those other-lane patches have landed.

The realm adapter must persist a source/session-bound witness of actual committed chat ingress before the
first provider call. The ordinary bridge's ninety-second intake freshness check cannot simply be rerun on
old queued words after restart. Resume validates that original witness plus current authority rights/night/
home; it never invents presence from queue admission. Proven committed status recovery precedes new-work
eligibility so an offline restart can still recover the exact already-created piece.

Owner integration still needs an authenticated read/replay plus exact `{ key, attemptId, replyId }` ACK. Read
pages include acknowledged outcomes so pagination never consumes a reply. Existing Forge-chat projection is
only a transport-specific status record; ordinary chat-origin wishes have no corresponding wish-box row. The
web realm intent adapter also ignores unsolicited receipt IDs. An actual Forge-owned owner inbox/consumer is
therefore required before claiming the maker heard a terminal result. Public queue count/position projections
must omit words and private reasons; names require the authenticated broadcaster.

Commit order is now gated at the real first-write lease. It is not a viewer's played cursor. The existing
outbox remains the sole committed publisher; the Forge scene's FIFO and snapshot restore must be tested with
actual delivery/reconnect before ritual acceptance. Queued held/refused/withdrawn outcomes also need a stable
`ended` activity projection: the durable coordinator deliberately avoids the old terminal release branch that
emits it. Runtime startup/reconnect must reconcile lingering activity IDs rather than replay old ceremonies.
Callback resources must settle separately on shutdown, and lifetime receipt/withdrawal indexing is still open.
