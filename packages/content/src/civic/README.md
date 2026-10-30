# Civic props

The civic furniture of the market and castle (spec 10): ten forms, each in the Hearth and Tide kits. All units
below are 0.125 m build cells, half-open, with y=0 the ground datum and +Z the model's front.

## Integration

`index.ts` exports:

- `CIVIC_FORMS`: the ten forms in collection order.
- `CIVIC_MANIFEST`: one row per form with its exact allocated size and the per-asset ceilings (1,024 source
  boxes, 120,000 occupied cells, 120,000 meshed triangles, one model draw).
- `createCivicProp(form, style)`: a pure, deterministic factory for `civic-<style>-<form>`. It throws on unknown
  forms and kits, and on forms that are not built yet. No form has stand-in geometry.
- `BLUEPRINTS`: the finished models only, Hearth then Tide, in form order.
- `FOOTBRIDGE`, `footbridgeDeckTop` and `GATEWAY`: the measured planes below, for main's placement checks.
- `GIFT_CART` and `MARKET_STORES`: the running gear, bed and part boxes of the market furniture below.
- `BANNER_STANDARD`, `CREST_PLINTH`, `BANNER_ARMS` and `CREST_ARMS`: the heraldry planes below and the arms grids
  they carry.

Every model is `kind: 'civic'`, `lattice: 'build'`, `version: 1`, with no windows. Structure resolves through the
kit's own wall, roof, trim and stone (`kit.ts`, `CIVIC_KITS`). Each kit also fixes a heavy base course, a band
stone for voussoirs, a cord (Hearth a timber rail, Tide a thatch rope) and the shield's field, charge and border.

| Kit | Stone / base | Band | Roof | Shield |
|---|---|---|---|---|
| Hearth | limestone / limestone | cream | terracotta | cloth field, cream charge, brass border |
| Tide | stone / darkStone | cream | slate | slate field, cream charge, brass border |

To place a model, turn it by positive-Y quarter turns about its local origin, then translate by whole cells.
A quarter turn maps the cell `(x, z)` to `(z, −x−1)`. Placement, traversal, collision and any behaviour stay
with main; nothing here claims them.

## The civic arms

The kingdom's base arms are a broad chevron (one roof) over a lozenge (the light kept under it), on a field inside
a one-cell border. They are original and abstract, and assert no channel, emote, rank or purchase. `blazon()` in
`kit.ts` draws them at any size into a given outline, so the gateway keystone, the banner and the crest always
carry the same arms. The border follows the outline through its diagonals, so a tapering edge stays one line.

| Grid | Size (cells) | Outline | Chevron apex / depth | Lozenge centre row, half width × half height |
|---|---|---|---|---|
| `CIVIC_SHIELD` (gateway) | 12 × 14 | heater, 7 straight rows | row 2 / 2 | 10, 2 × 2.2 |
| `CREST_ARMS` | 16 × 18 | heater, 8 straight rows | row 2 / 3 | 12.5, 3 × 3.5 |
| `BANNER_ARMS` | 14 × 34 | swallowtail, 12-row notch | row 3 / 3 | 15.5, 3 × 5 |

`shield()` lays a grid into a masonry face: the field is flush with the face and recolours it, while the border and
charge stand one cell proud. Anything already proud in front of the field (a ring stone, a beam) is cut back, so the
arms always read as inset. The first arms (a lozenge over the chevron) read as a small figure at a distance; turning
them over put the broad roof shape on top and fixed that.

## Footbridge

`civic-<kit>-footbridge`, 64 × 24 × 32, long axis X. Occupied bounds: x 0..64, y 0..20, z 0..32.

- **Walk strip:** z 5..27 (22 cells, 2.75 m), continuous from x=0 to x=64. Nothing occupies the strip above the
  walking surface, up to the top of the bounds.
