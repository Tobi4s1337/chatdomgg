# Spec 37: look at a place and use it

Status: **frozen · 2026-10-30.** Main's transport/reference consumer and shared boundary passed full verification,
three actual uWS SDK clients including movement/reload, and three Playwright browsers. The lane is startable
after main commits this handoff and creates its branch/worktree this turn. Interaction implementation remains
this lane's work; the reference consumer does not claim to implement sitting, host admission or home entry.
Vision: `chatdom/ChatDom.md` principles 4, 8, 12, 15, 17–18 and §5; `chatdom/Tech.md` §§2, 6.3–6.4,
8.2, 10.6, 13, 15; `chatdom/Quality.md` rules 2–6, 9–11; `chatdom/Artstyle-Soul-Feel.md` §§10–11;
`chatdom/Moments.md` §§4–5; parent `work/specs/33-realm.md`.

## What and why

Walk to the fire, look at a log, and a small invitation says to sit. Turn toward the anvil and the invitation
changes with your gaze. A tavern chair opens the real table when its host admits you. At your own door, enter
the furnished room that fits the home on the street; its exit brings you back through that same threshold.
These are actions in a shared place. Another walker sees the same occupied seat, a dropped connection does not
clone the sitter, and nobody buys a better place at the fire. Every action answers promptly while the room
decides it. Leaving a table or panel hands movement and camera back immediately. The whole demonstration is a
walk from fire to anvil to tavern to home and back outside, using the actual existing place and service owners.

## Current state

- `packages/shared/src/realm/messages.ts:29` already defines strict `RealmIntentSchema`: `interact` carries only
  version, request id, stable `targetId` and `action: sit | forge | tavern | enter-home | exit-home | stand`.
  It contains no actor, position, rotation, home owner, seat winner or client claim of reachability.
- `packages/shared/src/realm/messages.ts:49` exports `RealmInteractionTarget` with `id`, `kind`, `position`,
  `approach`, `reach`, optional `plotId`; kinds are campfire-seat, anvil, tavern-seat, home-door and home-exit.
  IDs must satisfy `TokenSchema`, not be display labels or render-object indices.
- `packages/shared/src/realm/{schema,movement}.ts` define `WalkerSchema`, `KingdomRoomState`, `PlayerState`,
  `CollisionWorld`, `WALK_BODY`, the 30 Hz simulation and 200 ms room patches. `realm/interactions.ts` now defines
  `RealmSeat`, `RealmInteractionState`, private `RealmInteractionLease`, trusted `RealmInteractionContext`,
  `RealmInteractionResult` and `RealmInteractions`. `RealmTransientMessage` carries public `seats` with epoch/
  revision; `RealmPrivateMessage` carries self-only `interaction` state with nullable `requestId`.
  `RealmReceipt.status: applied` correlates ephemeral accepted state by request ID and writer epoch;
  `committed` retains a durable fact sequence only for real commits.
- `packages/shared/src/realm/domain.ts` defines verified principals' rights and owned-home records through the
  private realm state. Home `ownerId`, deed/allocation receipt and installed revision establish ownership;
  a visual presence slot, name, home mesh or browser-selected plot does not.
- Main owns the spec 33 reference room/client and shared contracts. Actual
  `apps/realm/src/ports.ts` exports `RealmIntentContext`, `RealmRoomHandle` and `RealmRoomServices`;
  `kingdom-room.ts:createKingdomRoom` decodes intents and supplies authoritative walker position/revision to
  `RealmRoomHandle.intent`. Its `bindTransient` provides public transient and person-addressed private delivery.
  The current reference service truthfully returns unavailable for interactions. Realm-server supplies real
  infrastructure/authentication; walk-camera supplies movement/collision/camera arbitration.
- Specs 21/22 own campfire/tavern host policy, matches, voice, game views and game-seat admission. Spec 25 owns
  the anvil; specs 29/30 own water/high place geometry and anchors; spec 31 owns real home furniture and painted
  interior presentation. These are dependencies, not permission to copy them. The current kingdom scene has
  local Forge/build presentation and no production interaction registry; integrator alone composes it.

## Rules

