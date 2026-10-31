# @chatdom/ui

The carved kit: the same wood, brass, parchment and wax as the kingdom, for every surface that sits over it.
Solid components and one stylesheet. Spec: `work/specs/32-first-look-polish.md`.

```ts
import '@chatdom/ui/kit.css';
import { ProvenanceSeal, provenanceFromSource, provenanceLines, CrestChoice, ParchmentField, type Provenance } from '@chatdom/ui';
```

## What is here

- **Tokens** (`:root` in `kit.css`): `--cd-wood*`, `--cd-brass*`, `--cd-parch*`, `--cd-ink*`, `--cd-cream*`, one
  `--cd-wax-<state>` per provenance, type faces (`--cd-face-story|label|body`), a type scale whose floor is
  `--cd-type-min: 12px`, label tracking `.08em` and the brass focus wire (`--cd-focus*`).
- **Materials**: `.cd-plate` (walnut with brass pins), `.cd-slip` (parchment), `.cd-seal` (pressed wax),
  `.cd-label` (small caps). Inks are chosen for contrast on their own plate: ink on parchment 9.4:1, soft ink on
  the darkest parchment 4.95:1, soft cream on the darkest wood 7.8:1.
- **Focus**: `.cd-focus`, or any focusable inside `.cd-kit`, draws a real 2 px brass outline 3 px outside the
  fitting. It is an outline, not a shadow, so it survives forced-colour mode (where it becomes `Highlight`).
- **`ProvenanceSeal`**: one quiet parchment slip with the wax pressed over its left edge. `role="status"`,
  `aria-atomic`, `data-provenance=<state>` and `data-practice="true"` when a SIMULATED line is present. It infers
  nothing: the owner passes the feed state, whether practice content is on screen, and an optional product note.
- **`CrestChoice`**: crest seals (hearth, tide, grove; code-native SVG) on a wood rail. A labelled `radiogroup` of
  `<button role="radio">` with `aria-checked` and one roving tab stop (the chosen crest). Arrows walk and wrap, Home
  and End jump, a resting crest is skipped; walking never chooses. Space or Enter (native button activation) and a
  tap choose, and only a real change calls `onChange` and `onCue('wood')`. The cue is the owner's callback, so the
  owner's audio policy decides whether anything sounds (the kingdom owner can bind its existing sound policy). Chosen = lit parchment plate, raised, brass pin above, doubled ring; focus = the brass
  wire; resting = flat dark wood, unpainted device and `disabledReason` in words. Crests are at least 44×44 px and
  wrap on a phone. Keys live in `crest-keys.ts` (pure, tested).
- **`ParchmentField`**: a ruled parchment slip around a real `<textarea>` (native editing, IME, maxlength). Visible
  label and allowance (`allowance.ts`, announced politely only within the last 10%/20 letters), `invalid` shown in
  words with an optional tag and wired through `aria-invalid`/`aria-describedby`, a darker parchment and a `hint`
  reason when disabled. The brass wire rings the whole slip on focus. Text is 16 px so phones do not zoom on focus.
- **`provenanceFromSource`** maps exactly `SIMULATED`, `CONNECTING`, `LIVE CHAT`, `STREAM RESTING` and
  `CONNECTION LOST`. Anything else, including near misses and prototype keys, is `lost`, never live.
