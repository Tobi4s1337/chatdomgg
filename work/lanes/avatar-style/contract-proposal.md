# Avatar-style contract proposal (for main to freeze)

Lane: avatar-style · From AS10 (the body and the wardrobe) · 2026-10-31

## What already fits the frozen rig (no change)

The citizen in `packages/content/src/avatar-style/character/` (body: `body.ts`) is drawn on `AVATAR_RIG`'s rows:

| Rig | Value | The citizen |
|---|---|---|
| `pelvis` | y 8 | The hips block is y 6–8, the waistband y 8–10 |
| `thighLeft/Right` | x ∓2, y 8 | Leg columns x [-3,-1) and [1,3): centred on x ∓2 |
| `shin*` / `foot*` | y 4 / y 1 | Knees at y 4, shoes y 0–2 (boots to y 4) |
| `head` | y 16 | The 8 × 8 × 8 skull starts at y 16; nothing worn below the neck reaches it |
| sockets `hat` / `face` / `back` | y 24 / z 4 / (0, 14, -2) | Top of the skull / the face plane / the torso's back plane |

The head is a third of the 24-cell figure, the founder's chibi proportion.

## Proposal 1: shoulder joints at x ∓4 (was ∓5)

The torso is six cells wide (x [-3,3)), narrower than the head as in the reference, so the one-cell arm columns
hang at x [-4,-3) and [3,4). `upperArmLeft/Right` sit at x ∓5, one to two cells outside the arm.

- Swinging an arm forward and back (walk, carry) rotates about X and is unaffected.
- Raising an arm sideways (wave, cheer, the raid salute) rotates about Z and would orbit the arm out from the
  shoulder, leaving a gap.

Proposed: `upperArmLeft.offset = [-4, 3, 0]`, `upperArmRight.offset = [4, 3, 0]` (the shoulder's outer top
corner of the torso). Forearm and hand offsets are unchanged (y -4, y -3: the wrist at y 8 is where the hand
starts). Today's wardrobe parts were built for x ∓5, so this change lands together with the runtime swap to the
new citizen, not before. If main prefers to keep ∓5, the citizen still works by placing the arm part with its
pivot one cell inward; only sideways raises suffer.

## Proposal 2: per-citizen colours

A look is pure data with any `#rrggbb` per part; geometry carries paint slots and colours are resolved at
meshing time (`slotColours(look)`). The kingdom's voxel material registers materials by id. The citizen needs
either per-vertex colour (what `apps/web/src/avatar-builder/portrait-renderer.ts` does, with the convex-edge
bevel and corner occlusion as vertex attributes) or a per-citizen palette texture. Main decides when it wires
the character.

## Proposal 3: the look recipe in `@chatdom/shared`

`CitizenLook` (`character/recipe.ts`) is the saved recipe: skin, eyes, freckles, blush, hair, beard, moustache,
hat, glasses, earrings, flower, and the wardrobe: `top`, `outer` (nullable), `bottom`, `neckwear` (nullable) and
`shoes`, every garment `{ style, dye, pattern, accent }`. `parseLook` validates untrusted input, refuses
unknown keys at every level, and reads older looks (no accessories, no wardrobe) with defaults. When main
freezes it into `@chatdom/shared` as `citizen-look` v2, the ids lists in `recipe.ts` are the enums.

## Also needed

- `@chatdom/content` package export `./avatar-style` (the web imports it by relative path today).