1. **R1 — One registry, stable targets.** Build an immutable target registry from accepted place/home metadata
   and the actual founded layout revision. Use namespaced authored IDs, for example `fire:<site>:seat:<seat>`
   or `home:<plot>:door`; validate uniqueness and `TokenSchema` bounds. Occupancy, render LOD, loading order,
   seat labels and entering/leaving the camera frustum cannot change an ID. Store server-side approach/exit
   clearance and zone metadata alongside the shared target, never in an untrusted request. Transform authored
   local anchors once with their actual placement origin/cardinal turn; home-interior cells use 0.125 m.
   Invalid or missing metadata disables that target explicitly. Never derive an entire room or a door from a
   mesh AABB, and never register a target for art that has not actually loaded/been installed.
2. **R2 — The prompt follows the look.** Every rendered frame, select the nearest reachable visible target in
   the current look cone; use view alignment to exclude things behind the player/camera, not distance alone.
   Occluding walls/closed thresholds eliminate candidates. Require an approach with supported standing body
   clearance and a legal action in the current zone. Rank eligible candidates by distance, then alignment,
   then stable ID, with a small documented hysteresis that never retains an occluded or illegal target.
   Turning between adjacent log/chair/anvil targets changes the prompt without walking. Occupied/restricted
   targets may show a quiet contextual reason, but never win the actionable E prompt over a legal target.
   Cursor click/tap and gamepad selection resolve through the same registry. No camera position crosses the
   wire as authority; the server independently checks physical reach/occlusion using the authoritative walker.
3. **R3 — E means this one action.** On keyboard, a non-repeating E press uses the highlighted target. The brief
   chooses E for this consumer; coordinate with walk-camera so it is not also orbit-right. Keep a free cursor
   and camera follow by default. Neither walking nor interacting requires held mouse input or pointer lock.
   A mouse/touch context control offers the same action, at least 44 CSS px; keyboard focus remains visible.
   Suppress E while typing, composing text, using an unrelated focused control or when another surface owns it.
   Key repeat cannot send a claim storm. Respond within 100 ms with a small pending cue and existing audio bus
   feedback; actual seating/entry/game success waits for authoritative state. No new AudioContext or mic prompt.
4. **R4 — The room decides.** Validate the exact existing strict interact intent, authenticated live principal,
   kingdom/room membership, current permissions, registered target/action pair, authoritative current zone,
   reach, unobstructed access, support and collision revision. Browser hints never override these. Revalidate
   after any awaited host admission and immediately before mutation, so a timeout/ban/door revision arriving
   during an await wins. Refuse stale, nonexistent, wrong-kind, wrong-home and through-wall targets privately
   with a useful next action. Duplicate request IDs return the same outcome; an old reconnect/session/epoch
   cannot replay an action into a replacement lease. Bounded requests use the realm limiter and room clock.
5. **R5 — Exactly one physical seat.** A log/chair is a room-owned ephemeral lease, keyed by target ID and fenced
   by writer epoch, authenticated session and generation. At most one person occupies a target and at most one
   target seats a person across their tabs/reconnects. Resolve simultaneous legal claims in the room's serialized
   order; the later claimant gets an honest occupied response. Money, subs, rank and gifts confer no priority.
   An admission offer/lottery belongs to its existing match host, not a new interactions queue. A social log
   seat is not a voice or Dusk Court game permission. Where game admission is required, acquire/reserve the
   physical seat and existing host admission together through the host seam; failure releases the reservation.
   Do not publish an occupied chair followed by a falsely successful table open. Stand releases only one's own
   current generation and informs its existing match/voice host; another tab or stale callback cannot unseat a
   replacement occupant. No durable kingdom event, balance or reward is created for these leases.
6. **R6 — Leave, lose the connection, return.** Stand/Escape/explicit Leave is idempotent. A transport drop reserves
   the same seat only for the realm's configured reconnect grace; record absolute expiry on the room clock and
   test it. A verified reload/reconnect resumes that generation and avatar, never a second sitter. The lease
   expires without any connected browser or callback. Explicit room leave/logout, failed reauthentication,
   target removal and writer-epoch change release it; server restart does not invent seat continuity. Warning,
   timeout, ban or revoked action rights invalidate occupancy immediately in the room update and call the
   campfire/tavern revocation seam in that same turn; its supervisor enforces voice removal within the existing
   one-second policy. Disconnect/unknown authority immediately clears actionable UI and local unsafe audio;
   a client never claims server unseat succeeded until confirmed. Clearing a lease cannot delete durable game work.
