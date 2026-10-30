# Spec 01: The Atlas of Kingdoms

Status: **frozen 2026-10-30 — first Atlas consumer handoff**. Current shared interchange reviewed by Astra high; later producer seams freeze when their consumers start.
Vision: `chatdom/ChatDom.md` principles 1, 9, 13–18 and §7; all of `chatdom/Atlas.md`, especially its Decided list;
`chatdom/Artstyle-Soul-Feel.md` §11–12; `chatdom/Quality.md` rules 1–3, 7, 11, 13–16.

## What and why

The Atlas is a beautiful drawn map of real Twitch communities and the front door to their kingdoms. A visitor can
follow ink roads, find a small live neighbour, read a channel's card, and watch it on Twitch. Citizens return home;
monarchs see what their community left on the map and choose a raid. Warm vermilion pigment makes the world live
without turning a small channel into a faint point beside a giant one. The map remembers roads and crowns, and the
land stays where people learned it was. The deepest view is a drawing of a kingdom; entering wakes that drawing into
the real world. This lane builds the whole Atlas, in an order that gives us a real survey map by task 2. Integration
features are complete only when their real producer exists; tests of their adapters never masquerade as that producer.

## Current state

- The repo has vision/build-map documents and a new Solid/Vite web shell. Main owns routing, workspace scripts and
  package manifests outside `apps/surveyor`. `apps/web/package.json` pins PixiJS 8.22.0 and Solid 1.9.18.
- Shared identity, observation and Atlas schemas are implemented in `packages/shared/src/`. The Contracts section
  below distinguishes the first-consumer boundary from integrations main freezes when their consumers start.
  A01 starts after main's review/freeze; later producer seams do not hold its read-only map work hostage.
- The old collector is running outside this repo. Its existing HTTP surface is status, raid SSE and recent pair
  aggregates, as recorded in [atlas-cartography](../references/atlas-cartography.md). It exposes no channel index,
  frozen world, live binary, drawing, authentication, kingdom, pulse, or replay endpoint.
- A supplied source SQLite database is readable. Source tables contain channels, category minutes, raid pairs,
  recorder frames, recorder channel indices and recorder raid observations. The source has **no settled holdings**.
  Its first observation is 2026-10-29 15:44 UTC, so the sample on 2026-10-30 is short of the two-day founding floor.
- `e-atlas` is read-only reference material. Its map look, tile continuity and camera are useful. Its channel names,
  crowds, graph, plot UI, town plans and metrics are synthetic and must not become product data or copied code.

## Rules

### Truth, editions and land

**R1 — Real observations throughout.** A live mark, raid, road, bridge, train, crown or spectacle must cite a
validated source observation or public kingdom fact. A status count is never permission to generate that many fake
channels. Use current Surveyor HTTP status/raid reads and the explicit read-only inventory adapter. Product code
must not call Helix, read unjoined chat, subscribe to Twitch, or change the old collector. No credentials are needed
for this lane's read-only path. Any future Twitch adapter requires `$twitch-dev` and main's contract first.

**R2 — An honest preview before founding.** With less than 48 hours of observations, render an immutable survey
preview artifact labelled “Survey preview · land awaiting founding”, with its observation window and coverage.
This is real data on draft land, not Edition 0 and not SIMULATED. Record a draft revision/hash and preserve its
geometry for a session/share. It may be superseded only as an explicit new preview revision. Do not create
permanent holdings or silently move a viewer's chosen revision. The official Edition 0 command rejects less than
48 hours; Edition I rejects less than 7 days, unreviewed families, or missing founder authorization. Founding an
official edition and publishing it are main/team decisions, never automatic side effects of an import or test.

**R3 — Frozen means testable.** Edition geometry and the holding-to-channel ledger are immutable. World hash,
holding ID, owner and holding tier never change within an edition; no holding has two owners. Nightly settlement
appends atomically after collision/invariant checks. Founded metadata and approved drawings can change separately.
An apparent size may grow at most one tier beyond its holding without moving it. Hide immediately removes a label;
at the next cartography run its visible land becomes waiting, while a tombstone prevents another owner receiving
that holding. Deleted/banned land returns visually after 30 days. Personal erasure must not erase public geometry.

**R4 — Communities determine geography.** A language with at least 600 candidate kingdoms has a continent; smaller
languages occupy separate islands in the Isles of Many Tongues. Realms are about 14 hand-reviewed category families;
variety channels use the Crossroads, small/unmapped families the Wilds, overflow the Outer Isles. Use accumulated
category minutes to choose a main family; document a deterministic diversity rule for variety channels. The
family/name proposal is checked into the lane, with review status and version; never claim founder approval.
Draft geography may be generated from observed counts, but is frozen once an edition is founded. Proportions show
Twitch honestly, rather than forcing all languages into equal pieces. Permanent placement uses channel ID, not login.

**R5 — Every size has land and a mark.** Holding tiers: capital ≥5,000 average viewers; city ≥500; town ≥50;
village ≥25; founded hamlet below 25. Averages are viewer-minutes divided by live minutes, never current audience.
Plan a fine deterministic hamlet-slot grid inside each realm's waiting land, materializing only used slots.
Founded hamlets settle immediately near their weighted raid ties, then the realm heart. Small observed streams
with 5–24 viewers have provisional hash-based pencil places without permanent claims; they may change nights until
settled. From Edition I, a kingdom's raid to one, or its raid into a founded kingdom, grants its nearest free slot
and keeps the road. Before then the caravan can ride without inventing a permanent road. An unseen under-five
target is reached at the edge of known land. Grid exhaustion takes the Outer Isles path, never a duplicate owner.

