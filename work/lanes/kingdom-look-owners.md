# Kingdom look: ownership and integration

Frozen 2026-10-30. Applies to Specs 26–32 and takes precedence over their former draft ownership tables.
The brief is a handmade toy kingdom whose people make it warm. Townscaper, Tunic and the best crafted dioramas
are references; our earlier benches are a diagnostic baseline, never acceptance. Main reviewed both saved dusk
sizes and agrees that rows, empty ground, dim windows, grey castle and default controls still flatten the place.

## One owner per piece

| Piece | Owner | Consumers / integration |
|---|---|---|
| Natural land, lake/pond/stream/leat/tailrace geography, water masks, terrain grading and public trails | kingdom-land (27) | Water queries accept serialized `LandformPlan`; terrain workers never depend on a renderer wrapper. |
| Full lot reservations, connected streets/approaches, market, castle compound layout, place footprints/anchors, tree zones and reveal poses | kingdom-land | Preserve identities and accepted coordinates across growth. No automatic replacement of founded layouts. |
| All landscape tree/hedge/shrub/cover forms, planting, wind, garden vignettes, lot backs and path wear | ground-dressing (28) | Land supplies zones/sites; no other lane plants landscape trees. Elder-oak root seat is exposed as a real places-high seat. |
| Water surface/masks' rendering, reflections/pillars, foam/flow, reeds/lilies/waterline stones, water critters, pier/boats/mill/wheel/weir/bridge/sign | places-water (29) | No independent course planner. Consume actual land samplers once available; isolated typed fixture before that. |
| Castle architectural sculpt/dressing, court stair/well/crest/parapet, keep/gate/court banners and their cloth; lookout cairn/seat/telescope; forest stile/waymarker/gathering vignettes/path lanterns | places-high (30) | No general takeover of citizen capes, homes' cloth, Raid Gate standards or other lanes' banners. Trees stay ground-dressing's. |
| Grade, sky/fog/exposure, all window/pane lighting, castle openings, street lamp placement, warm spill, shared people-light helper | kingdom-light (26) | Place lanes own their physical lamps and request light through the helper. Light owns street lamps only. |
| Glass sight/light transmission across material registry, meshing, field blockers, sight rays, panes and sun shadows | kingdom-light | Keep physical solidity; don't make every clay mesh transparent. No shared packing/schema changes without main. |
| Keep stair envelope cut, old small keep banners removed, hall-window clearance | kingdom-light in castle task | Agree exact stair envelope with places-high before its mount; preserve actual inner sill and beacon. |
| Real fitted furniture, hearth/window-seat/pet presentation and painterly room finish | home-interiors (31) | Shell stays canonical. Actual life/companion/keepsake bindings, doorway actions and pose authority belong to realm. |
| Carved UI kit and first impressions, honest quiet source seal, Forge/build presentation and camera recipes | first-look-polish (32) | No safety/grammar/permission/tool-behaviour rewrites. Existing owners transfer precise presentation files via integrator. |
| Faces/hair after wardrobe WB02, build rack after build-tools accepted work, Forge panel presentation now | first-look-polish, conditional transfer | No overwriting unmerged producer work. Integrator records transfer in progress before these tasks start. |
| Scene/route mounting, terrain-worker call sites, camera recipe call sites, runtime source/blocker/shadow aggregation, existing test capture assertions | team integrator | **Sole composition owner.** Lanes supply exact recipes; no adjacent `scene.ts` hunk grants. |
| `packages/shared`, registry additions beyond glass flags, root manifests/lockfile, new cross-process authority | main | Write `needs:` for an actual consumer need. Do independent work meanwhile. |
| `THIRD_PARTY.md` and package exports at integration | integrator, within main-reviewed dependency/credit policy | Lane README supplies exact source/license/use; add credit before adaptation ships. No GPL-family code copied. |

