# Spec 14: editable home starting shapes

Status: **frozen 2026-10-30; launch-ready after main commits the handoff.** The actual draft API,
optional default bench route and collection hook exist. Main integrates the real editor chooser at merge.
Vision: `chatdom/ChatDom.md` principles 5, 10–11, 17–18 and §10 example 4;
`chatdom/Moments.md` §14; `chatdom/World-Tree.md` rule 12, §5 and Decided;
`chatdom/Artstyle-Soul-Feel.md` §§1–2, 6.1, 6.3–6.4; `chatdom/Quality.md` rules 1, 3, 6, 8, 10–11, 14–16.

## What and why

A citizen choosing where to begin sees a few inviting home shapes, chooses one, and immediately makes it their own.
These are editable voxel starting points: a gabled room, a house around a corner, and rooms embracing a little court.
They teach useful proportions and the relationship between floor, wall, opening and roof through the building itself.
Hearth, Tide and Grove make the same choices feel local through different architecture as well as palette.
Every template has actual hollow space and clear doorways; its windows are real glass openings with presence anchors.
After insertion, each structural cell is as editable as a cell the citizen placed. The lane supplies content and a
review bench; main owns the private draft, editing tools, style finishing, permissions, saving and publication.

## Current state

- `packages/shared/src/voxel.ts` defines `VoxelBlueprint`, ordered half-open build-cell boxes, `ContentWindow`,
  the 0.125 m lattice, five `HomeTier` values, `HOME_DEPTH_METRES` and the `[8,20,16]` metre reserved lot.
- `packages/voxel/src/asset.ts:rasterizeBlueprint` already executes ordered boxes, including material-zero carves,
  into editable CPU `Uint16Array` occupancy. Production workers, meshing, sky and materials already render it.
- `packages/content/src/materials.ts` owns the three registered style kits. `packages/content/README.md` defines
  palette, support, windows and content budgets. Existing homes and Forge construction families are read-only.
- Spec 09 owns fifteen reusable construction forms in each of three Forge families. This lane neither duplicates
  those definitions nor waits for their delivery: complete free-voxel starting volumes are its distinct job.
- `packages/content/src/catalogue.ts` has the optional `build-templates` collection → `./templates/index.ts`.
  `apps/web/src/main.tsx` mounts an optional default component at `/-/templates`. Both hooks are main-owned;
  missing content still errors instead of returning fake assets.
- `packages/shared/src/build.ts` defines `HOME_BUILD_LIMITS` and `BuildDraftPolicy`, including `editableFrom`
  and `editableTo` inside a fixed reserve. `@chatdom/world` exports the implemented `BuildDraft` from
  `packages/world/src/build/draft.ts`; `insertBlueprint(blueprint, origin)` is an atomic region replacement.
  `apps/web/src/build/policy.ts:createPlotBuildPolicy(home, ownerId)` maps actual style/tier/depth to that policy
  without authenticating ownership. `packages/world/src/build/build.test.ts` exercises insertion/history and
  derived windows; the lane adds only the authored-template scenario, not another core proof suite.
- `apps/web/src/build/session.ts:BuildImportBridge` and `Surface.tsx` currently mount `.vox` tools only. A
  template selector in the real editor is a main integration follow-up at merge; this lane provides the
  finite factories/metadata and bench. The bench must use the actual draft, not invent a draft adapter.

## Rules

1. **R1 — Three understandable shapes in every kit and tier.** Export all forty-five combinations of kit
   `hearth`, `tide`, `grove`; form `gable`, `corner`, `courtyard`; and tier `hut`, `cottage`, `house`, `manor`, `hall`,
   in that nesting order. IDs are `template-<style>-<form>-<tier>`; each is `kind: 'home'`, `lattice: 'build'`.
   Gable is a single legible enclosed room under a complete roof. Corner has two joined wings and a connected
   L-shaped room route. Courtyard has connected rooms around three sides of an open-to-sky court with a clear
   approach from the street. Hut versions are compact real examples, not unavailable controls or substituted
   gables. Larger tiers grow the plan within the same vocabulary. No sealed, inaccessible upper floor or false stair.
2. **R2 — Architecture, not palette exchange.** Hearth uses a generous steep gable, stout timber and warm wall
   reveals; Tide has slimmer braced construction, swept slate eaves and projecting ledges; Grove has broad soft
   thatch shoulders, bark knees and rounded stepped reveals. Same-form kits differ in their occupied silhouettes
   and roof/reveal geometry, visibly in greyscale. Keep the plan readable, the room usable, roof ends closed, roof
   thickness credible, overhangs supported and accents restrained. No random voxel noise, flattened imported mesh,
   baked decoration outside occupancy, generated bitmap or off-palette material.