7. **R7 — Enter your actual home.** `enter-home` is legal only for a signed-in principal whose installed deed owns
   that door's `plotId`; no public slot/name/fixture or monarch bypass. Check the latest shell/furnishing/collision
   revision and a supported, full-body-clear interior threshold connected to the doorway. Own-home entry changes
   authoritative zone/pose via the room; it mounts the existing home-interiors composition and painted treatment,
   not a screenshot, overlay picture, empty shell or different apartment. Preserve the canonical shell/Forge
   fingerprint. Furniture and glass retain their actual collision semantics. Do not grant a pet, keepsake, light
   or presence reward on entry. Other homes have no enter action. An unfit edited shell gives an honest blocked
   threshold reason; no cutting walls, teleporting through furniture or pretending the view is an interior.
8. **R8 — Every entrance has a safe return.** Register the matching inside `home-exit` on that plot and verify an
   exterior approach/standing position using current immutable collision, body dimensions and support. An exit
   uses the real threshold, preserves the correct plot/zone, and cannot land in a wall, the next home or water.
   Protect the threshold/return keep-clear during composition/publication through the owning realm/build seam.
   If geometry changes invalidate it, ask the movement/realm recovery owner for the nearest verified supported
   recovery on that home's route, never scan for arbitrary air or implement a second collision engine. Do not
   acknowledge an unsafe exit. The accepted layout must provide a recovery so the owner can always get out.
9. **R9 — Camera ownership always ends.** Interaction presentation takes a cancellable camera suggestion/action
   token from walk-camera; it does not create a competing rig. Fire and tavern suggest their existing seated/table
   framing; anvil opens the existing Forge; home blends the existing interior treatment. Escape, explicit Leave,
   stand, movement intent where appropriate, tab blur, disconnect, moderation and disposal release every owned
   input/camera/selection token. Escape immediately returns local camera and input even while an unseat request
   is pending; authoritative pose remains honestly pending until room state arrives. Cancel held keys/drag and
   prevent delayed host replies from reacquiring an abandoned camera. Closing Forge/table UI is separate from
   cancelling durable work. After each action the player can move again; no trapped camera or invisible modal.
10. **R10 — Consume places and hosts once.** Fire/anvil/tavern/home targets point at the installed producer output.
    Enter tavern/table through the existing room/host's actual door/zone flow; do not add a new tavern-door action
    to shared. `tavern` addresses a tavern seat and requests its existing table host; `sit` addresses a campfire
    seat; `forge` addresses an anvil; enter/exit address the corresponding home target. `stand` addresses one's
    current leased seat even if looking away. Reuse host command receipts/admission/cancellation; do not clone
    games, match ledgers, seat lotteries, voice, invitation policies, content or interior art. New generic pier,
    parapet or home-furniture seat families need main's next contract group; do not smuggle them into these kinds.

## Contracts

### Existing shared contracts — consume exactly

`@chatdom/shared/realm` exports: `RealmIntentSchema`, `RealmIntent`, `RealmInteractionTarget`,
`RealmPrincipal`, `RealmAuthenticator`, `PlayerState`, `CollisionWorld`, `WALK_BODY`, `KingdomRoomState`,
`RealmSeat`, `RealmInteractionState`, `RealmInteractionLease`, `RealmInteractionContext`,
`RealmInteractionAction`, `RealmInteractionResult`, `RealmInteractions`, `RealmTransientMessage`,
`RealmPrivateMessage`, `RealmReceipt`, plus `RealmOwnedHome` and rights records on the server. Use `applied`
for accepted ephemeral state; `committed` is reserved for durable commits. Public opaque walker keys are render identities; principal/session IDs
and home permissions stay private. Target metadata may be public, owner proof may not.

### Actual interaction authority seam

`packages/shared/src/realm/interactions.ts` supplies:

- `RealmSeat {targetId, walkerId, generation, status: occupied | reconnecting}`. `RealmTransientMessage`'s
  `seats` envelope has `writerEpoch`, `revision`, `seats`; the room scopes distribution by actual district/zone.
  `RealmInteractionLease` adds private `sessionId`, `personId`, `writerEpoch`, `expiresAt` and stays server-only.
