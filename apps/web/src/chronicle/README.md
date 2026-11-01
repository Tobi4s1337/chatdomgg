# Chronicle consumer

`mountChronicle` accepts an ordered, complete `History` and a host-owned `ReplayBinding`. `replace` must atomically replace the isolated replay presentation from the supplied snapshot, including backward seeks; it must not deliver historical beats to live feeds. `clear` removes the replay, and `dispose` restores or reveals the live presentation without touching its movement, chat or state. Host integration and export wiring belong to main. Invalid histories or unavailable scene revisions show an unavailable state rather than a stale success.

`bench.html` is a local SIMULATED demonstration. Its home and market construction revisions are explicit fixture facts; no qualification stage is treated as proof of construction. The fixed generated castle, streets, other civic sites and other homes are scenery, not a historical reconstruction. It makes no endpoint or persistent record.

Main still needs a durable, versioned history contract with ordering, timestamps, provenance, redaction and complete world snapshots or deterministic reconstruction; authoritative bindings for home geometry, civic places, castle and streets; and a live/replay isolation and restoration port. Current `GrowthSceneFrame` is a bounded current projection, not that history.

To capture the local bench, run `node apps/web/src/chronicle/capture.mjs` from the workspace root. It selects a free permitted capture port, holds the shared capture lock only while running, waits safely if the host is full, and uses SwiftShader. This bench is not a production route.
