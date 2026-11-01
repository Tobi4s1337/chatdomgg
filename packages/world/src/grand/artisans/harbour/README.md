# Harbour dressing

`createShip(seedKey)`, `createLighthouse(seedKey)` and `createHarbour(seedKey)` return
`ArtisanKit` boxes in the grand terrain lattice (integer half-metre cells). The harbour
uses `y = 0` for still water and points `+z` inland: its `shoreJoin` anchor should be
matched to a graded shore, and the quay's cap is 4.5 m above the water. The boat's
`waterline` anchor is its independent translation point, with its long axis along X.
The headland tower's `foundation` must be seated into real terrain or masonry. The
quay foot and timber piles extend below sea level, and the landing descends to the tide.

The kit is presentation geometry only. Its boxes and named anchors do not provide
collision, traversability, real foundations, light, or a water simulation. Select a
sheltered and deep-enough harbour from the canonical coast/water field before placing
it; reconcile the quay and headland with the physical producer. Avoid painting the
lantern as an occupied citizen window. Both vessels use derived feature seeds so
changing another land feature does not shift their accents.

The palette expresses warm limestone, indigo roof, timber, brass and off-white sail.
The sparse boxes include overlapping courses for visual layering; a voxel assembler
should apply them in array order so later detail wins, then mesh the resulting cells.
