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

## What the teaser provides

Nothing that other lanes depend on. The studio, its rig and its media are private to this lane.
