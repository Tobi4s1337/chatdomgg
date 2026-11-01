# Harbour dressing

`createQuay(seedKey)`, `createShip(seedKey)`, `createLighthouse(seedKey)` and `createHarbour(seedKey)` return
`ArtisanKit` boxes in the grand terrain lattice (integer half-metre cells). The harbour
uses `y = 0` for still water, `-z` out to sea and `+z` inland. The standalone quay's
half-open box bounds are x `[-61,63)`, y `[-5,12)`, z `[-32,23)`. Its stone shore
mass occupies x `[-60,61)`, z `[3,21)`, y `[-5,6)`; the cap projects inland to z=23.
Its `shoreJoin` anchor `[0,6,21]` meets a graded shore at the mass's inland edge,
but is a structural join, not a walking surface. The full quay surface at its
`quayTop` anchor `[0,8,10]` is 4 m above water; its seaward trim reaches 4.5 m.
Both piles and the shore mass reach
y=-5, while the breakwater begins at y=-4. The builder must fit those feet against
the actual bed; a visual overlap is not evidence of physical support. The boat's
`waterline` anchor is its independent translation point, with its long axis along X.
The headland tower's `foundation` must be seated into real terrain or masonry. The
quay foot and timber piles extend below sea level, and the landing descends to the tide.
`createHarbour` combines all three purely for the original review view; fitting an
entire precomposed assembly to a natural shore is not assumed to work.

`createQuaySection(seedKey, kind, shoreOffset)` provides separately fitted 16-cell
frontage pieces: `kind` is `frontage`, `pier`, or `landing`; `shoreOffset` is one of
`-4`, `-2`, `0`, `2`, `4` cells and defaults to zero. At offset zero, the half-open
bounds are x `[-8,8)`, y `[-5,12)`; z is `[1,23)` for frontage, `[-32,23)` for a
pier and `[-8,23)` for a landing. The stone core reaches y=-5 under x `[-8,8)`,
z `[3,21)`; the pier's timber piles also reach y=-5. The consumer must extend
these columns to real seabed/ground and test every part of the deck against terrain.

The section's `shore-left` and `shore-right` anchors are boundary joins; at zero
offset they are `[-8,6,21]` and `[8,6,21]`. The next section's origin sits 16 cells
along x. At a nonzero offset, add that offset to the next origin's z. Each current
column x in `[-8,8)` shifts its z by `round((x+8)/15*shoreOffset)`, so backjoin
cells z=21 and z=22 must be tested after that shift. Its cap is face-connected
across the change and still ends at y=9; `deck`, `seaward`, `pier` and `landing`
anchors identify the usable-looking surfaces without granting interaction. A run
can combine frontage, piers and landings while following a measured coast; reject a
section when its join, foundations, deck clearance or protected-area check fails.
The existing whole `createQuay` and `createHarbour` retain their original ordered
geometry for comparisons.

`createQuayInlandStairs(treadHeights, ground, apronGround, shoreOffset)` joins a quay to a dry
bank. Coordinates use the same local frame: width x `[-3,3)`, first tread at z=23,
two z cells per tread, and two further rows of apron. Heights are integer surface
tops relative to sea. The first tread must match the installed cap (8 on the full
quay, 9 on a section); subsequent heights never rise and descend by at most one
cell each. The `ground` array is actual sampled top height in z-major then x-major
order, 12 numbers per tread. `apronGround` contains 12 sampled heights for the next
two z rows. Each sample must be dry and at or below the tread; both last tread
rows and apron must equal the final height. The fitter checks actual water, all
footprint clearance, protection, and shared edge contact before accepting this
visual geometry; it does not establish a physical route. Supports rise from sampled
ground, while flush paving replaces only existing surface cells; ordered voxel
assembly must permit that material replacement. `quay`, `land`, and `apron-end`
anchors give surface heights and endpoints; the end of apron is z=`25+2*n`.
For a section with a nonzero shore offset, pass the same offset as the fourth
argument and keep the same origin. In each x column sample at z
`23+row+round((x+8)/15*shoreOffset)`; the stair follows the whole join edge instead
of only its centre. Rotate both the samples and the resulting kit with the section.

The kit is presentation geometry only. Its boxes and named anchors do not provide
collision, traversability, real foundations, light, or a water simulation. Select a
sheltered and deep-enough harbour from the canonical coast/water field before placing
it; reconcile the quay and headland with the physical producer. Avoid painting the
lantern as an occupied citizen window. Both vessels use derived feature seeds so
changing another land feature does not shift their accents.

The palette expresses warm limestone, indigo roof, timber, brass and off-white sail.
The sparse boxes include overlapping courses for visual layering; a voxel assembler
should apply them in array order so later detail wins, then mesh the resulting cells.