### Map and interaction

**R6 — Pencil, ink, colour.** Waiting land is graphite; a mapped public channel is an ink town stamp and two-tincture
shield seeded by channel ID; a founded kingdom has its own arms, colours, emote banner and approved drawing. A stamp
composition is a valid founded fallback until its first drawing passes review; do not mark any public channel as
founded without a founded record. No streets, plots, citizen names, homes or live player positions appear on the map.

**R7 — Four useful distances.** World: continents/seas, capitals, aggregate live wash and busiest roads. Continent:
realms, cities, busy roads/sea lanes. Realm: towns, roads with ≥3 raids, train lines and pennants. Kingdom: villages,
hamlets, every visible road and full founded drawings. Founded active names appear one level earlier and in colour.
The deepest zoom is approximately z9, with a founded drawing about 400 CSS px wide on a laptop; it never becomes
a plan. Labels/shields collide greedily with stable tie-breaking; keep about 300 shields in view and at most 2,000
near live marks on phone. A selected result remains readable even if its ordinary tier would hide its label.

**R8 — Paper never becomes night.** The day map has paper grain, ink coastlines, ripple lines, watercolour land and
sea, mountains/trees/town stamps, per-channel heraldry, a compass rose and a sea monster. Live is multiply-blended
vermilion pigment, clamped toward pigment rather than black/white glow. World zoom draws one density layer. Close
up the wash softens and the standard hoists its pennant; offline it is bare. Five classes: ≥5,000 double long
pennant; ≥500 long; ≥50 medium; ≥25 short; 5–24 pencil flag/dab. Inputs are average-audience class plus actual
current live state. Bloom follows real `started_at`, rather than pretending every stream began at refresh time.
No time-of-day layer, dark paper, luminous halos, animated fake traffic, or money-based emphasis.

**R9 — A camera that keeps its promise.** Float64 map coordinates; anchored wheel/pinch zoom; one-finger pan;
mouse drag, double-click, hover and click; smooth inertia and interruptible van Wijk flights below 3 s. Search
flies to the result, opening a card without covering the selected mark. Pointer cancel/blur/resize/unmount cannot
leave a gesture active. Keyboard controls, visible crafted focus, search results and card actions work without
canvas picking. Escape closes the top surface and restores focus. Back restores the previous route/view. Cards
are bottom sheets at 390×844, search stays at the top, homes use one counted button. Every input visibly answers
within 100 ms. Respect motion preferences with a short, composed movement, without inventing a new product mode.

**R10 — No holes or giant downloads.** Static terrain tiles have neighbour-continuous edges, ancestor fallback,
cross-fades and a bounded LRU texture cache. Edition 0 pre-bakes z0–z6 and permits worker baking of deeper static
land; Edition I pre-bakes every level up to the stop. Load settlers by continent and tier, capitals/cities first.
Atlas is a lazy PixiJS/WebGL2 route, with no three.js or kingdom connection during map browsing. Pan/zoom never
calls Twitch or rooms. No WebGL shows a real dated still of the same revision with working DOM search/cards.
Context loss preserves camera/selection and reloads resources; a tile failure keeps its ancestor and offers retry.

### Life, memory, discovery and privacy

**R11 — Feed alignment and freshness are part of the display.** Validate schemas and manifest hashes before use.
`live.bin` v2 has two bytes per settler in the agreed order, size class then spectacle. Edition/order/hash/count
must match before applying it; a truncated or reordered payload is rejected, never interpreted as offline.
Use the shared dabs format, which carries realm/hash/start time and no names. Fetch initial live state, subscribe
once, reconcile every 60 s; the producer rewrites every 30 s. Preserve actual event time, observed time, source
coverage, cursor and replay origin. SSE gaps/refusals/stale input keep the last coherent map with “Live as of …”
and stop presenting new life. Recovered raids build memory without being replayed as live caravans. Reconnect
deduplication survives process restart; recent pair aggregates are not individual events. An out-of-order snapshot
cannot roll an event state backward. At >10,000 viewers the transport can switch to 10 s edge-cached event files
with identical cursor semantics, rather than a new client protocol. Document observed raid-watch coverage, sweep
floor/cap and missing facts so “not observed” cannot be read as “no raids” or “offline”.

`live-v2` has no unknown state: a partial sweep must never zero absent channels or be served as a complete live
frame. Retain the previous complete coherent snapshot and **its original observation time**, expose partial/gap
status separately, and publish a replacement live frame only after a complete sweep. If there has never been a
complete frame, show live state unavailable. Never relabel older bytes with a fresh publication time to revive
their freshness. Test a partial sweep with a previously live channel absent, and prove it neither goes offline
nor becomes falsely fresh. The producer and consumer both reject partial live manifests for normal display.

**R12 — Real roads, durable stories.** A new observed raid rides 12–30 s by distance with its source banner,
traveller count, a quiet on-screen horn and ink road behind it. Cross-language routes are sea lanes. Aggregated
pair counts thicken roads without inventing constituent event times; selected kingdoms expose all their roads.
An unused road fades to a faint dotted line after a season and never disappears. Three or more sequential raids
whose target next raids within 12 hours form a train; detection is deterministic, deduped and handles forks without
inventing a stop. A train gains a carriage at each real stop and remains as a named line. Use a factual unnamed
line description until the real Voice supplies an approved name; only the initiating monarch can rename it.
Shared chat between founded kingdoms draws bridges, with a ring for up to six and a lasting bridge mark afterward.
Three raids or a shared chat create embassies in a daily derivation. A shoutout creates a signpost, never a road.

