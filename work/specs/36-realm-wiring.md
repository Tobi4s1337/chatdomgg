# Spec 36: Every window and made thing belongs to the same kingdom

Status: frozen · 2026-10-30. Start after main commits this handoff and creates the `lane/realm-wiring` worktree this turn.
Vision: `chatdom/ChatDom.md` §§2–5, 10; `chatdom/Safety.md` §§1–3.2, 5; `chatdom/Twitch.md` §§4, 13, 21; `chatdom/World-Tree.md` §§7, 9; `chatdom/Tech.md` §§4–6, 8–12.

## What and why

A real message in tobi4s_'s chat lights the same citizen's window for everyone visiting or watching the kingdom.
A returning citizen builds their own home, and their approved house becomes the street's house for everyone.
A wish goes through the real Forge and its judges, spends earned coal only when the room commits the made part,
and is still there after a reload or server restart. Failed or held work stays private and the previous home waits.
This lane connects the existing experiences to the kingdom's one authority. It does not create another world
model, an ownership shortcut, or a second way to publish. The benches become clients of these same services.
Scenes remain owned by main and the team integrator; the lane delivers adapters and precise installation recipes.

## Current state

- Spec 33, `work/specs/33-realm.md`, owns the frozen single writer design and executable reference. Main's full
  `pnpm verify` is green; three actual uWS SDK clients passed movement/reload checks and three Playwright browser
  clients passed. This proves the reference room/client boundary, not live Twitch, durable production adapters
  or the real Forge. The lane starts from main's committed handoff in its own worktree.
- `apps/realm/src/ports.ts` now freezes `RealmRoomServices { auth, open(kingdomId) }` and
  `RealmRoomHandle`: kingdom/origin/writer epoch/layout, `world`, `sequence`, `spawn(principal)`,
  `intent(context, intent)`, `bootstrap(principal)`, `bindRoom(effects)`, `lifecycle(event, principal, walkerId, now)`,
  `subscribe(deliver)`, `bindTransient(send, owner)` and `dispose()`. `RealmIntentContext.current()` rereads the
  authoritative walker after asynchronous work; `RealmRoomEffects` owns read/place/walk-permission/world-adoption.
  `apps/realm/src/kingdom-room.ts` owns transport only: `world` broadcasts follow committed subscriptions,
  `transient` broadcasts are separate, and `private` replies route through the authenticated controlling person.
- `packages/shared/src/realm/domain.ts` defines private `RealmDomainCommand` and fenced
  `RealmRepository` execution and lookup. `RealmPrivateState` contains owned homes, rights, coals including
  reservations, credited nights and private original creation words. The pure decide/apply implementation is
  main-owned at `packages/world/src/realm/reducer.ts`; consume `decideRealm`/`applyRealmFact` unchanged.
  Qualification stores closed interval unions in `RealmPrivateState.qualification`; `presence.confirmInterval`
  updates that state and core `coal.creditQualifiedNight` requires an owned home and at least 600,000 ms.
  `loadIngress`/`executeIngress` atomically persist the private `presence-v1` checkpoint, domain command batch,
  outcome and public presence outbox. `RealmBootstrap` initializes approved public views through a sequence.
  `RealmFact` uses the private event envelope `seq`, `occurredAt`, `receivedAt`, `committedAt`,
  `type: 'realm.transaction'`, `actor`, `cause` and command `body`; the private state still uses `sequence`.
  Preserve these distinct names/times and witnessed causality; never promote the envelope/body into public data.
- `packages/shared/src/realm/auth.ts` freezes the same-origin routes and strict session/ticket/signout/error DTOs.
  Browser adapters consume these exact schemas and route constants; realm-server implements the authority.
- `packages/shared/src/realm/forge-authority.ts:82` defines `KingdomForgeAuthority`; `messages.ts:33` defines
  validated browser intents, private receipts and the explicit public allowlist. Its separate transient union
  reuses `CitizenChatCue` with chat/remove/clear delivery and no retention. `RealmAuthenticator` establishes the
  actor. A browser's plot, owner, slot, revision or approval claim never establishes authority.
- `apps/codex/src/kingdom-forge/application.ts:54` already coordinates actual `runForge`, word/result gates,
  assembly/contact-sheet checks, private audit, cancellation and authority reservation/revalidation/commit.
  Its README explains recovery requirements. It has no authorizing fallback. Its public publish callback is
  observation, not another durable publication path. Its failure outcome alone cannot settle an uncertain commit.
