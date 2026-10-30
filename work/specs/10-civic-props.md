# Spec 10: a market and castle people care for

Status: **frozen 2026-10-30.**
Vision: `chatdom/ChatDom.md` principles 4, 9–12, 18 and §5; `chatdom/World-Tree.md` rules 1–2, 8–10 and
§§4–5; `chatdom/Artstyle-Soul-Feel.md` §§6.1–6.6, 13, 17; `chatdom/Quality.md` rules 2, 8–11.

## What and why

The market should look prepared for a community gathering, and the castle should carry the community's colours.
Build the civic furniture around those places: a real little crossing, an open ceremonial gateway, gift carts,
standards, heraldry, notices, seats and lamps. Broad, readable silhouettes matter before small detail. These are
authored voxel library assets with complete bounds and support, usable by main's existing kingdom composition;
this lane does not invent the people who use them. The existing castle modules, market well and striped stalls
are context, not work to repeat. Goods at home are gifts, never a domestic trading economy. No piece advertises
paid standing, a fabricated citizen or a false history.

## Current state

- `packages/shared/src/voxel.ts` defines the frozen strict `VoxelBlueprint`: ordered half-open integer boxes,
  build lattice at 0.125 m, registered material IDs, dimensions 1–256 cells and bounded padded allocation.
- `packages/content/src/materials.ts` owns `MAT`, `MATERIALS`, `STYLES` and `StyleKey`. Hearth and Tide are the
  requested resolutions. No new pigment, material property or style contract is needed.
- `packages/content/src/core/castle-modules.ts` and `core/index.ts` supply the actual castle; `core/market.ts`
  supplies the roofed well and two awning stalls. All are main-owned and read-only here.
- `packages/content/src/props/street/**` already owns fences, low walls, plants and rocks. Do not rebuild them.
- `apps/web/src/kingdom/castle-content.ts` consumes the cardinal castle plan. The common cardinal transform is
  `packages/world/src/settlement/geometry.ts:transformCardinalPoint`; positive Y quarter-turns rotate about the
  local origin before translation. Scene positions are metres; the asset and review data below use build cells.
- The production bench, validator, catalogue and aggregate exports are main-owned. At freeze, their loaders know
  only core/home/street collections. Main must register `civic-props`, its manifest and review fixtures before
  CP01's collection commands run. Missing registration is an explicit `needs:`, never permission for a private
  renderer or editing foreign files. The first consumer is the actual production content bench; kingdom placement
  and gameplay capabilities remain main integration work.

## Rules

1. **R1 — Twenty complete assets.** Deliver ten forms, each in Hearth then Tide, in this exact form order within
   each kit. IDs are `civic-<style>-<form>`. Size is the exact allocated XYZ cell box, not a claimed occupied bound;
   all final occupied bounds are measured and reported. The first two forms establish the largest silhouettes.

   | Form | Size XYZ cells | Recognizable job and geometry |
   |---|---|---|
   | `footbridge` | 64×24×32 | Timber crossing, shallow ramps, readable paired handrails and grounded abutments; long axis X |
   | `ceremonial-gateway` | 48×64×16 | Open stone/timber arch with inset heraldry and two substantial feet; passage along Z |
   | `gift-cart` | 32×32×24 | Low wheeled market cart with handles and shaped gift baskets; distinct from core's roofed stalls |
   | `banner-standard` | 16×64×16 | Tall grounded pole, broad hanging swallowtail cloth and restrained finial |
   | `crest-plinth` | 24×40×16 | Freestanding civic shield/crest on a coursed pedestal, supported as one structure |
   | `noticeboard` | 32×32×12 | Roofed two-post public board, raised border, separate parchment panels and wax-like seal accents |
   | `direction-sign` | 16×32×8 | Braced post with two directional arms whose silhouettes remain distinct at dusk |
   | `bench` | 32×16×16 | Broad timber seat, back and braces on credible feet; open access from +Z |
   | `lantern-post` | 12×40×12 | Grounded upright with braced hanging lantern, handle/cap and visibly enclosed warm-coloured pane |
   | `market-stores` | 24×16×16 | One composed stack of planked crates and faceted barrel/basket silhouettes, no spheres or loose cubes |

