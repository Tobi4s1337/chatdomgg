# The tavern interior

The tavern is a portal destination. Its kingdom exterior is unchanged. The independent interior lives in the
`tavern` room filtered by `kingdomId`; the campfire continues to live in `kingdom`.

`mountTavern(scene, { style, phone })` installs the room and its public game miniatures. Its `kit` exposes local
collision, table, chair and approach positions. `update` takes local feet, camera and hour. Exterior study cameras
cut away the nearest wall; cameras inside keep the enclosing walls and doorway. The interior has no roof.
`games` consumes an already public `GatherFrame`, never server game state.

`/-/tavern?view=room|bar|table&style=hearth|tide&hour=19&still=1` is a room study using that same mount. Its buttons
inspect camera compositions. It does not claim a game seat, transfer a walker or stage people. An empty table
does not show an invented match. The working room/seat transport is tested separately in the realm.

## Current checkpoint

- The room, its furniture, lamps, five tables and twelve chair approaches are authored in both civic styles.
- The middle table plays Pong, the hearth table plays Hearth Dice with two to four players, and the other three
  tables play Stones. Boards show only witnessed public state; empty tables have no invented moves or dice.
- The realm registers `tavern`, authenticates through the existing entry service, moves its own walkers against
  interior collision and claims chairs through the existing interaction authority.
- Pong runs in that room at 30 Hz. Physical seats authorize game input; public snapshots omit serve RNG and
  paddle targets. Duplicate starts and inputs are fenced. Closing the room interrupts rather than awards a win.
- Socket tests use explicit local reference authentication, not the database-backed session service. Separate
  multiplayer scripts complete each game with a browser participant and two SDK clients. This proves actual
  room movement, chairs, moves and spectator agreement, not production identity or portal continuity.
- `connectTavern(endpoint, entry, storage?)` consumes a fresh destination ticket, validates the interior and public
  frames, and adapts the same retained room to the existing movement predictor and interaction binding. It keeps
  a distinct reconnect partition. `TavernRoomSurface` composes the existing walk/citizen/camera owners around that
  connection. It hides the local body at the board and draws actual peers and authoritative table miniatures.
- The caller supplies `open()`, `requestInput(canvas, reason)` and its existing `KingdomAudio` as `audio`.
  The game consumes the supplied input lease;
  play still owns session transfer, the single active destination surface and the integrated pointer lock.
- The lease receives a dedicated transparent input canvas, not another renderer. Walking releases its own
  canvas without cancelling the seated lock. Stones consumes motion/arrows, click/Enter and direct 1–7;
  Dice consumes click/R and right-click/H. Enter/Space starts a ready table. E/Esc still use the interaction
  owner. The local adapter ignores held buttons inherited from a previous lease and filters typing and repeats.
- Disconnect retires input immediately; fresh state and a complete matching-writer bootstrap gate chair
  restoration. Rotated tokens persist in the caller's reconnect partition. Terminal leave clears the token and
  offers a real fresh `open()` retry. A failed scene initialization is recreated on retry; a healthy scene is reused.
- Pong predicts only the local paddle. The ball follows buffered public server snapshots. Network stalls hold the
  last witnessed path; a terminal server result appears immediately. The new public schemas never admit RNG or
  paddle targets. See `work/evidence/gather/ga10-pong.md` for the measured limits.
- Seated framing fits every actual board after collision clearance at both standard sizes, including the four
  Dice chairs. Flat boards keep the chair's axis and are seen as a seated player sees a table (about 30° down on
  desktop, 50° on a phone), with the whole head of whoever sits across in the fit. The independent scene bakes four localized warm sources
  without adding GPU lights, and exterior views cut away the nearest wall with hysteresis instead of a screen-door fade.
