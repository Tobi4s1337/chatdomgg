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
  revoke(personId): void; adoptRegistry(): void; nextExpiry(): number | null;
  seats(): SeatsMessage; selfState(sessionId): RealmInteractionState;
  onChange(listener: (change: InteractionChange) => void): () => void; dispose(): void;
}
```

Request order, all on the room's single thread: dedupe by person + request ID (512 kept; a duplicate returns the
same receipt promise) → limiter → `await rights.current` → for `tavern` only, preview the claim and `await
hosts.admit` → rebuild the trusted `RealmInteractionContext` from `current()`, the registry at the world's
revision, the deed and `rights.permitted` **now** → one synchronous `act`. A refusal after admission cancels it.

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
- Lifecycle: `drop` keeps the seat as `reconnecting` until `now + reconnectGraceMs` (room clock); `join` of the
  same session (reload) or `reconnect` resumes the same generation and rebinds the opaque walker key; `leave`
  releases; `expire(now)` releases what ran out with nobody connected; `revoke` ends a person's leases in the same
  turn and calls `hosts.released(lease, 'revoked')`; `adoptRegistry` releases seats whose target disappeared;
  `dispose` (writer loss/shutdown) tells hosts and delivers nothing.

## Browser (`apps/web/src/interactions`)

```ts
selectInteraction({ frame: LookFrame, records, world, actor, seats, previous }): InteractionSelection
createInteractionSession({ realm: { send(intent) }, clock, nextId?, feedback? }): InteractionSession
promptView(selection, snapshot, records): PromptView | null
mountInteractionPrompt(host, { onUse, coarse? }): { update(view, placement), dispose() }
bindUseKey(onUse, { keyboard?, owned? }): () => void
```

- **Selection** (pure, every frame): candidates within 34° of the camera's horizontal view, in reach with a clear
  eye line, approach supported and clear, legal now. Nearest wins, then alignment, then ID. The current focus is
  kept while within 42° and no more than 0.4 m farther than the best; an occluded or illegal one is never kept.
  Seated: your own seat offers `stand` wherever you look. Taken logs and other people's doors are a quiet line
  only when nothing is actionable.
- **Session**: one request at a time (a held key or repeat sends nothing more); pending is set synchronously with
  the press; only the room's receipt/self state ends it. Drops outdated self revisions and older seat revisions; a
  new writer epoch resets. `abandon()` (Escape/blur/Leave) lets go locally and its late reply can no longer fire
  `onAccepted`, so it cannot take the camera back. `disconnect()` clears everything actionable. An unanswered
  request stops blocking after 8 s and says nothing is assumed.
- **Prompt**: parchment strip on dark wood, brass key with E, a brass stem to the target; ≥ 44 px tap target, no
  key on coarse pointers, refusal in seal ink, quiet line smaller and italic. Reduced motion removes the rise and
  the ember pulse. It never takes focus from the world.
- **E**: `KeyE`, not repeating, not composing, no Ctrl/Cmd/Alt, not in a field/dialog; walk-camera never reads E.

## Bench and capture

`/src/interactions/bench/index.html` (vite dev; not in the production build) runs the real selector, session,
prompt and `createInteractionAuthority` against a SIMULATED court, two SIMULATED people and a simulated room
delay, all labelled on screen. Params: `look`, `latency`, `rival=<seat>`, `race=<seat>`, `motion=reduce`.

```sh
cd apps/web && pnpm exec vite --host 127.0.0.1 --port <free 5170–5199> --strictPort   # an owned dev server
node apps/web/src/interactions/capture.mjs --base-url http://127.0.0.1:<port>
```

It takes the shared capture lock, fails on page/console errors, checks the 44 px target and viewport fit, and
writes `shots/interactions/{prompt,look-anvil,pending,seated,refused}@1440x900.png`, `{prompt,seated}@390x844.png`,
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
5. Moderation (warning/timeout/ban/revoked rights): `interactions.revoke(personId)` in the same turn.
6. After `adoptWorld`: rebuild the registry for the new revision, then `interactions.adoptRegistry()`.
7. Writer loss/shutdown: `interactions.dispose()` before the room closes.

Web (in the kingdom scene, with the realm client and walk controller connected):

1. Create order: registry (same placements, same revision as the room) → `createInteractionSession({ realm: { send:
   intent => room.send('intent', intent) } , clock: performance.now, feedback })` → `session.connect(bootstrap.writerEpoch)`
   → forward `private` receipts/interaction and `transient` seats into `session.receive` → `mountInteractionPrompt(
   kingdomRoot, { onUse })` → `bindUseKey(onUse, { owned: () => walk.owner === 'walking' || seated })`.
2. Per frame, after `walk.frame(now)`: `selectInteraction({ frame: { feet: predicted feet, forward: camera
   direction }, records, world: current collision world, actor: { walkerId, zone, state: snapshot.self, ownedPlotId },
   seats: snapshot.seats, previous })` → `promptView` → `prompt.update(view, project(view.anchor))`; `session.tick(now)`.
3. Camera/input priority: E belongs to interactions (walk-camera input table). On an accepted seat/Forge/table:
   `walk.release()` and hand the framing to the place's own seated/table/Forge view; on stand/Escape/Leave/blur/
   disconnect: `session.abandon()` where pending, `walk.resume()` at once (authoritative pose stays pending until
   the room's state arrives).
4. Teardown: unbind key → dispose prompt → `session.disconnect()` → (walk/realm as their owners say).