- `packages/world/src/build/publication.ts:25` supplies `BuildPublicationReviewer`. `BuildDraft` and existing
  shaping/support/egress policy are reusable. `apps/web/src/build/session.ts` currently saves a labelled local
  simulation; its LIVE mode says that a signed-in plot and draft service are needed.
- `apps/web/src/forge/run-client.ts` calls the development `/forge-data/run` endpoint. A model-approved response
  is not a kingdom publication receipt. `apps/web/src/kingdom/scene.ts:130` still chooses a first presentation
  home as a fallback. Neither behavior is a valid production entry path.
- Herald's `PresenceSource` currently owns its diagnostic presence projection and durable presentation binding
  table. `ChatIngest` verifies EventSub, discards ordinary message bodies, deduplicates and guards queued activity;
  `ForgeCommandHandoff` adds cancellation on delete/clear, coverage loss and broadcast generation changes.
  `startLiveSource` accepts an optional private Forge sink. H05 remains owned by `lane/herald`: do not edit its
  unaccepted source/ingest/auth/observe files. Its founder acceptance amendment permits real provisioning and
  protocol evidence while the first human chat line is pending; preserve that honest distinction.
- `packages/world/src/presence.ts:325` emits private minute eligibility. Ten emissions are not proof of ten
  elapsed minutes, and recovered observations are not proof of time spent during an outage.

## Rules

1. **R1 — One room writes.** All durable build, qualification, rights and Forge mutations enter the owning
   `KingdomRoom` through Spec 33's serialized domain entry and `RealmRepository`. Use its pure decide/apply,
   writer lease/epoch, authoritative transaction time and command-id outcome lookup. Never append independently,
   save a parallel JSON ledger, apply a second reducer, or mutate room state from Codex/Herald/browser callbacks.
   The realm-server lane owns Postgres, migrations, fences and the outbox dispatcher. Ask for its existing ports;
   do not implement a competing repository inside wiring.
2. **R2 — The actor owns the plot.** Resolve the authenticated principal's actual allocation/deed in the founded
   kingdom. Herald's `slot` is a hint only. No first-home fallback, URL-selected owner, client-selected balance,
   demo citizen or automatic rights/coal grant. Check current authentication/revocation, live session where
   required, ownership and rights after awaits and again at the commit boundary. Visitors and newcomers do not
   gain free-word rights from subscriptions, walking, a presentation binding or possession of an API key.
3. **R3 — One founded layout.** Use realm-server's persisted founded manifest and immutable layout/collision
   revision to map plot IDs, slots, transforms and native homes. Never regenerate live allocation from the current
   date, client seed/tier query or Herald defaults. The first production consumer uses realm-server's actual
   immutable founded collision world at its persisted layout revision, never the reference court or a renderer-
   generated flat plane. A layout mismatch fails closed with a recoverable private state.
   An approved home replacement must enter the server's revision/asset/collision publication path before clients
   use it; provide the event to the existing revision owner, never rewrite the movement engine. Concurrent Forge
   and build publication bind actual home revision and full digest so one cannot attach to the other's old home.
4. **R4 — Trusted private presence ingress.** Forward validated `PresenceInput` and its still-current cancellation
   guard from Herald's verified ingest/reconciliation path to the room's private ingress. Authenticate the service
   and constrain its kingdom/capability. Public SSE is not an upstream entitlement source and never writes the
   room. The room applies the existing shared world presence reducer, derives its current public projection and
   emits only the allowlisted realm delivery to its clients. Implement ingress through `executeIngress`: validate
   the service source, digest and observation; compute `RealmIngressTransition` from the private checkpoint and
   authoritative transaction time; commit checkpoint revision, trusted command batch, input outcome and sanitized
   presence outbox together. `loadIngress` restores only the versioned `presence-v1` codec. Snapshot the existing
   shared world presence state with a bounded explicit codec, no ordinary speech; never invent a second reducer
   or update a checkpoint in a post-COMMIT callback. Room clients do not independently subscribe to Herald
   SSE or replace room state with browser simulation. Diagnostic Herald SSE may remain for its own tools. Shared
   chat guests keep their existing exclusion. Partial Chatters results cannot prove departures; unavailable or
   stale coverage cannot claim fresh presence. A recovered roster may relight current windows but mints no past time.
