# Spec 05: Salt & slate homes

Status: **frozen 2026-10-30.**
Vision: `chatdom/ChatDom.md` principles 3, 5, 11, 18 and §5; `chatdom/World-Tree.md` §5;
`chatdom/Artstyle-Soul-Feel.md` §§2, 6.1–6.2; `chatdom/Quality.md` rules 8–11.

## What and why

Make homes that belong together near the water: blue slate roof courses, creamy walls, timber returns and
rounded stone doorsteps. Their wind-shaped rooflines feel sheltered and loved, never grim or ruined. Three
authored families give neighbors different silhouettes without breaking the kingdom's kit. Each family has five
earned tiers, with a lovely hut at its beginning and a hall that remembers that hut. Growing means opening the
reserved land behind the house, never
moving the address. Windows are ready for real presence light; an empty model never claims somebody is inside.

## Current state

`packages/content/src/materials.ts` exports `MAT`, `MATERIALS`, `STYLES` and `StyleKey`. `STYLES.tide` is
“Salt & slate”: cream walls, slate roof, timber trim, stone base. `packages/content/src/core/index.ts`
contains main's baseline homes/castle/trees and remains read-only. It is a technical reference, not this lane's
finished family. `packages/shared/src/voxel.ts` owns `VoxelBlueprintSchema`, `HomeTier`, dimensions and materials.
The main-owned `packages/content/README.md`, `src/catalogue.ts`, `scripts/content-validate.mjs` and
`apps/web/src/content-bench/**` implement collection loading, validation and actual production voxel rendering.
`packages/testing/content-render.mjs` owns captures. Missing lane modules fail explicitly. The bench supports
individual models, a three-home mixed street, entrance closeups and labelled simulated window on/off review.
These review scenes are tooling fixtures, not real residents, placement, progression or ownership.

## Rules

1. **R1 — Fifteen homes, three real families.** Deliver all five tiers for each family below. Repositioned windows
   or recolors alone do not make another family. Keep a family recognizable as it grows; additions have a structural
   reason and at least two broad silhouette differences distinguish the three families even without color.

   | Family ID | Shape language |
   |---|---|
   | `gullstep` | Tall asymmetric front gable, deep slate eave and an off-center stone chimney |
   | `saltbend` | Broad hipped roof broken by a small entry gable, sheltered corner and solid stone skirt |
   | `keelcroft` | Paired narrow ridges joined by a lower return, deep window recesses and a compact porch |

2. **R2 — One lattice, one reserved address.** Use build cells at 0.125 m. Every blueprint reserves exactly
   `size: [64,160,128]` cells: 8 m frontage ×20 m height ×16 m depth, in XYZ order. Tier active depth is hut 8 m,
   cottage 10 m, house 12 m, manor 14 m, hall 16 m from `HOME_DEPTH_METRES`. Keep the south/+Z facade and entrance
   at a stable local position near z=124. The active prism is z≥128−depth×8 and grows toward −Z. No boxes occupy
   the locked rear; main supplies its tended meadow. Front entry, ground datum and existing window anchor IDs stay
   put within a family. No foundation slab quietly occupies the whole reserved lot at hut tier.
3. **R3 — Fit the registry.** `version: 1`, `kind: home`, `lattice: build`, `styleId: STYLES.tide.id`. Use only
   existing registered material IDs: the kit's wall/roof/trim/stone, `MAT.air`, `MAT.glass`, and restrained earth,
   bark, leaf, moss or flower accents. Do not edit colors, material properties, palette or style IDs. No baked
   emission, warm window fill material, emissive roof or paid-tier brightness. Dynamic warmth belongs to presence.
4. **R4 — A walkable shell.** The main entrance is an actual open passage at least 10 cells wide and 20 cells high
   above its floor, connected to a real ground-floor interior and the outside. Use a flush approach or steps no
   taller than two cells; never a hidden foundation wall across the threshold. All walls/roof/porch columns have
   thickness and support; no solid box pretending to contain a room. No closed static door, unusable ladder or
   decorative stair suggesting a route that does not exist. Keep enough interior headroom under low eaves.
5. **R5 — Light anchors are executable data.** Every visible presence window has a unique stable `ContentWindow`
   ID, whole rectangle within bounds, correct cardinal facing and center on its outward glass facade plane. An
   outward normal reaches outside air without hitting roof, shutter, plant or wall. Test metadata against actual
   occupancy, not just schema bounds. Windows remain unlit in ordinary asset renders; labelled simulated presence
   renders exercise light on/off using main's renderer. Do not paint in people or add public owner names.