**R13 — Public aggregates, private people.** The Atlas has no person search or directory, cross-channel viewer
history or public homes/travel layer. A path, trade route, shared-citizen count or settlers count derived from
people requires ≥20 distinct eligible people and displays a shared-contract band, not the underlying count.
Shared citizens count signed-in consented citizens only and honor opt-out. Footpaths derive weekly per season;
trade routes use actual swaps between kingdoms, never direct cross-kingdom sales. Personal homes/passport remain
on citizen cards produced elsewhere, with the passport hide switch; the Atlas links only the current viewer's
own card. The monarch alone receives exact settlers when founding, over an authorized private API.

**R14 — Spectacle never buys attention.** One founded spectacle at a time at realm distance or closer, priority:
crown, dragon, Hype Train (fireworks at level ≥3), festival, raid gathering. Pulse age controls expiry. It never
affects placement, tier, label priority, recommendations or score. A live pennant is ordinary life, not spectacle.
The busiest ordinary movement is a caravan. Decorative ships remain in open water and never connect kingdoms.

**R15 — Discover lovely small places.** “Follow a road” chooses a real live neighbour with a documented preference
for smaller communities, without pretending missing quality data is a score. The front notice board holds real
Kingdom of the Week, tonight's founded kingdoms, longest road and crowned hamlet when their facts exist. Season
board filters a common bracket across continents; permanent crowns remain on shields, with factual citations and
the real crowning order. Discovery consumes versioned quality/contribution facts from the season authority; the
Atlas does not manufacture ratings from audience. Size is normalized and money/spectacle are forbidden inputs.
Missing notices have a designed quiet board or a truthful explanation, never invented winners.

**R16 — Safety and retention are actual projections.** Gambling categories are excluded; predominantly mature
channels show only at kingdom zoom and never in recommendations. Unknown content-label coverage is visibly
reported and excluded from recommendations until a valid policy input exists. Do not infer labels from titles.
Content-label collection/intake-count additions in the old collector were not approved; record `needs:` for main
rather than modifying it. Every named card links to its Twitch channel. Raw names/avatars/titles refresh daily;
titles clear 24 hours after last live, and stale names/avatars fall back to the designed shield/state. Hide,
ban/deletion, name moderation and revoked drawing approvals invalidate cards/search/share/tiles immediately at
the relevant projection, with no private refusal words leaking onto the map. Derived-data retention and recorder
retention are configured and documented pending Twitch's written answers; don't erase or extend the source
collector's data. No public bulk graph/data export, sale of data, browser secrets or production configuration.

### Entry, account overlays, replay and links

**R17 — Public cards are useful today.** Search kingdom/channel name or login in every script, Unicode normalized
without erasing the original spelling. Cards distinguish mapped, waiting and founded. Mapped: channel/avatar or
shield, realm/tier, actual live game/title/viewers, strongest three observed roads, Watch, share/tell and an
authorized settlers action when available. Founded: kingdom/channel names, arms, founding date, approved drawing,
lights/public citizen band, crowns, embassies, eligible overlap bands, roads, relation, Enter and Watch. A named
unmapped search result remains discoverable even without land; fly to its pencil place or edge rather than moving
a holding. Never show an enabled action without a working service. A missing foundation, unavailable watch data,
no results or failed read has a crafted explanation and a way forward. Escape/back and retry retain the camera.

**R18 — An account overlay belongs only to its viewer.** The signed-in viewer sees their own realm ring, up to
three home keys, tents and a homes ribbon ordered live first. A monarch's castle is separate from the home cap;
being monarch somewhere grants no authority elsewhere. Current-kingdom/friend pins come only from a mutually
consented private response with revocation and expiry, never from public pulses; no position inside a kingdom.
My Twitch asks for `user:read:follows` at point of use through the auth service, underlines only this viewer's
channels, holds them only in memory for this view, and clears on close/sign-out/revocation. Do not infer follows or
write them into Surveyor/cartography caches. Without auth, the public map remains complete and useful.

**R19 — The drawing wakes only when the world is ready.** Entry stamps a wax seal within 100 ms. The auth adapter
saves and restores map/selection across sign-in; its result is validated before any realm role is shown. Over
0–0.6 s zoom into the approved drawing. It stays as the loading scene, with real progress text from the world and
a raven for overrun. Two stacked canvases cross-fade only after a ready first world frame at the drawing's hero
angle; colour flows from the castle and the camera descends to castle/home/gate according to authoritative role.
The reveal is about 1.5 s, not a fake loading timer. Card intent prefetches the engine/drawing/snapshot; signed-in
hover may open the target room through the authorized entry coordinator. No other map interaction joins a room.
Return via M/map button/Back rises for 0.8 s and unfolds the saved Atlas view; the world coordinator retains the
world for 60 s. Failed auth/load, denied destination, cancellation and disconnect return to the same coherent map
without falsely reporting arrival or stamping a passport. Full parchment-to-voxel rise belongs to live Genesis.

