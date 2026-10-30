# Reference: organic towns

- [Watabou TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) · GPL-3.0 · studied at `7fbc87a9398cc508af24de93f79cf2ad027f352b`
- [probabletrain MapGenerator](https://github.com/ProbableTrain/MapGenerator) · LGPL-3.0-only · studied at `f487e4cee321d105d5b0e14258363fa8b4d004ef`

For: kingdom settlement layout and incremental street growth.

## What they are

TownGeneratorOS makes a medieval town from connected polygon patches and a central place. MapGenerator combines local directional fields into roads and treats water as a spatial constraint. Both are useful structural references for streets that respond to a place rather than forming an arbitrary grid.

## What we take

- Generate connected candidate patches around a centre; selectively relax the centre and designate a central patch as plaza. TownGeneratorOS seeds and relaxes Voronoi regions, then chooses the first patch as a possible plaza (`Source/com/watabou/towngenerator/building/Model.hx:99`, `:108`, `:123`). Its model builds patches and topology before streets and wards (`Model.hx:91`).
- Route important streets through patch topology between meaningful destinations. The reference connects gates to a plaza corner or central junction, then tidies and smooths arteries (`Model.hx:211`, `:221`, `:251`). Smoothing is a presentation or proposal step that must still respect legal routes and existing geometry.
- Use blended local directional fields as a candidate generator, with water treated as an exclusion rather than a decorative overlay. MapGenerator combines weighted basis tensors and optionally rotates the result with noise; samples in sea or river return a degenerate field (`src/ts/impl/tensor_field.ts:85`, `:96`, `:119`). Its water generator derives river banks and road candidates from a water streamline (`src/ts/impl/water_generator.ts:92`, `:114`). Streamlines integrate the field into roads (`src/ts/impl/streamlines.ts:31`).
- Extend this idea with terrain contours and slope costs in our own layout: steer routes along usable grades and permit water crossings only at explicitly validated bridges or fords. Contour constraints are a Chatdom proposal, not a claim that these references implement terrain-aware roads.

## What we do differently

The plaza, castle, gate and tenure quarters serve a persistent community. Street and lot generation must grow locally around committed streets and homes, preserve immutable citizen addresses and player-built geometry, and never globally regenerate a settled town. Validate connectivity, slopes, clearance, water crossings and home access before committing a proposal; deterministic inputs and persisted decisions make replay possible. A hamlet and a capital both need readable, walkable neighbourhoods. Terrain and channel identity should guide their forms, within Chatdom's voxel art direction.

## Leave behind

Do not import either generator, copy its look, rely on a whole-map regeneration, or assume an unconstrained 2D map is a buildable voxel town. No implementation was run or benchmarked in this study.

## License

Both are copyleft: ideas only, implemented independently under the project's license policy. No code or assets were copied. If this decision changes, review licensing before adaptation and record the source and applicable obligations; assets require separate review.