6. **R6 — Author the large strokes.** Generous slate roofs, coherent overlapping courses, purposeful timber joints,
   softened corners, inset windows and a chimney with a readable cap. Material break-up follows courses/planks;
   no random per-voxel color noise or expensive checkerboards. Use two or three accents per view, not every
   available ornament on every home. The hut gets equal care; later tiers add space and craftsmanship, never dignity.
7. **R7 — Deterministic, bounded content.** Pure TypeScript construction, stable IDs
   `home-tide-<family>-<tier>`, no clock/network/random global state or renderer dependency. Keep within the
   shared 20,000-box, 64-window and padded-cell limits and the tighter budgets main records in the content README.
   No overlapping duplicate geometry to fake detail; air carves are intentional ordered operations. Same inputs
   produce identical blueprints. Validation reports actual occupied cells, boxes, windows, mesh cost and bounds.
8. **R8 — Demonstrate the street.** Render every model from three angles at dusk through main's actual voxel
   mesher/material pipeline. Produce a family/tier-ordered contact sheet and a mixed-tier lane in the bench. Inspect
   front/side/rear, threshold/interior, roof joins and window light on/off. Compare at noon and night as well.
   Do up to three improvement rounds; replace a weak design while preserving the required fifteen-model count.
   Report rejected forms, reasons, final sheet paths and any remaining objection. No occupancy plot substitutes
   for the final render, and no SwiftShader fps is a device measurement.

## Contracts

Consume `VoxelBlueprint`, `VoxelBlueprintSchema`, `HomeTier`, `HOME_DEPTH_METRES`, `RESERVED_LOT_METRES`,
`VOXEL_METRES`, `ContentWindow` and material/style types from `@chatdom/shared`, plus `MAT`, `MATERIALS`,
`STYLES` from `@chatdom/content/materials`. Half-open box coordinates are integer XYZ; `MAT.air` carves previous
boxes in order. No additional fields are added to strict blueprints. Preserve the shared metadata conventions.

Lane entry: `packages/content/src/homes/tide/index.ts` exports `BLUEPRINTS: readonly VoxelBlueprint[]` containing
exactly fifteen assets in family-major, shared-tier order, and
`createTideHome(tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint` with the family order above. Invalid runtime
input fails explicitly. Main owns aggregate exports and the bench collection loader; this lane never changes them.
Bench-only export: `HOME_REVIEW: Readonly<Record<string, { entrance: readonly [number,number,number] }>>`
contains every finished blueprint ID. `entrance` is an integer XYZ build-cell camera focus at the middle of the
actual open doorway (about mid-height above its floor); it is not navigation authority or blueprint metadata.
Keep it stable within a family. Lane occupancy tests prove this marker faces the real entrance/interior route.
The bench loads this export directly; no renderer import is needed in asset code.

No citizen, deed, tenure reward, placement or interactive door contract is introduced by these source assets.

## Scope

May write `packages/content/src/homes/tide/**`, this spec, `work/lanes/homes-tide/PRD.md` and its `progress.txt`.
Everything else is read-only, particularly `packages/content/src/core/**`, `materials.ts`, aggregate `index.ts`,
`packages/shared`, `packages/voxel`, `packages/render`, web routes, root scripts/manifests/lockfile and other lanes.
You are not alone: preserve others' work and report integration needs to main. No generated bitmap art, new
dependency, script infrastructure, renderer fix, actual earned-tier assignment, deployment or git by sub-agents.

## Acceptance

Run from the repo root. Build before capture so Vite preview contains the new collection and review fixtures:

```sh
pnpm content:validate --collection homes-tide
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/homes/tide
pnpm build
pnpm content:render --collection homes-tide
pnpm content:render --collection homes-tide --hour 12
pnpm content:render --collection homes-tide --hour 0
pnpm content:render --collection homes-tide --scene mixed
pnpm content:render --collection homes-tide --scene threshold
pnpm content:render --collection homes-tide --scene windows --presence off
pnpm content:render --collection homes-tide --scene windows --presence on
```

For intermediate tasks use `pnpm content:validate --collection homes-tide --partial`: a nonempty ordered
subset of the final IDs is allowed, and every included model still receives the same geometry/mesher checks.
`BLUEPRINTS` includes only finished assets; factories may reject unfinished tiers until their task is complete.
No empty placeholder model satisfies a task. Omit `--partial` for final acceptance: exactly fifteen are required.

