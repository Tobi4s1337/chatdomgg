# Voices: choosing the Voice of the Realm (J01)

Tobias chooses. This file recommends one voice. It is written from measurements and alignment data, because the scripts cannot listen. Where a note is about how a voice sounds, it comes from a number (pitch, pace, pauses, loudness range, band balance) or the voice's own library labels. The "a little weathered" quality FILM.md asks for cannot be measured, so that part is for Tobias's ear.

**How to listen.** Use the level-matched copies, all at -16 LUFS and trimmed to the speech: `/srv/chatdom/media/teaser/audio/voice/j01/<voice>/matched/01-welcome.mp3` … `05-teaser.mp3`. The raw renders differ by up to 10 LU (VOG is about -13 LUFS, Rowan about -22), and the louder voice would otherwise win by default. The raw renders and their character alignments sit one folder up (`j01/<voice>/NN-<line>.mp3` and `.alignment.json`). Every number is in `j01/j01.json`.

## The model: eleven_multilingual_v2

One line ("Every stream has a chat. And every chat… is a people.") was rendered in Rowan with the same seed in both models: `eleven_v3` with `[warm]` and `[softly]` tags, `eleven_multilingual_v2` without tags. Both models accept the with-timestamps endpoint and return a character alignment. Files: `media/teaser/audio/voice/model-compare/`.

| | eleven_multilingual_v2 | eleven_v3 |
|---|---|---|
| Duration | 4.62 s | 6.19 s (1.14 s of it is silence at the end) |
| Loudness, true peak | -22.6 LUFS, -7.3 dBTP | -18.0 LUFS, -2.2 dBTP |
| Pace over the spoken span | 9.2 characters/s | 8.6 characters/s |
| Pause after "chat." / "chat…" | 0.63 s / 0.60 s | 0.93 s / 0.48 s |
| First word in the alignment vs the audio's onset | 0.05 s early | 0.18 s late |
| Last word end vs the audio's offset | within 0.11 s | within 0.11 s |
| Ends of the file | digital silence (-91 dB) | noise floor at -87 dB, and a -47 dB click in the last 10 ms |
| Tags | none | `[warm]` and `[softly]` are given time in the alignment (0–0.24 s, 2.24–2.68 s), so word timings must skip them (they do) |
| Billed | 23 credits | 30 credits (the tags are billed as characters) |

**Chosen: `eleven_multilingual_v2`.** The cut needs three things from the voice, and v2 measured better on each:
- **Captions.** v2's alignment lands within 50 ms of the audio. v3 put the first word 180 ms after the voice starts, and it placed a pause where the voice was still sounding.
- **Clean ends.** v2's files start and end in digital silence. v3's file ended with a click and a long silent tail that would have to be cut by hand.
- **Delivery from punctuation.** The pauses came out where the ellipses are, from 0.4 s up to 1.45 s, so the "room to breathe" is written into the line itself. Delivery tags are not needed for that.

v3's extra expression is the one thing a measurement cannot judge. Both files are there for Tobias to hear. If he prefers v3, run `TEASER_VOICE_MODEL=eleven_v3` with `j01.mjs` and `scratch.mjs`. That costs about 450 credits, and the caption timings would then need correcting against the audio onset (`measure.mjs` has `alignmentCheck` for this). The voices endpoint also lists `eleven_v4` among the candidates' high-quality models. The PRD names v3 and v2, so v4 was not tried. One test line would cost about 25 credits.

**Settings for every render** (in `apps/studio/voice/settings.mjs`, the same for all three voices): stability 0.5, similarity boost 0.75, style 0.2, speaker boost on, speed 0.94, seed 1207, output mp3 44.1 kHz 192 kb/s.

## The five lines

Short, present tense, warm, and never explaining a mechanic. The tags in brackets apply only to v3. v2 renders the same text without them. Names are written the way they are spoken.

| # | Line | Text |
|---|---|---|
| 1 | A welcome (a citizen arriving home) | Four years of quiet evenings… and tonight, your window is lit. Welcome home. |
| 2 | A forge reveal (the dragon chimney) | The forge cools. On a roof in the old quarter, a dragon sleeps… and smoke curls from its nose. |
| 3 | A raid (PinkKittyRose arrives) | Lanterns on the road. Pink Kitty Rose's people arrive under their own banner. Open the gate… make room at the fire. |
| 4 | A crowning | The season ends. Every light that held, every road you rode… tonight, the crown is yours. |
| 5 | The teaser line | Every chat deserves a kingdom. |

