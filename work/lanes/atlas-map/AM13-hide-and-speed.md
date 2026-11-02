# AM13 — Streamers hide themselves, and the Atlas is fast enough to be the front page

## 1. Self-serve hide (A12, decision 39)

### What a streamer sees

Signed in with Twitch on chatdom.io, a streamer who opens their own card (by clicking their mark, their pencil flag, a
search row or `/map/<login>`) finds one quiet line under the card's actions: a small brass key, "Your channel", and an
underlined "Hide my channel". One press, no confirmation step (showing it again is one press too). The card turns into
the card only they see: "Hidden by you", their face and place, one sentence ("Only you see this card. Nobody finds your
channel on the map, in search or on roads.") and "Show my channel". Their land goes bare in the same moment; nothing on
the public map says anything happened. Coming back later, their own name in search shows them their channel first,
marked "Hidden by you", and `/map/<login>` opens the same private card. "Show my channel" brings it back and opens the
public card again where it stands. If the operator's list also holds the channel, showing it changes nothing public, and
the card says only "It stays off the map for now", never why.

### How it works

| Piece | Where | What |
|---|---|---|
| Owner log | `apps/surveyor/src/policy/owner-hide.ts` | Append-only `moderation/owner-visibility.ndjson` beside the operator's `withheld.json`; latest act per channel wins; fsynced before any reply; a torn tail is ignored, any other damaged line fails closed |
| One gate | `policy/visibility.ts` `withheldReader`, `readWithheldIds`; `edition/commands.ts` `readWithheldList`; `live/run.ts` | Every reader folds owner hides into the withheld set: names projection (drawn bare), search, cards, road stories and card roads, the gate finder, live paint (wash and pencil dabs at the next 30 s run), edition settlement (hidden tombstone, restored at the next observed night after showing). Published files never learn which list hid a channel |
| Private routes | `serve.ts` on the ingest listener | `POST /v1/channels/<id>/hide|unhide`, `GET /v1/channels/<id>/visibility[?preview=]`; bearer token required, and absent (`503 not-configured`) on a service without one |
| Open maps | `serve.ts` live stream, `live/feed.ts` `onNames` | When the withheld key changes, every open live stream gets `event: names` (no payload) within ~2 s; the map reads its names again 250 ms later |
| Session authority | `apps/api/src/atlas-owner/index.ts` (+ one line each in `apps/api/src/main.ts`, `public/main.ts`, `public/routes.ts`), carried as `atlas-owner-api.patch` because `apps/api` is outside this lane | `GET /api/atlas/me`, `POST /api/atlas/me/hide|show`; the channel is the session's own Twitch user, never a request field; origin + CSRF for changes; `no-store`, `Vary: Cookie`; SIMULATED sessions never reach the Atlas |
| Map | `data/owner.ts`, `ui/Owner.tsx`, `scene.tsx`, `ui/Search.tsx`, `ui/Card.tsx`, `ui/Register.tsx` | Asked once per drawn explore map (never hero or gate, never before the first frame); every failure reads as nobody signed in |

### Decisions

- **The session authority is ours, in `apps/api`.** §4 of `SEAMS.md` waited on front-door and main; front-door is finished
  and main takes no patches this round, so by the 12:18 rule this lane made the smallest additive change itself: one new
  folder modelled on the dock (same principal lookup, same mutation guard) and one routing line in each of three files.
- **The channel comes from the session, never the request.** A signed-in Twitch user is the broadcaster of exactly one
  channel, so `/api/atlas/me/hide` takes no channel at all; any query string is refused.
- **Owner hides ride the existing withheld gate** instead of a second gate. The withheld list was already designed as
  "hidden by their owner, removed, or with a name pulled", already applied per request, and already drawn as bare land
  in the browser; a second mechanism would have been a second place to forget. The operator list wins by construction:
  showing removes only the owner's own entry.
- **The owner keeps a private card** computed with the operator list only, served only by the private route through the
  session authority with `no-store`. It never enters a public cache or the names projection.
- **No confirmation dialog.** Hiding is reversible in one press from the same card, search or address; a dialog would be
  a refusal-shaped word on the map.
- **Edition land:** after Edition I a hide tombstones the holding at the next settlement (the names projection already
  hides it at once); showing it restores the same holding at the next observed night, as any lifted tombstone does.

### Verified

- Service: `src/policy/owner-hide.test.ts` (7): log semantics, union with the operator list and the operator winning,
  fail-closed readers; over HTTP, hide removes the channel from names, search, both card routes, the capital's card roads
  and the road story, the private card stays for its owner, show restores all of it; 401/405/422/404 refusals, the public
  server never routes them, no token = not offered. `src/live/run.test.ts` (+1): an owner hide drops the wash and a
  pencil dab at the next live run and showing gives it back.
- API: `src/atlas-owner/index.test.ts` (6): anonymous, own-channel only, origin/CSRF, SIMULATED never reaches the
  Atlas, broken replies, the private client's bearer token and body; `public/routes.test.ts` (+1).
- Web: `data/owner.test.ts` (4), `live/feed.test.ts` (+1).
- Real map, own Atlas service with its private listener, WebGL-free still (capture lock), the check playing the session
  authority for 129634568 (`checks/owner-hide-shots.mjs`, `work/evidence/atlas-map/am13-hide-shots.json`): 11 checks,
  0 page errors; hide reflected on the card in 133–215 ms and the public card 404 at once; show back in ~1.5 s
  (names re-read, then the card's flight). Stills: `am13-hide-{own-card,hidden-card,shown-again}-{1440,390}.png`,
  `am13-hide-own-search-1440.png`.
- Found and fixed on the way: search result names in the walnut cartouche were cream on cream (the plate's lettering
  colour leaked into the list); they are ink again (`ui/chrome.css`).

### Still owed

- Stills of the flow through the real Twitch sign-in as tobi4s_: needs the API process with `ATLAS_PRIVATE_URL` and
  `ATLAS_INGEST_TOKEN`, the Atlas service with its ingest listener, and Tobias at a browser.

### Operator adoption

1. Atlas service: `ATLAS_INGEST_PORT` and `ATLAS_INGEST_TOKEN` (already needed for roads and claims). Keep
   `moderation/owner-visibility.ndjson` with the data directory, like `withheld.json`.
2. Public gateway / API process: `ATLAS_PRIVATE_URL=http://127.0.0.1:<ATLAS_INGEST_PORT>` and the same
   `ATLAS_INGEST_TOKEN`. Without them `/api/atlas/me` says `unavailable` and no card shows the line.
3. `atlas:live` needs nothing new: it reads the owner log at every run.

## 2. Speed: the first frame comes first (A14)

### What changed

| Change | Where | Effect |
|---|---|---|
| The moving map is built only after the still is up | `scene.tsx` `start()`, `loadEngine()`, new `map/engine.ts` | Pixi (≈200 KB gz, including the unused Canvas and WebGPU renderers) and `app.init` leave the first frame's path; the `scene` chunk no longer pulls the engine; the still waits at most 8 s (`STILL_FIRST_MS`) before the map is built anyway |
| One bake, not two | `still/Still.tsx` `shareTiles`, `map/view.ts` `seed`, `map/tiles.ts` `TileLayer.seed` | The still hands its baked world-view tiles (bitmap copies) to the map's tile layer; the map draws them at once and never bakes that view again |
| Bake workers start on the first wish | `map/tiles.ts` `TileFarm.open()` | The map's four workers are no longer spawned (and do not fetch the stamp sheet) until a tile the still did not bake is wanted |
| Faces preloaded, not a gate | `fonts.ts` `preloadFaces`, `embed.ts` | The seven woff2 files are asked for the moment a map mounts (they were discovered at ~1.9 s, after the scene stylesheet applied); `start()` reads the world while they arrive and only the lettering waits for them |
| Names head first | `serve.ts` `previewNames(id, 'head')`, `data/preview.ts`, `data/model.ts` `applyNames(served, whole)`, `scene.tsx` `readNames` | `names?part=head` holds names only for the world view's head (40 KB br instead of 1,045 KB gz); the whole follows after the first frame and a late head never undoes it; names are `ready` only once the whole is in; a missing whole is retried every 30 s |
| Brotli, off the event loop | `serve.ts` `brotliLater`, `encodingFor`, `frameCache`, `send()` | Immutable preview files at quality 11, names and live files at 6, compressed once per file or frame in the background; gzip is served until brotli is ready; JSON replies from 1,400 bytes (roads, survey) are gzipped; `dabs.bin` stays plain by design |
| A shorter first wash slice | `still/Still.tsx` `FIRST_WASH_SLICE_MS = 48` | Until the still is ready the wash is laid in 48 ms slices (6 ms afterwards, as AM10 decided for card response), so the first frame is not spread over hundreds of yields |

The look is unchanged: the after and before stills of `/map` at 1440 are the same picture
(`am13-cold-load-{before,after}-map-1440.png`, `am13-cold-load-after-{map,hero}-{1440,390}.png`).

### Measured (SwiftShader, shared 12-core host under load; judge bytes and order, not absolute ms)

Script: `apps/web/src/atlas/checks/cold-load.mjs` (new browser per run; 1440 at DPR 1, 390 at DPR 2 with touch;
broadband 40/10 Mbps 20 ms RTT, phone 9/3 Mbps 170 ms RTT CPU ×4). Raw runs: `am13-cold-load-{before,after}.json`;
the before analysis is `am13-cold-load-before.md`. Own servers only (Atlas service 127.0.0.3:5182, preview
127.0.0.3:5173, both stopped).

`ready=still` (the first coherent frame), ms from navigation; unthrottled cells are run 1/run 2:

| case | before none | after none | before broadband | after broadband | before phone | after phone |
|---|---|---|---|---|---|---|
| hero 1440 | 3740/4332 | **3264/3471** | 6421 | **3493** | 12924 | **7255** |
| hero 390 | 5034/4283 | **2784/3240** | 5235 | **3022** | 9811 | **6320** |
| /map 1440 | 6870/8060 | 6663/5988 | 7147 | 11799 (outlier) | 14887 | **11874** |
| /map 390 | 5339/5162 | 8219/8174 | 5489 | 6300 | 8592 | 8313 |

Long tasks before the still: hero 1440 2.9–8.4 s → 0.9–1.6 s; /map 1440 3.8–7.4 s → 1.9–3.7 s. The hero improved in
every cell. `/map` did not clearly improve: 1440 is level unthrottled and better on the phone profile, but 390
unthrottled is slower (8.2 s against 5.2 s) and I have not found the cause; the runs are on a loaded shared host, so
this is the first number to check on the real GPU.

`ready=map` (the moving map, live settled) comes later than before (hero 1440 6.6/7.6 s → 15.4/14.1 s, /map 1440
11.6 s → 14.2/12.1 s), by design: it is built after the still instead of competing with it. The still is the map the
reader sees and can open cards on until then; under SwiftShader Pixi's init alone is ~5 s, on a real GPU a fraction.

Transfer before the first frame (encoded bytes):

| | before | after |
|---|---|---|
| **total, hero 1440** | 2,451 KB | **932 KB (−62 %)** |
| **total, /map 1440** | 2,920 KB | **1,425 KB (−51 %)** |
| JS | 360 KB | 175 KB |
| names | 1,021 KB gz (whole) | 40 KB br (head) |
| live pointer and files | 256 KB | none (after the map) |
| roads (busiest) | 69 KB plain | 15 KB gz |
| world.json | 281 KB gz | 238 KB br |
| faces | 442 KB | 442 KB (now the largest share) |
| stamps.webp (/map page) | 470 KB | 470 KB |

After the first frame: the whole names, 742 KB br (was 1,045 KB gz), and the region chunks (region-0 244 KB br).

Renderer at the settled default view (1440×900): `/map` 147 textures, 36.0 MB (stamp sheet with mips 14.2 MB, wash
picture 7.8 MB, ~140 tiles of 256 KB) against 156 and ~38 MB before; hero 147 live of 159 created, 34.5 MB. 9 draw
calls per drawn frame; frames are drawn only when something changes. JS heap 86 MB (/map) and 114 MB (hero) before;
not re-measured after (the change removes work, it adds no long-lived objects beyond the handed-over bitmaps, which
the tile layer owns and closes).

Lighthouse 13.4.1, mobile form, hero bench (`checks/lighthouse-hero.mjs`, niced, under the capture lock,
`am13-lighthouse-hero-mobile.json`): performance 35, accessibility 98, best practices 78; FCP 2.0 s, LCP 6.8 s,
CLS 0, transfer 3.49 MB. TBT (92.8 s) and speed index (20.1 s) are SwiftShader drawing the drifting WebGL hero under
4× CPU emulation: 90 s of the 114 s main-thread time is script evaluation inside Pixi's renderer (`layer-*.js`), which
on a GPU is driver work. Failing audits: `landmark-one-main` (the bench page has no `<main>`; the front page's own
shell gives it one), `is-on-https` and `redirects-http` (the bench is plain http on 127.0.0.3).

### Decisions

- **The first frame comes first.** Every byte and every millisecond of main thread that the still does not need waits
  until it is up: the engine, the second set of workers, the whole names, live. The moving map arriving later is the
  accepted price; it replaces a still that already looks the same.
- **Names head through a query, not a new route.** `?part=head` keeps the gateway's `MAP_READ` allowlist unchanged and
  the head shares the whole's withheld gate; any other `part` is a 400.
- **Brotli is computed in the background**, never on a request, so the first reader after a publication is not made to
  wait for quality 11; gzip covers the gap.
- **Live stays after the moving map.** An A/B with live started at the still showed it slower on both milestones
  (/map 1440 still: median ~8.1 s early against ~5.8 s late; moving map 15–22 s against 12–14 s): its 256 KB and the
  first paint run compete with the still. It was reverted.
- **Faces are preloaded and do not gate the world read.** All seven files are preloaded because the realms' own names
  are lettered in Cyrillic too; letting `unicode-range` decide would save ~100 KB but letter the first frame twice.

### Still owed

- Real-GPU cold-load timings for `/map` and the hero bench at 1440×900 and 390×844 through pc-lease: `chatdom-pc vis`
  shows the remote Chrome drawing 0 frames in 1 s, so no lease was taken and no GPU number is claimed.
- A world-view-only stamp sheet (the 481 KB sheet is the largest still asset on `/map`).
- Outside this lane: `main.tsx` preloads `identity` and `realm` (61 KB gz) on every route; lazy-importing them in the
  `walk=1` branch and brotli for static JS/CSS would take ~70 KB more off the front page (written to front-door's
  `SEAMS.md`).
