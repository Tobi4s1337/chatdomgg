# Spec 09: house piece families for hands and the Forge

Status: **frozen 2026-10-30.** Main approved the sidecar and owns its shared implementation and collection hooks;
those must be present before the worker starts. The existing strict blueprint schema stays unchanged.
Vision: `chatdom/ChatDom.md` principles 4, 10–11, 16–18 and §10 examples 3–4;
`chatdom/World-Tree.md` rule 4, rule 12, §§4–5 and Decided; `chatdom/Moments.md` §§3, 10, 14;
`chatdom/Tech.md` §§9.1–9.3, 11.2; `chatdom/Safety.md` §§3–4 and Decided;
`chatdom/Artstyle-Soul-Feel.md` §§6.1, 6.4; `chatdom/Quality.md` rules 6, 8, 10–11, 17.

## What and why

A citizen can build a home block by block and choose a beautifully made door, roof or crooked chimney that belongs
to their kingdom. The Forge chooses from the same authored vocabulary: hands make the shapes and magic combines
them under rules. Deliver complete construction families in Hearth, Tide and Grove, with real joins, roof closures,
window anchors and door assets. These are reusable parts rather than whole-home stamps, recolored cubes or pictures
of architecture. A small assembled cottage proves each family can become a usable home; it does not replace the
citizen's freedom to build their own shape. Main owns placement, doors in motion, drafts, publishing and the spell
runtime. The lane delivers the content those systems can consume without guessing its dimensions or openings.

## Current state

- `packages/shared/src/voxel.ts:69` defines ordered half-open integer boxes on the 0.125 m build lattice;
  `:71` defines `ContentWindow`; `:75` defines strict `VoxelBlueprint`. Do not add piece metadata to blueprints.
  A component is `kind: 'prop'`; any combined review-home blueprint is `kind: 'home'`.
- `packages/shared/src/voxel.ts:64` defines home tiers and the 8×20×16 m lot reserve. Tier active depth grows
  backward from the south/+Z street. A piece is not permission to occupy locked land or another person's home.
- `packages/content/src/materials.ts:6` registers Hearth, Tide and Grove kits. Their material identities are
  fixed. The content README owns format, palette and tighter budgets. Existing home and street lanes are read-only.
- `packages/content/src/catalogue.ts:5` knows core, homes-hearth, homes-tide and street-props at handoff start;
  its glob at `:10` excludes `forge/**`. Main adds collection loading/generic validation and the glob hook for the
  lane-owned `/-/forge` review route, respecting attached components and door leaves. The lane builds that small
  adapter using production render modules; it does not replace the engine or edit existing tools.
- Main approved `ForgePieceDefinition` in `packages/shared/src/forge-pieces.ts`, implemented by main before the
  worker starts. This spec does not freeze a Forge plan, gameplay
  socket system, list of eighteen house slots, provenance schema or editor protocol by accident.

## Rules

