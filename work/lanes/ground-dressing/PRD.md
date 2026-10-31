# Lane ground-dressing

Spec: `work/specs/28-ground-dressing.md` · Branch: `lane/ground-dressing`
Scope: `packages/content/src/props/dressing/**`, `apps/web/src/kingdom/ground-dressing/**`, narrowly this
collection's conditional palette/manifest branch in `scripts/content-validate.mjs`, this spec/PRD/progress.
Worker: `gpt-6.1-terra`, **high**; landmark/tree hero sculpting **xhigh**. Read `AGENTS.md`, `$ralph-lane`,
`$chatdom-vision`, `$voxel-content`, `$look`, spec 27 and `work/lanes/kingdom-look-owners.md`.

Main freezes the real landform contract and adds the collection dynamic path before branch creation. The team
starts the worker; team integrator merges reviewed local lane commits. Integrator alone writes scene/terrain
composition. No fake production land/geometry stubs, renderer changes, broad validator relaxation or package
registry edits. Ground exports wear/surface hooks under its owned folder for light+integrator to compose.
You are not alone: preserve other owners' edits. Report `needs:` and continue an independent owned task when a
consumer is absent. Sub-agents never run git. Lane worker commits on its own branch only and never pushes.

Every task is done when `pnpm content:validate --collection ground-dressing --partial`, `pnpm typecheck`,
`pnpm lint`, `pnpm exec vitest run packages/content/src/props/dressing apps/web/src/kingdom/ground-dressing` and
`pnpm build` pass; its applicable captured pixels are opened with `view_image`; one progress line records exact
checks, shot paths, real integration status and doubts; its box is ticked; and one coherent local commit exists.
Final GD06 omits `--partial` and adds integrated `pnpm verify`. Scoped checks never stand in for the latter.

**Order and disjoint parallelism.** GD01 is the web planner/mount/bench plus cover content and comes first visibly.
GD02 is independent tree content and may run alongside it only with a separate `trees/` module; GD01 owns the
collection index until a planned serial export update. GD03 garden/field content uses its own module and then
GD01's planner, so its integration follows GD01. GD04 needs GD01+GD02; GD05 needs GD01. GD06 follows all. If
fan-out is used, the lead owns index/export and validator edits; content owners have disjoint files; only one
agent writes the web planner at a time. Never label two tasks independent while both edit that planner.

## Tasks

- [x] **GD01 — A tended meadow visible through the real renderer.** Author meadow tufts, four single-colour
  wildflower drifts and clover/pebbles. Build pure deterministic clear-ground/density/drift planning, renderer
  mount, actual shadow release/cleanup, capture script and a typed SIMULATED fixture bench with production voxel
  mesher/material. Preserve calm open meadow and street/window clearance. Use bounded visible batching; measure the representative result once, without a synthetic future-family budget proof. Keep planner output
  identical between occupancy preparation and mount. Add only this collection's validator palette/manifest branch.
  First result: tufts catch window spill and flower drifts lead toward a home, without an even carpet.
  · evidence: looked street/hero dusk at 1440×900 + 390×844; deterministic-clearance/density test; measured costs.
- [x] **GD02 — Tree silhouettes worth a place in the kingdom.** Author old oaks A/B, beech, elder oak and its
  exact seat transform, wind-bent pine, fir, birch, alder, staked sapling, bramble hedge, pear espalier and woodland
  clump. Root flare, taper, broad asymmetric crowns, credible branch support; no lollipops or noisy voxels.
  Keep every final component grounded and within R1 budgets. Readable full/LOD4 silhouettes in one compact representative-angle sheet and one dusk elder-oak detail. Publish forms early for places-high, without transferring planting ownership.
  · evidence: opened sheets and 160 px/greyscale silhouettes; whole-collection support/meshed-budget checks.
- [x] **GD03 — Gardens with age, and a back fence that follows growth.** Author the full garden/field kit in
  Hearth/Tide/Grove: bed, woodpile, closed barrels, crates/sack, empty parked garden cart, field wall, rail fence,
  back fence. Place vignettes by tenure/real footprint, preserving existing doorstep props and front aprons.
  Back fence follows SettlementHome.allowedDepth in its local frame with actual rear clearance; omit only the
  impossible full-depth run with a report reason. Garden/structural blockers use exact cardinal turns.
  Publish opaque light blockers, true solid collision pieces/proxies and build hide/restore behavior.
  · evidence: opened old/new garden at both web sizes; growth test changes only its lot; hide/restore and clearance.
- [ ] **GD04 — Woodland layers on the actual land.** Plant the authored forms into spec 27's real tree zones and
  landmark points. A typed full fixture exercises zones while that producer is unavailable, clearly SIMULATED;
  production never invents fallback woods. Clearing crown envelopes clear its real radius+margin, and the beacon
  gap is open. Keep water, future lots, place sites, castle crown and Forge yard clear. Add heather/fern drifts,
  lakeside alders and grouped far ridge crowns; replace core tree planting only in integrator's accepted mount.
  · evidence: opened hero/edge/ridge at both sizes, actual-land integration when available; zone/water/crown tests;
  explicit tree collision/seat binding evidence or a blocking `needs:` before production use.
- [ ] **GD05 — Wear follows real routes.** Author stepping/edge stones, place street/verge pieces clear of
  paving and walk routes, and prepare a deterministic indexed wear sampler for active approaches, bends and
  supplied real footways. Export wear/surface-art masks from the owned folder. Land owns trails; high places own
  switchback stones; water places own fishing-rock steps. Integrator composes one worker surface choice; light
  composes ground shader hooks, preserving paving/waterbed priority. No unowned shader/terrain edits.
  · evidence: opened street noon at both sizes; wear and stones follow actual routes; no floating/blocked edge.
- [ ] **GD06 — Coherent wind and a whole-world review.** Use guarded owned material hooks with shared production
  lighting, caller time and real walker positions; cover bends around feet, canopies breathe, trunks/rigid pieces
  stay still. Prove seek repeatability, still-camera bounded update and disposal preserving caller resources.
  Run spec 28's selected final evidence, report actual primary/shadow draws, triangles, instance and geometry bytes,
  inspect the selected task/final views and correct noise, floating, pops and blocked windows. Deliver exact mount, sampler,
  surface-hook and teardown recipes to the integrator; real GPU p95/p99 remains team evidence.
  · evidence: opened selected sheets, two street frames 0.5 s apart, stats.json, full manifest validation and integrated verify.

## Backlog

The worker records ideas here and never picks from them without a new brief.
