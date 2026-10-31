# Avatar bodies and wardrobe

Library of citizen bodies, hair and wearables on the frozen rig from `@chatdom/shared` (`AVATAR_RIG`,
`AVATAR_SOCKETS`, `AvatarPartBlueprintSchema`, `AVATAR_PART_LIMITS`, `AVATAR_LOOK_LIMITS`). Every part is a
rigid `AvatarPartBlueprint` bound to one bone or socket. Clothing that has to follow several bones is a recipe
of several parts. Capes and cloaks are the exception: they are thin cloth (`AvatarCapeBlueprint`), never voxels,
and the citizen runtime moves them. This module never writes the shared contract or the palette registry.

Status: WB02. Four body families, ten skins (eight human, two fey), six hair swatches and eight hair treatments;
one wearable (`shortCloak`, a cloth cape plus its rigid clasp). Common clothes and story pieces follow in WB03–WB04.

## Entry point

`index.ts` exports:

| Export | What it is |
|---|---|
| `BODY_FAMILIES`, `HAIR_FORMS`, `COMMON_WEARABLES` | Ordered catalogues |
| `bodyContour(family)` | A family's torso slices, leg and arm columns, for fitting garments and capes |
| `createBodyParts(family, skin)` | Body in its neutral garb: linen shirt, belted breeches, soft shoes |
| `createHairParts(form, fit)` | Hair as one `hair`-layer part on `head` |
| `createWearableParts(id, fit)` | One or more `garment` parts; for a cape, only its rigid clasp or cords |
| `CAPE_FORMS`, `createCape(id, fit)` | Cloth back garments and their `AvatarCapeBlueprint` fitted to a body |
| `compileAvatarPart(part, revision)` | Executes the ordered boxes into an avatar-lattice `VoxelAsset` (material 0 carves) |
| `validateLook(parts)` | Unique IDs, per-part limits, look part and cell budgets |
| `REVIEW_LOOKS`, `assembleLook(look)` | SIMULATED bench fixtures and their `{ parts, cape }` |
| `REVIEW_LINEUPS` | Rows of fixtures seen together at street distance; `silhouette` rows are drawn unlit |
| `poseAttachments`, `attachmentLocalMatrix`, `partMatrix`, `partPivotMatrix`, `restPosition` | Pure rig maths shared by the bench and the fit test |

## Lane-local selection types

These are content arguments for the first renderer. They are not an equip, inventory or network protocol.

```ts
type SkinSwatchId = (typeof AVATAR_PALETTE.skin)[number];   // registered material keys
type HairSwatchId = (typeof AVATAR_PALETTE.hair)[number];
type WearableStyle = 'hearth' | 'tide';
type Subscription = 'active' | 'lapsed';

interface HairFit {
  readonly body: BodyFamily;
  readonly hair: HairSwatchId;
  readonly headwear: HeadwearId | null;   // the head wearable the hair is fitted under
}
interface WearableFit {
  readonly body: BodyFamily;
  readonly style: WearableStyle;
  readonly subscription?: Subscription;   // only for subscription pieces
}
```

Unknown families, forms, styles or swatches throw. A wearable without a subscription state rejects one. Hair
with no authored fit under the requested headwear throws, so a selected piece is never silently dropped.

## Authoring rules

- Author in root-local rest cells (+Y up, +Z forward, left is −X). `Sculpt.toPart` re-bases a workpiece to its
  bounds and sets `pivot` to the attachment's rest position, so `(cell − pivot) × 0.0625 m` is attachment-local.
- Layers never share a coplanar face. Hair is an offset shell of the skull (`Sculpt.shell`) minus the skull.
  Garments sit outside the body they cover, so layered faces meet face to face.
- Materials are registered keys only: `AVATAR_PALETTE` skin, hair, fabric and lapsed fabric, the everyday
  `GARB` keys (linen `cream`, breeches `earth`, leather `timber`, eyes `hairBlack`, eye white and catch-light `cream`,
  blush `petal`, clasp `brass`) and each kit's cloth, trim and stone. `compileAvatarPart` rejects anything else.
- Kingdom accents: Hearth leans warm, Tide leans sea-cool. Each cape's hem band is its kingdom's wall cloth.

## Body

