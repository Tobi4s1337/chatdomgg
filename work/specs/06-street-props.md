# Spec 06: small things that make a street a place

Status: **frozen 2026-10-30.**
Vision: `chatdom/ChatDom.md` principles 11, 18 and §5; `chatdom/World-Tree.md` §5;
`chatdom/Artstyle-Soul-Feel.md` §§2, 6.1; `chatdom/Quality.md` rules 8–11.

## What and why

A few carefully made edges, plants and stones turn repeated lots into neighbors' gardens. Make ten passive
structural/decorative forms: fences and low walls that join cleanly, sturdy flower containers, a rounded rock
cluster and a leafy shrub. Render them in the existing Hearth and Tide kits so neither neighborhood receives an
unrelated palette. They make a cared-for street without promising an interaction that does not exist. No bench
that nobody can sit on, unreadable sign, unusable well, closed gate, fake bridge or decorative light.

## Current state

`packages/content/src/materials.ts` exports the stable material registry and three style kits. This batch resolves
its structural materials through `STYLES.hearth` (“Hearth & heather”) and `STYLES.tide` (“Salt & slate”).
`packages/shared/src/voxel.ts` already defines strict `VoxelBlueprint` boxes, build scale, bounds and budgets.
Main owns `packages/content/src/core/**`, current generator/render integration and aggregate exports. The
main-owned `packages/content/README.md`, `src/catalogue.ts`, validator and production render bench now exist.
`packages/testing/content-render.mjs` captures individual models and lane-authored join assemblies. A missing
collection or fixture fails explicitly; no baseline asset substitutes for a missing street prop. No placement,
interaction, sign text, socket or furniture contract is needed for this batch.

## Rules

1. **R1 — Ten forms, explicit count.** Deliver these ten authored forms with Hearth and Tide material resolutions:
   twenty validated blueprints, ten shapes. Style variants share a coherent form, not a second asset category.

   | Form ID | Maximum XYZ build cells | Job |
   |---|---|---|
   | `fence-straight` | 16×12×4 | Two-meter timber span with broad readable rails and a slight authored lean |
   | `fence-corner` | 16×12×16 | Right-angle continuation, matching rail heights and a real shared corner post |
   | `fence-end` | 4×12×4 | A finished terminal post, capped rather than sawn off arbitrarily |
   | `wall-straight` | 16×9×4 | Low coursed garden wall, softened cap and broad stone rhythm |
   | `wall-corner` | 16×9×16 | Wall turn with matching cap/face courses, no double-thick corner lump |
   | `wall-end` | 4×10×4 | A deliberate low end pier that terminates the same wall kit |
   | `flower-pot` | 8×12×8 | Chunky planted pot with visible rim, earth and one restrained flower accent |
   | `flower-trough` | 16×10×6 | Low planted trough with the same earthy craft, foliage kept off its joins |
   | `rock-cluster` | 12×7×10 | Three grounded rounded stone masses, one clear dominant silhouette |
   | `leafy-shrub` | 12×12×12 | An uneven joined canopy over a credible stem/root base |

2. **R2 — One scale and ground datum.** Every blueprint uses 0.125 m build cells, `version: 1`, `kind: prop`,
   `lattice: build`, and a size no larger than its row. The lower support meets y=0; no hidden below-ground boxes,
   floating mass, fake terrain slab or attachment beyond the box. Box coordinates are half-open integer XYZ.
   Plants and rocks are substantial voxel silhouettes, not a scatter of disconnected cubes. Shrub foliage remains
   passive decorative geometry, not a tree/avatar/companion or an implied harvestable resource.
3. **R3 — Joinable geometry, no new placement protocol.** Straight pieces join on their long-axis end planes;
   corners meet the same rail/cap heights and wall thickness, terminals close those runs cleanly. Author the
   join dimensions and assembly examples in an owned README. The bench demonstrates straight–corner–straight
   and straight–end assemblies with no crack, duplicate coplanar faces, hovering rail or blocked intended opening.
   Static transform examples are test/bench data, not shared snap sockets or a new placement authority.
4. **R4 — Existing palette only.** Use each requested `STYLES` kit's trim and stone for structure, with registered
   earth/bark/leaf/moss/petal accents where appropriate. Pot/trough bodies stay within that kit's stone palette;
   no new terracotta pigment is needed in Tide. Use `MAT.air` for cavities, not transparent invented IDs. No color
   literals, registry mutation, material-property change, arbitrary raw palette offsets or third style resolution.
