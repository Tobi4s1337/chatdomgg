# Genesis land sound

The sound of a chosen Genesis land: the coast, the river valley or the mountain pass, alive with wind, water and
place, changing with the seeded weather and the hour. It plays on the kingdom's own audio graph, under the kingdom's
volume and lifecycle, and it leaves room for a streamer's voice, the game and Chatdom's own moments.

Everything is original procedural synthesis, made at runtime from the kingdom's seed. There are no recordings
(see [THIRD_PARTY.md](THIRD_PARTY.md)).

## Mount (for main)

The layer is hosted exactly like the Forge adapter: it takes `kingdomAudioHost(audio)` (null until the first unlock
gesture, so no context is ever made early). It never creates, resumes or closes a context and never touches
`context.destination`.

```ts
import { kingdomAudioHost } from '@chatdom/audio';
import { createGenesisSoundscape } from '@chatdom/audio/genesis-biomes'; // export to add, see "Seams"

const host = kingdomAudioHost(audio);                     // null before the gesture: try again next frame
const land = host && createGenesisSoundscape(host, { recipe, landscapeId: selected.id });

// every rendered frame
land?.update({
  realmMs,                                                // the realm clock (soul.clock: 'realm-time')
  hour,                                                   // the hour the picture shows, 0..24
  listener: { position: camera.position, right: cameraRight },   // kingdom metres, +Y up; optional
  weather,                                                // optional Partial<GenesisWeather>; omitted = seeded
});

land?.setMix({ muted: hidden || explicitlyMuted });       // volume stays 1: the kingdom master already applies it
land?.setMix({ profile: 'stream' });                      // under a streamer's voice and a game
land?.duck();                                             // a Chatdom moment or a Forge line: −6 dB for 2 s by default
land?.duck({ depthDb: 9, seconds: 4 });                   // deeper and longer for a spoken line
land?.select(otherLandscapeId);                           // the ceremony redraws: ~3 s cross-fade
land?.dispose();                                          // lets go of every node and source it made
```

`inspectGenesisSoundscape(land)` reports state, beds, live sources, peaks, the weather kind, recent call events and
kit memory, for tests and the debug overlay. `renderGenesisSoundscape(...)` renders a scripted run offline (an
`OfflineAudioContext`), which is how the listening evidence below was made.

### Inputs

- `recipe.soul.soundscape` (the biome: meadow, woodland, coastal, highland) brings the **chorus**: which birds sing.
- The explicitly selected member of `recipe.landscapes` (its `character`, shoreline, islands, streams, waters,
  forest, pass, hills and settlement reserve) brings the **land**: where the water, wind and places are. The
  recommendation is never assumed: an id that is not one of the recipe's landscapes throws a `RangeError`.
- `recipe.landmark` brings one **place voice**: a flag at the watchtower, lighthouse or stage, chimes in the bell
  garden, the mill wheel at the watermill, a low whistle through the stone circle.
- `recipe.soul.weatherSeedKey` plus the realm clock give the **weather** (`genesisWeatherAt`, pure and continuous):
  wind, rain, snow (mountain only), storm, fog, and `wet` (rain in the last minutes, so eaves keep dripping). A
  picture that reads the same function shows the same sky; a host with its own weather passes it per frame.
- `recipe.seed` decides every take, offset, position and phrase.
- `population: 'real-presence-only'` is honoured: there are no crowd, voice, footstep or citizen sounds in the land.
  People are heard only through the kingdom's own presence cues.

## What you hear

| | Coast (coastal harbour) | River valley | Mountain pass |
|---|---|---|---|
| Leads | Two shore beds (left and right of the ear) with seeded breaking waves; harbour lap and chop | The brook's bubbling babble along the nearest stream; the rush at the weir | Wind with a whistle through the saddle; meltwater rush under the pass; a long echo |
| Places | Rigging tapping, hull creaks, mooring ropes, water slapping the quay; the bell buoy offshore, tuned to the kingdom | The weir; frogs and fish plops at the bank; the land's own place voice | Stones shifting in the pass; scree from the ridges; ravens and the buzzard overhead |
| Space | Open air: short and bright | The valley: a soft, longer bloom | Discrete echoes off the walls |

