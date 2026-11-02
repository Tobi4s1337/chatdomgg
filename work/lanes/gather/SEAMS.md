# gather seams

What this lane offers other lanes and what it needs from them. A seam is frozen once both lanes' `SEAMS.md` say
the same thing. To change a frozen seam, write the change in both files and add a `needs:` line to progress.
Shapes below are this lane's proposal until the other lane confirms them. Names may change, but the meaning should not.

## 1. Tavern portal transfer (play provides; gather supplies the destination)

**Founder correction, 2026-11-01:** the tavern is a separate small world, not a building interior mounted in the
kingdom scene. This supersedes the proposed tavern `PlaceProvider`, footprint, dollhouse and kingdom-seat seams.
The campfire remains in the kingdom. The following client adapter is a proposal pending play's confirmation;
gather does not edit play's files or implement a second generic transfer controller.

### Play owns

- The generic portal transition: leave the source room, show a short crafted transition, join the destination
  room, install its scene/collision, spawn at the supplied anchor and resume walking. Failure recovers to a safe
  source anchor and never reports success while entry is unconfirmed.
- Session continuity and a fresh destination ticket from the existing realm entry service. Tickets are burned on
  authentication: transfer carries the session, identity and approved look, not the old ticket.
- One local walker in exactly one room. Transfer releases any source seat before leaving. Stale source packets
  cannot mutate the destination. Return leaves `tavern`, joins `kingdom` and spawns at the existing exterior
  door facing out. Disconnect, revoked session and failed entry have a recoverable path.
- Walking, camera, pointer lock, local walker rendering, input leases, hide-self and HUD slots in either scene.
  E sits/stands; Esc stands before opening the menu. Pointer lock stays locked during game input.

### Gather owns and provides

- `createTavernRoom(services)` in `apps/realm/src/games/room.ts`: destination room type `tavern`, filtered by
  `kingdomId`; its authoritative walkers, interior collision, physical table seats and games.
- The independent tavern scene under `apps/web/src/tavern/**`, the same scene on `/-/tavern` and the portal
  destination. `mountTavern(scene, options)` supplies the room's content; `kit` contains local collision,
  table positions and chair/approach anchors. The composed scene has no ceiling between the camera and game.
- The portal descriptor, `TavernPortal` in `packages/shared/src/games.ts` (implemented 2026-11-02):
  `{ version: 1, id: 'tavern:<kingdomId>:door', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  source: { placement, collisionRevision }, door, returnAnchor, entry, exit }`. Anchors are `{ feet, yaw }`, with feet
  in metres and the walker's yaw byte (zero faces +Z, 64 faces +X). `door` and `exit` are walk-through thresholds,
  `{ min, max, through }`: an axis-aligned volume of feet positions, crossed in the unit horizontal direction
  `through`. The frozen interaction target kinds have no portal, so the door is crossed, never pressed: "crossing its
  door" in the founder's words. `createThresholdWatch(threshold)` fires once per crossing in the `through` direction
  only: it arms when the body is seen off the threshold on its approach side (before the near face) and fires when it
  then steps on, or clears it in one step squarely across the doorway's span. A spawn or reconnect on a threshold,
  stepping on from beside it and walking in backwards from the far side never fire (2026-11-02).
  - Kingdom frame: `tavernPortalFor(kingdomId, scene, world)` (exported from `apps/web/src/tavern/index.tsx`; the
    same derivation is `apps/realm/src/games/portal.ts` for the realm) reads the installed
    `civic:growth:v1:tavern` placement and its own blueprint. It finds the body-height carve through the public face,
    the way home doors are found, so every growth level and turn gives the same doorway. `door` covers that opening,
    with `through` pointing inward. `returnAnchor` is supported clear feet just outside, facing out, checked against
    the exact installed collision. An absent tavern or blocked forecourt yields `null`: no door is offered. A stale
    collision revision throws. Nothing is placed, reserved or changed in the kingdom.
  - Tavern frame: `entry` is a step in from the interior doorway facing the room (`[7, .125, 8.6]`, yaw 128); `exit`
    is that doorway. The tavern room watches every walker's authoritative feet against `exit` and sends that walker
    alone `exit` (`{ at }`). The destination surface turns it into `TavernRoomSurface({ leave })`. The room never
    leaves, transfers or moves anyone itself.
  - Play's part: watch `door` against the kingdom walker's feet. On a crossing, leave `kingdom`, join `tavern` with
    a fresh ticket and the carried session, and spawn at `entry`. On `leave()`, leave `tavern`, join `kingdom` and
    spawn at `returnAnchor`. If `source.collisionRevision` no longer matches the installed world, derive again.