- **Walking surface:** `footbridgeDeckTop(x)` gives the top of the tread over each column. Landings are the flat
  runs x 0..4 and x 60..64 at y=1 (a one-cell stone threshold). Treads are four cells long and rise one cell
  each: y 2 and 3 in stone (x 4..12), then timber, y 4 to 7 (x 12..28), to an eight-cell crown at y=8
  (x 28..36), and back down symmetrically.
- **Open span:** between x 14 and x 50 nothing touches the ground across the whole width. Under the crown the
  strip is clear from y=0 to the underside of the planks at y=6.
- **Structure:** stone abutments (threshold, two treads, a bearing seat at x 12..14 and its mirror) carry two
  arched timber side beams (z 1..3 and 29..31) that stand one cell proud of the planks as a kerb. Two-cell planks
  run across the walk, every third a darker bark board. Four tall piers (x 10..14, z 0..5 / 27..32) take
  paired hand rails on posts at x 22, 31 and 40 (z 3..5 and 27..29). The top rail follows the hump nine cells
  above the side beams. Hearth has a straight lower rail; Tide slings a rope that sags between each pair of
  supports. Low wing walls with a coping run from the end stones at the threshold to the piers.

## Ceremonial gateway

`civic-<kit>-ceremonial-gateway`, 48 × 64 × 16, passage along Z. Occupied bounds: x 0..48, y 0..64, z 0..16.

- **Passage:** the whole box x 12..36, y 0..32, z 0..16 (3 m wide, 4 m high) is air. The arch soffit springs
  from y=32 at the passage edges and crests at y=40 over x 22..26.
- **Feet:** two full plinths on the ground (x 0..12 and x 36..48, z 0..16). Each carries a chamfered shaft that
  sets back one cell at a weathering course (y 17), and an impost block (y 28..31).
- **Arch and roof:** one stone body (y 32..48) with a proud ring of seven alternating voussoirs, a beam on
  brackets (y 48..50), a framed frieze (y 50..54), an eight-course roof (y 54..62) with rendered gables, and a
  ridge (y 62..64).
- **Heraldry:** the civic shield is the keystone on both faces, x 18..30, y 40..54. The field is on the face
  layer (z=2 at the front, z=13 at the back), and the border and charge stand at z=1 and z=14. It breaks the
  beam above it.
- The gateway is always open. It has no door, lever or other implied action.

## Banner standard

`civic-<kit>-banner-standard`, 16 × 64 × 16, cloth facing +Z. Occupied bounds: x 0..16, y 0..64, z 1..15.

- **Socket:** a faceted footing (x 1..15, z 1..15, y 0..2), a stone block in two courses (x 3..13, y 2..6, a shadow
  joint at y 4) and an oversailing weathered cap (y 6..7). An iron-dark collar (x 6..10, z 6..10, y 7..9) wedges
  the pole.
- **Pole:** timber, x 7..9, z 7..9, y 7..61, one unbroken upright from the socket to the finial. The finial is the
  arms' lozenge in brass: 2, 4 and 2 cells wide at y 61, 62 and 63.
- **Crossbar:** x 0..16, y 56..58, z 7..9, through the pole, bound where they cross (x 6..10, y 55..59, z 6..9).
  Its brass-capped ends (x 0 and 15, y 55..59) carry a cord (y 46..55) and a tassel in the border colour
  (y 42..46).
- **Cloth:** `BANNER_ARMS`, 14 cells wide (x 1..15), 34 rows from y 57 down to the tips of its tails at y 24, and
  two cells thick (z 9..11), so the arms read through both faces. It hangs against the front of the pole and bar.
  Four tabs of the field loop over the bar at x 1, 4, 10 and 13. Below the head (the top three rows), columns
  x 3..6 and x 10..13 hang one cell forward (z 10..12) as two broad folds; the columns against the pole never
  leave it. The swallowtail notch rises twelve rows from the hem and leaves two tails three cells wide.
- **Clearance:** from the cap up to the tails (y 9..24) nothing stands at z 9 or beyond, so the cloth hangs three
  metres clear with only the pole under it.