- **`provenanceLines`**: every distinct fact is its own line, feed first. A real feed with practice content keeps
  its own line (live, resting, connecting or lost) and adds `SIMULATED · practice, not chat` (or the owner's note).
  The pressed words equal the old source words, so readers of `.source-ribbon` text keep working.

## Bench and capture

`node packages/ui/src/bench/capture.mjs [--kingdom] [--base-url http://127.0.0.1:<port>]` takes the shared
capture lock, serves the isolated SIMULATED bench (`src/bench/`) on the first free port in 5170–5199 with the web
app's Solid compiler, reaches the brass focus by Tab, and writes `shots/first-look/kit/seal-bench@{1440x900,390x844}.png`.
With `--kingdom` (or a base URL) it also captures the real kingdom hero at dusk wearing the seal, asserting the
seal says SIMULATED, stays under 3% of the desktop canvas and clears the heading. It stops only its own servers.

## Adoption recipes

**Kingdom** (`apps/web/src/kingdom/index.tsx`, granted, done): the old ribbon is now
`<ProvenanceSeal class="source-ribbon kingdom-seal" state={provenanceFromSource(source())} simulated={practice()} />`,
where `practice()` is true while the Forge panel is open, a SIMULATED build session runs or a housewarming plays.
`source-ribbon` stays on the element so existing captures (`packages/testing/*`, herald shots, build-tools
capture) read the same words: a single-fact seal's `innerText` is exactly the old ribbon text, and the feed word
is the first `<strong>`. The housewarming's doubled `SIMULATED ·` became “Welcome to the street”, because the seal
stays visible above it. `kingdom.css` raised every product label to 12 px (eyebrow, caption, time and view
buttons, name and bubble small print) and moved the eyebrow to small caps at `.08em`.

**Stream view** (`apps/web/src/stream/index.tsx`, stream owner): replace the `sourceMark` switch's own
`.source-ribbon` with `<ProvenanceSeal class="source-ribbon stream-mark" state={provenanceFromSource(label)}
detail={note} />` and keep its rule that a fresh live stage shows no mark. Its notes (“A demonstration night”,
“Every home keeps its place”, “Windows return when the kingdom answers”) pass as `detail`. Herald shots already
read the first `<strong>`. Capture 1920×1080 and 1280×720.

**Panel** (`apps/panel`, panel owner): import the kit and wrap its source label the same way, then capture 318×496.

**Forge panel** (`apps/web/src/forge/index.tsx`, `forge.css`, granted, done in FL02): the panel is a `.cd-plate`
with `CrestChoice` for “Visit another kingdom” (replacing the native select; choosing still calls the same `family`
callback, then the rail rests with “Taking the road to …”), `ParchmentField` for `#forge-wish` (id kept for
`packages/testing/forge*.mjs`) and the brass `.forge-submit`. A failed attempt hands the words back and puts the
private reason on the field (“Only you …”); other private notes keep their own slip. The footnote says “Practice
Forge · your coals are untouched”, plus “Authored wishes · checks simulated” for the fixture; the kingdom seal keeps
SIMULATED visible beside the panel. The kingdom owner must bind the optional cue callback under its own grant. Request, fixture, refusal and result state are untouched.

**Build rack** (FL03): inherits tokens and the kit's focus. The in-world ritual stamp (`forge/ritual-view.ts`) keeps its text until its
owner adopts a persistent seal.

`node packages/ui/src/bench/forge.mjs [--kingdom] [--base-url …]` serves `index.html?kit=forge` (crest rail and
field in every state, SIMULATED) and drives it with a real keyboard, Tab, Shift+Tab and touch; with `--kingdom` it
opens the actual Forge panel (both sizes), walks its Tab order, answers `/forge-data` with 503 inside the browser
(never reaching a host service) to show the genuine cold-forge private error, and taps a crest to travel. Output:
`shots/first-look/fl02/`.

## Fonts and credits (for THIRD_PARTY.md)

Copied unchanged from `apps/web/src/atlas/assets/fonts/` into `packages/ui/src/fonts/`, each with its SIL Open Font
License 1.1 notice beside it:

| File | Family | Licence file |
|---|---|---|
| `im-fell-english-regular.woff2`, `im-fell-english-italic.woff2` | IM Fell English (Igino Marini) | `OFL-IMFellEnglish.txt` |
| `im-fell-english-sc.woff2` | IM Fell English SC (Igino Marini) | `OFL-IMFellEnglishSC.txt` |
| `alegreya-roman-latin.woff2`, `alegreya-italic-latin.woff2` | Alegreya (Huerta Tipográfica) | `OFL-Alegreya.txt` |

The `@font-face` family names match the ones the build rack and citizen card already declare for the same files.