**R20 — Travel and the Raid Gate use real authority.** Travel orchestrates rise from A, road flight 1.5–3 s,
destination drawing and authoritative arrival/reservation/rollback; a confirmed visit/ride then grants its real
passport stamp elsewhere. A public raid caravan is also the party's journey. Raid arrival links begin at the real
source. Gate mode is only the current realm's monarch: live road neighbours, same/nearby realms then search,
smaller first within each group, allowing any live Twitch target. Show the authorized preview before requesting
Start a Raid; confirmed Twitch state starts the procession, cancel turns it home, unknown outcome remains unknown
until reconciled. Atlas never calls Twitch or grants royal power. Outbound live checks remain limited to `tobi4s_`;
the lane uses labelled simulation and main's action service, not a new raid writer.

**R21 — Replay is dated, deterministic memory.** Decode actual recorder version-1 frames and raid observations
through a read-only import. A history scrubber selects an available interval and speed; date/time/speed remain
visible. Replays never mix with a live SSE feed or claim today's live state. Missing recorder segments are gaps;
the UI holds or skips explicitly. Real frames use their historical index mapping, not today's settler order.
Speed changes and backwards seeks rebuild a deterministic state without duplicating roads/trains/crowns. Missing
historical channel content uses an honest shield/name-unavailable state rather than preserving expired raw data.
Simulation exists only in explicitly selected fixtures/inspection with SIMULATED visible on screen and in shares.

**R22 — Links and stream presentation are the same map.** Support `/map`, `/map/<login>`,
`/map/road/<login>/<login>`, `/map/line/<id>`, `/map/season/<n>`; `/atlas` remains a possible Twitch login, never a
reserved Atlas route. `/ <login>` without the space is main's kingdom entry route. Share cards are server-rendered
parchment/drawing/seal/name/realm/live-as-of with source/cache dates; Twitch content obeys the daily expiry rule.
Stream/director mode reuses the map, already preloaded, for raid out/in, tonight's roads and season crowning. It
removes tiny viewer counts and private overlays and composes for 1920×1080 plus 1280×720. Main integrates metadata,
root routes, still/share endpoints and director hooks; this lane provides tested functions/assets, not root edits.

## Contracts

The actual `@chatdom/shared` runtime schemas and codecs are authoritative. Current first-consumer exports live in
`packages/shared/src/{identity,events,surveyor,atlas,atlas-binary,atlas-raids}.ts`, exported from `index.ts`.
Their narrow interchange v1 is frozen after independent Astra high review. Do not reproduce their wire definitions locally.

| Frozen first-consumer boundary | Exact exports |
|---|---|
| Source observations | `SurveyorStatusSchema`, `SurveyorRaidSchema`, `SurveyorRecentRaidsSchema`; their inferred types |
| Edition / public projection | `AtlasEditionSchema`, `AtlasSettlerSchema`, `AtlasChannelSchema`, `AtlasEvidenceSchema`, `atlasFreshness`, `assertSettlerIndex`, `assertSettlersAppendOnly` |
| Alignment and artifact manifest | `AtlasAlignmentSchema`, `AtlasManifestSchema`, `AtlasLiveStartsSchema`, `createAtlasAlignment`, `assertAtlasAlignment`, `sha256Hex` |
| Binary codecs | `encodeLiveV2`, `decodeLiveV2`, `decodeLiveStartsV1`, `encodeDabsV1`, `decodeDabsV1`, `ATLAS_LIMITS`, `ATLAS_SPECTACLE` |
| Normalized raid observation | `AtlasRaidSchema`, `AtlasRaid`, `adaptSurveyorRaid` |

`live-v2` is headerless and exactly two bytes per global settler ordinal. `live-starts-v1` is a required aligned
JSON sidecar with one entry per live ordinal and an actual start time or explicit null; null never triggers an
invented bloom. `dabs-v1` is headerless, twenty bytes per record: little-endian u32 realm, eight raw channel-hash
bytes, little-endian u64 Unix milliseconds. Its channel hash is the first 64 bits of SHA-256 of the decimal channel
ID, never a person hash. The manifest binds edition/world/settler order/count, observation origin/as-of,
publication time, realm count, coverage, lengths and SHA-256 of all three artifacts. Shared limits bound allocation.
Freshness uses the injected clock and the shared 270,000 ms threshold, preserving replay/simulated/clock-skew states.
The sidecar, decoder and test coverage are required; do not squeeze timestamps into the two live bytes.

The following is the integration checklist for the **whole Atlas**. Rows not in the current export table are
explicitly unfrozen future producer seams; they do not block A01–A03's current observations, land and public-map
work. Main freezes them before their first actual consumer. Local render models can express the requested view
without inventing a shared auth/pulse/travel/score protocol.

| Boundary | Consumer obligation |
|---|---|
| Identity / observation envelope | Twitch IDs remain strings; source/origin/time are explicit; public DTOs cannot carry private viewer state |
| Surveyor status / raid / pair adapter | Validate raw JSON; distinguish a pair aggregate from an event; source lacks durable event IDs and replay cursor, so the new ingest ledger supplies durable observation IDs without claiming unavailable upstream identity |
| Edition, holding, settler / asset manifests | Validate edition/world/order hashes, counts, content versions and projection status; retain ledger tombstones; immutable assets are content addressed |
| Live binary v2 / dabs / live event envelope | Use shared codec, limits and exact ordering; reject mismatched edition, unknown required version, invalid class/code, bad length and cursor regression |
| Public pulse | Source-authenticated producer; current/fresh public presence band, spectacle, founded drawing version; no locations, names, roles, private state or chat text |
| Search / public kingdom card / drawing | Schema validated, source as-of/coverage, founded metadata separate from land, approved hero image and camera descriptor; original script kept |
| Entry / map link / travel descriptor | Only target/entry presentation and coordinator correlation; authorization, reservation, role and passport award stay with their authorities |
| Privacy band / current-viewer overlay | ≥20 threshold enforced before public publication; private current-viewer data never shares public DTO caches |

