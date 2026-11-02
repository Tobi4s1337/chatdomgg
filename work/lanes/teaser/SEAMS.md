# Teaser seams

The teaser reads every lane and edits none. This file lists what it reads from each lane, when, and what it asks for.
An ask is a request, never a change to that lane's files. Until an ask is answered, the teaser works around it inside
`apps/studio`: CSS or a shim in the studio's own frames, a set piece built from the product's modules, or a real still
as a stand-in.

## When

- **Sun 1 Nov, 22:45, to Mon 2 Nov morning (TS10, TS11):** the teaser shoots today's build, which is main at `0e92df4`
  as checked out in this worktree, plus whatever main the reviewer merges in overnight. It may read other lanes'
  worktrees to see what is coming (hooks, params, fixture triggers), but never builds or shoots from them.
- **Mon 2 Nov, after the integration (TS12):** once main holds the other lanes' goal 1 work and the reviewer has
  merged main into `lane/teaser`, run `apps/studio/rig/hooks-check.mjs` on this worktree's build. It reports every hook,
  route and param below as present or missing. Update the shot scripts, then re-shoot every shot. The freeze time is
  Tobias's call (PRD Backlog).

## What the teaser reads, by lane

| Lane | What the teaser reads | Used in | Today (main `0e92df4`) | Ask |
|---|---|---|---|---|
| grand-world | The grand land as the kingdom's land; the kingdom scene and its hooks (`window.__chatdomKingdom`: `pose(eye, target, fov)`, `seek(time, view)`, `hour(h)`, `capture(time)`, `stats`); the stream view and its director (`/stream` params `source`, `seed`, `tier`, `hour`, `time`, `camera`, `layout`, `safe`, `kingdom`, `focusSlot`; `window.__chatdomStream`: `hold(on)`, `director`, `phase`); `/-/grand` (`channel`, `view`, `yaw`, `pitch`, `dist`, `hour`, `t`, `capture`, `still`, `tier`); `window.__chatdomReady` | S03, S04, S06, S08, S12, S13, S22, and every kingdom plate | The grand land is a standalone view at `/-/grand`; kingdoms still stand on the old land. Hooks as listed. | Keep these hooks and params, or name their replacements in your progress. Add a public, typed sign that the renderer is idle (every chunk resident, no pending uploads or mesh jobs), so frame-stepped capture never records pop-in. A pose that holds against the director for a whole shot. Remove the stream view's SIMULATED chip and the HUD plate in your scope (decision 25), or give a clean-plate param. |
| play | The walker and its controller (`attachWalk`, `window.__chatdomWalk`); avatar looks; stepping out of your own door; the HUD, Esc menu and minimap (kept out of clean plates) | S05 to S07, S17, S18 | Walkers get one of six starter looks. | A way to drive a walker along a path from a script (a list of points and timings, or synthetic input that stays deterministic under a stepped clock). A param that hides the HUD and minimap for clean plates. |
| forge-wish | The Forge ritual and the landing on a house (`forgeFixture=1` on the simulated stream view exposes `__chatdomKingdom.forge`) | S10 to S12 | The accepted ritual runs from a fixture. | One recorded, real Forge result for "a chimney shaped like a sleeping dragon" (plan and voxels), replayable through the fixture, so the teaser never calls the live Forge. |
| front-door | The removal of SIMULATED labels across lanes; the carved kit and fonts in `packages/ui` for the title cards | Cards, every shot | Chips still show on simulated sources. | None. The studio is never linked from the front page or `/showcase`. |
| atlas-map | The Atlas (`apps/web/src/atlas`, PixiJS), `mountAtlas(el, {mode})` once exported, roads inking, the zoom from a kingdom to the map | S19, S21 | The Atlas shows real channel names from the survey. | A labels option that names only the given channels (tobi4s_, The_AGGman, PinkKittyRose, MashaD4) or no channels, because real streamers' names must not appear in the teaser. A road whose drawing progress can be set from a time value. A camera that can start at a kingdom's place and pull back, under a stepped clock. |
| raid-show | The incoming raid caravan under the raider's banner (`apps/web/src/twitch-moments/`, raid moments, the arrival director); the Raid Gate gathering and departure in the world (R05); arrival at the destination (R07); benches `/-/raid-gate` and `/-/twitch-moments` | S14 to S20 | The caravan exists on the live bench (`scripts/live/raid.mjs`, needs a realm); the departure is a flat tableau. | Fixture triggers that need no realm: an incoming raid from a named channel with N viewers, and a departure gathering of N walkers with torches behind the streamer, both on the kingdom or stream route. Support for a large column (N of 2,000 or more). No cards or captions in the world when a fixture param asks for a clean plate. |
| panel-window | The Chatdom panel at 318 px (`/panel`, `apps/panel`), its "Take your place" state and its lit state | S01, S09 | The panel uses the Twitch extension helper (`apps/panel/src/helper.ts`). | A fixture mode that runs without Twitch, or confirmation that a studio shim of `window.Twitch.ext` (onAuthorized, onContext) is enough. A fixture param for the not-joined and joined states. |

## What TS10 read (Sun 1 Nov, main `0e92df4`)

