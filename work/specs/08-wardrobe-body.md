# Spec 08: people you can recognise

Status: **frozen 2026-10-30.**
Vision: `chatdom/ChatDom.md` principles 2–5, 9, 11, 17–18; `chatdom/World-Tree.md` §3 and rule 9;
`chatdom/Artstyle-Soul-Feel.md` §§7–8 and Decided; `chatdom/Moments.md` §14;
`chatdom/Quality.md` rules 9–13; `chatdom/Tech.md` §8.3.

## What and why

Make a family of warm, unmistakably human citizens whose bodies, hair and clothes belong to the same handmade
toy kingdom. A newcomer should already look considered; a familiar citizen should be recognisable from hair,
silhouette and cloak at street distance. Pieces combine across body shapes on one chibi skeleton. A mantle or
hood can carry a true history, without making its wearer taller, brighter or more important than a neighbour.
This lane authors the body and wardrobe library and a truthful review surface. Main owns the walking avatar
engine, animation behaviour and the later wardrobe product flow; the content must fit that first consumer.

## Current state

- `packages/shared/src/voxel.ts` defines `VOXEL_METRES.avatar = 0.0625` and `VoxelAsset` with an avatar lattice.
  `VoxelBlueprintSchema` is explicitly build-only and cannot contain avatar parts, rigs, sockets or clothes.
- `packages/content/src/materials.ts` owns stable material IDs, Hearth/Tide/Grove kits and `AVATAR_PALETTE`:
  ten skin, six hair and six fabric swatches, plus six lapsed fabric swatches and the rainbow alias. Shading
  supplies tonal variation; these are base colours, not multi-material ramps. The lane cannot change them.
- `packages/content/README.md`, `scripts/content-validate.mjs` and `packages/testing/content-render.mjs`
  describe and run the existing build-lattice collection path. Their success does not certify an avatar.
- `apps/web/src/content-bench/**` demonstrates the real voxel worker, greedy mesh, clay material and environment.
  Avatar review must use that rendering path at avatar scale, rather than drawing boxes in a second renderer.
- `packages/shared/src/avatar.ts` now exports the separate `AvatarPartBlueprintSchema`, part type,
  `AVATAR_RIG`, `AVATAR_SOCKETS`, `AVATAR_PART_LIMITS` and `AVATAR_LOOK_LIMITS` described below. Main's
  optional `/-/avatars` route hook expects a default component from `apps/web/src/avatar-bench/index.tsx`.
  The walking consumer is `apps/web/src/citizens/index.ts`; the lane bench consumes the same rig and the main-owned cape renderer.
- `work/references/crowd-animation.md` already records attachment/pose sharing and silhouette/LOD concerns.
  No external character asset or animation data is imported by this lane.

## Rules

1. **R1 — People, on one rig.** Citizens remain human, with optional fey ears/skin accents. No animal bodies,
   borrowed whole-body skins, mannequin crowd filler, NPC citizens or inferred skin/gender from Twitch data.
   Every family uses the same frozen skeleton, joint pivots, sockets and ground datum. Variation changes volume
   and contour, never bone lengths or an individual's height scale. Head height is about one third of the
   unadorned standing height. A person has one underlying body/look across kingdoms; this content lane does not
   allocate identities or decide which local honours are available elsewhere.
2. **R2 — Four body silhouettes.** Deliver `balanced`, `slender`, `broad` and `round` families, named for shape,
   never gender or worth. Their shoulder, torso, hip and limb contours must read differently in an unlit
   silhouette contact sheet while retaining the same attachment frame. Do not shrink heads, lengthen legs or
   introduce skeleton variants to make them distinct. A comfortable neutral garb is part of every default.
