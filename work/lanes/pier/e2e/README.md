# PI10 end to end on the lane's own stack

This is the PI10 "done when" check, run against the real code: a signed-in walker walks onto the pier, takes a rod,
catches a fish and sees it in the bag with its story. Then the realm restarts and the fish is still there. A second
walker in the same room sees the first walker's line and catch.

## Run it

```bash
work/lanes/pier/e2e/run.sh
```

`run.sh` loads `DATABASE_URL` from `/srv/chatdom/chatdomgg/.env` without echoing it. To use another file,
set `PIER_E2E_ENV_FILE`. The script pins `REALM_DATABASE_SCHEMA=pier` and runs everything at `nice -n 10`. It writes:

- `work/evidence/pier/pi10-e2e-run.json`: every step with its timing, the scene identities, the routes walked, every
  beat of the kept cast and every request the fisher sent, the fish and its bag record and history, what the
  observer saw, and the checks made after the restart.
- `work/evidence/pier/pi10-e2e-run.log`: the console log. The connection string is scrubbed from it. `*.log` is
  ignored by git, so add it with `git add -f`.
- A failed run writes `pi10-e2e-run-failed.json` and `.log` instead, so it never replaces the last passing evidence.

On this shared host a run takes 15 to 25 minutes. Most of that time goes on opening the kingdom (see the findings
below). You can change these settings:

| Setting | Default | What it does |
|---|---|---|
| `PIER_E2E_FISHER`, `PIER_E2E_OBSERVER` | `990100001` (Wren), `990100002` (Tamsin) | The simulated people who sign in |
| `PIER_E2E_MAX_CASTS`, `PIER_E2E_MAX_FISHING_MS` | 12, 6 min | Caps on retrying casts that end snapped, escaped or missed |
| `PIER_E2E_JOIN_ATTEMPTS` | 30 | Join attempts while the kingdom cannot open within its writer lease |
| `PIER_E2E_PORT_WAIT_MS` | 30 min | How long to wait for two free ports in 5170–5186 |
| `PIER_E2E_SKIP_BUILD=1` | off | Reuses `apps/realm/dist` and `apps/api/dist` |
| `PIER_E2E_STACK` | `/tmp/chatdom-pier-stack` | The founded directory, the source copy and the server logs. It must be outside the repo. |
| `PIER_FOUNDED_SCENE`, `PIER_FOUNDED_MANIFEST` | `/tmp/chatdom-pier-founded/scene.json`, `/tmp/chatdom-pier-founded-manifest.json` | The hash-checked copy of tobi4s_'s live founded scene |

**Ports.** The run uses two free ports in 5170–5186: one for the realm and one for the API. It checks each port with
a bind test (127.0.0.1 and 0.0.0.0) right before use, waits while fewer than two are free, and tries again if another
lane takes a port first. It never uses 5187 or 5190–5199. Both servers bind 127.0.0.1 only and are stopped at the
end, whether the run passes or fails. The JSON records which ports the run used. The passing run of 2 November used
realm 5173 and API 5182.

## What it runs

The stack contains no mocks:

1. **Source scene.** The run checks the copied scene against the SHA-256 in its live receipt, so it is known to be
   tobi4s_'s founded scene (kingdom 129634568, `settlement:2:43cffdb6`, 1197 placements, no pier).
2. **Postgres.** It runs `apps/realm/scripts/migrate.mjs --schema pier`. Then the realm's own `AllocationService`
   adopts the copied scene's exact `SettlementPlan` for kingdom 129634568 as a simulated-origin layout in `pier`.
   This is idempotent: a later run answers `unchanged`. That is the only row the run writes itself, and it never
   touches any other schema. There is no founded-directory format to seed. The realm assembles, stores and serves
   its own scene bytes in `REALM_FOUNDED_DIRECTORY` (`native/`, `revisions/`, `scenes/`). The run keeps a copy of
   the source scene in `$PIER_E2E_STACK/source/` for provenance only.
