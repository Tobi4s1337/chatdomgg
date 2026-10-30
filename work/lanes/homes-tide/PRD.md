# Lane homes-tide

Spec: `work/specs/05-homes-tide.md` · Branch: `lane/homes-tide` · Worker: Codex Terra, high.
Status: **ready; spec frozen 2026-10-30.**
Scope: `packages/content/src/homes/tide/**`, this PRD, `progress.txt` and the Tide spec. Everything else is
read-only. You are not alone: preserve other edits. Core assets, materials, shared/voxel/render, aggregate exports,
root scripts/manifests and other lanes belong to main/others. Use `$ralph-lane`, `$voxel-content`,
`$chatdom-vision` and `$look`. No image generation. Sub-agents never run git.

Every task is done when its collection validator (`--partial` before the final task) and meaningful tests pass, `pnpm typecheck`, `pnpm lint` and
`pnpm build` are green, the main-owned render command captures its assets and the images are opened with
`view_image`, the task is ticked, an evidence/needs line is appended to `progress.txt`, and the lane worker records
one coherent lane commit. Final integration also runs `pnpm verify`; this does not replace explicit collection captures. The exact collection commands and image
sizes are in the spec. Work in order, one task at a time. Missing main tooling/contracts gets `needs:`; do not
implement private substitutes or pick from Backlog without main. A weak piece is replaced, not silently dropped.

## Tasks

- [x] **HT01 — A varied hut-and-cottage street worth looking at** · evidence: six-model bench + tests + shots.
  Build the three family grammars at hut and cottage tiers, stable IDs/entrances/window anchors and the lane's
  `BLUEPRINTS`/factory entry. Export `HOME_REVIEW` doorway focus data and render all six in the actual bench at dusk, inspect their silhouettes, interior access
  and window planes; improve what looks cheap. Confirm full reserve with locked rear empty. First visible result.
- [ ] **HT02 — Each family grows into its house** · evidence: three models + growth/contact tests + shots.
  Add the house tier with structural additions and kept family identity. Prove the entrance/address and existing
  window IDs do not move; test each shell's real approach/interior and palette. Inspect the nine-model comparison.
- [ ] **HT03 — Manors and halls remember the same home** · evidence: six models + complete family sheets.
  Finish manor/hall for all three families within active-depth and shared budgets. Add earned craftsmanship and
  space with restrained accents; keep the hut's dignity. Inspect all fifteen from three dusk angles and at noon/night.
- [ ] **HT04 — Demonstrate a coherent, walkable Tide neighborhood** · evidence: validation + final sheets.
  Finish all-family tests and the family/tier-ordered contact sheet, mixed street, threshold/interior and simulated presence light
  on/off renders at the spec sizes. Run full-count acceptance (omit `--partial`) and `pnpm verify` with main integration. Record actual asset/
  mesh costs, improvements and rejected forms; resolve required `needs:` before declaring the lane complete.

## Backlog

Discoveries with evidence only. No new asset categories, palette changes or interaction systems without main's brief.