5. **R5 — Shapes have restraint.** Broad rhythm before detail: two or three stone courses, a continuous rail,
   distinct pot lip and plant mass. Use authored asymmetry, not random voxel noise. Lean a post intentionally while
   preserving contact and join planes; soften rock silhouettes with stepped rounded masses rather than raw cubes.
   Keep flowers as accents and the street's negative space calm. No trophies, money/loyalty symbols, names or emotes.
6. **R6 — Passive means honest.** No seats, doors/gates, wells, bridges, levers, lamps, flames, windows, plaques,
   readable words, inventory, collision overrides or claimed interaction behavior. `windows` is always empty.
   Existing solid material occupancy is the collision source; these props are never marked non-solid to hide a
   bad approach. Main places them outside real walking routes. Do not add fake UI hot spots or use animation to
   imply a missing function. No new sound/action requirement is invented for static scenery.
7. **R7 — Deterministic and bounded.** Stable IDs `street-<style>-<form>`, pure TypeScript construction and
   `BLUEPRINTS` in listed-form order within Hearth then Tide. Stay within shared 20,000-box, padded-cell and
   dimension limits, plus the tighter per-prop budget main records in the content README. Same form/style input
   produces identical boxes. No renderer import, external asset download, network, global randomness or wall clock.
   Record occupied cells, boxes and actual meshed triangles/draw cost; never add voxel noise for apparent detail.
8. **R8 — Look through the real renderer.** Render all twenty blueprints from three angles at dusk, then review
   a ten-form contact sheet per kit plus the assembled garden edge in both home kits. Inspect ground contact,
   corners, caps, pot cavities, stone rhythm and foliage from up close and a stream thumbnail. Compare noon/night
   with no fake warm glow. Do up to three improvement rounds; replace weak forms while preserving ten required
   forms. Report rejected designs, final sheets, actual costs and any remaining doubt. Occupancy plots alone do
   not demonstrate the clay material/light result.

## Contracts

Consume `VoxelBlueprint`, `VoxelBlueprintSchema`, `VOXEL_METRES` and existing material/style types from
`@chatdom/shared`; consume `MAT`, `MATERIALS`, `STYLES` from `@chatdom/content/materials`. Material IDs are
registry keys, not array offsets. Ordered half-open boxes may carve with `MAT.air`; strict blueprint objects
have no added placement/interaction/text metadata. Each returned `styleId` matches its requested kit.

`packages/content/src/props/street/index.ts` exports `BLUEPRINTS: readonly VoxelBlueprint[]` with exactly twenty
entries, the ten forms above for Hearth then Tide, and
`createStreetProp(form: StreetPropForm, style: 'hearth' | 'tide'): VoxelBlueprint`. `StreetPropForm` is the lane-local
union of the ten listed form IDs; export it for the main-owned collection loader. Invalid runtime input fails
explicitly. No shared protocol change is needed. Main owns collection registration, aggregate exports and transforms
in the real kingdom; this lane provides complete static assets and owned assembly fixtures only.

Bench-only export (lane-local TypeScript data, no renderer dependency):

```ts
export const JOIN_FIXTURES: readonly {
  id: 'joins-hearth' | 'joins-tide';
  instances: readonly {
    assetId: string;
    position: readonly [number, number, number];
    quarterTurns: 0 | 1 | 2 | 3;
  }[];
}[];
```

Provide exactly one fixture per kit, containing all ten kit forms, including straight–corner–straight and
straight–end examples for both fence and wall. Positions are integer build cells in a shared assembly frame;
rotation uses positive Y quarter turns around the blueprint's local origin, then translation. y=0 is ground;
keep props at z≥0. Lane tests inspect transformed occupancy to prove no overlaps, joined end-plane contact,
compatible rails/courses and no visible cracks. These are review transforms, not gameplay sockets. The bench
adds a main-owned baseline core house of the matching kit behind z=0 as context; it does not require either
home lane, and does not claim to display those lane families.

## Scope

May write `packages/content/src/props/street/**`, this spec, `work/lanes/street-props/PRD.md` and its `progress.txt`.
Everything else is read-only: core assets, home lanes, materials/aggregate exports, shared/voxel/render, web routes,
root scripts/manifests/lockfile and the main-owned bench. You are not alone: preserve others' edits and report
integration needs. No image generation, new package/tool infrastructure, renderer changes, live service or git
by sub-agents. This batch does not install props into somebody's actual home or decide ownership.

## Acceptance

Run from the repo root; build before rendering so preview includes the new modules and fixtures:

