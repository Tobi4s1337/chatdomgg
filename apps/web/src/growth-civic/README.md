# Civic growth attachment

`createGrowthCivicAdapter` is a read-only consumer of `GrowthSceneFeed`. It validates the full snapshot and
checks its origin against the feed label before using civic levels. The recent beat window is not an animation
or credit queue. The adapter does not mutate the feed, plots, existing scene or authority.

Supply one local-to-adapter `Matrix4` for each place, a Hearth or Tide style, and the actual humpback bridge
water and bank heights. Positions are metres; blueprint and effect coordinates are build cells (0.125 m).
The adapter copies the matrices. `attach(parent)` moves the one owned group and can be repeated; it does not
own the parent. `reset()` is mandatory before a kingdom replacement or backward replay seek and clears the
accepted sequence and owned additions. `dispose()` unsubscribes, fences pending work and removes its group.

Each factory returns a detached, exclusively owned object and a disposer for its resources. Geometry, civic
light and water factories are required: the host is responsible for translating the supplied local anchors
into its own renderer, including the tavern panes and bridge lamps. Do not dispose a shared host material in
an owned disposer. The original forge already has a flame; coordinate that light to avoid doubling it. The
content README documents clearances and the bridge alignment. No geometry is mounted automatically into the
founded kingdom, and no claim is made that the test fixture is the kingdom.

Use `onWaiting` for the initial state, after a successful reset, and while changed levels are being built. Use `onUnavailable` to show an unavailable
state without discarding the last rendered snapshot. `onReady`
fires only when every place matches the accepted snapshot, including recovery after an unavailable state;
it receives a snapshot with the recent beat tail removed. A failed build can be retried by delivering the
same latest snapshot. Old sequences, level regressions, wrong origins and unreset kingdom changes are rejected.
The host must keep its LIVE/SIMULATED label visible and must not treat these callbacks as authority or credit.

The local mounted fixture shows SIMULATED snapshots 1 and 2 on a composed set of supplied anchors. Capture
with `node apps/web/src/growth-civic/capture-mounted.mjs`; it uses the host capture lock and safe port helper.
