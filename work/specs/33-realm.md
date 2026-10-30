# Spec 33: One kingdom, one writer

Status: frozen · 2026-10-30
Vision: `chatdom/ChatDom.md` §§1–3; `chatdom/Tech.md` §§4–6, 8–9, 11–12.

## What and why

People enter the same place. A footstep responds immediately under your hands; another person's walk is
smooth; a window, a published home and a forged chimney mean the same thing to every viewer. The kingdom
remembers these things after every browser and server closes. The quality test is walking from the square
to the water with someone else, not seeing matching counters on a network bench.

Main freezes the executable boundary and builds its thin reference room/client. The four consumer lanes
then implement persistence and entry, the complete walking feel, existing-system wiring, and interactions.
The seven look/place lanes keep their existing ownership. Only the team integrator composes the shared scene.

## Rules

- One `KingdomRoom`, deterministic `k:<channelId>`, is the writer. A small kingdom also carries its walkers
  there; future LayerRoom/DraftRoom/MatchRoom adapters request kingdom facts and never become rival ledgers.
- Pin Colyseus 0.18.10, core 0.18.23, schema 5.0.42, SDK 0.18.8 and uWS transport 0.18.4. Node 22 suffices.
- Movement has one shared pure step in `packages/world`: 30 Hz input/simulation, 5 Hz schema patches.
  Colyseus `defineInput`, `setFixedTimestep` and `Predict` own sequencing, reconciliation and interpolation.
  Consume at most one input per server tick; a flood cannot buy additional simulated seconds.
- Quantized world-direction components and button bits cross the wire. Camera trigonometry stays outside
  simulation. Collision queries use immutable versioned solid AABBs in world metres; unknown terrain blocks.
- Public schema contains a small kingdom header and visible walkers. One StateView is shared by a district,
  including its neighbouring districts; never allocate a view for each walker. Chat presence has no sockets.
- Durable domain state and the event log are private. Intents produce proposed facts; append with the writer
  fence and expected sequence before applying, acknowledging or broadcasting. Postgres is the truth; a process
  memory adapter is an explicitly labelled reference, never live durability.
- Authentication establishes the actor. Browser payloads never choose an owner, balance, verdict or commit.
  Herald's existing slot is presentation only. Actual deeds and a founded layout revision establish homes.
- The room binds the existing KingdomForgeAuthority port. Coal reservation, expiry, revalidation, exact host
  digest, consume-and-attach, displaced-item retention and public outbox are one serialized durable authority.
  Neither a browser nor Codex writes a home. Both independent judges remain required.
- Drops use allowReconnection; reload uses the SDK reconnect token. Reconnection revives a lease, never a
  second avatar. A new writer epoch invalidates old ephemeral seats/tokens, while durable work remains.
- Explicit uWS backpressure closure and finite per-second inbound message limits. The earlier fan-out test
  did not exercise prediction timing headers; the realm-server lane must test the actual 300-walker path.
- Third-person walking is the kingdom entry view; stream presets remain. The free cursor remains usable for
  UI; mouse-look can capture on deliberate play input, with immediate Escape and a drag fallback. Walking
  itself never requires holding a mouse button. Pointer-lock warp filtering follows the researched lessons.

## References

- `work/references/colyseus-realm.md`: release APIs, district views, per-socket costs and recovery.
- `work/references/walking-voxel-worlds.md`: swept boxes, supported auto-step, shoulder framing and input pitfalls.

## Executable contracts

Import the public boundary from `@chatdom/shared/realm`. This subpath keeps Colyseus schema machinery out of
unrelated shared consumers. Main owns these files and their compatibility:

| File in `packages/shared/src/realm/` | Boundary |
|---|---|
| `movement.ts` | `PlayerState`, quantized `WalkInput`, `PlayerStep`, immutable `CollisionWorld`/solid boxes; feet in world metres; 30 Hz, 200 ms patches, 90 inbound frames/s |
| `schema.ts` | Actual schema 5 `WalkInputSchema`, `WalkerSchema`, `KingdomRoomState`; float64 simulation fields, byte yaw, filtered public walker map |
| `messages.ts` | Strict join and browser intents; authenticated private principal; deterministic room IDs; receipts; public bootstrap/durable deliveries and separate ephemeral chat/seats |
| `auth.ts` | Same-origin session, OIDC entry/callback, ticket and signout route constants and strict DTOs; private cookies/CSRF/tickets |
| `domain.ts` | Private state, capability-scoped commands, fact envelope, writer lease, repository transaction/lookup and atomic presence checkpoint interfaces |
| `forge-authority.ts` | Existing `KingdomForgeAuthority`, now shared with the room; reservation, current host, exact approved attachment, private creation/provenance and terminal outcomes |
| `interactions.ts` | Trusted reach/permission context, ephemeral physical seat leases, accepted self state and release/reconnect lifecycle |