- `RealmInteractionState {revision, mode: standing | seated | interior, targetId, plotId}` is self-only through
  `RealmPrivateMessage`'s `interaction` envelope with writer epoch and `requestId: string | null`: accepted
  request delivery carries its ID, unsolicited lifecycle updates carry null. `RealmReceipt`'s `applied` arm
  carries `version`, `id`, `writerEpoch`, `state` without a fact sequence. Reconnect obtains one current self
  snapshot; drop duplicate/outdated state revisions and never let an old reply reacquire an abandoned camera.
- `RealmInteractionContext {personId, sessionId, walkerId, writerEpoch, now, position, collisionRevision,
  ownedPlotId, target, unobstructed, permitted}` is trusted server input, never a browser payload. The room builds
  it after strict intent decode, current auth/rights/home checks and actual collision/target resolution. Its
  target comment explicitly requires a supported and unoccupied approach/exit at `collisionRevision`.
- `RealmInteractions.act(context, action)` is synchronous and returns `RealmInteractionResult`: accepted with
  next self state, optional authoritative position and seats, or refused with unreachable/occupied/forbidden/
  unavailable. `drop(sessionId, now)`, `reconnect(sessionId, now)`, `release(sessionId)` and `expire(now)` own the
  room lease lifecycle. Expose lane-local projection/change hooks for those void lifecycle calls so the host
  can publish resulting seat/self state; do not invent a second public message protocol.

The room wrapper owns request deduplication/correlation and current-generation checks; context is rebuilt after
any awaited existing-host admission, before the synchronous mutation. Approach/exit body clearance, support and
safe recovery use the injected immutable collision/registry metadata at the stated revision. Match admission
reservations may remain lane-private until accepted; no public reserved chair or new status is required.
`interior` changes zone/collision/camera and permits walking inside; only `seated` suppresses locomotion until stand.

`apps/realm/src/ports.ts:RealmRoomHandle.intent(context, intent)` is the actual request/receipt adapter boundary;
`RealmIntentContext` supplies authenticated principal, walker ID, authoritative position and collision revision;
its `current()` rereads current player authority after an async admission before rights recheck and synchronous act.
Its `bindTransient(send, owner)` separates `RealmTransientMessage` fanout from self-only `RealmPrivateMessage`.
The interactions adapter enriches the trusted context from room/ownership/registry inputs, returns the exact
`applied`/refused/unavailable receipt and uses these delivery hooks. Actual `RealmRoomHandle.lifecycle(event,
principal, walkerId, now)` handles join/drop/reconnect/leave notifications. Its `bindRoom(effects)` receives
`RealmRoomEffects.readWalker`, revision-checked `placeWalker`, `allowWalking` and atomic `adoptWorld`; consume
these actual hooks rather than writing a competing pose authority. `RealmRoomHandle.bootstrap(principal)` is
the synchronous approved-world checkpoint. Send current permitted interaction/seat state on join/reconnect
through the private/transient delivery hooks; these ephemeral states are not in `RealmBootstrap.current`.
Integrator/realm-server binds lifecycle events to the lane's lease hooks and schedules `expire(now)` on the
room clock. The integrator binds existing campfire/tavern admission/revoke,
Forge opening, walk-camera action token/release and movement safe recovery. Those can remain typed in-process
hooks; no unified place mega-interface is needed. The verified executable consumer is main's transport/reference,
not an existing interaction implementation.

### Lane-local implementation boundary

Define concrete signatures in owned `README.md`/`ports.ts` at IN01, using the actual main-owned seam:

- `packages/world/src/interactions/index.ts`: pure `legalInteractionActions` and seat transition/release helpers
  for the frozen interaction family only. Explicit immutable snapshots/context/time in, typed decision/next
  ephemeral state out. Pure eligibility and collision queries have no DOM, render, content, DB, clock, transport,
  random source or authority lookup. Share these rules with browser eligibility without granting it authority.
- `apps/realm/src/interactions/index.ts`: callable interaction handlers and bounded lease lifecycle through
  injected room/session/collision/admission ports. Registration, server boot, auth implementation, transport,
  public schema distribution and writer persistence stay with realm-server/main. Expose state/revoke/dispose
  calls that can be bound to the actual room without editing its files from this lane.