5. **R5 — Moderation wins races.** Preserve delete, author clear, room clear, timeout/hold, revoke, stop and
   broadcast-generation cancellation through every queue and provider await. A deleted pending wish cannot commit;
   moderation/revocation invalidates applicable rights/reservations before a later commit. Room clear withdraws
   waiting chat activity/bubbles, never erases homes or everyone’s light. Author clear preserves the existing finite
   protective hold; do not invent a permanent ban from a tier-1 message-clear event. Cleanup is bounded/idempotent,
   cannot refund a committed item, and cannot release a competing attempt's reservation.
6. **R6 — Earn actual time.** Accumulate at least 600,000 ms of evidenced presence in one actual live stream
   session, with an owned home, before offering `coal.creditQualifiedNight`. Union overlapping chat/panel/walker/
   Chatters evidence for the same person. Use `presenceTick` as eligibility evidence, together with observed
   interval boundaries; ten boundary samples covering nine minutes never qualify. Exclude uncovered/stale/offline
   gaps and recovered history; never advance across restart simply because the wall clock moved. Qualification
   receipts use `presence.confirmInterval { personId, streamSessionId, from, through, evidenceReceipt }` within
   the `executeIngress` command batch. The core unions closed ranges in `RealmPrivateState.qualification` by
   person/session and derives `coveredMs`; delayed disjoint ranges remain countable, while overlapping/repeated
   ranges never count twice. Do not replace the union with one monotone high-water timestamp that loses a gap
   arriving out of order. `coal.creditQualifiedNight` checks this actual domain state and an owned home. Store
   private codec state and these commands atomically via the existing repository; no second currency ledger.
   On restart or coverage loss, close only through the last verified covered boundary and discard the unproved
   remainder of every open interval; start again only at first newly verified live
   evidence, retaining already closed ranges. Replayed observations/ticks, sources or restarts earn at most once
   per person/stream session. The flat
   cap is three held coals **including reserved coals**; reserve/release changes availability, not that total. A full
   scuttle earns no extra coal, no paid input changes it, and cancellation never manufactures one. Missing evidence
   or persistence support is `needs:`, never an approximate award.
7. **R7 — Bind the real Forge.** Instantiate the existing `createKingdomForgeApplication` with the room-owned
   shared `KingdomForgeAuthority`, real server-side providers and a private bounded audit sink. Both independent
   word/result gates and existing structural/render checks remain mandatory; API-key presence is not an approval,
   entitlement or model health check. Missing judges, rights, live coverage, home, coal, capacity or attribution
   approval fails closed privately. Reservation enforces one active work per person, real available anvils,
   durable message/attempt dedupe and expiry. Revalidate the current owned home and rights; commit the exact
   judged digest/revision/socket/candidate, consume one reserved coal, retain displaced pieces/provenance and
   append the public outbox in one transaction. Approved attribution or approved anonymous defaults are required.
8. **R8 — Commit before success.** Only a durably committed allowlisted outbox entry creates a public home/part
   or successful receipt. Original `creation.words`, person/source-message IDs, private owner linkage, held/refused
   drafts and judge/provider bodies never enter public schema, replay, health, generic audit or logs. Keep approved
   creation words privately with their item as Safety §5 requires. Route private outcomes to the authenticated
   maker only. Stage messages carry opaque activity IDs/stages and no candidate. Deduplicate coordinator publish
   notifications against the durable outbox so callbacks cannot replay the ritual. If reserve/commit times out or
   the reply is lost, look up the stable command/attempt key in the repository before reporting an outcome. A known
   committed result stays committed even after cancellation; an unknown result stays privately pending/recovery-
   needed. Never call it cold/refunded/unpublished on the strength of the coordinator's catch path. Reload/reconnect
   restores the committed snapshot without another coal charge or ceremony. Install `RealmBootstrap.current`
   as present approved state through `throughSequence`; it is never a sequence of historical rituals. Subscribe
   and buffer incoming durable deliveries before requesting bootstrap, validate kingdom/epoch/layout/collision
   revision, install the checkpoint, discard buffered entries at or below its sequence, then apply only newer
   ordered/deduplicated entries. A delivery gap under the server's cursor contract or writer-epoch change holds
   effects and requests resync; private domain facts can legitimately make public fact sequences noncontiguous,
   so a skipped private sequence alone is not evidence of a lost public event. Transient speech,
   seats and private replies do not become historical domain facts. Bootstrap contains only public views.