2. **R2 — Real support and useful openings.** Every occupied connected component has a face-neighbour structural
   path to y=0. No hidden slab, below-bound attachment or unsupported cloth, seal, handle or wheel. Use a real
   supported contact even when a picture would conceal the gap. Gateway clearance includes the whole central
   `[12,36) × [0,32) × [0,16)` air volume: a 3 m wide, 4 m high through-passage. Nothing decorative occupies it.
   Footbridge has a continuous supported walk strip at least 16 cells wide, two four-cell minimum landing runs,
   and treads rising no more than one cell per four cells of run; no 0.5 m step or pretend walk-through rail.
   The bridge must actually span an open underside between its abutments. Document the exact walk-strip and
   landing planes in the owned README. Bench seat height is 4 cells (0.5 m), with at least 24×6 cells of usable
   top surface and a clear 12-cell-deep front approach. Support and clearances are content properties, not a
   replacement for main's world collision/pathing checks.
3. **R3 — Palette and hierarchy.** Resolve structure through the requested kit's wall, roof, trim and stone.
   Additional registered keys allowed are `air`, `bark`, `brass`, `cloth`, `cream`, `darkStone`, `earth`, `leaf`,
   `moss`, `thatch`, `glass`, `petal` and `blueFlower`. Use only materials appropriate to the object: no floral
   confetti over every civic piece. Glass may describe a lantern enclosure but must not become a presence window.
   No colour literals, raw palette offsets, new material registrations or baked emission. Banner saturation is
   an accent, not a repaint of the place. Hearth/Tide share the form grammar but receive two intentional kit
   treatments; avoid unrelated geometry noise to manufacture variety.
4. **R4 — Heraldry means the kingdom.** Make an original simple abstract charge with clear positive/negative
   shape, authored in registered materials. Give banner and crest an intentional border and two or three broad
   shapes. No copied external insignia, slogan, political/identity flag, fabricated channel emote, crown/rank,
   purchase badge or tenure claim. This is the base civic kit, not an assertion that Genesis has read a channel.
   Main can later resolve approved channel motifs through its own contract; this lane adds no emote generator.
5. **R5 — Geometry is honest about capability.** All blueprints use `kind: 'civic'`, `lattice: 'build'`,
   `version: 1`, and `windows: []`. No fake citizen light, nameplate, mannequin, merchant NPC, money, price label,
   reward, owner record, Twitch action, invented history or animation. Noticeboard/sign are finished physical
   surfaces, not invented notices or illegible pseudo-writing. Main adds actual checked words/navigation before
   presenting them as functional public signs. Main binds seating, lamp light and its sound, and any gate/bridge
   traversal to real runtime behavior before placing them on a shipped path. In the unoccupied model bench,
   lantern glass is material only; no emissive-success claim. Gateway is always physically open and contains no
   fake closed door, lever or unimplemented opening act. Passive library geometry does not invent silent actions.
6. **R6 — Deterministic and within cost.** Pure TypeScript factories, no clock/network/global randomness, renderer
   imports or image generation. Per asset: at most 1,024 source boxes, 120,000 occupied cells, 120,000 actual
   meshed triangles and one measured model draw. Shared strict-schema/padded limits still apply. Count the final
   rasterized ordered-box result, including air carves; don't count source boxes as geometry evidence. Same
   form/style input produces identical blueprint and manifest resolution. Invalid runtime input fails explicitly.
7. **R7 — One useful assembly proof.** Export an owned civic-square fixture for each kit. Each contains all ten
   forms, a footbridge connected to its two landing markers and a gateway opening kept clear; position small
   furniture around the edge rather than filling the passage. The bench may add the existing core market stall,
   well and castle context through main-owned imports. Use cardinal rotations around local origin, then integer
   build-cell translation, including one rotated bridge/gateway example. Main's world plan remains authoritative;
   fixtures are evidence, not a placement/socket protocol or permission to alter land/addresses. A single focused
   occupancy assembly test proves support, approach/through-clearance and exact landing contact under all four
   turns. Do not spend the lane on repeated broad audits or screenshot-only join claims.