- `apps/web/src/interactions/index.tsx`: Solid prompt/selection/session controller, explicit mount/update/dispose,
  and typed adapters to the actual realm client and place hosts. Keep pure candidate scoring separate from DOM;
  call the existing camera controller. One lead owns `ports.ts`, barrels, bench and mount instructions.

## Scope

May write **only** `packages/world/src/interactions/**`, `apps/realm/src/interactions/**`,
`apps/web/src/interactions/**`, this spec and `work/lanes/interactions/{PRD.md,progress.txt}`. Include owned
tests, README, ports and capture script. Ignored evidence: `shots/interactions/**`.
All other files are read-only, especially `packages/shared`, package manifests/barrels, movement/world reducers,
realm room/reference/boot files, `scene.ts`, root routes/config, Forge, campfire/tavern, places and interiors.
You are not alone: preserve other workers' changes. Do not widen ownership to wire the scene yourself.

Integrator alone composes `scene.ts`/shared room roots and writes exact recipes. Supply a README with actual
import/signatures, create order, registry transform/revision derivation, room handler/subscription registration,
host admission/revocation wiring, per-frame update, camera/input priority and teardown order. Coordinate with
walk-camera before E/keyboard/camera code, realm-server before leases, and the named place/match producers before
adapters. Missing producer APIs are `needs:`, never stand-ins imported into production. Sub-agents never run git.

## Acceptance