- The caller retains one common audio mixer across destinations. Original finite wood, stone, cup and brass
  sounds follow public accepted actions; actual Pong contacts use the board's buffered timeline. The hearth
  and abstract room air follow the room's real occupancy. No speech or pretend patrons are added. Mute, hide,
  disconnect and unmount retire owned sources; unmute baselines current state without replaying moves.
  The separate local inspection route owns its own locked mixer and exposes a sound control. See
  `audio/README.md` for the host, timing, budgets and original material provenance.
- Stones and Hearth Dice save before publishing an accepted move. Migration `0016` stores versioned checkpoints
  and immutable accepted commands atomically. The production entrypoint installs the Postgres store using its
  existing pool; the reference harness explicitly installs a memory store. Missing storage cannot start a turn game.
- Restart restores exact turn state, deadline and private dice cursor. Original participants reserve their chairs
  for thirty seconds but must physically reseat before playing. Nobody returning produces a draw; a remaining
  participant wins by concession. Pong restart interrupts without a winner. Terminal Pong points save before
  publication. See `work/evidence/gather/ga10-turn-games.md` for failure and SQL evidence limits.
- The door is a walk-through portal (`TavernPortal`, `SEAMS.md` §1). `tavernPortalFor(kingdomId, scene, world)`
  derives the exterior doorway and a supported return anchor, facing out, from the installed tavern and its
  collision. The tavern room watches the interior doorway and tells only the walker who crossed it; the surface
  hands that to its `leave` option. The kingdom-side transfer and return belong to play.

GA10 remains open. Still required: play's generic portal transfer and safe return using the descriptor,
full database-authenticated matches and portal evidence, durable result/tally integration, remaining browser failure-path and database restart evidence,
headphone mix review and real-GPU acceptance with eight walkers. The later populated phone check shares Pong
marks and ball in one batch: eight reference clients and three simultaneous games produce 11 room draws plus
62 common citizen draws, 73 total. This establishes the room contribution only. The destination's name layout
now measures complete names, keeps them above their actual heads, and suppresses edge/collision conflicts with
nearest-person priority. It retains full public text rather than wrapping or abbreviating it. See
`work/evidence/gather/ga10-names.md` for the layout and rendered-rectangle checks.
The browser's west-chair-2 approach is blocked after three failures; the SDK obtains that same chair.
See `work/evidence/gather/ga10-room-budget.md`, the lane PRD and `SEAMS.md` for evidence and limits.

`work/evidence/gather/ga10-input-recovery.md` records the locked controls, actual cut/reconnect and page-refresh
proof, the packet-order regressions, and their limits. The controlled same-person replacement experiment is
blocked after three failures; its skipped reproduction is not passing session-continuity evidence.

The connected-browser checkpoint is demonstrated by `work/evidence/gather/ga10-pong-browser-match.json` and
the two `ga10-pong-live` stills. One browser and two SDK clients completed a 1–7 match, with the same spectator
result and server-confirmed browser paddle input. The sessions are temporary memory-only reference sessions;
they do not prove tobi4s_'s database session or a portal transfer. Those older stills predate the current framing
and lighting checkpoint; the current evidence and remaining limits are in `work/evidence/gather/ga10-feel.md`.

## Focused checks

Run under `nice -n 10`:

```sh
pnpm exec tsc -p work/lanes/gather/tsconfig.json
pnpm exec eslint apps/realm/src/games apps/realm/src/server.ts apps/web/src/tavern apps/web/src/games packages/content/src/tavern packages/shared/src/games.ts
pnpm exec vitest run apps/realm/src/games apps/web/src/games apps/web/src/tavern packages/content/src/tavern
node --test apps/web/src/games/local-listener.test.mjs
pnpm --filter @chatdom/realm build
pnpm --filter @chatdom/web build
node apps/realm/src/games/bench.mjs
node apps/web/src/games/two-walkers.mjs
GATHER_GAME=stones node apps/web/src/games/turn-walkers.mjs
GATHER_GAME=hearth-dice node apps/web/src/games/turn-walkers.mjs
node apps/realm/src/games/sql-check.mjs
```