`RealmFact` follows the existing envelope vocabulary: `seq`, `occurredAt`, `receivedAt`, `committedAt`, `origin`,
`actor`, `cause`, `type: 'realm.transaction'`, and command `body`. Private state uses `sequence`. A public delivery
is an explicit allowlist, never a serialized private fact. Private facts can advance the sequence without a public
event; consumers must not interpret every numerical gap as lost public data. Bootstrap installs the approved
current state through its sequence, without replaying ceremonies. Ephemeral chat, seat state and private replies
have their own channels; no ordinary chat transcript enters storage or replay.

`packages/world/src/realm/reducer.ts` exports `createRealmState`, `decideRealm`, `applyRealmFact` and
`projectRealmFact`. The room supplies authenticated capability, authoritative transaction time and current-work
checks. The pure decision returns a proposed next fact or a refusal; the repository fences, commits and only then
installs/publishes it. The reducer has no clocks, IO or renderer. Replay applies the same contiguous fact stream.

Authority rules the first consumers must preserve:

1. Actual allocation receipts and a founded layout establish a home. The global three-home limit belongs to the
   transactional allocation service; a per-kingdom reducer alone cannot enforce it. Guests do not earn coal.
2. Rights, current live stream and actual owned home are prerequisites for a Forge reservation. Qualification is
   the union of evidenced closed presence intervals: at least 600,000 ms in that stream, once per night, cap three
   held coals including reserved ones. Recovered roster data never manufactures elapsed time.
3. Reservations bind attempt, current rights, stream, home revision and digest. Cancellation releases only that
   attempt; terminal outcomes retain the wish key. Commit rechecks everything and atomically consumes one coal,
   installs the judged part, retains displaced pieces and publishes only approved fields. Both judges remain
   required. Lost commit replies are resolved by durable lookup, never guessed into refunds or success.
4. `home.replaceApproved` requires current build rights, the reviewed candidate and revision, real asset evidence
   and a disposition for each existing attachment. Publication cannot move an occupied plot or strand a walker.
5. `RealmRepository.executeIngress` commits presence checkpoint, source dedupe/outcome, capability-tagged fact
   batch and sanitized presence outbox together. Even an observation producing no domain fact advances its own
   checkpoint atomically. Source payload digests reject changed retries. Wiring owns the bounded private codec;
   server owns its persistence. No second ledger or post-commit checkpoint update.

`packages/world/src/movement/step.ts` is the shared reference `stepPlayer`: deterministic Y/X/Z swept boxes,
walk/sprint/jump and distance. Input direction is signed bytes with diagonal normalization; camera trig stays
client-only. Collision revision mismatch stops prediction/simulation until matching data is available. Full
supported 0.5 m auto-step, corner refinement and overlap recovery belong to the walking lane on this same step.

## Reference consumer and composition

`apps/realm/src/kingdom-room.ts:createKingdomRoom(services)` is the thin actual Colyseus consumer. The main-owned
in-process boundary is `apps/realm/src/ports.ts`: `RealmRoomServices` supplies authentication and the exclusive
room handle; `RealmRoomHandle` supplies intent handling, bootstrap, committed subscriptions, transient/private
delivery, lifecycle and disposal. `RealmRoomEffects` reads/places walkers, permits locomotion and atomically adopts
committed geometry/collision revisions with supported, clear poses. `close` irreversibly stops the old room on
writer loss; `recoverWalker` asks the current authority for a safe anchor at the current collision revision,
without releasing an interaction lease. Public deliveries carry an independent monotonic `cursor`; bootstrap
installs `throughCursor`, including presence changes that do not advance domain `throughSequence`. Awaited
admission rechecks `RealmIntentContext.current()`.
Only sitting suppresses walking; an interior still permits walking to its exit.

`apps/web/src/realm/client.ts:connectRealm` consumes `RealmEntry { kingdomId, resumeScope, ticket() }` plus the
matching collision world. Entry tries the saved reconnect token first; only fresh entry calls the factory for
a new single-use ticket. The API's opaque session scope partitions storage without exposing an identity or
credential. Tickets are never persisted or used as storage keys. It uses SDK
Predict for local reconciliation and 250 ms remote interpolation, with an 80 ms local correction time constant.
Tick, stage the returned input count, then read render poses. Reload tokens are tab-scoped and rotated after SDK
reconnect completes. Authentication, presence and durable action decisions never run in the renderer.

