# 5 Kingdom that grows: Every kingdom is a stunning world, and it grows with its people

**End state:** The grand land is the end version. Every kingdom is a whole voxel world on the level of the island preview, its own from the channel (coast, mountain ranges with rock strata and snow, waterfalls, a mere, forests of distinct species, the castle on its rock, the harbour), and it is the place everyone streams, walks and builds in. It grows with its community: a hamlet by the castle becomes a town and then a capital, new valleys open out of the mist, streets fill, walls ring outward. It loads fast and runs smoothly on ordinary hardware without giving up any of its beauty.

**Today:** The grand land exists and is stunning, but only as its own page (/-/grand, about 82 M voxels and 2 k trees for tobi4s_). The kingdom everyone uses still runs on the old small land. Adopting it is on wip/grand-land-adoption: the stream now reaches ready in about 56 s on the software renderer (was over 300 s), but no loaded frame, walk, Forge or moment has been proven on it, it was never run on a real GPU, the land is generated in the viewer's browser (about 25 s of CPU), and the branch still seats the land on today's homes, so growth could shift it.

## E01 The grand land is the kingdom
- **Tobias note:** Tobias: "the recent island one looked epic, something like that, but with automatic growth possible; smart solution; we want both." And: "this should definitely be a goal ... it is stunning, so it should be our end version."
- **Today (honest):** wip/grand-land-adoption (52bb8cc): native readiness in about 56 s, 16 exact regions, 38 shown; a loaded frame still timed out; no walk, Forge or moment checks on it. The stable growth seating (W2 3e5061f, merged as 00e888e) is not reconciled with the branch.
- **Decided:** The grand land is the end version, not an art study (decision 47). tobi4s_'s kingdom goes first.
- **Ambitious end state:** Every surface of a kingdom runs on its grand land: the stream view, walking, homes and doors, the Forge, moments, raids, the Chronicle, the panel picture and the front page. There is one land per kingdom and one source of truth for it; the old small land is retired. Nothing that works today breaks: every home keeps its plot and door, every forged piece stays where it was placed, and walking collides with the real terrain, walls and castle. The first proof is tobi4s_'s kingdom, then the three Genesis kingdoms, then every new kingdom.
- **Done when:** Stills of tobi4s_'s stream and walk on the grand land at four hours of the day; a timed cold-load recording on a real GPU; walk, door, Forge, moment and raid-arrival checks passing on the grand floor; no home or forged piece moved (test).
- **Depends on:** E09, E10
- **Phase:** 1 First
- **Size:** XL
- **Source:** Tobias
- **Notes:** Biggest risk in the cut. Start from wip/grand-land-adoption 52bb8cc and work/evidence/grand-adoption-wip/diagnosis-2026-11-01.md; first reconcile with the stable seating on main (00e888e), then E09. Real-GPU checks through the PC tunnel (chatdom-pc). If the floor is not proven in time, the front page and showcase video still open on /-/grand at golden hour and fly down into today's town.