How to read the columns below:
- **Loudness** is the raw render (LUFS) and **true peak** is in dBTP.
- **LRA** is the loudness range in LU. A wider range means more light and shade.
- **Pace** is spoken letters per second over the span from the first word to the last.
- **Median pitch** and **pitch range** (10th to 90th percentile, in semitones) come from an autocorrelation tracker.
- **Low/high** is the RMS level below 300 Hz minus the level above 3 kHz. Higher reads darker and warmer.
- **Pauses** lists the gaps between words that are longer than 0.15 s, from the alignment.

## Candidate 1: David - VOG and Public Addresser

- Voice id `iBeucLPI8hr8MOJjjYTL`, in the account, category professional.
- Labels: male, middle aged, American, "professional", use case entertainment_tv.
- Description: "A perfect companion voice to bring live event introductions, announcements, or public address to life."
- Billed at the standard rate: 177 credits for the five lines.

| Line | File (under media/teaser/) | Duration | Loudness | True peak | LRA | Pace | Median pitch | Pitch range | Low/high | Pauses |
|---|---|---|---|---|---|---|---|---|---|---|
| welcome | audio/voice/j01/david-iBeucL/01-welcome.mp3 | 5.28 s | -14.4 | -1.0 | 2.2 | 12.0 | 137 Hz | 10.7 | 11.3 | evenings… 0.41, tonight, 0.24, lit. 0.59 |
| forge | audio/voice/j01/david-iBeucL/02-forge.mp3 | 8.38 s | -12.4 | -0.4 | 1.5 | 8.9 | 128 Hz | 10.9 | 8.3 | cools. 0.53, quarter, 0.35, sleeps… 0.58 |
| raid | audio/voice/j01/david-iBeucL/03-raid.mp3 | 7.76 s | -12.1 | -0.1 | 1.4 | 12.2 | 139 Hz | 7.2 | 6.8 | road. 0.48, banner. 0.53, gate… 0.43 |
| crowning | audio/voice/j01/david-iBeucL/04-crowning.mp3 | 8.38 s | -13.3 | -0.2 | 2.6 | 8.7 | 112 Hz | 11.8 | 9.3 | ends. 0.57, held, 0.44, rode… 0.54, tonight, 0.38, crown 0.19 |
| teaser | audio/voice/j01/david-iBeucL/05-teaser.mp3 | 1.85 s | -13.6 | -0.9 | 0.0 | 16.7 | 138 Hz | 12.8 | 5.3 | none |

Notes:
- **An announcer.** It is the loudest and most compressed of the three (-12 to -14 LUFS, true peaks up to -0.1 dBTP, a loudness range of only 1.4 to 2.6 LU), so every word lands at the same level.
- **Highest and brightest.** Its median pitch (112 to 139 Hz) is the highest of the three, and its low/high balance (5 to 11 dB) is the brightest.
- **Brisk.** It reads the welcome and the raid at 12 characters/s, and its pauses at full stops are short (0.24 to 0.59 s).
- **Fit.** It sounds like a crier or an arena announcer. It suits a short in-product call ("Open the gate!") better than a fireside narrator.

## Candidate 2: David - Movie Trailer Narrator

- Voice id `FF7KdobWPaiR0vkcALHF`, category high_quality.
- **Not in the account.** It is a shared Voice Library voice, found through `/v1/shared-voices`. Text-to-speech accepts it by id anyway.
- Labels: male, middle aged, American, "deep", use case entertainment_tv.
- Description: "Middle aged Male with a deep voice. Suitable for Entertainment & TV."
- **Billed at about 2.4 times the standard rate:** 422 credits for the same five lines that cost 177 in the other voices. The library voice carries its own rate.

