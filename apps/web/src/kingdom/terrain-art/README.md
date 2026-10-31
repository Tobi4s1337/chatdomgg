# Picture land: fixture (spec 46)

This is a fixture, not the kingdom. It draws the pinned founded geography (seed `simulated-founded-town`,
revision `settlement:2:23b3c1b5`, 240 homes, v1 landform) on an explicit candidate land stand-in. It uses the
real homes, castle, market, window lights, light fields, sky, sun shadows and post stack. Presence is the
labelled SIMULATED scenario. The fixture shows what the land looks like. It does not make the candidate
authoritative, and the kingdom scene, collision, light-field occupancy and founded revisions are unchanged.

## Files

- `stand-in.ts`: `createLandCandidate({ plan, bounds, ground, publicGround })`. Pass it the immutable plan,
  explicit bounds and the caller's authoritative ground and public-ground queries. It returns:
  - `height(x, z)`: interpolates over the accepted 00→11 one-metre triangles.
  - `corner(ix, iz)`: Float32 corner values.
  - `material(x, z)`: one local class per metre patch, derived from the same corners.
  - `protection(x, z)`: exposes the preservation rule so tests can check it.

  Corners within 1.5 m of public ground, a plot, the castle or the lake bank return the authoritative ground
  exactly. Beyond them, the land eases into ledged terraces over 9 m. Outside the town footprint it rises into
  three layered cuesta ridges with a saddle behind the keep, plus flanking highland. PL02 replaces this
  stand-in with the bounded producer in `packages/world/src/terrain-art`.
- `land-mesh.ts`: the draw adapter. Every vertex is a candidate corner on the same diagonal, with no shader
  height displacement. The town and the first ridge use 1 m patches. The coarser ring is 4 m and has a hidden
  skirt where the two meet. Its material is a copy of the kingdom terrain shader with faceted normals and
  soft strata on rock only (near the camera). Lighting, fog, shadows and light fields are untouched. Rock,
  scree, ledge lip and heath use fixture palette ids 240–243 because content has no swatch for them yet.
- `fixture.ts`, `fixture.html`, `fixture-main.ts`: the scene. These are dev-server only and not an app route.
- `capture.mjs`: takes stills under the shared capture lock on a free capture port between 5176 and 5186.

## Run

```sh
node apps/web/src/kingdom/terrain-art/capture.mjs --shot 'street=view=street' \
  --shot 'street-accepted=view=street&land=accepted' --shot 'overview=view=overview'
# → shots/terrain-art/<name>@1920x1080.png   (also: hour=, eye=x,y,z, target=x,y,z, fov=)
```

In a browser with `pnpm --filter @chatdom/web dev`, open `/src/kingdom/terrain-art/fixture.html?view=street`.

## Seam for main

To adopt the land, the same corner query has to become the rendered terrain, the horizon, the light-field
occupancy and collision/contact in one validated revision. Today those read `terrainHeight(plan)` /
`settlementTerrainHeight`. The founded v1 scene stays pinned until main adopts the revision, and only main
does that.
