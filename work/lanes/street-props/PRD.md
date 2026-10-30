# Lane street-props

Spec: `work/specs/06-street-props.md` · Branch: `lane/street-props` · Worker: Codex Terra, high.
Status: **ready; spec frozen 2026-10-30.**
Scope: `packages/content/src/props/street/**`, this PRD, `progress.txt` and the street-props spec. Everything else is
read-only. You are not alone: preserve other edits. Core/home assets, materials, shared/voxel/render, aggregate
exports, root scripts/manifests and bench integration belong to main/others. Use `$ralph-lane`, `$voxel-content`,
`$chatdom-vision` and `$look`. No image generation. Sub-agents never run git.

Every task is done when the collection validator (`--partial` before the final task) and meaningful tests pass, `pnpm typecheck`, `pnpm lint` and
`pnpm build` are green, the main-owned render command captures its assets and the images are opened with
`view_image`, the task is ticked, an evidence/needs line is appended to `progress.txt`, and the lane worker records
one coherent lane commit. Final integration also runs `pnpm verify`; explicit collection captures remain required. Exact collection commands/sizes are in the
spec. Work in order, one task at a time. Missing tooling/contracts gets `needs:`; do not build private substitutes
or choose from Backlog without main. Keep ten required forms; replace weak designs rather than silently dropping.

## Tasks

- [x] **SP01 — A garden fence and wall kit that really joins** · evidence: twelve blueprints + individual shots + join tests.
  Build straight/corner/end fence and wall forms, each in Hearth and Tide: twelve blueprints, six shapes. Export
  the entry/factory and `JOIN_FIXTURES` data with documented join planes. Validate actual occupancy, compatible
  heights and grounded joins. Render individual pieces in the real bench and inspect their joins in occupancy tests. Prepare assembly
  transforms now; final all-ten-form assembly captures run after SP02 completes the kit.
- [x] **SP02 — Plants and stones finish the same street** · evidence: eight blueprints + two kit sheets.
  Add pot, trough, rock cluster and shrub in both palettes: eight blueprints, four shapes. Give each a broad
  authored silhouette, credible support and restrained accents; no fake resource/function. Render all twenty
  assets from three dusk angles and compare noon/night. Improve the forms that read as cubes or clutter.
- [ ] **SP03 — Demonstrate the complete quiet street batch** · evidence: acceptance + final sheets.
  Finish all-form/style tests, contact sheets and assembled garden edges with both home kits. Inspect joins,
  ground contact, cavities and foliage close up and at phone/stream sizes. Run full-count acceptance (omit `--partial`) and `pnpm verify` with
  main integration; record actual costs, improvements and rejected forms. Resolve required `needs:` before done.

## Backlog

Discoveries with evidence only. No new asset categories, interactions, palettes or placement systems without main.