3. **R3 — Skin and hair are deliberate.** Resolve eight human skin swatches spanning light to dark and two
   clearly fantastical fey swatches through main's registered material keys. Resolve six natural hair swatches through
   the same registry. These are palette choices, not separately duplicated geometry catalogues. Author eight
   scalp/hair treatments: bare scalp, close crop, rounded curls, coiled high crown, side part, bob, long braid
   and paired twists. Show textured hair as substantial readable masses; no noisy single-voxel confetti or
   texture pasted onto a generic cap. Long hair uses only main's frozen head attachment frame. Skin and hair
   are freely selectable content, never rewards or subscription benefits.
4. **R4 — Twelve common wardrobe forms.** Deliver the forms below. Bodies and ordinary garments use rigid parts bound to the
   frozen joints/sockets; capes and cloaks use the separate thin-cloth boundary below. Whole outfits remain recipes for combinations, never replacement skins. Torso or
   leg clothing may contain multiple parts to follow the body; the source does not make the chest drive feet.

   | Area | Required forms |
   |---|---|
   | Head | soft cap, folded hood, broad-brim hat |
   | Torso | work tunic, open waistcoat, long coat |
   | Lower body | trousers, walking skirt |
   | Feet | soft boots, sturdy boots |
   | Back | short cloak, travelling cloak |

   Each form resolves in Hearth and Tide accent choices from the existing kits and the frozen fabric swatches.
   Resolve material roles at construction; do not clone the geometry merely to multiply a count. Preserve a
   strong major shape and two or three accents. The broad-brim hat has a crafted edge, the cloak a readable hem
   and clasp, and boots a real sole. No arbitrary noise or detail too small to survive the normal camera.
5. **R5 — Seven pieces with a true story.** Author the Twelve-Moon Hood, Long-Watch Mantle, Duskwyrm Scale Cape,
   Season Laurel, and three subscription cape tiers. The hood's 12 subscribed months come from the vision;
   the mantle is tenure-earned, the scale cape a witnessed dragon reward and the laurel a season honour.
   Do not invent tenure thresholds, reward grants, stock limits, purchases, prices, scores, paid standing or a
   gifter badge. Their catalogue descriptions state the source in plain language, not a fabricated person's
   achievement. A season laurel is visually distinct from the monarch's reserved crown. The tier-three cape
   uses the frozen rainbow swatches for main's elegant colour shimmer, with no added emission, brightness or light.
   Author active and lapsed subscription material choices; lapsed pieces become quieter and remain present.
   Ownership and eligibility are authoritative inputs supplied elsewhere; a bench selector grants nothing.
6. **R6 — Every piece fits every body.** State the small legal combination rules in the owned catalogue, then review every
   garment on all four bodies and hair/headwear pairs on the largest hair silhouette. Accommodate variants by
   body-family fit geometry within the common rig, not by changing sockets, rescaling a person or hiding an
   occupied garment. Headwear can use an explicit lane-local authored scalp/hair fit variant; the catalogue
   must state legal combinations and fit selection. Never silently discard another selected piece. Coats and
   skirts must follow seated/stepping legs; capes and long hair must clear the body in the reviewed static poses.
   Their motion and spring/body-capsule response belong to main's next avatar-engine brief. No joint gaps,
   exposed accidental skin, z-fighting, foot penetration or cape passing through the torso in the review poses.
7. **R7 — Content stays bounded and deterministic.** Rigid geometry is authored in TypeScript/data with ordered
   integer voxel boxes at 0.0625 m; capes use bounded metre-based cloth descriptors; no image generation, network, clock, unseeded randomness or renderer import
   in the content factory. Stable semantic IDs and materials come from main's frozen contract/registry.
   Do not reuse the build-only `BLUEPRINTS` collection or smuggle additional fields into it. Validate each
   generated part's bounds, palette, attachment and source/padded-cell limits. Publish actual occupied cells,
   triangles, draws and part count for the assembled representative looks. Enforce `AVATAR_PART_LIMITS` and
   `AVATAR_LOOK_LIMITS` exactly; passing a schema alone does not establish occupancy or meshed-triangle budgets.
