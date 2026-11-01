# Gather land anchors

The updated portal brief keeps the installed tavern exterior. Its room belongs to gather and Colyseus.
The common land facade now offers its real exterior door automatically; the old and grand producers both
call that facade. Campfire siting remains explicit installation-time work.

## API and coordinate model

`land-interface.ts` exports the following local, additive contracts (no shared wire schema changes):

- `TavernDoorAnchor` / `TavernDoorSite`: `{ position: Vec3, facing: number, placementId, assetHash }`.
  Position is supported exterior standing feet. Facing uses interaction-registry radians, zero +Z,
  and points **into** the doorway. `KingdomLandInterface.places.tavern` has this type.
- `PlaceSite`: `{ origin: Vec3, turn: CardinalTurn, footprint: readonly [width, depth] }`.
  The origin is the local rectangle corner; `turn` uses `transformCardinalPoint`. The campfire's
  hearth centre is `transformCardinalPoint(site.origin, site.turn, [9, 0, 9])`.
  `places.campfire` has this type. Its 18 × 18 m square conservatively contains the requested 9 m ring.
- `findTavernDoor({ scene, groundAt, collision? })` returns an anchor or a diagnostic.
- `planPlaceSites(context, { candidates?, pinned?, maxCandidates? })` plans a campfire, returning
  `{ places, diagnostics, work }`. Candidates and pinned refer only to a campfire `PlaceSite`.
  `validatePlaceSite(context, site)` validates a single clearing. `placeSiteBounds(site)` transforms its footprint.
- `createKingdomLandInterface({ scene, ground, collision?, placeSites? })` always resolves the tavern;
  setting `placeSites` requests the bounded campfire planner. No caller should construct this facade per frame.

The package-root index needs the corresponding type/function exports when main owns that contract update;
this task did not edit the index. The directly imported `land-interface` module already exposes the API.

## Tavern producer adapter

`civic:growth:v1:tavern` is an existing installed placement, never a new 14 × 10 m exterior.
The accepted producer is `growth-(hearth|tide)-tavern-<level>`, build lattice, 64 × 64 × 32 cells.
Its source is `packages/content/src/growth-civic/index.ts`, `tavern()`:
the aperture is x28..36, y3..17, z22..24, and the mature porch ends at z31. The adapter checks every
aperture cell after ordered writes. Local x32,z35 places the entire walker just outside that porch,
on the doorway axis, at every growth stage. This is an authored adapter, not a building-centre heuristic.

The adapter resolves actual collision tops beneath that approach, then requires continuous support under
the entire body and full standing clearance. The terrain source must also know the location. Foundations
can be above the terrain source, so their actual collision tops are considered rather than changing terrain.
Unknown tavern producers need their own reviewed authored adapter; they receive `unsupported-tavern`.

## Clearing validation and growth

Candidates come from a stable cardinal winding on square rings with half-widths of 24–96 m around the market. Every reserved home lot and every
planned road is excluded, including unoccupied lots and currently inactive roads. Castle/court/market bounds
and every solid placement envelope are excluded. Trees are never cleared. Conservative envelopes may reject
a physically empty corner of an asset; false absence is preferable to moving someone else's property.

Every intersecting half-metre ground column must agree on one height. Collision boxes then prove complete
coverage of the rectangle by coplanar solid tops using an X slab / Z interval union. This catches subcell holes
that a sample grid or one supporting foot probe would miss. Solid or unknown volume above the surface rejects
the site. Accepted sites are frozen copies. Nothing mutates the plan, terrain, placements, hashes or revisions.

Persist an accepted anchor, and pass it back as `pinned` on growth. Invalid pinned sites are reported and never
replaced by another candidate. Once any `gather:campfire:*` placement is installed, this empty-site planner
returns `installed-campfire` before searching, with or without a pin. Gather must supply a stored authored site
and an installed-content validator before the facade can publish that occupied clearing. It must not exempt
arbitrary logs/trees or silently find another clearing.

