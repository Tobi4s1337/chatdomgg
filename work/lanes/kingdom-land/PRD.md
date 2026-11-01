# Lane kingdom-land

Spec: `work/specs/27-kingdom-land.md` · Branch: `lane/kingdom-land` · Worker: Sol high; Astra xhigh for a
specific hard layout problem. Scope: spec's exact world/web paths and granted terrain seams.
Read `$ralph-lane`, `$look`, and `work/lanes/kingdom-look-owners.md`. You are not alone; preserve others' work.
Sub-agents never run git. Team integrator composes and merges; never merge another lane yourself.

Every task: scoped typecheck/lint/test/build green, one or two relevant shots looked at (shared machine lock,
serial captures), tick box, append one progress line and commit on this branch. Final integrated verify belongs
to the integrator. No proof/record commits or repeated capture matrices.

## Parallel work

LD01 and LD02 can start now in separate modules. LD03 and LD04 follow LD02 and can run together:
LD03 owns `planting-zones.ts`; LD04 owns `routes.ts`/web dressing adapter. LD01 owns `generator.ts` and the one
regression test; LD02 owns `geography.ts`, world terrain dispatcher and land type refinements. Only the lane lead
edits the barrel/README/PRD/progress. LD05 follows all. Shared test changes queue through the lead.
No task imports absent sibling implementations: compile a truthful typed fixture in the bench until its producer
lands, then use the actual module. All independent tasks can start without a scene or fake generator stub.

## Tasks

- [x] **LD01 — Homes gather along winding streets into a square.** Build connected varied streets/frontages and
  an irregular usable market on today's geography; preserve full lots/access and canonical IDs. Show roofs and
  street fronts at dusk in a lane-owned composition bench, plus a small plan-map. One meaningful regression test.
- [x] **LD02 — Shape the land and freeze its real destinations.** Implement v2 sampler/water query and grading
  dispatch, lake/pond/stream/leat/tailrace, castle rise/court and actual door anchor, lookout and forest envelope.
  Populate typed sites/places early so consumers replace their fixtures. Keep v1 exactly unchanged. Show lake
  beyond roofs and court looking over town. Do not invent warmth or geometry for unbuilt places.
- [x] **LD03 — Woods frame the land.** Emit ridge/grove/shore/forest zones and landmark trees, clear of complete
  reservations and campfire envelope plus crowns. Draw gaps and crown clearance on the map. Ground-dressing plants.
- [x] **LD04 — Walks reveal the kingdom.** Connect place routes and trails, shared water crossing, site furniture
  and pacing beats; preserve open destination footprints. Lake reveal and summit views read. No independent tree,
  watercourse, lamp or place-building creation.
- [ ] **LD05 — Judge the whole loop and hand over composition.** Finish poses, growth continuity and exact recipe
  for integrator-only scene/terrain/content mounting. Compare real consumer builds when available, otherwise name
  which integration remains pending. Dusk town at both sizes plus one reveal contact sheet; no 12 full capture
  repetitions. No automatic default/Herald switch; record the realm adoption dependency explicitly.

## Backlog

Add findings here; do not pick from this list without the brief changing.

- LD02's `places.forest.path` passes 0.6–0.9 m from the elder oak's trunk (`places.forest.oak`); LD04's forest trail should route around the oak's root/seat envelope (≥4 m) instead of through it. Resolved for the walked trail by LD04's Oak Path (≥4 m + half-width); `places.forest.path` itself is unchanged and LD05 should set it from the Oak Path.
- The hearth lookout trail (LD02) runs ~100 m along the land frame on a 4 m cross-slope: no bench fits there, so that walk keeps a 104 m beat gap.
- LD04's `foundKingdomRoutes` fails on many seeds with real or fixture towns: LD01's town routes on chatdom, tobi4s_, oakhollow and stormbay, but not lanternmere ("beacon gap"), willowmere ("mill"), riverbend and emberfall ("No clear walk past the elder oak", also with zero lots); the SIMULATED v1 fixture fails on willowmere, riverbend, emberfall and oakhollow. `leaveTown` only tries the six best-scored nodes and trails may never cross a street, so a trailhead behind a street row is unreachable. LD01 keeps lot-free trailheads (mill door yard, oak meadow, beacon-gap foot) with a street node at the nearest street; routing should consider those feet and allow crossing a street at a node.
- LD01's founded land holds 145–190 full lots by seed (3–3.9 quarters of 48); towns of four or more quarters throw `TownCapacityError`. Older channels need realm streaming/adoption of larger founded layouts (R10).