- **grand-world, stream view.** `/stream?source=simulated&layout=stage&seam=starting&hour=19.3` (take `stream-dusk`) and
  `/stream?source=simulated&layout=stage&mood=show&camera=window&hour=19.6` (take `stream-show`), recorded on the GPU
  with the virtual clock. The settle signal is `window.__chatdomKingdom.stats.ready && stats.fieldSettled`. The studio
  hides `.stream-mark.simulated`, `.stream-bench-simulated` and `.stream-seam` in its own frames (recorder `--css`).
  The curtain ("The gate is opening") still covers the first 1.25 s; shots start after it.
- **grand-world, the grand land.** The set pieces (`apps/studio/src/set/`) import `GrandEngine`, `GRAND_TIERS` and
  `grandChannel` read-only and reach into the engine's private fields: `settings` (film settings), `govern` (turned
  off), `controls`, `camera`, `land.sites`, `clouds.mesh` (hidden for the rise), `frame` (wrapped to place the camera
  each frame) and `stats` (`phase`, `queued`, `busyWorkers`, `installsPending`, the idle test). These names are the
  most fragile seam the teaser has; `hooks-check.mjs` checks them. The land has no town yet (GK11), so S04 and S19
  show land and ships only.
- **Stills as stand-ins.** `work/evidence/live-twitch/` (homes, homecoming, raid), `work/evidence/forge/dragon`,
  `work/evidence/raid-road/` (before-departure, after-gate, before-welcome), `work/evidence/atlas/atlas` and
  `work/evidence/growth/growth-sequence-1280.mp4`. Each is cropped clear of cards, captions and chips; the Atlas still
  is softened so no channel name is legible.
- **Sound.** The kingdom's own rendered ambience and hero sounds (see `apps/studio/sound/ambience.json`), rendered
  from the product's sound modules by read-only import.
- **Fonts.** `packages/ui/src/kit.css` and `packages/ui/src/fonts` for the cards and the burned-in captions.

## Open asks from TS10

- `needs: grand-world a public film hook on GrandEngine` (settings override, governor off, a camera driver called
  each frame, a cloud-deck toggle, and an idle test), so the set pieces stop reaching into private fields.
- `needs: tobias enable sound effects on the teaser's ElevenLabs key` (the key has no `sound_generation` permission and
  can't read the subscription endpoint, so the spend is tracked from the character counts in `voice-ledger.md`).

## What TS11 reads (Mon 2 Nov, main `0e92df4`)

The film takes are set pieces in `apps/studio/src/set/<scene>/`, one folder per scene, each staging product modules
by read-only import (`node apps/studio/rig/hooks-check.mjs` lists every module and name they import, and reports any
that a merge moves or renames). The plates are canvas captures (WebCodecs, `apps/studio/rig/canvas-capture.js`), so
no DOM chip, caption or nameplate can reach them.

- **grand-world, the kingdom scene.** `createKingdomScene` with the studio's own presence feed (which windows light,
  and when), `pose` every frame, `debug.ready` / `debug.fieldSettled`, `layout` and the settlement content for the
  gate, streets, homes and windows (scene `kingdom`: S05–S07, S09, S12, S17, S18, S22). The post stack caps the
  scene near 2.1 million pixels (`packages/render/src/post-stack.ts`), so kingdom plates are 1920×1080 and the 2160p
  master scales them up.
- **grand-world, the grand land.** `GrandEngine` as in TS10 (scene `grand`: S04, the S19 climb), at 3840×2160.
- **raid-show and twitch-moments.** The incoming raid caravan through `SceneOptions.momentFeed` with the realm-free
  `createRoadArrivalFeed`, `roadLand` for MashaD4's land (scene `raid`: S15, S16, S20). No moment captions are
  rendered, so the credit plate never appears.
- **forge-wish.** The ritual's bench path (`createRitualWorld`, `createForgeStage`, `benchFrame`) for S11, and the
  kingdom forge fixture (`forgeFixture=1`, `forge.submit`, `forge.seek`) for the landing in S12. The studio fixes the
  ritual id (it is random in `forge/scene.ts`) and hides the seal ribbon's in-canvas text.
- **growth.** `planGrowthTown`, the recorded growth feed, `composeScore` / `sampleScore` and `createGrowthStage` with
  a locked preset camera (scene `growth`: S13).
- **atlas-map.** `MapView` / the road layer with an exported preview of the survey (copied, outside git, to
  `media/teaser/atlas-data/`), names filtered to the four consenting channels before they reach the store (scene
  `atlas`: S19's map, S21).

## Open asks from TS11

- `needs: grand-world a film pixel budget for the kingdom scene` (the post stack's 2.1-million-pixel cap, so kingdom
  plates can render at 2560×1440 or 3840×2160 instead of being scaled up).
- `needs: forge-wish a fixed ritual id or seed for fixtures, and no SIMULATED words in the seal ribbon` (decision 25;
  the studio works around both from outside).
- `needs: raid-show the departure in the world` (walkers gathering at the gate with torches and banners and leaving
  along the road, today only an SVG tableau), and a raid larger than 12 wagons. Until then S17 and S18 show the gate
  waking and the camera riding out over the road, and S16 is the largest caravan the product draws.
- The TS10 asks to atlas-map (a labels option) and play (a scripted walker) still stand; the studio filters the
  Atlas names itself and stages the Way Home with the presence feed's own walk to the door.

## What the teaser provides

Nothing that other lanes depend on. The studio, its rig and its media are private to this lane.
