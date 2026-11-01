# Civic sites in the founded scene — 2026-11-01

Four compatible civic places now have actual physical sites. The full five-place growth outcome remains OPEN:
the authored Forge growth kit does not fit the accepted hero workshop and roads, and is deliberately uninstalled.
`FoundedSceneBuild.civicUnavailable` reports this incompatibility. The existing workshop, hearth and dragon are
preserved byte-for-byte; no generic fixture replaces them.

`apps/realm/src/founded/civic-growth.ts` plans fixed mature footprints from the adopted plan and pinned native
fixtures. Every future home reservation and installed walking road is excluded. Only trees in a chosen footprint
are cleared, and those trees are absent from both rendering and collision. Sites reserve their mature shape and
entrance from level one. No owned home or attachment participates in siting or gets moved.

The tavern, market and castle court use real terrain-supported masonry foundations. The bridge spans an actual
sampled lake cove, derives its water/bank cell heights from the site, and carries masonry footings plus stepped
approaches to dry land. The bridge factory and growth form now support deeper actual sites with dynamic vertical
envelopes, while their existing review-site bytes stay unchanged. Missing sites produce explicit diagnostics;
they never bring down the accepted kingdom or produce a substitute over occupied ground.

The assembly hook publishes the exact content hashes and placements for both client meshes and authoritative
collision. `state.growth.civic.levels` selects the physical forms. The provider's normal and native-claim cache
paths include the civic snapshot, so civic-only growth cannot reuse stale geometry. The client must add only
public glow/water over these immutable placements; it must not mount the fixture adapter's geometry a second time.

Stable placements: `civic:growth:v1:{tavern,market,castle-court,bridge}`;
`civic:site:v1:bridge:span` contains the actual water/bank pair in its blueprint ID. Additional foundation,
bridge footing and landing placements are ordinary hashed civic solids. No live service, database or authority
fact was changed by this work.

## Evidence

- Focused civic suite: 4/4 passing, including real doorway/bridge standing clearance, stable plots/poses,
  content-hash change across levels, civic-only provider invalidation, and unavailable-site diagnostics.
- Bridge/growth-civic content suites: 59/59 passing, including deeper-water envelopes and full walking clearance.
- Scoped ESLint: passed.
- Read-only proposed assembly against actual public Willowmere plan `settlement:2:43cffdb6`, numeric kingdom
  `129634568`, 240 homes: passed. Level one to four changes four civic assets and no home placements. The accepted
  workshop and hearth hashes are unchanged. Exact receipt and poses are in
  `work/evidence/growth-civic-sites/willowmere-readonly-assembly.json`. This checked proposed geometry against the
  real public plan; it did not load or alter a live private database or publish a manifest.
- Visual capture and final integration typecheck are owned by main and its capture/client workers.

## Still open

Forge level growth needs content that expands the accepted hero workshop without crossing its adjacent roads.
The four-site checkpoint must not be described as completion of all five civic places. Real GPU appearance and
performance remain the normal founder-device check; SwiftShader timing is not evidence of frame rate.