Advanced Atlas-local derivations (road/train/bridge/embassy/history/board render models) may be pure internal types
over validated public facts. They may not establish new global event, auth, consent, score, or travel protocols.
If a necessary producer/contract is missing, write `needs:` in progress, give main the smallest explicit seam and
continue another unblocked task. A simulated adapter may verify presentation but does not close the real integration
acceptance. Nothing in this spec authorizes editing shared schemas or silently replacing them with local wire types.

## Implementation and integration ports

- Default export a Solid `Atlas` component from `apps/web/src/atlas/index.tsx`, no props required. Main lazy-loads it
  for `/map` and `/map/*`. Dispose Pixi, workers, listeners, audio and transport on unmount; preserve only intentional
  route/session state. Use `@chatdom/shared` exports and local styles/assets. Do not alter global typography/styles.
- Main has pinned PixiJS in the web manifest and proxies `/map-data` to `http://127.0.0.1:5193` for dev and preview.
  Default client base is `/map-data`; `VITE_ATLAS_BASE_URL` can explicitly override it. No production host or source
  database path is hardcoded. Main owns actual hosting/CDN/API routing and security configuration.
- New `@chatdom/surveyor` package in this repo is an **Atlas read/export/cartography service**, not a replacement
  Twitch collector. Use `SURVEYOR_BASE_URL` for existing HTTP reads; use explicit `SURVEYOR_DB_PATH` only for missing
  inventories, via `node:sqlite` `readOnly: true` and a consistent short transaction or supplied snapshot. Never
  change pragmas, source tables, WAL or retention; never launch the prototype runner or touch its containers.
- All writes go to this service's own `ATLAS_DATA_DIR`. Atomic generation writes a temporary revision then swaps
  a manifest after validation; a failed import keeps the last good revision. Concurrent exports cannot mix snapshot
  indices, counts or recording frames. Keep an ingest ledger/checkpoint, source provenance and restore procedure.
- Its local server binds `127.0.0.1:5193` by default and serves only required product assets/card/search/feed/still
  routes below `/map-data`. No public SQL, arbitrary file reads, credentials, broad graph dump or debug table browser.
  Validate IDs/path traversal/query lengths and bound result counts. Private adapters use a separate authorized path
  and are absent from public static exports. Upstream failures have bounded timeout/backoff, no retry storms.
- Main supplies runtime/auth/world/season/Herald integrations through modules once those boundaries freeze. Expose
  small adapter factories from the Atlas directory rather than importing the whole engine into its public route.
  The lane's integration tests drive those adapters with explicitly labelled fixtures until the real producer exists.
- Render exactly one `[data-chatdom-atlas]` root so the shot script cannot mistake the foundation bench for a map.
  `window.__chatdomReady` becomes true after the first meaningful coherent map frame, fonts, camera and initial
  state. An unavailable feed may render a designed failure state, but the acceptance check must still distinguish
  that from a successful map. Record a public revision/as-of in the DOM for deterministic screenshot assertions.

## Scope

May write only:

- `apps/web/src/atlas/**` — client, imported local assets, rendering, UI, adapters and tests.
- `apps/surveyor/**` — new package manifest, source/tests/CLI, cartography data, reviewed taxonomy proposals,
  license inventory, generated-asset tooling and its own ignored local runtime output.
- This spec, `work/lanes/atlas/PRD.md`, `work/lanes/atlas/progress.txt`, and `work/references/atlas-cartography.md`
  for task evidence, decisions and needs. Main approves changes that affect the contract or final scope.

Everything else is read-only, especially `packages/shared`, root manifests/config/lockfile, web routing/global CSS,
`packages/testing` and the old prototypes/collector. New dependencies outside this service, ignore rules, root tests,
licenses in `THIRD_PARTY.md`, repository screenshots/evidence paths and root script extensions go through main.
The shot script may write its existing gitignored output; do not add a new repository evidence tree outside scope.
Never run git in sub-agent work. Main handles branch/worktree creation, integration and pushes; the lane worker
records one green coherent commit per task on its lane branch as required by `$ralph-lane`.

## Acceptance

Before the lane starts, main freezes reviewed shared schemas and this spec, creates the worktree, and confirms root
scripts. Every task must keep `pnpm verify` green (typecheck, lint, tests, build, baseline shots). The lane adds
meaningful domain/flow tests beside the code; do not create empty tests merely to make a task look complete.

The new service must implement these exact executable scripts in `apps/surveyor/package.json`:

```sh
# Import the supplied source without source writes; output only to an owned runtime directory.
SURVEYOR_BASE_URL=http://172.17.0.1:3541/atlas/api SURVEYOR_DB_PATH="$SURVEYOR_DB_PATH" ATLAS_DATA_DIR=shots/atlas-data pnpm --filter @chatdom/surveyor atlas:import
ATLAS_DATA_DIR=shots/atlas-data pnpm --filter @chatdom/surveyor atlas:check
ATLAS_DATA_DIR=shots/atlas-data pnpm --filter @chatdom/surveyor atlas:serve
# In another terminal, with that service running:
pnpm --filter @chatdom/web build
pnpm shots --area atlas
pnpm verify
```