1. **R1 — Three complete authored families.** Deliver the fifteen forms below in each family: forty-five
   definitions, in family-major then listed-form order. Each family has its own silhouettes, structural accents
   and material rhythm. Geometry must distinguish the kits even in greyscale; exchanging material IDs alone fails.

   | Family ID | Registered kit | Architectural hand |
   |---|---|---|
   | `hearthfold` | `STYLES.hearth` | Broad steep terracotta gables, generous plaster reveals, stout joined timber, limestone feet and a crooked capped chimney |
   | `tidewake` | `STYLES.tide` | Swept slate eaves, salt-pale walls, braced maritime timber, projecting window ledges and a narrow wind-shaped chimney |
   | `grovebough` | `STYLES.grove` | Soft thatch shoulders, bark knees and curved stepped braces, dark-stone roots, rounded windows and a squat organic chimney |

   | Form ID | Role | Required finish or compatibility |
   |---|---|---|
   | `floor` | Joined 16×16-cell structural floor tile | Real top surface and continuous supported edges |
   | `wall` | 16-cell straight wall bay, 24 cells tall, 4 cells thick | Broad wall field, readable base/head and compatible side joins |
   | `wall-corner` | L-shaped corner closing the same wall system | Matches the wall's thickness, floor datum and head, without intersecting duplicate walls |
   | `door` | Wall bay with an open frame and separately authored movable leaf | Supported clear passage at least 10×20 cells; hinge, threshold and swing clearance |
   | `window` | Wall bay with a real glass opening | Stable executable `ContentWindow`, inset frame and unblocked outward rectangle |
   | `shutter-pair` | Open shutters fitting the family's window | Mounts outside its reveal without blocking the light rectangle; static open shutters, no false close control |
   | `roof-slope` | Repeatable substantial roof segment | Real thickness, tile/thatch courses, eave and matching rise/run |
   | `roof-ridge` | Continuous crest joining the two slopes | Closes the seam, including a finished terminal at the roof end |
   | `roof-gable` | Supported end infill beneath the slopes | Closes the attic end without filling the room below |
   | `roof-verge` | Finished roof end/edge | Covers exposed slope ends without coplanar flicker or an arbitrary sawn edge |
   | `porch-deck` | Supported doorstep/deck | Matches door threshold; approach is flush or uses steps at most two cells high |
   | `porch-post` | Real canopy support | Foot and knee/head connect the deck and canopy; no hovering beam |
   | `porch-canopy` | Small roof joining wall and porch posts | Supported weather cover that leaves entry headroom and window clearance |
   | `chimney` | Roof-mounted authored stack and cap | Credible roof contact, readable hollow mouth and a restrained authored silhouette |
   | `trim` | Capped structural edge/beam | Finishes exposed wall/porch edges using the same joint dimensions |

   These are the complete construction forms for this lane. Do not quietly add lamps, fountains, usable furniture,
   gates, signs or free text: their interaction/safety contracts belong to their own consumers. No complete home is
   substituted for a missing component. The assembly uses these actual definitions, not a separately authored shell.
2. **R2 — Common measures, authored differences.** Use 16-cell horizontal bays, 24-cell wall height and a 4-cell
   structural wall. A floor is 2 cells thick; wall y=0 is its floor-top datum when mounted. Corners, roof slope
   lengths, porch offsets and overhang margins may differ by family, but every supplied connector names its exact
   profile and coordinate. Roof run/rise, corner footprints and all allowable variants are finite authored values
   recorded in the family module and owned README. Keep component bounds at most 64×64×64 cells; source boxes
   stay within their positive local blueprint bounds. No arbitrary scale, stretch, half-cell join, reflected leaf
   or unconstrained numeric generator input. Positive Y quarter turns around the local origin precede translation.
3. **R3 — Real joins and complete roofs.** Matching profiles meet at coincident transformed connector points with
   opposing normals and the profile's documented orientation. The profile documents the whole mating cross-section;
   an anchor point alone is not proof of a seam. Solid cells touch along intended faces without occupying the same
   cell or leaving a crack. End pieces close exposed ends; a finished roof has both slopes, ridge, gable and verge.
   Attached parts have structural support through their intended mating area, not hidden columns to local y=0.
   Test support in the composed home. Contact decoration must not be placed where it breaks the mating profile.
4. **R4 — Doors and windows are functional content.** The door's main blueprint contains an open frame. Its leaf
   is a separate blueprint with a recorded hinge and open quarter turn for main's moving-piece consumer. Reserve
   a clear 10×20-cell threshold-to-room passage and the leaf's full sweep, not just a camera target. Main animates,
   sounds and owns the collision/state change; the lane must not ship a closed static door as the completed door.
   Window glass and metadata agree with the existing outward-plane convention; its first two exterior cells are
   air across the whole rectangle. Roofs, shutters, plants and trim cannot obstruct that rectangle in the fixture.
   Windows remain unlit until real or explicitly labelled SIMULATED presence reaches main's light layer.
