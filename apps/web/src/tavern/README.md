# The tavern interior

The tavern is a portal destination. Its kingdom exterior is unchanged. The independent interior lives in the
`tavern` room filtered by `kingdomId`; the campfire continues to live in `kingdom`.

`mountTavern(scene, { style, phone })` installs the room and its public Pong miniature. Its `kit` exposes local
collision, table, chair and approach positions. `update` takes local feet, camera and hour. It fades the nearest
wall; the interior has no roof. `games` consumes an already public `GatherFrame`, never server game state.

`/-/tavern?view=room|bar|table&style=hearth|tide&hour=19&still=1` is a room study using that same mount. Its buttons
inspect camera compositions. It does not claim a game seat, transfer a walker or stage people. An empty table
does not show an invented match. The working room/seat transport is tested separately in the realm.

## Current checkpoint

- The room, its furniture, lamps, five tables and all ten chair approaches are authored in both civic styles.
- The realm registers `tavern`, authenticates through the existing entry service, moves its own walkers against
  interior collision and claims chairs through the existing interaction authority.
- Pong runs in that room at 30 Hz. Physical seats authorize game input; public snapshots omit serve RNG and
  paddle targets. Duplicate starts and inputs are fenced. Closing the room interrupts rather than awards a win.
- Socket tests use explicit local reference authentication, not the database-backed session service. They prove
  movement, two chairs, a started game and unseated-input rejection, not GA10's complete live match requirement.

GA10 remains open. Still required: play's generic portal transfer and safe return, approved exterior door anchors,
browser walker/game input, predicted paddle and buffered ball rendering, full authenticated matches and spectator
evidence, latency measurements, Stones, Hearth Dice, durable turn games/results, restart/reconnect evidence,
sound and real-GPU acceptance with eight walkers. See the lane PRD and `SEAMS.md`.

## Focused checks

Run under `nice -n 10`:

```sh
pnpm exec tsc -p work/lanes/gather/tsconfig.json
pnpm exec eslint apps/realm/src/games apps/realm/src/server.ts apps/web/src/tavern packages/content/src/tavern packages/shared/src/games.ts
pnpm exec vitest run apps/realm/src/games packages/content/src/tavern
pnpm --filter @chatdom/realm build
pnpm --filter @chatdom/web build
```

The socket test needs free port 5182 and stops only its own server. For short, serial stills, check a free approved
port first, then run `GATHER_CAPTURE_PORT=5173 node apps/web/src/tavern/capture.mjs`. It holds the shared capture
lock, starts an owned preview, checks browser errors/overflow, saves stills and scene costs, then stops the preview.
It never measures performance from software rendering.

Real GPU: `chatdom-pc-lease --wait 0 --max 3 -- bash apps/web/src/tavern/capture-gpu.sh`. The lease owns 5192.
These are empty-room studies; its frame-time result cannot satisfy the eight-walker game acceptance.