3. **R3 — The shape becomes the citizen's voxels.** The factory returns the existing strict `VoxelBlueprint`, not
   a mesh, prefab-only placement, new socket type or privileged object. Air boxes carve only this source's earlier
   solids. The core insertion seam rasterizes its ordered boxes into the same draft used by place/erase/paint/fill.
   One insertion is one atomic undo step; rejection leaves occupancy/history unchanged. Content does not implement
   that core again. A meaningful integration fixture must insert a real template, edit a wall cell, undo the edit,
   undo insertion, then redo it and prove exact state restoration. Never advertise template selection as publishing.
4. **R4 — Real rooms and open thresholds.** Every template has a supported clear route from the +Z street across
   the front threshold to a meaningful standing region in every authored room and, for courtyard, the open court.
   A route reserves at least 10 cells of width and 20 cells of headroom; floor height changes are at most two cells.
   Walls, roofs and trim cannot overlap that swept clearance. No door leaf is baked across the passage. This lane
   authors open doorframes; animated leaves and interaction belong to main/spec 09. All occupied components have
   a face-connected structural path to y=0. Include authentic floor/ceiling room volume, not a tiny drilled tunnel.
5. **R5 — Windows are people's light.** Include at least one executable stable `ContentWindow` per template.
   IDs are stable across the five tiers for retained windows; newly added windows have new IDs. Glass on the
   outward plane and two outward air cells across the complete rectangle follow the content README convention.
   Eaves, ledges and neighboring wings cannot block that rectangle. Geometry contains no emissive material or
   fake presence. A bench presence comparison uses the existing light layer and says SIMULATED on screen.
6. **R6 — Full home-tier boundaries and budgets.** Use the full reserved `[64,160,128]` build-cell source frame,
   south street at +Z. Non-air cells stay inside `z >= 128 - HOME_DEPTH_METRES[tier] * 8` and the other reserve
   boundaries. Overhangs count. Locked rear land remains air. Occupied Y is strictly below the tier's `height`
   in `HOME_BUILD_LIMITS`; the source reserve itself stays 160 cells high. Templates consume main's actual draft
   occupied-cell caps below; they never set permissions or enlarge a budget. All five tiers must pass insertion into
   their matching main policy, not merely the blanket content cap. Independent content caps are 2,000 boxes,
   1,000,000 occupied cells, 250,000 actual meshed triangles and one model draw; shared allocation/window caps also
   apply. If main's draft cap is tighter, the tighter cap wins. Measure executed cells and production mesh cost,
   rather than summing source boxes or estimating from a screenshot. Do not consume the whole available cell cap
   merely because it exists; leave useful room for the citizen's additions and report remaining capacity.

   | Tier | Active depth in cells | Height in cells | Maximum occupied draft cells |
   |---|---:|---:|---:|
   | hut | 64 | 48 | 32,768 |
   | cottage | 80 | 64 | 49,152 |
   | house | 96 | 88 | 81,920 |
   | manor | 112 | 120 | 131,072 |
   | hall | 128 | 160 | 196,608 |

   These values are documentation of `HOME_DEPTH_METRES` and `HOME_BUILD_LIMITS`, not lane-local budget constants.
7. **R7 — Bounded pure factories.** Inputs are the finite style/form/tier choices only. Unknown runtime values
   throw clearly. Every call returns independent owned data with deterministic output; mutating one result cannot
   corrupt a later selection. Use the kit's registered wall, roof, trim and stone plus air/glass and restrained
   natural accents allowed by the README. No network, clock, global randomness, arbitrary stretch, free text,
   palette mutation, tenure/subscriber marks, entitlement gates, paid capacity or magic approval.
8. **R8 — Starting choices explain themselves.** Supply concise authored title and one practical building hint
   per form, plus human kit/tier labels for the selector. Teach through language such as “Keep the doorway clear”
   or “Add a wing beside the court,” tied to the selected shape. Never show raw asset IDs as the product title.
   The review selector displays the occupied budget and remaining capacity truthfully from real generated cells.
   Previewing does not change the draft; only an explicit choose action uses main's insertion seam. Existing work
   remains recoverable through undo. Loading, rejected insertion and invalid selection have designed useful states;
   no fake success. This bench is visibly a local content review, with no claim of signed-in ownership or saving.
9. **R9 — Visible early, production pixels throughout.** Task 1 supplies a complete Hearth gabled hut and a bench
   that renders it with the production worker/material/lighting. Finished entries only enter `BLUEPRINTS` during
   partial work. Final collection requires all forty-five. Each changed model gets three dusk views and a looked-at
   contact sheet; final review adds real cutaway/threshold views and actual core insertion/edit/undo demonstration.
   A cutaway is explicitly a review view; it does not alter the authored source or imply a second render engine.