5. **R5 — Openings do not grant authority.** Ordered `MAT.air` boxes carve the component's own source geometry;
   the door passage and actual window opening must agree with the visible result. There is no extra `carveBoxes`
   field in this contract. Main's build-mode consumer owns world-space opening overlays, stored structure healing
   and rejection of invalid placements. Clearance boxes record required air, not an instruction to delete a
   neighbor, move a window, erase another piece or enter locked land. Main checks transformed overhangs, leaf
   sweep, every solid and active-depth boundaries against the owning lot and retained home entrance/window IDs.
6. **R6 — Grammar ready, never a hidden spell runtime.** Definitions expose stable family/form IDs, exact bounds,
   style ID, connector profiles, clearance and door/window metadata. The caller selects a finite definition;
   there is no eval, generated source, arbitrary voxel payload, raw material override or free-form motif importer.
   Family finish is authored geometry from these registered kits. Any additional optional finish has an explicit
   finite ID and cannot alter structural joins, light anchors or clearances. Do not claim this is the runtime
   `HousePartPlan` or grant a publish/safety pass. Published forged pieces require main's judges and provenance.
7. **R7 — Expression never buys standing.** No tenure/subscription/gifter mark, rank crown, scarce edition, larger
   light, paid forging allowance or loyalty price appears in these assets or metadata. Availability/economy are
   not content authority. The Forge burns only live and takes earned coals (flat cap three); this lane does not
   implement those rules or expose a bypass. No names, plaques, trademark silhouettes, political symbols or text.
   Ordinary family motifs remain generic authored architecture. Creatures, wearables and fake people are excluded.
8. **R8 — Bounded deterministic production assets.** Use only the requested kit's wall/roof/trim/stone, air/glass
   and restrained existing natural accents permitted by the content README. No registry edits, new colors,
   emission, texture downloads, renderer dependencies, network, wall clock or global randomness. Stable IDs are
   `forge-<family>-<form>` and `forge-<family>-door-leaf`. Each blueprint uses at most 512 boxes, 100,000 occupied
   cells and 40,000 actual meshed triangles; independent component render budget is one draw. Each composed home
   stays within the existing lane-home limits (2,000 boxes, 1,000,000 cells, 250,000 triangles), the reserved lot,
   shared padded-cell bounds and window cap. Record actual mesh/draw costs; do not create noisy voxel detail.
9. **R9 — A lovely working family appears early.** The first task delivers Hearth's floor, wall, corner, door,
   window and all four roof forms, assembled into a small complete shell. No catalog-first task with invisible
   empty definitions. Later tasks finish Hearth details, author Tide and Grove, and demonstrate final joins and
   clearance through the same fixture. Finished entries only enter exported arrays; unsupported inputs throw
   explicitly until implemented. Intermediate commands use the tool's partial mode; final commands require all
   forty-five definitions plus three leaves. Never replace a weak required form by deleting it from the collection.

## Contracts

Consume `VoxelBlueprint`, `VoxelBlueprintSchema`, `ContentWindow`, `Cell3Schema`, `VOXEL_METRES`,
`RESERVED_LOT_METRES` and home active-depth facts from `@chatdom/shared`; consume `MAT`, `MATERIALS`, `STYLES`
from the main-owned materials module. Blueprint windows remain the single source of glass-plane anchors.

