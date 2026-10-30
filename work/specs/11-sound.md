# Spec 11: the sound of a handmade kingdom

Status: **frozen 2026-10-30.**
Vision: `chatdom/ChatDom.md` principles 9, 18 and the 2026-10-30 sound decision;
`chatdom/Artstyle-Soul-Feel.md` §§12, 14; `chatdom/Quality.md` §16;
`chatdom/Moments.md` §§1, 3, 12.

## What and why

A window lighting should feel like someone coming home. A wooden control should have the weight of a small
carved object, and setting a stone in a home should sound different from setting timber. Build a compact,
carefully mixed sound library for the kingdom's existing light ceremony and its next walking/building consumers.
Use selected CC0/permissive foley with original procedural resonance and musical layers. Listen for a warm toy
kingdom, not phone notifications, a casino, or a stock fantasy fanfare. Quiet actions need care too. The same
palette must remain pleasant beneath a streamer's speech after many minutes of repeated actions.

## Current state

`apps/web/src/kingdom/sound.ts:2` provides `createKingdomSound()` with `unlock`, `toggle`, `enabled`, `cue` and
`dispose`. Its four cues are `wood`, `light`, `wave` and `beacon`; all are original oscillator synthesis. It
sets `enabled` before `AudioContext.resume()` has succeeded and does not bound overlapping cue voices.
`apps/web/src/kingdom/scene.ts` plays those cues for controls and the simulated window/beacon ceremony.
`apps/web/src/kingdom/index.tsx` owns the visible sound button. Main owns those consumers and their integration.

The workspace has no shared audio protocol. This is browser presentation, not a simulation event. Main creates
the `@chatdom/audio` package scaffold and workspace lock entry before branching; this lane fills its package.
No `packages/shared` change or future network/event contract is required. Existing notes in
`work/references/prototypes.md` offer local orientation, not a sample license or an audio implementation to copy.

## Rules

1. **R1 — Eight complete cue families.** Deliver every row below. No empty registration, placeholder sample,
   successful return from an inaudible implementation, or single oscillator beep passed off as finished foley.
   Families have at least three authored variations, chosen without adjacent repetition in that family/surface.
   Layers may combine selected foley, filtered noise, resonators, a plucked body and restrained tuned tails.
   Changing pitch alone does not make an unconvincing material convincing.

   | Cue | Experience and material response |
   |---|---|
   | `wood` | Short tactile control movement; default wooden knock, optional brass tick or parchment movement |
   | `light` | Small warm ignition with a delicate resonant tail; intimate rather than a reward alarm |
   | `wave` | A growing phrase of lights, sharing the light cue's tuning and texture |
   | `beacon` | A broad, warm arrival chord with a physical ignition; a clear crest then a graceful return to quiet |
   | `step` | Grounded short contact for wood, stone, earth, metal, glass and fabric; no footfall while stationary |
   | `place` | Hand contact plus the chosen material settling into place |
   | `remove` | Lighter release/lift of the chosen material; no destructive smash or punishment sound |
   | `material` | A brief handled-material selection sound, quieter than placing it |

   `wood`, `light`, `wave`, `beacon` remain valid with no options. For `step`, `place`, `remove`, and `material`,
   omitted material means wood; provide all six surfaces, including a soft fabric contact and a restrained glass
   resonance. Material mapping from real world/build data belongs to the consumer. These calls are available for
   the avatar/build lanes; a sound bench does not claim those gameplay features already exist.
2. **R2 — A coherent fantasy palette.** Use soft attacks for magical light, readable dry contact for physical
   actions and short restrained room tails. Keep the light/wave/beacon phrase harmonically related. Default
   controls should resolve within about 200 ms, footsteps within 350 ms; a beacon may breathe for up to five
   seconds. Avoid piercing sine whistles, heavy sub-bass, harsh clicks, modern alert melodies and heroic brass
   blasts. Tune by listening at normal and quiet playback levels, including a repeated building/walking sequence.
