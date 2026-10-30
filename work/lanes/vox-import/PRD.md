# Lane vox-import

Spec: `work/specs/15-vox-import.md` · Branch: `lane/vox-import` · Scope:
`packages/vox-import/**`, `apps/web/src/vox-import/**` · Worker: Codex Sol, high effort.

Read `$ralph-lane` and the spec. The real build hook already exists in `build/Surface.tsx` and the exact
`BuildImportBridge` is in `build/session.ts`. Spec 15 is frozen; main includes the package scaffold/web
dependency/install metadata in the handoff commit before creating the lane. The lane creates the actual
`src/index.ts` implementation in task 1. Export the default Solid component with `{draft,onPreview,onChanged}`
exactly. Every task is done when `pnpm typecheck`, `pnpm lint`, the focused
`pnpm exec vitest run packages/vox-import` once tests exist, and `pnpm build` pass; visual tasks also require
the specified screenshots opened with `view_image`. Tick one box, append one progress line with evidence or
`needs:`, and commit one coherent step on the lane branch. Never change shared contracts or run git as a
sub-agent. Work beside the other lanes without reverting their changes. One useful boundary test suffices;
spend the remaining care on actual geometry, transform controls and editability.

## Tasks

- [ ] **VI01 — Read a real object into an honest preview** · evidence: test + shot. Implement bounded byte
  parsing, actual palettes and asymmetric original fixture, then connect file selection and model choice to
  main's preview hook. A real selected object is visible by this task. Add the single boundary test covering
  valid and malformed bytes. Unsupported scene/material behavior is stated before insertion.
- [ ] **VI02 — Fit the object to the home** · evidence: shot. Snap to allowed kingdom materials; implement the
  exact scale/translation conversion and deterministic box construction. Show snapped swatches, real size,
  remaining budget and replacement bounds. Validate a fresh cloned draft for the summary; main's void preview
  callback is no receipt. Preview invalid placement honestly and keep the controls usable
  on desktop and phone. Apply byte/work/destination limits before expanding data.
- [ ] **VI03 — Insert once and keep building** · evidence: browser flow. End any open gesture, call the real
  atomic draft insertion once and call `onChanged()` only for a changed result; verify the imported cells remain editable and the complete insertion undoes/redoes as one action. Cancel,
  stale reads, malformed input and failed validation retain the current draft. The normal publication gate
  keeps its authority and last-approved-home behavior; no import-specific pass.
- [ ] **VI04 — Judge the finished workflow** · evidence: four viewed screenshots + checks. Run the complete
  actual-file browser flow and malformed-file recovery. Open transformed preview and editable-result shots
  at 1440×900 and 390×844, improve craft/readability as needed, run the acceptance commands, and record exact
  evidence and any integration needs. Supply lane-local third-party attribution when anything is adapted.

## Backlog

Ideas discovered while working belong here. Do not pick them up without main's direction.
