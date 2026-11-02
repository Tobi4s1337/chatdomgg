# Voice: the final narration

The narrator is the Voice of the Realm, **Rowan** (ElevenLabs voice `kLhAstPcnnPxqzk6gS5i`, "Gentle, Soft-Spoken & Warm"), with
`eleven_multilingual_v2`. Rowan is the J01 recommendation in `VOICES.md`, and Tobias has the last word. If he picks another voice, run
`TEASER_VOICE_ID=<id> node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/final.mjs`. That renders the same script
with the same rule, for about 420 credits (the Trailer voice costs about 2.4 times as much). The edit then picks up the new
`final.json` without other changes.

## The script

Seventeen lines. Each is at most eight words, in the present tense, and never explains a mechanic. Split thoughts are rendered with
their neighbours as context (`previous_text` / `next_text`), so "Show up…" and "…and the road leads home." read as one breath across
the cut. One line changed from the scratch: the close is now "Every chat… deserves a kingdom." Without the pause the five words were
over in 1.5 s with no beat (VOICES.md). With it, every take holds 0.53 to 0.57 s after "chat…".

## How a take is picked

Three takes per line, one per seed (1207, 2207, 3307), all with the same settings (`apps/studio/voice/settings.mjs`). Take A uses the
scratch seed and context, so unchanged lines came from the cache at no cost. `final.mjs` (`pick`) chooses from measurements:

1. **Rule out takes the edit would get wrong.**
   - The captions would drift: the first word is more than 0.12 s off the voice's onset, or the last word is more than 0.12 s off
     the end of the speech. A line that opens on an ellipsis has its first caption word pinned to the onset. A breath after the
     last word is trimmed away.
   - The file opens with sound already playing.
   - The take clips.
   - The take does not breathe where the text does: at least 0.35 s after a word that ends in "…", and 0.25 s after a full stop
     inside the line.
   - The take overruns its slot in the cut by more than 0.25 s.
2. **Of the rest, take the one with the most light and shade.** That means the widest pitch range plus loudness range. The voice's
   measured risk is gentleness where the film rallies.

Every take's edit copy is trimmed to the speech (50 ms before, 250 ms after), faded, and two-pass loudness-normalised to -16 LUFS
integrated, with the true peak at or under -1.5 dBTP. The measured range is -16.5 to -15.9 LUFS. Caption word timings come from the
character alignment, in the edit copy's time. Everything is in `apps/studio/voice/final.json`. The audio is under
`/srv/chatdom/media/teaser/audio/voice/final/rowan-kLhAst/` (`raw/` holds the untouched renders and their alignments,
`edit/` the cut-ready copies).

The scripts cannot listen. These picks are measured, and Tobias's ear has the last word: every take is in the folder, named
`NN-<shot>-<A|B|C>.mp3`. To swap a pick, change `picked` for that line in `final.json`.

## The picks