9. **R9 — Real build publication.** Own private service drafts per authenticated person/plot, with validated
   operation/revision/CAS and server-derived policy. Reconstruct the candidate from that draft; ignore browser-
   supplied owner, blueprint, receipt and verdict claims. Implement `BuildPublicationReviewer` in the realm service:
   recheck ownership/trust, bounds, voxel/material budgets, support/egress, names and six-angle rendered result
   checks under Safety's actual judges; uncertain content waits privately. A hold/refusal/failure preserves both
   the private draft and last approved street. Use the room's `home.replaceApproved` path with durable verified
   approval evidence and actual asset receipt. Publish housewarming only for that committed approved version.
   The browser implements the reviewer-facing client adapter; it never judges or directly calls model providers.
10. **R10 — Benches exercise production.** Adapters expose the existing Build tools, Forge ritual and presence
    feed interfaces over the room client's frozen protocol. The build/Forge benches select explicit SIMULATED
    room sessions for deterministic captures; the production path uses authenticated live entry. Shared Forge
    attachment provenance accepts `source: 'live' | 'simulated'`: simulated fixtures/rooms carry `simulated`
    through candidates, committed attachments and captures. A provider fixture never labels its result live.
    Neither path
    patches local street data as if committed, bypasses a real gate in live mode, or silently falls back to local
    approval. Live private receipt failures explain the next safe action in world language. Pending work remains
    pending; a browser unload never turns it into fabricated failure or success.
11. **R11 — Ephemeral chat and privacy.** Preserve the distinction between ordinary chat (discarded by current
    ingest) and private Forge creation input. Bind `RealmTransientMessage` chat/remove/clear and existing
    `CitizenChatCueSchema`: at most ten seconds, bounded safe text/emote parts, slots rather than person IDs,
    expected kingdom/origin/epoch, proximity/crowd policy and bounded delete/author-clear/room-clear tombstones.
    The private trusted Herald adapter may extract bounded witnessed speech only for this ephemeral route;
    discard ordinary bodies immediately after projection. Never append speech to history, snapshots, replay,
    health or audit; never project Forge wish text as ordinary speech. No raw source-message/person IDs go public.
    Do not add an untyped message channel or a transcript. Realm-interactions owns seat/private interaction
    messages: preserve them without interpreting them as domain commits. Twitch remains the only live text;
    no parallel in-world chat.

## Contracts

| Boundary | Contract and owner |
|---|---|
| API entry | `REALM_AUTH_ROUTES`, `RealmSessionReplySchema`, `RealmTicketRequestSchema`, `RealmTicketReplySchema`, `RealmSignoutReplySchema`, `RealmApiErrorSchema` in `packages/shared/src/realm/auth.ts`; same-origin cookies/CSRF and private no-store replies |
| Browser → room | `RealmJoinSchema`, `RealmPrincipal`, `RealmAuthenticator`, `RealmIntentSchema`, private `RealmReceipt` in `packages/shared/src/realm/messages.ts`; main freezes, realm-server authenticates |
| Private domain | `RealmDomainCommand`, `RealmDecisionContext`, `RealmPrivateState`, `RealmRepository`, `RealmIngressCheckpoint`, `RealmIngressTransition`; main's `decideRealm`/`applyRealmFact` in `packages/world/src/realm/reducer.ts`; realm-server fenced `execute`/`loadIngress`/`executeIngress` implementation |
| Forge | Shared `KingdomForgeAuthority`, attempt/reservation/native home/attachment/outcome; existing `createKingdomForgeApplication` and `ForgeProviders`; Herald `ForgeCommandSink`/cancellation lease |
| Build | Existing `BuildDraft`, `BuildPublicationCandidate`, `BuildPublicationReviewer`, `BuildPublicationDecision`; room intent validation and authority; no new public approval endpoint |
| Presence | Private `PresenceInputSchema`; existing world presence reducer, `presenceTick`, projection; public `KingdomPresenceFrame` inside `RealmPublicDelivery` |
| Client observations | `RealmBootstrap` current public state through `throughSequence`; durable `RealmPublicMessage` / `RealmPublicDelivery`, validated by kingdom/epoch/sequence/event ID; separate `RealmTransientMessage` chat/remove/clear and `CitizenChatCueSchema`; asset hashes fetched through realm-server's approved asset route |