The explicitly SIMULATED reference service and `/-/realm` court exercise this transport with actual separate
browser clients. They do not implement live deeds, durable publication, auto-step, shoulder camera, interiors or
the finished kingdom. `apps/realm/src/main.ts` refuses live startup until the server lane supplies its real services;
there is no in-memory durability fallback. The `@chatdom/api` manifest reserves pinned auth dependencies, not a
fake running API.

Two small versioned MIT dependency patches are required for `k:<id>`: SDK reconnect splits its opaque token at
the last colon; uWS accepts a colon in the room URL segment. Preserve their pnpm registrations and license notices.
The real SDK test covers explicit reload on this room ID. Automatic reconnect/failure cases continue in RS05.

## Handoff and write ownership

All four lanes start from this frozen boundary; their PRDs describe independent worker folders and dependencies.

| Lane / spec | Owns | Shared-file grant |
|---|---|---|
| `realm-server` / 34 | Postgres, OIDC/API entry, allocation, ingress/outbox, recovery, districts and 300 actual input clients | Realm server/main boot; API bootstrap/scripts; narrow room district/lifecycle/rate/recovery hunks |
| `walk-controller` / 35 | Shared movement implementation, walking input/camera and collision feel | Client movement/Predict/revision/input staging only; auth/join/reconnect/storage remain main-owned |
| `realm-wiring` / 36 | Room adapters for existing presence/build/Forge; browser adapters; new Herald sink | No shared entrypoint edits; exact installation recipes for integrator |
| `interactions` / 37 | Pure interaction rules, room leases/host adapters and contextual use UI | No room/scene edits; consumes existing lifecycle/effects and supplies integrator recipes |

Server persistence/auth, walking solver/input/camera and interaction registry/selection can proceed together.
Wiring's client/bootstrap adapters can begin immediately; durable end-to-end acceptance waits for the actual
repository and ownership producers. The integrator alone composes scene, worker, content, collision and camera
call sites. Main retains shared contracts, private domain reducer, authority decisions and final judgement.
LayerRoom, DraftRoom and MatchRoom are reserved roles, not additional implementations in this slice.

## Acceptance and operation

```sh
pnpm install --frozen-lockfile
pnpm verify --area kingdom --tier town --hour dusk --size phone
pnpm --filter @chatdom/realm build
REALM_SIMULATED=1 pnpm --filter @chatdom/realm start
pnpm --filter @chatdom/web preview
pnpm realm:smoke
```

The two servers run in separate terminals: realm 5191, preview 5190. `pnpm realm:smoke` acquires the machine capture
lock, opens three isolated browsers on `/-/realm`, asserts three distinct walkers and movement observed in all
three, reloads one without duplicating it, and captures 1440×900/390×844 serially. Main inspected both saved
`shots/realm/three-walkers@…png` frames and the ordinary dusk phone shot. One contract scenario checks strict
input/privacy, one domain scenario covers the coal/Forge/replay boundary, and the real uWS/SDK test covers movement
and colon-ID reconnect. Full verification passed 1,278 tests in 85 files at freeze.

This proves the executable contract, not finished walking feel or 300-walker capacity. Spec 34 requires the real
300-client input/patch/district run; specs 35–37 require the actual kingdom walk and production composition.
Their final shots and walkthrough must meet the genre bar: warm streets and horizon worth walking toward,
immediate movement, readable people and a camera that never feels like operating a surveillance rig.

## Decisions

- 2026-10-30: Keep small kingdoms in KingdomRoom at 30 Hz movement/5 Hz patches, with 300 walkers as this
  consumer's tested-capacity target. Passive chat presence adds no walker socket. Later room roles preserve one
  kingdom writer; no premature room partition substitutes for measuring the actual predicted path.
- 2026-10-30: E means interact. Older Q/E orbit and F-use prose does not override this brief. Mouse drag and
  optional pointer lock coexist with free-cursor walking and immediately releasable UI ownership.
- 2026-10-30: Freeze the real contracts and the tested thin consumer now; hand the production volume to the four
  lanes. An isolated court cannot pass acceptance for the walkable kingdom, and missing providers cannot pass as
  a live approved Forge run.
