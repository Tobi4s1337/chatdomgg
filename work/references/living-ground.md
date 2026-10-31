# Reference: ez-tree

[Daniel Greenheck's ez-tree](https://github.com/dgreenheck/ez-tree) · MIT · studied at `dcf309bd86bd521083d9c70f01f2de45fdc7c457`

For: coherent trees and vegetation detail in the voxel kingdom.

## What it is

ez-tree grows a seeded branching skeleton, then meshes it into trees with independently adjustable detail levels. Its separation of growth from representation is useful for retaining the identity of a tree as its representation changes.

## What we take

- Grow the trunk and queued branches once from a seed, recording branch sections and leaf placements; repeated meshing consumes no random numbers (`src/lib/tree.js:241`, `:253`, `:268`, `:274`). This makes each detail level a representation of the same tree, not a new random silhouette.
- Shape branching by level, using length, radius, taper, child count and angle as related controls (`src/lib/options.js:38`, `:50`, `:71`, `:103`, `:110`). Child origins interpolate along parent sections, and child orientation and size derive from that parent (`src/lib/tree.js:468`, `:479`, `:496`, `:522`). This is a basis for a coherent silhouette rather than a uniform noise cloud.
- Derive levels from the same skeleton and retain branch endpoints and junctions as detail decreases (`src/lib/tree.js:139`, `:279`, `:769`). The reference's example levels use different section and leaf strides with hysteresis (`src/lib/tree.js:106`); those distances and ratios are demo choices, not Chatdom budgets.
- Wind should have a fixed attachment and coherent motion. The reference leaf shader multiplies layered sine sway by leaf UV height (`src/lib/tree.js:1051`), anchoring one edge of each leaf card; this is not a whole-tree root-anchor solution. Preserve a tree's trunk base and connected branch/canopy attachments when designing voxel motion; test shadows and collision against the chosen animation.

## What we do differently

Chatdom's outdoors are voxels. Build foliage as designed voxel masses with legible crowns and branches, not the reference's textured leaf quads and billboards (`src/lib/tree.js:649`, `:724`). Derive simplified voxel forms from shared structural data while preserving recognisable silhouette, base and attachments; avoid gaps or popping at transitions. Keep motion restrained and rooted, with device-specific detail chosen by measurement. Trees must suit each kingdom's palette and terrain and leave paths and homes usable.

## Leave behind

No leaf-card rendering, preset appearance, textures, models or demo assets are reused. This is source review only: the reference was not run and no performance claim or device budget is established.

## License

The code is MIT, copyright 2024 Daniel Greenheck. No code or assets were copied for this note. If code is adapted later, retain the required copyright and permission notice, add a source/license header and credit the adaptation in `THIRD_PARTY.md`; check each asset's separate license before any use.
