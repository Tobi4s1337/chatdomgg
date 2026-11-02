# AM11: roads that last, and the Raid Gate's finder — 2 November 2026

This builds on the durable ledger in `AM11-durable-roads.md`. It adds the public road reads, the drawn network, road
stories on the cards, caravans for fresh raids, the private ingest and its client, and gate mode with the finder.
The settled paths and replies are in `SEAMS.md` ("Roads, caravans and the gate settled").

## Decisions

- **Width, sea lanes and the dotted fade are one pure module** (`apps/web/src/atlas/road/network.ts`). Width is
  `0.9 + 0.62·log2(raids) + 0.2·log10(1 + travellers/raids)` CSS px, clamped to 0.9–4.4: raids decide and travellers
  add a little. A road between two language lands is a sea lane, drawn as long dashes along a sea bend. Either end
  with an unknown land never makes one. A road unused for `UNUSED_SEASON_MS` (90 days, the only place that number
  lives) is drawn dotted. It keeps its width and its card, and it is never removed.
- **Restraint at a distance.** The map draws only the busiest roads at each distance: 48 at the whole world, 110,
  220, then all 400 among the kingdoms. The ink is sepia at 42 % alpha, under the marks. When a kingdom is chosen,
  the network steps back to its 40 strongest roads at 10 %, and that kingdom's roads are inked over it. The same
  happens while a road card or the gate is open. Closer than the whole world, a road is drawn only when one of its ends
  is in or near the view, so roads passing between two far places do not scratch across the land. A road card's road gets a paper bed and
  the heaviest ink. Nothing glows. The only thing that moves by itself is a caravan.
- **The service places every end.** Road replies carry world positions: the holding, or for a channel without land
  its deterministic pencil place, from the same register as the cards. So the map never guesses, and every reader
  agrees. An end the register cannot place (an unseen channel) has no position. Its road is kept and listed, but it
  is not drawn and no caravan rides it.
- **Caravans ride once, and never after a reload.** A fresh raid reaches pages as `event: raid` on the live stream
  they already hold, only while they hold it. The service buffers nothing, so a reload cannot replay one. The page
  also keeps the IDs that have ridden through a redrawn WebGL context. At most six ride at once; a raid beyond that
  only thickens its road. Ride time is 12–30 s by the road's share of the land. The caravan carries the source's
  banner and an "N travellers" label, rests 2.4 s at the gate, then becomes part of the road it thickened.
- **Honest counts.** Recorder pair totals enter as `at-least` roads, which read "At least N raids, the last on D".
  Roads built from single observations read "7 raids since 30 October". Two channels without a witnessed raid read
  "No raid between them seen since D", and a channel with none reads "No raid to or from this channel seen since D".
  Neither ever says "no raids".
- **Gate mode is the Raid Gate's surface.** It hides the cartouche, search, key, navigation and cards. It shows the
  source's roads and the finder board, a carved walnut board on the right (a bottom sheet on a phone). Hovering a row
  pencils the way. A pick, from the board or a tap on the map, inks it at once with the gate's journey stages. Only
  live, named channels can be picked. The board and the Atlas only propose: raid-show's authority decides.
- **The finder's order is fixed.** Live channels along the source's roads, then live channels of the source's
  realm, then the three nearest realms of the same language, then search (twelve rows a group at most). Inside each group the order is smaller
  channels first (survey average), then channel ID. No other field can move a row, and nothing paid exists in any
  input.
- **No founded land is claimed.** Until a founded-kingdom record exists, `founded` is never sent. A placed channel is
  `waiting`, an unplaced one is `edge`.

## Built

- Service (`apps/surveyor`):
  - `roads/public.ts`: the channel roads, road story, busiest roads, caravan event and finder projections.
  - `serve.ts`: the four public routes, a 60 s busiest cache keyed by the withheld list, caravans, and the separate
    ingest listener.
  - `roads/client.ts`: the ingest client.
  - `ledger.ts`: per-direction tallies, a channel index, the recent raids per pair and a cached busiest ranking. The
    record format is unchanged.
  - The first raid-show pull pass after a start is treated as catch-up and never announces a caravan.
- Web (`apps/web/src/atlas`):
  - `data/roads.ts`: validators and readers.
  - `road/network.ts`, `road/story.ts`: the pure styling and wording rules.
  - `road/atlas-roads.ts`: the network, focus, chosen road, caravans and gate journey, on the map's own camera.
  - `ui/Roads.tsx`: the card's ledger roads and the road story card.
  - `gate/FinderBoard.tsx`, `gate/finder.css`, `gate/select.ts`: the finder board.
  - `embed.ts`: the gate bridge.
  - `scene.tsx`: wires all of the above in.
  - `live/feed.ts`: hands raid events to the scene.
  - `bench/index.tsx`: gate mode on the bench.

