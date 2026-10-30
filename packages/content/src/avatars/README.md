# Avatar bodies and wardrobe

Library of citizen bodies, hair and wearables on the frozen rig from `@chatdom/shared` (`AVATAR_RIG`,
`AVATAR_SOCKETS`, `AvatarPartBlueprintSchema`, `AVATAR_PART_LIMITS`, `AVATAR_LOOK_LIMITS`). Every part is a
rigid `AvatarPartBlueprint` bound to one bone or socket. Clothing that has to follow several bones is a recipe
of several parts. This module never writes the shared contract or the palette registry.

Status: WB01. One body family (`balanced`), one hair treatment (`sidePart`) and one wearable (`shortCloak`).
The catalogues below grow in WB02–WB04, in the same order.

## Entry point

`index.ts` exports:

| Export | What it is |
|---|---|
| `BODY_FAMILIES`, `HAIR_FORMS`, `COMMON_WEARABLES` | Ordered catalogues |
| `createBodyParts(family, skin)` | Body in its neutral garb: linen shirt, belted breeches, soft shoes |
| `createHairParts(form, fit)` | Hair as one `hair`-layer part on `head` |
| `createWearableParts(id, fit)` | One or more `garment` parts |
| `compileAvatarPart(part, revision)` | Executes the ordered boxes into an avatar-lattice `VoxelAsset` (material 0 carves) |
| `validateLook(parts)` | Unique IDs, per-part limits, look part and cell budgets |
| `REVIEW_LOOKS`, `assembleLook(look)` | SIMULATED bench fixtures and their parts |
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
- Kingdom accents: Hearth leans warm (`fabricRed` for the short cloak, with a `plaster` hem), Tide leans
  sea-cool (`fabricBlue`, with a `cream` hem).

## Body

Every family keeps the frozen joints. The head is shared: 10 × 8 × 8 cells (one third of the 24-cell height),
r=2 at the crown and back, a flatter r=1 face plate at z = 4 with catch-lit 2 × 2 eyes, cheeks and a mouth.
Thighs and shins carry hidden hip and knee caps inside the part above, so a stride or a bent knee closes the
joint instead of opening a wedge.

| Family | Chest/hip half-width | Legs | Arms |
|---|---|---|---|
| balanced | 4 / 4 | 3 wide, x ∈ [−4,−1) / [1,4) | 2 × 2, x ∈ [4,6) |

## Wardrobe

| ID | Area | Attachment | Notes |
|---|---|---|---|
| `shortCloak` | back | `back` | Rolled collar, two-cell drape to mid-thigh, vertical folds, continuous hem dipping at centre, cords and clasp under the chin |

One piece per area per look. Two pieces in one area are an explicit error in `assembleLook`.

## Review

The bench is `apps/web/src/avatar-bench` at `/-/avatars?look=<id>&angle=front|side|back&hour=19&frame=page|still&focus=body|head`.
It builds the rig as nested `THREE.Group`s from `attachmentLocalMatrix`, checks them against `poseAttachments`,
compiles each part, meshes it in the production `VoxelWorkerPool` and draws it with `createVoxelMaterial(…, 'avatar')`.
Capture:

```sh
pnpm build
node apps/web/src/avatar-bench/capture.mjs                 # owns a temporary preview
node apps/web/src/avatar-bench/capture.mjs --base-url http://127.0.0.1:5190 --hour 12
```

Output goes to `shots/avatars/wardrobe-body/<group>/`, with contact sheets at 1440×900 and 390×844 and
`render-stats.json` (measured cells, triangles and draws per look). Every still and sheet says SIMULATED.

Measured at WB01 (rest pose, dusk):

| Look | Parts | Boxes | Cells | Triangles | Draws |
|---|---:|---:|---:|---:|---:|
| body-balanced | 15 | 71 | 1,236 | 1,098 | 15 |
| hair-side-part | 16 | 111 | 1,520 | 2,058 | 16 |
| citizen-a (body, side part, short cloak) | 17 | 131 | 1,786 | 2,362 | 17 |

Static rest-pose stills prove neither moving cloth nor hair. Springs, shimmer and walking belong to the
avatar engine brief.