3. **Realm.** It runs `apps/realm/dist/realm.mjs` with `REALM_SIMULATED=1`, `REALM_STORAGE=postgres`,
   `REALM_PIER_FISHING=1`, `REALM_FOUNDED_DIRECTORY`, `REALM_HOST=127.0.0.1`, `REALM_PORT` and a fresh random
   `REALM_EVIDENCE_KEY` for each run. It passes no ingress secrets.
4. **API.** It runs `apps/api/dist/api.mjs` with `REALM_AUTH_MODE=simulated` and `REALM_PUBLIC_ORIGIN` set to its own
   loopback origin. The child processes receive only `PATH`, `HOME`, `DATABASE_URL`, the schema and their own
   settings, and nothing else from the environment file.
5. **Sign-in.** Wren and Tamsin each sign in through the real HTTP OIDC flow with their own cookie jar:
   `auth/start`, the simulated chooser, `approve`, then `callback` and `session`. Each fresh join then asks for its
   own ticket with `Origin` and `X-CSRF-Token`.
6. **Joining.** The walkers join through the browser's own `connectRealm` (`apps/web/src/realm/client.ts`), with
   Colyseus `Predict` ticking at 60 Hz. The run reads the scene the realm serves through the founded receipt and its
   hash-addressed bytes, verifies it, and compiles it with the shared `compileFoundedScene`.
7. **Walking.** Walking only ever sends the real `RealmWalkInput`. Routes are planned by weighted A* over half-metre
   cells, on the same collision world the room steps (`route.ts`). Each route is first proven offline with
   `stepPlayer` and the same steering, then walked live, sprinting. Wren goes from the market arrival to the rod rack,
   about 290 m. Tamsin goes to the bank beside the pier landing.
8. **Fishing.** The run uses the browser's `createFishingController` over `fishingLink(room)` and `itemLink(room)`.
   Wren takes the rod at the rack, walks to the lip, turns to face the water, and fishes with the review bench's fair
   player (`apps/web/src/fishing/play-bench.ts` `player`). The policy is the same: draw after 2.2 s idle, release
   after 900 ms, strike 260 ms after the dip, and reel unless the fish runs or the tension is above 6500. A cast that
   ends snapped, escaped or missed is cast again. The catch is kept automatically at landing.
9. **The bag.** It reads `items.list` pages until the cursor ends, then `items.history` for the fish.
10. **Restart.** All walkers leave, the realm gets SIGTERM, and it starts again on the same schema and founded
    directory. Wren signs in afresh in a new cookie jar, gets a new ticket and a new walker entry, and reads the bag
    again.

## What it proves (and checks)

- The realm serves the copied plan exactly, with the six `pier:lake:*` pieces added. The pier site and rack come
  from the room's own `pier.state`.
- Wren really walks onto the pier. Every tick of the route was stepped by the room, because the client only sends
  inputs. The rod is granted at the rack: the server refuses a first grant away from it. It lands in hotbar slot 0
  with its story.
- Wren stands grounded on the lip at the current collision revision, facing the water. The server checks all of this
  on every cast.
- A fish is kept: the `pier.kept` reply arrives after the catch row and the item row commit in one transaction.
- The bag holds that item with its definition (title and lore from the catalogue) and its story: who (the simulated
  person id and approved name), the kingdom, where, when, and the line. Its history shows the `granted` event.
- Tamsin, a different person and walker in the same room, receives Wren's `pier.rod`, every public beat of the kept
  cast (draw, cast, float, nibbles, bite, hook, pressure, landing), the `pier.casts` line with its float on the water,
  and `pier.caught` with the same species and weight. Wren's walker is also in Tamsin's room state at the lip.
- After the restart, the bag record is byte-identical: the same id, definition, count, story, source, detail and
  history. The rod is still in the same hotbar slot, and the realm serves the same scene hash.

## What it does not prove