- The working destination adapter is `connectTavern(endpoint, entry, storage?)`, exported by
  `apps/web/src/tavern/index.tsx`. `entry` has the existing `RealmEntry` shape and must issue a fresh ticket for
  this destination. It returns the tavern's authenticated room, authoritative collision, movement adapter,
  public table frames and private owned-chair state. It never leaves a source room or reports a portal transfer.
- `TavernRoomSurface({ open, requestInput, audio })` composes the existing walk controller, citizen renderer and
  interaction/camera owner with that destination. The caller installs only one active room surface after leaving
  the source. Table framing uses the same actual board as the miniatures and hides only the local seated body.
  `open(): Promise<TavernClient>` is supplied by the transfer owner; `requestInput(canvas, reason)` returns
  `GameInputLease` from `apps/web/src/games/input.ts` (`active`, `onKey`, `onPointer`, `release`). Integrated play
  must keep its pointer locked when handing that lease to the game. The supplied canvas is a dedicated transparent
  seated input surface over the existing rendered scene. It prevents the disabled walking look owner from
  cancelling the game's lock; it adds no renderer or camera owner. The loopback adapter may require a fresh
  canvas click when acquiring lock or restoring a connection.
- `audio` is the caller's existing `KingdomAudio` from `@chatdom/audio`, retained across portal transfers. The
  destination obtains only its unlocked shared host; it never creates a second context or changes integrated
  volume/mute. Its finite sound layer consumes raw public tables, actual connected walkers, listener feet and
  camera direction. It stops on mute, hidden tab, stalled delivery, disconnect and unmount. Actual Pong swept
  contacts schedule against the existing board presentation clock; no sound infers a bounce or reads RNG.
  `audioControls` defaults to false; only the independent inspection route enables its local sound button.
- The surface restores a retained chair's framing only after a fresh authoritative bootstrap. It does not
  recreate an abandoned local interaction. E/Esc and the HUD's stand action go through the existing interaction
  owner and server seat release. The carved game HUD is within the surface; moving it to play's HUD slot remains
  pending play's confirmed adapter.