Export `createRealmWiring(options)` from `apps/realm/src/wiring/index.ts`. Its programmatic result supplies
`services: RealmRoomServices` for `createKingdomRoom(services)`, a trusted private ingress registry resolving the
same open kingdom handles for Herald/service callers, and bounded shutdown/disposal. Type its injected options
from the accepted realm-server ports and existing provider/reviewer contracts rather than duplicating them.
`services.auth` is the real injected authenticator; `services.open(kingdomId)` acquires/reuses the exclusive server
handle and returns the actual `RealmRoomHandle`. Preserve its exact `world`, `writerEpoch`, `layoutRevision`,
`sequence` and `spawn(principal)`; implement/compose `intent(context, intent)` for build/Forge with the interactions
lane's handler; implement `bootstrap(principal)` as a synchronous approved checkpoint and `subscribe(deliver)`
for committed public outbox delivery. Compose `bindRoom(effects)` and `lifecycle(join/drop/reconnect/leave, ...)`
with the interactions lane and presence source: real drop/leave closes applicable walker presence, reconnect
requires new current authority, and asynchronous decisions call `context.current()` again. Use the injected
`RealmRoomEffects` to read/place walkers, disable walking and atomically adopt committed geometry with safe poses
for every affected walker; do not create an alternate movement/interaction context. `bindTransient(send, owner)`
handles nonretained chat and owner-only results. Dispose listeners, provider leases and pending work on `dispose()`.
Do not rename these ports to speculative `onIntent`, add private commands to the browser protocol, or reacquire
a competing writer per Herald call. The registry is a service capability, never a browser-facing authority URL.

Production browser entry consumes `REALM_AUTH_ROUTES`: session `/api/realm/session`, start
`/api/realm/auth/start`, callback `/api/realm/auth/callback`, ticket `/api/realm/ticket`, and signout
`/api/realm/signout`. Parse the frozen strict DTOs from `packages/shared/src/realm/auth.ts`; the authenticated
session reply supplies expiry/CSRF/`resumeScope`, the ticket request contains version/kingdom/protocol, and the issued reply
contains the validated join and expiry. Cookies/tickets stay private and responses are no-store. Use realm-
server's founded manifest data separately; auth DTOs never establish allocation. Do not infer other routes from
development endpoints or import API service internals. A ticket authorizes entry, not a home, trust, coal or
review verdict. Construct `RealmEntry { kingdomId, resumeScope, ticket() }` for `connectRealm`: the lazy factory
requests a fresh single-use ticket only when reconnect cannot restore the seat. Never persist/reuse join tickets
or key reconnect storage by them. A new API session/account has a different scope; signout disposes the client
and clears its reconnect state. The reference-session route remains explicitly simulated.

Web factories belong at `apps/web/src/realm/adapters/index.ts`; the Herald service factory at
`apps/herald/src/realm-sink/index.ts`. Central entrypoints need only imports, configured ports and lifecycle calls,
not copied business logic. Exact README installation recipes name all returned factory methods and their actual
accepted option types, with snippets that typecheck against these entrypoints.

Use the frozen executable room registration/entry API documented in Spec 33. Do not guess method
names, import an internal private state object into the web bundle, or broaden the shared protocol locally. An
absent domain command, draft receipt, founded manifest, approval verifier or collision
revision handoff is a precise `needs:` for main, while independent adapter tasks proceed.

## Scope

Write only:

- `apps/realm/src/wiring/**`: room authority bindings, build review/draft services, qualification integration,
  private ingress registration, service factory, tests, integration/check/capture scripts and README.
- `apps/web/src/realm/adapters/**`: build/Forge/presence client adapters, tests, bench binding recipes and README.
- **New files only** in `apps/herald/src/realm-sink/**`: private typed service adapter and its tests/README.
- This spec, `work/lanes/realm-wiring/PRD.md`, its `progress.txt`, and lane evidence under
  `work/lanes/realm-wiring/evidence/**` (redacted reports/recipes; generated captures go in ignored `shots/`).

Everything else is read-only: especially `packages/shared/**`, `packages/world/**`, Codex, existing Herald
source/ingest/forge files and its H05 work, `apps/realm` server/room/persistence entry files, walking and
interactions lane directories, web scenes/entrypoints/build/Forge files, manifests, lockfile and screenshot
registry. You are not alone in the codebase. Preserve other work; do not overwrite unaccepted lane code.