Main-owned `packages/shared/src/forge-pieces.ts` exports `ForgePieceDefinition` and its schema. The separate
sidecar has `version: 1`, `id`, `familyId`, `kind`, `blueprint`, `connectors`, `clearanceBoxes` and optional
`door: { leaf, hinge, openQuarterTurns, passage, threshold }`. Each connector has `id`, `profile`, `point` and
`normal`: a stable local token, profile token, integer local point and one of six outward axis directions.
A profile specifies mating section/dimensions and orientation; identical IDs require identical sections.
Normals and integer quarter-turn transforms follow main's shared contract, never a lane-local rotation convention.
Connector points may sit on boundary planes. Clearance and passage boxes are half-open geometry bounds without
a material field; swing clearance may extend beyond static blueprint bounds, including negative local cells.
Source blueprint boxes remain positive/in bounds. Main's placement consumer checks transformed clearance against
the real lot and surrounding pieces. Door `leaf` is a separate
`VoxelBlueprint`, with closed-pose geometry expressed in the frame's coordinate system; `hinge` is its integer
pivot, `openQuarterTurns` is `1 | -1`, and `threshold` is an integer point on the walk surface. There is no separate
carve array or tangential-axis field. Main supplies the schemas and one small sidecar fixture test before lane start; the lane proves actual joins in its first assembled family. The lane
may not create its own shared replacement or broaden strict blueprints. Content modules never import rendering.

Lane entry `packages/content/src/forge/index.ts` exports:

- `FORGE_FAMILIES` in `hearthfold`, `tidewake`, `grovebough` order and `FORGE_FORMS` in the table's order.
- `FORGE_PIECES`: the forty-five definitions in family-major/form order, using `ForgePieceDefinition`. Map form
  IDs to broad kinds: floor → floor; wall/corner → wall; door → door; window/shutters → window; all roof forms →
  roof; porch deck/post/canopy → porch; chimney → chimney; trim → trim. A shutter does not acquire glass/light
  anchors merely because its broad kind is window: only the actual glazed window blueprint has them.
- `createForgePiece(family, form)`: a deterministic factory returning the same definition as the catalog entry;
  invalid runtime inputs fail explicitly. Finite optional finishes, if any, use a named finite union and are
  listed in the owned README, with no arbitrary strings or numbers leaking into the grammar.
- `BLUEPRINTS`: each definition's main blueprint in the same order, then the three door leaves in family order;
  exactly forty-eight finished blueprints at final acceptance. This exposes leaves to the real validator/renderer.
- `FORGE_REVIEW`: one bench-only assembly fixture per family, containing component IDs, integer translations and
  quarter turns, stable instance IDs and the entrance focus. Compose windows with `<instanceId>-<windowId>` IDs;
  never silently deduplicate them. The fixture records door leaf closed/open poses for review; it does not claim
  to be a durable home or interaction protocol. This is lane-local data consumed by the lane-owned review adapter:

  ```ts
  readonly {
    familyId: 'hearthfold' | 'tidewake' | 'grovebough';
    instances: readonly {
      id: string;
      pieceId: string;
      position: readonly [number, number, number];
      quarterTurns: 0 | 1 | 2 | 3;
    }[];
    entrance: readonly [number, number, number];
  }[]
  ```

`apps/web/src/forge-bench/index.tsx` default-exports the Solid review component. Main's glob mounts it at
`/-/forge`. The adapter reads `family=hearthfold|tidewake|grovebough`, `view=assembly|door|window`,
`door=closed|open`, `presence=off|on` and `hour=0..23`; defaults are Hearthfold, assembly, open, off, 19.
Window presence on/off is shown only in window review and visibly labelled SIMULATED. All other views are
unoccupied geometry, with no owner names. Unknown input fails visibly; there is no default-family fallback.
Use `VoxelWorkerPool`, `geometryFromChunks`, `createVoxelMaterial`, `getEnvironment` and `createWindowLights`
from existing production packages. This adapter may compose fixtures, rotate an authored leaf and aim cameras;
it may not invent another mesher/material/light engine or imply real door authority. Readiness is published via
`window.__chatdomReady` only after workers, shader compilation and GPU completion, with fixture/state/stats
metadata to detect stale builds. Fail browser errors. Clean up workers, listeners and GPU resources on unmount.

