# Interactions (spec 37)

Look at a log and a small carved invitation says what E will do. The room decides; the prompt shows its answer.
Three owned folders, one set of local signatures (frozen at IN01):

| Folder | What it is | Authority |
|---|---|---|
| `packages/world/src/interactions/` | Pure law: target IDs, registry/placement, reach/support/occlusion questions, family legality, the seat book | none: snapshots in, decisions out |
| `apps/realm/src/interactions/` | The room's interaction authority: `RealmInteractions` + request adapter + lifecycle, on injected room ports | the only authority |
| `apps/web/src/interactions/` | Per-frame look selector, request session, carved prompt, E key, SIMULATED bench and capture | hints only |

`@chatdom/world` exports no `./interactions` subpath yet and its manifest is not this lane's, so the realm and web
modules import `packages/world/src/interactions` by relative path. **needs: integrator/main** — add
`"./interactions": "./src/interactions/index.ts"` to `packages/world/package.json` and switch the imports.

## Shared contracts consumed exactly

From `@chatdom/shared/realm` (main's, read-only): `RealmIntentSchema` (`interact` = `version`, `id`, `targetId`,
`action` only), `RealmInteractionTarget`, `RealmSeat`, `RealmInteractionState`, `RealmInteractionLease`,
`RealmInteractionContext`, `RealmInteractionAction`, `RealmInteractionResult`, `RealmInteractions`,
`RealmTransientMessage` (`seats`), `RealmPrivateMessage` (`interaction`, nullable `requestId`), `RealmReceipt`
(`applied` for accepted ephemeral state; `committed` is never used here), `CollisionWorld`, `PlayerState`,
`WALK_BODY`. From `apps/realm/src/ports.ts`: `RealmIntentContext` (principal, walkerId, position, collisionRevision,
`current()`), `RealmRoomEffects` (`readWalker`, revision-checked `placeWalker`, `allowWalking`), and the shapes of
`RealmRoomHandle.intent / lifecycle / bindRoom / bindTransient`.

## Target IDs and the registry (`packages/world/src/interactions`)

```ts
interactionTargetId.campfireSeat(site, seat)   // fire:<site>:seat:<seat>
interactionTargetId.anvil(site)                // anvil:<site>
interactionTargetId.tavernSeat(table, seat)    // tavern:<table>:seat:<seat>
interactionTargetId.homeDoor(plot)             // home:<plot>:door
interactionTargetId.homeExit(plot)             // home:<plot>:exit
ACTION_FOR_KIND = { 'campfire-seat': 'sit', anvil: 'forge', 'tavern-seat': 'tavern', 'home-door': 'enter-home', 'home-exit': 'exit-home' }

createInteractionRegistry({ layoutRevision, world: CollisionWorld, placements: InteractionPlacement[] }): InteractionRegistry
interface InteractionPlacement { source; origin: Vec3; turn: CardinalTurn; cell: 1 | 0.125; anchors: InteractionAnchor[] }
interface InteractionAnchor { id; kind; zone; position; approach; reach; rest?; facing?; plotId? }   // producer-local cells
interface InteractionRecord { target: RealmInteractionTarget; zone; rest: Vec3 | null; facing: number | null; leadsTo; source }
```

- IDs are authored segments (`[A-Za-z0-9][A-Za-z0-9_.-]{0,40}`, no colon) and must pass `TokenSchema`. Occupancy,
  LOD, load order, labels or the camera never enter an ID. A kind outside the frozen five is refused.
- Each anchor is placed **once**: scale by `cell` (1 m for places, 0.125 m for home interiors), turn with
  `transformCardinalPoint` (local +Z → world +X at turn 1), add `origin`. Headings add `turn · π/2`.
- Disabled, explicitly, with a reason: invalid ID, kind mismatch, duplicate (both copies), bad geometry or zone,
  missing/foreign plot, reach outside (0, 3 m], an approach that is not supported and full-body clear, and a
  door/exit `rest` (far threshold) that is not. Records are sorted by ID; only `target` is public.
- Zones: `street`, `tavern:<id>` (from the tavern's own threshold flow), `home:<plot>` (this lane's interior state).