8. **R8 — Honest review people.** Bench fixtures are labelled **SIMULATED** on every page, still and contact
   sheet. Use plain labels such as “Simulated citizen A”; do not fabricate Twitch handles, follower histories,
   public identities or a live audience. The library contains appearance parts, never invented people. A bench
   may select a piece to inspect it; it has no “claimed”, “equipped for your account” or reward-success state.
9. **R9 — Render the assembly and the fit.** Review all shapes from front/side/back at dusk, and representative
   pale/dark skin and material choices at noon/night. Contact sheets contain captured pixels from the actual
   voxel material and environment. Include body silhouettes, hair, common clothes, story pieces and assembled
   looks at close and street/stream distance. Review walk contact, full stride, sitting, bow, raised-arm tool
   use and head turn using review-only poses on the frozen rig. The bench builds `THREE.Group` joint transforms
   from `AVATAR_RIG`, renders real voxel geometry, and cannot implement a parallel walking engine. A rest pose
   sheet alone does not demonstrate fit. Static geometry must never be described as proof of moving cloth or
   animated shimmer; actual springs/shimmer remain main's subsequent avatar-engine acceptance.

## Contracts

### Main-owned cape boundary

`AvatarCapeBlueprintSchema` from `@chatdom/shared` describes a zero-thickness cloth sheet at the frozen `back`
socket. It is not a `VoxelAsset` and must never go through the voxel mesher. Author `shape` (straight/flared/tapered),
`width`, `length`, `hem` (straight/rounded/notched), `trimWidth`, shoulder `mount.height/back`, and registry material
IDs in `colours.cloth/lining/trim`. Dimensions and mount offsets are metres. The strict schema is authoritative for
bounds; no arbitrary vertex payload, physics constants, shader strings, reward or identity fields belong in content.

Optional `shimmer` carries exactly six registered material swatches and a strength. Tier one/two resolve their
gold/rose trims through palette IDs; tier three supplies the registered rainbow swatches. Lapsed variants use the
muted palette and subdued shimmer. The descriptor conveys appearance only, never ownership or eligibility.

Export `createCape(id, fit): AvatarCapeBlueprint` beside the existing factories. Every cape/cloak/back mantle uses
that factory; `createWearableParts` for it returns only rigid fasteners if present, never a thick drape. The review
bench imports main’s `createCitizenCapeRenderer` and feeds the posed `back` matrix, real speed, distance, heading
and clock. Main owns locomotion response, wind, lift, settling, culling, lighting and colour shimmer. Do not fork it.
The runtime `CitizenLook.cape` accepts this descriptor alongside the ordinary `parts` collection. Review body fit,
hem silhouette and colours on the real moving sheet; an attractive static voxel cloak is no longer acceptance.

### Main-owned avatar boundary

Consume `packages/shared/src/avatar.ts` through `@chatdom/shared`; the lane never writes shared. The strict
`AvatarPartBlueprintSchema` defines the source separately from `VoxelBlueprint`; its exact fields are:

| Field | Frozen schema meaning |
|---|---|
| `version`, `id`, `lattice` | Literal 1, schema token, literal `avatar` |
| `size` | `Cell3Schema`: integer XYZ dimensions |
| `boxes` | Array of existing `VoxelBoxSchema` ordered half-open integer boxes |
| `pivot` | `Cell3Schema`: geometry-local integer pivot, permitted outside the part's bounds |
| `attachment` | `AvatarAttachmentId`: one canonical bone or socket |
| `layer` | `body`, `hair`, `garment` or `accessory` |

Consume `AvatarPartBlueprint`, `AvatarPartBlueprintSchema`, `AvatarAttachmentId` and `AVATAR_RIG` from the main-owned
module. Every part binds rigidly to one permitted attachment. Clothing with several moving sections is a
lane-local recipe containing multiple parts. Rasterise ordered boxes into `VoxelAsset` at the avatar lattice;
material zero carves earlier boxes. The mesh's local coordinates become `(cell - pivot) * 0.0625` metres,
then its attachment transform places it in the canonical rig. Never subtract a root-local pivot again, use
build-scale mesh conversion, or add unrecognised source fields for layers, fit variants, motion or inventory.