Other boundaries: civic benches/signs/footbridge remain civic content. Land places pacing furniture; high owns
court/lookout/oak seats, water owns pier/bridge seating. Street props remain their lane. Ground edge fences stop
at forest entry; high's stile run carries the path there. High owns gathering berries/mushroom vignettes as
interaction anchors; ground's passive scenery never presents collectible rewards. Main's hero-anvil/dragon
brief (25) remains with `anvil-hero`; no lane here replaces it or redraws the official Codex mark.

## Main's handoff, now present

- Actual compiled `KingdomLand*`, water/course/site/path/zone/view types in
  `packages/world/src/kingdom-land/types.ts`, re-exported by `@chatdom/world`. Legacy landform remains v1;
  `LandformPlan` is a tagged union. `trail` is a public-ground/edge kind. No placeholder generator or sites.
- Actual `PeopleLightOptions`, `PeopleLight`, `PeopleLightSource` types in
  `apps/web/src/kingdom/lights/types.ts`. Kingdom-light implements the helper in its first independent task.
- `__chatdomKingdom.pose(eye, target, fov?)`; `pose(null)` releases the evidence pose. Finite values, distinct
  eye/target and 10–100° FOV; camera revision invalidates fixed-frame cache. Normal camera selection, a seek with explicit view, capture choreography and replay release it; a time-only seek preserves the chosen pose.
- Dynamic content collections `ground-dressing`, `places-water`, `places-high`. Missing collections fail clearly;
  no unfinished stand-in assets are loaded. Civic root exports expose only actual available factories/constants.
  CP04 lanterns/benches still require reviewed civic work through the integrator, not invented builders.
- Place collection validation now permits the specific reviewed registered brass/cloth/masonry roles, without relaxing other collections. Ground owns only its separate narrow validator branch.
- `@chatdom/ui` workspace manifest, Solid dependency, web dependency, `.`/`./kit.css` exports and lockfile entry.
  TSX under packages participates in typecheck. No unfinished UI is imported into the app.

## Explicit presentation grants

Main grants first-look-polish `apps/web/src/kingdom/index.tsx` and `kingdom.css` for the source seal, redundant
housewarming copy and legibility only, and `apps/web/src/forge/index.tsx`/`forge.css` for the panel's materials,
realm chooser, field and factual copy only. No source-selection/readiness/request/authority/runtime changes.
These surface files are exclusively first-look's presentation scope now; integrator alone handles composition
and must preserve those changes when wiring producers. The existing build-tools and wardrobe files transfer
only after the integrator accepts their current work and records that transfer with the accepted commit in lane progress. Main pre-approves that narrow conditional presentation transfer; no further permission turn is required. Kits/framing start immediately.

## Start together; dependency edges inside each lane

| Lane | Independent work ready immediately | Later dependency / split |
|---|---|---|
| kingdom-light | PeopleLight helper; grade/sky; window/glass work in disjoint files | Castle modifications coordinate one owner; lamp runtime after helper + civic CP04. Compose on real scene via integrator. |
| kingdom-land | Streets/frontages and geography in separate modules | Sites early; zones and routes split after geography; final views/assembly after both. |
| ground-dressing | Cover/garden content, tree forms, wind/wear modules | Plant actual land zones after LD03; helper-free fixture composition first. Only lead edits catalogue barrel/test registration. |
| places-water | Prop sculptures, pure reach adapter/fixture and water shader runtime in separate folders | Assemble after all three; bind actual sites after LD02 and helper after KL01. |
| places-high | Court/place content and bench setup | Lookout and forest content split after anchor contract; ground tree forms and actual land sites before integrated acceptance. |
| home-interiors | Real shell fitter/bench | Family furnishing and runtime presentation split after fitter; light helper/glass for complete window-seat finish. Realm does not block fixture art. |
| first-look-polish | UI kit and pure camera composition module in separate folders | Forge/build surfaces after kit and file-owner transfer; face/hair after actual WB02 acceptance. |