Realm-server, realm-walk and realm-interactions run in parallel. Consume their frozen ports rather than editing
their internals. Main/the team integrator alone changes central service composition, package dependencies,
scene/bench entrypoints and capture registration. Deliver exact additive README recipes: target file and anchor,
imports, adapter factory arguments, lifecycle/disposal calls, route/capability registration, selection of the
founded plot, removal of first-plot/SSE/local-publish fallbacks, and verification command. Recipes must be executable
snippets against the accepted source, not prose such as “wire this up.” Include a dependency list for any cross-
workspace import; main owns package export/manifests. Do not claim an adapter unit test proves the recipe was applied.

## Acceptance

Every coherent task runs `pnpm typecheck`, `pnpm lint`, `pnpm test -- apps/realm/src/wiring apps/web/src/realm/adapters apps/herald/src/realm-sink`,
and `pnpm build`. Existing affected regression suites also run: `pnpm test -- apps/herald/src/ingest apps/herald/src/source apps/herald/src/forge apps/codex/src/kingdom-forge apps/web/src/build apps/web/src/forge packages/world/src/build`.
Final candidate passes `pnpm verify` after main/integrator applies the composition recipes. No tests or screenshots
are claimed before they exist and have been run.

The lane supplies and documents runnable scripts in its owned wiring directory, invoked as
`node apps/realm/src/wiring/check.mjs` and `node apps/realm/src/wiring/capture.mjs`. Scripts use the actual accepted
service/client composition (or fail with the named missing integration dependency), scratch durable storage, and
the repository Playwright install. Do not create replacement scene/service entrypoints to make checks look green.

Required evidence:

- One composition test constructs the exported `createRealmWiring` factory, injects its actual `RealmRoomServices`
  into `createKingdomRoom`, joins through the actual SDK/client and exercises bootstrap, an authenticated intent,
  a private Herald ingress, lifecycle and room effects. Use accepted realm-server auth/storage/allocation ports;
  explicit simulated providers/principals may make the test deterministic, but no alternate intent context,
  replacement room class or fabricated handle bypasses the production composition. Keep the shared collision
  world/layout revision identical in the browser adapter and server room.

- Two independently authenticated room clients plus stream observer see the same approved home, part and window
  after fresh delivery, reload, reconnect and actual server restart. Assert bootstrap/delta overlap, post-
  checkpoint updates, an epoch change and a missing sequence: one current attachment, no old ritual replay and
  no lost newer event. Clients use the founded manifest and matching
  collision revision. A second citizen cannot edit/publish/forge on the first citizen's plot; a forged slot hint,
  direct public ingress, forged approval receipt and altered host digest/revision all fail without public mutation.
- Actual repository transaction/fault tests cover publication/Forge races, reply loss after commit, duplicate
  message IDs, expired reservations, wrong attempt cleanup, writer change and cancellation while locked/awaiting
  a provider. Public outbox count, committed attachment, coal total and private outcome agree after recovery.
- Controlled-clock evidence distinguishes 599,999 from 600,000 ms, ten minute-boundary samples spanning nine
  minutes, overlapping sources, late disjoint interval insertion, source gaps, atomic checkpoint rollback/retry,
  restart, recovered data, offline/live-session transitions and a full
  scuttle with a reservation. No manufactured credits. Tests must exercise the real room and repository adapters;
  deterministic provider fixtures are explicitly SIMULATED and prove ordering, not live judge operation.
- Privacy assertions inspect serialized public schema, deliveries, snapshots/replay, captured logs and browser
  network traffic for sentinel original words, private IDs, source IDs, refused candidates and provider bodies.
  Only privately authorized maker receipts may contain their refusal. Bubble assertions
  prove expiry and every cleanup race without retained transcript.
- Run the real authorized tobi4s_ Herald source with the room sink installed. Record redacted UTC timestamps,
  source coverage, room command/sequence outcomes and multi-client window counts. A real human chat message must
  traverse verified EventSub → private sink → actual room → all clients; a real quiet Chatters read uses the same
  room path and preserves anonymity. Use only existing granted scopes and public reads. Never send fake-account
  chat or silently substitute a recorded event. A bounded observation run ends with an honest “no human line
  observed” report if nobody types; store the exact ready-to-run watcher/trigger recipe and continue all other
  acceptance. That report is useful infrastructure evidence, not completed real chat proof. The full experience
  requires the first actual line and a timestamped follow-up evidence record, without leaving an agent waiting
  forever or mislabelling fixtures as real.