8. **R8 — Look at the finished material.** Every asset gets three 480×480 dusk views through the production
   worker/mesher/material, plus a contact sheet per kit. Inspect both civic-square fixtures at web and stream sizes.
   Sample the gateway, bridge and lantern at noon/night to catch dark hollows, blown highlights and false glow.
   Inspect silhouettes as thumbnails and structural joins close up. Up to three improvement rounds; replace weak
   designs without silently dropping required forms. Record final costs and rejected designs. No occupancy render
   substitutes for the clay shader and actual dusk light.

## Contracts

Use existing `VoxelBlueprint`, `VoxelBlueprintSchema`, `Vec3` and `VOXEL_METRES` from `@chatdom/shared` and
`MAT`, `MATERIALS`, `STYLES`, `StyleKey` from `../materials`. Do not add fields to blueprints or modify shared.
The lane-local `packages/content/src/civic/index.ts` exports:

```ts
export type CivicStyle = 'hearth' | 'tide';
export type CivicForm = /* the ten exact form strings in R1 */;
export const CIVIC_FORMS: readonly CivicForm[];
export function createCivicProp(form: CivicForm, style: CivicStyle): VoxelBlueprint;
export const BLUEPRINTS: readonly VoxelBlueprint[];
export const CIVIC_MANIFEST: readonly {
  form: CivicForm;
  size: readonly [number, number, number];
  maxBoxes: number;
  maxOccupiedCells: number;
  maxTriangles: number;
}[];
export const CIVIC_ANCHORS: Readonly<Record<string, {
  seat?: { centre: readonly [number, number, number]; facing: 'south' };
  lamp?: { centre: readonly [number, number, number] };
  notice?: {
    centre: readonly [number, number, number];
    width: number;
    height: number;
    facing: 'south';
  };
}>>;
export const CIVIC_REVIEW: readonly {
  id: 'civic-square-hearth' | 'civic-square-tide';
  instances: readonly {
    assetId: string;
    position: readonly [number, number, number];
    quarterTurns: 0 | 1 | 2 | 3;
  }[];
}[];
```

`CIVIC_MANIFEST` contains ten rows in R1 order with exact sizes and R6 maxima. `BLUEPRINTS` contains twenty
models in Hearth-then-Tide/form order. During intermediate tasks it is a nonempty ordered subset of finished
models only. Factory inputs for unfinished forms may throw until implemented; there are no placeholder assets.
Fixture instances refer only to installed lane blueprints; main supplies any core context separately. Positions
use cells, y=0 is the ground datum; translation must account for rotated footprints rather than silently recentering
models. A lane-owned README records occupied bounds, bridge landings/clear strip, bench seat and front approach,
board/sign content planes, and lantern pane centre in cells. `CIVIC_ANCHORS` exports only the eight known-use
records: bench seat, lantern pane centre, noticeboard content plane and direction-sign content plane in each kit.
Centres/width/height use integer local build cells; the seat centre sits on the usable top surface, the lamp centre
sits inside its visible pane, and each notice rectangle lies wholly on its actual outward +Z content plane. All
are in bounds. Tests inspect actual occupied/air geometry at these surfaces, not merely copied constants.
Main transforms them by the same cardinal local-origin transform as the model. These are descriptive integration
anchors, not shared interaction types, sign text, presence/emission values or lighting authority. Future runtime
consumers freeze their behavior separately; the first bench renders plain geometry without claiming it.

Main owns registration of `civic-props` in `src/catalogue.ts`, aggregate exports, collection validator rules
(schema, registry/palette, counts/order, row sizes/costs, determinism, empty windows and support), and extension of
the existing production capture command with `--scene civic-square-hearth|civic-square-tide`. The bench consumes
`CIVIC_REVIEW` using the existing review-instance transform convention; no substitute scene engine. Missing
registration or a changed contract gets `needs:` to main immediately. This freeze needs no shared contract change.

## Scope

Write only `packages/content/src/civic/**` plus this spec, `work/lanes/civic-props/PRD.md` and `progress.txt`.
Everything else is read-only, including core castle/market, street/home lanes, materials, aggregate exports,
shared/world/voxel/render/web, scripts, package manifests and lockfile. You are not alone: preserve others' edits
and accommodate new main integration without reverting it. No package infrastructure, server configuration,
live Twitch calls, new people, generated art or private render tooling. Sub-agents never run git. Root/main owns
commits, branches and merges for this delegated specification task; the eventual lane worker follows its own
`$ralph-lane` instructions.

