# Growth homes

Street-readable growth lines for the Hearth homes. Each tier must be unmistakable from across the lane, in the
same light and at the same camera, while the address stays put: the entrance, the doorway, its step and the
hood on its brackets are the hut's cell for cell, and every earlier window keeps its id, anchor and order with a
clear view to the lot edge.

`createGrowthHome('emberfold', tier)` returns the shared, read-only blueprint; `buildGrowthHome` returns the
blueprint with its authored facts (entrance, rooms, exits, supports) for tests. The hut is the family's existing
hut, `home-hearth-emberfold-hut`, so an installed hut never changes. Every grown tier carries a `-v2` id
(`home-hearth-emberfold-cottage-v2` …): it is a new revision, published to a home when its growth is
witnessed, never swapped under an installed one. The native host selection and the original families in
`homes/hearth` are untouched.

| Tier | What the lane sees |
|---|---|
| hut | the family hut: one storey under a steep gable, the hooded door, the west stack |
| cottage | a full close-studded storey jettied over the east path, a gable half again as high with an attic light and finial, a lean-to garden aisle, the stack raised, a picket fence, beds, a climbing rose and a kitchen garden behind |
| house | a third storey and the tallest gable on the street, a second row of panes and a gable light, a two-storey kitchen range behind with its own stack |
| manor | a broad cross range across the back, stone below and close-studded above, its ridge and gable ends standing out either side; a west gable-end stack; a coped limestone wall with gate piers and clipped yew in place of the fence |
| hall | a stair tower on the street's east corner with a louvred belfry, a tiled spire and a lantern; a chamber wing to the garden with a hooded garden door |

`growth-homes.test.ts` holds the line to the Hearth home contract (kit, budgets, locked rear, connectivity,
walkable rooms, weather-tightness, glass and outward views) and to street readability: from straight on or from
either corner of the lane at 45°, every tier shows at least a fifth more house or a skyline at least three
metres higher, a silhouette that no longer matches, and never less than before. The cottage stands at least
2.5 m taller than the hut with at least twice its street panes.

Not yet wired by this folder: a `./growth-homes` export in `packages/content/package.json`, catalogue entries,
and version-aware publication of these revisions to installed homes. Those belong to the content and realm
owners.