3. **R3 — Sources are real and credited.** Audition the primary-source CC0 packs listed below and choose useful
   foley to combine with original synthesis. Ship only selected files, local to `packages/audio`, never an entire
   unreviewed pack or runtime CDN fetch. Verify each downloaded archive's actual license; code and asset licenses
   are separate. No NC/ND/unclear source, unlicensed music, speech recording, recognisable commercial melody or
   generated voice. Record author, pack/page URL, archive/version or download date, original filenames, shipped
   filenames and edits in `packages/audio/THIRD_PARTY.md`; retain supplied license notices beside the assets.
   Credit even CC0 sources. Main copies the final source entries into root `THIRD_PARTY.md` under `## Kingdom
   audio` and updates its obsolete “no sampled sound” wording before integration ships. Original synthesis is
   identified as authored here, never attributed to a sampled library. If a candidate sounds wrong, select a
   better licensed source or craft that component procedurally; do not ship it merely because it is free.
4. **R4 — Browser state tells the truth.** Construct/resume the live context from a user gesture, and report ready
   only after successful resume with a running context. Handle absent Web Audio, rejected resume, suspension,
   interruption and disposal without unhandled rejection or a falsely lit sound control. No replay backlog after
   unlock, unmute, return to the tab or device interruption. A gesture may unlock audio, but muted settings stay
   muted. Unmute does not itself bypass browser permission. Smooth master gain changes over 20–40 ms to avoid
   clicks; muted audio is actually silent. Repeated unlock is safe, disposal stops sources and disconnects/closes
   resources, and a pending unlock cannot resurrect a disposed instance. Package state/settings are local to the
   instance; main owns UI state and persistence.
5. **R5 — One bounded mix.** Use one context and a common master path. At most 16 simultaneous cue voices and
   64 live/scheduled source nodes per instance; count every foley/synthesis layer. Prefer an intentional short
   release/quiet-voice replacement over a sharp cut. Reserve room for control feedback and the beacon; a flood
   of footsteps must not erase them. Coalesce rapid duplicates and document the policy in the package README.
   Never queue an unbounded crowd or allocate one context/node graph per citizen. Decode selected assets once,
   reuse buffers and clean up finished nodes. Keep shipped compressed audio at or below 4 MiB and decoded sample
   buffers at or below 16 MiB. Neither normal cues nor a full-volume stress mix may clip; leave peak headroom
   (absolute PCM peak below 0.95 in the supplied render). Conservative gains, bounded overlap and dynamic control
   work together; a compressor alone is not proof of a hard ceiling. Keep long tails beneath the next action and
   ordinary speech. No automatic music bed or continuously busy ambience is introduced by this cue library.
6. **R6 — Sound comes from the action.** `pan` and `distance` are listener-relative presentation inputs from the
   consumer, with center/near defaults. Pan left/right and attenuate smoothly with distance; use a documented
   simple attenuation law with zero distance at full local gain. Clamp finite pan to [-1, 1], distance to >=0,
   and volume to [0, 1]; reject nonfinite values without passing NaNs into Web Audio. UI controls stay centered.
   No renderer, camera, Twitch client, DOM listener or world simulation dependency inside the package.
7. **R7 — Real demonstration, small verification.** Provide a deliberately labelled SIMULATED audio bench that
   uses the same library/graph as consumers. A user can unlock, hear each cue, compare material surfaces, change
   volume, mute and run a short walking/building/light sequence plus a bounded crowd burst. Show actual state;
   no decorative enabled label. Export a local WAV of that sequence and a waveform image for review. Listen to
   it when audio playback is available; on this host inspect the waveform and numerical peak/duration and state
   plainly that waveform review cannot establish timbre. One focused regression test exercises bounded voice
   allocation under a step flood while preserving control/beacon feedback. Avoid a test for every private helper,
   implementation-mirroring assertions, new audit reports or a proof framework. Browser checks exercise actual
   unlock/mute/dispose behavior. No silent cue in the catalogue may be marked finished.

## Contracts

Lane-local exports from `packages/audio/src/index.ts`, consumed as `@chatdom/audio`:

