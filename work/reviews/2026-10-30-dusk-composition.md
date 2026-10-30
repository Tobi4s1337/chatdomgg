# Dusk composition and terrain submission review

Main owns this integration. Astra xhigh reviewed exact camera clearance and terrain batching; Terra high reviewed
actual dusk desktop/phone framing. This is the continuation of the founder's fronts, natural-ground and wave brief.

## Changes

- Rolling ground retains current foundations, street edges and the castle, with rounded skirts into the hills.
  Reservations and tenure addresses do not move. Future growth grades a new immutable layout snapshot.
- Recessed Hearth emitters retain their outward normals and use guarded exact-air projection at every field scale.
  All eighteen family/tier/yaw cases illuminate and clear; an actual wall still blocks projection.
- The town's east-oblique desktop view shows lit fronts across its quarters. The phone looks across the central
  streets. The hamlet rises enough to see its warm fronts over the near roofs. Both retain a street-level named
  opening; the camera first rises to 22 m, then pulls and climbs gradually until 18 seconds.
- Original terrain meshes are grouped in 64 m tiles, preserving packed coordinates, indices and the shared origin.
  Each gets the existing 2 m displacement envelope. This allows frustum rejection instead of drawing the entire
  town's 270,336 ground triangles from every camera. Shared source occupancy, light and contacts do not change.

## Evidence

- The natural-ground milestone is pushed as `2d8b55b`: 787 tests, typecheck/lint/build and two desktop dusk captures.
- The tiled source passes 788 tests. Four serial targeted dusk captures passed the unchanged 120-draw / 800k-phone /
  2M-desktop triangle gates and 12 MiB field-workspace guard. Full `pnpm verify` passed: typecheck, lint, 788 tests, build and all 19 standard captures. Main opened every view as six contact sheets plus the panel bench.
- Actual replay proof passes: a synthetic public simulated SSE frame illuminates Juniper's Hearth facade;
  opposite-origin ingress clears window/beacon fields, then correct-origin recovery works. Main opened both close
  images. Local plus far visited cells are 1,767 versus 31 before the recess fix. This proves the browser adapter,
  not live Twitch or the Herald producer. See the images and report in `work/evidence/kingdom/dusk-composition/`.
- CPU terrain-frustum review predicts 98,304 fewer submitted phone terrain triangles (22 of 36 tiles), preserving
  all source surfaces. This prediction is separate from the actual browser screenshot budget pass.

## Visual judgment

The rectangular hamlet plinth is gone. The reviewed town view exposes warm fronts across the settlement and keeps
its beacon/cloud catch in frame. The close Hearth window now warms plaster and its doorstep. The final hamlet aim
adjustment adds sky for the beacon; main inspected its final desktop/phone matrix. Repeated aligned rows remain
visible as tenure streets; do not describe that geometry as an organic medieval street plan. Real-GPU timings and
the short wave film remain unproven at this checkpoint. The founder requested completed content lanes integrated
before returning to the wave; this milestone precedes that integration.

- `node packages/testing/kingdom-camera.mjs` passes eight cases / 32,008 time evaluations with the exact scene hash preserved in `camera-sweep.json`. The continuous entire-near-plane margins are at least 1.0946 m from ordered homes/castle/props and 3.7431 m from rendered terrain. Trees are excluded; this does not establish universal camera collision, framing or GPU performance. Main read the harness and checked its scene hash against the current source.