- **The homes are not the live ones.** The realm builds its own scene from the adopted plan and its own committed
  state, and no live private state is copied. Homes that the live kingdom has replaced or forged are therefore
  native here: 1033 of the 1197 live placements are identical.
- **The kingdom has no name.** It has no approved name in this stack (`REALM_ENTRY_KINGDOM_NAME` is unset), so the
  story's `where` is "the pier".
- **The rod is only granted at the rack on a fresh schema.** It is granted once per person, kingdom and origin, so
  later runs on the same schema find Wren's rod already held. The JSON records this as `rodAlreadyHeldBeforeRun`.
  Common fish also stack after a person's first catch of a species.
- **Nothing is drawn.** There is no rendering, sound or GPU check here; those are the PI10 stills and clip.

## Findings while building it

- **A cold kingdom open outlasts the writer lease on this host.** `apps/realm/src/founded/provider.ts` `stage()`
  assembles the scene and runs `createFoundedWorld` (`compileFoundedScene` and spawn anchors) inside the 15 s writer
  lease that `DurableKingdom.open` holds (`apps/realm/src/persistence/kingdom.ts`). On this host that work blocks the
  event loop for 37–100 s cold and 19–45 s warm, so the open fails with "The writer lease … is no longer held". It
  took 10 attempts before the restart and 5 after it. The pier adds about 0.5 s of that (`pierFurnishings`). The
  registry also closes the kingdom when the last hold is released, so every manifest read without a seated walker
  pays the full cost again. The run therefore seats Wren first, which keeps the kingdom open, and retries the join.
  The fix belongs to the realm: compile the founded world in `loader.prepare()`, outside the writer, keyed by
  geometry digest; or compile it in chunks or off-thread.
- **A slow open can leave the kingdom unjoinable until the realm restarts.** `apps/realm/src/kingdom-room.ts` `onCreate`
  awaits `services.open(kingdomId)` before it sets `this.roomId`. When the open is slow (an 18.7 s open in one run),
  Colyseus rejects the late assignment with "'roomId' can only be overridden upon room creation". The room hold that
  the open just took is then never released. Every later join answers 409 "This kingdom is already open on this
  server" until the realm restarts. The fix is to set `roomId` before the await, since it is known from the parsed
  kingdom id, and to release the handle if `onCreate` fails after opening. The run detects the 409, restarts the
  realm and records it under `recoveries`.
- **One early connection can stop the realm from starting.** `apps/realm/src/main.ts` `serve()` holds the realm port
  with a bare `net` server while it boots, and `release()` waits on `reservation.close()`. Any TCP connection
  accepted during boot is never destroyed, for example a health probe or a browser retry. Such a connection keeps
  `close()` pending forever, so the realm never listens. The fix is
  `reservation.on('connection', socket => socket.destroy())`. The run works around it by probing only after the realm
  logs that it is listening.
- **A second press during the bite can lose the fish.** With real latency, a second `press()` while the bite's
  strike is still in flight sends a second `pier.strike`.
  `apps/realm/src/fishing/cast.ts` (the `pier.strike` branch) then ends the now-fighting cast with "The hook came
  back empty.", and the room reports it as `missed`. The fair player presses on every frame of the bite, and so does
  a person who clicks twice. The first cast of the 2 November run was lost this way: a `hook` beat was followed 55 ms
  later by `ended missed`. The controller should send one strike per cast (`apps/web/src/fishing/controller.ts`
  `press()`), and the server could treat a repeated strike on its own fighting cast as a reel. The run records every
  request it sends (`catch.fisherRequests`), so the double strike can be seen.

## Files

- `run.sh` loads the environment and runs the check.
- `pi10-e2e.mjs` is the orchestrator. It handles ports, the build, migration, adoption, both servers, the restart and
  the evidence.
- `drive.ts` holds the walkers: the browser cookie jar and sign-in, the scene read, the joins, walking, the fair
  player, the bag and the observer.
- `route.ts` plans routes on the collision world and proves them offline with the movement law.
