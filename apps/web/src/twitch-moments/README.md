# Twitch moments: the sky answers

Twitch's events happen in the kingdom. This module is the browser side: a pure clocked controller
(`createTwitchMoments`) that turns validated public facts into bounded frames, and a disposable view
(`createTwitchMomentView`) that draws them into a group under the real scene: banners and parcels at homes, and the
town's sky moments — a cheer's spark, fireworks, the castle volley, the Hearthbeast, Skyfire's aurora and the kites,
the Power-ups, the festival train and the earned dragon. Spec: `work/specs/20-twitch-moments.md`.

## Mount it (one call, already made by the kingdom scene)

The kingdom scene attaches the module through `apps/web/src/kingdom/moments/index.ts` (`createKingdomMoments`)
whenever it is given a `momentFeed`; the stream gets the same scene through `stream/mount.ts`. The whole recipe:

```ts
const controller = createTwitchMoments({ kingdomId, expectedOrigin: feed.origin, clock: { now: () => kingdomMs } });
const view = createTwitchMomentView({
  parent,                         // a dedicated THREE.Group under the real scene; the view owns only what it adds
  material, kit, mesh,            // the kingdom's voxel material, its kit ('hearth' | 'tide'), its mesher
  places: spectaclePlacesOf(plan, houses, keep),   // sky, castle, plaza, lair, track, bunting, roofs
  homeAnchor, doorAnchor, windowAnchor, placeAnchor, giftRoute,
  sound, camera, viewport,        // sound port, camera lease port, picture size
  light: glow => { skyGlow = glow; },   // the sky's light on the town, every frame (see below)
});
await view.prepare();
const disconnect = controller.connect(feed);
// every frame, before the town's grade is set:
view.apply(controller.sample(kingdomMs));
const grade = skyLitEnvironment(getEnvironment(hour), skyGlow);   // then set it on every voxel material as usual
// over the picture: <SkyCaptions captions={view.labels(camera)} />
// on hide or teardown: disconnect(); controller.dispose(); view.dispose();
```

### What main still wires (exact patch)

`work/lanes/sky-moments/wiring.patch` (written by `twitch-moments-bench/write-wiring-patch.mjs` from
`twitch-moments-bench/wiring.mjs`; apply with `git apply`) makes three small edits in main's files:

| File | Edit | Why |
|---|---|---|
| `kingdom/moments/index.ts` | pass `light` to the view, return `glow()` | keep the sky's light for the scene |
| `kingdom/scene.ts` | `const grade=skyLitEnvironment(getEnvironment(hour),moments?.glow())` | the town's sky fill and moonlight answer the sky |
| `stream/index.tsx` | `onMomentCaptions` into `<SkyCaptions>` inside the stream lens | the cheerer is credited on stream |

Without them the sky still answers on its own (the aurora, the shells, the name in the sky and the sky's veil are
all drawn by the view), but the roofs do not take the aurora's colour and the stream shows no credit plate.

## The sky's light on the town

`view` reports a `SkyGlow` each frame: `colour` + `strength` (≤ 0.6, the aurora's green, a burst's flash), `night`
(≤ 0.55, how far the moment has drawn the dusk down; the veil draws the painted sky 1.3× as far) and `hush` (≤ 0.45, the lamps' held breath before a staged
climax). `skyLitEnvironment(grade, glow)` is pure and bends only `ambient`, `ambientIntensity`, `sun`,
`sunIntensity` and `shadow` of the renderer's `Environment`: first toward indigo by `night`, then toward the light's
colour by `strength`, so under the aurora the roofs go cool and green rather than merely brighter; windows, lamps and the beacon come from the light
fields and are never dimmed, so they read brighter under a deepened sky. Direction, fog, exposure and the sky dome
are untouched; the sky's own answer is the view's veil (`sky-veil.ts`).

## Authored beats (ms from the cheer)

Default ladder (`Twitch.md` §6): 1 spark · 100 street fireworks · 500 castle volley · 1,000 Hearthbeast ·
5,000 Skyfire · 10,000 kites. No cheer wakes the dragon. Timings live in `spectacle.ts` (`SKY_BEAT`):

| Rung | Length | Shape |
|---|---|---|
| spark | 4.6 s | a mote climbs from the cheerer's roof (0.25 s), hangs at 1.9 s, twinkles, fades by 4.2 s |
| street fireworks | 7.8 s | three shells from the street at 0.4/1.15/2.0 s, the last a gold willow; the sky deepens 7 % |
| castle volley | 10.4 s | seven shells in a rising fan off the walls, each an approved emote or the kingdom's star and crest, larger, higher and wider the farther the castle stands from the camera (up to 3×); sky −16 % |
| Hearthbeast | 11 s | a low pass from beyond the far roofs, sweeping broadside across the camera's picture a third of the way out (never nearer than 45 m) and away behind the town; sky −20 % |
| Skyfire | 19 s | the dusk is drawn down (the town's light −55 % and the sky overhead −72 % by 2.8 s, the rose band at the horizon kept); a comet climbs from the cheerer's roof; three aurora curtains unroll on the far side of the town from the viewer (0–3.2 s), the name is written in sparks facing the viewer (4.2–5.4 s, held to 11.8 s), twelve shells walk the walls (2.4–12.4 s), drawn larger the farther they are from the camera; the curtains roll away from the end they came from (14.5–18.2 s) and the dusk comes back |
| kites | 19 s | a kite rises from every home (bounded), the cheerer's leading; they sway and drift away |

The aurora (`aurora.ts`) is three continuous shaded ribbons of 160 columns each, laid along slow S-folds on the far
side of the town: a bright hem broken by the rays, bands of rays a dozen metres apart with finer rays inside them,
drifting along the fold, green and teal low, violet and rose at the top. Curtains behind the name dip and part while
it is written. The name spans up to 1.6 sky radii (at most 120 m), so it reads at a glance on a 1080p stream.

**Facing.** The sky faces whoever is watching (`viewer.ts`): the camera that last drew the layer, read on a moment's
first frame and held until the moment ends, so a director move or a drifting hero view never swings a name mid-word
or bends a flight mid-pass. Before any
camera has drawn it, the layer falls back to the town's front (castle crown toward the sky's centre).

## Caps

`SKY_LIMITS`: 6 live sky beats, 5 names in a merged ribbon, 64 kites, 2,400 motes for shells, sparks, names and
confetti (the aurora is three ribbons outside that budget), 2 balloons. Towns merge cheers every 10 s, capitals
every 20 s. One veil sphere and three curtain meshes per view, created once and reused.

## Bench

- `/-/twitch-moments?stage=stream&rung=skyfire` — the cheer over the stream's own picture of Willowmere at dusk
  (the real kingdom scene through the stream mount; SIMULATED cheer through the real Herald ingest).
- `/-/twitch-moments?scenario=skyfire` — the bench hamlet, with the full controls.
- `node apps/web/src/twitch-moments-bench/sky-capture.mjs --rung skyfire [--wired] [--tag after]` — one rung's
  beats under the shared capture lock into `shots/sky-moments/`; `--wired` previews main's side of the seam from
  `wiring.mjs`, in memory only; `--before` serves the committed sky layer instead, for a before/after.
- `… sky-capture.mjs --ladder --wired` — every rung at its high point over the same picture, one row.
