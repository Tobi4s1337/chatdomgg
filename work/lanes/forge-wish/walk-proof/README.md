# FW10 walk proof: wishes typed into the wish box in the walk

This private harness covers the FW10 done-when line "At least 3 of those wishes were typed into the wish box in the
walk of a served build."

For each wish, a citizen signs in, stands in the kingdom walk of a production build of `apps/web`, presses E at the
market anvil and types the wish into the real Forge wish box ("What would you like to make?") with real keystrokes.
The citizen then presses **Send wish to chat** and the box follows the wish until it shows the outcome. The wish
goes through the production Forge chat service, the Herald-shaped intake, the evening bridge and the Forge
authority. It becomes a piece on the citizen's home in a durable realm (PostgreSQL schema `realm_forge_wish`),
paid for with one coal earned by qualified presence.

## What is real and what is SIMULATED

Real:

- The kingdom entry (`apps/web/src/kingdom-entry`) over `createLiveKingdomEntrySource`, in the production build.
- The founded scene, the KingdomRoom walk, the anvil interaction (`attachEveningInteractions`), E, the wish box and
  its same-origin transport.
- The realm-auth HTTP handler and session, the ticket and the realm authenticator.
- The Forge chat service and its routes (`createForgeChatService`, `mountForgeChatRoutes`), with encrypted grants
  in its PostgreSQL store.
- The Herald routes (`INGRESS_ROUTE` and `REALM_HERALD_ROUTE`, with a Bearer secret), the evening bridge, the Forge
  authority, the coal ledger and the durable commit.

SIMULATED:

- **Sign-in.** The realm-auth SIMULATED OpenID provider is used. The chooser's first button is pointed at the
  citizen's fresh simulated id (990100007–990199999). The private harness suppresses the entry notice.
- **Twitch.** The Forge chat service is given a simulated `fetch`. It answers token validation and Send Chat
  Message for this run's own grants, and refuses everything else. A sent `!forge` message is played back as the
  Herald would play it: first a chat witness, then the Herald-shaped wish built from the exact text the box sent.
  Nothing reaches Twitch:
  - The process-wide `fetch` refuses any `*.twitch.tv` host.
  - Chrome aborts any `twitch.tv` request.
- **The chat grant.** A ready grant is stored for each citizen, as the PostgreSQL tests do, so the box goes
  straight to the wish field without the OAuth consent step.
- **The stream and presence.** An authenticated SIMULATED stream starts eleven minutes back and is kept live by
  heartbeats. One qualified night earns each citizen one coal through the seed helpers (`runtime/seed.ts`).
- **The walk to the anvil (and to the home).** The walker is placed within reach of the anvil through the
  kingdom's own walker placement, the seam its recovery uses. The proof observes that seam by wrapping the room
  effects that the kingdom hands its interaction authority.
  - The spot is chosen on the side the camera already looks from, so no turn is needed.
  - If no such spot is clear, the walker goes to the anvil's approach and the camera is turned with a real mouse
    drag.
  - A long walk under SwiftShader is not part of this proof.

  The box is opened by pressing **E**, once the walk's own interaction focus is the anvil. It is not opened from
  code: the wish box has no HUD slot in the kingdom walk yet, and `openForge` is not reachable from the built
  page.

  With `--landed-still`, a later hold places the walker in front of the citizen's home, turned towards the door, for
  one still of the new piece.
- **Providers.** `--controlled` (the default) uses fixed model answers: every wish becomes a sleeping-dragon
  chimney, as in `runtime/coordinator-proof.ts`. No model is called. `--real` uses
  `createForgeProviders({ runCodex: runCodexDraft })`, as `runtime/proof.ts` does, and spends real model calls.

- **The writer lease.** The proof's realm holds its kingdom on a 60 s writer lease instead of the realm's 15 s
  (`REALM_LEASE_MS`). On this shared host at load 25 to 35, with the build and the browser driver in the same process,
  a 15 s lease lapsed with no fault in the realm. Production keeps 15 s.

## What it does not prove

