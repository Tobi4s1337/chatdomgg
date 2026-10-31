# Picture land: fixture (spec 46)

This is a fixture, not the kingdom. It draws the pinned founded geography (seed `simulated-founded-town`,
revision `settlement:2:23b3c1b5`, 240 homes, v1 landform) on the picture-land producer's candidate. It uses
the real homes, castle, market, window lights, light fields, sky, sun shadows and post stack. Presence is the
labelled SIMULATED scenario. The fixture shows what the land looks like. It does not make the candidate
authoritative, and the kingdom scene, collision, light-field occupancy and founded revisions are unchanged.

## Files

- The producer lives in `packages/world/src/terrain-art` (`createTerrainArtCandidate`; see its README for the
  seam, the guards and the limits). The fixture imports it by path until main exports it.
- `land-mesh.ts`: the draw adapter (`LandSource`: a candidate, or the accepted ground for comparison). Every
  vertex is a candidate corner on the same diagonal, with no shader height displacement. The town and the first ridge use 1 m patches. The coarser ring is 4 m and has a hidden
  skirt where the two meet. Its material is a copy of the kingdom terrain shader with faceted normals and
  soft strata on rock only (near the camera). Lighting, fog, shadows and light fields are untouched. Rock,
  scree (turf banks and talus), ledge lip, heath and trodden earth use fixture palette ids 240–244, because
  content has no swatch for them yet. Strata are drawn on rock faces only.
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

See `packages/world/src/terrain-art/README.md`. To adopt the land, the same corner query has to become the
rendered terrain, the horizon, the light-field occupancy and collision/contact in one validated revision.
Today those read `terrainHeight(plan)` / `settlementTerrainHeight`. The founded v1 scene stays pinned until
main adopts the revision, and only main does that.
