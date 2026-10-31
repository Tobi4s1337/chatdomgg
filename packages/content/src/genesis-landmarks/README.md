# Genesis landmarks

Spec 40. Authored focal landmarks for the three Genesis landscapes, and the local adapter that turns a frozen
`@chatdom/world/genesis` recipe plus its **selected** landscape into content proposals. Nothing here is placed,
grounded, adopted or exported from the package; main owns those. All units are 0.125 m build cells, half-open, with
y = 0 the ground datum and +Z the piece's front (its door).

## Adapter

`proposeGenesisLandmarks(recipe, landscape)` takes a `DeepReadonly<ChannelKingdomRecipe>` and one of its own
`landscapes` (refused if it is another recipe's or altered) and returns `GenesisLandmarkProposal[]`, byte-identical
for identical input. It never falls back to `recommendedLandscapeId`.

- **Two inputs, kept apart.** `landscape.character` picks the showcase (`coastal-harbour` → `harbour-watchtower`,
  `river-valley` → `river-hall`; `mountain-pass` still throws until its landmark is authored).
  `recipe.identity.landmark` is passed through unchanged as `recipeLandmark` and only shapes a detail: on the tower,
  `lighthouse` glazes the loft into a lamp room; on the river hall, `watermill` adds a turning wheel. No enum is added
  and the recipe is not rewritten.
- **Turn.** `quarterTurns` turns the piece about its local origin (turn 1 maps local +Z to world +X, the same mapping
  as the landscape's `point()` and `turnBox`). The door faces away from `coast.oceanToward`, towards the settlement.
- **Site.** For the tower, `site.axis` is a candidate for its axis in world metres: on the gate's line out to the
  authored shoreline, `setback` (14 m) inland of it. For the river hall, it is the point of the `river` stream's
  centre line nearest the plaza, with the stream's level, bed and width interpolated there; the door faces the
  plaza's bank, `elevation` puts the piece's y = 0 so its water line lands on the river's level, and `skew` is the
  angle between the flow and the arches. `site.origin` is the matching local origin. `status: 'unvalidated'`: this
  is not sampled ground, not a graded pad and not a valid placement. `checks` lists what main must prove.
- **Palette.** `identity.profileColourTargets` snap to the nearest registered cloth swatch (`CLOTH_SWATCHES`, a
  weighted RGB distance). The first target is the field of the crest and flag; the next target that snaps to a
  different cloth is the flag's band. Without targets the kit's own field and cream are used and `target` is null.
- **Heraldry.** The crest over the door draws `identity.crest.shape` and `.charge`; the flag is cut by
  `identity.banner.cut`. They are abstract grids (`heraldry.ts`), never a channel emote, badge or logo.
- **Provenance.** A simulated recipe yields `{ evidence: 'simulated', label: 'SIMULATED' }`, to be shown wherever
  the proposal is.

## Harbour watchtower

`createHarbourWatchtower({ style, crown, crest, bannerCut, colours })` returns a `LandmarkPiece`: a strict civic
`VoxelBlueprint` (`[96, 240, 96]`, 12 × 30 × 12 m, axis at x 48, z 44) and its metadata. Every kit (Hearth, Tide,
Grove) and both crowns are authored; Tide is the coastal recipe's kit.

From the ground up: a boulder skirt half sunk round the sides and seaward back; a dark battered plinth (footing, three
set-back courses, pale cap) with weathered blocks and weed; a chamfered stone shaft with two pale string courses,
above which it changes to render held by long-and-short quoins; nine arrow slits staggered up the faces into a hollow
shaft; three tiers of corbels under an overhanging gallery with crenellated parapet; the watch loft, its four arches
showing the beacon (a bright bowl of coals and embers on a pedestal) or, in a lamp room, glazing and a lens; bell-cast
eaves, a steep octagonal spire with four dormers, a bright finial and the flagpole. At the foot: a hooded porch with a
pale arch ring, a deep reveal and a studded timber door; two caged lanterns; the kingdom's crest framed above; three
steps to the quay; a bench, two bollards with rope, creels and a crate, a coil of rope, and a ship's anchor against the
plinth. A cargo hoist is swung out from a crenel on a raking brace, its rope hanging from a pulley.

| Plane | Cells |
|---|---|
| Plinth footing | octagon half 30 about (48, 44), y 0..4, `embed: 0` |
| Door reveal (open) | x 42..54, y 3..23, z 68..76, arched head to y 27 |
| Door leaf (closed, timber) | x 42..54, y 3..27, z 66..67; ironwork stands at z 67 |
| Threshold | y 3 |
| Approach | along z 68..102, across x 42..54; tops 3 to z 79, then 2, 1, 0; z 96..102 is host ground at `groundAt` 0 |
| Door clearance | x 42..54, y 3..23, z 68..102 must be air after placement |
| Steps | tops 3 / 2 / 1 over z 76..79 / 79..83 / 83..87, widening to x 34..62 |
| Bench seat | x 22..34, y 3..4, z 76..80, facing south |
| Lanterns (glass centres) | (37.5, 25.5, 79), (59.5, 25.5, 79) |
| Beacon | heart (48, 170, 44) on its embers; lamp room lens centre (48, 170.5, 44) |
| Flag hoist | (48, 226, 44), axis +Y |

**Parts.** The flag is its own `prop` blueprint (`[22, 13, 2]`, cloth from the hoist at x 0, folds dropped back to
z 0) in `piece.parts`, hung on the `flag-hoist` mount. At rest its origin sits at tower cell (49, 226, 43) and its
pivot is part cell (−1, 0, 1). A host turns it about +Y through the hoist; one that does not animate it mounts it at
rest. The swing volume (`flag-swing`) is clear of everything but the pole.

**Footings.** `plinth` and `steps` bear at y = 0 with no embed. `boulders` may sink up to four cells into rising
ground round the sides and back. The door approach expects ground at y = 0 beyond the bottom step.

**Anchors for the host.** Emitters (`beacon`, two `door-lantern-*`) are physical glass or fire; content never lights
them. Sounds: `beacon-fire`, `flag`, `rope-creak`, `surf`. Clear volumes: the doorway, its approach, four lookouts
(only the reveal outside a lamp room's glass), the flag swing and the beacon flame.

**Affordances**, all `status: 'needs-host'`: `enter` (a door action and an interior; the leaf stays closed), `sit`
(seat registration from the bench edge), `tend-beacon` (light driven by real presence), `look-out` (a climb or a
camera to the loft; the piece has no stair). None is performed or faked here.

## River hall

`createRiverHall({ style, wheel, crest, bannerCut, colours })` returns a `LandmarkPiece`: a strict civic blueprint
(`[112, 200, 256]`, 14 × 25 × 32 m, axis at x 56, z 116) spanning a river. The span runs along Z and the river flows
along X under three stone arches; **y = 0 is the river bed**, the water line is y 14 and both banks are y 32. Every
kit is authored; Hearth is the river recipe's kit.

The picture: a jettied gallery on corbels carried over the arches, between two tall crow-stepped pavilions, one on
each bank. The town pavilion (+Z) carries the door, the crest, two forked banners, the rose window, the bell cote and
the flag, with seven steps down to the bank; the far pavilion is closed, with its own windows and rose. At night it
reads as a marquee: a caged lantern at every gallery pilaster and under every arch crown, doubled in the water, and
eight tall glazed bays per side.

**The Retro category as a visual cue only** (spec 40: no game IP, no sprites, no characters): the gallery is eight
identical 2 m bays like a row of tiles, each window with a stepped (pixel) head; a two-colour checker frieze runs
under the eaves; the gallery roof is a lozenge diaper on a coarse 4-row × 8-cell grid; the gables climb in square
crow steps; the voussoirs alternate pale and grey; and the lanterns sit on the same even rhythm.

| Plane | Cells |
|---|---|
| Water line / banks / hall floor | y 14 / y 32 / y 40 |
| Arches (clear span, radius) | far z 52..82 r 15 · middle z 96..136 r 20 · near z 150..180 r 15, springing at y 14 |
| Piers | z 82..96 and 136..150, cutwaters 14 cells out from both faces |
| Gallery | x 24..88, y 40..84, z 52..180; bays of 16, windows 8 wide, sill 50, head 70 |
| Pavilions | x 20..92; far z 4..52, near z 180..228; walls to y 112, gable apex y 157 |
| Door reveal (open) | x 50..62, y 40..60, z 224..230, stepped head to y 64 |
| Door leaf (closed, timber) | x 50..62, y 40..64, z 221..223 |
| Approach | along z 224..262, across x 50..62; tops 40, then 39..33 down the steps, then the bank at `groundAt` 32 |
| Bench seat | x 24..38, y 35..36, z 248..252, facing south |
| Bell / headstock | bell (56, 164, 225); headstock y 171, axis +X |
| Flag hoist | (56, 185, 225), axis +Y |
| Wheel (watermill only) | centre (98, 24, 67), radius 12, axis +Z, on a trestle at z 57..59 and 75..77 |

**Parts.** The flag (`parts.ts`, shared with the tower) hangs on `flag-hoist`. A watermill kingdom's hall also has a
`wheel` part (`[24, 24, 20]`: two shrouded rims, eight spokes, sixteen paddles on an iron axle) mounted on
`mill-wheel`; its pivot is the axle centre and its sweep (`wheel-sweep`) dips below the water. That hall leaves out
the far arch's downstream lantern, where the wheel turns.

**Glazing.** `piece.glazing` lists every pane (`opening/index`) with its centre on the glass's outer face, width,
height and facing, in the same shape as a content window. A host lights the hall's windows from these (the bench
does it with the production window lights); content never lights them.

**Water.** `piece.water` gives the water line, the bank height and the channel under the deck. The footings are the
two abutments (embed to the bank) and the two piers (embed to the water line), plus the trestle posts with a wheel.
Each arch's `waterway` clear volume is the barrel and its ring's proud course, five cells in from the springings and
as high as the soffit allows; the arch lanterns hang just outside each mouth, 0.6 m over the water.

**Anchors for the host.** Emitters are lanterns only (22, or 21 with a wheel), all physical glass. Sounds: `river`,
`bell`, `flag`, and `mill-wheel` with a wheel. Clear volumes: the doorway, its approach, three waterways, the flag
swing, the bell swing and the wheel sweep. **Affordances**, all `needs-host`: `enter`, `sit`, and `ring-bell` (a real
civic moment swings the bell on its headstock; content never rings it).

## Checks

`harbour-watchtower/tower.test.ts` runs on the production rasterizer and mesher: strict schema and determinism for
3 kits × 2 crowns, kit palette, ground support for every occupied cell, lane-home budgets (2,000 boxes, 1,000,000
occupied cells, 250,000 triangles), measured extent, the flat plinth, the clear reveal and closed leaf, the solid
sill, a one-cell-rise approach with 2 m head room, every clear volume, lanterns round real glass, the beacon on its
embers under open air, the four open (or glazed) lookouts, every slit cut through, the crest's sunk field and proud
charge, the flag part's hoist, support from its hoist column, band and notch, the bench and hoist rope, and that
affordances name real anchors. `river-hall/hall.test.ts` does the same for 3 kits × with and without the wheel, and
adds: arches open from the bed with alternating voussoirs, every waterway empty, piers and abutments on the bed with
pointed cutwaters, the water metadata, every glazing pane on real glass, the bell hanging from its headstock and
alone in its swing, and the wheel part held from its axle, resting in the trestle's saddles and inside its sweep.
`adapter.test.ts` checks the real coastal and river showcase recipes end to end.

## Bench

`bench/` is a lane-local, dev-served review page, visibly labelled SIMULATED. It draws the adapter's proposal for The_AGGman's
coastal candidate on an authored headland through the production mesher, clay and terrain materials, near and beacon
light fields, sun shadows, atmosphere, water surface and post stack, with existing water-place boats and shore
pieces for scale and five of the water lane's lantern floats drifting on the basin. The lanterns, a full kingdom's
beacon, embers, smoke, the floats, the boat's bob and the flag's wave are simulated host behaviour. The town
beacon's sky column is deliberately not drawn: this fire burns in a roofed loft, and the column would stand through
the spire and wash out the flag. It is not integration: it proves neither the landscape's ground, the site nor the
turn.

```sh
node packages/content/src/genesis-landmarks/bench/capture.mjs --sizes 1920x1080
node packages/content/src/genesis-landmarks/bench/capture.mjs --scene river --sizes 1920x1080
```

`--scene river` draws PinkKittyRose's river-valley proposal over an authored river with a shingle town bank, the
water lane's river surface fed from the bench's own stream, a rowing boat, reeds, trees, lantern floats, chimney
smoke and the hall's windows lit through the production window lights. Window presence in that shot is a
SIMULATED frame.

`--hour` and `--time` pick the light and the moment (defaults 20.4 and 42); `--query k=v` passes extra page
parameters and tags the file name. Shots land in `shots/genesis-landmarks/` as `<scene>-<hour>@<size>.png`.

`showcase-fixtures.ts` (tests and bench only) compiles the observed spec-39 facts with each channel's captured public
profile palette from `apps/web/src/genesis/channels.ts`.
