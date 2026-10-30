# Lane panel-stream

Spec: `work/specs/07-panel-stream.md` · Branch: `lane/panel-stream` · Worker: Codex `gpt-6.1-sol`, **high**.
Scope: `apps/panel/**`, `apps/web/src/stream/**`, this PRD and `progress.txt`. Everything else is read-only.

Read `$ralph-lane`, `$chatdom-vision`, `$twitch-dev`, `$twitch-extensions` and `$look` as applicable. You are not
alone in the repository: preserve others' edits, never change shared contracts/root routes/renderer/lockfile, and
record exact `needs:` for main instead. Main supplies the route hooks listed in the spec before lane start.
Run one unchecked task per Ralph iteration, in order. Do not take work from Backlog.

Every task is done when `pnpm typecheck && pnpm lint && pnpm build` plus its one focused adapter test once introduced is green, its relevant captures
are taken and opened with `view_image`, its box is ticked, one progress line records decisions/doubts/evidence,
and one conventional commit is on the lane branch. No push. Main reviews/merges and runs `pnpm verify`.
Use one useful adapter behavior test and the shared lane browser review flow, not a new audit/test framework.
Root lockfile changes go through main. Use a free port in 5170–5199 for a manual lane preview; never reuse main's 5190. The shared capture
helper allocates a free port and queues through its machine-wide lock. Record any server you start. No production deploy, Extension submission or real Twitch content write.

## Tasks

- [x] **PS01 — A quiet viewer can see the kingdom under the video.** Build the static Extension entries and
  exported `Panel`, relative assets and Helper boot. Capture our existing kingdom renderer into a small fixture
  picture, then create the complete visible 318×496 carved frame: crest/name, obvious SIMULATED source, picture,
  window action, useful tonight summary and one-drawer navigation. Bare production without Helper/data gets an
  honest designed connection state. Establish `__chatdomReady` and the lane `scripts/look.mjs` capture entry.
  Keep first render useful, without implementing backend assumptions. · evidence: panel hero at 318×496 and
  mobile at 390×844, opened at actual size; green commands; bundle payload ≤1 MB with no three.js in panel.
- [x] **PS02 — The kingdom has a stage, a corner window and a bottom street.** Build `apps/web/src/stream/index.tsx`
  around the existing `createKingdomScene`, with clean output and optional preview. Author separate stage,
  corner and strip framing with thin crafted edges, correct source marks, supported hero/window shots and
  truthful loading/resting/lost-source treatment. Preserve current readiness/debug capture compatibility.
  Implement visibility disposal/remount and cancellation while constructing. No copied renderer or new camera
  contract. · evidence: stage 1920×1080/1280×720, window 480×270, strip 1280×180, plus hide/show browser check.
- [x] **PS03 — Lighting a window has consent, identity limits and a real answer.** Finish the adapter state
  model and named/unnamed consent flow, Helper token refresh handling, logged-out/unshared/guest states, fixture
  confirmation animation and honest unavailable production outcome. Add home plaque and factual Tonight drawer,
  resting Ballad/Chronicle if supplied and missing-data states. Add the single meaningful adapter behavior test:
  production unshared/unavailable never confirms or dispatches; explicit simulated named/unnamed can demonstrate
  confirmation and always keeps its source. · evidence: behavior test and panel state contact sheet at 318×496.
- [ ] **PS04 — The panel has a place at the tavern and in tonight's shared moment.** Finish Tavern watching/seating
  information, Forge signpost with live/coals/anvils limits, communal building meter, contextual crowd act with
  pending/ended/rate-limit states and fixed Bits shelf demonstration. No UGC input, real joined seat, private
  prompt echo, points spending, paid standing or fake purchase. Production shelf stays hidden without verified
  delivery support. Walk in is secondary and clearly leaves Twitch for the existing entry gate. · evidence:
  Tavern/Forge/act/shelf fixture captures, mobile drawer focus/back flow and real unavailable action check.
- [ ] **PS05 — Stream framing tells the night without asking the streamer to tend it.** Complete calm/show and
  starting/break/ending presentation, motivated supported-camera cuts, eight-second hold, shutters/return,
  optional safe rectangle and sparse public name climax. Exercise fixture moments without inventing live events.
  Keep debug/count/preview controls out of output. Preserve quiet output; preview says broadcast mix unavailable
  rather than claiming audio health. · evidence: clean stage calm/show at both broadcast sizes, seam contact
  sheet, each small format at actual size and safe-rectangle capture; stale source suppresses personal labels.
- [ ] **PS06 — Setup, safety and mobile feel as finished as the first picture.** Finish config/live-config local
  section/shelf preview and simulated Hide, with unavailable real save/Hide/review reasons and no royal powers.
  Tune wood/brass/parchment, typography, window-light feedback, tiny varied gesture sounds, designed focus and
  reduced motion. Run the complete lane browser review on nested static Extension paths, 318×496, 390×844 and
  844×390; inspect error/resting/long-name/identity-refused states and each OBS shape. Fix cheap or clipped details,
  report exact remaining server/real-GPU needs and image paths. · evidence: final complete look flow, one adapter
  behavior test and green workspace commands; main can integrate without a new shared contract.

## Backlog

Ideas found while working go here as one line each. Do not pick them without a new brief.
- A supported close "street" camera in the renderer would let the bottom strip look down a lit street into depth instead of cropping the window shot (main-owned scene.ts).