The validator checks schema, registered kit palette, ordered IDs/count, full reserve and active-depth source
bounds, factory reproducibility, occupied-ground connectivity, retained window anchors and actual greedy mesh
cost. Its entrance heuristic finds a 10×20-cell clear prism with some floor support in the front eighteen cells;
it does **not** establish a walkable threshold-to-room route or step heights. Its window clearance checks two
outward cells, not every later obstruction. Lane occupancy tests must cover every asset's real route, steps of
at most two cells, supported roof/porch construction, unblocked facade, stable entrance/anchors and family
silhouette distinction. Invalid runtime factory arguments must throw. Source and visual review establish the
large-stroke craft; automated budget checks cannot judge it. Draw calls in render stats are measured; validator
`modelDrawBudget` is a budget, not a GPU measurement.

Default output is `shots/content/homes-tide/`: three 480×480 dusk views per asset, `contact-sheet.svg`,
`contact-sheet@1440x900.png`, `contact-sheet@390x844.png` and `render-stats.json`. The combined sheet contains
all fifteen in family/tier order, with three views per home; it is not a literal 3×5 grid. Noon/night outputs use
`hour-12/` and `hour-0/` subfolders so they cannot overwrite dusk. `mixed/` renders the first family's hut,
second family's house and third family's hall at 1440×900, 390×844 and 1920×1080. `threshold/` captures every
entrance close up at 480×480; the front camera can inspect the doorway, while lane occupancy tests establish
interior connectivity. `windows-off/` and `windows-on/` capture every model's first window close up at 480×480,
using the production window-light layer and an explicit SIMULATED label. These captures establish light on/off,
not real people or surrounding light transport. `--asset <exact-id>` narrows model/detail review. All commands
write actual render stats and fail browser errors or stale builds. Open contact sheets and detail views with
`view_image`; improve weak forms without dropping required IDs. Do not infer device performance from SwiftShader.

Main demonstrates the tooling against `core` before freeze, reviews source/fixtures/screenshots and runs
`pnpm verify` for final integration. `verify` does not automatically cover lane collections; the commands above
remain separate acceptance evidence. Missing tooling is `needs:`, never permission for a private replacement
renderer. Root install, aggregate exports and real-world placement remain main's.

## Quality bar

A tiny hut should feel snug in a sea breeze, and the hall should look like the same citizen cared for it over time.
The slate silhouette reads in a stream thumbnail; the sheltered doorway rewards a closer look. A full street feels authored and varied
with the warmth coming from present people. Shape, courses, glass planes and joinery must hold under the real
lighting/material pipeline. No blown-out glass, flat cube walls, floating ornament, fake doors or copied generic
house fifteen times. Preserve calm negative space between accents and a usable approach around the house.

## References

- `work/references/voxel-meshing-light.md`: coherent material regions, real occupancy/collision, outward faces and
  window lighting separate from geometry. Do not turn its renderer findings into new code in this lane.
- `packages/content/src/core/index.ts`: half-open construction and exposed window-plane examples; main-owned
  baseline to learn from, not to edit or wrap as the finished asset family.
- `.agents/skills/voxel-content/SKILL.md`: silhouette/material/accent sequence, three-angle dusk renders, visual
  improvement rounds and validator evidence. Existing registry IDs override any generic advice about colors.

## Not now

Interiors/furniture, characters, castle/civic pieces, Forge slots, dynamic doors, building editor, authored text,
game interactions, awarding progression, content pricing, sound, emote motifs, renderer shaders and new materials.
The shell and window metadata are complete static assets, ready for their real consumers.

## Decisions

- **2026-10-30 — Small independent content batch.** Fifteen Tide homes, three families ×five earned tiers.
  Main's core remains untouched. This is authored content on the existing blueprint contract.
- **2026-10-30 — Fixed reserved lot.** XYZ reserve is 8×20×16 m; facade/entry remain stable while active depth
  grows backward. Tier geometry never uses locked rear land. The lane does not assign a real person's tier.
- **2026-10-30 — Executable acceptance.** The main-owned bench now supports the required review modes; main
  reviewed the core fixture evidence before freezing. Partial validation serves intermediate tasks; final validation remains
  exact-count. Geometry tests carry route/support claims beyond the generic validator. No lane assets have yet
  been built or validated by this brief.

- **2026-10-30 — Ready for the team.** Main reviewed the real core mixed-street desktop/phone views, doorway and clean SIMULATED window fixture. Validator checks all 51 baseline assets; six review-fixture tests pass. Capture previews allocate free ports for parallel worktrees. The actual lane assets remain this lane’s acceptance, not a claimed result of the tooling check.

- **2026-10-30 — Presence consumer:** the first ordered window anchor is the citizen’s designated presence window. Keep it stable across tiers. The authoring bench lights all anchors for inspection; the kingdom lights that one anchor per citizen.
