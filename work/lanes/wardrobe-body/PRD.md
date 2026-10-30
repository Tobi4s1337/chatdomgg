# Lane wardrobe-body

Spec: `work/specs/08-wardrobe-body.md` · Branch: `lane/wardrobe-body` · Worker: **Codex Sol high**.
Scope: `packages/content/src/avatars/**`, `apps/web/src/avatar-bench/**`, this PRD and `progress.txt`.

Read `AGENTS.md`, `$ralph-lane`, `$voxel-content`, `$look` and the spec. You are not alone in the codebase;
do not revert others' work or edit outside the scope. Main creates the branch/worktree and integrates the lane.
Spec 08 is frozen against `AvatarPartBlueprintSchema`, `AVATAR_RIG`, `AVATAR_SOCKETS`, `AVATAR_PART_LIMITS`,
`AVATAR_LOOK_LIMITS`, `AvatarCapeBlueprintSchema` and `AVATAR_PALETTE`. Capes are thin cloth data, never voxel parts; main owns the cloth renderer in `apps/web/src/citizens/capes.ts`. The optional `/-/avatars` route loads a default component from
`apps/web/src/avatar-bench/index.tsx`. Never author a replacement shared contract to unblock yourself.

Every task is done when `pnpm typecheck`, `pnpm lint`, the focused fit test once introduced, and `pnpm build`
are green; its applicable rendered sheets have been opened with `view_image`; its box is ticked; one progress
line records evidence/doubt; and the lane worker commits the coherent step on the lane branch. Sub-agents never
run git. Final acceptance adds `pnpm test`, complete capture, and main's integration `pnpm verify`.
Do not add per-voxel tests. Missing required main inputs get a `needs:` line; work on an independent task only.

## Tasks

- [x] **WB01 — Put a recognisable citizen on the real avatar bench.** Consume the frozen part type, canonical
  rig/palette and main route hook. Build the balanced body with neutral garb, one considered hairstyle and a
  cloak, then show it at `/-/avatars` through the real avatar-scale voxel material/mesh path. Add the owned
  deterministic capture script and visibly labelled SIMULATED fixtures. Capture front/side/back at dusk and
  web desktop/mobile sheets. The first task ends with an actual rendered citizen, not a validator-only core.
  · evidence: three-angle images and opened 1440×900/390×844 sheets; schema/budget report.
- [ ] **WB01C — Replace the block cloaks with cloth.** Before further back garments, migrate the first short
  cloak and bench to `AvatarCapeBlueprintSchema`. Export `createCape(id, fit)` from the owned catalogue;
  `createWearableParts` supplies only any rigid clasps/fasteners for these forms. Use main's real
  `createCitizenCapeRenderer` on the bench and main's back socket pose; do not write another cloth solver.
  Fit shoulder mounts, silhouette, length, lining, hem and registered colours to the four bodies. A cape must
  hang as a thin sheet, clear the hips during a stride and settle on stopping. Capture front/side/back and a
  short walk-to-stop comparison; inspect both standard web sizes. · evidence: cloth visible in the actual
  runtime, no voxel drape/backpack, one catalogue schema check and inspected fit captures.
- [ ] **WB02 — Make bodies and hair feel like different people.** Complete four contour families, eight human
  and two fey skin choices, six natural hair swatches and all eight hair treatments from R2–R3. Keep rig/pivots
  identical. Capture silhouette/body/hair contact sheets plus lightest/darkest skin at noon, dusk and night;
  inspect face read and textured-hair silhouettes at street distance. Add the one asymmetric source,
  attachment and scale regression test described in Contracts. · evidence: opened body/hair sheets and fit test.
- [ ] **WB03 — Dress every silhouette in common clothes.** Complete all twelve common forms, Hearth/Tide
  accent resolutions and the explicit legal layer combinations. Fit every form to all four bodies; inspect
  largest hair/headwear combinations. Capture individual pieces and composed head-to-toe looks, then fix
  hover, gaps, skin leaks, foot contact and z-fighting. · evidence: opened common/assembled sheets; measured
  cells, triangles, parts and draws for the difficult combinations.
- [ ] **WB04 — Let clothes carry a true history.** Complete the seven story pieces from R5, honest source
  descriptions, subscription active/lapsed mappings and tier-three rainbow swatch bindings. Keep laurel distinct
  from the monarch crown; do not implement grants, prices or fake reward success. Capture every piece and each
  cape's front/side/back fit; inspect subdued lapse variants. Supply the exact registered swatches through the cape's `shimmer` field; the existing runtime handles colour motion. Never add emission. · evidence: opened story sheet, descriptions and active/lapsed comparison;
  no unearned glow.
- [ ] **WB05 — Prove the assembled clothes fit the action poses.** Review all four bodies in walk
  contact/full stride, sitting, bow, raised-arm tool use and head turn on Three groups built from `AVATAR_RIG`.
  Focus on long coat, skirt, travelling cloak and long braid together; repair garment splits and secondary
  attachment clearances. Capture pose-fit sheets and street/stream lineups. Exercise main’s cloth runtime for capes and report any remaining clipping, settling or shimmer issue;
  hair motion remains main-owned. Do not implement a second animation engine here. · evidence: opened pose-fit sheets at web sizes and 1920×1080/1280×720 lineups.
- [ ] **WB06 — Deliver a coherent library to the avatar consumer.** Finish ordered catalogue/factory/review
  exports and the owned README with IDs, palette roles, permitted layer combinations, fit variants and costs.
  Validate the entire catalogue, run the focused seam test and full test/build checks, regenerate complete
  captures, open every sheet and replace any weak form. Report cut designs, unresolved main needs and specific
  remaining doubts. Main reviews the authored library against its first avatar consumer; do not claim motion
  or performance from a static bench or SwiftShader. · evidence: full green checks, catalogue manifest, final
  sheets/stats and handoff.

## Backlog

Ideas found during work go here; never pick from this list without a new brief.