Each cottage uses a real floor/interior, at least four wall joins, a right-angle corner, a door, two window bays,
shutters, both roof slopes, ridge, gable/verge, porch and chimney. The first shell fixture uses its finished subset;
final fixtures use all fifteen forms. Fit within a hut's active 8 m depth inside the 64×160×128-cell reserve, with
the street at +Z and an unblocked entry. Do not import or modify another home lane. These are unoccupied review
assemblies; no fake owner or permanently burning window is used to make them look alive.

## Scope

May write `packages/content/src/forge/**`, `apps/web/src/forge-bench/**`, this spec,
`work/lanes/forge-pieces/PRD.md` and its `progress.txt`.
All other files are read-only: especially `packages/shared`, material registry, core/home/street content,
catalogue/aggregate exports, existing validator/capture tools, voxel/render engine, other web/editor routes, Forge service,
root manifests and lockfile. You are not alone; accommodate others' work and never revert it. Main owns the
small shared contract, collection/tool wiring, review-route glob hook, runtime doors, building mode and integration.
Report missing seams with `needs:` and continue independent authored work. No git by sub-agents; the lane worker
commits its own coherent tasks only on `lane/forge-pieces`, never main, never pushes.

## Acceptance

Main installs the sidecar, wires `forge-pieces` into the existing collection loader/generic validator and mounts
the review-route glob before the lane starts. The worker builds its scoped adapter/capture entry, so the last
command below arrives in FP01. Handle supported attached components and separate leaves without fake ground
stands. Use the production voxel worker, material, presence layer and readiness/error checks. Do not accept an
occupancy drawing as render evidence.

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/forge apps/web/src/forge-bench
pnpm build
pnpm content:validate --collection forge-pieces
pnpm content:render --collection forge-pieces --style hearth
pnpm content:render --collection forge-pieces --style tide
pnpm content:render --collection forge-pieces --style grove
node apps/web/src/forge-bench/capture.mjs
```

The first task validates its finished subset with `--partial` and captures only finished assets; final validation
omits it and checks all forty-eight blueprint IDs, forty-five sidecars and three fixtures. Schema/registry/bounds/budgets and factory
determinism are checked for every asset. Main's validator verifies window glass and exterior rectangles. It must
not require a roof or leaf to be independently grounded when its support is an authored attachment.

Keep geometry tests focused: one parameterized assembly test over the three final fixtures rasterizes the real
definitions, applies the published quarter-turn transforms, and checks the meaningful joins,
ground-connected assembled support, finished roof shell, supported 10×20 entry passage, window clearance and
in-bounds hut active reserve. The same test checks leaf closed/open occupancy and reserved swing clearance.
World-space structure healing is main's build-mode behavior, not a test implemented by this content lane.
Include a mismatched connector rejection and invalid factory input check. Test actual cells around joins rather
than restating metadata or snapshotting
every enum/box. No exhaustive permutations, combination-proof harness or runtime safety-test implementation.

Render every component from front/side/back at dusk, with a contact sheet per family at 1440×900 and 390×844.
The component sheets include the door leaves. Capture each assembled cottage at 1440×900, 390×844 and 1920×1080
in `/-/forge`; inspect the front threshold, roof end and porch at full size, plus one door closed/open
detail pair per family. Review the assembled cottages at noon and night as well; a sheet may tile those views.
Use the review adapter's window view for one window per family off/on, always visibly labelled SIMULATED.
The lane-owned `capture.mjs` uses Playwright Chrome/SwiftShader, the existing capture lock and preview helpers,
waits on meaningful readiness and fails console/page errors or mismatched state. It accepts `--family <id>`
for a task's targeted evidence and `--base-url <url>` for an existing build. With no filter it captures all three
assemblies at dusk and standard sizes, noon/night comparisons, door pairs and window off/on pairs. Document its
exact output paths in the owned README. Reuse shared preview ownership/cleanup; never stop another process.
Missing production package seams are `needs:`; no private engine or edits to someone else's bench are allowed.

Expected evidence roots: `shots/content/forge-pieces/` for three-angle component views, family contact sheets,
`render-stats.json`, and `shots/forge-pieces/<family>/` for assemblies/details. Hours and door/light states use
distinct output paths so review does not overwrite dusk. Open sheets and assembly/detail views with `view_image`; judge roof
seams, material rhythm, readable opening, light-plane clearance and differing silhouettes. Do up to three polish
rounds, reporting discarded designs and fixes. This is an asset handoff, so screenshots show unoccupied content;
they do not establish live door authority, people, public publishing or production safety.

Every task runs relevant checks once, expanding only for changed geometry or an unresolved defect. Final main
integration runs `pnpm verify` and separately reviews collection evidence; `verify` does not capture the lane
collection. SwiftShader provides pixels and actual submitted mesh/draw counts, never real-GPU frame timing.

## Quality bar

The tiny first cottage is already a home somebody would choose. A wall reads as joined timber/plaster or coursed
stone, the roof has weight and a finished edge, and a porch shelters an actual doorway. No floating cap, wall across
the threshold, slit pretending to be a room, glowing painted window, duplicate face or noisy roof confetti.
Hearth is stout and cosy, Tide feels wind-shaped, Grove grows in soft shoulders and root-like knees. The same
construction vocabulary remains legible when the citizen makes a different house. People own the large shapes;
the kingdom's hand is visible in the small ones. Components support that freedom without buying a better address,
brighter presence, higher rank or larger earned lot.

## References

- `work/references/prototypes.md`, Lanternmere Forge: plan → authored parts → bounded assembly → views is the
  useful seam. Reimplement here; discard creature bases, rarity, fallback props and heuristic safety approval.
- `work/references/voxel-meshing-light.md`: authoritative occupancy and placed-piece carves, compatible joins,
  coherent material regions, separate light anchors. Do not conceal a content defect with a renderer change.
- `packages/content/README.md`: existing production render/validator conventions, three-angle contact sheets,
  glass-plane semantics, palette and cost budgets; main adds the agreed collection hooks before lane start.
- `.agents/skills/voxel-content/SKILL.md` and `.agents/skills/look/SKILL.md`: silhouette and restraint first,
  deterministic code/data, real dusk pixels, standard sizes and visual judgment. No generated bitmap models.

## Not now

Forge AI/tool execution, prompt parsing, moderation or publish decisions, coal/anvil economy, provenance minting,
eighteen-slot assignment, live placement/collision authority, building editor, production door state/animation/sound runtime,
home interiors, lamps/fountains/furniture/signs, worn pieces, creatures, external emote import, new materials,
whole-home lane changes or deployment. These remain main's systems or separate content branches; this lane
delivers all fifteen construction forms in all three named families and complete reviewed assembly fixtures.

## Decisions

- **2026-10-30 — Main retains runtime; lane authors shapes.** This handoff supplies reusable architectural
  geometry and minimal stable sidecar metadata. It cannot grant placement, safety approval or public success.
- **2026-10-30 — Three different hands.** Hearthfold, Tidewake and Grovebough use the three existing style kits
  with distinct architectural geometry, not three palette resolutions of identical boxes.
- **2026-10-30 — One meaningful joins check and a looked-at sheet.** The three real assemblies exercise the
  interface. Tests prove cells/clearances and screenshots demonstrate craft; neither claims exhaustive safety.
- **2026-10-30 — Minimal sidecar approved by main.** `packages/shared/src/forge-pieces.ts` owns
  `ForgePieceDefinition` and the schema. Connectors are id/profile/point/normal, with no extra tangent field;
  ordered air boxes already describe component carves, so no separate carve array is added. Main installs this
  contract and its one-join fixture plus collection hooks before starting the lane.
- **2026-10-30 — Scoped review route.** Main approved `apps/web/src/forge-bench/**` for assembled and door
  review at `/-/forge`, mounted by main's glob hook. The lane reuses real render/voxel packages and existing
  capture helpers. This review adapter does not implement world building mode, door authority or the spell runtime.