## E09 Generated once, kept forever
- **Today (honest):** Each viewer's browser generates the whole land (2560 x 2560 columns, about 25 s of CPU) before it can draw.
- **Ambitious end state:** A kingdom's land is generated once, on the server, when it is founded: from its seed and Genesis profile, under a versioned recipe with a hash, so the same kingdom is the same land everywhere and forever. The server prebuilds the meshes for every region at every level of detail and stores them compressed. Viewers never generate land; they download the nearest regions first and the rest streams in behind, and the browser keeps what it has already downloaded. A new recipe version never changes a founded kingdom unless it is deliberately migrated.
- **Done when:** A test that the same seed and recipe give the same hash; a cold load that downloads and draws without generating; the stored size per kingdom recorded.
- **Phase:** 1 First
- **Size:** L
- **Source:** Added
- **Notes:** Generation lives in packages/world/src/grand/**; the worker that meshes today is the starting point. Store under the realm's data, served like the Atlas data. For the cut: tobi4s_ and the three Genesis kingdoms baked.

## E10 Fast and smooth, with no loss of beauty
- **Tobias note:** Performance optimised, without making the quality go down.
- **Today (honest):** Unmeasured on real hardware. On the software renderer: 9.2 M triangles and 222 draws per frame, 0 fps (not a GPU figure).
- **Decided:** Quality is not traded for speed (decision 47).
- **Ambitious end state:** Your own street is on screen within 3 s of opening the stream or walk on broadband, and the whole land within 15 s. The stream view holds 60 fps at 1080p on an RTX-class GPU and 30 fps or better on a mid laptop with integrated graphics; walking feels the same. Speed comes from the engine, not from cutting the art: far land as low-cost distance meshes or impostors, instanced trees and props, culling on the GPU, packed vertex formats, fewer draw calls, reflections and shadows sized to what is on screen. On weaker devices the view distance and effects scale first; the palette, light, voxel detail near you and the dusk windows never do.
- **Done when:** Timed recordings and frame-time graphs on Tobias's RTX 5080 and on a mid laptop; the same views before and after each optimisation side by side, judged with no visible loss at the high setting.
- **Depends on:** E09
- **Phase:** 1 First
- **Size:** L
- **Source:** Added
- **Notes:** Inspector already reports tier, quads, draws, reflect and shadow cost (see gk10 stills). Software-renderer numbers are not evidence; measure on the GPU.

## E11 Every channel gets its own world
- **Today (honest):** Four channels have grand land. The seed uses Genesis defaults when no audience or categories are observed.
- **Decided:** World-Tree, Atlas: the land comes from the channel.
- **Ambitious end state:** Every kingdom's world is its own and recognisable: Genesis picks its landform (island, mountain valley, river delta, lake country, cliff coast, highland), its biome and forest species from the channel's categories, its crest colours on banners and roofs, its emotes in stone and glass, and its landmarks. No two kingdoms look alike, and a still of any of them stands next to the Eldermere reference without embarrassment.
- **Done when:** A sheet of 12 different channels' worlds at golden hour; a test that different channels never share a land.
- **Depends on:** E09
- **Phase:** 2 Launch
- **Size:** XL
- **Source:** Added
- **Notes:** Spec 56; chatdom/World-Tree.md; reference /tmp/chatdom-refs/grand/.

## E12 The land opens up as the community grows
- **Tobias note:** It should grow with the community somehow.
- **Today (honest):** The grand land is generated whole and shown whole.
- **Decided:** Nobody ever moves (spec 56).
- **Ambitious end state:** The whole world is generated at founding, so nothing ever shifts, but it is revealed as the kingdom grows. A hamlet sees its own valley clear and the rest under sea mist and cloud. As people arrive, milestones open more of it: the mist lifts off the next valley, the mountain pass is cut, the harbour is built, a bridge reaches the outer island, the castle gains towers. Each opening is a beat on stream and a page in the Chronicle, so the community can see that they made the world bigger.
- **Done when:** A simulated growth from 9 to 5,000 citizens as stills of the same wide view at each milestone; a test that every reveal is a pure function of the founded land and the citizen count.
- **Depends on:** E01, E02
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Added
- **Notes:** Pairs with E02 (quarters) and E03 (beats on stream).

## E02 Smart automatic growth
- **Tobias note:** How can a kingdom grow? We would expect more and more people to claim a plot.
- **Today (honest):** Fixed plot sets fill as people speak. Spec 56 designs reserved lots and append-only quarters; not built.
- **Decided:** Spec 56: lay out the future at founding; an empty lot is a tended reserve, not a fake resident; nobody ever moves.
- **Ambitious end state:** At founding the whole future is laid out: tenure quarters by follow year, with reserved lots kept dry and reachable as meadows, gardens and marked lots. Each new citizen takes the next lot by the rules (follow year picks the quarter, sub months help pick the street). When a street fills, the next one opens; when a quarter fills, a new quarter opens with a new road, cleared forest and new lanterns. Plot ids never change. It scales from 9 homes to a capital of 15,000 to 25,000 in districts.
- **Done when:** A simulated growth from 9 to 5,000 citizens rendered as stills at each step, on the grand land; tests that no home ever moves.
- **Depends on:** E01
- **Phase:** 2 Launch
- **Size:** XL
- **Source:** Tobias
- **Notes:** spec 56 (4,096-home cap, landform v1 and 32x16 m compiler limits to version).

## E03 Growth you can see on stream
- **Today (honest):** The crier and civic levels exist; quarters opening has no beat.
- **Decided:** World-Tree: the wilds step back as the kingdom grows.
- **Ambitious end state:** A tent pitched with a crier line when someone claims a plot; "Old Row is full: the Mill Quarter opens" with trees giving way and a road laid; at size milestones the walls ring outward and the castle and harbour grow.
- **Done when:** Clips of each beat.
- **Depends on:** E02
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Added

## E04 Homes grow taller with presence
- **Today (honest):** GR10 home tiers are merged, but the grown home is not visibly prouder across the street.
- **Ambitious end state:** Each tier (hut, cottage, house, manor, hall) reads from across the street: a second storey, a new roofline, more windows, a garden, without moving the door or Forge slots.
- **Done when:** Side-by-side stills of all tiers on one plot.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** Register: growth lane next step.

## E05 The hamlet is the first stage, not a demo
- **Tobias note:** The hamlet etc. doesn't have any purpose in the actual game; it feels void.
- **Today (honest):** "Visit the hamlet" is a 12-home simulated layout behind a button.
- **Ambitious end state:** The demo toggle is gone. A small kingdom is a hamlet: a pier, a campfire and the tavern work at a population of 9, and it feels alive, never empty.
- **Done when:** Stills of a 9-citizen kingdom at night.
- **Depends on:** G02, G03, G04
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias
- **Notes:** packages/world/src/layout.ts:28.

## E06 A real day and night, beautiful at every hour
- **Tobias note:** During the day the world looks pretty bad compared to the other phases; optimise so it gets much more beautiful.
- **Today (honest):** Noon is flat and washed out (ACES, blue ambient, weak shadows). The hour comes from the URL (default 19:30); there is no cycle.
- **Decided:** A real day cycle on a shared kingdom clock (Q15).
- **Ambitious end state:** One kingdom clock runs day, dusk, night and dawn, and the stream shows the same hour as walkers. Noon is regraded (AgX, warm sun, stronger shadows, rich meadow greens, atmospheric depth) so every hour is as beautiful as dusk, and lights still read clearly at night.
- **Done when:** A sheet of stills every 3 hours, side by side.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias
- **Notes:** packages/render/src/atmosphere.ts; post-stack.ts already supports AgX. See open question on cycle length.

## E07 The Chronicle: hamlet to city in seconds
- **Today (honest):** The native Chronicle landed, but its 30 s recording fails review: all 30 frames look the same (same view, same text, slider not moving), and scrubbing rebuilds too slowly.
- **Decided:** The kingdom keeps stills, not videos.
- **Ambitious end state:** Scrub through a kingdom's whole history: weeks of growth in seconds, every forged piece and moment in place, with stills to keep.
- **Done when:** A recording you have watched.
- **Depends on:** E02
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** apps/web/src/chronicle/.

## E08 Seasons change the land
- **Today (honest):** None.
- **Decided:** World-Tree: seasons change it. Seasons and leagues: later (Q40).
- **Ambitious end state:** Spring, summer, autumn and winter dress the land, with festivals.
- **Done when:** Stills.
- **Phase:** 3 After launch
- **Size:** L
- **Source:** Added
