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
  `aria-atomic`, `data-provenance=<state>` and `data-practice="true"` when the surface is staged or carries practice
  content. With nothing to press (a staged surface without the owner's words) it stays in place, `hidden`. It infers
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
- **`provenanceFromSource`** maps exactly the renderer's staged word, `CONNECTING`, `LIVE CHAT`, `STREAM RESTING` and
  `CONNECTION LOST`. Anything else, including near misses and prototype keys, is `lost`, never live.
- **`provenanceLines`**: every distinct fact is its own line, feed first. The kit never prints SIMULATED (decision
  25: no labels): a staged state presses no line, or the owner's own `detail` as its word; practice content under a
  real feed adds no line, and a `detail` becomes the feed line's note. Real feeds keep their exact words.

## Public pieces (`@chatdom/ui/site`, `@chatdom/ui/site.css`)

The pieces every public surface is built from, so the front door, the Atlas and the panel read as one family.
`site/pieces.mjs` writes each piece as finished markup with no imports, so chatdom.io's pages write them into their
HTML at build time (`apps/web/src/site/vite.config.mjs`) and read with JavaScript off, and `site/seal.ts` draws the
same markup in the browser. Solid owners use the components from `@chatdom/ui`.

| Piece | Plain | Solid | Notes |
|---|---|---|---|
| Sign-in seal | `startSignInSeals()`, `mountSignInSeal(el, opts)`, `signInSeal()` | `<SignInSeal />` | Signed out: "Sign in with Twitch" with the official Glitch on its clear-space plate in a brass bezel. Signed in: a wax seal with the initial, who is signed in, a quiet Sign out, one brass way onward (`way`), or several (`ways`: the first in brass, the rest as quiet links; `atlasFirstWays` offers the Atlas, then your kingdom). `size: 'header'` lets the wax open a small card and shows only the first way. One session reading per page; signing out anywhere redraws every seal and fires `SESSION_EVENT` (`chatdom:session`) on `window`. |
| Twitch mark | `createTwitchMark()`, `twitchMark()` | `<TwitchMark />` | Decorative unless given a `label`. Never filtered, shadowed, recoloured or moved; see `work/lanes/front-door/twitch-brand.md`. |
| Watch on Twitch | `createWatchOnTwitch(login)`, `watchOnTwitch()` | `<WatchOnTwitch />` | Opens `twitch.tv/<login>` in a new tab and says so to screen readers; `small` for cards. |
| Site footer | `createSiteFooter()`, `siteFooter()` | `<SiteFooter />` | Imprint · Impressum, Privacy, Terms, How it works, The Atlas; the Twitch line; the operator; "Signed in with Twitch as … · Sign out" on chatdom.io. `base`, `external`, `twitch: false` and `compact` for the panel. |
| How it works | `createHowItWorks()`, `howItWorksSheet()` | `<HowItWorksSheet />` | Four real pictures (`site/img/`), at most 40 words each; what we never collect; the privacy link. |
| Notices | `showNotice()`, `announceSignInOutcome()` | | The parchment slip for each way back from Twitch (`?signin=`) and for signing out. |
| Return view | `rememberReturnView()`, `takeReturnView()`, `returnDestination()`, `walkReturnView(id)`, `walkHref(id)` | | `sessionStorage['chatdom:return-view:v1']`, written just before leaving for sign-in, read once on return. `walkReturnView` keeps a kingdom's walk-in gate (its address has a query sign-in refuses, so sign-in returns to `/`); `returnDestination(view, here, outcome)` says where the front page carries the visitor on to, with the `?signin=` outcome along. |
| Icons | `iconSvg(name)`, `ICON_PATHS` | `<Icon name />` | door, atlas, card, panel, home, search, watch, chat, live, crown, sign-out, external, arrow-right, arrow-down, close. |

Every control is at least 44 px tall on touch, draws the brass focus wire, and has no default browser chrome. The
type scale is `--cd-size-label` (12 px) to `--cd-size-display` in `kit.css`.

Recipes for the Atlas and the panel are in `work/lanes/front-door/SEAMS.md` §3.

## Every name renders (`@chatdom/ui/fonts.css`, `@chatdom/ui/names`)

`fonts.css` serves our own faces for every script a Twitch name may use, split by `unicode-range`, so a page
downloads only the scripts it shows (a Latin page fetches only Latin files). `--cd-face-name` is the name stack;
`kit.css`'s three faces fall back to the same world faces once `fonts.css` is loaded. Give each name `applyName(el,
text, hint?)` (or `.cd-name` / `.cd-name-line` with `dir="auto"`): it isolates right-to-left names inside an English
line, picks the regional CJK glyphs from the text (or the channel's broadcast language as `hint`), wraps long names
anywhere and never clips Thai or Devanagari marks. Canvases cannot read CSS: `await loadNameFaces(names)`, then
`ctx.font = nameFont(px, { text, lang })` and `ctx.direction = nameDirection(text)`.

The sheet itself is large (about 400 KB, 114 KB gzipped: the CJK `unicode-range` lists), though it fetches no face
until a character needs one. A page whose own words are Latin should load it after first paint, as the site does
with `void import('@chatdom/ui/fonts.css')`; `kit.css` already carries the Latin faces. The faces are rebuilt,
pinned, by `src/fonts/build.mjs`, and `src/fonts/check.mjs` proves each script draws in its own face.

## Bench and capture

`node packages/ui/src/bench/capture.mjs [--kingdom] [--base-url http://127.0.0.1:<port>]` takes the shared
capture lock, serves the isolated bench (`src/bench/`, typed states, no real feed) on the first free capture port
(`packages/testing/capture-ports.mjs`) with the web app's Solid compiler, reaches the brass focus by Tab, and writes
`shots/first-look/kit/seal-bench@{1440x900,390x844}.png`. With `--kingdom` (or a base URL) it also captures the real
kingdom hero at dusk and asserts that a staged night's seal is present, hidden and empty. It stops only its own
servers.

`node packages/ui/src/bench/names-check.mjs [--out work/evidence/front-door/fd11]` serves `names.html` (twelve Twitch names in
eleven scripts in the seal, the footer, a citizen slip and on a canvas) and `latin.html` (the same pieces and the How it
works sheet, Latin names only). It proves the Latin page fetches only Latin font files, that every world name's faces
load and nothing is clipped or overflows, and takes the stills.

## Adoption recipes

**Kingdom** (`apps/web/src/kingdom/index.tsx`, granted, done): the old ribbon is now
`<ProvenanceSeal class="source-ribbon kingdom-seal" state={provenanceFromSource(source())} simulated={practice()} />`,
where `practice()` is true while the Forge panel is open, a staged build session runs or a housewarming plays.
`source-ribbon` stays on the element so existing captures (`packages/testing/*`, herald shots, build-tools
capture) read the same words: a single-fact seal's `innerText` is exactly the old ribbon text, and the feed word
is the first `<strong>`. The housewarming's doubled staged label became “Welcome to the street”, because the seal
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
Forge · your coals are untouched”, plus “Authored wishes · checks simulated” for the fixture; the kingdom seal stays beside the panel
(hidden on a staged night). The kingdom owner must bind the optional cue callback under its own grant. Request, fixture, refusal and result state are untouched.

**Build rack** (FL03): inherits tokens and the kit's focus. The in-world ritual stamp (`forge/ritual-view.ts`) keeps its text until its
owner adopts a persistent seal.

`node packages/ui/src/bench/forge.mjs [--kingdom] [--base-url …]` serves `index.html?kit=forge` (crest rail and
field in every state) and drives it with a real keyboard, Tab, Shift+Tab and touch; with `--kingdom` it
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

The faces for every other script, built by `src/fonts/build.mjs` from the pinned fontsource packages and each with
its OFL notice in its folder:

| Folder | Family | Source |
|---|---|---|
| `alegreya-*-{latin-ext,cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}.woff2` | Alegreya (Huerta Tipográfica) | `OFL-Alegreya-fontsource.txt` |
| `world/arabic/` | Chatdom Arabic | Noto Naskh Arabic |
| `world/hebrew/` | Chatdom Hebrew | Noto Serif Hebrew |
| `world/devanagari/` | Chatdom Devanagari | Noto Serif Devanagari |
| `world/thai/` | Chatdom Thai | Noto Serif Thai |
| `world/jp/`, `world/kr/`, `world/tc/`, `world/sc/` | Chatdom JP, KR, TC, SC | Noto Serif JP, KR, TC, SC (sliced by `unicode-range`) |

The full list with authors is in `THIRD_PARTY.md` under "Name faces".
