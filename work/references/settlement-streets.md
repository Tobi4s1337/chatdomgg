# Reference: symbios-tensor

[TheJanusStream/symbios-tensor](https://github.com/TheJanusStream/symbios-tensor) · MIT · studied at
`75fff49ae52a2e03d1a2969b67c85d16d009e62e` (`75fff49`), 2026-10-30.

For: [Spec 02b: A town gathered below its castle](../specs/02b-settlement-plan.md).
All upstream `src/…:line` pointers below refer to this pinned source checkout, studied outside the repository.
The SHA was read from `.git/refs/heads/main`, reached through `.git/HEAD`.
This was a source-only architecture study: no upstream execution, installations, captures or code adaptation.

## What it is

A Rust library that traces roads through terrain-derived direction fields, forms a planar graph, rewrites
its geometry, extracts enclosed blocks, subdivides lots, grades a heightmap and emits road meshes. Its useful
architecture is the separation between broad directional intent, local geometric decisions and a graph that
becomes the input to later land treatment. It is a procedural urban-layout reference, not a template for
Chatdom's appearance or a persistence system. The example pipeline is explicit at `examples/full_city.rs:58–118`.

## What we take

### Broad terrain guides direction; original terrain remains authoritative

`src/tensor.rs:279–305` builds a separate blurred heightmap with three horizontal/vertical box-filter passes.
Prefix sums make each pass linear in the number of cells, independent of blur radius; edge windows are
truncated and renormalized instead of repeatedly weighting border cells. Radius is converted to cells and
capped to the map dimensions. `src/tensor.rs:313–338,389–397` keeps the original and smoothed fields separate.
The tracer continues reading actual heights/water from the original map (`src/tracer.rs:421–428,439–441`).

Take the separation: plan against immutable natural geography, use broad relief to guide streets around the
castle rise and lake, and use exact geometry/terrain for acceptance. Do not let grading steer the roads that
create that grading. The reference README's `smoothing: 12.0` example is a starting experiment, not a measured
Chatdom value; choose a scale that retains our ridge while suppressing small hummocks. A finite sampled blur
needs stable boundary conditions if the planning window later expands: a different blur window must not
reorient already committed roads.

### Blend unoriented axes without their signs fighting

`src/tensor.rs:389–439` derives a minor direction from the horizontal surface normal, then rotates it 90° for
the major contour direction. On near-flat land it blends toward the nearest cardinal axis. Defaults are
`flat_threshold_low=1e-4`, `high=1e-3`, jitter amplitude `0`, jitter frequency `0.01`
(`src/tensor.rs:51–72,102–112`). Those thresholds measure horizontal normal magnitude, not a road grade limit.

`src/tensor.rs:245–269,352–383` represents an axis as `(cos(2θ), sin(2θ))`, sums weighted axes, extracts a major
eigenvector and chooses its sign consistently. Equivalent forward/backward headings therefore reinforce
instead of cancelling. A nearly zero sum (`<=1e-6`) falls back to the terrain direction. Designer fields have
compact support with weight `strength * (1 - distance²/radius²)²` (`src/tensor.rs:213–240`); outside their reach,
the terrain result is unchanged. Radial fields produce tangential major roads and radial minor roads; they
are not destination-routing solvers.

Take the axis representation and explicit cancellation fallback where contour and landmark guidance blend.
Then choose a travel sign using previous heading/destination intent. A destination is directed: squaring its
angle does not by itself ensure movement toward the market. Use bounded landmark influence to create broad
routes and branch opportunities, then prove the intended endpoint was reached. Leave the flat Manhattan
fallback and ring/spoke composition behind; neither establishes the asymmetric courts in Spec 02b.
Directional sine jitter (`src/tensor.rs:424–428`) alone only bends a repetitive grid. Its phase uses
`frequency * position` without a `2π` multiplier, despite the configuration comment calling it cycles/unit.

### Midpoint integration with heading continuity

`src/tracer.rs:379–408` samples direction at the current point and the half-step (RK2), flips both samples
to maintain sign continuity, then blends the midpoint direction with the preceding heading. Defaults are a
2 m step and `0.8` inertia, clamped to `[0,0.99]`; trace length is capped at 300 steps
(`src/tracer.rs:172–185`). This limits turns from noisy terrain without requiring a later whole-road refit.
The midpoint falls back to the first direction near a map edge instead of sampling outside the field.

Take RK2, sign alignment and bounded heading inertia for each proposed extension. Keep planning steps
separate from the canonical rendered samples: Spec 02b requires <=1 m segments and <=0.1 m chord error.
Reject or reroute a branch that cannot satisfy grade, clearance and destination constraints. High inertia
can prevent a branch turning toward its goal; integration is a candidate generator, not a reachability proof.

### Resolve real crossings before proximity snaps

`src/spatial.rs:165–336` examines nearby geometry in this order: nearest physical edge crossing, node
proximity, then edge proximity for a T-junction. Direct neighbors are excluded from ordinary snaps.
`src/tracer.rs:447–518` checks for crossings again after snapping changes the endpoint. Near-parallel
continuation stops at absolute alignment `>0.9` (`src/tracer.rs:524–536`), preventing an overlapping road from
continuing down its just-split neighbor. A split within 1 m of an existing endpoint reuses it
(`src/tracer.rs:570–603`). These are topology decisions, not just curve rendering.

Take the crossing-first ordering and the rule that every adjustment invalidates the previous acceptance
check. Existing road attachment in Chatdom must also preserve the old route ID, arclength and ordered curve.
The library's `split_edge` interpolates the new node's elevation along the old segment
(`src/graph.rs:128–162`), a useful principle for exact shared junction grade. It deactivates/replaces the
old edge, so its storage operation alone does not meet our permanent route-identity contract.

### Index the geometry that queries actually need

`src/spatial.rs:73–142` indexes nodes in one cell and edges in every cell overlapped by their AABB; segment
queries expand their AABB by snap radius. Default hash cell size is `2 * snap_radius`, or 8 m with the
4 m snap default (`src/tracer.rs:175–181,260–263`). The grid caps allocation at 4,000,000 cells by enlarging
cells (`src/spatial.rs:28–58`). This is a dense bounded grid despite the name, and edge deduplication uses
linear `contains` (`src/spatial.rs:114–123`).

Take the broad-phase/narrow-phase split. Chatdom should index complete 8×16 m reservations, swept road plus
verge envelopes, polygons and grade influences in sparse world-coordinate buckets (the spec suggests 16 m).
Do not allocate every cell of an indefinitely growing kingdom or scan every street per terrain sample.
Use stable IDs and bounded query scratch data; measure the 240-home fixture rather than extrapolating from
upstream examples. The reference supplies no browser/mobile measurements for Chatdom's worker budgets.

### Protected required surfaces before feathering

`src/carve.rs:154–344` uses designed node elevations, protects hub/road cells, and applies a nearest-road
embankment outside them. `src/carve.rs:43–134` similarly separates lot foundations from their embankments and
can protect roads with a mask. Take the concept that decorative blending cannot overwrite required contact
surfaces. Reimplement it through the existing terrain sampler and rounded Euclidean feathering, with agreed
market/junction/approach grades and stable foundation heights. Do not adopt iterative heightmap mutation as
our world source: the reference samples lot target heights from its mutable map (`src/carve.rs:49,86`).

## What we do differently

Chatdom's permanent address and growth contract is stronger than deterministic generation. The reference
starts independent seeds on a jittered global grid, traces both major/minor axes, and spawns orthogonal
branches at periodic distances (`src/tracer.rs:267–345,540–565`). This produces coverage rather than an
oldest-quarter-to-castle hierarchy; it also does not guarantee one connected component.

Use this order for our implementation:

1. Freeze the founding landform, larger modular castle compound, walkable market and civic sight corridor.
   Establish explicit market approaches and the castle gate as connected graph endpoints. A keep-out disc
   only stops roads at its boundary; it cannot substitute for a square that people can cross.
2. Generate proposed main routes from civic guides, then asymmetric court branches from protected quarter
   frontiers. Accept geometry and grades together, with fixed existing endpoints and fail-closed validation.
3. Fit full cardinal reservations facing those courts/lanes, with a real approach edge, 1.5 m entrance
   clearance and protected prop strips. Keep all four exact home frames; never infer access from a nearby
   road, a lot's center or a winding street's tangent alone.
4. Reserve the canonical 48 sites/quarter and their growth exits before activating the demonstration prefix.
   Draw/grade only the connected public ground needed by installed places. Late activation exposes accepted
   geometry; it never re-runs city subdivision around people already living there.
5. Persist accepted plot/route IDs, curves, grade anchors and landform version. For arbitrary live history,
   append validated branches/sites from the ledger's frontier. Render-window or visible-population changes
   must not regenerate owned ground. Include the accepted plan revision in worker/cache identity.

Required proofs remain Spec 02b's: full reservations do not overlap excluded ground; every frontage reaches
market and castle gate; committed grades and clearances hold on rendered terrain; year append, late old-year
activation and home growth preserve exact prior geometry/foundations. Anti-row metrics supplement visual
review; they do not certify the feel of the place.

## Leave behind

- **Whole-graph rationalization after commitment.** Defaults use RDP tolerance 2 m, 20/10 m major/minor
  fillet radii, six segments, ten global elevation passes and a 15% max-grade setting
  (`src/rationalize.rs:61–72`). `rationalize_graph` rewrites arteries through intersections and reconnects
  side streets to projected new geometry (`src/rationalize.rs:133–184,189–272`). This moves the streets that
  make an address. Smooth only an uncommitted candidate, then revalidate its complete envelope.
- **Unpinned grade smoothing as a solver.** Global smoothing resets every node from terrain and blends
  50% self with 50% inverse-distance-weighted neighbors; finite grade passes can move both ends
  (`src/rationalize.rs:373–470`). More subtly, `smooth_elevations` resamples the raw heightmap at line 485,
  despite its documentation promising projection from stabilized graph nodes at lines 473–478. Do not infer
  fixed junction grades or a full constraint proof from those comments/configuration values.
- **Endpoint-only terrain checks.** Water/disc rejection tests the proposed endpoint
  (`src/tracer.rs:421–428`); the snap can then change the committed segment. There is no road-grade
  acceptance bound in `trace_streamline`. Sweep paving plus verge over exact lake/lot/castle exclusions,
  validate heights/grades along the accepted segment, and repeat after snapping/filleting. A short step
  alone does not prove clearance across thin obstacles or a wide carriageway.
- **Generic block subdivision as tenure allocation.** Recursive centroid/longest-edge subdivision has a
  depth cap of ten and area defaults of 50–400 m² (`src/lots.rs:85–97,144,455–525`). Its footprint yaw and
  size vary; frontage falls back to a longest interior edge if no street perimeter remains
  (`src/lots.rs:532–561,741–767`). That fallback does not prove walkable access. Our whole reservations,
  tenure order, exact four turns and explicit approaches determine allocation instead.
- **Pruning dormant routes.** `prune_unused_roads` deactivates everything with no lots and otherwise keeps
  a Dijkstra/Steiner-like connection, favoring major roads at 5× lower cost (`src/prune.rs:40–52`). Empty
  future plots are protected addresses in Chatdom; absent residents cannot erase their roads or useful loops.
- **Independent tile regeneration.** The streamer documents visible cross-border road seams
  (`src/streaming.rs:19–30`) and runs the whole graph/block/lot pipeline per tile
  (`src/streaming.rs:204–240`). Stream our persistent plan by spatial region; do not independently invent a
  new street network for each render tile.
- **Assuming a seed makes peer regeneration safe.** The reference explicitly handles platform libm
  differences with portable functions (`src/math.rs:1–17,25–88`) and pins graph fingerprints
  (`tests/field_golden.rs:1–15,67–85`). Take explicit versioning, stable iteration/tie order and regression
  fingerprints. Persist the accepted plan; cross-platform regeneration is an additional contract to prove,
  not a reason to discard the ledger. No upstream determinism claim was executed or independently verified.

## License

`LICENSE:1–13` is MIT, copyright 2026 TheJanusStream. Code could be adapted with its copyright/permission
notice retained, an attribution header in the adapted source and an entry in `THIRD_PARTY.md`. This study
takes techniques only; no code, assets or dependency were added, so there is no adapted-source credit entry
to add. Pinned source links: [tensor field](https://github.com/TheJanusStream/symbios-tensor/blob/75fff49ae52a2e03d1a2969b67c85d16d009e62e/src/tensor.rs),
[tracer](https://github.com/TheJanusStream/symbios-tensor/blob/75fff49ae52a2e03d1a2969b67c85d16d009e62e/src/tracer.rs),
[rationalization](https://github.com/TheJanusStream/symbios-tensor/blob/75fff49ae52a2e03d1a2969b67c85d16d009e62e/src/rationalize.rs),
[license](https://github.com/TheJanusStream/symbios-tensor/blob/75fff49ae52a2e03d1a2969b67c85d16d009e62e/LICENSE).

Evidence: source and license inspection at the pinned SHA; fit checked against Spec 02b. No git commands,
upstream execution, tests, screenshots or performance claims. Main owns the spec citation and integration.
