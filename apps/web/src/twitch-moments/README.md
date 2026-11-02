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

## Incoming raid

A raid (`kind: 'raid'`, `Twitch.md` §9, Spec 20 R8) wakes the Raid Gate and a caravan rolls in under the raider's
banner. The realm commits one transient fact per raid (`displayUntil` = cause + 60 s); the controller plays it once
(`raidKey` remembered for the session, `seq` watermark for replays), never from a reset snapshot or a `recovered`
fact, and never as current state. Pure timings and poses live in `raid-beat.ts` (`RAID_BEAT`), the voxel parts in
`raid-art.ts`, the drawing in `raid-view.ts`.

**Size.** Twitch's viewer count only sizes the column, on a gently convex log curve (`raidUnits`): 1–3 is one
treasured wagon, 10 two, 50 three, 140 four, 1,000 six, 10,000 nine, twelve at most (from about 70,000). The lead
wagon carries the great standard; then covered wagons (a cream tilt banded in the raider's colour) and
open festival wagons with lanterns and cloth fittings in turn. Nobody rides: no figures, no names on the
wagons, nothing invented.

**Whose banner.** The raider's arms are its Atlas arms (`shieldDesign(channelId)`), woven into cloth: the shield's
partition, line and charges sampled onto the banner's cells (3×3 supersampled), each tincture one of the kingdom's
fabric dyes, with a swallowtail. A channel without a kingdom here (`founded: false`) rides in under the same real
name and arms; nothing is forged for it. The pony saddles and the wagons' sideboards take the arms' colour.

**Words.** Over the standard's crossbar: title `‹name› rides in`, line `A raid of 140` (`A raid of one`,
`A raid of 10,000`), detail `Raiders who chat are our guests tonight`. The frame retains its internal `SIMULATED` provenance from a
simulated feed, isolated from live scenes. The stream and private bench render no provenance chip.

| ms from the raid | What happens |
|---|---|
| 0–900 | the gate gathers out of the air: two braziers either side of the road, the standard's pole beside it |
| 300 | the horn calls from the gate |
| 450–1,300 | the braziers catch and flare high (1.55×), settling to a steady blaze by 2,600; embers rise |
| 900–2,300 | the furled standard is hoisted up its pole to the crossbar (7 m) |
| 2,250 / 2,300–3,500 | cloth cue; the standard unrolls from the crossbar and swings once |
| 2,600–3,400 | the credit plate fades in over the crossbar |
| 3,400 | the lead wagon gathers out of the gate's light (1.4 s) and rolls in; cart-roll; a festival drum under five or more wagons |
| + 3,600 each | the next wagon; up to four rolls are heard however long the column |
| each wagon | about 52 s: in along the gift road to the market and on up the castle road (1.6–3 m/s, whatever covers the road), its lantern lighting the street, thinning away over the last 4.5 m |
| last wagon + 6,000 + 2,500 (≥ 14,000) | the plate fades (1 s) and the director hands the camera back |
| hold + 3,500 | farewell horn (−600); the braziers sink to embers, the gate thins away over 1.4 s |

A raid of 3 holds the gate 14 s; 140 holds 28.3 s (its four wagons take 22.4 s to pass the gate); 10,000 holds
63.9 s (nine wagons, 58 s); twelve wagons at 70,000 hold 79.9 s (74 s). The stage profile is rank 5, town-wide:
people turn to the gate, the lamps hush before the lead wagon and the crowd cheers as it comes through.

**Shot.** While a raid holds the gate, `shotFor('gate')` stands beside the actual street 21–25 m inside the town
(18–25 m in a portrait picture, nearer the road's line), 6.5–9.5 m up, and looks back out through the standard, so
the column comes towards the viewer, ponies and standards first. Candidates follow the supplied road, each through
the host's `validatePose`; only with none legal does it look in from outside the gate along the road, and after
that the gift gate shot as before.

**Scale in the world.** The town lines its street with torch pairs for the raid (one pair for a single wagon, two
at 140, five at 10,000, six at 70,000), from 4.2 m inside the gate every 3.4 m, catching in a wave after the
braziers and going out with the gate. Each post stands only on ground the conservative chat-lamp sampler supports,
chosen once per raid. Columns of 10,000 and more also release sky lanterns over each wagon once it is through the
gate (six per wagon, nine from 50,000; at most 96 on screen). Both are light and props from the beat alone, never
people, with their own instance budgets.

**One gate at a time; no merging.** A raid that arrives while another holds the gate waits until that gate has gone
to sleep and the caravan before it has left the road, so at most two caravans are ever on it; it takes its turn on
the stage like any beat. Raids are never merged: each is its own visit under its own banner. At most four wait; a
raid that could not begin before its `displayUntil` is not played late (counted as expired). A gift cart drives the
same road, so a cart waits until the last wagon is off it; parcels from the sky do not wait.

**Caps** (`RAID_LIMITS`, `RAID_VIEW_LIMITS`): 12 wagons a caravan, 2 caravans drawn, 4 raids waiting, 4 rolls. The
view draws everything instanced from parts meshed once in `prepare()`, posed from the frame alone: per part at most
24 wagons, 96 wheels and legs, bounded festival fittings, 1,400 dye cells per tincture; 96 flame cores, 40 glows and 40
light pools. Pools are created on first use and reused; everything is released on `dispose()`. Arms are cached for
the last 8 raiders.

## Bench

- `/-/twitch-moments?stage=stream&rung=skyfire` — the cheer over the stream's own picture of Willowmere at dusk
  (the real kingdom scene through the stream mount; SIMULATED cheer through the real Herald ingest).
- `/-/twitch-moments?scenario=skyfire` — the bench hamlet, with the full controls.
- `node apps/web/src/twitch-moments-bench/sky-capture.mjs --rung skyfire [--wired] [--tag after]` — one rung's
  beats under the shared capture lock into `shots/sky-moments/`; `--wired` previews main's side of the seam from
  `wiring.mjs`, in memory only; `--before` serves the committed sky layer instead, for a before/after.
- `… sky-capture.mjs --ladder --wired` — every rung at its high point over the same picture, one row.

## Decisions

- 2026-11-02: The 2026-11-01 founder decision 25 removes visible simulation labels, including private benches and accessibility text. Internal simulated origins, feed isolation and transport guards remain unchanged. Private fixtures remain on `/-/` routes.
- 2026-11-02: Raid wagons carry standards, colours, lanterns and cloth fittings; they carry no tribute. The caravan description and pool inventory above now reflect this rule.