- **Kits:** Hearth has a red cloth field, brass collar binding and cream cords. Tide has a slate field, a rope
  (thatch) lashing and rope cords. Both have a cream charge and brass border, like the gateway keystone.

## Crest plinth

`civic-<kit>-crest-plinth`, 24 × 40 × 16, arms on both faces (±Z). Occupied bounds: x 0..24, y 0..39, z 0..16.

- **Pedestal:** a faceted footing (x 0..24, z 0..16, y 0..2), a step (x 2..22, z 2..14, y 2..4) and a die
  (x 4..20, z 4..12, y 4..15) in three courses with shadow joints at y 8 and 12. Band-stone quoins alternate long
  and short faces course by course at the four corners. The cornice (y 15..17) oversails the die and drips at
  x 2..22, z 2..14. There is moss where the step meets the footing.
- **Seat:** a footing (x 6..18, z 4..12, y 17..18) and a block (x 8..16, z 5..11, y 18..19) on which the shield's
  point stands.
- **Shield:** `CREST_ARMS` on a heater 16 cells wide and 18 tall, at x 4..20, y 20..38. A stone slab (z 7..9)
  extends one cell beyond the arms all round, so its outline is x 3..21, y 19..39. On each face the rim and the
  arms' border and charge stand proud (z 6 and z 9), and the field is sunk on the face layer (z 7 and z 8). The
  shield narrows row by row to the point, which stands on the seat. Both flanks are free above the cornice.
- **Kits:** Hearth is limestone with cream quoins and a red field. Tide is grey stone on a dark base with cream
  quoins and a slate field.

## Gift cart

`civic-<kit>-gift-cart`, 32 × 32 × 24, long axis X, handle end at x 0, open front +Z. Occupied bounds: x 0..32,
y 0..32, z 0..24. A low two-wheeled handcart that brings gifts. It has no roof or awning, so it reads apart from
the core's striped stalls and roofed well beside it.

- **Running gear:** one axle at x 21, y 7 (x 20..22, y 6..8, z 3..21). Two wheels of radius 7 in the planes
  z 1..3 and z 21..23: a darkStone tyre, a timber felloe, eight two-cell spokes and a bark hub with a hoop-coloured
  cap (z 0..4 and 20..24). Each tyre stands on the ground at x 18..24, y 0. Above the hub (y ≥ 9), the cells at
  z 3 and z 20 are air, so the wheels turn clear of the boards.
- **Bed:** a level planked floor, x 8..32, y 8..10, z 5..19, carried by two bark bearers (y 7) on the axle and by
  two legs at x 9..11 (z 6..8 and 16..18, y 0..8) with a brace. Side boards (y 10..14) have one stripe at y 11
  and a timber top rail. Stakes stand one cell proud at x 8, 14, 26 and 30. The front board is low (y 10..12).
- **Handle:** two shafts (x 1..9, y 10..12, z 6..8 and 16..18) joined by a grip at x 0..2, y 10..12, z 4..20.
  The space below and above the grip is clear.
- **Tail:** boards one cell back (x 30..31) between rails at y 13 and 17, plus a centre batten and a stepped crest
  to y 20. A pole at x 30..32, z 4..6 rises to a brass knob at y 31. A swallowtail pennant in the kit's field
  flies over the load at z 5, x 22..30, y 23..30.
- **Load (floor top y 10):** a flared woven basket of domed loaves with a bowed handle (x 10..18, z 7..17, handle
  to y 21), a ribboned bundle with a bow (x 19..25, z 7..13), a smaller bundle (x 20..25, z 13..18), two
  crocks (x 26..30, z 7..15) and a tied bunch of flowers against the tail (x 26..30, z 14..17).
- **Kits:** Hearth uses timber boards with bark stakes, red cloth bundles with cream ribbon, terracotta crocks,
  cream loaves and petal flowers. Tide uses cream-painted boards with a slate stripe, hessian (thatch) bundles
  with slate ribbon, stoneware crocks, earth-brown loaves and blue flowers.