```ts
export type AudioCue = 'wood' | 'light' | 'wave' | 'beacon'
  | 'step' | 'place' | 'remove' | 'material';
export type AudioMaterial = 'wood' | 'stone' | 'earth' | 'metal' | 'glass' | 'fabric';
export interface AudioSettings { muted: boolean; volume: number }
export interface AudioCueOptions {
  material?: AudioMaterial;
  ui?: 'wood' | 'brass' | 'parchment'; // used only by the legacy wood/control family
  pan?: number; // listener-relative [-1, 1]
  distance?: number; // listener-relative metres
}
export interface KingdomAudioState {
  status: 'locked' | 'ready' | 'suspended' | 'unavailable' | 'disposed';
  settings: Readonly<AudioSettings>;
}
export interface KingdomAudio {
  unlock(): Promise<boolean>; // true only if the live context is running
  cue(kind: AudioCue, options?: AudioCueOptions): boolean; // true if scheduled for audible playback
  setSettings(settings: Partial<AudioSettings>): void;
  getState(): KingdomAudioState; // current snapshot, not mutable internal objects
  dispose(): void;
}
export function createKingdomAudio(settings?: Partial<AudioSettings>): KingdomAudio;
```

Defaults: `{ muted: false, volume: 0.65 }`, status `locked`, no context or automatic sound at import/construction.
Ready means the context can run; audibility additionally requires `!muted && volume > 0`. Suspended includes
browser/device interruption after unlock. A locked/muted/suspended/unavailable/disposed cue returns false and
does not enqueue playback. Missing/decoding samples must not silently produce success: a fully authored
procedural version may play while a sample loads, otherwise return false and expose the load failure in the
bench. An intentional rate/budget suppression also returns false. Unknown runtime cue/material values fail
explicitly. There is no asynchronous success queue or shared event message.

Main replaces the kingdom's existing `sound.ts` implementation with a thin adapter and adds the web dependency
at merge. The existing `unlock/toggle/enabled/cue/dispose` caller shape remains main's responsibility; `enabled`
must derive from actual state, mute and volume rather than optimistic intent. Main also connects future step
and build callbacks when those features exist. The lane neither edits those consumers nor fabricates them.

## Scope

May write `packages/audio/**`, `apps/web/src/audio-bench/**`, this spec, `work/lanes/sound/PRD.md` and
`work/lanes/sound/progress.txt`. Generated ignored evidence may land in `shots/audio/` or `/tmp/chatdom-audio/`.
Everything else is read-only: `packages/shared`, world/render/content, kingdom sound/scene/UI, avatar/build lanes,
root/web manifests, lockfile, root `THIRD_PARTY.md`, root scripts and route registration. You are not alone:
preserve other edits and report needs to main. Use a self-contained Vite HTML bench under the owned folder
(`/src/audio-bench/index.html`); relative source import can work before main adds the web package dependency.
No server configuration, live Twitch actions, image generation, external runtime services or new framework.
The lane may use existing workspace Playwright/Vitest and ffmpeg; no audio framework dependency is necessary.

## Acceptance

