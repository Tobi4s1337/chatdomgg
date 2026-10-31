# The campfire (web)

The clearing at the edge of the Wilds where Dusk Court is played (spec 21). This folder holds the
presentation side: the place, its people, the public surfaces and the local ports they read.

## Entry points

| Module | What it is |
|---|---|
| `index.tsx` | Default export: the `/-/campfire` development surface over the SIMULATED session. Also re-exports the pieces below for main's mounts |
| `Surface.tsx` | `CampfireSurface({ session, clock })`: the circle as a walker sees it, from the public view only |
| `public.tsx` | `CampfireStream({ source, clock })` and `publicSource(session)`: the broadcast surface. Accepts `CampfirePublicView` only and never reaches a private module (`graph.test.ts`) |
| `clearing/index.ts` | `mountCampfireClearing({ scene, pool, materials })`: the three.js clearing, attachable to a main-owned scene. `update(view, atMs)` is a pure function of the public view and public time; `seats()`, `approach(seat)` and `suggestions(view, atMs)` implement `CampfireScenePort` |
| `stage.ts` | A standalone renderer/sky/camera around the clearing, for surfaces with no kingdom scene |
| `ports.ts` | Version 1 local ports and the strict public decoder (below) |
| `fixture.ts` | `createSimulatedCampfireSession`: a deterministic SIMULATED session for presentation work |

## Ports (version 1)

`ports.ts` defines `CampfirePublicView`, `CampfireSelfView`/`CampfireSelfEnvelope` (types only here),
`CampfireIntent`/`CampfireIntentEnvelope`/`CampfireReceipt`, `CampfireSessionPort`, `CampfireVoicePort`,
`CampfireAudioPort` and `CampfireScenePort`. They are lane-local seams; main promotes the cross-process
messages into shared before real routes launch.

`decodeCampfirePublicView` is an allowlist: every object rejects keys it does not name, labels are
`DisplayNameSchema` strings of at most 40 characters without control characters, IDs use the shared
`KingdomIdSchema`/`TokenSchema`/`EpochMsSchema`, and looks must name authored body, hair and wearable
catalogue entries and registered swatches. It also rejects a view that breaks the reveal boundary:
a role beside a lit lantern before the game has ended, any role or lantern on the Magistrate, an
interrupted night that reveals anything, suspicion resting anywhere but beside a living player, a
lantern outside a match, or match fields outside their lifecycle.

## The place

- Seat ring (`arrangement.ts`): 0–11 players plus the Magistrate on straight logs of two (one of three
  for odd counts), sized so sitters are 0.8 m apart; the Magistrate's chair sits across the fire from
  the establishing camera; the footpath leaves on the far left toward the kingdom on the horizon.
  Lanterns stand beside each player's shins. `approachRoute` walks in by the footpath and round the
  corridor between feet and hearth stones; tests keep it clear of logs, lanterns and the fire.
- Seated people (`pose.ts`, `people.ts`): the authored body, hair and wearables on the common rig, as
  nested bone groups meshed by the production voxel worker, with parts shared between seats. Every
  posture shares one leg pose, solved against the actual body geometry so the soles rest exactly on
  the ground and the seat surface sits exactly under the thighs (`sharedSeatTop()`, 0.155 m); logs
  are authored to that height. Breathing, gaze drift and attention to the Magistrate, a neighbour or
  the Gallery's suspect live in the chest, head and arms only, so contact never slides.
- Light (`light.ts`): the fire and lit lanterns written into the renderer's existing near light-field
  contract (0.5 m cells, corner samples via the kingdom's `buildLightFieldSamples`). Radial, with a
  short occlusion march, so a lone fire draws a round pool and backs turn away from the warmth.
- Fire (`fire.ts`): flame, sparks, ash embers, smoke, lantern flames and Gallery embers are tiny
  cubes, each a pure function of time. Colours stay below white.
- Distance (`distance.ts`): three stepped violet ridge layers with authored aerial perspective and the
  kingdom on its hill in a saddle of the ridges, windows lit, its beacon drawn by the shared atmosphere.
- Props (`clearing/props.ts`): logs, the Magistrate's chair, the hearth ring and crib, game lanterns,
  Wilds trees, rocks, undergrowth and the clearing floor on the 0.125 m prop lattice, registered
  materials only, deterministic per seed.

## Bench and capture

`/-/campfire?state=waiting|playing|text-only|closed&seats=6..12&surface=circle|stream&still=1&at=<ms>&guide=open|closed`.
`?source=live` shows that the live campfire is not connected yet; it never pretends.

```sh
pnpm build
node apps/web/src/campfire/capture.mjs                      # owns a temporary preview of this checkout
node apps/web/src/campfire/capture.mjs --base-url http://127.0.0.1:5190 --only circle,stream
```

Shots go to `shots/campfire/<name>@<w>x<h>.png`. The script queues on the shared capture lock, waits for
`window.__chatdomReady`, and fails on console errors, a missing SIMULATED label, the wrong surface,
viewport overflow or private vocabulary in public text.

## Provenance

No third-party code or assets are added here. Fonts are the repository's existing IM Fell English and
Alegreya files under `apps/web/src/atlas/assets/fonts` (SIL OFL, already credited). Glyphs, props,
effects and words are authored for the campfire. No sound sources yet.