The source locations above are **this environment's invocation**, not defaults to commit. If the source cannot be
read, fail clearly and retain the last good artifact; a sanitized observed fixture may test import but never count
as a fresh live-map check. The check script validates referenced asset existence/hashes, immutable world and holding
invariants, metadata retention, privacy thresholds, binary/order alignment, no unapproved founded records and coherent
source dates; it prints a concise success/failure summary plus artifact revision. It must reject a corrupted copy.

Required automated evidence, grouped by behavior rather than mirroring functions:

| Area | Demonstration |
|---|---|
| Source truth | Real import contains actual channel IDs and current as-of/coverage; failed/missing inventory never manufactures channels; read-only source opened; no write SQL path exists |
| Land | Same snapshot/seed/version produces same geometry/settlements; appended channels do not move prior owners; duplicate ownership/exhaustion/hide/tier growth checked; official founding age/review gates reject |
| Feed | Duplicate raid, aggregate reconciliation, restart, event-time reorder, SSE gap, partial sweep with missing live channel, schema/hash/length mismatch, unknown version and stale pulse preserve coherent state and original observation freshness |
| Privacy/safety | Public projection cannot contain person/home/follow/friend data; 19 distinct people suppress, 20 yields a band; opt-out/revocation and unknown labels propagate; expired raw content disappears from shares/search too |
| Camera/render | Pointer anchor holds, pinch-to-pan transition and cancel behave, flight interrupts, sheet padding and back restoration work; no tile holes/seams with delayed or failed tiles, bounded caches and overlay count |
| UI | Real named search/card/watch route on desktop+phone; Unicode/RTL/long names, zero results, empty roads, offline, transport failure, context loss and WebGL-free still/search work without raw errors or overflow |
| Memory | Actual raid chain detection including forks/late/duplicate edges, road fading without deletion, replay seek/speed/gaps and live/replay isolation |
| Integrations | Entry ready/cancel/denied/auth resume; home cap/castle distinction; consent expiry; score source/money exclusion; gate preview/confirmed/cancel/unknown; no fake arrivals or premature passport grants |
| Cost | Public `/map` chunk excludes three.js/world room packages; browser map tour makes no Twitch/realm requests; record texture memory, draw calls, initial transfer, overlay counts and first meaningful frame |

Visual evidence: run the repo shot script and **open every relevant image with `view_image`**. Standard results are
`shots/atlas/atlas@1440x900.png` and `shots/atlas/atlas@390x844.png`. Also capture kingdom-depth card, stale feed,
search-empty, road selection, real dated replay and founded/entry states as they become real, through an Atlas-local
Playwright suite using the same Chrome/SwiftShader launch configuration. Store additional captures under
`shots/atlas/`; labelled integration fixtures use filenames beginning `simulated-` and an on-screen SIMULATED mark.
Director captures are `shots/atlas/director@1920x1080.png` and `director@1280x720.png`. Main may extend `pnpm shots`
to those scenarios; the lane may not silently replace the shared script. Review motions and audio as well as stills.

Real-device targets, never claimed from SwiftShader: first map frame <1.5 s laptop/<3 s phone on broadband;
laptop 60 fps, phone ≥30 fps; director 1080p60 within ~4 ms GPU cost and 1–8 draw calls where the measured composition
permits. Entry explorable <3.5 s laptop/<8 s phone/~2 s repeat. Report actual transfer/memory/cost and any required
real-device follow-up, not invented benchmark results. A missing downstream producer is an explicit outstanding
acceptance item; adapter tests alone do not mark the entire task or lane done.

## Quality bar

The coast, paper, land wash and heraldry must stand beside the reference hero frame without embarrassment. The
map reads in a 160 px thumbnail; the small live flag has its own dignity. Calm ocean/air motion never looks like
fake raids. Warm pigment serves presence on this day map; the kingdom's window-light rule does not add map lights.
Carved wood/brass/parchment/wax share one type and icon system. No generic dark cards, emoji, default controls,
spinner, repeated identical sounds or unexplained counts. Use real source assets with verified rights, packed under
owned folders; no image generation belongs in this code lane. Every meaningful action has matching varied paper,
wood, brass, wax or horn sound, unlocked after the first user gesture and respecting mute. Suppressed autoplay is
not an error. Phone sheet/search/nav and every error/empty/offline state receive the same finish as the hero view.

## References

- [atlas-cartography](../references/atlas-cartography.md): MapLibre/OpenLayers gesture and flight discipline;
  e-atlas tile continuity and visual composition; exact Surveyor gaps, source format and asset-license evidence.
- [prototype index](../references/prototypes.md): wider prototype findings; reimplement only the pieces this
  vision retained. `chatdom/Atlas.md` overrides prototype street/plot/night/graph-generation behavior.

## Not now

This lane does not implement or redesign the voxel engine, Genesis, identity/auth, private citizen cards/passport
storage, kingdom simulation, Twitch collector/subscriptions/outbound actions, season scoring authority, or CDN/
production/server configuration. It owns their Atlas consumers and integration demonstrations, and records missing
producers as dependencies. These boundaries preserve the whole experience; they are not permission to drop its
map-side homes, travel, raids, replay, season or entry behavior. No official founding/publishing, legal answer,
content-label collection expansion or production migration is inferred from a green test.

## Decisions

- **2026-10-30 — Survey preview before official founding.** Main approved an immutable real-data draft labelled
  “Survey preview · land awaiting founding” so task 2 can be visible now. Edition 0 ≥48h and Edition I ≥7d plus
  founder/taxonomy gates remain. The source currently covers about nine hours; its zero settlers are not a bug to fix.