The chorus comes from the biome over any land: skylark, blackbird, woodpigeon and owl for a meadow; wren and
woodpecker in woodland; oystercatcher, curlew and chough on a coastal soul; curlew, raven and owl in the highlands.
Gulls follow the sea; frogs and plops follow the water.

**Time.** Day parts match the picture's sky (night until about 07:00 and from about 20:30; a dawn chorus around
06:00 and a dusk one around 19:30). Songbirds sing hardest at dawn and dusk, less by day, and not at night; owls and
frogs take the night. Grasshoppers buzz in warm daylight; crickets, high above the speech band, take the dusk and
night. A low floor of the land, the faint air of the place, is a little brighter by day.

**Weather.** Wind raises the wind beds, with gusts that arrive on one side before the other, starts the whistle at the pass, sets
leaves or grass moving, rattles rigging and flags, and swells the sea. Rain falls on the ground, on the leaves near
the forest and on the water near the shore or stream; it quiets the birds and the insects. After rain, the town
drips. A storm brings rolling thunder from far off, a heavier sea and hard gusts. Fog softens the highs, quiets the
birds and makes the bell buoy speak. Snow muffles the whole land and halves the echo.

**Place.** The ear moves with the camera: the sea pans to the side it is on, the river rises as you approach the
bank, a call comes from where its creature is (a gull over the water, a blackbird at the forest edge, a raven high
over a ridge) and far things lose their top first (air absorption).

## Variation, determinism and transitions

- **Nothing loops at a fixed period.** Textures (babble, rush, three kinds of rain, crickets, grasshoppers) are 6–10 s
  of seeded synthesis played as equal-power cross-faded grains from offsets at least a quarter of the texture apart,
  alternating sides. Bed noise drifts its playback rate on a seeded curve, so a buffer's length never recurs as a
  period. Waves are scheduled one by one with seeded spacing and size.
