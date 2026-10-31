# Lane places-water

Spec: `work/specs/29-places-water.md` · Branch: `lane/places-water` · Worker: **gpt-6.1-terra, high**
Scope: `packages/world/src/places/water/**`, `packages/content/src/places/water/**`, `apps/web/src/places/water/**`,
the owned spec and this lane's PRD/progress. Read `AGENTS.md`, `$ralph-lane`, `$chatdom-vision`, `$voxel-content`,
`$look`, spec 29, and `work/lanes/kingdom-look-owners.md` before work. Read actual world exports before consuming them.

Every task is done when its meaningful scoped tests, `pnpm typecheck`, `pnpm lint` and `pnpm build` are green,
its required screenshots have been opened with `view_image`, the box is ticked, one evidence/needs line is in
`progress.txt`, and one coherent commit is on the lane branch. Collection validation runs after integrator registration;
missing registration is `needs:`, not permission to fake a collection. Each step remains runnable with isolated
labelled fixtures. No main prep guarantee, runtime stub or fake dependency import. Never tick integration acceptance
using fixtures alone. Seekable inputs come from caller time/history, not local timers.

You are not alone: preserve others' changes. Disjoint artisans may own content, metadata and renderer separately;
use **gpt-6.1-terra high** for visuals, **gpt-6.1-sol high** for deterministic derivation, **gpt-6.1-terra medium** for
tests. One owner keeps the bench/index. Sub-agents never run git. Only the worker commits `lane/places-water`.
Integrator alone owns `scene.ts`, combines reviewed lane commits into `lane/integrator` and runs integration checks.
Main reviews the candidate Tobias announces ready. Do not directly merge a lane to main or change another owner's files.

## Parallel work

PW01 content/pier modules and bench setup, PW02 mill/bridge/shore content modules, and PW03 pure metadata can
start together. PW01 lead owns content barrel and bench; PW02 publishes modules without editing that barrel;
PW03 owns only world derivation/fixtures. PW04 web water material can develop independently in its own module
after the bench frame input is agreed; PW05 owns wildlife/emitters after PW01/PW02 anchors. Only one web lead
assembles the mount/index, and only that lead edits PRD/progress/README. PW06 follows all actual dependencies.

## Tasks

- [ ] **PW01 — See the pier and lake in the real material.** Build modular supported pier/boathouse/boats and a
  labelled production-renderer bench/capture script. First visible result in this task: lake postcard and pier-deck
  at dusk at 1440×900/390×844. Use isolated fixture water/lighting inputs; no fake shared modules. Implement readiness,
  error checks, serial capture lock and owned-server cleanup. Record module counts and actual material/mesher costs.
- [x] **PW02 — Give the mill and bridge a silhouette.** Author mill, hub-centred overshot wheel, supported trough,
  open-arch bridge, weir and supplied-destination fingerpost; add reeds/lilies/pebbles/rock/stepping stones. Reuse civic
  crest read-only. Validate real support/open bay/arch/walk strip; fixture view mill-wheel and bridge-pond at both web
  sizes. Public text comes from caller. No generated course, trees, keeper, anvil or dragon edits.
- [x] **PW03 — Make supplied land into honest place metadata.** After actual main world types land, derive mounts,
  bed foundations, reach tangents/flow and walk/seat/emitter anchors from supplied point records/sites only. Fixtures
  use those same types; no generator stub. Validate site/bed/head/join/path constraints and report bad geography as
  `needs:`. Static turns remain cardinal. Document exact `createWaterPlaces` input/output and integrator recipe.
- [x] **PW04 — Carry real windows across water.** Implement depth/shore/foam/flow plus the explicit one-pass planar
  reflection hook and coherent analytic fallback. Prove renderer state restoration and no recursion; compare same
  full/reduced postcard and bridge-pond at night. Record source cap, texture bytes and actual pass/draw costs. W-M1/3/4
  consumers wait on actual land/light/frame inputs; independent shader experiments stay inside the labelled bench.
- [ ] **PW05 — Let the water live and people bring the warmth.** Add deterministic out-of-phase boats/wheel, wild
  critters, bounded rings/spray/dust/mist/fireflies and bounded floater presentation. Consume the real people-light
  result once available, no local stand-in. Seek forward/back and verify the same frame, empty/occupied lamp behavior,
  clear walk surfaces and caller resource survival after disposal. Supply sound hooks, never a competing audio engine.
- [ ] **PW06 — Demonstrate the whole water place and hand it to integration.** Run all spec commands after collection
  registration, open its selected final spec shots and quality comparisons, fix cheap silhouettes/reflections,
  and replace fixture inputs with actual dependencies for integrated acceptance. Write exact import/mount/update/
  teardown, blocker/shadow/walk/seat/light/audio and civic-bridge replacement recipe, credits and measured costs in
  README. Record remaining real-GPU checks. Integrator mounts it and runs `pnpm verify`; no shipped fixture fallback.

## Backlog

Worker appends discoveries here and never selects from this list without a new brief.