- **2026-10-30 — Preserve the running collector.** Existing HTTP reads are primary. New read-only database/snapshot
  adapter fills missing inventories through explicit environment configuration; all derived writes use a new store.
  No source service, database, production port/container or retention is altered.
- **2026-10-30 — Integration belongs to main.** Solid default component at `apps/web/src/atlas/index.tsx`, route
  `/map/*`, `/map-data` dev/preview proxy, PixiJS 8.22.0, new local Atlas service on 5193. Root/manifests remain main's.
- **2026-10-30 — Scope and status.** Comprehensive map behavior is specified now. Shared exports and advanced producer
  seams are separated: review/freezing of the existing first-consumer exports opens A01; main freezes each later
  producer seam before its consumer starts. No lane is ready merely because a PRD exists.
- **2026-10-30 — Partial data is not offline.** Main's review identified that live-v2 cannot encode unknown.
  Producer and consumer retain the last complete coherent frame and its observation time during a partial sweep;
  partial/gap coverage is separate, never rewritten bytes falsely showing offline or fresh data.

- **2026-10-30 — Main freezes the first consumer boundary.** Independent Astra high review passed after explicit clocks/origin, partial-sweep rejection and raid observation-time integrity fixes; 22 contract tests pass. Identity/event and Atlas interchange v1 alone are frozen. Public publication still requires A01’s real exporter and canonical visibility gate. Later producer seams remain unfrozen until their consumer starts.

- **2026-10-30 — A01 observation snapshot.** `@chatdom/surveyor` exports one read-only transaction into content-addressed
  revisions (`obs-<asOf>-<hash>`), so an identical source gives the same revision and re-import is a no-op. Channel and
  live state are cut at the last complete sweep; raid inventories are cut at the database read because raids arrive
  between sweeps, and each keeps its own observation time. The candidate rule uses the source's form
  (`viewer_min ≥ 25 · live_min`) on the exported minutes so export and check agree. Categories Twitch reports with an
  empty name stay real categories with a null name. Revisions keep three by default to bound raw-content retention.

- **2026-10-30 — A02 survey preview artifact.** Each imported revision gets one immutable preview under
  `<dataDir>/previews/pv-<asOf>-<sha12(kind:algorithm:revision)>/`: `world.json` (regions, real language and category
  names, coasts as delta-encoded fixed point ×20, decor, capitals and cities) plus `region-<i>.json` (towns and
  villages, fetched only when the camera can mark them) and a hash-pinned `manifest.json`. It is verified before
  publishing (hashes, schema, every holding on land, no overlaps), pruned with its revision, and served from
  `/map-data/v1/preview` (pointer) and `/map-data/v1/preview/<id>/…` (immutable, ETag, gzip). Algorithm
  `survey-preview-3` (see the A02 visibility decision below for what changed from `-2`): languages with ≥600 candidates are continents, the rest isles of “The Isles of Many Tongues”;
  a ragged strait always parts two languages; inside a language, channels cluster by the category they streamed
  most (small categories pool by game ID, so no invented community names); holdings are packed by sunflower placement and relaxation, land is a smooth union of
  the clusters with seeded noise, coasts are marching squares + Douglas–Peucker. It is draft land: A03 owns the
  stable geography.
- **2026-10-30 — A02 drawing.** The land is a Canvas2D tile pyramid baked in workers on CPU-backed canvases
  (`willReadFrequently`); GPU-backed worker canvases deferred all raster into the single GPU process and stalled the
  map's WebGL uploads (28 s → 3.7 s to first complete view under SwiftShader). Coast detail is seeded by world
  endpoints, so neighbouring tiles meet without seams. Holdings, shields and type are a Pixi overlay in screen space:
  each tier is a survey mark until its distance (R7: cities at continent, towns at realm, villages at kingdom), then
  a K. M. Alexander CC0 stamp; stamp + name + shield are placed together in stable priority order (tier, observed
  average, channel ID), names try below/right/left/above, ≤300 shields. Decor bands keep clear of the tiers marked at
  each band. Arms are seeded only from the channel ID (`heraldry/`, two tinctures, rule of tincture, no vermilion).
  Map units are drawn as leagues on the scale bar. A tab keeps the preview it first drew (sessionStorage pin) and
  offers a newer survey instead of redrawing under the cursor.