Every family keeps the frozen joints (shoulders x = ±5, y = 15; hips x = ±2, y = 8; knees y = 4; ankles y = 1),
the same head and the same 24-cell height: a family changes volume around the bones, never a bone, the head or
the height. The head is shared: 10 × 8 × 8 cells (one third of the height), r=2 at the crown and back, a flatter
r=1 face plate at z = 4 with catch-lit 2 × 2 eyes, each with a one-cell eye white on its outer side, cheeks
and a mouth. The whites are what draw the eye on the darkest skins: `skin8` (#35231e) is as dark as
`hairBlack` (#30241f), so a pupil alone disappears there; on pale skins the cream white nearly vanishes. Thighs and shins carry hidden hip and
knee caps inside the part above (none on a two-cell leg), so a stride closes the joint instead of opening a wedge.

The torso is eight authored slices (rows 8–15), each a ring with its vertical corners cut. Neutral garb on every
family: linen shirt with an open collar that shows a little skin, belted earth breeches with a brass buckle,
timber shoes with a darker sole line.

| Family | Silhouette | Across the arms | Torso half-width rows 8→15 | Legs (left) | Arms (right) |
|---|---|---:|---|---|---|
| balanced | even column, shoulders as wide as the hips | 12 | 4 throughout, 6 deep | x ∈ [−4,−1), 4 deep | x ∈ [4,6), 2 × 2 |
| slender | narrow column the width of the head, shallow | 10 | 3 throughout, 4–5 deep | x ∈ [−3,−1), 2 deep | x ∈ [3,5), 2 × 2 |
| broad | square shoulders over a deep chest, tapered waist; daylight under the arms | 18 | 4,4,4,5,5,6,6,6; chest 8 deep | x ∈ [−4,−1), 4 deep | x ∈ [6,9), 3 × 3 |
| round | sloped shoulders, soft forward belly, full hips, sturdy stance | 14 | 5,5,5,5,5,5,4,3; belly 8 deep | x ∈ [−5,−1), 4 deep | x ∈ [5,7), 2 × 2, top at row 14 widened inward to meet the collar |

### Skin

`createBodyParts(family, skin)` takes any `AVATAR_PALETTE.skin` key; head, hands and the collar carry it. Order:
`skin1` (lightest) … `skin8` (darkest), then the fey `skinFeyAsh` and `skinFeyMoss`. Skin is a free choice, never
inferred from anyone's data and never a reward.

## Hair

`createHairParts(form, { body, hair, headwear })` returns one `hair`-layer part on `head`. Every treatment is
built around the shared head (`Sculpt.grow` makes a rounded Euclidean offset of the skull, minus the skull, so
hair meets it face to face), trimmed to a hairline, and keeps rows 17–20 of the face plate clear. Textured
treatments are made of clumps about three cells across, placed evenly and mirrored, and `Sculpt.tidy` removes
any cell with fewer than two neighbours, so no single-voxel confetti survives. Only `longBraid` reads the body
(its plait hangs one cell clear of the deepest back); the others share one part ID across families. The swatch is
any `AVATAR_PALETTE.hair` key; `headwear` must be `null` until headwear fits are authored (WB03), and anything
else throws rather than dropping a piece.

| Form | Shape |
|---|---|
| `bareScalp` | The head's own rounded crown; only brows in the swatch, a cell proud above each eye |
| `closeCrop` | One cell over the skull, square hairline at the temples, short sideburns, tapered nape, brows |
| `roundedCurls` | A round mass two and a half cells deep over the ears to the nape, its surface built from clumps about four cells across, so the seams are creases, not pinholes |
| `coiledHighCrown` | Close sides and nape under a tall crown of coils, up to six cells above the head |
| `sidePart` | Close on the parted left, lifted over the crown and right, a stepped fringe and a temple lock |
| `bob` | A bell two cells deep to the jaw and nape, turned under, with a straight fringe a row above the eyes |
| `longBraid` | Drawn back close into a nape knot; a plait of alternating crossings down the spine, leather tie, tuft above the seat |
| `pairedTwists` | A dome of two-strand twists to the jaw and nape, short ones framing the brow: 2 × 2 ropes, each in its own column with a groove beside it, every other turn a cell further out; neighbours start on opposite turns so the bulges interleave |

## Wardrobe

| ID | Area | Rigid part (attachment) | Notes |
|---|---|---|---|
| `shortCloak` | back | cords and brass clasp (`chest`, `accessory`) | Cloth cape below; the cords run along the collar line in the cloak's colour and meet under the chin |

One piece per area per look. Two pieces in one area are an explicit error in `assembleLook`.

## Capes

A cape is one `AvatarCapeBlueprint` on the `back` socket: a zero-thickness sheet whose motion (stride lift,
wind, turning sway, settling), lighting and any shimmer belong to `createCitizenCapeRenderer` in
`apps/web/src/citizens/capes.ts`. `createCape(id, fit)` takes the same `WearableFit` as the rigid factories and
returns a schema-checked descriptor; nothing about it is meshed. A cut is body-independent and is fitted to a family
from its contour:

| Measure | Rule |
|---|---|
| `mount.height` | The cut's mount row minus the back socket's rest row (y = 14). The short cloak pins at row 15, under the head |
| `mount.back` | From the socket (z = −2) to the deepest back point of chest, waist, hip or leg, plus ½ cell of air; never less than ¾ cell (the contract's 4 cm minimum), which the flat slender back needs |
| `width` | Widest span. Flared cuts narrow the top to 72 %, which should span the shoulders (2 × chest half + ease); the hem spans the hips plus the cut's ease. Capped at the contract's 0.95 m, so broad and round shoulders get the widest legal sheet; its pinned edge must still cover the back between the shoulder joints, or the factory throws |
| `length` | Mount row to the cut's hem row (longest point; a rounded hem lifts 14 % at the sides) |

| Cape | Cut | Hearth cloth / lining / hem | Tide cloth / lining / hem | Fitted width × length, mount up / back (m) |
|---|---|---|---|---|
| `shortCloak` | flared, rounded hem, row 15 → mid-thigh row 6; top spans the shoulder joints (ease 1 cell), so the bell shows past the arms from the front; 2 cm hem band | `fabricRed` / `petal` / `plaster` | `fabricBlue` / `limestone` / `cream` | balanced 0.8681 × 0.5625, .0625 / .0938 · slender 0.6944 × 0.5625, .0625 / .0469 · broad 0.95 × 0.5625, .0625 / .1563 · round 0.95 × 0.5625, .0625 / .0938 |

The outside is `cloth`, the side facing the wearer is `lining`, and the hem band and side edges are `trim`. No cape
carries light or emission. Tier shimmer swatches arrive with the story capes (WB04).

## Review

The bench is `apps/web/src/avatar-bench` at `/-/avatars?look=<id>&angle=front|side|back&hour=19&frame=page|still&focus=body|head`.
It builds the rig as nested `THREE.Group`s from `attachmentLocalMatrix`, checks them against `poseAttachments`,
compiles each part, meshes it in the production `VoxelWorkerPool` and draws it with `createVoxelMaterial(…, 'avatar')`.
A cape is drawn by main's `createCitizenCapeRenderer` from the posed `back` group, standing still.

`&motion=walk-stop` hands the same parts and cape to main's `createCitizenRenderer` (its stride pose, back socket
and cloth response): the citizen walks in place at 1.2 m/s, eases to a stop at 1.6–1.9 s and stands. `&t=<seconds>`
fixes the moment for captures; a page without `t` plays the sequence on a loop.

`/-/avatars?lineup=<id>&angle=…&hour=…` stands a whole `REVIEW_LINEUPS` row side by side at street distance,
each citizen built exactly as on the single-look bench, named under its feet: `bodies`, `skins` (every skin on
the same body and crop), `hair`, and the unlit `bodies-silhouette` and `hair-silhouette` rows (flat ink on
parchment, plinths hidden), which show whether shapes read before colour.

Capture:

```sh
pnpm build
node apps/web/src/avatar-bench/capture.mjs                 # owns a temporary preview
node apps/web/src/avatar-bench/capture.mjs --base-url http://127.0.0.1:5190 --hour 12 --look skin-lightest,skin-darkest --lineup skins
node apps/web/src/avatar-bench/capture.mjs --lineup bodies-silhouette,hair-silhouette   # only these lineups
```

Output goes to `shots/avatars/wardrobe-body/<group>/`, with contact sheets at 1440×900 and 390×844 and
`render-stats.json` (measured cells, triangles and draws per look; draws include one for cloth). Every caped look
also gets `<group>/walk-stop/`: side and back at 1.2, 1.75, 2.0, 2.5 and 3.6 s, and a sheet. Bodies and hair add
a front head close-up (`-close`). Lineups go to `lineups/<id>-<angle>@<size>.png` at 1920×1080, 1280×720, 1440×900
and 390×844 (silhouettes front and side, the hair row front and back). Another hour writes to `hour-<h>/`.
Every still, lineup and sheet says SIMULATED.

Measured at WB01C (rest pose, dusk). Draws include one for the cloth; cloth triangles are separate from the
voxel look budget (`AVATAR_CAPE_LIMITS.triangles`, 120 per cape):

| Look | Parts | Boxes | Cells | Voxel triangles | Cloth triangles | Draws |
|---|---:|---:|---:|---:|---:|---:|
| body-balanced | 15 | 71 | 1,236 | 1,098 | 0 | 15 |
| hair-side-part | 16 | 111 | 1,520 | 2,058 | 0 | 16 |
| citizen-a (body, side part, short cloak) | 17 | 114 | 1,528 | 2,094 | 120 | 18 |

Rest-pose stills prove neither moving cloth nor hair. The walk-to-stop strip shows the runtime's cloth at fixed
moments under SwiftShader; it is not evidence of frame timing, and hair motion stays with the avatar engine.