`AVATAR_RIG` has a ground root, +Y up, +Z forward and 24-cell / 1.5 m unadorned height. Its entries have
`{ id, parent, offset }`, with offsets in parent-local avatar cells. The 16 exact bone IDs are `root`, `pelvis`,
`chest`, `head`, `upperArmLeft`, `forearmLeft`, `handLeft`, `upperArmRight`, `forearmRight`, `handRight`,
`thighLeft`, `shinLeft`, `footLeft`, `thighRight`, `shinRight`, `footRight`. The following are assembled rest
positions, not local offsets to duplicate in factories:

| Joint | Root-local rest position in avatar cells |
|---|---|
| pelvis / chest / head | `[0,8,0]` / `[0,12,0]` / `[0,16,0]` |
| shoulders | x=±5, y=15 |
| elbows / wrists | same side arm x, y=11 / 8 |
| hips / knees / ankles | x=±2, y=8 / 4 / 1 |

The head extends from its y=16 pivot to y=24: eight cells, one third of total height. `AVATAR_SOCKETS` entries
have `{ parent, offset }`: `hat` is head + `[0,8,0]`; `face` is head + `[0,4,4]`; `back` is chest + `[0,2,-2]`;
`gripLeft`/`gripRight` are their hand + `[0,0,1]`. Left is negative X, right positive X. Consume these constants
and `AvatarAttachmentId`, never a second enum or duplicated transform table.
The source carries rigid cape/hair parts on the existing head/back attachments. It does not invent spring
bones, a pose protocol or an ownership/inventory system; main's avatar-engine brief owns runtime deformation.

Consume `AVATAR_PALETTE` from `@chatdom/content/materials`: `skin` has ten registered IDs (eight human,
`skinFeyAsh`, `skinFeyMoss`), `hair` six, `fabric` six, `fabricLapsed` six matching muted IDs, and `rainbow` the
ordered six-fabric alias. A swatch is one material key; use the existing voxel shader's shading, never invented
three-tone materials. Active/lapsed mapping preserves each fabric index. Kit accents use `STYLES.hearth` or
`STYLES.tide` registered keys. No raw new colour literals or registry mutation belong in this lane.

`AVATAR_PART_LIMITS` is `maxDimension: 64`, `maxBoxes: 512`, `maxOccupiedCells: 32768`.
`AVATAR_LOOK_LIMITS` is `maxParts: 32`, `maxOccupiedCells: 65536`, `maxTriangles: 24000`.
Dimensions/source-box bounds are schema checks; count occupancy after ordered carving and triangles after the
actual mesher. Validate full assembled looks against the latter limits and report measured draws separately.

Main hooks `/-/avatars` to the **default component export** of `apps/web/src/avatar-bench/index.tsx`.
Existing `VoxelWorkerPool` jobs with `kind: 'asset'`, `geometryFromChunks(..., 'avatar')` and
`createVoxelMaterial(..., 'avatar')` supply the actual mesh/material path; no walking engine is required to
begin content/posed-fit review.

### Lane-owned content entry point

`packages/content/src/avatars/index.ts` exports the ordered catalogues `BODY_FAMILIES`, `HAIR_FORMS`,
`COMMON_WEARABLES`, `STORY_WEARABLES`, factories producing main's exact part type, and `REVIEW_LOOKS` for the
bench. Keep body/material/garment selections lane-local typed arguments consumed by this first renderer;
no persistence or public identity protocol is implied. The lane-local public factories are:

```ts
createBodyParts(family: BodyFamily, skin: SkinSwatchId): readonly AvatarPartBlueprint[];
createHairParts(form: HairForm, options: HairFit): readonly AvatarPartBlueprint[];
createWearableParts(id: WearableId, options: WearableFit): readonly AvatarPartBlueprint[];
compileAvatarPart(part: AvatarPartBlueprint, revision: number): VoxelAsset;
```