- **No take twice in a row.** Every call has two or three takes; `freshTake` never repeats the previous one.
- **Deterministic.** Events are decided per slot from `(seed, pool, slot)`: whether it fires, when, where and which
  take. The same frames give the same calls at the same moments (tested), and two offline renders of the same
  script differ by at most 1 LSB of 16-bit audio (Chrome's float rounding).
- **Missed time is never replayed.** The realm clock is anchored to the audio clock with a 1.2 s lookahead. A
  frozen realm, a seek back or a stall over 0.35 s re-anchors and schedules only fresh time.
- **Clean lifecycle.** Mute fades everything out within 30 ms and schedules nothing until unmuted. A suspended
  context (hidden tab, browser policy) stops every source at once and starts clean after. A host that stops sending
  frames goes quiet by itself after 0.9 s (watchdog). `select` cross-fades the old land out over 2.5 s while the new
  one comes in; the old beds are released when silent. `dispose` disconnects only what the layer made.
- **Smooth change.** Weather, hour and place move bed targets, and the graph eases toward them over seconds, so a
  front coming in or a walk along the shore is a cross-fade, never a step.

## The stream mix

`profile: 'stream'` is for a land heard under a streamer's voice and a game:

- the whole land sits 5 dB lower (`STREAM_TRIM_DB`);
- the speech-band pocket (a broad dip at 2.1 kHz) deepens from −2 to −5 dB;
- the low guard rises from 70 to 110 Hz, so the land does not fight a game's low end or a voice's chest;
- talkative calls are sparser (each pool's `stream` factor) and the harbour lap, rush, floor and insects thin;
- all calls sit 5 dB under the beds (`CALL_TRIM_DB`): a gull at 40 m is a moment above the land, never a shout.

`duck()` dips the land under a voice line or a Chatdom action and lets it back over about a second.

## Bounds and memory

- Calls: at most 10 voices, 28 sources and 2 per pool at once (`CALL_LIMITS`); calls beyond that are skipped, not
  queued. Calls that would arrive at under 3% gain are skipped as `far`.
- Beds: at most 34 sources (`BED_SOURCE_LIMIT`). Beds are made only when their target rises and retired after 6 s of
  silence, so a mountain never holds a harbour's beds.
- A soft ceiling (tanh-like wave shaper) on the layer's output catches any sum of thunder and storm sea.
- Kit memory: noise buffers (white 3.3 s, pink 6.1 s, brown 9.7 s) plus only the textures the land uses, made lazily
  and cached per context and seed. Measured 3.4–8.1 MB per land; the most is a river day with rain, which uses every texture.

## Levels

Integrated loudness (EBU R128) of offline renders at 48 kHz, through a master of 0.4225 (the kingdom default volume
0.65, squared), so these are the levels a listener hears at default volume before the kingdom's own ceiling.

Measured 2026-10-31 by `listen.mjs` (all 19 scenarios, the stream check and the determinism pair).

| Scenario | What | Integrated LUFS | Max momentary | Peak dBFS | Speech-band share | Repetition r | Calls |
|---|---|---|---|---|---|---|---|
| `coast-day-plaza` | Coast, plaza, 10:30, fair | −38.6 | −34.6 | −23.2 | 0.26 | 0.15 | 14 |
| `river-day-plaza` | River valley, plaza, 10:30, fair | −40.4 | −33.3 | −26.5 | 0.31 | 0.14 | 5 |
| `mountain-day-plaza` | Mountain pass, plaza, 10:30, breezy | −40.2 | −31.6 | −24.0 | 0.37 | 0.17 | 8 |
| `coast-harbour-edge` | On the quay, 15:00, fresh wind | −34.1 | −29.7 | −17.9 | 0.31 | 0.17 | 24 |
| `river-bank-dusk` | River bank, 19:36 | −35.0 | −31.9 | −19.8 | 0.44 | 0.11 | 7 |
| `mountain-pass-gale` | In the saddle, gale | −36.8 | −31.4 | −22.1 | 0.52 | 0.16 | 7 |
| `coast-night-fog` | Quay, 01:30, sea fog | −38.6 | −33.3 | −23.6 | 0.39 | 0.21 | 10 |
| `coast-storm` | Coast plaza, thunderstorm | −30.5 | −25.7 | −15.3 | 0.29 | 0.14 | 30 |
| `river-night` | River bank, 23:00 | −35.2 | −34.0 | −19.7 | 0.45 | 0.11 | 2 |
| `river-rain` | River bank, steady rain | −32.7 | −30.6 | −18.7 | 0.44 | 0.11 | 6 |
| `mountain-dawn` | Mountain plaza, 06:00 | −41.9 | −31.9 | −25.3 | 0.41 | 0.20 | 6 |
| `mountain-snow` | Mountain plaza, snowfall | −42.0 | −39.8 | −28.6 | 0.34 | 0.17 | 8 |
| `river-day-sweep` | River valley, 04:30 → 23:30 in 90 s; clear → rain → clear | −37.1 | −33.2 | −21.4 | 0.35 | 0.09 | 18 |
| `coast-walk` | Walking from the plaza to the shore | −36.4 | −31.3 | −19.4 | 0.26 | 0.15 | 21 |
| `mountain-seeded` | Mountain, the seeded weather as it comes (windy) | −38.0 | −35.5 | −24.7 | 0.34 | 0.13 | 8 |
| `lifecycle` | Mute, unmute, duck, select mountain, stream, seek back | −43.5 | −37.3 | −27.7 | 0.33 | 0.46* | 11 |
| `stream-bed` | River valley plaza, 19:12, stream profile | −46.4 | −40.5 | −32.9 | 0.32 | 0.12 | 3 |

\* The scripted actions make edges in the envelope, not a loop. Per second (RMS dBFS): about −43 before the mute, digital
silence 9–11 s, −45 back at 12 s; the duck −40 → −45 for two seconds; the redraw a smooth dip of 3–4 dB at 25–27 s, no
gap; the stream switch −43.5 → −48.5 at 36 s (the 5 dB trim); no burst at the seek back at 43 s.

**Stream check (SIMULATED voice and game):** voice −16.2 LUFS, game bed −24.0 LUFS, land (`stream-bed`) −46.4 LUFS, the
three mixed −19.6 LUFS. In the speech band (300–3400 Hz) the land sits **26.4 dB under the voice**; the game bed sits
1.8 dB under it.

**Determinism:** the two identical runs have the same length; 4,407 of 1,152,000 samples differ (the count moves a little between runs), by at most 1 LSB of 16-bit audio, from float rounding in Chrome.

**Sources and memory, peak per run:** bed sources 15–28 (limit 34), call sources up to 15 (limit 28). Kit memory
3.4–8.1 MB; the most is the river sweep, which uses every rain texture, both insects and the babble.

## Listening method

`node packages/audio/src/genesis-biomes/bench/listen.mjs [name prefixes…]` (add `solo` for the per-bed solos):

1. Starts a Vite dev server on a free capture port (5170–5186, 5188, 5189, 5198, 5199) and opens
   `bench/index.html` in headless Chrome through Playwright. The bench is labelled SIMULATED: its frames are a
   scripted camera and clock, not a running kingdom.
2. Renders each scenario offline with `renderGenesisSoundscape`, through the same layer code the kingdom uses, at
   30 frames per realm second, with the scenario's hour, weather (fixed, or moving through two or three stops), ear
   (plaza, harbour, shore, river bank, weir, pass, forest, or a walk), profile and actions (mute, duck, profile
   change, landscape select, seek back).
3. Writes `shots/genesis-sound/<scenario>.wav` and a spectrogram `.png`, and measures with FFmpeg: integrated and
   maximum momentary loudness (`ebur128`), sample peak, the speech-band share (300–3400 Hz energy over the whole), and
   repetition (the strongest autocorrelation of the loudness envelope's first difference between 2 and 20 s; a
   loop would show near 1).
4. The **stream check** builds a SIMULATED streamer voice (Flite, normalised to −16 LUFS, the usual voice level on
   stream) and a SIMULATED game bed (shaped pink noise at −24 LUFS) and mixes both with the `stream-bed` render. It
   reports how far the land sits under the voice in the speech band.
5. Two identical runs (`determinism-a`, `-b`) are compared sample by sample.
6. Everything is written to `shots/genesis-sound/listen.json`, including every call played and the bed sources,
   call voices and kit bytes every 5 s.

The listening itself was done against the spectrograms and the measures above, scenario by scenario, and every
bed was soloed and set by ear and meter (the solos are how `BED_LEVELS` were calibrated).

## Findings

- **Each land is itself in the first seconds.** Coast: the sea on both sides with waves you can count, gulls,
  the buoy far out. River: a soft valley floor with the brook in it, a blackbird at the wood. Mountain: wind with
  a voice, stones and ravens, and every call coming back off the walls. The coast is the loudest land (the sea), the
  mountain the most sparse; the three plazas sit within 2 LU of each other.
- **Places lead when you go to them.** On the quay the rigging, hull, mooring ropes and slap take over (24 calls in
  40 s, +4.5 LU over the plaza). At the bank the water moves into the speech band (share 0.44 against 0.31 at the
  plaza). In the saddle the whistle is the strongest thing in the land (share 0.52). From the valley plaza, 119 m
  from the stream, the brook is faint and the land's low air leads; that is by design, the river is a place.
- **Weather and time read clearly.** The storm is the loudest scene (−30.5 LUFS, thunder far off at −25.7 momentary)
  and stays 15 dB under full scale. Fog at night lets the bell buoy, hull and ropes speak; the only bird is one oystercatcher, which calls at night.
  Snow is the quietest scene: muffled and dulled, the echo halved; a few stones, drips, a branch and a raven. The sweep goes from a dawn blackbird and
  skylark through a working day and a shower moving in and out (the eaves dripping after) to crickets and an owl, all
  as slow cross-fades.
- **Night is sparse, on purpose.** At 23:00 by the river it is water, two frogs and crickets. An earlier render from
  the plaza had no call in 45 s: the night pools there sum to about 2.5 calls per 45 s, so silence is about an 8%
  draw. The bank is the night place.
- **No loops.** Repetition stays at 0.09–0.21 for every continuous scene (a loop would show near 1). Before the
  playback-rate drift the floor bed showed 0.39 at 9.7 s, its buffer length; the drift brought it to 0.14.
- **Room for a voice.** In the stream profile the land is 26 dB under a −16 LUFS voice in the speech band and about
  22 dB under a game bed; it is heard in the pauses and gaps, never under the words. The kingdom's volume (volume²)
  still lifts it when the land is the whole scene: at full volume it is about 7.5 dB louder than these renders.
- **Calibration that changed the sound:** the first renders were all low end (a 7 Hz random walk for brown
  noise); the brown noise was rebuilt, the sea and floor were band-passed, and a 70 Hz guard went on the layer.
  The whistle and foliage were inaudible in solo and were raised. All calls were set 5 dB under the beds, the
  buzzard and thunder further.
- **A redraw is a cross-fade.** The lifecycle render caught a real bug: a redraw to a land of another character
  replaced the layer's front (it needs another space) and cut the old land dead. The old front now lives on beside
  the new one until the old land has faded and its space has rung out; a test now checks that the old land is still
  heard a second into the redraw.
- **What a meter cannot say.** Whether the gull and the curlew read as those birds and not as synths, and whether
  the storm's thunder is big enough on real speakers, needs a real ear (below).

## Please listen (real speakers or headphones)

The renders are deterministic; regenerate them with the command above (they land in `shots/genesis-sound/`, which is
ignored). The ones worth a real ear:

| File | Listen for |
|---|---|
| `coast-day-plaza.wav`, `river-day-plaza.wav`, `mountain-day-plaza.wav` | The three lands back to back: is each one unmistakable in 10 s? |
| `coast-harbour-edge.wav` (0–40 s) | The harbour as a place: rigging, hull, ropes, slap, the buoy. Too busy? |
| `river-day-sweep.wav` (0–15 s dawn, 30–55 s rain, 75–90 s dusk) | Transitions: no steps, no seams |
| `coast-storm.wav` (whole) | Thunder size and distance on real speakers; the sea in a gale |
| `mountain-pass-gale.wav` | The whistle through the saddle: wind with a voice, not a tone |
| `stream-mix.wav` | The land under the SIMULATED voice and game: present in the gaps, never in the way? |
| `lifecycle.wav` (8 s mute, 12 s unmute, 18 s duck, 25 s redraw to the mountain) | Clean fades, no clicks |

## Seams

- Main mounts the layer in `apps/web/src/kingdom/sound.ts` beside the Forge adapter, as above, and exports it from
  `@chatdom/audio` (`./genesis-biomes`).
- `types.ts` imports the frozen genesis contract by relative path (`../../../world/src/genesis/contracts`) because
  `@chatdom/audio` does not depend on `@chatdom/world`; when main adds that dependency, switch it to
  `@chatdom/world/genesis`.
- The landmark position is sound intent until the landmarks lane places the landmark (`scene.landmarkAt`); then the
  host should pass the placed position (a small `SoundScene` override).
- The kingdom ambience (`apps/web/src/kingdom/ambience`) still plays its own air and shore-water phrases; once the land
  is mounted, those overlap its wind and sea, so main decides whether the land replaces them or they stay for kingdoms
  without a Genesis land.

## Files

| File | What |
|---|---|
| `index.ts` | Public API |
| `soundscape.ts` | The layer: graph, lifecycle, steering, the call scheduler, spaces |
| `scene.ts` | What a land holds for the ear, read from the recipe; call pools per biome and land |
| `space.ts` | Where things are relative to the ear |
| `mixplan.ts` | Bed targets from land, weather, hour, place and profile; `BED_LEVELS` |
| `beds.ts` | The live beds and the grain player |
| `calls.ts` | The 27 call designs |
| `voice.ts` | Noise kit and the call voice |
| `textures.ts` | Seeded texture synthesis (bubbles, rain, insects) |
| `weather.ts` | Seeded weather and day parts |
| `rng.ts` | Hashing, seeded generators, value noise, `freshTake` |
| `offline.ts` | Offline renderer |
| `bench/` | The SIMULATED listening bench and `listen.mjs` |
| `genesis-sound.test.ts` | Focused tests |
