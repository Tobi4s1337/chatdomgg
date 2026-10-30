# Avatar bodies and wardrobe

Library of citizen bodies, hair and wearables on the frozen rig from `@chatdom/shared` (`AVATAR_RIG`,
`AVATAR_SOCKETS`, `AvatarPartBlueprintSchema`, `AVATAR_PART_LIMITS`, `AVATAR_LOOK_LIMITS`). Every part is a
rigid `AvatarPartBlueprint` bound to one bone or socket. Clothing that has to follow several bones is a recipe
of several parts. Capes and cloaks are the exception: they are thin cloth (`AvatarCapeBlueprint`), never voxels,
and the citizen runtime moves them. This module never writes the shared contract or the palette registry.

Status: WB01C. One body family (`balanced`), one hair treatment (`sidePart`) and one wearable (`shortCloak`, a
cloth cape plus its rigid clasp). The catalogues below grow in WB02–WB04, in the same order.

## Entry point

`index.ts` exports:

| Export | What it is |
|---|---|
| `BODY_FAMILIES`, `HAIR_FORMS`, `COMMON_WEARABLES` | Ordered catalogues |
| `createBodyParts(family, skin)` | Body in its neutral garb: linen shirt, belted breeches, soft shoes |
| `createHairParts(form, fit)` | Hair as one `hair`-layer part on `head` |
| `createWearableParts(id, fit)` | One or more `garment` parts; for a cape, only its rigid clasp or cords |
| `CAPE_FORMS`, `createCape(id, fit)` | Cloth back garments and their `AvatarCapeBlueprint` fitted to a body |
| `compileAvatarPart(part, revision)` | Executes the ordered boxes into an avatar-lattice `VoxelAsset` (material 0 carves) |
| `validateLook(parts)` | Unique IDs, per-part limits, look part and cell budgets |
| `REVIEW_LOOKS`, `assembleLook(look)` | SIMULATED bench fixtures and their `{ parts, cape }` |
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
  `GARB` keys (linen `cream`, breeches `earth`, leather `timber`, eyes `hairBlack`, catch-light `cream`,
  blush `petal`, clasp `brass`) and each kit's cloth, trim and stone. `compileAvatarPart` rejects anything else.
- Kingdom accents: Hearth leans warm, Tide leans sea-cool. Each cape's hem band is its kingdom's wall cloth.

## Body

Every family keeps the frozen joints. The head is shared: 10 × 8 × 8 cells (one third of the 24-cell height),
r=2 at the crown and back, a flatter r=1 face plate at z = 4 with catch-lit 2 × 2 eyes, cheeks and a mouth.
Thighs and shins carry hidden hip and knee caps inside the part above, so a stride or a bent knee closes the
joint instead of opening a wedge.

| Family | Chest/hip half-width | Legs | Arms |
|---|---|---|---|
| balanced | 4 / 4 | 3 wide, x ∈ [−4,−1) / [1,4) | 2 × 2, x ∈ [4,6) |

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
| `mount.back` | From the socket (z = −2) to the deepest back point of chest, waist, hip or leg, plus ½ cell of air |
| `width` | Widest span. Flared cuts narrow the top to 72 %, which must still span the shoulders (2 × chest half); the hem spans the hips plus the cut's ease |
| `length` | Mount row to the cut's hem row (longest point; a rounded hem lifts 14 % at the sides) |

| Cape | Cut | Hearth cloth / lining / hem | Tide cloth / lining / hem | Fitted on `balanced` |
|---|---|---|---|---|
| `shortCloak` | flared, rounded hem, row 15 → mid-thigh row 6; top spans the shoulder joints (ease 1 cell), so the bell shows past the arms from the front; 2 cm hem band | `fabricRed` / `petal` / `plaster` | `fabricBlue` / `limestone` / `cream` | 0.8681 × 0.5625 m, mount 0.0625 up, 0.0938 back |

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
Capture:

```sh
pnpm build
node apps/web/src/avatar-bench/capture.mjs                 # owns a temporary preview
node apps/web/src/avatar-bench/capture.mjs --base-url http://127.0.0.1:5190 --hour 12
```

Output goes to `shots/avatars/wardrobe-body/<group>/`, with contact sheets at 1440×900 and 390×844 and
`render-stats.json` (measured cells, triangles and draws per look; draws include one for cloth). Every caped look
also gets `<group>/walk-stop/`: side and back at 1.2, 1.75, 2.0, 2.5 and 3.6 s, and a sheet. Every still and sheet
says SIMULATED.

Measured at WB01C (rest pose, dusk). Draws include one for the cloth; cloth triangles are separate from the
voxel look budget (`AVATAR_CAPE_LIMITS.triangles`, 120 per cape):

| Look | Parts | Boxes | Cells | Voxel triangles | Cloth triangles | Draws |
|---|---:|---:|---:|---:|---:|---:|
| body-balanced | 15 | 71 | 1,236 | 1,098 | 0 | 15 |
| hair-side-part | 16 | 111 | 1,520 | 2,058 | 0 | 16 |
| citizen-a (body, side part, short cloak) | 17 | 114 | 1,528 | 2,094 | 120 | 18 |

Rest-pose stills prove neither moving cloth nor hair. The walk-to-stop strip shows the runtime's cloth at fixed
moments under SwiftShader; it is not evidence of frame timing, and hair motion stays with the avatar engine.