## Market stores

`civic-<kit>-market-stores`, 24 × 16 × 16. Occupied bounds: x 0..24, y 0..15, z 0..16. One composed stack that
steps down to the front. Every round thing is faceted (corners cut by one cell), and every heap is authored.

- **Cask:** stands at x 0..8, z 1..9, head at y 11. It has chimes six cells wide, an eight-cell octagonal belly
  (y 2..9) between two hoops at y 2 and 8, darker staves, and a head let in one cell below the chime.
- **Crates:** a closed crate at x 8..18, y 0..7, z 0..9, with shadow joints at y 2 and 5, darker corner posts,
  lid battens and a hand hole on the front. On it sits an open crate at x 9..17, y 7..12, z 1..8. Produce is
  heaped one to three cells over its rim (to y 14) from an authored height grid, with a few lighter tops and
  leaves. Below the rim the crate is packed wood, so its joints never open onto the goods.
- **Front:** a sack (x 1..8, z 9..16) slumped against the cask with a crease, a tied neck and a flopped top. A
  basket of loaves (x 9..17, z 10..16, handle to y 9). A keg on its side along Z (x 18..24, y 1..7, z 2..13) on
  two chocked cradles (z 4..6 and 9..11), with hoops at z 3 and 10 and a head recessed one cell at z 12.
- **Kits:** Hearth has apples (cloth with petal tops), a hessian (thatch) grain sack tied in bark, cream loaves
  and darkStone hoops. Tide has greens (leaf with moss hearts), a cream salt sack tied in slate, earth-brown
  loaves and brass hoops.

## Costs

Measured by `pnpm content:validate --collection civic-props --partial` through the production rasterizer and
mesher:

| Model | Boxes | Occupied cells | Triangles | Chunks |
|---|---|---|---|---|
| civic-hearth-footbridge | 304 | 7,324 | 6,762 | 2 |
| civic-hearth-ceremonial-gateway | 358 | 21,818 | 4,032 | 4 |
| civic-hearth-gift-cart | 201 | 3,218 | 4,422 | 1 |
| civic-hearth-banner-standard | 283 | 2,158 | 2,068 | 2 |
| civic-hearth-crest-plinth | 478 | 4,200 | 2,074 | 2 |
| civic-hearth-market-stores | 122 | 2,248 | 2,532 | 1 |
| civic-tide-footbridge | 304 | 7,272 | 6,782 | 2 |
| civic-tide-ceremonial-gateway | 358 | 21,818 | 4,276 | 4 |
| civic-tide-gift-cart | 201 | 3,218 | 4,396 | 1 |
| civic-tide-banner-standard | 283 | 2,158 | 2,068 | 2 |
| civic-tide-crest-plinth | 478 | 4,200 | 2,074 | 2 |
| civic-tide-market-stores | 122 | 2,248 | 2,500 | 1 |

Each model measured one draw in the production bench (`content:render`, `render-stats.json`).

`civic.test.ts` checks the manifest, factory and BLUEPRINTS order, refusals on bad input, the palette, grounded
occupancy and costs on the rasterized and meshed result. It also checks the bridge's strip, treads, landings,
open span and rails, and the gateway's passage, feet, soffit and inset shield on both faces. For the market
furniture it checks the tyre's ground contact, the open gaps between spokes, the wheels' clearance from the boards,
the level bed, the legs and the free grip on the cart. On the stores it checks the cask's cut belly corners and
bulge, the keg's cradles and let-in head, and produce heaped over a rim whose joints stay closed. For the heraldry it
checks the banner's unbroken upright, brass lozenge finial, crossbar, the arms read from both faces, the cloth
against the pole, the clear way under the cloth, and the swallowtail notch and tails. On the crest it checks the
carved arms on both faces with the field sunk behind them, the heater taper to a point on the seat, the free flanks,
and the die's courses and quoins.
