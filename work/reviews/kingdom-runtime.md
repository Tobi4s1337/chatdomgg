# Kingdom runtime review — 2026-10-30

Astra high independently reviewed the actual implementation and reproduced the first five findings below.
Main reviewed the changes and runtime evidence. This is an integration review, not final art approval.

| Finding | Correction and current evidence |
|---|---|
| A retired producer epoch could restore a withdrawn name | Public adapter rejects retired epochs; it fails closed at the bounded epoch budget instead of forgetting watermarks. Unit regression exercises old named → new anonymous → old higher-sequence. |
| Greedy terrain displacement opened T-junction cracks up to 0.355 m | Worker builds a conforming 1 m surface from real voxel AO/material data. Five tests cover shared edges, material provenance, bounds, triangle height and both generated tiers. |
| Failed/abandoned construction leaked resources | Caller AbortSignal plus idempotent scene disposal cover construction rejection and unmount. Browser failure/cancellation injection remains part of final acceptance. |
| Lost rendering context stayed falsely ready | Context-loss handler disposes scene, clears ready state and shows recovery UI. Runtime script observes six workers and all terminated after a dispatched context-loss event. Actual `WEBGL_lose_context` extension test remains outstanding. |
| Healthy offline frames became CONNECTION LOST | Offline/stale frames are valid transport observations; silence/error separately invokes unavailable. Unit test preserves offline status until freshness expires. |
| Names showed through a neighbouring roof | Near camera now follows the window normal. Ordered-box segment occlusion respects real air carves; regression tests cover walls, open doors and rotated homes. |
| Pane pixels sampled inconsistent presence rows | Terra high isolated the fault with depth disabled, then fixed integer slot addressing. Main viewed the clean diagnostic and production content fixture. |

Runtime browser check: simulated 0 → 1 → 240 → 0 active homes without geometry rebuilds; nearby Juniper name;
real worker construction and cleanup; no browser exceptions. Initial desktop town cost: 30 draws, 945,506
triangles, 4,850,692 light-field bytes. These are scene counts, not hardware frame-time claims.

Fixed noon/dusk/night desktop/phone captures pass current automated budgets (2 M desktop / 0.8 M phone
triangles, 120 draws, 8 MiB field). Main still rejects the current overall art result: regular rows, washed
lighting, thin beacon, empty far land and limited distant light coverage need another pass. Transition fading,
full recovery/source checks, final screenshots and arrival capture remain in PLAN §10.
