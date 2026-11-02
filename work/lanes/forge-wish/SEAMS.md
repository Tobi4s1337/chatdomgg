# forge-wish seams

What this lane offers other lanes and what it needs from them. A seam is frozen once both lanes' `SEAMS.md` say
the same thing. To change a frozen seam, write the change in both files and add a `needs:` line to progress.
Shapes below are this lane's proposal until the other lane confirms them; names may change, the meaning should not.

## FW11 the wish line is live in the realm (2026-11-02)

The durable line is now mounted. `RealmEveningBridge` takes `forgeQueue: { directory }` (realm main uses
`<REALM_FOUNDED_DIRECTORY>/forge-queue`), `await evening.start()` after `boot.readiness.start()`, and Herald's private
route answers 202 only after the wish or its withdrawal is synced. The old in-memory path remains only for callers
that do not configure a line. How it works: `apps/realm/src/forge-queue/README.md`. Additive registrations made:

- `packages/shared/src/forge-queue.ts` (+ one export line): `FORGE_QUEUE_ROUTE`, `ForgeQueueViewSchema`, limits.
- `apps/realm/src/main.ts`: the `forgeQueue` option, `evening.start()`, `mountForgeQueueRoutes(...)`.
- `apps/api/src/public/routes.ts` (front-door's allowlist): one line, `/api/realm/forge/queue` → realm.
- `apps/web/vite.config.ts`: one proxy line for the same route.

**Offered to play / grand-world (the anvil card):** `AnvilVisit` accepts an optional `kingdomId` (falls back to
`forgeHost.kingdomId`) and polls the line only while open. `createAnvilPlace` in `apps/web/src/interactions/places/index.tsx`
does not pass one yet; whoever owns that file adds `kingdomId` there. The live walk opens the Forge panel at the
anvil, which already shows the line.

**Offered to panel-window and raid-show:** the same public route serves the panel (counts) and a streamer's dock
(names, when the broadcaster's session reads it). Nothing else is needed from them.

**Still open with raid-show (section 11):** Herald's own handoff is still post-and-forget. The realm side is now
durable from its 202 onward; a wish lost between Twitch and that 202 is Herald's to retry.

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
- The anvil is also an entry: walking up to it opens the same panel with `from: 'anvil'`. When play hands the
  anvil card (`apps/web/src/interactions/places/AnvilVisit.tsx`, this lane's) a `forgeHost`, its "Make a wish"
  opens the panel in play's node. In the kingdom view's own walk (no play binding),
  `apps/web/src/forge/play/anvil-entry.tsx` opens the wish box as soon as the visit starts in a founded kingdom.
  It never touches pointer lock: the walk released the pointer for the visit, and closing the box ends the visit.
  Without a founded kingdom it shows the chat line.
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

**As one patch (2 November).** The length now has one name, `FORGE_WISH_WORDS_MAX = 493`, in the new contract
file `packages/shared/src/forge-words.ts`. The Forge's own guards (application command, durable queue, recovery,
realm authority) already use it; that changes nothing today because everything upstream still stops at 240.
[patches/wish-length.patch](patches/wish-length.patch) is the rest, for main and raid-show to apply together:
`RealmHeraldForgeCommandSchema` and `ForgeRunRequestSchema` words, `FORGE_CHAT_LIMITS.words`, the realm reducer's
commit check, both Herald guards in `apps/herald/src/forge/commands.ts`, the Herald boundary test (494 refused,
493 read whole) and a new `forge-words.test.ts` showing the wish box, the Herald command and the Forge run share
one bound that fits a Twitch message with `!forge `. Tested on a copy of this branch: 286 tests in 23 files pass,
typecheck clean. The wish box's length message follows `FORGE_CHAT_LIMITS.words`, so it reads 493 once applied.

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

**2 November (policy v7):** revision 2 also re-authors the sleeping fox, the shooting star and the scallop shell.
It passes the blind likeness certification (`CERTIFICATION.md`): every motif reads in its native finish in every
family. Revision 1's fox and star do not read, so until this promotion lands, fox and star wishes are delivered
softened and FW10's frozen twenty cannot meet "every known motif delivered as asked". This promotion is what
unblocks the twenty.

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

**The promotion as one patch (2 November).** [patches/kit2-promotion.patch](patches/kit2-promotion.patch) is the
whole change, ready for `git apply` from the repository root. It touches `apps/realm/src/founded/scene.ts` and
`growth/native.ts` as written above, the current revision in `packages/forge/src/plan.ts`, one assertion in
`founded/scene.test.ts` (relabelling a part to revision 2 is now a registered kit, so the fail-closed case uses an
unregistered 9), and a new `growth/kit-revisions.test.ts`. The new test puts a revision-one dragon chimney and a
revision-two moon lantern on one home and shows that the founded scene rebuilds each with its own kit, native
growth refits both on their own revision without relabelling, and an unknown revision holds growth and fails the
scene closed. The patch was tested on a copy of this branch; the branch itself still ships revision one.

This branch already prepares for it: `findForgeSockets` now defaults to the current kit revision, like
`forgeStyleKit`, so every caller that pairs the two defaults (the simulated founding, benches, tests) stays
consistent when the revision changes; persisted parts pass their own saved revision. The Forge tests that
mean "revision one" now say so, and the authority and application tests are written against the current
revision, so they pass before and after the promotion.

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

## 12. A Forge commit must not reload the walk (FW10, needs play, grand-world and the realm founded owner)

**Found on the real GPU (2026-11-02, walk proof run 6).** A delivered wish adds its piece to the citizen's home in
the founded scene. The piece is a solid placement, so `assembleFoundedScene` gives a new `geometryDigest`, the
founded provider builds a new collision world (`apps/realm/src/founded/provider.ts`, `createFoundedWorld`) and the
room's `collisionRevision` moves. `apps/web/src/kingdom/walk-scene.ts` `frame()` sees the revision differ from its
manifest, disconnects (close code 4000, 0.25 s after the owner's delivered outcome), and the entry rebuilds the whole
scene through `onSceneNeeded`. The walk is back about 10 s later with the walker respawned at their own home door.
The ritual (`apps/web/src/forge/realm-scene`) is lost with the old scene: the citizen who just made the wish sees
neither the strike, the cooling nor the flight to their home, and everyone else watching loses it too.

The collision change itself is right: a chimney is solid, and the realm's adoption already keeps walkers' poses
(`foundedWorldAdoption(...).positions`). Only the client's answer to it is wrong. Proposal:

1. **Realm founded owner.** No change in meaning. Keep bumping `collisionRevision` for any geometry change, Forge
   attachments included. Keep the existing adoption of walker poses (no respawn at the door).
2. **play (`walk-scene.ts`).** A new `collisionRevision` with the same `layoutRevision` and `origin` is a
   *hot adoption*, not a reload:
   - keep the session connected and the walker where they stand;
   - fetch the new manifest and scene in the background, as `onSceneNeeded` does now, and swap the collision world
     (`binding.collision.world(revision)`) and `binding.manifest` in place once they are loaded;
   - until then, keep predicting on the previous world; the realm reconciles poses as it does today;
   - only a different `layoutRevision` or `origin` (a re-founding) disconnects and rebuilds.
3. **grand-world (`scene.ts` and the founded static meshes).** Swap the changed placements' meshes in place
   (one home's attachments), instead of rebuilding the kingdom. The realm scene already asks its host to
   `hideAttachment(id, true)` while a piece is in its ritual and `hideAttachment(id, false)` when it lands; a swapped
   mesh for that attachment must start hidden if the last call for its id was `true`.
4. **forge-wish (this lane).** `apps/web/src/forge/realm-scene` keeps its presentation across a hot adoption (it is
   not disposed when only placements change). Covered by this lane once steps 2 and 3 exist.

Until then the Forge works and lands, but the ritual is not seen in the walk. The private walk proof records the
close code and timing in `trail-<label>.json`, so the fix can be checked with the same `--gpu` run.

## 13. A commit must not block the realm's event loop (FW10, needs the realm founded owner and `packages/voxel`)

**Found on the real GPU (2026-11-02, walk proof with three real wishes).** Two of three walkers were closed with
code 4002 (too many messages) at the moment their piece was committed, about 2 s before their box showed
**Made in the kingdom**. The walk never came back (CONNECTION LOST until the hold ended). The commit adds one
placement, and `createFoundedWorldLoader().stage` rebuilds the whole kingdom synchronously on the realm's event
loop. While it runs, the walker keeps sending its 30 Hz input. Colyseus counts the queued inputs in the one
second they are read, so 2 to 3 s of block exceeds `REALM_MESSAGE_LIMIT` (90) and the walker is kicked.

Measured on the stored scene of that run (354 placements, 108 assets, load 25, warm):

| step (per commit) | ms |
|---|---|
| `compileCollisionWorld`, all placements | 1,390 to 1,950 (8 to 11 s cold, first call) |
| the same with terrain only | 56 to 129 |
| `sampleFoundedTerrain` | 6 to 10 (8 s cold) |
| `validateFoundedScene` | 320 to 470 |
| `canonicalSceneJson`, `encodeFoundedScene` | 105 to 160 each, each run twice in `assembleFoundedScene` |
| `foundedSpawnAnchors` | 70 to 235 |

The Forge's own work in the realm already yields (`renderForgeContactSheetCooperatively`, FW10). The rebuild is
not in this lane's folders. Proposal, either is enough:

1. **Incremental compile** (`packages/voxel/src/collision`): compile per placement into chunk-keyed solids and
   reuse every unchanged placement's solids from the active world. A Forge commit then compiles one attachment
   (a few ms). The revision and digest rules stay as they are.
2. **Off the loop** (`apps/realm/src/founded/provider.ts`): run `assembleFoundedScene` and the compile in a
   `worker_threads` worker and pass the compiled world back as transferable buffers; the room keeps serving walks
   on the current world until adoption.

**It grows with the kingdom (FW11, 2026-11-02).** The fifty-wish proof needs one citizen per wish, so it seeds a
town (48 homes a quarter) instead of the hamlet. In its zero-call rehearsal (controlled model, load about 8), a
piece took a median of about 10 s from its approval to its delivery, all of it the commit and this rebuild,
against about 2 s in the hamlet. Commits are serial, so two wishes in flight wait for each other's rebuild: the
rehearsal's median submit-to-reveal was 31 s with only about 6 s of (simulated) model time. In a town the rebuild,
not the Forge, decides how quick a wish is, and it blocks the room for that long on every commit. The real fifty
in the same town (warm model, two in flight) confirmed it: the Forge's own part had a median of 21.0 s (p95 33.1),
approval to reveal a median of 16.5 s, so submit to reveal was 35.8 s (p95 71.6) against FW11's 25 s / 60 s bar
(`work/evidence/forge-wish/fw11-wishes.md`). Either proposal above brings the commit back to a few seconds.

Until one exists, any commit on a busy host can drop the walkers who are standing in the kingdom, not only the
maker. Section 12 (no reload on a Forge commit) is still needed after this. Without §13, §12's hot adoption would
keep the session but still get it kicked.
