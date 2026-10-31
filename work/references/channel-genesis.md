# Reference: channel Genesis

For [spec 39](../specs/39-channel-genesis.md). Studied 2026-10-31. Source-only study; no reference implementation was run or copied.

## Sources

- [Watabou TownGeneratorOS](https://github.com/watabou/TownGeneratorOS), GPL-3.0,
  `7fbc87a9398cc508af24de93f79cf2ad027f352b`.
- [ProbableTrain MapGenerator](https://github.com/ProbableTrain/MapGenerator), LGPL-3.0-only,
  `f487e4cee321d105d5b0e14258363fa8b4d004ef`.
- Existing [organic towns study](organic-towns.md) covers the broader street-generation techniques.

## What they do well

Watabou composes a town around meaningful civic places. Its build order establishes patches and topology before
streets, wards and final geometry. MapGenerator treats water as a real spatial exclusion in road sampling.
These are useful foundations for channel geography with a castle, Old Row, a plaza and a road home.

## What we take

1. **Land and civic anchors before streets.** Watabou's
   `Source/com/watabou/towngenerator/building/Model.hx:87` orders patches → junctions → walls → streets → wards → geometry;
   `:99` generates/relaxes regions and `:127` assigns plaza/citadel regions. Our recipe establishes water, hills,
   settlement reserve and semantic place IDs before any allocator proposes streets or lots. An anchor is a proposal,
   not yet a grounded, navigable building placement.
2. **Independent random domains.** Watabou's `Source/com/watabou/utils/Random.hx:10` owns a single global seed;
   `Model.hx:69` resets it and consumes plaza/citadel/wall decisions immediately. Chatdom instead hashes a labelled
   feature slot plus the full broadcaster seed key. Adding a banner or emote must never move the coast. The full
   decimal Twitch ID remains the identity; a 32-bit terrain seed cannot be a scene hash or database key.
3. **Water constrains usable land.** MapGenerator's `src/ts/impl/tensor_field.ts:85` returns a zero tensor off land;
   `:119` excludes sea and river. Our ocean/island sampler and the existing river sampler must both feed collision,
   road validation and grading. Painting water over a dry navigation surface is unacceptable.

## What we do differently

One read-only Luna low scout checked source ordering and seed behavior; the Genesis architect reviewed those findings
against the actual source. No source code was adapted. MapGenerator's `src/ts/impl/streamlines.ts:298` uses
`Math.random()` for road seeds; do not carry that into deterministic founding. Neither reference supplies Chatdom's
immutable deeds, live-only ceremony, moderation lineage, arbitrary future growth or presence model.

The existing Chatdom v2 land grammar handles level-topped hills, lakes and downhill streams. It cannot express a dry
island inside an ocean. The new local `genesis-coast-1` sampler composes mainland shore and island land masks over
those primitives. It remains a separate versioned seam until main promotes a terrain dispatch and both consumers.

## Leave behind and license

No reference look, assets, global regeneration, unbounded retry loop or shared global RNG. Both references are
copyleft under the repository's policy, so this work takes ideas only and implements them independently.
No third-party attribution-file mutation is needed because no code or assets were copied.