- Wish quality or recognisability. Controlled runs always make the same chimney.
- The OAuth consent step, a real Twitch post, or the actual Herald process reading chat.
- Frame timing. Without `--gpu`, Chrome renders through SwiftShader; with it, stills come from a real GPU.
- Walking to the anvil through the streets.
- `forgeChat.start()`'s grant sweep. It is deliberately not run, because it would validate (and could forget)
  other simulated grants in the shared lane schema.

## Run

```sh
REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
  work/lanes/forge-wish/walk-proof/run.mjs --controlled            # default wishes: fw10-01 fw10-08 fw10-15
REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
  work/lanes/forge-wish/walk-proof/run.mjs --real fw10-01 fw10-08 fw10-15
```

- Wish ids come from `apps/codex/src/fixtures/fw10-wishes.ts`. A wish over the box limit (`FORGE_CHAT_LIMITS.words`
  in `packages/shared`, read from the worktree at run time) is refused before anything starts.
- `--landed-still` adds one hold per delivered wish, for a still of the piece on the home (`wish-<id>-landed@390x844.png`).
  It is off by default, to keep lock time down. The landed piece is always checked in the realm: one attachment
  with this wish's Forge key on the citizen's home, and one coal spent.
- `--real` first checks that this process can launch the Codex CLI. It stops further model calls after a usage
  limit.
- The run exits with code 0 only if every wish meets all of these conditions:
  - It was typed.
  - The box showed **Made in the kingdom**.
  - The realm observed `delivered`.
  - Exactly one attachment landed and exactly one coal was spent.
  - No wish words reached a public delivery.

## On the real GPU (`--gpu`)

`--gpu` runs the same proof in Tobias's real-GPU Chrome instead of headless SwiftShader. It never takes the capture
lock (nothing renders on this host). Instead each wish holds the real-GPU lease through `chatdom-pc-lease` itself: the
leased command waits until the proof removes its marker file (or exits), so the lease's own lock, its check that 5191
and 5192 are free, its 10-minute limit and its cleanup all apply. Inside the lease:

- the build is served on 127.0.0.1:5192, which his tunnel forwards, and the page opens `http://localhost:5192`;
- Playwright connects to his Chrome's DevTools port (127.0.0.1:9333, also forwarded) and opens a fresh, isolated
  browser context, which it closes before disconnecting; his own windows and profile are untouched;
- the walk runs at 1440x900; each still is also taken at 390x844;
- each wish has its own hour (`hour=` on the kingdom page): dusk (19.5), day (13), dusk;
- after the box is typed and sent, it takes a still while the gates work, then timed stills 2 to 28 s after the
  owner's delivered outcome (the ritual runs words, blueprint, pour, seal, strike, cool, flight and landed over
  21 s), then stands the citizen 5 to 14 m out from the home, turned to the door and tilted up by a real drag, for the
  landed piece at street distance (1440x900 and 390x844).

Each lease writes `trail-<label>.json`: the page's socket close codes and reasons, its outgoing frame rate, the last
outgoing frames before a close (time and size only in practice: walk inputs are one byte), and send/outcome marks.

```sh
REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
  work/lanes/forge-wish/walk-proof/run.mjs --real --gpu fw10-01 fw10-08 fw10-15
```

## The line at the anvil (`--queue`, FW11)

`--queue` runs the realm with its durable wish line (`forgeQueue`, the queue route, `evening.start()`), as
`apps/realm/src/main.ts` composes it, on controlled providers only. It holds the smith (drafting waits) so a line can
form, inside the real-GPU lease (or capture-lock hold) only, so no wish is held for minutes: the second citizen walks to
the anvil and presses E, the first citizen's wish arrives through the Herald playback, the second citizen sends theirs
from the box, and a third wish arrives behind it. The box then shows its maker **Yours is next.**,
read from `GET /api/realm/forge/queue`; the proof takes that still (1440x900 and 390x844), lets the smith work again
and, if the maker's turn comes inside the hold, takes one more (**Yours is at the anvil now.**). Outside the hold it
waits for all three outcomes: each delivered, one attachment and one coal each, in the order they arrived.

```sh
REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
  work/lanes/forge-wish/walk-proof/run.mjs --controlled --queue --gpu
```

## Flow and the capture lock