After each coherent task, from repository root:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/world/src/interactions apps/realm/src/interactions apps/web/src/interactions
pnpm build
```

Start with **one good core scenario** exercising real pure rules and the actual interaction handler: two
authenticated sessions race for one log, one succeeds; duplicate/stale claims do not mutate; a forged target or
position/identity field cannot bypass the strict intent; a wall/out-of-reach/foreign-home request is rejected;
stand/reconnect grace/expiry/moderation and a replacement generation release exactly the intended lease. Inject
clock advancement and current-rights changes around an awaited admission. Assert state/occupancy, not just a
returned string. Add focused assertions to that scenario for regressions discovered in implementation, rather
than dozens of UI tests repeating conditions. Test the actual home entry/exit transforms against collision and
support, including a blocked edited home and recovery at changed revision. No service mock proves live admission.

An early standalone owned Vite bench at `/src/interactions/bench/index.html` can show the real selector/prompt
and handler under visibly **SIMULATED** identities. It is not acceptance of the final place walkthrough. Missing
producer/realm bindings must be named in progress. There is no fake connected indicator, fake successful seat
claim or screenshot-backed room. The final tour uses admitted actual place/host exports and the realm transport.

Provide and run:

```sh
node apps/web/src/interactions/capture.mjs --base-url http://127.0.0.1:5190
```

Use `$look` and `packages/testing/capture-lock.mjs:acquireCaptureLock` before any capture browser/server,
including `--base-url`. Capture serially in Chrome/SwiftShader, wait for meaningful readiness, fail on page/worker/
console errors, release in `finally`, and stop only owned processes. Main preview owns 5190; isolated owned servers
use another free port 5170–5199. Do not remove a shared lock or kill a producer's server. Build one compact scripted
tour with checkpoints, not a broad screenshot matrix:

1. Walk to actual campfire log; rotate toward two real targets and watch E prompt change; sit after accepted room
   state. The second browser sees the same occupancy and cannot take that seat. Stand and move again.
2. Walk to actual anvil; E opens the existing Forge surface, with actual availability. Escape returns camera/input;
   missing coals/offline/unavailable remains truthful and no fake forge/coal receipt is needed for this tour.
3. Walk through the existing tavern threshold; E at a real chair uses existing host admission and table presentation.
   Show its actual accepted state, then Leave/Escape and move again. A missing host is an integration blocker, not
   a mocked accepted game or permission to tick final acceptance.
4. Walk to one's installed own home; E enters its actual furnished painted room. Approach the inside exit and E
   returns to the same street threshold on supported clear collision. Another principal cannot enter that door.
5. Drop/reload one sitter and advance beyond grace; exercise one current moderation revoke and one blocked/revised
   exit recovery. Prove no duplicate occupant and movement after every release/camera action. Persisted game/Forge
   work is not reset by presentation cancellation. Measure local pending response against 100 ms separately from
   network acknowledgement; report GPU/render timing as unmeasured here.

Keep only relevant evidence: first prompt at 1440×900 and 390×844, then a compact final contact sheet of the fire,
anvil, tavern and inside/outside doorway at those two sizes. Reuse unchanged earlier frames; one desktop trace/log
proves races/reconnect/revocation rather than another screenshot matrix. Open every chosen image with `view_image`.
Check prompt readability, touch thumb reach, seated silhouettes/clearance, actual interior continuity and no trapped
camera. Capture reduced-motion behavior within the same tour. Record audible feedback or a listening limitation.
Main/integrator runs `pnpm verify` and the integrated tour after composition; isolated harness success does not
complete IN06. Missing services/art/collision recovery are explicit `needs:`, never fake UI success.

## Quality bar

The invitation belongs beside the thing being used: restrained brass/parchment and the shared carved kit, one
clear verb, no raw IDs or debug/lease vocabulary in product UI. A change of gaze feels immediate and stable. Sitters
fit the authored log/chair, the anvil stays the hero anvil, and the home remains the same home when its light turns
to paint. No pointer-lock requirement, browser-default prompt, floating interaction dashboard, distant magic sit,
camera snap through a wall, clipping seated body or decorative door that cannot be left. Do not fabricate people.

## References

- `work/references/walking-voxel-worlds.md`: shared immutable collision, supported landing/near-plane safety,
  input release and prototype frozen-camera lessons. Reuse the studied techniques through the movement owner.
- `work/references/colyseus-realm.md`: room-owned serialization, reconnect identity, bounded input and district
  projection; no separate client sequence/authority beside the selected Colyseus path.
- Specs 21/22: match admission, physical-to-game seat bindings and immediate permission revocation stay with
  their host; games and voice do not become interaction implementations.
- Specs 25/29/30/31: use authored anvil/place anchors, real approach envelopes and composed furnishing/zone
  transforms. Their benches certify art, not owner entry or authoritative physical occupancy.

## Not now

This lane does not author place/content/art, games, Chalk, voice, seat lotteries, Forge execution, home furnishing,
movement/camera engines, collision recovery, ownership deeds, sign-in, transport/persistence, new shared types,
citizen cards, extra seat families, Twitch writes, production deploys or infrastructure. Those are named producer
responsibilities consumed here. Their absence blocks the corresponding integrated acceptance, not the scope.

## Decisions

- **2026-10-30 — E use is the brief's current control decision.** Tech's older Q/E orbit and F use cannot both
  remain active on E; walk-camera and integrator resolve the bindings once. Free cursor/camera follow remains.
- **2026-10-30 — One physical lease, existing match policy.** Interaction state is room-ephemeral. Match hosts
  own admission/voice/game seats and durable play; interactions never grants those rights by sitting on a mesh.
- **2026-10-30 — Exact ephemeral acknowledgement.** Main added `RealmReceipt.status: applied` with request ID,
  writer epoch and state, plus nullable `requestId` on private interaction delivery. Use these actual contracts;
  no fabricated durable fact sequence. Context guarantees supported/unoccupied approach at its collision revision.
- **2026-10-30 — Walk inside, then walk out.** Only sitting suppresses locomotion. Interior entry switches the
  authoritative zone/collision/camera while preserving walking to the actual exit. Integrator owns shared
  scene/root edits and the actual walkthrough.
- **2026-10-30 — Frozen against verified main transport/reference.** Full verify, three actual uWS SDK clients
  including movement/reload and three Playwright browsers passed. Actual room lifecycle/bindRoom effects are
  the integration seam. Start after main commits the handoff and creates lane/interactions and its worktree;
  these checks establish the shared consumer boundary, not already-built interaction handlers or the final tour.
- **2026-10-30 — IN01: a seated body stays on its approach.** `sit`/`tavern` place the authoritative feet on the
  seat's authored approach (registry- and context-proved supported and clear) and stop walking; the pose on the
  log/chair is presentation from the same anchor (`rest`, `facing`). The room never holds a body overlapping solid
  wood, so stand, drop, revision adoption and recovery all start from a safe standing place. `forge` confirms reach
  only (no lease, no fact). Local signatures are frozen in `apps/web/src/interactions/README.md`.