`HairFit` carries `body`, the registered `hair` swatch, and explicit `headwear` form or `null`; `WearableFit`
carries `body`, `style: 'hearth' | 'tide'`, and `subscription: 'active' | 'lapsed'` when applicable. These are
small lane-local content selections, not shared equip messages. Document their exact readonly types in the
owned README. `SkinSwatchId` is the union of the registered `AVATAR_PALETTE.skin` material IDs, not a new
palette key registry. Invalid IDs or unresolved materials fail explicitly. Main's next consumer imports these actual
types/signatures; no duplicated source interface or rig. Materials are resolved to registered IDs before
compilation, so `compileAvatarPart` needs no renderer, clock, account or entitlement inputs.

`REVIEW_LOOKS` includes each body, all skin/hair swatches, the largest headwear/hair pair, every common/story piece,
and the difficult cape/skirt/long-hair pose combinations, with labelled simulated provenance.

There is one useful automated seam test at `packages/content/src/avatars/fit.test.ts`: pass a deliberately
asymmetric known part/hat/hand fixture through the same compiler and attachment-transform function the bench
uses. On every body family, move head and one arm through known rotations and assert hand/hat marker positions
in metres, correct left/right attachment and unchanged canonical pivots. Reject an unknown socket and a build
lattice. Use hand-calculated expected marker positions, not a second implementation of the transform algorithm.
This catches scaling, wrong-axis and bind-offset errors. Factory validation traverses the complete catalogue;
screenshots and pose review establish art and fit. Do not create a test per voxel or snapshot every box array.

## Scope

Lane: `wardrobe-body` · branch: `lane/wardrobe-body` · worktree: `../worktrees/wardrobe-body`.

May write `packages/content/src/avatars/**` and `apps/web/src/avatar-bench/**`, plus its own PRD/progress.
The bench subtree may contain its capture script; main owns route/aggregate export/package command hooks.
Everything else is read-only, particularly `packages/shared/**`, palette registry, voxel workers, render core,
main app routes, walking/animation engine, identity, reward rules, other content lanes and root scripts.
You are not alone in the codebase. Accommodate other workers' edits; never revert them or enlarge your scope.
Write a `needs:` progress line for missing main inputs and continue only independent work. Root creates the
branch/worktree and integrates the lane; follow `$ralph-lane` for the task/commit protocol.

## Acceptance