| Shot | Line | Slot | Takes (speech length, pitch range) | Picked | Edit copy (under media/teaser/) |
|---|---|---|---|---|---|
| S01 | Every stream has a chat. | 3.3 s | A 1.45 s, 10.1 st<br>B 1.33 s, 5.4 st<br>C 1.17 s, 5 st | **A** (1.45 s, -16.2 LUFS, TP -2.7) | audio/voice/final/rowan-kLhAst/edit/01-S01-A.mp3 |
| S02 | Every chat… is a people. | 2.5 s | A 1.85 s, 10.6 st — out: sound at the start of the file<br>B 1.94 s, 5.4 st — out: last word 0.161 s off the speech end<br>C 1.85 s, 8.6 st | **C** (1.85 s, -16.2 LUFS, TP -2.4) | audio/voice/final/rowan-kLhAst/edit/02-S02-C.mp3 |
| S04 | And every people deserves a kingdom. | 4.8 s | A 2.02 s, 10.4 st<br>B 1.68 s, 14.2 st<br>C 1.73 s, 5 st | **B** (1.68 s, -16.2 LUFS, TP -2.1) | audio/voice/final/rowan-kLhAst/edit/03-S04-B.mp3 |
| S05 | Show up… | 3.4 s | A 0.54 s, 3.5 st<br>B 0.60 s, 3.9 st<br>C 0.48 s, 2.1 st | **B** (0.60 s, -16.3 LUFS, TP -2.6) | audio/voice/final/rowan-kLhAst/edit/04-S05-B.mp3 |
| S06 | …and the road leads home. | 3.6 s | A 1.08 s, 5.5 st<br>B 1.00 s, 9.1 st<br>C 0.98 s, 13 st | **C** (0.98 s, -16.2 LUFS, TP -2.7) | audio/voice/final/rowan-kLhAst/edit/05-S06-C.mp3 |
| S08 | Every minute in chat… a light in the window. | 4.1 s | A 2.52 s, 9.3 st — out: only 0.19 s after "chat…"<br>B 2.70 s, 4.9 st<br>C 2.87 s, 6.2 st | **B** (2.70 s, -16.2 LUFS, TP -2.4) | audio/voice/final/rowan-kLhAst/edit/06-S08-B.mp3 |
| S09 | Even the quiet ones. | 2.1 s | A 1.09 s, 9.1 st<br>B 1.07 s, 6.1 st<br>C 1.16 s, 6.8 st | **A** (1.09 s, -16.2 LUFS, TP -2.6) | audio/voice/final/rowan-kLhAst/edit/07-S09-A.mp3 |
| S10 | Speak it… | 1.7 s | A 0.55 s, 3.1 st<br>B 0.53 s, 5.6 st<br>C 0.53 s, 5.4 st | **B** (0.53 s, -17.9 LUFS, TP -1.6) | audio/voice/final/rowan-kLhAst/edit/08-S10-B.mp3 |
| S11 | …and the Forge makes it real. | 3.6 s | A 1.31 s, 4.3 st<br>B 1.39 s, 5.5 st<br>C 1.21 s, 7.7 st | **C** (1.21 s, -16.2 LUFS, TP -2.5) | audio/voice/final/rowan-kLhAst/edit/09-S11-C.mp3 |
| S13 | Come back… and it grows with you. | 4 s | A 1.77 s, 14 st<br>B 1.65 s, 7.4 st — out: only 0 s after "back…"<br>C 2.06 s, 10.1 st | **A** (1.77 s, -16.3 LUFS, TP -2.6) | audio/voice/final/rowan-kLhAst/edit/10-S13-A.mp3 |
| S15 | Friends arrive under their own banners. | 3.4 s | A 1.81 s, 8.1 st<br>B 1.90 s, 9 st<br>C 1.94 s, 5.4 st | **B** (1.90 s, -16.2 LUFS, TP -3.3) | audio/voice/final/rowan-kLhAst/edit/11-S15-B.mp3 |
| S17 | And when the night ends… | 3.2 s | A 1.20 s, 5.4 st<br>B 1.23 s, 3.5 st<br>C 1.32 s, 5.3 st | **A** (1.20 s, -16.2 LUFS, TP -3.9) | audio/voice/final/rowan-kLhAst/edit/12-S17-A.mp3 |
| S18 | …ride out. | 2.4 s | A 0.77 s, 3.6 st<br>B 0.80 s, 3.4 st<br>C 0.67 s, 3 st | **A** (0.77 s, -16.5 LUFS, TP -1.8) | audio/voice/final/rowan-kLhAst/edit/13-S18-A.mp3 |
| S19 | Every raid leaves a road. | 4.1 s | A 1.52 s, 10.8 st<br>B 1.48 s, 10.8 st<br>C 1.32 s, 5.4 st | **A** (1.52 s, -16.2 LUFS, TP -2.7) | audio/voice/final/rowan-kLhAst/edit/14-S19-A.mp3 |
| S21 | Thousands of chats. Thousands of kingdoms. | 3.4 s | A 2.65 s, 7.1 st — out: only 0.22 s after "chats."<br>B 2.65 s, 9.6 st<br>C 3.09 s, 6.8 st | **B** (2.65 s, -16.2 LUFS, TP -2.6) | audio/voice/final/rowan-kLhAst/edit/15-S21-B.mp3 |
| S22 | Your chat is waiting. | 3 s | A 1.03 s, 8.1 st<br>B 1.12 s, 6.1 st<br>C 1.58 s, 12.5 st | **C** (1.58 s, -16.2 LUFS, TP -2.4) | audio/voice/final/rowan-kLhAst/edit/16-S22-C.mp3 |
| CARD | Every chat… deserves a kingdom. | 3.6 s | A 2.30 s, 8.2 st<br>B 2.06 s, 12.7 st<br>C 2.35 s, 8.7 st | **B** (2.06 s, -16.2 LUFS, TP -1.9) | audio/voice/final/rowan-kLhAst/edit/17-CARD-B.mp3 |

## Cost

The final narration cost 417 credits: 36 new requests, plus 15 from the cache. The lane has now used 1,442 of its 40,000 credits
(`voice-ledger.md`).

## Open

- The sound effects are still blocked. The key lacks `sound_generation` (checked again Mon 2 Nov 01:45: the request was refused and
  nothing was billed). Until that changes, the hero sounds come from the kingdom's own sound modules (`apps/studio/sound/`).
  needs: tobias enable sound effects on the teaser's ElevenLabs key.
- Tobias confirms the voice (J01). He can also ask for the v3 model on the rally lines (S17, S18) if Rowan reads too gentle there.