Rules shared by both ends: `withinReach` (horizontal distance ≤ reach, within a body height vertically, clear line
from the 1.55 m eye; the target's own box does not hide it), `standingClear` (supported within 5 cm and full body
clear), `interactionLegality(actor, record, occupant)` (seated → only `stand` on your own seat; wrong zone; occupied
by another walker; door only for the installed deed's plot; exit only from inside that home).

## Room authority (`apps/realm/src/interactions`)

```ts
createInteractionAuthority(options: InteractionAuthorityOptions): InteractionAuthority
interface InteractionAuthorityOptions {
  writerEpoch; clock: () => number /* room clock ms */; reconnectGraceMs;
  world: () => CollisionWorld; registry: () => InteractionRegistry | null;
  rights: { current(principal, now): Promise<boolean>; permitted(personId): boolean };
  homes: { ownedPlotId(personId): string | null };
  zones?: { zoneOf(walkerId, feet): string | null };          // tavern threshold flow
  hosts?: { admit?(…): Promise<InteractionAdmission>; released?(lease, why): void };  // specs 21/22
  recovery?: (walkerId, collisionRevision) => boolean;          // main: RealmRoomHandle.recoverWalker
  limiter?: (personId, now) => boolean;                         // the realm limiter
}
interface InteractionAuthority extends RealmInteractions {
  intent(context: RealmIntentContext, intent: InteractIntent): Promise<RealmReceipt>;
  lifecycle(event: 'join' | 'drop' | 'reconnect' | 'leave', principal, walkerId, now): void;
  bindRoom(effects: Pick<RealmRoomEffects, 'readWalker' | 'placeWalker' | 'allowWalking'>): () => void;
  bindDelivery({ transient, owner }): () => void;
  revoke(personId): void; endSeat({ targetId, generation }): boolean; adoptRegistry(): void; nextExpiry(): number | null;
  seats(): SeatsMessage; selfState(sessionId): RealmInteractionState;
  onChange(listener: (change: InteractionChange) => void): () => void; dispose(): void;
}
```

Request order, all on the room's single thread: dedupe by the principal's entry session + request ID (512 kept; a
duplicate returns the same receipt promise; a reloaded page's restarted IDs are new requests) → limiter → `await
rights.current` → for `tavern` only, preview the claim and `await hosts.admit({ …, signal })` → rebuild the trusted
`RealmInteractionContext` from `current()`, the registry at the world's revision, the deed and `rights.permitted`
**now** → one synchronous `act`. A refusal after admission cancels it. `revoke`, `leave`/`release` and `dispose`
abort that person's/session's requests still awaiting rights or admission: the signal aborts, an admission that
arrives anyway is cancelled, and the receipt is the moderation refusal (or unavailable), never a seat.

Decisions:
- **The seated body stays on the authored approach.** `sit`/`tavern` place the authoritative feet on the seat's
  approach (proved supported and clear) and `allowWalking(false)`; the sitting pose on the log/chair is presentation
  from the same anchor (`record.rest`, `record.facing`). The room never holds a body overlapping a log.
- `stand` always succeeds and is idempotent; if an edit made the approach unsafe it asks `recovery`.
- `forge` confirms reach only: no lease, unchanged state, no fact. The Forge surface opens on the browser.
- `enter-home`/`exit-home` place the body on the far threshold (`rest`) through `placeWalker`; IN05 binds the deed
  revision, furnishing and recovery route.
- Receipts: accepted → `applied` with the new self state; `occupied`/`forbidden`/`unreachable` → `refused`;
  `unavailable` → `unavailable`. Messages are one plain sentence (`REFUSAL_WORDS`), never IDs.
- Every lease change publishes `{ type: 'seats', writerEpoch, revision, seats }` once through `transient` and each
  changed self state through `owner(personId, { type: 'interaction', requestId, writerEpoch, state })` — the
  request's ID when it caused it, `null` for lifecycle. Join/reconnect also send the current self snapshot.
- Identity follows the actual room: `principal.sessionId` is a fresh entry id per window, Colyseus uses it as the
  walker id, and `RealmSeats` lets the newest window win. Owner delivery is per person, so the authority mirrors the
  room's `control`: only the person's newest connected session is ever told anything, and self revisions come from
  one counter for the whole room so they only rise across windows and reloads.
- Lifecycle (IN02): `drop` keeps the seat as `reconnecting` until `now + reconnectGraceMs` (room clock; pass
  `REALM_RECONNECT_GRACE_MS`). `join` (reload or a newer window) and `reconnect` resume **this person's** one lease
  with the same target and generation under the new session/walker key, put the body back on the approach and hold
  walking; the replaced window's self quietly ends and its later `stand`/`drop`/`leave` touch nothing. A return
  after the grace stands honestly. `leave` releases; `expire(now)` releases what ran out with nobody connected;
  `revoke` ends a person's leases in the same turn and calls `hosts.released(lease, 'revoked')`; `endSeat({
  targetId, generation })` is the host's fenced close (`'host-ended'`; a stale generation returns false);
  `adoptRegistry` releases seats whose target disappeared; `dispose` (writer loss/shutdown) tells hosts
  (`'closed'`), aborts pending admissions and delivers nothing. A tavern admission belongs to its lease: whichever
  way the lease ends, its `cancel` runs exactly once.

## Browser (`apps/web/src/interactions`)

```ts
mountInteractionController({ host, surface, session, camera, places?, keyboard?, page?, gamepads?, coarse? }): InteractionController
createInteractionController({ prompt: onUse => PromptMount, surface, session, camera, … })   // DOM-free core (tests)
interface InteractionController { frame(frame: InteractionFrame): void; use(): boolean; leave(): boolean; readonly debug; dispose(): void }
interface InteractionFrame { now; look: LookFrame; records; world; actor: { walkerId, zone, ownedPlotId }; project(point); ray?(x, y) }
interface InteractionPlaces { open({ action, record }, closed: () => void): { close(): void } | null }
createInteractionSession({ realm: { send(intent) }, clock, nextId?, feedback? }): InteractionSession
interactionSound(kingdomSound): InteractionFeedback
selectInteraction(…) · pickInteraction({ ray, feet, records, world, actor, seats }) · assessTarget(…) · promptView(…)
bindUseKey(onUse, { keyboard?, owned?, page? }): () => void
```

The **controller** is the one browser interaction owner per kingdom view. It owns the look, picks, E, Escape, the
gamepad, the prompt and one camera token; the session owns requests; the room owns every answer.

- **Selection** (pure, every frame): candidates within 34° of the camera's horizontal view, judged by
  `assessTarget`: in reach with a clear eye line, legal now, approach supported and clear. Nearest wins, then
  alignment, then ID. The current focus is kept while within 42° and no more than 0.4 m farther than the best; an
  occluded or illegal one is never kept. Seated: your own seat offers `stand` wherever you look. Taken logs and
  other people's doors are a quiet line only when nothing is actionable.
- **One registry for every input.** E, a tap on the prompt and gamepad West use the focus. A click or tap on the
  world (walk-camera's `isClickPress`: < 8 px, < 300 ms) casts `frame.ray(x, y)` and `pickInteraction` takes the
  nearest authored point within 0.5 m of the ray, seen from the camera without a solid between, then judges it
  with the same `assessTarget` from the feet. A target out of reach says "Walk a little closer" quietly for 1.8 s
  and sends nothing; taken or someone else's says its quiet line.
- **Gamepad** (standard mapping, polled in `frame`, edge-triggered): West (X / Square) = E, East (B / Circle) =
  Escape. South stays free for jumping.
- **E is one-shot.** `KeyE`, not repeating, not composing (`isComposing`, `Process`), no Ctrl/Cmd/Alt, not in a
  field/textbox/combobox/dialog, not on another keyboard-focused control (walk-camera's `isKeyboardControl`,
  except the prompt itself), and only while interactions own input (walking, or holding a seat's view). A press
  that went down anywhere else stays spent until keyup (blur/hidden page reset it), so leaving a field with E held
  cannot fire it. Walk-camera never reads E.
- **The camera token.** On the room's acceptance (never before) of `sit`/`tavern`/`forge`, and only while
  walk-camera is `walking`, `places.open` may return the place's own view; the controller then calls
  `camera.release()`. A place with no view of its own (`null`) leaves the walking camera alone. The token ends,
  with `view.close()` and `camera.resume()` in the same call, on: Escape/gamepad East (`leave()`), E/tap "Stand
  up", the first W/A/S/D/arrow while seated, the room's self state no longer seating you there (stand, revoke,
  host end, expiry), a disconnect, the place calling `closed()`, and `dispose()`. Escape while seated releases at
  once and asks to stand; the prompt says "Getting up…" until the room's state arrives. Escape while pending
  `abandon()`s: a late yes updates the truth (seated, "Stand up") but cannot open a view or take the camera.
  While the Forge's view is held, the prompt is hidden and E is the Forge's; an Escape the Forge already handled
  (`defaultPrevented`) is left to it. **Blur and a hidden page** abandon a pending request and drop held E/press
  state, but do not close an accepted seat or Forge view (spec 37 decision: alt-tab to copy a line must not close
  the Forge; the room still says you sit).
- **Session**: one request at a time (a held key or repeat sends nothing more); pending is set synchronously with
  the press; only the room's receipt/self state ends it. Drops outdated self revisions and older seat revisions; a
  new writer epoch resets. `abandon()` lets go locally and its late reply can no longer fire `onAccepted`.
  `disconnect()` clears everything actionable. `refused` and `unavailable` receipts keep their own outcome; an
  unanswered request becomes `unavailable` after 8 s and says nothing is assumed.
- **Prompt**: parchment strip on dark wood, brass key with E, a brass stem to the target; ≥ 44 px tap target, no
  key on coarse pointers. Tones: `ready`, `pending` (ember, italic), `refused` (seal ink), `unavailable` (faded ink
  on cool parchment, unlit stem), `quiet` (smaller, italic, translucent). Reduced motion removes the rise and the
  ember pulse. It never takes focus from the world. Local response (use → pending in the DOM) is synchronous.
- **Feedback** on the existing kingdom bus (`createKingdomSound().cue`), finished families only: press →
  `wood`/brass; accepted → `place` wood (log, chair), `place` metal (anvil), `remove` wood (stand), `wood` (door);
  refused/unavailable → `wood`/parchment. A locked or muted bus stays quiet; no new AudioContext.

## Bench and capture

`/src/interactions/bench/index.html` (vite dev; not in the production build) runs the real selector, session,
prompt and `createInteractionAuthority` against a SIMULATED court, two SIMULATED people and a simulated room
delay, all labelled on screen, through `mountInteractionController`. A bench camera token stands in for
walk-camera's and a seated framing for the campfire's; the anvil has no Forge view there, so its acceptance keeps
the walking camera. Params: `look`, `latency`, `rival=<seat>`, `race=<seat>`, `motion=reduce`, `room=closed`.

```sh
cd apps/web && pnpm exec vite --host 127.0.0.1 --port <free 5170–5199> --strictPort   # an owned dev server
node apps/web/src/interactions/capture.mjs --base-url http://127.0.0.1:<port>
```

It takes the shared capture lock, fails on page/console errors, checks the 44 px target and viewport fit, and
writes `shots/interactions/{prompt,look-anvil,pending,seated,refused,unavailable}@1440x900.png`, `{prompt,seated}@390x844.png`,
both contact sheets and `report.json` (local pending response: DOM time is judged < 100 ms; the next paint is
SwiftShader frame time, reported only).

## Integrator recipe (draft at IN01; IN04–IN06 complete it)

Realm (in the kingdom room's handle wiring, after the founded layout and its collision revision are installed):

1. `const interactions = createInteractionAuthority({ writerEpoch: handle.writerEpoch, clock, reconnectGraceMs,
   world: () => handle.world, registry: () => registryFor(handle.world.revision), rights, homes, zones, hosts,
   recovery: (w, r) => handle.recoverWalker(w, r), limiter })`. `registryFor` builds
   `createInteractionRegistry({ layoutRevision, world, placements })` once per collision revision from the installed
   campfire/anvil/tavern/home anchors.
2. In `handle.bindRoom(effects)`: also `interactions.bindRoom(effects)`. In `handle.bindTransient(send, owner)`:
   also `interactions.bindDelivery({ transient: send, owner })`. Release both binders with the room's.
3. In `handle.intent(context, intent)`: `if (intent.type === 'interact') return interactions.intent(context, intent)`.
4. In `handle.lifecycle(event, principal, walkerId, now)`: forward to `interactions.lifecycle(…)`; schedule
   `interactions.expire(clock())` at `interactions.nextExpiry()` on the room clock after every drop.
5. Moderation (warning/timeout/ban/revoked rights): update the rights `permitted` reads, then
   `interactions.revoke(personId)` in the same turn. A table host that closes a guest's place calls
   `interactions.endSeat({ targetId, generation })` with the generation from `hosts.released`/the seat it admitted.
6. After `adoptWorld`: rebuild the registry for the new revision, then `interactions.adoptRegistry()`.
7. Writer loss/shutdown: `interactions.dispose()` before the room closes.

Web (in the kingdom scene, with the realm client and walk controller connected):

1. Create order: registry (same placements, same revision as the room) → `const session = createInteractionSession({
   realm: { send: intent => room.send('intent', intent) }, clock: () => performance.now(), feedback:
   interactionSound(sound) })` → `session.connect(bootstrap.writerEpoch)` → forward `private` receipts/interaction
   and `transient` seats into `session.receive` → after `createWalkController`: `const interactions =
   mountInteractionController({ host: kingdomRoot, surface: canvas, session, camera: walk, places })`. `places` is
   IN04's adapter to the campfire seated framing, the table host and the existing Forge.
2. Per frame, after `walk.frame(now)` and the camera is placed: `interactions.frame({ now, look: { feet: walk.debug.self
   feet, forward: camera.getWorldDirection() }, records, world: current collision world, actor: { walkerId:
   walk.debug.selfId, zone, ownedPlotId }, project: point → CSS px in kingdomRoot, ray: (x, y) →
   Raycaster.setFromCamera(ndc(x, y), camera).ray })`. It ticks the session itself.
3. Camera/input priority: E, Escape-while-interacting and gamepad West/East belong to interactions (walk-camera input
   table). The controller calls `walk.release()`/`walk.resume()` itself; build mode or a menu that releases walk
   first simply makes interactions inactive (no prompt, no E) until walk is back.
4. Disconnect: `session.disconnect()` (the controller hands back any held camera on its next notification).
   Teardown: `interactions.dispose()` → `session.disconnect()` → (walk/realm as their owners say).
