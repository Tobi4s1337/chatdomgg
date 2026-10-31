# Lane picture-trees

Spec: `work/specs/47-picture-trees.md` · Branch: `lane/picture-trees` · Worktree: `../worktrees/picture-trees` · Scope: `packages/content/src/trees/**`, `apps/web/src/kingdom/trees/**` · Worker: one `gpt-6.1-terra`, high effort.

Read the spec, `packages/content/README.md`, `$voxel-content`, and the art and quality direction first. Work only in scope; coordinate the integration seam with main. You are not alone in the codebase: preserve others' edits. For each task run relevant focused tests, record evidence and a progress line; capture and inspect images as specified. Main owns integration outside scope. Commit each finished task on the lane branch; sub-agents do not run git.

Every visual fix uses a before/after capture of the same view, shown side by side. Preserve the accepted lantern procession, street camera and warm pools.

## Tasks

- [ ] **PT01 — Make the first recognisable trees and see them** · Produce an oak and pine with distinct branch and crown silhouettes and a dusk three-angle contact sheet through the production voxel renderer. Inspect it with `view_image` and improve weak forms; report capture path and any harness `needs:` to main.
- [ ] **PT02 — Complete the tree family** · Add slender birch, waterside willow and a few gnarled elder variants, palette-aware seeded variation and stable IDs. Validate schema, palette, grounding and determinism; render and inspect the complete contact sheet and improve weak forms until they meet the spec.
- [ ] **PT03 — Prepare existing planting sites and quiet wind** · Implement the private site adapter and canopy metadata described in the spec. Keep identities and transforms stable, roots and trunks fixed, and all crown attachments coherent. Focused tests cover the producer and adapter. Hand the exact exports and any shader/depth requirements to main; do not create a new forest.
- [ ] **PT04 — Judge the grove in the accepted stream** · Work with main's integration of existing planting, wind, shadows and LOD. Capture and inspect one 1920×1080 stream still, correct lane-owned weak details and inspect again as needed. Run scoped tests, `pnpm typecheck` and `pnpm --filter @chatdom/web build`; report contact sheet, stream still, limitations and integration needs.

## Backlog

Ideas found while working go here; do not pick from this list during the lane.