- Exercise one genuine gated Forge run against the actual owned/live/qualified room with real providers when
  those conditions exist. Show the exact approved part on both clients, one durable coal charge and restoration
  after restart; a public observer never receives the original wish. Keys alone do not satisfy the conditions.
  If human presence/live eligibility or real-provider operation is unavailable, record that precise unproven item
  separately from the fully passing SIMULATED protocol/fault evidence; do not grant coal, bypass gates or tick it
  as real success. Existing H03's amended provisioning acceptance remains valid for Herald, not proof of this path.
- Capture and inspect with `$look`/`view_image`: `shots/realm-wiring/{presence,build-approved,build-held,forge-committed,forge-pending,reconnected}@1440x900.png`,
  corresponding `@390x844.png`, and `-stream@1920x1080.png` for public presence/build/Forge states. Label all
  simulated material in the UI. Capture the panel at 318×496 only if its existing consumer is exercised through
  the shared adapter; this lane does not own panel changes. Include a redacted report tying each capture to
  origin, source state, room sequence, asset/collision revision and observed client counts. A screenshot of a
  standalone bench is not demonstration of the integrated kingdom.

## Quality bar

The citizen sees their own door, not a random cottage. Windows and approved work mean the same thing on stream
and in every browser. Preserve the carved wood/brass/parchment UI, voxel craft, Forge rhythm, sound and warm
windows in `chatdom/Artstyle-Soul-Feel.md`, `Quality.md` and `Moments.md`; do not replace them with network counters
or developer terminology. Explicit simulated labels are required. Slow or uncertain work feels safely held,
never falsely celebrated. No placeholder reviewer, fake successful receipt, hidden bypass or local-only publish
in a shipped path. Real-GPU timing remains an owner check, not a SwiftShader fps claim.

## References

- `work/references/colyseus-realm.md`: main's room/prediction/public-delivery ownership and reconnect limits;
  consume the existing transport rather than researching/adding a second networking stack.
- `work/references/walking-voxel-worlds.md`: immutable collision revision and world-unit boundary; movement
  implementation belongs to main/realm-walk, not this lane.
- `work/references/herald-presence.md`, Spec 03 and Herald progress: verified ingress, privacy, coverage and
  bounded real-source acceptance. Preserve existing dedupe/moderation behavior and the recorded human trigger gap.
- `apps/codex/src/kingdom-forge/README.md`: real coordinator gates, cancellation, private original words and
  durable authority/recovery responsibilities. This is existing-system integration, not a new model pipeline.

## Not now

No alternative domain/reward ledger, allocation policy, world generation, network transport, movement/controller,
interaction targeting, new Twitch chat writer, production deployment, new games, panel redesign or shared schema
changes. These boundaries reserve parallel ownership; they do not permit omitting the real wiring described above.

## Decisions

- 2026-10-30: Main owns the pure domain decide/apply and shared authority/repository contracts; wiring binds
  existing systems into that one writer. The executable boundary is verified and frozen; start follows main's
  handoff commit and lane worktree creation this turn.
- 2026-10-30: Existing Herald H05 files stay read-only. The lane adds a disjoint private sink and supplies exact
  additive installation recipes; the integrator applies them against accepted Herald work.
- 2026-10-30: Browser/bench and main scene composition are integrator work. Adapter-only tests are not integrated
  acceptance. Real chat/Forge evidence is reported separately from deterministic fixtures and provisioning.
- 2026-10-30: An unknown commit is recovery work, not proof of failure or a refunded coal. Public success follows
  durable commit, and public delivery comes from the allowlisted room outbox.
- 2026-10-30: Final main-owned ports include synchronous public bootstrap, room effects and lifecycle. Ingress
  checkpoint/fact/outbox writes are atomic through `executeIngress`; qualification uses core interval unions and
  an owned home. Wiring consumes those exact contracts and never introduces a replacement context or reducer.
- 2026-10-30: Auth route constants and strict DTOs are frozen in shared realm/auth. Fact persistence uses the
  actual event envelope; state retains `sequence`. Simulated Forge provenance remains simulated end to end.