## Acceptance

Main-owned civic collection/scene registration must exist; run from repository root:

```sh
pnpm content:validate --collection civic-props
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/civic
pnpm build
pnpm content:render --collection civic-props --style hearth
pnpm content:render --collection civic-props --style tide
pnpm content:render --collection civic-props --scene civic-square-hearth
pnpm content:render --collection civic-props --scene civic-square-tide
pnpm content:render --collection civic-props --asset civic-hearth-footbridge --hour 12
pnpm content:render --collection civic-props --asset civic-hearth-ceremonial-gateway --hour 0
pnpm content:render --collection civic-props --asset civic-tide-lantern-post --hour 0
```

Intermediate tasks validate with `--partial`; final acceptance omits it and proves twenty models. The focused
lane tests check manifest/factory/schema consistency, invalid input, all-asset grounded occupancy and the actual
rotated crossing/gateway fixture. Use the production rasterizer, not a second box interpreter. The assembly test
needs one clear route, real supports and exact contacts; tests that merely restate fixture constants do not count.

`shots/content/civic-props/style-hearth/` and `style-tide/` hold three-angle asset captures, SVG/PNG contact sheets
at 1440×900 and 390×844 viewport widths, and actual render stats. The two scene folders hold 1440×900, 390×844
and 1920×1080 views plus sheets/stats. Filtered noon/night shots use the established `asset-<id>/hour-<hour>/`
folders. Open sheets, scene shots and detailed join shots with `view_image`, following `$look`; record which
design improved and what still looks weak. Shots are ignored runtime evidence; progress records their paths.
Do not write outside the owned scope to preserve evidence. Main retains accepted captures and runs `pnpm verify`
at integration; that command's normal surfaces do not replace the explicit civic captures. SwiftShader timing
is not real-GPU performance evidence. No panel change is part of this lane.

## Quality bar

The bridge reads as a crossing, the gateway as a welcome, and a market cart as something made to bring gifts.
Cloth has broad folds, wood has structural rhythm, stone has courses and a little wear. No noisy camouflaged
stone, featureless cubic barrels, sphere goods, knife-thin frames or detached trim. Heraldry should read in dusk
silhouette without stealing the castle beacon's focal role. Benches and signs belong at the edges of a place
people can still cross. At phone size the props explain the place; up close their joins explain how they were
made. No model is accepted because a list or validator says its category exists.

## References

- `work/references/voxel-meshing-light.md`: retain coherent material regions, authoritative occupied geometry,
  broad details that survive distance, and separate source geometry from actual light. No borrowed engine code.
- `work/references/settlement-streets.md`: protected routes/landings and exact cardinal footprints take precedence
  over decoration; a nearby route is not access proof. This lane consumes the existing plan, not its urban solver.
- `work/references/prototypes.md`: original heraldry/dusk composition principles only; no copied asset/charge or
  whole prototype. Existing main castle/market gives the material and scale context.
- `.agents/skills/voxel-content/SKILL.md` and `look/SKILL.md`: silhouette, material rhythm, limited accents,
  three-angle real renders and inspected sheets. No fresh source-code adaptation or external asset is required.

## Not now

No castle or core-stall replacement, street-prop duplication, world/Atlas bridge semantics, raid gate runtime,
seating/animation system, light transport, notice publishing/moderation, free text, new marketplace/currency,
economic rewards, permissions, blueprint schema, shared sockets, owner history or new palette. These boundaries
describe a complete content lane, not a cut-down implementation of those other systems.

## Decisions

- **2026-10-30:** Ten civic forms in two existing kits, with the biggest silhouettes first. The gift cart extends
  the market around the current stalls/well; it does not rebuild them or imply trading among citizens.
- **2026-10-30:** No shared change is necessary. Manifest and fixtures are lane-local; main extends the existing
  bench as first consumer and owns any real kingdom placement and capabilities. No worker-owned renderer.
- **2026-10-30:** Main approved the ten-form batch and will register collection loading/validation before the lane
  starts. Export only known seat/lamp/notice anchor data now; their subsequent runtime behavior is not frozen here.
- **2026-10-30:** Static civic lamps/boards/seats are authored assets, not fake successful actions. Their runtime
  use must satisfy light, words, seating, traversal and sound requirements before main ships that use.
