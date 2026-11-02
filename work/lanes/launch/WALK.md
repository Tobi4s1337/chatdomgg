# The launch walk: chatdom.io as a first-time visitor

How it is walked: `node work/lanes/launch/walk.mjs` (headless Chrome, SwiftShader, a fresh context per step, at
1440×900 and 390×844) records console errors, failed requests and developer words on screen, and writes stills to
`shots/launch/`. To check a web fix before it is deployed, serve this checkout's build with
`node work/lanes/launch/local-door.mjs --port 5172` (app from `apps/web/dist`, every data read passed through to
chatdom.io) and walk it with `--target http://127.0.0.1:5172`. Real-GPU stills come from the RTX 5080 through
`chatdom-pc-lease … chatdom-pc shot https://chatdom.io/<path>`.

Status words: **working** (seen working on chatdom.io), **fixed** (broken on chatdom.io, fixed in this lane; live
after the next deploy), **handed over** (owner and `needs:` line), **deploy** (exact steps under `deploy:` in
`SEAMS.md`), **Tobias** (only he can do it).

Walked 2 Nov 2026, 17:45–18:10, against the deploy of `lane/integrator` at 31202c19.

| # | Step | Status | What a stranger meets, and what was done |
|---|---|---|---|
| 1 | Front door and its story | working | Hero, "Your chat has a home.", the three pictures, the story to the footer: no console errors, no developer words, at both sizes. Stills `front@*`, `story@*`. |
| 2 | How it works, legal pages, a wrong address | working | `/how-it-works`, `/privacy`, `/terms`, `/imprint` clean; `/kingdom/no-such-place` gets "This road leads nowhere." with the way back. (The walk flags "placeholder" in the privacy text; it is the honest word for what the model sees, not a dev string.) |
| 3 | The Atlas opens | deploy | The map draws, but every load logs a console error: `GET /map-data/v1/roads/<preview>/busiest` 404. The Atlas data service on 5193 runs an old `lane/atlas` build (8d4d8676, started 14:19 from `worktrees/atlas`) that has no road routes. The roads layer then stays empty and the front page's live Atlas "settles as still". |
| 4 | Searching a channel, opening its card | fixed + deploy + Tobias | "tobi4s_" is "not on the map yet": the survey only holds channels it saw with ≥ 5 viewers, and no claim puts a founded kingdom on the map before the first Atlas edition is founded (Tobias's founding key). The card lookup (`lookup=1`) 404s too, because that old build has no Twitch lookup. Fixed for now: a name the register does not know is checked against the kingdoms the front door opens (`/api/public/door`); the search's empty state then says "Willowmere, tobi4s_'s kingdom, is open all the same." with **Enter Willowmere**, and `/map/tobi4s_` gives the same notice with an Enter action. The phone notice no longer wraps one word per line, and the search panel's sentences, which inherited the wooden plate's cream ink on paper and were nearly invisible, are ink again. Seen locally through `local-door.mjs --loopback` at both sizes: `work/evidence/launch/la10-search-door-swiftshader.png`, `la10-map-route-notice@390x844.png`. |
| 5 | "Enter the land" into tobi4s_'s kingdom | fixed | `/kingdom/129634568` stopped at "The Atlas could not be read just now, so the road into this land is closed": the page read the survey before asking whether the kingdom has adopted land. It now asks the realm first, so a founded kingdom always hands over to its live land (`/stream?source=realm&kingdom=129634568`), surveyed or not. Seen locally: `/kingdom/129634568` → `/stream?source=realm&kingdom=129634568` at both sizes (before: `work/evidence/launch/la10-before-kingdom-stream-1440.png`). |
| 6 | Twitch sign-in and coming back to the same place | pending | Walking needs a Twitch sign-in (the gate at `/?walk=1&kingdom=…` says "Your place is waiting."). Round trip to be walked on the 5080. |
| 7 | Walking, HUD | pending | Needs step 6. |
| 7a | Minimap and lantern path | handed over | Not built yet: play PL12 ("The ledger is complete, a live minimap, and a lantern path home") is unchecked. `needs: play PL12`. |
| 8 | A wish at the Forge that becomes a piece | fixed (part) + pending | The chat-permission round trip ("Continue to Twitch") came back to `/kingdom/<id>?forgeChat=…`, which hands a founded kingdom to its watch-only stream: the visitor lost the anvil and nothing read the outcome. It now comes back to the walk (`/?walk=1&kingdom=<id>&forgeChat=<outcome>`). The wish itself is to be walked after step 6; sending posts `!forge` in the visitor's own chat, so only on tobi4s_. |
| 9 | Fishing at the pier and the Almanac | handed over | Fishing is built but not mounted in the walk (`apps/web/src/fishing/play-slot.ts` and its import in `play/providers.ts` do not exist; the realm needs `REALM_PIER_FISHING=1`), and the Almanac is pier PI11, unchecked. `needs: pier PI10 production mounts, PI11`. |
| 10 | Tavern portal, a game | pending | Tavern door is registered in the walk; to be walked after step 6. |
| 10a | The campfire at night | handed over | gather GA11 ("The campfire at night, and Dusk Court") is unchecked; no campfire provider is registered in the walk. `needs: gather GA11`. |
| 11 | The passport with raid stamps | handed over | There is no public passport on the web: it opens only inside the Twitch panel ("You" → "Your card" → passport). On chatdom.io a visitor has no way to it. `needs: panel-window/front-door: a web passport route, or the decision that the passport lives only in the panel`. |
| 12 | The panel view at `/panel` | working (calm) | Outside Twitch it says "Open on Twitch to see the kingdom" in the panel frame; no errors. |
| 13 | The stream view | working | `/stream` without a kingdom says "Choose a kingdom" with "Find a kingdom" (one console error logs the refusal: see below). `/stream?kingdom=129634568` to be stilled on the 5080. |
| 14 | Developer traces | fixed | `/` with any query but the walk rendered the staged Willowmere town (unlabelled: the staged seal prints nothing), and the Forge permission's expired path (`/?forgeChat=expired`) landed there. The gateway now opens the app on `/` only for `?walk=1`; every other query keeps the front page. Two links pointed at the retired `/showcase` ("Explore Chatdom" now goes to `/`; "Compare the three kingdoms ↗" is gone). |
| 15 | The Twitch extension zip | fixed | `node scripts/public/extension.mjs --origin https://chatdom.io --version 0.0.1` passes and writes `deploy/public/dist/chatdom-panel-0.0.1.zip` (see progress). |

## Open findings, not yet placed

- `/stream` without a kingdom logs `console.error("The stream kingdom could not open", …)` for a refusal it shows calmly.
- `/-/avatar-builder` is public and shows staged personas; `/stream?preview=1` opens the stream preview bench.
- chatdom.io answered 502 from ~17:52 to at least 18:35 (gateway on 5480 not listening while realm, herald and Forge came back with new processes). Not touched; noted for the operator. The real-GPU stills and the sign-in round trip wait for it.
