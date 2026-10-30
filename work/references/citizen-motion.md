# Citizen motion: actual streets and a seekable clock

For: `packages/world/src/citizens/**`, the kingdom citizen renderer and the crowd behaviour lane.
The source contracts remain `KingdomPresenceFrame` and `SettlementPlan`; these local APIs add no identity or wire protocol.

## Prior art

Study: [crowd animation](crowd-animation.md), with a read-only Luna/low reference pass over
the upstream `crowdbake` file `src/demo/crowd-sim.js`. The reference has no established code licence, so this is independently written code.

- Take stride as metres per cycle, not an animation speed guessed separately from motion. The reference's
  `crowd-sim.js:423–443` chooses gait from velocity; its README `117–134` explains speed/stride playback. Ours evaluates phase from total travelled distance, including route redirects and departure.
- Leave behind random wander goals and timestep-dependent acceleration (`crowd-sim.js:133–155,183–186,249–285`). The town already has authored streets; use those and closed-form movement under the kingdom clock.
- Do not claim the example solves crowd collisions: its separation checks at most six neighbours, skips exact coincidences and disables itself beyond 40k (`crowd-sim.js:306–377`). Our small lane offsets distribute walks, but are not a substitute for physical soft-push.

## Data and API

`createCitizenMotion(plan, options)` owns a shortest-path tree, cached home routes, presence intervals and requested goal routes. Every actor is an existing public visual slot supplied by presence. Public names may be null; nothing creates a synthetic person or infers identity from a slot. SIMULATED labelling stays at the feed/UI boundary.

- `applyFrame(frame)` accepts ordered public projections. New epochs or backward frame time reset the local replay; duplicate/old sequence is ignored. Normal departure clears the name immediately and reverses the citizen's current route. Stale/offline authority hides immediately; `clear()` handles source unavailability.
- `sample(atMs)` is pure. It returns position at the soles, +Z-forward heading, speed, total distance, distance-driven gait phase, opacity, state, home light and destination feedback. Sampling a different time first changes nothing.
- `routeForSlot(slot)` provides the cached entry route. `destinationsForSlot(slot)` exposes active public street/market node IDs and that slot's own frontage, never another home's doorway.
- `requestGoal({slot,nodeId,startAtMs})` accepts only a presently existing actor and an approved node. It projects the core's current position onto the actual street ribbon, chooses the shortest graph direction and bakes a continuous route. Callers cannot submit coordinates. The result is accepted or an explicit absent/unknown-destination/out-of-order/blocked rejection.
- Reached public destinations produce `state:'idle'`; reached own doors produce `state:'home'`. `goalNodeId` and `goalReached` are the behaviour lane's feedback. The home's light first turns on at actual home arrival and remains on during subsequent walks while presence continues.

`startAtMs` is at least the latest frame's `asOf` and strictly later than that actor's previous goal. Goal records are retained for clock seeks. Replaying backward by replacing the presence frame deliberately clears those local intentions: replay the deterministic behaviour inputs as well as the presence inputs.

## Geometry and hot paths

The router uses only `activeStreetIds`, traverses real `StreetEdge.points`, and finishes through the home's `approachId`. It stops 0.55m outside the reserved frontage rather than crossing a closed wall. Home arrival walks use the last seeded 12–30m of the market-to-home path, distributing arrivals throughout town instead of stacking every person at one gate. A caller can request a different entry length.

Small rounded corners and up to 0.22m lateral offsets soften the procession. Each resulting segment is checked against expanded reserved lots; unsafe offsets or smoothing fall back to the safe centreline. This protects a 0.28m navigation radius. Routes do not infer collisions for props that are absent from the plan; installed dressing must keep the entrance band and street ribbon open.

Route preparation splits every segment at integer X, Z and X−Z crossings. Each resulting piece lies inside one triangle of the actual rendered terrain surface. Sampling interpolates the baked heights exactly within those triangles, avoiding fresh terrain queries per actor per frame.

Movement is an analytic acceleration/cruise/deceleration curve: 0.45s acceleration, 0.35s stop, seeded 1.05–1.35m/s cruise. Heading uses a short distance lookahead; changing goals blends heading for 0.35s. Departure turns for 0.3s before retracing the path. Default gait stride is 0.75m. The renderer owns authored pose blending and foot articulation.

## Budgets and growth

- Frame path: O(visible actors × log(route points)); no route search, terrain evaluation, network work or pairwise crowd solve in `sample`. Aim for under 2ms CPU for 240 sampled actors on the everyday laptop; this is a target, not a real-device measurement.
- Preparation: one O(E log V) market tree, then cached home route construction. A requested goal performs one O(E log V) destination search plus route baking. Keep this outside a render loop; prewarm entry routes while the scene is loading. Behaviour policies should choose a sparse set of meaningful destinations, not reroute every frame.
- Memory: route coordinates plus cumulative distance require 32 numeric bytes per point before JS object/array overhead. Target under 16MB for a 240-person entry set and modest live goal history. The current controller retains intervals/goals until reset; long-session replay storage/compaction belongs with the event recorder, and needs an explicit bounded replay window before claiming indefinite operation.
- Network: zero per-frame movement bytes. Existing presence and timestamped semantic inputs drive local sampling; a future shared authoritative goal event can serialize slot/node/time without sending private identity.

The same node goal API accommodates tavern approaches, gatherings, raid departures and voluntary walking as the graph gains those approved destinations. The behaviour lane chooses destinations and gestures; this core owns where feet can travel. Interactive obstacles and physical neighbour separation need the shared occupancy consumer, not independently invented blockers in each behaviour. Crowd LOD belongs to rendering and does not change an actor's route or arrival time.

## Decisions and useful proof

Use the settlement graph rather than a new navmesh: the current authored street/entrance geometry is already the source of truth. Use analytic movement rather than incremental simulation so replay, low frame rates and tab resume preserve the same position and gait. Keep goals local until the first network authority needs a shared contract. Preserve the home's light while strolling: presence is the light, the walk is its arrival moment.

One integration scenario uses the actual 240-home Lanternmere plan. It covers active routes/entrances, terrain contact, reserved-lot clearance, home arrival, departure, source loss, backward seeks, market visits, return home, forbidden neighbour doorways and redirecting a moving actor without a visible position jump. It does not prove agent-to-agent non-overlap, newly placed obstacle avoidance, renderer quality or real-GPU timing.