The socket test probes an approved free port, preferring 5182, and stops only its own server. For short, serial stills, check a free approved
port first, then run `GATHER_CAPTURE_PORT=5173 node apps/web/src/tavern/capture.mjs`. It holds the shared capture
lock, starts an owned preview, checks browser errors/overflow, saves stills and scene costs, then stops the preview.
It never measures performance from software rendering.

The multiplayer script requires a built web app. It acquires the capture lock, chooses free own ports, creates
temporary test sessions, walks the actual clients, tests input and a complete match, and saves public evidence
before stopping its services. Its browser route is `/-/tavern?testWalker=1&seat=tavern:middle:seat:2` against
its own `/live-realm-data` proxy. The route refuses non-loopback hosts/endpoints and non-test rooms. It cannot
issue production entry tickets, alter a live actor, teleport a body or grant a chair.

The turn-game harness follows the same path with native carved controls by default. Set `GATHER_INPUT=locked`
to exercise real pointer lock, keys and mouse actions, and `GATHER_RECONNECT=1` to sever the browser socket,
restore the chair and reload using the rotated token. The loopback-only entry uses sessionStorage with a stable
test partition; it does not stand in for a production session issuer. Pong also accepts `GATHER_INPUT=locked`.
Input and recovery evidence is recorded separately from the earlier native-control proofs.
`GATHER_EVIDENCE=ga10-pong-framed` (or the corresponding turn-game prefix) keeps a new run's evidence separate.
`GATHER_WEB_DIST=/absolute/path/to/private/build` previews a frozen private build without sharing `apps/web/dist`.
`GATHER_HOST=127.0.0.10` selects the second explicitly permitted loopback host when other lanes occupy `.1`;
it still probes only 5170–5189, excluding reserved 5187, and never touches their services. The local test-entry
route permits only the exact configured loopback names/addresses, never a remote issuer or production origin.
Each script takes one still per capture lease. `GATHER_VIEWPORT=desktop|phone` selects the standard size;
run the other size separately with a distinct `GATHER_EVIDENCE` prefix. The room-study script also accepts
`GATHER_VIEW=room|bar|table`. The old appended `GATHER_ROOM_STUDIES=1` series is refused; use separate calls.
The multiplayer scripts share `games/local-listener.mjs`: the installed transport drops its hostname argument,
so the operator forwards only its own native listen setup through the explicit host overload and checks the bind.
This keeps the probed address and actual listener aligned while retaining the transport's own shutdown resource.
`GATHER_WEB_DIST=/absolute/build GATHER_HOST=127.0.0.10 node apps/web/src/games/populated-room.mjs` checks eight
connected reference clients, three simultaneous live games and actual room/citizen draw contributions. Its
default is one phone still; use `GATHER_VIEWPORT=desktop` in a separate lease for the other size. It still uses
memory-only test sessions and does not establish identity, portal or GPU acceptance.
The multiplayer harnesses also inspect accepted sound cues and exercise the actual mute/enable control after
standing. `nice -n 10 node apps/web/src/tavern/sound-study/run.mjs` renders the original materials through the
common mixer into a 13-second WAV with numeric silence/resume checks; it does not claim headphone listening.

The SQL check requires its pinned
external embedded engine under `/tmp` (installation is in the runner header). It executes the exact migration and
production store and closes/reopens file-backed game checkpoints. It is not a pgwire, pool, multibackend or crash
test. The eight opt-in native SQL tests require `GATHER_DATABASE_TESTS=1` and `DATABASE_URL`; they create and
drop only a random test schema. No database credentials are printed.

Real GPU: `chatdom-pc-lease --wait 0 --max 3 -- bash apps/web/src/tavern/capture-gpu.sh`. The lease owns 5192.
These are empty-room studies; its frame-time result cannot satisfy the eight-walker game acceptance.
