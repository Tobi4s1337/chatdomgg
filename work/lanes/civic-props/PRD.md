# Lane civic-props

Spec: `work/specs/10-civic-props.md` · Branch: `lane/civic-props` · Worker: Codex Sol, high.
Scope: `packages/content/src/civic/**`, this PRD, `progress.txt` and the civic-props spec.

Use `$ralph-lane`, `$voxel-content`, `$chatdom-vision` and `$look`. Everything else is read-only, including core
castle/market, street/home lanes, materials, shared, catalogue/aggregate exports, web bench and scripts. You are
not alone: preserve others' edits and do not revert main's concurrent changes. Main supplies civic collection and
scene registration. Missing tooling/contracts gets `needs:` immediately; continue independent asset work, never
build private substitutes. No image generation or new NPCs/economy. Sub-agents never run git.

Every task is done when meaningful owned tests, `pnpm content:validate --collection civic-props --partial`
(omit `--partial` for CP05), `pnpm typecheck`, `pnpm lint` and `pnpm build` pass; the relevant production captures
have been taken and opened with `view_image`; the task is ticked; one evidence/needs line is appended to
`progress.txt`; and the lane worker records one coherent commit on its lane branch. Exact commands, rows and
sizes are in the spec. Work in order, one task at a time; no tasks from Backlog without main. Main reviews and
runs `pnpm verify` at integration. Do not claim geometry delivers runtime seating, sign content, light or actions.

## Tasks

- [x] **CP01 — The crossing and welcome arch make the first visible civic kit** · evidence: four models + dusk angles.
  Create the entry/factory, complete ten-row `CIVIC_MANIFEST`, owned integration README and a nonempty finished
  subset `BLUEPRINTS`. Build footbridge and ceremonial gateway in Hearth/Tide, largest silhouette first. Give
  bridge real ramps/landings and the arch its full open passage. Prove support/clearance with production occupancy.
  Render all four from three dusk angles and inspect the sheets; no placeholder forms for later tasks.
- [x] **CP02 — The existing market gains carts and prepared stores** · evidence: four more models + kit sheets.
  Add gift-cart and market-stores in both kits. Shape crates, barrel, basket and goods as crafted readable voxels;
  keep cart wheel/handle contacts and the market's negative space. Compare with read-only core stalls/well so the
  new forms add variety. Render/review new assets with existing forms and record occupied bounds/costs.
- [ ] **CP03 — The castle and plaza carry clear civic heraldry** · evidence: four more models + dusk silhouette review.
  Add banner-standard and crest-plinth in both kits with original simple abstract charges, grounded support,
  broad fabric/stone shapes and restrained colour. No fabricated emotes, crowns, loyalty or paid badges. Review
  three-angle real captures at thumbnail and close scale; improve anything that disappears or becomes confetti.
- [ ] **CP04 — Notices, seats and lanterns furnish the edges of the square** · evidence: final eight models + fixtures.
  Add noticeboard, direction-sign, bench and lantern-post in both kits, reaching twenty models. Document real
  surfaces, seat and approach dimensions and lantern pane centre; export the eight known `CIVIC_ANCHORS` records
  without adding blueprint metadata or fake behavior. Export both `CIVIC_REVIEW` assemblies, leaving a central route clear. Finish one meaningful rotated
  bridge/gateway support/contact/route test covering all four cardinal turns; include all assets in the fixtures.
- [ ] **CP05 — Demonstrate the complete market and castle furniture batch** · evidence: full-count validation + inspected scenes.
  Run full acceptance without `--partial`, take all twenty three-angle dusk views and both kit sheets, and capture
  civic-square scenes at 1440×900, 390×844 and 1920×1080. Inspect noon/night samples from the spec, real joins and
  phone/stream readability. Make up to three targeted improvement rounds; retain all ten required forms. Record
  actual cells/boxes/triangles/draws, final paths, rejected designs and remaining doubts. Resolve required `needs:`
  and hand main the manifest/fixture exports for integration; no repeated audit-only work.

## Backlog

Discoveries with evidence only. No extra categories, interaction contracts, palettes or placement systems without main.
