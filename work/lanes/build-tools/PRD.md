# Lane build-tools

Spec: `work/specs/13-build-tools.md` · Branch: `lane/build-tools` · Scope: `apps/web/src/build-tools/**`
Worker: **gpt-6.1-terra, high effort** (visual controls and tactile polish).

The shared facade is frozen in `packages/shared/src/build.ts`; the actual optional mount is in
`apps/web/src/build/Surface.tsx` and the core reference is `work/references/build-shaping.md`. This lane is
launch-ready after main commits the handoff and creates its branch/worktree; the team starts the worker. Export a default
Solid component from `build-tools/index.tsx` with `{ controller: BuildToolsController }`; use only that actual
facade. The real URL is `/?tier=hamlet&hour=19.5&build=1&source=simulated`.

Read `AGENTS.md`, `$ralph-lane`, `$chatdom-vision`, `$look` and the spec. You are not alone in the repository:
preserve others' changes, and write only the owned scope. Main owns the scene, core, pointer/keyboard ownership,
route and controller bridge. Never patch `packages/shared` or implement another editor to make a control work.
Write `needs:` in progress when a frozen bridge cannot support a behavior, then take another unblocked task.

Each task is done when `pnpm typecheck`, `pnpm lint` and `pnpm build` pass, the relevant small screenshot set has
been taken and opened with `view_image`, the box is ticked, one progress line records the result and any `needs:`,
and one commit is on the lane branch. Use the same focused browser tour as it grows; do not add broad test/audit
work or repeat town proof captures. Main handles `pnpm verify` and integration. Follow `$ralph-lane` for commits.

## Tasks

- [ ] **BT01 — Put a real tool rack beside the home.** Export the agreed entry from `build-tools/index.tsx`,
  connect the actual bridge, and show Place/Erase/Paint/Fill, selected state, readable draft/source status and
  current budget. Make one real edit from the rack in the main-owned scene. The home stays visible at desktop
  and phone widths. No mock editor, fixture-only success or second route. · evidence: desktop/phone shots + real edit
- [ ] **BT02 — Give materials, scale, symmetry and correction a crafted home.** Add the actual kingdom material swatches,
  names and selected mark; compact phone palette; all three brush sizes; and Off/X/Z/X+Z mirror. Exercise paint,
  occupied-region fill and a mirrored gesture through the core. Wire real undo/redo availability and complete
  gesture history; rejected targets retain a plain reason and leave history unchanged.
  · evidence: palette/brush shot + focused edit/history tour
- [ ] **BT03 — Finish comfortable thumb and keyboard controls.** Finish phone arrangement, safe areas and 44 px
  hit targets. The palette leaves the real target, rejection reason and main-owned scene controls unobstructed.
  Complete designed focus, names, actual core shortcut hints and drawer focus restoration; global keyboard and
  canvas gestures remain core-owned. Clean up subscriptions/listeners. Finish material-appropriate press/drawer
  feedback, using a supplied sound hook only if main adds one. Preserve repeated input and reduced motion.
  · evidence: 390×844 target/palette shots + touch/keyboard tour
- [ ] **BT04 — Make status truthful and look at the complete working rack.** Present actual `dirty`, `status`,
  `publishing` and `mode` states. `publish()` fulfillment is not live approval: LIVE authority is unavailable;
  the real SIMULATED local street replacement/Housewarming stays labelled SIMULATED and browser-local. Do not
  invent a receipt or review queue. Add the small scoped
  capture entry from Acceptance. Run the one focused desktop/touch/keyboard tour against the real scene,
  including rejected edit and close/reopen without duplicate action. Open the final 1440×900 and 390×844 images
  and fix cheap, clipped, unclear or obstructive controls. Report actual storage/publication limits and any
  missing core touch confirmation. · evidence: final shots + clean typecheck/lint/build + focused tour result

## Backlog

Ideas found while building go here; do not pick from this list without main's direction.
