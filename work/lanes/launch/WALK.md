# The launch walk: chatdom.io as a first-time visitor

How it is walked: `node work/lanes/launch/walk.mjs` (headless Chrome, SwiftShader, a fresh context per step, at
1440×900 and 390×844) records console errors, failed requests and developer words on screen, and writes stills to
`shots/launch/`. To check a web fix before it is deployed, serve this checkout's build with
`node work/lanes/launch/local-door.mjs --port 5173` (any free capture port; 5172 is often taken) (app from `apps/web/dist`, every data read passed through to
chatdom.io) and walk it with `--target http://127.0.0.1:5173`. Real-GPU stills come from the RTX 5080 through
`chatdom-pc-lease … chatdom-pc shot https://chatdom.io/<path>`.

Status words: **working** (seen working on chatdom.io), **fixed** (broken on chatdom.io, fixed in this lane; live
after the next deploy), **handed over** (owner and `needs:` line), **deploy** (exact steps under `deploy:` in
`SEAMS.md`), **Tobias** (only he can do it).

Walked 2 Nov 2026, 17:45–18:10, against the deploy of `lane/integrator` at 31202c19, and again 18:45–19:05 against
the redeploy (e218c7c5, with this lane's first fixes), headless at both sizes and on the RTX 5080 (stills in
`work/evidence/launch/gpu/`, from Tobias's Chrome: `front@*`, `atlas@1440x900`, `card@*`, `kingdom@*`, `walk@*`,
`walk-diag@1440x900`, `stream@1920x1080`, `panel@318x496`).