```sh
pnpm content:validate --collection street-props
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/props/street
pnpm build
pnpm content:render --collection street-props --style hearth
pnpm content:render --collection street-props --style tide
pnpm content:render --collection street-props --hour 12
pnpm content:render --collection street-props --hour 0
pnpm content:render --collection street-props --scene joins-hearth
pnpm content:render --collection street-props --scene joins-tide
```

Intermediate tasks use `pnpm content:validate --collection street-props --partial`: a nonempty ordered subset
of final IDs is accepted, and every included model still receives full individual geometry/mesher checks.
`BLUEPRINTS` includes only finished forms, never placeholders; factories may reject unfinished forms until
implemented. Omit `--partial` at final acceptance: twenty blueprints in exact form/style order are required.
The validator checks schema, palette, exact IDs/count, row bounds, factory reproducibility, ground connectivity,
empty windows and actual meshed costs. Its `modelDrawBudget` is a budget; render stats measure actual calls.
It does not prove useful cavities, readable foliage or compatible joins. Lane tests must inspect actual
occupancy/rotated assemblies, nonempty pot/trough cavities, grounded structure and runtime argument failures.
Source and visual review judge broad craft and silhouette. Do not claim automated style or interaction proof.

Per-kit output under `shots/content/street-props/style-hearth/` and `style-tide/` contains three 480×480 dusk
views per model, SVG contact sheets, complete-height PNG contact sheets captured at 1440×900 and 390×844,
and `render-stats.json`. Noon/night collections use `hour-12/` and `hour-0/` without overwriting dusk. Assembly
outputs in `joins-hearth/` and `joins-tide/` include a front view at 1440×900, 390×844 and 1920×1080, plus
stats/sheets. For close join inspection, open the 1920×1080 originals; lane tests establish precise contact.
The bench uses the real production voxel worker/material, compiles shaders and finishes GPU work before readiness;
browser exceptions/console errors and stale builds fail capture. Open sheets and assembly images with `view_image`.
No fake presence is introduced in these unoccupied scenes; any future simulated people/presence must be labelled.

Main demonstrates individual/mixed/detail tooling against core, reviews the authored assembly fixture data and
captures when this collection arrives, and runs `pnpm verify` at final integration. `verify` does not automatically
capture lane collections, so it does not replace the explicit commands above. Missing tooling gets `needs:`;
never build a private substitute renderer or replace shader pixels with an occupancy plot.

## Quality bar

Each thing should feel placed by someone who cares for the street. Fences have weight, stones sit in the ground,
pots hold believable plants and a wall corner looks built rather than intersected. The mixed scene fits both home
kits without becoming busy. The shape is readable at phone/stream size, with enough texture in the broad courses
to reward a close look. No fake functions, surface flicker, boxy shrubs, loose voxel confetti or oversaturated
flower carpet. Props frame homes and real warm windows; they do not compete with people's light.

## References

- `work/references/voxel-meshing-light.md`: coherent material regions, authoritative occupancy and seamless joins;
  geometry and light are separate. Do not modify renderer/mesher behavior to conceal a content defect.
- `packages/content/src/core/index.ts`: ordered boxes and rounded foliage as technical examples, main-owned.
- `.agents/skills/voxel-content/SKILL.md`: silhouette first, material rhythm next, limited accents, actual
  three-angle dusk renders, improvement rounds and validation. Use the current registry as the palette authority.

## Not now

Furniture/seating, signs/text, wells, bridges, doors/gates, lights, water, terrain chunks, citizens, interactive
resources, snap/editor protocols, Forge sockets, sound, new materials, procedural neighborhoods or live placement.
These ten passive forms can ship as complete content without a new interaction contract.

## Decisions

- **2026-10-30 — Ten passive forms.** The bounded batch is ten modular forms in two existing palette resolutions,
  twenty blueprint records. No apparently usable item is included without its interaction contract.
- **2026-10-30 — Main owns tools and integration.** The worker owns only street assets/tests/assembly fixtures and
  its docs. The collection tools exist; main reviewed tooling evidence before freezing. Partial validation supports the
  first task; complete validation and authored join fixtures remain mandatory for final acceptance.

- **2026-10-30 — Ready for the team.** Main reviewed the real core mixed-street desktop/phone views, doorway and clean SIMULATED window fixture. Validator checks all 51 baseline assets; six review-fixture tests pass. Capture previews allocate free ports for parallel worktrees. The actual lane assets remain this lane’s acceptance, not a claimed result of the tooling check.
