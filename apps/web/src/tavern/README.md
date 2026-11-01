# The tavern interior

The tavern is a portal destination. Its kingdom exterior is unchanged. The independent interior lives in the
`tavern` room filtered by `kingdomId`; the campfire continues to live in `kingdom`.

`mountTavern(scene, { style, phone })` installs the room and its public game miniatures. Its `kit` exposes local
collision, table, chair and approach positions. `update` takes local feet, camera and hour. It fades the nearest
wall; the interior has no roof. `games` consumes an already public `GatherFrame`, never server game state.

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
- The caller supplies `open()` and `requestInput(canvas, reason)`. The game consumes the supplied input lease;
  play still owns session transfer, the single active destination surface and the integrated pointer lock.
- Pong predicts only the local paddle. The ball follows buffered public server snapshots. Network stalls hold the
  last witnessed path; a terminal server result appears immediately. The new public schemas never admit RNG or
  paddle targets. See `work/evidence/gather/ga10-pong.md` for the measured limits.
- Stones and Hearth Dice save before publishing an accepted move. Migration `0016` stores versioned checkpoints
  and immutable accepted commands atomically. The production entrypoint installs the Postgres store using its
  existing pool; the reference harness explicitly installs a memory store. Missing storage cannot start a turn game.
- Restart restores exact turn state, deadline and private dice cursor. Original participants reserve their chairs
  for thirty seconds but must physically reseat before playing. Nobody returning produces a draw; a remaining
  participant wins by concession. Pong restart interrupts without a winner. Terminal Pong points save before
  publication. See `work/evidence/gather/ga10-turn-games.md` for failure and SQL evidence limits.

GA10 remains open. Still required: play's generic portal transfer and safe return, approved exterior door anchors,
full database-authenticated matches and portal evidence, durable result/tally integration, full browser restart/reconnect evidence,
sound and real-GPU acceptance with eight walkers. See the lane PRD and `SEAMS.md`.

The connected-browser checkpoint is demonstrated by `work/evidence/gather/ga10-pong-browser-match.json` and
the two `ga10-pong-live` stills. One browser and two SDK clients completed a 1–7 match, with the same spectator
result and server-confirmed browser paddle input. The sessions are temporary memory-only reference sessions;
they do not prove tobi4s_'s database session or a portal transfer. The remaining cropped opponent framing and
flat room treatment are documented in `work/evidence/gather/ga10-pong.md`.

## Focused checks

Run under `nice -n 10`:

```sh
pnpm exec tsc -p work/lanes/gather/tsconfig.json
pnpm exec eslint apps/realm/src/games apps/realm/src/server.ts apps/web/src/tavern apps/web/src/games packages/content/src/tavern packages/shared/src/games.ts
pnpm exec vitest run apps/realm/src/games apps/web/src/games packages/content/src/tavern
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

The turn-game harness follows the same path with native carved controls. The SQL check requires its pinned
external embedded engine under `/tmp` (installation is in the runner header). It executes the exact migration and
production store and closes/reopens file-backed game checkpoints. It is not a pgwire, pool, multibackend or crash
test. The eight opt-in native SQL tests require `GATHER_DATABASE_TESTS=1` and `DATABASE_URL`; they create and
drop only a random test schema. No database credentials are printed.

Real GPU: `chatdom-pc-lease --wait 0 --max 3 -- bash apps/web/src/tavern/capture-gpu.sh`. The lease owns 5192.
These are empty-room studies; its frame-time result cannot satisfy the eight-walker game acceptance.