## Contracts

**Existing and consumable now:** `VoxelBlueprint`, `VoxelBlueprintSchema`, `ContentWindow`, `HomeTier`,
`HomeTierSchema`, `HOME_DEPTH_METRES`, `HOME_BUILD_LIMITS`, `BuildDraftPolicy`, `RESERVED_LOT_METRES`,
`VOXEL_METRES` from `@chatdom/shared`;
`MAT`, `MATERIALS`, `STYLES`, `StyleKey` from main's content materials module; production voxel/render exports.
Blueprints remain strict: no room, template, origin, permission, tier or interaction fields are added to them.

`packages/content/src/templates/index.ts` exports:

- `BUILD_TEMPLATE_FORMS = ['gable', 'corner', 'courtyard'] as const` and its finite `BuildTemplateForm` type.
- `createBuildTemplate(style: StyleKey, form: BuildTemplateForm, tier: HomeTier): VoxelBlueprint`.
- `BLUEPRINTS: readonly VoxelBlueprint[]`, final forty-five in R1 order. This is the one exported geometry catalogue.
- `BUILD_TEMPLATE_LABELS`: finite form titles and concise hints, separately from source geometry.
- `TEMPLATE_REVIEW`: bench/test facts keyed by blueprint ID: an integer threshold feet point, interior standing
  points per authored room, optional court standing point, and stable window IDs. These are assertions to check
  against actual voxels, not collision, navigation or publication authority. Record local coordinates in the README.

The actual editable seam is `new BuildDraft(policy, saved?)`, with readonly `policy`, `revision`, `voxelCount`,
`canUndo` and `canRedo`; `insertBlueprint(blueprint, origin): BuildChange`, `apply(operationOrBatch)`, `undo()`,
`redo()`, `get(cell)`, `cloneVoxels()`, `serialize()` and `compile()`. `compile()` supplies the production shaped
asset and derived window anchors. Insertion imports source cells and derives anchors again from actual glass;
it does not retain authored window IDs. Content-window IDs remain stable source metadata, never a claim that
the core preserves those IDs through arbitrary cell edits. Blueprint air clears its whole region; only changed
cells are checked against policy, so locked rear air in a full-reserve source is legal. The resulting occupied
cells must remain inside the unlocked area. The core owns this behavior; do not crop into another source format.

The bench exports its default Solid component from `apps/web/src/template-bench/index.tsx` at `/-/templates`.
Query selectors are finite `style`, `form`, `tier`, plus `angle=front|side|back|cutaway`, `hour`, `seed`.
Invalid selectors render a clear error and cannot silently select a default. Omitted selectors choose the first
finished template. `__chatdomReady` becomes true only after the requested asset's worker result, shader compilation
and completed frame; a bench-specific report identifies actual asset, selectors, occupied cells, triangles, draws
and draft insertion/edit/undo state. Errors remain errors and fail capture. Dispose workers/rendering on unmount.

**Handoff readiness:** `packages/content/src/catalogue.ts` now registers `build-templates` and
`./templates/index.ts`; `apps/web/src/main.tsx` now maps `/-/templates` to the optional default
`template-bench/index.tsx` component. The draft API, tier policy and `work/references/build-shaping.md` exist.
Main commits those hooks and this handoff before creating the lane. No new shared contract is pending.

**Main follow-up at merge:** expose this finite template family through a real editor chooser, using this
lane's factories/metadata and the implemented draft insertion. The lane bench demonstrates actual insertion,
edit and undo; it does not patch the controller/session or pretend the citizen chooser is already integrated.

## Scope

Write `packages/content/src/templates/**`, `apps/web/src/template-bench/**` and this lane's PRD/progress only.
Everything else is read-only, including shared contracts, materials, core homes, Forge pieces, draft/editor core,
package exports, collection loader, global style sheets and route/capture infrastructure. Scope-local README,
Vitest checks and `capture.mjs` are allowed. Shots are generated evidence under `shots/`, never source assets.
You are not alone in the repository; preserve and accommodate others' changes. No git from sub-agents.

## Acceptance