Run these exact checks from the lane worktree. The focused fit command applies once WB02 introduces its test:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/avatars/fit.test.ts
pnpm test
pnpm build
pnpm --filter @chatdom/web preview --port 5190 --strictPort
```

The preview command occupies its own terminal/session and is stopped only by the worker who started it. Main's
optional route hook loads the lane's default component once WB01 adds it. The lane supplies
`apps/web/src/avatar-bench/capture.mjs` using existing Playwright/Chrome and the `$look` launch flags:

```sh
node apps/web/src/avatar-bench/capture.mjs --base-url http://127.0.0.1:5190
```

It captures every part/representative look from three angles at 480×480, complete contact sheets at
1440×900 and 390×844, a street-distance look lineup at 1920×1080 and 1280×720, and a pose-fit sheet covering
the six R9 poses. Use fixed seed/time/hour and readiness after assets, compilation and a completed frame;
browser exceptions or missing assets fail capture. Output lives under `shots/avatars/wardrobe-body/`, including
`bodies/`, `hair/`, `common/`, `story/`, `assembled/`, `pose-fit/` and measured `render-stats.json`. Preserve
noon/night outputs separately. Open all contact sheets with `view_image`, then difficult full-size frames;
do up to three improvement rounds, replacing weak forms while retaining the required catalogue.

Record the runtime follow-up for main: inspect actual walk/sit/bow/raised-arm movement with travelling cloak
and long braid on the broadest body, plus a tier-three shimmer cycle, when its engine consumes this content.
That follow-up is not claimed by the lane's static pose review and does not block this authored library.
No clip-authoring or network test suite belongs here. Root runs `pnpm verify` during integration; the next
walking avatar brief demonstrates motion/springs. SwiftShader appearance is not real-GPU frame-time evidence.

## Quality bar

The head is large enough to feel alive without becoming a giant box; eyes/face remain readable through the
main face plate. Distinct silhouettes carry identity before trim. Skin retains warmth and facial contrast in
dusk lighting across the full range. Curly/coiled hair, hips, sleeves and cloth hems feel shaped by hand, never
extruded rectangles with random flecks. Pieces sit on the body instead of hovering above it; garments remain
coherent when arms rise and legs sit. Kingdom accents make a shared garment belong somewhere without turning
the body into a flag. Story pieces read as a lovely memory, with no brighter light or purchased authority.

## References

- `work/references/crowd-animation.md`: attachments share the body's pose and timing; preserve silhouette at
  street/stream distance, keep accessory draw cost visible. No source copied from the unlicensed reference.
- `work/references/voxel-meshing-light.md`: consume the actual worker mesh/material/light path; wrong scale or
  attractive occupancy plots do not establish the rendered result.
- `work/references/prototypes.md`: earlier prototypes are read-only design context, not content to import.

This lane authors original voxel geometry, not an animation system or third-party model adaptation. Main's
walking/rig brief owns additional animation-reference study and any attributed implementation it adopts.

## Not now

This batch does not implement account wardrobe/equip persistence, reward grants, shop/checkout, gifting/trade,
Forge worn-piece generation, gameplay stats, procedural townsfolk, companion bodies, monarch crown authority,
face animation/shaders, animation clips, spring physics, locomotion, crowd simulation, network appearance or
build mode. Those are separate owners/briefs. This is a complete body/wardrobe library against its consumer,
not permission to replace missing behavior with a simulated success.

## Decisions

- **2026-10-30 — Separate avatar source, shared scale.** Existing avatar voxel scale is sufficient for storage;
  build-only blueprints are not an avatar authoring contract. Main freezes only the missing rigid part/fit seam
  needed by this library's first renderer, without inventing a full inventory protocol.
- **2026-10-30 — One skeleton, honest variety.** Four contour families and separate palette choices provide
  human variety while all garments use common joints. Skin/hair never signal tenure or money. Main owns rig,
  palette and eventual player motion; this lane owns geometry and demonstrates its fit.
- **2026-10-30 — Main approved the first rig.** Separate `AvatarPartBlueprint`, integer pivot and one rigid
  `AvatarAttachmentId`, four source layers and canonical 16-bone `AVATAR_RIG` at 24 cells, +Z forward. The lane
  owns a Three-group pose bench using those transforms and the existing avatar-capable mesh/material path.
  Walking, springs and the rainbow shader are main's next brief; this handoff never claims they already exist.
- **2026-10-30 — First-consumer inputs frozen.** The actual `avatar.ts` exports and limits above are the
  canonical inputs, with parent-local `AVATAR_RIG` offsets and separate `AVATAR_SOCKETS`. `AVATAR_PALETTE`
  supplies base swatches and matching lapsed fabric IDs; the shader supplies shading. The review route consumes
  a default component export. This lane can start without a second source schema or runtime avatar engine.
- **2026-10-30 — Visual depth and one seam test.** Invest evidence in rendered silhouettes, assembled garments,
  pose-fit sheets and the actual motion consumer. Keep one asymmetric attachment/scale regression test and full
  catalogue validation; no repetitive tests for reversible voxel choices.

- **2026-10-30 — Founder: capes are cloth, not voxels.** A cape is a thin smooth sheet hanging from shoulders,
  swaying in wind, lifting with a walk/hurry and settling at rest. This overrides earlier rigid-cloak wording.
  Main owns the runtime and freezes `AvatarCapeBlueprintSchema`; the lane authors shapes, hems, palette and
  active/lapsed shimmer data and migrates WB01’s block cloak through WB01C. No added glow or paid brightness.
