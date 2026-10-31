# Citizens (spec 49)

`character/` is the citizen look Tobias chose: the reference in `work/references/avatar-style/reference.png`,
with crisp chunky voxel heads, a minimal face, hair as the signature and a bust portrait on Twitch purple.
The three-option study further down (AS01) is superseded and kept only as a record.

## The character (`character/`)

| File | What it is |
|---|---|
| `recipe.ts` | `CitizenLook`, the saved recipe: skin, eyes (shape, spacing), freckles, blush, hair (style, colour), beard, top. Every colour is a `#rrggbb`. `parseLook` validates untrusted input; `seedLook(personId)` gives a newcomer a complete, varied default |
| `palette.ts` | Twenty skin tones, fourteen natural and nine wild hair swatches, eighteen dyes, eye ink, blush pink, freckle brown |
| `grid.ts` | `VoxelGrid`, a sparse grid of paint slots in root-local avatar cells (the frozen rig's frame) |
| `head.ts` | The 8 × 8 × 8 skull and the face: eye cells, blush, freckles, the blink frame |
| `hair.ts` | Eight hair styles plus bald, and two beards |
| `bust.ts` | The neck, the compact torso, short upper arms and a plain tee |
| `build.ts` | `buildCitizen(look)` draws everything into one grid. `slotColours(look)` resolves every slot to a colour |
| `mesh.ts` | `meshCitizen(grid, colours)` gives engine-free arrays: quads with corner occlusion, convex-edge flags and in-face coordinates for the bevel |
| `portrait.ts` | The fixed portrait composition: camera, lights, gradient, bevel width, sizes 128 and 512 |
| `fixtures.ts` | Twenty SIMULATED citizens for the 4 × 5 sheet |

The web side is in `apps/web/src/avatar-builder/portrait-renderer.ts`. `citizenObject(look)` is the three.js
mesh in cells (scale by 1/16 for metres). `createPortraitRenderer().render(look, size)` returns a canvas with
the bust portrait.

### Decisions

- **The skull is 8 cells, not 10–12.** Measured on the reference, an eye is one cell and a seventh to an
  eighth of the face's width. On an 8-cell face, one-cell eyes sit two cells apart with a two-cell margin,
  which is the reference face exactly. With a cell of hair each side the silhouette is the "about 10 cells"
  the spec saw. A 10-cell face would need eyes that are either too small (1 cell) or too big (2 × 2). It is
  also the frozen rig's head: head bone at y 16, hat socket 8 up, face socket on the front plane at z 4. No
  contract change is needed for the head.
- **Eyes on row 2 of 8, no mouth.** Two face rows under the eyes give room for blush and freckles without
  pushing the eyes up. The shapes are `dot`, `tall` and `closed` (also the blink frame); the spacings are `set`
  and `wide`. An eyelash variant was tried and dropped: at this resolution a second dark cell beside the eye
  reads as four eyes. Freckles never sit directly under an eye, where they read as a taller eye, and never on
  the centre columns, where any dark pair reads as a mouth. On deep skin the eye ink goes darker, and the
  deepest swatch stops where one-cell eyes still read at 128 px.
- **Slots, not registered materials.** Geometry carries paint slots (`skin`, `eye`, `hair`, `hairDeep`, …), and
  colours come from the recipe at meshing time. This is how "any hair colour" works without a material per
  colour. Deep, blush and freckle tones are derived from the look, so any input stays coherent. Main needs to
  decide how the kingdom renderer takes per-citizen colours (see Contract notes).
- **Hair is stacked rounded slabs.** Each row of a style is a rectangle with stepped-off corners, so the volume
  is the stepped dome of a pixel circle, like the reference. Curls get locks: some outer cells are removed and
  a few pushed out. The afro is a lumpy ellipsoid. `guardFace` runs last for every style, and the tests hold
  every style × beard × eye variant to it: nothing proud in front of the face below the hairline, the eyes
  never covered, the face between the eyes always skin.
- **Bevel only where an edge is truly convex.** The mesher flags each quad edge as convex when both the
  in-plane neighbour and the cell diagonally in front are empty. The shader tilts the normal over 13 % of the
  cell at those edges only. Coplanar neighbours never show a seam, and a colour change stays flat paint, as in
  the reference.
- **Seeded beards go only with short hair.** A long style plus a same-colour full beard closes around an
  eight-cell face and hides it. The builder will still allow any combination.
- **Portrait light.** One warm key light, nearly frontal, high and slightly from the person's left, with a soft
  shadow, so the fringe shades the forehead. A lavender sky with a purple ground for the bounce (the
  reference's shaded sides lean purple), and a cool rim. The camera is turned 24° to the person's right, 10°
  above, with a 24° field of view, framing y 9.4–29.8. The image is rendered at 2× and filtered down. The
  gradient runs #cfaaff → #b089f7 → #6a39e0, top left to bottom right, sampled from the reference.

### Bench and capture

`apps/web/src/avatar-builder/portraits.html?set=fixtures|seeded` renders twenty SIMULATED citizens at 512 px
(shown at 256) and at 128 px (shown at actual size).

```sh
node apps/web/src/avatar-builder/capture.mjs --out shots/avatar-style/portraits          # both sets
node apps/web/src/avatar-builder/capture.mjs --compare <before-dir> <after-dir>          # same-view pairs
```

For each set it writes `<set>-sheet.png` (4 × 5 at 500 px cells, the reference's layout),
`<set>-vs-reference.png`, every portrait at both sizes with `looks.json`, and the bench page. It uses capture
port 5189 under the shared capture lock.

### Contract notes for main

- The bust's torso is 6 cells wide with 1-cell arms just outside it, narrower than the head as in the
  reference. Today's `AVATAR_RIG` puts the shoulders at x ±5, which fits an 8-wide torso. The full body is
  AS05; any rig proposal goes to `work/lanes/avatar-style/contract-proposal.md` then.
- The kingdom renderer registers voxel materials by id. Citizens need per-instance colours: either per-vertex
  colour (as `citizenObject` does) or a per-citizen palette texture. Main decides when it wires the character.
- `@chatdom/content` does not export `./avatar-style` yet. The web imports it by relative path, as the AS01
  study did.

---

# Avatar style study (AS01, superseded)

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