- **2026-10-30 — A02 visibility gate and names projection (review fix).** One gate, `publicVisibility`
  (`apps/surveyor/src/policy/visibility.ts`), decides what may be published about a channel: gone and gambling
  channels get no land; withheld channels lose their mark and name. Gambling is the versioned list
  `gambling-categories-1` of Twitch's real-money categories by game ID (Slots 498566, Virtual Casino 29452, Poker
  488190; simulator games that mention casinos stay), applied when they hold ≥25 % of a channel's observed minutes
  or its latest stream was in one; the preview records the policy version and the count kept off (590 of 28,881
  candidates in the real 2026-10-30 04:02 survey). Raw logins and display names are no longer in the year-long
  immutable files: those carry geometry keyed by channel ID only. Names live in the preview's `names.json` (pinned
  by its manifest, pruned with its revision) and leave the service only through `/v1/preview/<id>/names`, a
  `no-cache` projection that omits any name the source has not confirmed within 24 h (the card and map fall back to
  the shield) and lists withheld IDs without reasons. Withholding is the service-owned
  `moderation/withheld.json`; it reaches new maps at once and open maps at their five-minute names refresh, without
  redrawing immutable land (the frozen edition's ledger and tombstones are A03). An unreadable list refuses all
  names (fail closed). The browser also drops each name locally at its `freshUntil`. Every Atlas read has a bounded
  timeout covering headers and body (pointer 10 s, names 15 s, chunk 30 s, world 45 s) and ends in the designed
  failure state with its retry; the first view waits for land and names, or for names to fail on their own.

- **2026-10-30 — A03 stable geography and editions.** Algorithm `survey-preview-4`, taxonomy `families-1`
  (`apps/surveyor/src/cartography/families-1.json`, 14 families, 91 games left unassigned with reasons, **proposed**
  until the founder reviews it; the map shows plain family names, the `realmName` proposals wait for that review).
  - **Realms.** A continent has the Crossroads at its heart (variety rule `variety-1`: ≥120 min, top community
    <50 %, ≥3 communities ≥12 %, a family counting as one community), one realm per family with
    ≥max(24, 1.5 %) of its channels (`realm-threshold-1`), and the Wilds at its edge. An isle is one realm. Game
    patches sit inside a realm.
  - **Contiguous land.** Nested circle packing left voids that became sea and split continents into realm
    islands, so all of a region's patches are relaxed together. Each patch is pulled to its realm's centre and
    gently to the heart, then pushed apart with a wider gap between realms. Realm circles are area-equivalent and
    serve as the power-distance membership for later slots.
  - **The Outer Isles.** Six empty, lobed islands of no language (about 5 % of the land) take overflow.
  - **Hamlet lattice `hex-1`.** Fixed point in 1/20 units, pitch 1.6 × 1.4 with odd rows offset, shore 0.9, gap
    0.6. A slot is `s:i:j`, a founding holding `f:<ordinal>` in channel ID order.
  - **Editions.** An edition is `editions/<ed-0|ed-1>/` (edition, founding, taxonomy bytes, world) plus a
    hash-chained, canonically encoded `ledger.ndjson` (settle / tombstone / restore / night). `heads.ndjson`
    acknowledges every head, so any earlier address is provably unchanged. Withheld channels get a hidden
    tombstone and gone channels a gone tombstone (30 days abandoned, then waiting land). Land is never re-granted.
    The holding tier is fixed and the map may draw one tier of growth. Edition I alone grants land by raid, and
    only to observed targets.
  - **Founding.** Founding needs the source's own window (48 h / 7 d), a reviewed taxonomy for Edition I, and an
    Ed25519 founder authorization over {edition, revision, taxonomy hash, issuedAt, issuedBy} that verifies
    against `ATLAS_FOUNDER_PUBLIC_KEY`. Every refusal is logged. Nothing founds by itself.
  - **Withheld at founding (review fix).** A channel on the withheld list when an edition is founded keeps the
    land it was drawn on (the world stays the preview's drawing), and its holding gets a `hidden` tombstone in the
    founding night itself, so it is waiting land from the first read and nobody else can be granted it. The founding
    reads the list once and fails closed when it is unreadable; `founding.json` records `withheld: {key, hidden}`
    and `check` proves it matches the founding night. A tombstone is lifted only when the revision observed the
    channel, neither gone nor withheld: leaving the list while missing from the sweep restores nothing.
  - **Every settle run reads moderation (second review fix).** `atlas:settle` reads the withheld list (once,
    fail-closed) before it decides anything. Without a newer revision it no longer stops at "up to date": newly
    withheld holdings get `hidden` tombstones in that run (`at` = the run, `revision` = the last settled night),
    with no night line and nothing else changed. Hiding is immediate; lifting still waits for a revision that
    observed the channel. Every append, night or moderation, is first verified as the whole edition it would make
    (old ledger + new lines, every head + the new one, founder key) from the exact bytes that were verified; only
    an edition that passes is renamed over the old ledger, otherwise ledger and heads stay untouched.
  - **Proof.** `atlas:check` rebuilds the preview byte for byte and verifies every edition.
  - **Real-data evidence (2026-10-30).** A rehearsal on three real revisions settled two nights with 0 holdings
    moved. Edition 0 and Edition I foundings were both refused (13.9 h observed, proposal taxonomy, no key, no
    authorization). A later run (2026-10-30 16:32 UTC):
    - Inputs: real imports `obs-20261030T162623Z-6d3443af9151` and `obs-20261030T163224Z-8fff6dfa7def`
      (24.8 h, 497 sweeps, 260,923 channels, 0 rejected rows).
    - `atlas:check` OK and the preview rebuilt byte for byte.
    - The rehearsal drew 36,881 holdings in 135 realms with 585,915 free hamlet slots.
    - One night settled 133 newcomers (29 by raid, 0 outer, 0 deferred, 1 unseen raid target), with 0 holdings
      moved and every earlier address held.
    - Edition 0 and Edition I were refused again (24.7 h observed) and logged. No `editions/` directory exists.
  - **Hidden outranks gone (port fix).** A channel both gone and withheld gets a `hidden` tombstone, so its land
    waits at once instead of lying abandoned for 30 days. A holding already tombstoned as gone that is then withheld
    gets a `hidden` tombstone over it in the next run, by a night or by the moderation pass between surveys. The
    ledger accepts exactly that replacement (gone → hidden) and refuses every other second tombstone, so nothing
    replaces a hidden one and no cause is laid twice. This closes the three cases the last A03 review left open.
