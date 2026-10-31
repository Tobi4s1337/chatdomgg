# Avatar style study (spec 49)

Three candidate citizen shapes, shown on the same five wardrobe looks so Tobias can choose one. This
module converts a wardrobe look into a style; it does not change the wardrobe, the frozen rig or any
production file. Nothing here is selected: AS02 waits for Tobias's choice.

| Option | Style | Inspired by | Height | Head share | What changes |
|---|---|---|---:|---:|---|
| A | `hearthling` | chunky, Cube World / Trove | 24 cells, 1.50 m | 46 % | 12 × 11 × 10 head, wider than the shoulders; short barrel torso (rows 6–12); stubby 3-row thighs; 3 × 3 arms with mitten hands; every edge bevelled |
| B | `blockwright` | blockier, Minecraft | 28 cells, 1.75 m | 29 % | Sharp 8 × 8 × 8 cube head; 10-row slab torso; arms and legs as straight square columns of one thickness, legs touching; flat painted face; hair cut into 2-cell blocks over a painted scalp |
| C | `storybook` | slim storybook voxel | 30 cells, 1.88 m | 27 % | 8 × 8 × 8 oval head on a one-row neck; tapered waist; 13-row legs (43 %); 2-cell arms with small hands; slim shoes with a toe |

Today's citizen is 24 cells with a 33 % head. The founder's decision (Artstyle §Decided 1) is a chibi
figure with the head about a third of the height. A is more chibi than today; B and C are less.

## Entry points

| Export | What it is |
|---|---|
| `AVATAR_STYLES`, `avatarStyle(id)` | The three proportion sets: head box and face layout, torso slices for each of the four body families, limb columns, joint rows, bevel, hand and hair treatment |
| `styleRig(style, family)` | The frozen rig's bones and sockets in the frozen hierarchy, at the style's rest positions. `currentRig()` is today's |
| `convertLook(style, source)` | One look in a style: rigid parts whose pivots are the style's joints, plus the cloak refitted |
| `retargetHair`, `styleHair`, `sealScalp` | The hair conversion (below) |
| `STYLE_STUDY_FIXTURES` | The five looks, their expected identity and their bench poses |

`StyleLookSource` is what a look *is*: body family, skin, dyed shirt and breeches, its own hair part and its
cloak. The study reads it from the compiled production parts (`apps/web/src/citizens/style-study/identity.ts`),
so a converted citizen is always the real fixture.

## How a look is converted

- **Body.** Rebuilt from the style's proportions in the look's own materials: shirt and breeches colours,
  belt with an off-centre brass buckle, an open collar showing skin, shoes with a darker sole line, skin on
  the head and hands. The face uses the wardrobe's own layout: pupils with the eye white on the outer side,
  so the darkest skins still read eyes, plus cheeks and mouth. Only the size changes per style: A has big
  2 × 3 eyes with a catch-light, B flat 1 × 2 paint, C small 1 × 2 eyes.
- **Hair is carried over, not redrawn.** The look's real hair part is refitted onto the style head with a
  landmark map. Inside the skull's box each axis stretches piecewise between matching landmarks (jaw, eye
  bottom, eye top and crown; the sides; the back and the face plate). Outside it, the distance from the
  skull is kept, scaled only by `hairDepth` (C uses 0.85). A curl stays the same size, a fringe still stops
  above the eyes, and no treatment swells with a bigger head. The tests check that every treatment stays
  within 1.5 cells of the wardrobe's own reach and never covers the eyes. B re-cuts the refitted hair into
  2-cell blocks aligned to the cube, and paints the scalp under it. Bevelled heads repaint only the skull
  cells that two hair cells hold, so a seam never shows skin.
- **Cloak.** The same `AvatarCapeBlueprint`, keeping its cut, colours and trim, with width, length and mount
  refitted. The pinned top spans the shoulder joints and the hem reaches mid-thigh. A new clasp (cords in
  the cloak's colour, a brass clasp) sits on the style's collar.

All eight hair forms, all four body families and the cloak convert in all three styles within
`AVATAR_LOOK_LIMITS` (`avatar-style.test.ts`).

## The bench

`apps/web/src/citizens/style-study/study.html?style=hearthling|blockwright|storybook|current` is the citizen
bench (`citizens/review.ts`) with only its subject changed. It keeps the backdrop, ground, camera direction,
ACES tone mapping, voxel material and noon environment (`hour=12`). The frame is 16:9 and closer: an
orthographic half-height of 1.95 m. Five fixtures stand 1.3 m apart at heading −0.23, each in its fixed
pose. A 2 m measuring staff with brass bands every half metre stands at the left as the scale reference.

Capture, repeatable:

```sh
node apps/web/src/citizens/style-study/capture.mjs --out shots/avatar-style/final
node apps/web/src/citizens/style-study/capture.mjs --compare <before-dir> <after-dir>   # same-view pairs
```

It writes `<style>@1920x1080.png` for each style and a `contact-sheet.png` with one labelled row per style
(the full-body band at 0.85 scale). It also writes `controls.json` and, with `--compare`,
`compare-<style>.png`.

## Fixtures

| # | Look (`createDefaultCitizenLooks`) | Body | Hair | Skin | Shirt / breeches | Cloak | Pose |
|---|---|---|---|---|---|---|---|
| 1 | `hearth` | balanced | side part, brown | skin3 | cream / muted blue | short cloak, Hearth | weight on one hip, hand raised mid-sentence |
| 2 | `tide` | broad | coiled high crown, black | skin7 | muted blue / earth | — | feet apart, chin up |
| 3 | `grove` | slender | bob, copper | skin1 | muted green / muted gold | — | hand on hip, head tipped |
| 4 | `clay` | round | rounded curls, chestnut | skin5 | muted red / muted blue | — | waving |
| 5 | `dusk` | slender | paired twists, silver | skin2 | muted violet / earth | — | a step forward, glancing aside |

All five are SIMULATED review people, labelled so on every frame.

## If a style is chosen

A, B and C each need new joint offsets in `AVATAR_RIG` (`@chatdom/shared`): the bones stay, their rest
positions change. That is a contract change only main can make. The production runtime
(`citizens/index.ts`) would then pose the converted parts as they are. Its stride's hip-height solve assumes
4-cell thighs and 3-cell shins, so it would also take the style's limb lengths. Hearthling's broad and
round shoulders are wider than the cloth contract's 0.95 m cloak. Their cloak is the widest legal sheet,
which no longer spans the shoulder joints.