| Line | File (under media/teaser/) | Duration | Loudness | True peak | LRA | Pace | Median pitch | Pitch range | Low/high | Pauses |
|---|---|---|---|---|---|---|---|---|---|---|
| welcome | audio/voice/j01/david-FF7Kdo/01-welcome.mp3 | 10.53 s | -15.9 | -2.0 | 3.2 | 5.9 | 110 Hz | 12.1 | 15.7 | evenings… 0.91, tonight, 0.69, window 0.35, is 0.16, lit. 0.96 |
| forge | audio/voice/j01/david-FF7Kdo/02-forge.mp3 | 11.52 s | -18.0 | -1.7 | 1.7 | 6.5 | 96 Hz | 8.3 | 9.0 | cools. 0.73, roof 0.22, quarter, 0.72, dragon 0.19, sleeps… 0.86, smoke 0.16 |
| raid | audio/voice/j01/david-FF7Kdo/03-raid.mp3 | 11.18 s | -15.0 | -0.2 | 2.7 | 8.3 | 100 Hz | 8.8 | 11.3 | road. 0.71, banner. 0.86, gate… 0.57 |
| crowning | audio/voice/j01/david-FF7Kdo/04-crowning.mp3 | 11.89 s | -18.4 | -1.6 | 3.6 | 6.0 | 87 Hz | 10.0 | 10.8 | season 0.19, ends. 0.82, held, 0.38, you 0.16, rode… 0.96, tonight, 0.48, crown 0.46 |
| teaser | audio/voice/j01/david-FF7Kdo/05-teaser.mp3 | 3.47 s | -12.3 | -0.7 | 0.8 | 8.3 | 128 Hz | 8.9 | 7.5 | chat 0.26 |

Notes:
- **Deepest and darkest.** It has the deepest single read (87 Hz on the crowning) and the darkest balance (up to 15.7 dB).
- **Slowest by far.** It reads at 6 to 6.5 characters/s on the welcome, forge and crowning, and every line runs 37 to 100% longer than in the other two voices (the welcome takes 10.5 s against 5.3 s and 6.2 s).
- **Pauses inside phrases.** It stops between words where the text has no punctuation: "window … is … lit", "roof", "dragon", "the crown … is yours". That is the measured shape of the trailer cadence that FILM.md §6 step 9 rules out ("not a parody of a movie trailer"), and the voice's name says the same.
- **The best closing read.** Its teaser line is 3.5 s with a beat after "chat".
- **Too slow for the shot list.** At this pace several narration lines will not fit their shots (S05–S06 and S10–S11 each have about four seconds).
- **Licence.** FILM.md §6 step 9 requires a library voice's licence to cover commercial use. Check its sharing terms before choosing it.

## Candidate 3: Rowan - Gentle, Soft-Spoken & Warm

- Voice id `kLhAstPcnnPxqzk6gS5i`, in the account, category professional.
- Labels: male, middle aged, British, "gentle", use case narrative_story.
- Description: "A calm, natural voice with soft-spoken delivery and clear, even pacing. Ideal for gentle, steady narration and audiobooks."
- Billed at the standard rate: 177 credits.

| Line | File (under media/teaser/) | Duration | Loudness | True peak | LRA | Pace | Median pitch | Pitch range | Low/high | Pauses |
|---|---|---|---|---|---|---|---|---|---|---|
| welcome | audio/voice/j01/rowan-kLhAst/01-welcome.mp3 | 6.17 s | -22.5 | -4.5 | 5.6 | 10.3 | 100 Hz | 8.3 | 13.9 | evenings… 0.41, tonight, 0.29, lit. 0.71 |
| forge | audio/voice/j01/rowan-kLhAst/02-forge.mp3 | 8.54 s | -24.5 | -7.3 | 5.3 | 8.8 | 93 Hz | 7.2 | 8.4 | cools. 0.48, sleeps… 1.45 |
| raid | audio/voice/j01/rowan-kLhAst/03-raid.mp3 | 7.84 s | -19.3 | -2.5 | 3.1 | 12.1 | 107 Hz | 7.3 | 13.2 | road. 0.43, banner. 0.60, gate… 0.48 |
| crowning | audio/voice/j01/rowan-kLhAst/04-crowning.mp3 | 7.52 s | -21.8 | -6.1 | 10.4 | 9.8 | 105 Hz | 5.8 | 10.6 | ends. 0.49, rode… 0.66, tonight, 0.68 |
| teaser | audio/voice/j01/rowan-kLhAst/05-teaser.mp3 | 1.91 s | -21.9 | -6.2 | 0.0 | 16.6 | 97 Hz | 11.1 | 7.6 | none |

