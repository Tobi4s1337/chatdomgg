# Pier site authority

This module implements pier seam 3 without changing a terrain column or an existing placement. A candidate is an installation proposal; only the founded-placement revision handshake can make its deck walkable. It does not assert that any real kingdom has a valid pier already.

## Model and ownership

`PierAnchor` is exactly `{ id, root, turn, waterY, depth, water, biome }`. Coordinates are settlement metres. The root is the centre of a dry landing; local +Z leads across the shoreline. `depth[i]` is the physical bed depth at local z=i metres, including the dry root at index 0 (depth 0). Accepted arrays and their nested coordinate/depth arrays are frozen copies.

`PierPlanningDimensions` makes width, integral length, dry landing depth, the point where the entire deck must be over water, minimum wet depth and minimum freeboard explicit. No permanent deck width is guessed. The whole envelope is x=±width/2 and z=[-landingDepth/2,length]. Store dimensions alongside the anchor; an anchor alone cannot validate a different piece of deck geometry.

`LandWaterSource` carries the installed layout and collision revisions. Its point query returns explicit dry, actual wet `{level,depth,kind,biome}`, or unknown. Depth is measured to the physical bed, not an interpolated decorative bed. Coverage queries certify an entire rectangle, not a finite set of probes: dry, wet, or a fully known dry/wet mixture (`shore`). A shore certificate carries one consistent level/kind/biome for its wet portions and a nonnegative minimum depth. The producer must derive water presence and level from the water actually drawn, retain the originating water kind and Genesis biome, and return unknown when those facts are unavailable. No lake label, guessed biome or distant scenery can provide this authority.

The normal land facade accepts optional `water` and `pierSites`, and exposes optional `piers` and diagnostics. Without a planning request it does no pier work; a requested site with absent/stale water returns an empty list and a diagnostic. Existing ground consumers and facade revisions retain their behavior.

## Installation path

1. Match scene, plan, water and collision revisions. An installed `pier:` placement immediately stops empty-site planning, even if candidates were supplied.
2. Reserve every future lot, built home, inactive or active street including verge, civic court/castle envelope, and existing solid placement envelope. All reserved growth geometry participates before current population does.
3. Try authored candidates in their persisted priority order. The planner invents no coordinates and reads no population-derived centroid or RNG.
4. Require flat sampled ground and continuous actual solid-top coverage under the complete dry landing. Reuse `fullySupported` to reject holes smaller than the terrain sampling grid.
5. Check each intersecting half-metre terrain column of the whole deck and query its complete standing volume. Missing ground and unknown-volume collision barriers reject the candidate even if another sampler extrapolates into them.
6. Require dry-landing and wet-deck water certificates, plus a known shore certificate for the entire envelope, including the transition strip between them. Require constant level and metadata, sufficient depth/freeboard, and exact centreline depth agreement with physical ground. The one-metre station convention is stable in all cardinal rotations.
7. Freeze the first valid result. Passing a pinned anchor revalidates that exact identity, including the depth profile; any failure returns absence and never tries an alternate candidate.

The full envelope currently must also fit inside `plan.bounds`. This is deliberately more conservative than a physical chunk's outward-rounded bounds. A larger physical region does not grant permission to occupy unplanned space.

## Budgets

Planning is installation-time CPU work. Per-frame work and network traffic are both zero. No mesh or land-generation work is performed.

| Resource | Hard maximum per call |
|---|---:|
| Candidates | 512 |
| Ground samples | 65,536 |
| Water point samples | 65,536 |
| Coverage certificates / collision queries | 2,048 each |
| Collision boxes per query / total consumed | 4,096 / 65,536 |
| Continuous support slabs | 256 (shared support helper) |
| Prepared exclusion primitives | 32,768 |
| Exclusion checks | 4,000,000 |
| Width / length / landing depth | 32 / 64 / 16 m |

Prepared exclusions are linear in the bounded primitive count; collision arrays are borrowed and temporary support arrays stay under the query cap. Array entries are charged before scanning, and solid classification charges only inspected blueprint boxes up to the first solid. An asset's whole conservative envelope can then be reserved without reading the rest of its decoration. `work.preparationChecks` exposes these charges; a long non-solid prefix still stops at the hard limit. Accepted depth storage is at most 65 numbers. Runtime providers must also bound their own query work: a callback is not an exemption from the installation budget. These are operation/memory-shape bounds, not claimed real-device frame timings. Run expensive founding outside the render loop.

## Decisions and references

- Drawn water and physical collision have different jobs. Water evidence authorizes the visual presence/level; actual collision authorizes support and loaded space. Matching revision fields attests producer identity, not correctness of a dishonest callback.
- Continuous footprint certificates prevent an unknown patch or dry hole between probes from becoming a supposed wet deck. Physical support uses the existing rectangle-union helper for the same reason.
- Conservative placement envelopes may reject a geometrically empty corner of an existing asset. This is preferable to excavating, deleting or relying on an opening the pier does not own.
- A saved anchor that no longer validates needs an explicit migration. An installed pier needs its own installed-content validation, because an empty-deck query correctly sees its planks as occupied. Neither case permits replacement search.
- Multiple water bodies can use separately persisted proposals and ids. A wider multi-pier allocator must additionally reserve accepted pier footprints; this single-site planner does not claim to solve allocation between proposals.

Prior art reviewed: [water reference](../../../../work/references/water.md) (Ultra Water, MIT, revision `ce9248fa20afbdf63fd4c11709f68d7368aca0a0`: reject stale layout-tagged queries; delayed GPU wave heights do not authorize collision), and [slab-support reference](../../../../work/references/walk-slab-support.md) (Voxelize/voxel-aabb-sweep: actual transformed boxes, headroom and continuous support). These are design lessons; no third-party implementation was copied. Older reference notes' claims about missing local samplers are historical, not a description of this checkout.

## Evidence and handoff

Focused test command: `nice -n 10 pnpm exec vitest run packages/world/src/grand-adoption/pier-sites.test.ts --maxWorkers=1`. Ten tests cover revision/unknown water, misleading support including a 1 mm hole, actual compiled-region boundaries, nonflat water, unknown/mixed shoreline transitions, depth and biome discrepancies, all rotations, explicit dimensions, reservation/road/civic/solid exclusions, reserved growth through new layout/collision revisions, exact pinned identity, installed-placement suppression, candidate and ground-sample exhaustion, large early-solid assets, long non-solid-prefix exhaustion, and the facade. The final focused run passed in 1.11 s overall, with the 65,536-sample and 32,768-preparation-check exhaustion cases included. Before the preparation-accounting correction, the combined existing place-site regression run passed 19 tests with one optional private-receipt test skipped; local ESLint passed after the correction. These are fixture measurements, not production-site budget claims.

A private receipt census found 240 homes, 240 reservations, 1,197 placements, 101 assets, 53 materials, 497 streets with 9,696 points, and 28 square vertices. Its 24,297 blueprint boxes require only 101 solid-classification visits: each asset starts with a solid. Charging every unvisited decorative box previously rejected this valid input during preparation. The corrected charge is 12,161, still below the unchanged 32,768 cap. This structural census does not demonstrate an accepted native pier.

Remaining producer work belongs to grand-world: construct and test the renderer-backed source for each adopted land, supply explicit biome metadata, select authored candidate dimensions compatible with pier's actual geometry, validate private real receipt candidates, and persist the accepted anchor plus dimensions. Pier owns actual deck/rail/post placement and its collision revision. No native anchor or screenshot is claimed by this core. Main owns root package exports and final scoped typecheck/build; only local lint and focused tests run here.