This proves geometric support and exclusion, not route connectivity, a scenic sightline to lit windows,
or the final composition at the wilds' edge. Those need gather's authored placement and visual review.

## Work and budgets

No land/network protocol changes and no per-frame work. Door lookup is construction-time bounded work:
at most 32,768 scene assets/placements, 2,048 authored box operations, and 16 possible support tops.
The default clearing search caps at 512 candidates, 65,536 ground samples, 2,048 collision queries,
4,096 returned boxes per query, 256 support slabs, 4,000,000 exclusion comparisons and 32,768 primitives.
Budget exhaustion is an explicit diagnostic, never an acceptance. Intermediate storage is bounded by those
counts; the implementation keeps references to source assets, not copied voxel arrays. An 8 MiB temporary
planner allocation ceiling is the target, not a measured heap claim. There is no persistent planner cache.

The clearing scan belongs on the server or an installation worker. It is deliberately opt-in because the
private real scene measured 1,304 ms under `nice -n 10` while another typecheck ran. The narrow door lookup
measured 2.65 ms. These are host CPU observations, not frame-time or GPU evidence.

## Evidence and limits

The private scene at `/tmp/grand-world-scene.json` was read without committing its contents or names.
Its supported tavern approach is `[6, 9, -5.625]`, facing π into the existing door. The bounded campfire scan
found no candidate: 247 reserved-lot, 44 uneven-ground, 74 placement-overlap, 92 civic-overlap and 55 road-overlap
rejections; 512 candidates, 561 samples, 686,950 exclusion checks, zero collision queries. These results are
bounded-search absence, **not** proof no site exists. An integrator can provide an authored candidate to validate,
extend a reviewed search, or explicitly reserve/grade a site under a new scene/collision revision. No terrain
grading or migration has been performed here.

Tests cover continuous support versus a 1 mm gap, false support, unknown collision, uneven ground, solids,
future reservations/roads, tree envelopes, cardinal transforms, deterministic reserved growth, pinned refusal,
installed-campfire no-replan, budgets, all tavern turns and growth levels, edited apertures and obstructed approaches.
The optional real test runs with `CHATDOM_PLACE_SITE_SCENE=/tmp/grand-world-scene.json`
and `CHATDOM_PLACE_SITE_MANIFEST=/tmp/grand-world-manifest.json`, verifies the receipt hash, and checks old/common
versus grand facade equality on the same compiled world. Collision compilation dominated its initial 44.4 s run;
there was no bake, server, GPU task or scene edit. No screenshots are needed for these data-only changes.

Final focused run (2026-11-01): **13/13 passed**, both `place-sites.test.ts` and `land-interface.test.ts`,
with both private paths set, `nice -n 10`, and `--maxWorkers=2`; total 63.51 s. Receipt/hash verification
and common/grand facade equality passed. The private test took 56.705 s including collision compilation;
door resolution measured 4.03 ms and campfire planning 1,014 ms, with the identical coordinates, rejection
counts and work counters above. Focused ESLint passed. The parent owns the final scoped TypeScript check;
the two test-only type fixes preserve the tested runtime values. No tests or other processes remain running.

## Reference and decisions

Read `work/references/walking-voxel-worlds.md`, then inspected Voxelize's
`packages/physics-engine/src/sweep.ts:135–229` in `/tmp/chatdom-refs/voxelize-voxelize` (MIT,
reference note pins `7ae1c202c4ed33e6f18ea2e947c5c6f9a373b605`). A scout on gpt-6-luna low checked the same source.
Its broadphase and finite iteration limit inform bounded work, and its motion sweep does not establish static
support or resolve an already embedded placement. We therefore validate support and overlap separately and
keep unknown space solid. Our interval-coverage and site-planning code is original; no source code was copied.

Next work belongs to gather/integration: consume the real tavern portal, supply authored adapters for any
other tavern producer, persist a reviewed clearing, add its installed-content contract, then judge the clearing
and route in the real scene. No home or existing civic placement should move to make these anchors fit.
