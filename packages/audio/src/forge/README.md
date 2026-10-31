# Forge ritual sound

The Forge's own sound layer (spec 17, R4–R6): every ritual stage and the refusal's cough, driven only by observed
`ForgeRitualFrame`s and admitted public refusal beats, on the host's context and destination.

```ts
import { createForgeAudio } from '../packages/audio/src/forge'; // main owns the package export

const forge = createForgeAudio({ context, destination: kingdomForgeBus }); // never context.destination
forge.setMix({ muted: settings.muted, volume: settings.volume });          // defaults: false, 0.65
// every rendered frame, with the very frame the presentation adapter was given:
forge.update(frame);          // null when the anvil is clear
forge.refusal(beat);          // only the admitted public beat that also went to the refusal visual
forge.dispose();
```

The adapter never creates, resumes or closes a context, never connects to `context.destination` and never receives
a prompt, maker, reason, judge result or persistence handle.

## What you hear

One physical story, all original synthesis (no recordings, no fetches, no speech, no soundtrack, no fanfare). Tuned
layers use the kingdom's D major pentatonic palette (`../palette.ts`); struck metal keeps inharmonic ratios on top.

| Stage | Moment (phase progress) | Sound |
|---|---|---|
| words | bed; glints at .07/.16/.25/.33; gather at .74 | a bellows breath rising; each rune a small brass bar (fundamental + ×2.76 overtone); an inhale and a soft D–A–D brass swell as the runes gather |
| blueprint | bed; lock at .84 (latch 100 ms later, at the picture's lock pulse) | a faint drawing air; a brass latch and a cool, slowly beating D5/A5 fifth |
| pour | bed; clank at .05 and .95; 14 bubbles .17–.85 | the crucible's iron clank; molten rumble and fine sizzle while the stream runs; thick low bubbles breaking upward |
| seal | bed; drip .1, stamp .35, ribbon .44, lift .58 | a wax plip; the press (thick thup, wooden knock, a little ring of the brass die); one dry parchment slide; air and handle strain as the hammer winds up; then the room holds its breath |
| strike | swing .04, impact .34 (the picture's `IMPACT`) | air rising into contact; bright contact, the dull squash of hot iron, a falling body thump, the anvil's long inharmonic ring with a slow beat, sparks crackling away — then space |
| cool | quench .01; ten ticks at the picture's own glint points | a quench hiss falling away with a fizz of scale; tiny high tinks as the skin contracts |
| flight | launch .05; land at .9 (the picture's `CONTACT`) | a release thump and air drawn up; air past the part follows its speed along the arc and stops dead on contact |
| landing | at contact; creak at landed .2 | a low body thump, a roof board's few modes, a dry contact, a short chatter of tiles, settling dust, the faint click of a fitting seated; one small timber creak; then nothing |
| refusal | `refusal(beat)`, 3 takes by `variant` | the forge coughs (once or twice, sooty), a cold iron tunk with no ring, and a low falling groan of air through the coals; never a buzzer or a voice |

## Truth rules

- **Observed facts only.** Each attack sits at a phase-progress point and is heard at most once per ritual, when an
  update crosses it. Repeated frames never strike again. Nothing is predicted ahead of the reported progress.
- **No backlog.** An attack crossed later than its tolerance (60–250 ms; strike and landing 120 ms), crossed by a
  seek or clock jump, or crossed while muted, at zero volume, suspended or closed is consumed silently. Unlock,
  unmute or a tab coming back never replays it. Scrubbing backwards re-arms only what now lies ahead.
- **Held gates.** When the reported progress stays put while the observation's elapsed time moves on (a pending
  gate), the bed eases to a quiet held texture (blueprint and seal breathe on the picture's 6.5 s cycle) and never
  escalates or repeats a sting. A host that stops sending frames, or sends identical frames (paused), goes quiet
  within ~0.5 s by itself.
- **Mute, zero or non-finite volume** ramp the layer master to silence within 30 ms and stop every owned source;
  the room's memory is renewed before sound returns. Volume is clamped to [0, 1]; gain is volume² (the kingdom's law).
- **Suspension or closing** (the context's `statechange`, checked again on every update) stops and disconnects every
  owned voice at once and replaces the room, so nothing from before comes back on resume.
- **Dispose** stops and disconnects only nodes this adapter made and detaches its listener; the host destination is
  never disconnected.

## Graph and bounds

Voices → bus → (dry + a synthesised timber-and-stone workshop room, 0.95 s) → front → 30 Hz guard → glue compressor
(−16 dB, 3:1) → master (volume²) → soft ceiling (linear to 0.7, never above 0.92) → host destination.

- **Budget, shared by destination:** every adapter on the same destination (one per active anvil) shares 12 sounding
  voices and 32 scheduled source nodes. A new sound evicts lower-ranked ones first (strike and landing rank highest,
  bubbles and ticks lowest); if nothing lower can go, it is held back. The same attack from two anvils within 50 ms
  is heard once. Evicted voices fade in 4 ms.
- **Per sound:** strike 8 sources, landing 7, lock 5, gather and refusal 4, others 1–2; the bed is one looping noise
  source through two filters. Every tail is bounded: each partial stops 52 dB below its peak, so the longest, the
  anvil's ring, ends about 7 s after the strike. The budget counts each partial only while it is still scheduled.
- **Memory:** per context one 2 s mono noise buffer and one 0.95 s stereo room (≈0.55 MB at 48 kHz). Nothing per
  frame but parameter automation on the bed.
- **Shipped bytes:** source only. No audio files.

## Levels

Measured on `shots/forge-ritual/sequence.wav` (rendered through the live adapters at volume 1, 48 kHz) with
ffmpeg `ebur128`; the default volume 0.65 is volume² = −7.5 dB below it. The reference is a streamer's voice at the
usual −16 LUFS stream target.

| Moment | Peak at volume 1 | Loudest 400 ms at 0.65 | Under a −16 LUFS voice |
|---|---|---|---|
| words, blueprint, pour beds | −20 to −23 dBFS | −39 to −40 LUFS | ~23 dB: atmosphere, never competing |
| seal stamp | −19.1 dBFS | −40.8 LUFS | ~25 dB: a short, small press (its transient is what you hear) |
| strike (with its ring) | −4.7 dBFS | −25.4 LUFS | ~9 dB: the one moment that cuts through |
| cooling, flight air | −25.1 / −29.2 dBFS | −39.3 / −43.3 LUFS | ~23–27 dB |
| landing | −5.4 dBFS | −28.1 LUFS | ~12 dB |
| refusal cough | −12.8 dBFS | −33.1 LUFS | ~17 dB |
| pending blueprint hold (12 s) | −43.7 dBFS | −57.6 LUFS | ~42 dB: a held gate is near silence |
| two anvils 0.7 s apart | −5.3 dBFS | −25.1 LUFS | +3 dB short-term over one anvil, bounded |

Whole ceremony: −29.3 LUFS integrated at volume 1 (≈ −36.8 at 0.65), 13.4 LU range, peak −4.7 dBFS (0.58), far
below the 0.95 bound. The soft ceiling never engages in the demo.

**Under speech.** The weight of the strike and the landing sits below the voice: only 7 % of the strike's first
200 ms and 2 % of the landing's energy fall in the 300–3400 Hz speech band (the body thumps are 52–124 Hz; the
contact and tile chatter sit above 2.6 kHz). The anvil's ring does sit in the band (A5 880 Hz and its 1.51×
partial); it falls about 10 dB in the first second and 16 dB by two, so the space after the impact stays under
the voice instead of droning through the next sentence.

**Tuned in this pass.** The refusal cough sat 25 dB under the voice at its first level (−41 LUFS momentary at 0.65)
and would pass unnoticed on stream; it is now +8 dB on its voice fader, near the seal's level and still well under
the strike. Beds were left as they are: 23 dB under the voice is the point of them.

**Listening.** This build host has no audio output, so nobody has heard these renders through speakers yet. What
was done instead: the real Chrome graph recorded through a worklet tap (`live.wav`), the full sequence
(`sequence.wav`), the waveform and log spectrogram inspected by eye, and the loudness and band figures above.
The spectrogram shows the intended story: the bed breathing, the ring's partials as clean lines decaying after
13.5 s, the landing's low thump with nothing ringing after it, the muted strike as a black gap, the held gate as
a faint floor. **Ask:** listen to `shots/forge-ritual/sequence.wav` on speakers and headphones (0–22 s ceremony,
23–27 s three coughs, 27–36 s mute segment, 37–49 s held gate, 50–74 s two anvils) and judge: does the strike feel
weighty rather than clangy, is the 7 s ring tail too long under talk, do the coughs read as a sulk (not a fault
buzzer), and do two anvils tire the ear?

**Under a slow host.** Attacks have 60–250 ms of tolerance; a host drawing frames slower than that hears an expired
attack as silence, never late. Under SwiftShader at load ~12, the swing (60 ms) was skipped once in five runs;
the strike itself has never been lost.

## Credits

Original synthesis by the Chatdom team; no third-party audio is used. Root-ready THIRD_PARTY block for main:

```
Forge ritual sound (packages/audio/src/forge): original procedural synthesis, no third-party samples or code.
```

## Checks

- `pnpm exec vitest run packages/audio/src/forge` — the temporal regression against a counting fake context:
  every stage once at 60 and 12 fps, thirty-second pending gates, duplicates and seeks, mute/zero/non-finite volume,
  suspension, two anvils and floods, disposal.
- `node apps/web/src/forge-ritual-bench/audio-demo.mjs` — real Chrome, the bench as host: a trusted click, the live
  ceremony, scrub, mute during the strike, zero volume, a real suspension, the cough, two anvils, the console; the
  live host bus recorded to `shots/forge-ritual/live.wav`; the full sequence rendered through the same adapters to
  `sequence.wav`, `waveform.png`, `spectrum.png` and `audio.json`.