One lead owns each lane barrel, PRD/progress and commits. Multiple workers use task branches/worktrees or disjoint
modules, never concurrent edits to those shared files. The team assigns them; main has prepared the primary lane
branch/worktree. Source dependency changes arrive through integrator/rebased approved base, never copied stand-ins.
Typed fixtures live only under benches/tests and are visibly SIMULATED. Runtime imports wait for real producers.

## Composition checklist for the integrator

Accept reviewed implementations one branch at a time atop current main. Main now merges them directly without
waiting for an announcement (founder decision 2026-10-31). A short look is enough: merge clean work and send the
missing visible detail back as the lane’s next task.
A small scene adapter is fine; no universal plugin engine is requested. Do the following as one connected slice:

1. Choose the accepted plan and produce static place/civic placements before fields/shadows/occlusion compile.
   Resolve castle front-curtain replacement before these lists: preserve IDs/XZ footprint but use actual reviewed
   parapet dimensions (12×1.75×3 m, not the old 12×10×3 m wall). Never leave the old blocker behind an overlay.
2. Mount each runtime with caller-owned scene/material/pool/ground/camera handles. Await assets and one meaningful
   draw; don't gate opening on optional shader completion hints or background field refinement. Preserve live ready.
3. Replace the old inline tree scatter once ground-dressing mounts. Remove interim `mill:bridge` only when stone
   bridge deck/nav is continuous. Replace old water planes once the water mount owns every visible body.
4. Combine window, build, lamp and place light sources once. Keep beacon/castle field sources separate where needed.
   Ground sees the complete sites, keep-outs and occupied placements. Handle source revocation and clear all pilots
   that would falsely retain stale presence. No duplicate lights, trees, seats, marks or unchanged shadow blockers.
5. Terrain worker uses land's water/shore queries and ground's wear outputs. Ground shader hooks compose through
   kingdom-light's shared material ownership; no string-replacement fork that silently drops later lighting edits.
6. Feed accepted public people/state, not a synthetic audience on real Herald. Tick/resize/dispose each runtime;
   respect ownership of shared GPU/audio resources. Bind sounds through the existing audio mix when eligible/unlocked.
7. Use the first-look camera recipes for product shots; place reveal poses remain land's. A capture bench passing
   is distinct from integrated kingdom acceptance. `pnpm verify` on assembled candidate, lean serial shots, inspect
   dusk desktop+phone, representative street/place/interior/Forge/build and darkest-skin face. Fix visible slop.

All captures take the machine-wide lock before browser/server creation, reuse loaded scenes, record/stop only owned
ports in 5170–5199, and select changed views. No parallel SwiftShader capture workers, giant repeated matrices or
record-keeping commits. Real-GPU timing remains Tobias's check; the known headroom is permission to improve the look.

## Realm owns the next authority seam

Founded layout revision and deed positions, snapshot persistence, growth/adoption, navigation actions/interaction
receipts, private home life/companions/keepsakes, authenticated doors and movement are realm work. These lanes
provide complete presentation plus concrete typed ports, never fake ledgers or invented rewards. `land=next` is
SIMULATED preview only until a realm adopts it. Existing real homes cannot move because main changed a generator.
Newly supplied fixtures may show a thriving evening; live populations/lights remain only the people actually present.

## Picture lanes — 2026-10-31

The latest visual brief adds picture-land (46), picture-trees (47), effects-library (48) and avatar-style (49).
Their new folders are disjoint: terrain-art world/web producers; content/web trees; render effects; avatar-style
content/style-study bench. Existing land planning and planting-site ownership remain. Main owns adoption with
one terrain height authority, existing scene/shader/shadow wiring, effect anchors and production wardrobe rollout
after Tobias chooses. No second forest, render-only inhabited ground, duplicate emitters or default avatar choice.
Only these picture lanes, passport and Genesis content continue; other system lanes stop after their current task.