1. **Without the lock or any TCP port:**
   1. Check the schema guard: `search_path` before migrating and `current_schema()` after.
   2. Adopt a fresh random kingdom, settle one fresh citizen per wish with a native home, rights and coal, and
      start the stream.
   3. The realm listens only on a Unix socket in the private run directory.
   4. Build the web app once (`vite build` of `apps/web` with `main.tsx` replaced) into the private run directory.
2. **For each wish, one capture-lock hold** (`packages/testing/capture-lock.mjs`, priority `lane`):
   1. Probe one lane port (the first cycle chooses it and later cycles reuse it: the sign-in issuer and the Forge
      chat origin are bound to it).
   2. Start `vite preview` with the app's own proxies (`apps/web/vite.config.ts`). A plugin re-aims the realm
      entries (`CHATDOM_REALM_TARGET`: `/live-realm-data`, `/api/realm/founded|entry|watch|chronicle|clock|forge/chat`)
      at the realm's Unix socket and drops every other proxy entry. The rest of `/api` is answered in the same server
      by the realm-auth handler (sign-in, session, ticket) or refused, and `/realm-data`, `/forge-data`,
      `/map-data` and `/presence-data` are refused.
   3. Start Chrome, sign in, go to the anvil and press E. The walk renders at 390x844 (a target size). On this
      loaded host, SwiftShader runs at about 0.2 frames per second, and each 1440x900 frame takes far longer.
   4. Type the wish with real keystrokes and take one still (`wish-<id>-typed@390x844.png`). For the first wish only,
      also take a 1440x900 still, if at least 130 s of the hold remain. Then press **Send wish to chat**.
   5. Follow the box until it shows an outcome. If the hold ends first, stop once the send has settled.
   6. Close Chrome and the preview server, then release the lock.

   If the box has not shown an outcome by the end of the hold (a slow real wish), the operator waits for the realm's
   outcome with no lock or port held. It then takes one short revisit hold, where the box at the anvil shows the
   citizen's latest wish and its title is read.

   Sign-in stays inside the hold because it needs the web server's port. It takes a few seconds. The time goes on
   the kingdom loading and rendering.

**The host's capture guard.** `ops/bin/capture-guard` stops a lane's whole capture process when its lock
supervisor is older than 10 minutes while main waits (12 minutes while two lanes wait). The supervisor starts
when the queue wait starts, so queue time counts. The operator therefore:

- cuts a queue wait at 5 minutes and queues again;
- ends each hold at 285 s, or 45 s before the supervisor's 10-minute mark, whichever is earlier.

If it is stopped anyway, SIGTERM closes Chrome, the preview server and the lock and writes `summary.json`.

## Ports

Only 127.0.0.1, from 5170–5189 without 5172 and 5187, and only one per run: the web server, inside each lock hold.
The realm itself binds no TCP port. Its uWebSockets app listens on `realm.sock` in the private directory. Vite's
loader and builder run with no HMR or dev server port. Every server, Chrome and the lock close on exit, including on
SIGINT and SIGTERM. A busy host can leave no lane port free. The operator then waits 45 s inside the hold, releases
the lock and queues again a minute later.

## Private data

Everything goes to a new mode-0700 directory, `/tmp/chatdom-forge-wish/walk-proof-<uuid>/`. Its files are mode
0600, apart from the build output and Vite cache:

- `summary.json`
- `realm.json` (kingdom and people ids)
- The founded scene store
- The approvals
- The screenshots:
  - `wish-<id>-typed@390x844.png` for each wish (the box open, words typed)
  - `wish-<id>-typed@1440x900.png` for the first wish, when the hold allows it
  - `wish-<id>-landed@390x844.png` with `--landed-still`
  - `failure-<cycle>.png` and `.json` when a hold fails (the page state and a trail of failed requests and
    console warnings, with wish words redacted)

Wish words never enter a log, the console report or the repo. Rows carry fixture ids. Error text has wish words
replaced with `[wish]`. The screenshots of the typed box naturally show the words, so they stay in the private
directory.

Twitch secrets are never read. The simulated client id, client secret, token key and grants are random for each
run and live only in memory and in the encrypted grant rows.
