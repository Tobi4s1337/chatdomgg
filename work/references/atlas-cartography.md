# Reference: Atlas cartography and camera

For: [Spec 01](../specs/01-atlas.md). Studied 2026-10-30. No reference repository was cloned and no git command was run.
Primary source files were fetched into external reference checkouts; prototype sources remained read-only.

## What it is

The existing `e-atlas` proves the desired explorer's-map composition: ink coast, coastal ripple lines, restrained
watercolour, occluding mountain stamps and seeded arms. MapLibre and OpenLayers solve the less visible craft:
gestures that coexist predictably, an anchor that stays beneath a finger, interrupted flights, and constrained views.
We use the prototype as a visual reference and the open-source map engines as interaction references. The renderer
remains the PixiJS 8 implementation required by `chatdom/Atlas.md`; neither GIS engine becomes a dependency.

## Sources and exact revisions

| Source | Revision / license | Primary evidence |
|---|---|---|
| MapLibre GL JS | `62247a734e635e2b7cb2584fb99fc0d201128c57`, fetched 2026-10-30; BSD-3-Clause | [repository](https://github.com/maplibre/maplibre-gl-js), [license](https://github.com/maplibre/maplibre-gl-js/blob/62247a734e635e2b7cb2584fb99fc0d201128c57/LICENSE.txt), [camera](https://github.com/maplibre/maplibre-gl-js/blob/62247a734e635e2b7cb2584fb99fc0d201128c57/src/ui/camera.ts), [handler manager](https://github.com/maplibre/maplibre-gl-js/blob/62247a734e635e2b7cb2584fb99fc0d201128c57/src/ui/handler_manager.ts) |
| OpenLayers | tag `v10.11.0`; BSD-2-Clause | [View API](https://openlayers.org/en/v10.11.0/apidoc/module-ol_View-View.html), [PinchZoom](https://github.com/openlayers/openlayers/blob/v10.11.0/src/ol/interaction/PinchZoom.js), [DragPan](https://github.com/openlayers/openlayers/blob/v10.11.0/src/ol/interaction/DragPan.js), [license](https://github.com/openlayers/openlayers/blob/v10.11.0/LICENSE.md) |
| van Wijk and Nuij | paper, ideas only | [Smooth and efficient zooming and panning](https://www.win.tue.nl/~vanwijk/zoompan.pdf), [author implementation example](https://www.jasondavies.com/maps/zoom/) |
| Chatdom `e-atlas` | local prototype, read-only; reimplement here | `../../chatdomgg/prototyping/kingdoms/e-atlas/` |
| Existing Surveyor | local prototype and current read-only HTTP/SQLite observations | `../../chatdomgg/prototyping/kingdoms/g-atlas-live/surveyor/` |

## What we take

1. **One camera state, separate gesture deltas.** MapLibre
   `atlas-maplibre/src/ui/handler_manager.ts:72` defines handlers with reset/active/frame behavior;
   `:374` registers explicit coexistence; `:434` resolves and resets blocked handlers. Our drag, pinch and wheel
   handlers emit deltas to one float64 camera. A pointer-down cancels a flight; pointer-cancel, blur and unmount reset
   gesture state. Registration order must never make a second finger leave drag inertia running.
2. **Preserve the anchor through zoom.** OpenLayers
   `atlas-openlayers/src/ol/interaction/PinchZoom.js:68` measures the distance ratio; `:90` computes
   the finger centroid; `:98` changes resolution around that anchor. Capture its world coordinate before scaling and
   solve the new camera centre from that same coordinate. The selected kingdom must remain above a phone's bottom
   sheet; use usable-viewport padding, as [OpenLayers View](https://openlayers.org/en/v10.11.0/apidoc/module-ol_View-View.html)
   documents. We keep north up and do not enable map rotation.
3. **Interruptible, bounded flights.** MapLibre camera `:1459` respects motion preferences and stops the previous
   flight; `:1504`–`:1577` derives the van Wijk path, bounds its zoom-out and handles a nearly zero distance.
   Its defaults are speed 1.2 and curve 1.42; `e-atlas/src/view/camera.ts:99` uses curve 1.4 and speed 1.15.
   These are references, not claimed optimal values: tune a low arc capped below 3 s, and test equal centres,
   enormous distances, interrupted flights and resize during flight. Test the final camera, not only the formula.
4. **No tile holes while sharpening.** `e-atlas/src/view/tilelayer.ts:1` describes ancestor fallback and 260 ms fade.
   At `:56` the nearest ready ancestor covers missing children; boundaries are rounded from shared screen-space
   edges (`:30`) rather than rounding each tile width independently. Reimplement this with a bounded texture cache;
   keep an old tile until its successor is ready, and never fade to empty parchment during zoom.
5. **Visible work first.** `e-atlas/src/bake/farm.ts:50` detects worker support, `:88` queues by priority and `:140`
   fills workers. Use bounded worker queues and visible-first work, then flight-path prefetch. Browser tile baking is
   an Edition 0 provision; Edition I pre-bakes all levels. Do not take the prototype's edit invalidation or town plan.
6. **An actual visual standard.** Viewed `e-atlas/shots/hero.png` with `view_image` on 2026-10-30 (1920×1080).
   The coastline, mountain silhouette, paper and heraldry read as a crafted atlas. Leave behind its dense synthetic
   festival dots, simulator meters, plot button, kingdom names and UI. It contains synthetic data and is a reference
   frame only, not evidence of the new Atlas or a source of real channels.

## Surveyor reality, checked 2026-10-30 00:37 UTC

`GET http://172.17.0.1:3541/atlas/api/status` worked. At the sample it reported 178 sweeps, 158,284 observed channels,
24,961 candidate kingdoms, 34,238 live channels and 4,306 kept raid observations. These are observations of this
collector's coverage, not all of Twitch. They are a dated sample, never hardcoded product copy.

`surveyor/src/server.ts:130` routes only status, raid SSE and 30 recent **pair aggregates**. It has no channel index,
edition, `live.bin` or recorder HTTP export. `src/raids.ts:125` emits an observation time using `Date.now()` and no
durable event ID; `src/recorder.ts` preserves webhook message time but not message ID. Consequently a reconnect must
reconcile aggregates without replaying a pair as a new caravan. Uncertain equivalence is a gap, not an invented ID.

The read-only database path supplied by the environment was accessible. A `node:sqlite` read-only transaction
confirmed zero rows in `settlers`, observations starting 2026-10-29 15:44 UTC, and recorder frames starting 16:53 UTC.
That is under the two days required to found Edition 0. A visibly labelled survey preview can render these real
observations, but neither an official edition nor a founded voxel kingdom exists yet.

The source collector must keep running untouched. New code reads `SURVEYOR_BASE_URL` first and, for the inventories
that do not have HTTP endpoints, an explicitly supplied `SURVEYOR_DB_PATH` using a consistent read-only transaction.
It writes its own data directory, never the source database. The source path and host above are environment evidence,
not application defaults. Source schema pointers: `surveyor/src/db.ts:16` channels, `:32` category minutes, `:38`
raid pairs, `:52` settlers and `:59`–`:69` recorder tables. The source README specifies deflate-raw + version-1 LEB128
recorder frames; those are not the proposed Atlas live binary format.

## What we do differently

- Use an edition's frozen fantasy coordinates, no geographic projection, globe, pitch or rotation.
- Language continents and hand-reviewed game-family realms replace synthetic category/social-force placement.
- The Atlas ends at an ink drawing, about z9; it never exposes streets, plots, people or a person's travels.
- World zoom uses one saturated-pigment density layer. It has no glowing dots, white bloom or night mode.
- Camera and texture budgets serve 390×844 phones as deliberately as laptop maps. A selected result remains visible
  after the sheet opens; keyboard search and focus work independently of canvas hit testing.
- Inputs answer within 100 ms, but screen captures on SwiftShader do not prove laptop/phone GPU timing.
- No external render demo was executed during this study. Source behavior and the prototype frame were inspected;
  the lane still owes its own motion, touch, seam and real-device evidence.

## Leave behind

Geographic projections, map-engine dependencies, Mapbox post-license-change code, building extrusion, synthetic
social edges, towns and district dots, a public graph-export API, mutable territory, and the prototype's plots/editor.

## License and assets

This spec takes techniques, not copied code. If a worker adapts MapLibre or OpenLayers code, retain its exact BSD
notice, identify source/revision in the file, and ask main to update `THIRD_PARTY.md` (outside this lane's write set).
The paper and prototype do not waive any asset license.

The prototype README records K.M. Alexander #NoBadMaps stamps as CC0, game-icons.net charges as CC-BY-3.0, and Kenney
Interface Sounds as CC0 (`e-atlas/README.md:150`). The corresponding source asset/license files must be checked and
recorded before importing individual assets; the prototype's packed atlas is not a license inventory. Prefer a small
repacked, reviewed CC0 stamp subset and an original heraldry system to dragging in a charged icon library. No
unlicensed font, image or sound may be shipped merely because it exists in the old prototype.
