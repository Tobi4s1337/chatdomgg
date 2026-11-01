# GP10 evidence: PinkKittyRose, a kingdom of its own

## Before / after, hero view (1920×1080, real kingdom route, SwiftShader)

- Before: `before-hero@1920x1080.png` (the generic potential town on the shared grid).
- After: `shots/genesis/pinkkitty/gp10-hero@1920x1080.png`: the river town, with the river hall over the water, Bell
  Court and its landing stair, standards, statue and vane, and The Lantern and Oar on the levee upstream.
- The inn up close: `shots/genesis/pinkkitty/gp10-tavern@1920x1080.png`. This shot is the first pass of the steps,
  before the retaining wall was dressed (it read as a blank, blotchy block). The dressing (raked ashlar courses,
  pilasters, trailing roses) is built and tested but not yet seen: the recapture waited two hours for the shared
  capture lock and never ran. Re-run `capture.mjs --views tavern --tag gp10` and look before accepting the wall.

Capture: `node apps/web/src/genesis/kingdoms/pinkkitty/capture.mjs --views hero,tavern --tag gp10` (its own Vite
server on a free capture port, under the shared capture lock, with the realm's "no adopted record" reply).

## The tavern fix (review: "No reach of the town bank fits the tavern")

The river runs on its own levee: both banks fall away from the water, about 4.5 m from the crest to the meadow over
the inn's depth. The earlier search wanted a reach of bank level to within 1.75 m and found none, so the kingdom
route threw. Now:

- The inn stands as a levee house. Its floor is flush with the crest, so no ground stands above it. Its quay is founded
  at the waterline, and its back wall stands on the line that is dry along its whole length, since the river runs about
  15° askew of the plan. The jetty's far edge must stand over water across its whole width, and the deck must sit
  0.15–2.5 m above the river.
- The site is chosen after the lanes are drawn, clear of every lane corridor. It searches up and down stream of the
  hall; the lowest plinth near the hall with the shortest path wins. For these facts that is upstream, by
  Millwater Lane.
- `tavern/steps.ts` is the inn's new levee steps: a paved terrace across the front at floor level, a landing
  straight out of the porch, and a flight running down alongside the terrace wall toward the nearer lane, with
  lanterns on newel piers. The wall is coursed ashlar with pilasters and trailing roses. The seat measures the graded
  ground at the foot and adds treads to meet it.
- The keepers' tavern fixtures stand on the inn's own floor. The place is centred where its farthest fixture is
  nearest (the taproom). The sign is no keeper fixture, since no act uses it and it sits too far out for the
  innkeeper's 9 m round.
- Bell Court's fourth lamp moved down the east side so the whole round fits the lamplighter's 24 m, and lamp placement
  ignores the notional links that cross the paved square.

## Sound

The river land's sound is the Genesis biome adapter (`packages/audio/src/genesis-biomes`) on this kingdom's own
recipe and landscape. Its offline renders of PinkKittyRose's river valley (`river-day-plaza`, `river-bank-dusk`,
`river-night`, `river-rain`, `river-day-sweep`, `stream-bed`), with loudness, spectrograms and the stream mix, are in
that folder's README. It is not mounted in the kingdom route yet; see `needs:` in progress.

## Doubts

- SwiftShader only: the dusk light, lanterns and glass need a real-GPU look at
  `/kingdom/4363967` at 1920×1080 (hero view and the pose in `capture.mjs` `tavern`).
- The inn's side footing is darkStone (the shared `footings()` helper), darker than the terrace's limestone.
