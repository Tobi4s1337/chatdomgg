# Reference: TIDELINE

https://github.com/bridge-mind/tideline · MIT · studied at c8e772fa8b51bae6221630b9693178f1bebee047

For: [PI10 fishing rules](../fishing-rules.md).

## What it is

A procedural browser fishing game with explicit draw, flight, wait, bite and reel states. Its short, readable
pressure loop separates reeling from giving line. Source was inspected in a read-only clone outside the repo.
The public demo could not be opened by the web reader; this study supports mechanics, not a visual judgement.

## What we take

- `src/gameplay/reelMinigame.js:78–104`: rest, warning, run. Its 0.75 s warning is a useful minimum for reading
  a run before releasing the primary button. We retain a visible warning rather than an unexplained load spike.
- `src/gameplay/reelMinigame.js:153–189`: tension, progress and fatigue are separate, with failure checked before
  landing. Holding and releasing both have consequences; tired fish provide a readable second half.
- `src/gameplay/biteSystem.js:28–38`: two small nibbles followed by the real dip make the wait readable. Its
  4–13 s default wait (`src/data/config.js`, `src/fish/spawning.js:73`) is the scale of a beat, not a long timer.
- `src/gameplay/reelMinigame.js:198–215`: distance closes with progress, allowing the world to communicate the
  fight. Semantic phase changes can drive rod, fish, line and sound without sending render-frame updates.

## What we do differently

Our server advances integer ticks, records actual receipt-time control edges and replays before writing.
Random mechanics use independent keyed rolls. Rendering consumes no mechanical randomness. Casts have finite
lifetimes and disappear on restart; only committed catches persist. Pose, water, identity and rod checks are
authoritative. A won fight cannot emit catch success before the database transaction.

## Leave behind

Unseeded global randomness, frame delta authority, infinite missed-bite retries, render-derived launch origin,
per-frame event emission, shop gear advantages, and localStorage as catch authority. This reference's copied
look, economy, species and audio are not part of Chatdom.

## License

MIT, copyright 2026 BridgeMind (`LICENSE:1–13`). This checkpoint uses ideas only and copies no source or assets;
there is no shipped third-party code requiring a notice. Reassess if any later adaptation copies code.