Provide package commands `check` for the focused regression and `demo` for the real browser sequence/WAV capture.
The demo starts only its own preview/dev process on a free port in 5170–5199, records that port and stops it at
completion; it never kills an existing service. Pass the selected port to capture, not a hard-coded parallel
worker port. From the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm --filter @chatdom/audio check
pnpm build
pnpm --filter @chatdom/audio demo
```

`check` uses one small Vitest regression for the documented voice budget/priority behavior. `demo` uses the
actual library in a browser with a trusted click to unlock; demonstrates rejected/locked state, successful
unlock, mute/unmute, zero volume, suspension/resume and disposal without console errors; and captures the
complete authored sequence through the same render graph in an OfflineAudioContext. It writes
`shots/audio/kingdom-sequence.wav`, `shots/audio/kingdom-waveform.png` and a concise peak/duration result.
Include isolated cues with their surface names in the bench so the listening reviewer can compare them directly.
No need to automate human timbre judgement. The sequence's non-silent sections must actually contain energy;
the mixed burst stays below 0.95 absolute peak at full volume. The mute demonstration produces silence.

Capture the bench at 1440×900 and 390×844, open those and the waveform with `view_image`, and report the paths.
Read `$look` for visual capture conventions; do not create a second kingdom renderer or require panel/stream
shots for a bench that owns neither surface. Main reviews source credits, integrates the facade, checks actual
kingdom sound-button behavior and the existing light ceremony, then runs `pnpm verify`. Main's integrated web
and stream captures remain integration evidence. Passing numeric audio checks does not prove it sounds good;
if this host cannot play audio, leave a clear listening request with the WAV and exact things to judge.

## Quality bar

Materials are distinguishable with the eyes closed. A light has welcome in it; a beacon has shared warmth,
not paid status. Footsteps sit under conversation and making a home remains pleasant after repetition.
Variations feel like the same physical object handled again. The few harmonic tones belong to a single kingdom
palette. Captured WAVs are the shipped synthesis and selected samples, not a separately sweetened soundtrack.
Every family is audible and complete before it enters the catalogue, while explicit mute, browser locks and
intentional crowd limits remain respected.

## References

- `work/references/prototypes.md`: learn the presentation seam and ritual timing; reimplement here, with current
  sound/money/privacy decisions. No prototype audio is presumed licensed for copying.
- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds): primary page checked 2026-10-30, 130 files,
  CC0, impact/foley tags. Evaluate physical contact layers; the page alone does not establish material quality.
- [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio): primary page checked 2026-10-30, 50 files, CC0,
  foley/footstep tags. Audition archive contents before selecting footsteps; surface coverage is not promised.
- [Kenney licensing/support](https://kenney.nl/support): commercial use allowed, supplied archive license must
  still be checked; Chatdom credits sources even when attribution is optional.
- [Chrome Web Audio autoplay](https://developer.chrome.com/blog/web-audio-autoplay) and
  [Web Audio specification](https://webaudio.github.io/web-audio-api/): resume from a gesture, observe actual
  running/suspended state, reuse buffers and clean up scheduled nodes. Original small graph, no copied engine.

Primary-page/license reconnaissance was independently checked by a Luna low scout; main spec author reviewed
the same primary pages. No archive audition, source-code adoption or listening result is claimed by this spec.
Asset selection and final audio judgement are the lane's work, recorded in its package credits and progress.

## Not now

Presence-driven music composition, ambient place loops, Voice of the Realm/TTS, LiveKit voice, Twitch posting,
replay/network sound messages, kingdom theme generation, gameplay implementation and a general audio editor.
These are separate real consumers and need their own contracts. The interface here covers the current ceremony
and walking/building feedback without predicting those systems.

## Decisions

- **2026-10-30 — Founder direction.** CC0/permissive libraries plus procedural audio; every shipped source is
  credited in root `THIRD_PARTY.md`; no silent actions. Material, spatial origin, variation and a coherent
  non-clipping mix follow the quality and art direction.
- **2026-10-30 — Small approved local boundary.** Main approved the lane-local interface, the six generic
  wood/stone/earth/metal/glass/fabric surfaces and truthful unlock/state. No shared/network contract. Main
  prepares the package/lock entry before branching, owns facade/UI integration and root-credit append at merge.
- **2026-10-30 — Runnable first.** Task 1 delivers an audible real control/light pair and actual browser unlock,
  followed by the ceremony palette, material actions, then the complete mix demonstration. No dummy success or
  empty final-cue registrations are needed to get an early listening result.
- **2026-10-30 — SO01 lane decisions.** Selected recordings ship as mono 16-bit WAV (Safari's Ogg Vorbis decoding
  is not guaranteed and WAV has no encoder padding; 6 files, 124 KB). Unknown cue/material/surface values and
  families not finished yet throw; non-finite `pan`/`distance` make `cue` return false; a non-finite volume
  throws. Every `unlock()` calls `resume()` synchronously in its own gesture, because Chrome parks a gesture-less
  resume indefinitely: the wait is bounded at 2.5 s (answer `false`, still `locked`), and a parked resume that
  resolves later still makes the instance ready. Mute and suspension stop ringing voices so nothing returns on
  unmute or resume. Additive lane-local exports beside the frozen types: `inspectKingdomAudio` (bench/check
  diagnostics), `renderKingdomAudio` (offline render through the same families, mixer and mix path),
  `FINISHED_FAMILIES` and the value arrays. The bench serves at `/src/audio-bench/index.html` and through the
  `/-/audio` route main already registered.
- **2026-10-30 — SO02 lane decisions.** The ceremony shares one D major pentatonic palette, the same three glass
  panes and the same wick: `wave` is five small window lights travelling across the stereo field, with wandering
  (not climbing) phrases over a gathering D3 undertone; `beacon` is a recorded wooden beam (the torch into the
  brazier), a procedural whoomph and sparks, then a six-note chord entering bottom-up under one filter that opens
  to the crest (~1.1 s) and closes, faded out by 4.95 s. No recorded fire or bell exists in the chosen packs; a
  tolling bell (`impactBell_heavy`) was rejected as the status sound the beacon must not be. Brass is a tuned
  `impactMetal_light` tap plus an original lever ring and mount; parchment is a sliced RPG Audio `bookFlip` with an
  original slide and settle. New selected files are peak-normalised to −1 dBFS (per-file gain recorded). Budget
  tiers are now whole-mix ceilings that reserve room above them (step 28, build 36, ceremony 40, beacon 58, control
  64 sources) instead of voice stealing, so the beacon and a control always fit beside a full ceremony without
  cutting anything. Shared noise sources carry every wick burst of a wave, keeping it at 19–20 sources.
- **2026-10-30 — SO03 lane decisions.** Each surface lives in `src/cues/materials/<surface>.ts` with its own
  recordings and resonance; the palm, fingertips, lift, grains and weight are shared (`handling.ts`) so all six
  sound like one person building. 29 new Kenney CC0 files (Impact Sounds footsteps on wood, concrete and carpet,
  medium wood/soft/metal/glass impacts; RPG Audio dirt footsteps and three cloth slices); stone has no separate
  block recording worth shipping (`impactMining` rings like a pick), so its step is played slower and heavier as
  the block. Metal and glass are tuned into the D major pentatonic palette and hand-damped. `remove` leads with the
  material and keeps the lift as a soft breath, never a whoosh or a smash. Each material family has a dB fader,
  set by measured momentary loudness across all six surfaces (steps ≈ −39 LUFS, cloth −42; choose −40; lift −38;
  set −33 to −35 at volume 0.65). Budget: step ceiling 28 sources, build 34 (was 36); footsteps give way, faded over
  20 ms, to building cues and to footsteps at least 3 dB nearer, within a per-tier fade allowance (step 6 voices /
  12 sources, build 2 / 6) that keeps both at or below the ceremony's 14 voices / 40 sources, so the beacon and
  control reserve holds; fading voices always count against 16 / 64. Coalescing is placement-aware (a call 3 dB
  nearer is not a duplicate). Distance also low-passes: 18 kHz / (1 + d / 6 m), floor 1.2 kHz. The shipped SO01/SO02
  files peak at about −4 dBFS, not the −1 dBFS SO02 recorded (ffmpeg's integer mono fold adds −3 dB); SO03 folds
  explicitly and verifies −1 dBFS. `check` runs `src/budget.test.ts` against a counting fake context.
- **2026-10-30 — SO04 lane decisions (with main's interruption review).** Everything before the master that holds
  sound (room convolution, filters, compressor state) is a renewable front: mute or volume 0 fades it out with the
  master and every voice over 30 ms and builds a fresh one; a browser suspension stops every voice and cuts the front
  while nothing renders. Live and offline both release a retired front by a silent render-time marker. Main's Forge
  bridge is additive and lane-local, outside the frozen interface: `playKingdomPhrase(audio, phrase, options)` plays a
  consumer-authored `KingdomPhrase` (synthesis tools of one voice only, never the context, master or recordings) in
  the ceremony or beacon tier, bounded to 24 sources over 6 s and 2 s ahead (larger throws), answering like `cue()`;
  `renderKingdomAudio` accepts phrase and `interrupt` steps; `noteHz` is exported for the palette. `demo` runs an
  in-process Vite dev server on the first free port in 5170–5199. Headless Chrome does not enforce autoplay, so it
  demonstrates refusal with a SIMULATED parked and rejected `resume()`, and suspension with the real context's
  `suspend()`. The offline render is seeded so the reviewed WAV is reproducible. In the stress burst, the street wave
  is held back (the ceremony ceiling is full with the beacon and the crowd); controls and the beacon always play.