Notes:
- **Deep and warm.** Its median pitch is 93 to 107 Hz, about as deep as the trailer voice (87 to 128 Hz), and its band balance is warm (8 to 14 dB).
- **Quiet, with light and shade.** It is soft-spoken and dynamic: -19 to -24.5 LUFS raw, with a loudness range of 3 to 10 LU. In the mix it needs a level lift and light peak control. The scratch copies already have both.
- **A natural storyteller's pace.** It reads at 9 to 12 characters/s. It takes the ellipses as breaths (1.45 s after "sleeps…", 0.66 s after "rode…") and never stops inside a phrase.
- **Calm, with a risk.** Its pitch range is the narrowest on the long lines (5.8 to 8.3 semitones), so it reads calm and steady. The risk is too much gentleness where the film rallies. In the scratch track, "…ride out." came back the quietest line (-28.8 LUFS raw) and needed 4.8 dB of limiting to reach -16.

## Recommendation: Rowan (kLhAstPcnnPxqzk6gS5i)

Rowan is the closest of the three to "deep, warm, a little weathered, a storyteller at a fire":
- It is about as deep as the trailer voice (93 to 107 Hz against 87 to 128 Hz) and warmer in balance than VOG.
- Its pauses fall where the text breathes, never inside a phrase.
- Its pace fits shots of three to five seconds.
- It is billed at the standard rate.
- Its labels (narrative_story, gentle) are a storyteller's, not an announcer's or a trailer's.

The same voice would also work as the in-product Voice of the Realm for welcomes and the ballad. If Tobias finds it too gentle for the rally lines, try a lower stability or a v3 render with `[rallying]` on just those lines (S17, S18, the raid) before changing voice.

Second choice: the Movie Trailer Narrator, if Tobias wants more weight and gravitas than warmth. It needs the speed raised (speed above 1.0) to fit the shots and fewer pauses inside phrases. It costs 2.4 times as much and needs its licence checked. VOG is the weakest fit for a narrator.

One thing all three share: the five-word teaser line comes out in about 1.5 s with no beat. For the final takes, consider writing it as "Every chat… deserves a kingdom." so the close lands.

## Scratch narration for the rough cut

17 lines in Rowan with eleven_multilingual_v2, one file per shot-list line. Each request carries the neighbouring lines as context (`previous_text` / `next_text`), so split thoughts read as one: "Show up…" / "…and the road leads home."
- The manifest is `apps/studio/voice/scratch.json`. Per line it holds the shot, text, edit-copy path, duration, loudness, raw file and alignment, trim offsets, and word timings in the edit copy's time.
- The edit copies are under `media/teaser/audio/voice/scratch/rowan-kLhAst/edit/`. Each is trimmed to the speech (50 ms before, 250 ms after), faded, and run through two-pass loudnorm to -16 LUFS integrated (measured between -16.5 and -16.2) with true peak at or under -1.8 dBTP.
- Lines too peaky for linear gain get a measured lookahead limiter first. `limitedDb` in the manifest records how much, up to 4.8 dB on S18.
- In the edit copies the audio onset sits within 50 ms of the first word and the speech end within about 80 ms of the last word.

## Scripts (apps/studio/voice/)

Run each with `node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/<script>.mjs`. Every render is cached under `media/teaser/audio/voice/cache/`, so a re-run is free.
- `eleven.mjs`: the client. It covers text-to-speech with timestamps, sound effects, voices (with a Voice Library fallback), models, the subscription, and usage stats. It also holds the disk cache, the ledger and the budget guard.
- `measure.mjs`: measurement with ffmpeg and alignment. It covers loudness, silences, envelope, speech bounds, pitch and balance proxies, alignment-vs-audio checks, two-pass loudnorm, and word timings.
- `settings.mjs`: the model settings and the chosen model.
- `probe.mjs`: free reads of usage and the three voices.
- `model-compare.mjs`, `j01.mjs`, `scratch.mjs`, `sfx.mjs`: the batches.

## Open

- **Sound effects are blocked.** The teaser's key lacks the `sound_generation` permission. needs: tobias enable sound effects on the teaser's ElevenLabs key (or provide one that has it), then run `sfx.mjs`. Its five prompts are already in `apps/studio/voice/sfx.json`.
- **The key cannot read some endpoints.** It also lacks `user_read` (the subscription endpoint), `models_read` and `speech_history_read`. Usage is read from `/v1/usage/character-stats` instead (see the ledger).
- **Tobias picks the voice (J01 is done when he does).** The final narration (TS11) then renders three takes per line in that voice.
