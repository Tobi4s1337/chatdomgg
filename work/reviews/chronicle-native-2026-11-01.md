# Native Chronicle read and replay review

The actual product route opens the durable Chronicle and promotes real historical geometry in the kingdom renderer. The current implementation does not meet the watchability bar. CH02 remains unchecked.

The isolated simulated authority witnessed 42 stream nights for 3 synthetic citizens through 170 ordered facts, including 3 actual guarded home constructions and civic stages. It uses the real allocation, qualification, growth planner, repository fencing and reducer. It grants no coals and sends nothing to Twitch. Public history reconstructs the full digested prefix, selects witnessed stream nights by their UTC start day while preserving source sequence, and publishes only existing public projections plus public stream transitions. Private rights/coal/reservation facts cannot create public entries. Historical lights and chat are explicitly unrecorded.

The native capture reached a complete, settled first historical scene after roughly 3.5 minutes including initial live-scene startup on SwiftShader. The held live renderer was suspended while authority/feed subscriptions stayed attached. A seek to entry 26 eventually promoted another real scene. The next bridge revision then consumed the short playback interval: DOM controls advanced26 → 27 before trimming, and all 60 samples of the encoded 30-second tail remain on entry 27. No home tier change appears in that clip. This demonstrates correct source provenance and real geometry, and fails the promised playback pace. These CPU-renderer observations are not real-GPU frame timing measurements.

Evidence, all actual product-route captures:

- `work/evidence/chronicle-native/chronicle-durable-first@1440x900.png`: exact first encoded frame; the caption reads October 15, entry 27. The target facade, its neighbours and distant castle read clearly; parchment stays legible. No historical light/crowd is fabricated.
- `work/evidence/chronicle-native/chronicle-durable-simulated-30s.webm`: 30 seconds, no audio verification.
- `work/evidence/chronicle-native/chronicle-durable-30s-01.png`, `-02.png`, `-03.png`: all 60 samples at 2 fps, covering 0–29.5 seconds in order; reviewed. They show the static held entry and preparation message, not weeks passing.
- `work/evidence/chronicle-native/record.json`: provenance, encoded-clip caveat and the isolated harness’s unavailable Dock context.

The captured snapshot predates the promoted-candidate lifetime correction. That correction is source-tested: seek cancellation aborts only preparation; after promotion the overlay owns scene lifetime. A later same-hash seek cannot dispose the already displayed engine, and real render errors check that lifetime rather than an obsolete seek signal. The prior candidate signal also explains why static pixels alone were insufficient proof of an active replay engine. No additional native capture matrix was run after this correction.

## Next required optimization

Keep one isolated replay renderer and reuse its unchanged world. At present every new scene hash constructs another complete kingdom: terrain, shader/post stack, water, voxel worker pool, native content, shadow/light systems and a WebGL context, even when one bridge or one home changed. Suspending the retained live RAF removes competing work but does not remove this per-revision rebuild.

Cache immutable meshed assets by public asset hash, material-registry identity, mesher version and LOD. Keep static terrain/street data keyed by exact adopted layout revision. For each selected complete scene, compare placements by stable ID and exact asset/transform, prepare missing assets on demand, then replace the changed presentation atomically. Remove absent placements and attachments too, so backward seeks remain full-state replacement. Reuse existing geometry for identical assets across snapshots and keep the same renderer/shaders/context.

Mesh/placement replacement must update sun-shadow casters, light blockers and the relevant light fields together; merely hiding old instances leaves false historical shadows and illumination. Preserve the candidate lifetime/abort generation checks and retain the displayed snapshot until all required resources can show the replacement. Own and dispose the bounded geometry cache with the replay host; do not copy historical events into live feeds or change authority.

Then repeat one native clip across the actual bridge stage and cottage→house construction, plus a backward seek and close/live restoration. The clip must show geometry changing while its matching caption advances, without a whole-world loading pause. Phone composition and real-GPU timing remain unverified for the integrated replay.
