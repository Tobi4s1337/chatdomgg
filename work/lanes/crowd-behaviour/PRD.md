# Lane crowd-behaviour

Spec: `work/specs/16-crowd-behaviour.md` · Branch: `lane/crowd-behaviour` ·
Scope: `packages/world/src/citizen-behaviours/**`, `apps/web/src/citizen-behaviour-bench/**` ·
Worker: Codex Sol, high.

Read `$ralph-lane`, `chatdom/ChatDom.md` and the spec before starting. You are not alone in the codebase;
accommodate other workers and never revert them. Main owns routing, motion, rendering, shared contracts,
cue production, package exports and app hooks. Missing main inputs become a `needs:` line, never a duplicate engine.

**Start gate:** actual `CitizenChatCue`, approved-destination/goal API and renderer sample fields exist.
The optional `/-/citizen-behaviour` default-component route also exists. Main commits spec 16 and those hooks
before creating the branch/worktree; the team starts the worker. The policy uses caller-supplied `ambientSlots` plus existing `none|nod|wave`,
`lookYaw` and `time`; no new timed-pose/shared protocol is required. Main wires the real kingdom consumer and
control allowlist at merge. Bench uses actual motion/renderer APIs directly, never a duplicate engine.

Every task is done when `pnpm typecheck`, `pnpm lint`, the one focused scenario test once introduced,
`pnpm test` and `pnpm build` are green; its meaningful visual states have been captured and opened with
`view_image`; the box is ticked; one concise line is added to `progress.txt`; and one coherent conventional
commit is on the lane branch. Capture with the spec's owned script and a free documented port. All bench
views/captures say **SIMULATED**. Report actual motion/appearance evidence, no software-rendered fps claims.

## Tasks

- [x] **CB01 — Make neighbours notice one another.** Put nine supplied simulated citizens on the real
  motion/render adapter in the owned bench. Implement deterministic policy state, a bounded neighbour lookup,
  one mild nod/wave with look/settle and pair cooldown, and explicit reset/removal/control interruption.
  Show the first readable doorstep encounter at desktop and phone sizes. Introduce the single scenario seam
  test and extend that same scenario as later tasks add behaviour. No fake speech or friendship state.
  · evidence: greeting motion contact sheet and focused scenario test.
- [ ] **CB02 — Give streets and the market a gentle rhythm.** Add the authored doorstep/stroll/market/home
  routines using only main's approved destinations and goal requests. Begin pauses only at confirmed arrival,
  return each excursion to its real frontage, handle blocked/unreachable goals calmly, and preserve active gait
  through changes. Vary meaningful choices and timings by stable slot/epoch seed; tune by watching nine
  citizens over a complete routine and a 240-slot street composition. · evidence: street/market/home frames,
  one timed routine contact sheet and arrival/blocked branches in the existing scenario test.
- [ ] **CB03 — Let a witnessed chat line turn a few heads.** Consume the separate sanitized cue schema through
  the exact main adapter. Give its present speaker a finite nod and at most two nearby listeners a
  short staggered look using actual cue identity/source/timing metadata; coalesce bursts, deduplicate IDs and discard expired/foreign-origin/removed-slot cues.
  Never store/display text in the policy or add it to presence. Demonstrate ordinary cue, burst, walker
  takeover and stale/reconnect states; the bench supplies only labelled simulation cues. · evidence: chat
  look contact sheet, no-storm burst frame and cue/control/reset branches in the existing scenario test.
- [ ] **CB04 — Finish the authored crowd and integration seam.** Review nine-person and 240-slot routines at
  dusk plus one midday grounding pass. Fix synchronised timing, unreadable gestures, chatter and interruption
  pops. Capture/open 1440×900, 390×844, 1920×1080 and 1280×720 outputs; document the exact policy API,
  authored tuning and the exact caller loop/main merge integration in the owned README. Finish with no missing
  lane input, placeholder,
  invented body, live producer claim or duplicated route/pose implementation. Report the existing renderer's
  gesture transition limit honestly; main handles any rig polish at merge. · evidence: final contact
  sheets, representative full frames, green checks and concise main integration notes in progress.

## Backlog

Ideas discovered while working go here; do not select backlog work without a new brief.
