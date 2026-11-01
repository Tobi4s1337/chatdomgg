# Grand fields and mill

`createFields(seedKey)` creates a 108 × 108 terrain-cell field vignette (54 × 54 metres),
four crop parcels, a cross lane and low hedges with open gates. `fieldLayout(seedKey)`
exposes half-open plots, crop kind, row direction and lane width for a land producer to
fit the parcel grammar to *its own* dry and gently graded sites. `createFieldPlot(plot)`
stamps one caller-supplied rectangle and does not cover or flatten land outside it. `createWindmill(seedKey)`
returns the mill centered on its base with its front and sails facing +Z. Its hub is at
`sailHub`, and its doorway at `door`. All coordinates use 0.5 m cells, +Y up.

The kits are visual source material: they have no collision, approved water/ground,
wayfinding, inhabitant or window-presence authority. In an installed kingdom the builder
must grade and preserve real settlement support, check every field against water, roads,
lots and slopes, and mount the mill only on supported ground. The fixed pose of the four
sails is not an animation; `createWindmillParts(seedKey)` supplies the tower and blade
groups separately so a renderer can rotate the latter about `sailHub`. The simple plot preview is flat and cannot certify site suitability.

The box palette is authored clay rather than the shared home material registry; the grand
producer must map colours to its own palette and mesh unions before installation.
