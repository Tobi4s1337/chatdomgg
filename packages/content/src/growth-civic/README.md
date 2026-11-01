# Civic growth forms

These are local build-cell blueprints, not world authority. `createGrowthCivicForm` preserves the supplied
level in the ID; levels above four deliberately keep the level-four form. +Y is up, +Z is the public face.
`growthCivicLights` returns public light centres, **not** citizen presence windows. `growthCivicWater` returns
the court basin or smith's trough surface; the host must supply the water rendering. Both share the form's local coordinates.

The market and court are ground-based additions and need an unoccupied 8 × 4 m footprint. The forge additions wrap the existing `createForgeHearth` at `FORGE_EXTENSION_HEARTH_OFFSET`; the old hearth and dragon stay intact. Coordinate the existing flame with the supplied light anchor so the host does not double it. The tavern
is a freestanding, hollow 8 × 4 m annex, with its door on +Z; the host needs to reserve that footprint and join
it to the actual tavern without hiding an existing entrance or roof. It must not overlay an existing building.
The bridge form instead follows the 144-cell humpback bridge: its origin is the bridge's bed origin and its
fourth argument supplies that site's water and bank heights in build cells. The caller must supply the actual site; the SIMULATED review uses water 6, bank 14. It is not compatible with the smaller 64-cell footbridge without a
separate placement. The host must check path clearance and anchor availability; no claim is made that these
fixtures are mounted in the founded kingdom.

The caller owns all rendering, lights, water, placement, replacement and disposal. Neither blueprint nor light
anchors change a room, grant progress or claim a light belongs to a person.
