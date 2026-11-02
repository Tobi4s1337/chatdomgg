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
| 3 | The Atlas opens | working + handed over | Roads answer 200 since the Atlas service was rebuilt (`deploy: 1` done); the map draws on the 5080 (`gpu/atlas@1440x900`). One console error remains on every explore load: `404 /api/atlas/me` (signed-out visitor), because atlas-map's owner API patch was never applied and no longer applies. `needs: integrator/atlas-map: rebase and land atlas-owner-api.patch` (atlas-map `SEAMS.md`). |
| 4 | Searching a channel, opening its card | fixed + Tobias | The public lookup now finds tobi4s_, but its card said "Waiting · no land of its own" with only Watch on Twitch: no way into the founded kingdom (`gpu/card@*`, before). The waiting card now checks the front door's kingdoms: "Founded · Willowmere", **Enter Willowmere**, and "Willowmere is founded and open to visit. The map draws its land with the Atlas's next edition." Seen locally through `local-door.mjs` at both sizes (enter link `/kingdom/129634568`). Search finds it, phone notice and search ink fixed earlier. Drawing it on the map waits for Tobias's founding of the Atlas edition. |
| 5 | "Enter the land" into tobi4s_'s kingdom | working | Live on chatdom.io since the redeploy: `/kingdom/129634568` hands over to the realm's watch and Willowmere draws (castle, homes, snow peaks, forest, the sea, dusk sky). Zero console errors headless; real-GPU stills `gpu/kingdom@1440x900`, `gpu/kingdom@390x844`. |
| 6 | Twitch sign-in and coming back to the same place | working to Twitch + Tobias | The gate (`/?walk=1&kingdom=129634568`) shows "Your place is waiting." at both sizes and on the 5080 (`gpu/walk-diag@1440x900`, `gpu/walk@390x844`), no console errors. Sign in → `/api/realm/auth/start?returnTo=…` → 302 to `id.twitch.tv/oauth2/authorize` with `redirect_uri=https://chatdom.io/api/realm/auth/callback`, `scope=openid`, a `__Host-` state cookie (10 min); Twitch accepts the client and the redirect URI (it goes on to its login page, not `redirect_mismatch`). A callback with a wrong state or a refusal lands calmly on `/?signin=expired`. The last leg needs a Twitch account: Tobias signs in once on chatdom.io in the Chrome behind `chatdom-pc`. (The blank `gpu/walk@1440x900` was the capture tool waiting 90 s for a ready flag the gate does not set; the same page drew correctly a minute later.) |
| 7 | Walking, HUD | pending (Tobias's sign-in) | Needs a signed-in session: once Tobias has signed in on chatdom.io in the Chrome behind `chatdom-pc`, the lane stills `/?walk=1&kingdom=129634568` on the 5080 (it opens his tab with his session) at 1440×900 and 390×844, and walks it. |
| 7a | Minimap and lantern path | handed over | Not built yet: play PL12 ("The ledger is complete, a live minimap, and a lantern path home") is unchecked. `needs: play PL12`. |
| 8 | A wish at the Forge that becomes a piece | fixed (part) + pending | The chat-permission round trip ("Continue to Twitch") came back to `/kingdom/<id>?forgeChat=…`, which hands a founded kingdom to its watch-only stream: the visitor lost the anvil and nothing read the outcome. It now comes back to the walk (`/?walk=1&kingdom=<id>&forgeChat=<outcome>`). The wish itself is to be walked after step 6; sending posts `!forge` in the visitor's own chat, so only on tobi4s_. |
| 9 | Fishing at the pier and the Almanac | handed over | Fishing is built but not mounted in the walk (`apps/web/src/fishing/play-slot.ts` and its import in `play/providers.ts` do not exist; the realm needs `REALM_PIER_FISHING=1`), and the Almanac is pier PI11, unchecked. `needs: pier PI10 production mounts, PI11`. |
| 10 | Tavern portal, a game | pending (Tobias's sign-in) | Tavern door is registered in the walk; to be walked with step 7's session. |
| 10a | The campfire at night | handed over | gather GA11 ("The campfire at night, and Dusk Court") is unchecked; no campfire provider is registered in the walk. `needs: gather GA11`. |
| 11 | The passport with raid stamps | handed over | There is no public passport on the web: it opens only inside the Twitch panel ("You" → "Your card" → passport). On chatdom.io a visitor has no way to it. `needs: panel-window/front-door: a web passport route, or the decision that the passport lives only in the panel`. |
| 12 | The panel view at `/panel` | working (calm) | Outside Twitch it says "Open on Twitch to see the kingdom" in the panel frame; no errors (`gpu/panel@318x496`). |
| 13 | The stream view | working + fixed | `/stream?kingdom=129634568` on the 5080 at 1920×1080: Willowmere at dusk with "Stream resting · Every home keeps its place" (`gpu/stream@1920x1080`). `/stream` without a kingdom says "Choose a kingdom" with "Find a kingdom"; its console error is fixed (below). A stream that cannot open now reads "The kingdom needs a moment / The kingdom could not be opened just now." instead of "Kingdom needs a moment / The kingdom revision could not be prepared". |
| 14 | Developer traces | fixed | `/` with any query but the walk rendered the staged Willowmere town (unlabelled: the staged seal prints nothing), and the Forge permission's expired path (`/?forgeChat=expired`) landed there. The gateway now opens the app on `/` only for `?walk=1`; every other query keeps the front page. Two links pointed at the retired `/showcase` ("Explore Chatdom" now goes to `/`; "Compare the three kingdoms ↗" is gone). |
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