- **The destination for play's `PortalDestination` (`apps/web/src/tavern/play-slot.ts`, 2026-11-02).** Play's B1b
  (on `lane/play`, `play/portal.ts`) confirmed the descriptor and `mount(host, visit) → { ready, dispose }`. Gather
  implements its side against structural copies of those types, so neither branch imports the other:
  - `tavernPortalDescriptor(portal)` turns a derived `TavernPortal` into play's `PortalDescriptor`: `entryAnchor`
    from `entry`, `returnAnchor` from `returnAnchor`, title "The tavern". Yaw bytes become radians in the same
    frame (zero faces +Z, π/2 faces +X: `byte × π / 128`). If the kingdom source spawns by yaw byte, it converts back.
  - `watchTavernDoor(portal, enter)` is the crossing for the kingdom walk: feed it the predicted feet every frame and
    call `enterPortal(descriptor)` from `enter`. Play's `registerPortalDoor` prompt may stay as the click/touch way in.
  - `createTavernDestination({ audio, requestInput?, storage? })` returns `{ room: 'tavern', title, mount }`. `mount`
    renders `TavernRoomSurface` into play's host with `open: () => connectTavern(visit.endpoint, visit.entry)` (a
    fresh ticket from `visit.entry.ticket()`). `ready` resolves when the walk reports you placed in the room
    (authoritative state, interior, tables, self and scene) and rejects if it never opens. The interior doorway
    calls `visit.leave()`; a connection that ends unrestorably after arrival calls `visit.fail(reason)`. A visit
    that has ended steers nothing. `dispose` unmounts, then resolves only once every connection the visit opened
    has really let go (`TavernClient.leave()`, which awaits the SDK's leave; a connection already gone counts) and
    rejects while one may still hold you, so play's retry calls it again. An open still in flight when disposed
    is left as soon as it lands. `requestInput` defaults to the tavern's own pointer-lock lease on its seated canvas.
  - The wiring is one line in play's `apps/web/src/play/providers.ts` once `play/portal.ts` is on the integration
    branch: `registerPortalDestination(createTavernDestination({ audio: <play's retained KingdomAudio> }));` plus,
    in the kingdom walk, `const descriptor = tavernPortalDescriptor(portal)`, `registerPortalDoor(descriptor)` and
    `watchTavernDoor(portal, () => void enterPortal(descriptor))` on the predicted feet, where
    `portal = tavernPortalFor(kingdomId, scene, world)`. Gather does not write these lines into play's files.
- All three games consume that lease. Stones uses mouse motion or arrows to select, click/Enter/Space to drop,
  and 1–7 for a direct column. Dice uses click/R to roll and right-click/H to hold. Enter/Space also starts a
  ready table. Pong uses mouse/A/D/arrows and Enter/Space to start. E/Esc remain with the interaction owner;
  native controls remain available for touch and focus navigation. Held presses do not repeat across leases.
- A dropped destination connection immediately retires its input lease. Re-entry waits for fresh room state,
  interior, tables, self and matching-writer interaction bootstrap before restoring its retained chair and lease.
  The rotated reconnect token is saved after the SDK's join handler and again after that barrier. Terminal leave
  clears it and offers a fresh destination open through the supplied `open()`. That retry is destination recovery,
  not a claimed source-room return. Play still owns the safe generic portal recovery path.

The existing action/target contract has no generic portal action, and none is added: `RealmIntentSchema` and the
target kinds are unchanged. **needs: play** adopt `TavernPortal` and implement generic portal transfer and return
(watch `door`, transfer, spawn at `entry`, and on `leave()` return to `returnAnchor`). Supply the retained common audio
owner to the destination. Until then `/-/tavern` is the same destination scene, with no fake
transfer success. No tavern chairs are installed in the kingdom registry.

**needs: play/render owner** review common citizen cost with approved looks on real GPU. The populated phone
reference view measures 11 room draws plus 62 common citizen draws, 73 total, with eight connected walkers and
three live games. Gather keeps the common renderer and actual bodies. This is no whole-scene draw or GPU claim.
Gather's own name overlay now measures full text and suppresses overlapping/edge-clipped labels while retaining
their head anchors; no common renderer change is needed. See `work/evidence/gather/ga10-room-budget.md` and
`work/evidence/gather/ga10-names.md` for the checks and limits.

**needs: integrator/session owner** provide a supported test entry/session issuer for the lane's isolated
database-backed founded kingdom. The existing `/reference/session` route is memory-only and admits synthetic
reference visitors; it cannot prove tobi4s_'s identity or durable session continuity. No credential values or live
session files are read by this lane's capture harness.

**needs: play** provide the approved look registry/resolver with destination composition. The current independent
surface supports the six shared starter looks and refuses an unknown look rather than inventing clothes. Full
wardrobe/look continuity must use the same approved look source as play before portal acceptance.

## 2. Exterior door and the campfire (grand-world; integrator for founded hooks)

### Tavern exterior

- Keep the existing growth-civic tavern placement, asset and footprint. Gather no longer requests a 14 × 10 m
  site, a replacement `gather:tavern:v1` placement, or any tavern change in `founded/scene.ts` or `civic-growth.ts`.
- Gather derives the door from the installed placement and collision itself (`tavernPortalFor`, §1). Grand-world
  and play supply nothing for it. Tests: the authored form at levels 1 to 4, both styles and all four turns; and real
  assembled founded scenes at levels 1 and 4, where a walker steps from the return anchor through the door and back
  out under the shared movement rule. No placement changes. The interior's local dimensions have no effect on lots,
  roads or the exterior. When grand land installs a tavern under the same placement id, the same derivation applies.
- The tavern scene is mounted only as the portal destination, never in `apps/web/src/kingdom/scene.ts`.

### Campfire (unchanged world ownership)

- Grand-world supplies a clearing about 9 m in radius at the Wilds edge, inside walkable land, flat enough for logs,
  clear of trees/roads, and in sight of town lights. The optional land shape is
  `places.campfire: { origin: Vec3, turn: CardinalTurn, footprint: readonly [number, number] }`.
- Gather installs only the campfire clearing via the approved founded hook and adds log anchors through
  `campfirePlacement` in `packages/world/src/interactions/places.ts`. The kingdom room remains its authority.
- `CampfireSeatHost` binds to the kingdom interaction authority via the small evening attach hook; no tavern
  host is passed there. The clearing uses grand-world's typed scene mount with scene/camera, local feet, shared
  hour, quality and tick/resize callbacks.
- Stream framing selects a source scene as well as a shot: streamer table games are in `tavern`, Dusk Court is
  in `kingdom`. Gather supplies public game cues; grand-world's director lets raids and big moments take priority.
  **needs: grand-world** confirm tavern scene selection for stream framing and the campfire anchor/mount.

## 3. Chat commands (raid-show owns `apps/herald`)

gather defines the contract in `packages/shared/src/games.ts`:

```ts
export const GATHER_CHAT_COMMANDS = ['sus', 'drop', 'roll', 'hold', 'pull'] as const;
/** Pure: `!drop 4` -> { command: 'drop', arg: '4' }; anything else -> null. Arguments are at most 32 characters. */
export function parseGatherCommand(text: string): { command: GatherChatCommand; arg: string | null } | null;
export const GatherChatEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('command'), kingdomId: KingdomIdSchema, messageId: TokenSchema,
    at: EpochMsSchema, chatter: z.strictObject({ twitchId: PersonIdSchema, login: TwitchLoginSchema,
    displayName: DisplayNameSchema }), command: z.enum(GATHER_CHAT_COMMANDS), arg: z.string().max(32).nullable() }),
  z.strictObject({ kind: z.literal('cleanup'), kingdomId: KingdomIdSchema, twitchId: PersonIdSchema, at: EpochMsSchema }),
]);
export const GATHER_CHAT_ROUTE = '/internal/realm/gather/chat';
```

- raid-show asks: in the herald's chat ingest, call `parseGatherCommand` and, when it matches, POST a `command`
  envelope to the realm's `GATHER_CHAT_ROUTE` with the same internal authentication as `/internal/realm/herald`.
  Timeouts, bans and message deletions for an identity also send a `cleanup`. The herald keeps dropping `!`
  messages from speech as it does now. That is one branch and one send; gather never edits the herald.
- gather mounts the route in the realm (one line in `main.ts`), deduplicates by `messageId` and by identity, and
  ignores commands for a game that is not waiting for chat. It never replies in chat.
- Until it lands: `needs: raid-show herald gather commands`, and gather proves chat play through the realm's
  authenticated test ingress with the same envelope.

## 4. Tavern room and realm hooks (gather writes; integrator reviews)

**needs: integrator** the installed `uWebSocketsTransport.listen` drops `hostname` and reports readiness even
when its native callback receives no socket. The core transport should forward an explicit hostname through
`app.listen(hostname, port, callback)` and reject `!socket` before readiness, preserving native listener ownership.
Gather's local multiplayer scripts temporarily forward only their own app setup and validate that bind; no
production transport or dependency file is changed here. This is a host-isolation issue, not a game/session failure.

- `apps/realm/src/server.ts`: one additive import and one registration,
  `tavern: defineRoom(createTavernRoom(services)).filterBy(['kingdomId'])`. There is no separate `gather` match
  room: games run in the tavern room alongside its own authoritative walkers and physical seats.
- `apps/realm/src/main.ts`: a typed attach call for durable gather storage and routes. Session/ticket issuance
  uses existing realm auth, with an additive destination/anchor transfer seam coordinated with play/integrator.
- `apps/realm/src/evening/interactions.ts`: only the campfire host and zones are passed into the kingdom
  authority. Tavern chairs and `TableSeatHost` belong to the tavern room's own authority.
- `apps/realm/src/persistence/migrations/0016_realm_gather.sql`: lane tables only (matches, accepted turn moves,
  results, tallies, keepsakes), all prefixed `gather_`.
- `packages/shared/src/games.ts` plus one barrel export. Existing exported schemas and target kinds are unchanged.
- Entry is authenticated and kingdom-filtered; no client can choose its actor, grant itself a seat or name another
  person's presentation. All public game projection happens before serialization. The stream sees public views.
- Leaving/disconnect behavior is owned by the physical room lease, not by an extra game socket. Restart interrupts
  Pong without a winner; turn games retain exact persisted state, RNG cursor and absolute deadline.
- The production attach is `installGatherStore(boot.services, createPostgresGatherStore(pool))` immediately after
  the existing dock service install in `main.ts`. It shares the boot pool and schema and owns no second pool or
  shutdown resource. `0016` currently creates only `gather_table_checkpoints` and `gather_table_moves`; result,
  tally and keepsake derivation remains GA12. The checkpoint and immutable accepted move commit together.
- The store owns only each client it checks out from that pool. If write/commit cleanup cannot roll back, it
  releases with destruction so an uncertain transaction is never recycled to another realm operation. Successful
  rollback keeps the client reusable; the original failure still reaches table reconciliation. No caller pool
  lifetime or attach contract changes. Evidence: `work/evidence/gather/ga10-store-cleanup.md`.
- Tables expose additive optional `game`, `stones`, `dice`, `players`, `status` and `extraSeats` fields in
  `games.ts`. The original two-chair `seats` tuple remains stable. Hearth Dice has physical chairs 1–4;
  `self.seatIndex` identifies the physical chair, while `self.playerIndex` indexes immutable match participants.
  `self.seat` retains its original two-chair meaning. A new sitter never inherits an old participant's moves.
- `PongView.contacts` is an additive optional public ring of the latest eight actual swept paddle/rail impacts:
  `{ sequence, tick, at, kind, x, y }`. Old views/checkpoints remain valid. These facts carry no seed, input target
  or private state and do not change physics. The client deduplicates them per match and never replays history
  after a fresh connection. This avoids guessing audible impacts from sparse ball positions.
- Recovered active turn-game participants reserve their original chairs for thirty seconds without creating a
  body or authenticated self. They re-enter through normal physical seating. At expiry, concessions persist;
  simultaneous total abandonment draws. Lifecycle retries are coalesced per table and bypass the bounded user
  command queue. Uncertain storage freezes mutation until durable truth is reconciled. Pong's live physics is
  memory-only; start, interruption/concession and terminal points have durable checkpoints.

## 5. Read routes (gather offers; panel-window, play and the future bag read)

- `GET /realm/gather/tally?kingdom=<id>` returns `{ games: [{ game, entries: [{ name, wins }] }] }`, with
  approved public names only.
- `GET /realm/gather/keepsakes?kingdom=<id>&person=<id>` returns
  `{ keepsakes: [{ id, kind, title, game, at, place, together: boolean }] }`, newest first. A person sees only
  their own.
- The public gateway allowlist (`apps/api/src/public/routes.ts`, front-door's) takes one line per route when it is
  needed. gather writes it as a `needs:` line for front-door.

## 6. Others

- **forge-wish:** no shared files. The anvil and its interaction stay as they are.
- **front-door:** gather uses the carved kit in `packages/ui` read-only.
- **The campfire's log generator** `packages/content/src/seating.ts` is shared with the market. gather reads it and
  never changes its output; campfire-only dressing goes in `packages/content/src/campfire/**`.