| # | Step | Status | What a stranger meets, and what was done |
|---|---|---|---|
| 1 | Front door and its story | working | Hero, "Your chat has a home.", the three pictures, the story to the footer: no console errors, no developer words, at both sizes. Stills `front@*`, `story@*`. |
| 2 | How it works, legal pages, a wrong address | working | `/how-it-works`, `/privacy`, `/terms`, `/imprint` clean; `/kingdom/no-such-place` gets "This road leads nowhere." with the way back. (The walk flags "placeholder" in the privacy text; it is the honest word for what the model sees, not a dev string.) |
| 3 | The Atlas opens | working + fixed | Roads answer 200 since the Atlas service was rebuilt (`deploy: 1` done); the map draws on the 5080 (`gpu/atlas@1440x900`). The one console error on every explore load, `404 /api/atlas/me` for a signed-out visitor, is fixed: atlas-map's `atlas-owner-api.integrator.patch` is applied on `lane/launch` (operator note 19:45; 138 api tests pass). Without the hide flow's env lines the read answers 200 `anonymous`/`unavailable`, so the error goes with the next deploy; the hide flow itself needs atlas-map's `SEAMS.md` steps 2–3 (`deploy: 6`). |
| 4 | Searching a channel, opening its card | working + Tobias | The public lookup now finds tobi4s_, but its card said "Waiting · no land of its own" with only Watch on Twitch: no way into the founded kingdom (`gpu/card@*`, before). The waiting card now checks the front door's kingdoms: "Founded · Willowmere", **Enter Willowmere**, and "Willowmere is founded and open to visit. The map draws its land with the Atlas's next edition." Seen locally through `local-door.mjs` at both sizes (enter link `/kingdom/129634568`). Search finds it, phone notice and search ink fixed earlier. Drawing it on the map waits for Tobias's founding of the Atlas edition. |
| 5 | "Enter the land" into tobi4s_'s kingdom | working | Live on chatdom.io since the redeploy: `/kingdom/129634568` hands over to the realm's watch and Willowmere draws (castle, homes, snow peaks, forest, the sea, dusk sky). Zero console errors headless; real-GPU stills `gpu/kingdom@1440x900`, `gpu/kingdom@390x844`. |
| 6 | Twitch sign-in and coming back to the same place | working to Twitch + Tobias | The gate (`/?walk=1&kingdom=129634568`) shows "Your place is waiting." at both sizes and on the 5080 (`gpu/walk-diag@1440x900`, `gpu/walk@390x844`), no console errors. Sign in → `/api/realm/auth/start?returnTo=…` → 302 to `id.twitch.tv/oauth2/authorize` with `redirect_uri=https://chatdom.io/api/realm/auth/callback`, `scope=openid`, a `__Host-` state cookie (10 min); Twitch accepts the client and the redirect URI (it goes on to its login page, not `redirect_mismatch`). A callback with a wrong state or a refusal lands calmly on `/?signin=expired`. The last leg needs a Twitch account: Tobias signs in once on chatdom.io in the Chrome behind `chatdom-pc`. (The blank `gpu/walk@1440x900` was the capture tool waiting 90 s for a ready flag the gate does not set; the same page drew correctly a minute later.) |
| 7 | Walking, HUD | pending (Tobias's sign-in) | Needs a signed-in session: once Tobias has signed in on chatdom.io in the Chrome behind `chatdom-pc`, the lane stills `/?walk=1&kingdom=129634568` on the 5080 (it opens his tab with his session) at 1440×900 and 390×844, and walks it. |
| 7a | Minimap and lantern path | built + pending (merge, Tobias's sign-in) | play PL12 is done on `lane/play` (`fbebbc5f`, 19:48: the ledger, a live minimap and the lantern path home) but not yet in `lane/integrator`, so not on chatdom.io. Walked with step 7's session once integrator takes `lane/play` and redeploys. |
| 8 | A wish at the Forge that becomes a piece | fixed (part) + pending | The chat-permission round trip ("Continue to Twitch") came back to `/kingdom/<id>?forgeChat=…`, which hands a founded kingdom to its watch-only stream: the visitor lost the anvil and nothing read the outcome. It now comes back to the walk (`/?walk=1&kingdom=<id>&forgeChat=<outcome>`). The wish itself is to be walked after step 6; sending posts `!forge` in the visitor's own chat, so only on tobi4s_. |
| 9 | Fishing at the pier and the Almanac | built + pending (Tobias's sign-in) | Since the 18:40 walk, pier PI10 (fishing mounted in the walk: `fishing/play-slot.ts` and `kingdom-slot.ts` registered in `play/providers.ts`) and PI11 (the Almanac) are done and merged here. Live on chatdom.io (19:20) the pier answers: `/api/realm/pier/watch/129634568` streams `lines`, `/api/realm/pier/almanac/129634568` returns Willowmere's lake Almanac. Casting needs a walker, so it is walked with step 7's session. |
| 10 | Tavern portal, a game | pending (Tobias's sign-in) | Tavern door is registered in the walk; to be walked with step 7's session. |
| 10a | The campfire at night | built + pending (Tobias's sign-in) | gather GA11 is done and merged here (`campfire/register` is in `play/providers.ts`). Walked with step 7's session after dark. |
| 11 | The passport with raid stamps | handed over | There is no public passport on the web: it opens only inside the Twitch panel ("You" → "Your card" → passport). On chatdom.io a visitor has no way to it. `needs: panel-window/front-door: a web passport route, or the decision that the passport lives only in the panel`. |
| 12 | The panel view at `/panel` | working (calm) | Outside Twitch it says "Open on Twitch to see the kingdom" in the panel frame; no errors (`gpu/panel@318x496`). |
| 12b | The panel on twitch.tv/tobi4s_ | working + deploy | In Hosted Test since 19:15 (operator note). On the 5080 in Tobias's Chrome (`gpu/twitch-panel@1440x2000.png`, About page): the Willowmere panel sits among his panels with its frame, "Resting", **Walk in ↗** and the Kingdom / You / Gifts tabs. Its picture says "The kingdom is out of view" because no panel painter runs on this host, so no still was ever uploaded. `deploy: 4` in `SEAMS.md` (secret, still directory, painter runner). The open Walk in row said "Leaves Twitch for chatdom.gg" (a domain that does not answer; the link itself went to chatdom.io): **fixed**, names chatdom.io (`apps/panel/src/gate.ts`), in extension zip 0.0.3. |
| 13 | The stream view | working | `/stream?kingdom=129634568` on the 5080 at 1920×1080: Willowmere at dusk with "Stream resting · Every home keeps its place" (`gpu/stream@1920x1080`). `/stream` without a kingdom says "Choose a kingdom" with "Find a kingdom"; its console error is fixed (below). A stream that cannot open now reads "The kingdom needs a moment / The kingdom could not be opened just now." (a failed refresh: "could not refresh just now") instead of "Kingdom needs a moment / The kingdom revision could not be prepared". Only an expected refusal speaks its own words; any other cause (a realm 500, a TypeError, a scene error) is logged and kept in `stats.lastCause`, never shown (`mount.test.ts`). |
| 14 | Developer traces | working + fixed | `/` with any query but the walk rendered the staged Willowmere town (unlabelled: the staged seal prints nothing), and the Forge permission's expired path (`/?forgeChat=expired`) landed there. The gateway now opens the app on `/` only for `?walk=1`; every other query keeps the front page. Two links pointed at the retired `/showcase` ("Explore Chatdom" now goes to `/`; "Compare the three kingdoms ↗" is gone). |
| 15 | The Twitch extension zip | fixed | `node scripts/public/extension.mjs --origin https://chatdom.io --version 0.0.1` passes and writes `deploy/public/dist/chatdom-panel-0.0.1.zip` (see progress). |

## Findings placed since

- `/stream` without a kingdom logged `console.error("The stream kingdom could not open", …)` for the refusal it shows
  calmly. **fixed**: the refusal is a `StreamRefusal`, not logged; real failures still log (grand-world `SEAMS.md`).
- `/-/avatar-builder` was public and showed staged personas. **fixed**: the gateway no longer serves it (it is in
  `routes.test.ts`'s refused list), and `local-door.mjs` no longer routes it either.
- On the redeploy, the remaining console errors on the main path are `404 /api/atlas/me` (handed over, step 3), the
  `/stream` refusal (fixed here, live after the next deploy) and the honest `404` of `/kingdom/no-such-place`. The
  front page logs one warning under SwiftShader ("The live Atlas could not open on the front page; its picture
  stays."): the embed settles as a still on a slow renderer by design.
- `/stream?preview=1` is not a bench: it is the streamer's browser-source setup view (the output at its real size,
  "Kept clear for your camera and chat", the layout sheet), and on `/stream` the source is always the realm. **working**.
- **chatdom.io answered 502 from 17:55 on.** Cause: in the deploy checkout (`worktrees/public-next`) a `pnpm build`
  ran after `scripts/public/build.mjs` and vite emptied `apps/api/dist/`, deleting the gateway's `public.mjs`, so
  `scripts/public/start.mjs` refuses to start. **fixed + deploy**: `@chatdom/api`'s `build` now writes both bundles
  and `build.mjs` calls it; the steps to bring the gateway back now are `deploy: 0` in `SEAMS.md`. The real-GPU
  stills and the sign-in round trip wait for it.

## Session 3 (2 Nov, 19:10–19:30)

- Review points: the founded waiting card's words moved to `atlas/ui/waiting.ts` with tests (`waiting.test.ts`), and
  the card now matches the front door's kingdoms **by login only** (`matchFoundedChannel`): a Twitch channel that
  happened to be called `willowmere` would otherwise have been offered "Enter Willowmere". Still of the card from this
  build through `local-door.mjs` (`shots/launch/card@1440x900.png`): "Founded · Willowmere", Enter Willowmere, the
  one console error is the handed-over `404 /api/atlas/me`.
- Stream failures show only calm words (step 13).
- The panel on twitch.tv/tobi4s_ (step 12b, operator note 19:15) is up in Hosted Test; its picture needs the painter
  running (`deploy: 4`).
- The 5080 still of `https://chatdom.io/?walk=1&kingdom=129634568` (`gpu/walk-signed@1440x900.png`, 19:15) is still
  the gate: Tobias has not signed in in that Chrome yet, so steps 6 (last leg), 7, 8, 9, 10 and 10a wait for it.
- grand-world's signed-in walk bench (`work/lanes/grand-world/capture-walk.mjs --pc`, with a bench session and this
  checkout's build) loaded Willowmere on the 5080 in about 11 s with the grand land settled (71/71 regions), but the
  walker never took control (`owner: released`) and the bench timed out; its stand-in server does not answer
  `/api/public/door` or the pier routes the walk now reads, so it no longer matches the product and is not evidence
  either way. The real walk is Tobias's session on chatdom.io.

## Session 4 (2 Nov, 19:30–20:05)

- chatdom.io was redeployed at 19:43 from `502e75f2`, which carries every fix above (502s for about a minute while
  the gateway restarted). Walked live headless at both sizes (`walk.mjs`, all steps but kingdom and stream, which
  were walked at 1440 just before): the card reads "Founded · Willowmere" with **Enter Willowmere** →
  `/kingdom/129634568` live (`shots/launch/card@390x844.png`); `/stream` without a kingdom is calm with **zero**
  console errors; front, story, panel, gate, legal: zero. The only console error left on the main path is the
  handed-over `404 /api/atlas/me` (map, search, card). Kingdom and stream: no console errors (warnings only); the
  ~90 "failed" requests each are the raid feeds' own 6 s timeouts aborting while SwiftShader holds the main thread,
  not something a visitor meets.
- Tobias has still not signed in in the `chatdom-pc` Chrome (`gpu/walk-signed@1440x900.png` at 19:32 is the gate),
  so steps 6 (last leg), 7, 8, 9, 10 and 10a still wait for his session.
- `walk.mjs` gained failure steps (`expired`, `forgeexpired`, `walknowhere`, `kingdomunknown`, `mapnowhere`): the
  stale links and refusals a stranger can reach. Expired sign-in ("That sign-in took too long…") and an unknown
  channel on the map ("… is not on the map yet." with Look on Twitch) read calmly. Three did not, all fixed here
  (live after the next deploy; owners told in their `SEAMS.md`):
  - **One stale link stopped channel search for everyone.** Twitch answers an impossible channel ID with 400 Bad
    Identifiers; the Atlas lookup took it as an outage and refused every visitor's lookup for 1–64 s. Now an
    absent channel (`apps/surveyor/src/directory/twitch-lookup.ts`, atlas-map). `deploy: 5`.
  - `/kingdom/<unknown id>` said "The Atlas could not be read just now…"; it now says "This channel has no holding
    on the current survey of the Atlas." (`atlas/data/holding.ts`).
  - The walk-in gate printed raw causes under "What the gate said" (during a redeploy: "Finding the kingdom
    (/api/realm/entry/…) returned HTTP 502 text/html; expected JSON."). It now shows only a realm refusal; the rest
    goes to `console.warn`. A kingdom not open to visitors (the realm's entry route now answers 404 instead of 503)
    gets "This road leads nowhere." with the Atlas and the front page, instead of a sign-in into "the kingdom".
    Seen from this build through `local-door.mjs` (which now serves `/?walk=1` from the local build like the
    gateway; before, it passed `/` to chatdom.io): `shots/launch/gate-nowhere@*`, `gate-closed@*`.
- The owner API patch (step 3) is applied here per the operator note; the gateway-visitor patch was already applied in
  session 2. PL12 (step 7a) is done on `lane/play`, waiting for the integrator merge.
- For LA11: the raid chat feed polls every 750 ms per open kingdom view (`kingdom/moments/raid-chat.ts`); with 50
  visitors that is ~67 requests a second to the realm. Measure it in the load run.


## Session 5 (2 Nov, 20:10–)

- Review point: the gate's name read (`gateName`) now returns a tagged result (`named` with the approved name,
  `missing` for the realm's 404, `unknown` when it cannot say), so a kingdom whose approved name is "nowhere" (or
  "missing", "lost") keeps its name instead of turning the gate into "This road leads nowhere." (`gate.test.ts`).
- Live check at 20:15: chatdom.io still answers `404 /api/atlas/me` (the deploy carrying session 4's owner API patch
  has not happened yet); `/api/realm/entry/129634568` and `/api/public/door` answer 200.
- The RTX 5080 lease was held from 19:54 by the teaser recording (Tobias's call); this session queued 45 minutes
  (20:17–21:02) to still `/?walk=1&kingdom=129634568` with Tobias's session at both sizes and did not get it. The
  script it would have run is two `chatdom-pc shot … --no-ready --settle 25` calls (the gate sets no ready flag), to
  `gpu/walk-signed@1440x900.png` and `gpu/walk-signed@390x844.png`; that is the first thing next session.