Task-local checks (use only finished entries and the collection partial flag until the complete set exists):

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/templates apps/web/src/template-bench
pnpm content:validate --collection build-templates --partial
pnpm build
node apps/web/src/template-bench/capture.mjs --partial
```

Final acceptance drops partial mode:

```sh
pnpm exec vitest run packages/content/src/templates apps/web/src/template-bench
pnpm content:validate --collection build-templates
pnpm build
pnpm content:render --collection build-templates
node apps/web/src/template-bench/capture.mjs
pnpm verify
```

The lane supplies `capture.mjs` using existing capture lock/preview helpers, Chrome/SwiftShader and real readiness
checks; it may accept `--base-url` to reuse main's preview on 5190. It closes only resources it created. No capture
server outside 5170–5199; never reuse or terminate an unknown process. All page/console errors fail the run.

Use one parameterized geometry check over finished templates: execute occupancy and check usable supported
clearance at the declared room/court/threshold points, tier bounds/capacity, and executable windows. Reuse
content validation for schema/material/mesh costs. Add one scenario that inserts a real authored template into
main's policy, edits a wall, undoes/redoes insertion, and rejects an out-of-active-depth source without changing
the draft. Check final forty-five IDs/order in that existing test. Judge roofs, hollow rooms and kit distinction
by the required views. Do not build a second generic pathfinder, exhaustive placement suite, or tests that
merely compare generated output to itself.

Visual evidence:

- Production individual front/side/back 480×480 dusk views for all forty-five templates and complete captured
  contact sheets at 1440×900 and 390×844 under `shots/content/build-templates/`.
- Scoped bench at 1440×900 and 390×844 for every kit/form at a representative tier; all five tiers appear across
  that set. One 1920×1080 mixed-kit review, clearly a content review rather than real citizens or a stream claim.
- Per kit: one cutaway, a doorway detail, and one dusk/noon/night comparison. One labelled SIMULATED window
  off/on pair proves the source anchor is consumable by the actual presence-light layer.
- One desktop and phone insertion → edit → undo sequence, reporting real draft state. Capture selection rejection
  as an honest designed state. Open all sheets and representative full-size evidence with `view_image`; fix defects.

Report measured boxes/cells/triangles/draws and remaining tier capacity, exact evidence paths, rejected designs,
and any unresolved core integration need. SwiftShader timings are never real-GPU performance evidence.

## Quality bar

“I can start here and make this mine.” The three shapes read at a thumbnail and show inviting usable rooms up close.
Hearth, Tide and Grove share the kingdom's hand without becoming recolored copies. Large calm surfaces, substantial
roofs, cared-for reveals and two or three accents carry the toy-diorama look. The smallest hut deserves the same
care as the hall. The court is clearly open sky, the threshold meets its approach, and every opening is truthful.
The selector is restrained parchment/wood/brass using existing type, works at 390 px with keyboard and touch,
and leaves the home as the subject. No dark glass dashboard, raw counters passed off as stream UI, fake people,
placeholder geometry or silent claim of saved/published work. Use main's audio cue seam for actual selector/choose/
reject actions when available; do not invent an independent mixer. Missing required main seam is a `needs:`.

## References

- `work/references/prototypes.md`, Building: D's stroke undo/templates and B's corner-state finish explain the
  intended seam. This is an existing orientation note, with no recorded prototype revision or implementation-grade
  study. No inspected external Townscaper source or source license is asserted by this spec.
- `work/references/build-shaping.md`: actual private source/derived craft separation, atomic source insertion,
  editable bounds, glass-derived windows and the simulated/local publication boundary.
- `work/references/voxel-meshing-light.md`: authoritative occupancy, worker production geometry and matching palette/
  light boundaries. Source content must not hide defects behind a parallel rendering path.
- `work/specs/09-forge-pieces.md`: reusable construction vocabulary remains owned by Forge content; templates own
  free-voxel starting volumes and never create a competing piece catalogue or magical publication shortcut.

## Not now

The private editor, automatic neighborhood shape finishing, arbitrary `.vox` import, production door behavior,
Forge families/runtime, saving/auth/permissions, safety judgments/publish/Housewarming, earned items and economy
remain with main or their named lanes. This lane delivers all forty-five editable templates, metadata and reviewed
insertion evidence. A review bench is not an alternate citizen product surface or a way around private publishing.

## Decisions

- **2026-10-30 — Source format stays the same.** Existing ordered `VoxelBlueprint` boxes are adequate for editable
  templates. Main converts them atomically into its draft; there is no new template wire format or shared prefab
  catalogue. This avoids duplicating the Forge's component and connector contracts.
- **2026-10-30 — Every tier gets every plan.** Gable, corner and courtyard are available in all three kits at all
  five tiers. Tier changes dimensions/capacity without making a small citizen's starting choice a dead control.
- **2026-10-30 — Open frames stay truthful.** Templates have real clear doorways. Movable leaves require main's
  interaction/occupancy integration; painting a blocked door onto a solid shell does not satisfy “every door opens.”
- **2026-10-30 — Actual core, conditional handoff.** The draft API, tier budgets and build-shaping reference
  and route/collection hooks now exist. The actual core derives window anchors from
  source glass; it does not promise authored `ContentWindow.id` preservation. Main adds the real editor chooser
  when integrating the lane; this content lane never edits session/controller contracts.