## Verification

All commands ran niced on cores 0–8.

- **Repository typecheck** (`tsc --noEmit`) passes. ESLint passes on every changed file.
- **Builds:** the web and Surveyor production builds pass.
- **Web tests:** 78 pass. They cover the network and story rules, the road and finder validators, the gate bridge
  (with a type line that fails if `handle.gate` drifts from raid-show's port), the feed's raid event, the road layer
  and the directory.
- **Gateway:** `routes.test.ts` passes 18/18 with the new road and finder routes.
- **Service tests** cover the brief:
  - `roads/ingest.test.ts`:
    - duplicates from the same source and across sources;
    - twenty concurrent identical posts stored once;
    - invalid bodies, size, method and token;
    - an uncertain write.
  - Out-of-order delivery, a gap and restart with backfill, and aggregate reconciliation without invented events are
    in the existing ledger, recorder and aggregate tests.
  - `roads/public.test.ts`:
    - fading without deletion;
    - the finder's order and its live-only rule;
    - fresh-only caravans.
  - The touched set (roads, serve, directory, config, live serve) passes 129/129.
- **Ingest speed on the built CLI:** stored in 33 ms including the fsync, a duplicate in 2 ms.
- `serve-preview.test.ts`: two tests opened a second service on a data directory the first still held. The road
  ledger's single-writer lease refuses that by design, so the tests now close the first service before opening the
  next. Four older failures in `preview/serve-preview` and `check-preview` (region names after the language-name
  table, and the problem lists) predate AM11 and are left for their owner.

## Evidence

The owned service ran on `127.0.0.2:5199` and the preview on `127.0.0.2:5175`; both are stopped. The service read
the survey feed (`twitch-demo.saartech.de/atlas/api/`) and the recorder read-only. A fresh live frame came from
`atlas:live`. Stills were taken in SwiftShader under the shared capture lock, and each hold stayed under 2 minutes.
The record is `work/evidence/atlas-map/am11-road-shots.json`.

- **`am11-road-before.png` / `am11-road-after.png`:** beaglebucs7's card and roads (victordancer "At least 16 raids, the
  last on 2 November", almira0307, DJ_Hak "2 raids since 1 November"). The second was taken after stopping and
  restarting the service and loading the page again: the same three roads, counts and lines.
- **`am11-sea-lane.png`:** franckjoseph and stormi060, "At least 7 raids, the last on 31 October". The road runs dashed
  from the English land to the Isles of Many Tongues, and its last five raids are listed with their travellers.
- **`am11-caravan.png`:** three caravans riding at once over the world view (38, 21 and 148 travellers) from raids the
  survey's stream announced while the page was open.
- **`am11-finder-1920.jpg`, `am11-finder-1440.png`, `am11-finder-390.png`:** the gate from tobi4s_ (129634568). The
  source's pencil flag is named, tobi4s_ has no road yet, and "Your realm" lists live channels smallest first. The
  1920 still is a JPEG to stay under 2 MB.
- **Live observations:** survey SSE raids were stored live; the ledger moved from record 158,328 to 159,501 during
  the captures. The ledger holds no raid to or from tobi4s_ (129634568). No raid-show feed was configured, so no herald raid and no real tobi4s_ raid reached this ledger.
- **Timings:** the first busiest-roads and finder reads after a start took about 8 s. After that, busiest answered
  in 4 ms and the finder in 70–140 ms (540 ms with a name search).
- The road stills were taken before the last restraint change (quiet network capped at 40 roads at 10 %). The
  finder stills show it.

## Doubts

- A channel outside the survey shows as live in search from cached Twitch facts, which can be up to 24 h old.
  raid-show's authority re-checks before any raid, but a stale "live" can appear on the board.
- The first busiest-roads and finder reads after a start take about 8 s while the register and the live frame
  warm. Warming both at start would hide this.
- A road end the survey has never seen and Twitch has not been asked about has no place yet, so its road is listed
  but not drawn and no caravan rides it. Placing those ends needs a budgeted background lookup (language and game).
- The gate's journey stages (pick, rise, road, drawing, arrived, back) are built, but no still shows them yet;
  raid-show's pane drives them.
- An earlier sub-step's smoke test briefly sent two test POSTs to another service on 127.0.0.1:5188/5189 before
  moving to free ports. That service answered 404, and nothing else was touched.
- Most finder rows have no current viewer count (the register keeps averages), so they read "about N viewers".
