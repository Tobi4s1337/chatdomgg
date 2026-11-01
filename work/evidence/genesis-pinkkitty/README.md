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

## The crossing and its banks (session 3)

Main wired the seat's `crossing`, so the generic footbridge beside the hall is gone and the hall is the river's one
way over. What remained was the hall's two ends: its bank line is drawn about two metres above the levee crest, so
the closed far pavilion stood on a sheer pale block over a meadow falling three metres away, and the town end's
flanks showed the same blank stone either side of the landing.

- `packages/content/src/genesis-kingdoms/pinkkitty/abutment/` wraps each abutment in a battered revetment, in the
  hall's own frame: a stepped apron at about 1 in 3 (a cell out every three down) under a cream band at the bank
  line, in limestone with the odd grey and cream stone, founded a metre under the ground the host measures for each
  four-cell block. A first pass at 1 in 6 with buttresses (`s2-hero`) still stood as a pale prow with notched blocks
  on its flank; the buttresses went and the apron got gentler.
- At the far end the apron alone still followed the ground down into the hollow at the levee's foot and ended in a
  coursed point (`s3-hero`, `s3-farbank`). Bridges meet ground like this on an approach bank, so the far end now
  has one: turf in half-metre blocks, 1.5 m under the bank line at the wall and falling a block per block outward
  (the meadow's own terraces are half-metre bands), tapering off toward the river along the flanks. Stone shows
  from the bank line down to the turf.
- The far end becomes a balcony over the far meadow: a parapet with a darkStone coping and roses, and a quoined pier
  at each corner with an iron fire basket, so the far end is lit from the far bank as the landing lights the town side.
- A border of the kingdom's roses on the far meadow at the bank's toe, each where the ground lies flat enough to stand one.
- `capture.mjs` gains the `crossing` (from downstream on the water) and `farbank` poses, finds PinkKittyRose's holding in
  the survey and zooms the Atlas in on it until its mark is drawn (a 140-viewer town is not drawn at the opening view),
  and requeues for the shared lock every four minutes (see Doubts).

Evidence (this folder; SwiftShader, 1920×1080, the real kingdom route):

- `s4-before-after-hero.png`: main's `shots/genesis/4363967@1920x1080.png` (the generic potential town) beside
  `s4-hero@1920x1080.png`, the river town from its hero view.
- `gp10-hero-crop.png` (before) and `s4-hero-crop.png` (after), the same crop of the hero: the hall before this session (sheer far abutment, dark footing,
  the generic footbridge beside it) and after (revetment, balcony, approach bank, roses; no footbridge).
- `s3-crossing@1920x1080.png`: the three arches over the water, the far apron stepping down, the landing on the right.
  Taken before the approach bank went in.
- `s2-tavern@1920x1080.png`: the Lantern and Oar's dressed retaining wall, now seen: coursed ashlar, pilasters and
  trailing roses read as masonry. Accepted.
- `s4-atlas-card@1920x1080.png` and `s4-atlas-door@1920x1080.png`: the holding's card in Retro & Speedruns, and
  "See this kingdom's land" opening the kingdom at its hero view.
- `s4-compare@1920x1080.png`: labels covered. The_AGGman's harbour hamlet, PinkKittyRose's river town, MashaD4's mountain
  city (from their lanes' latest shots) and Willowmere's evening stream view. The river hall over its levee river, the
  red-roofed hearth homes and Crown Hill's castle make this one recognisable without its name.

## Sound

The river land's sound is the Genesis biome adapter (`packages/audio/src/genesis-biomes`) on this kingdom's own
recipe and landscape. Its offline renders of PinkKittyRose's river valley (`river-day-plaza`, `river-bank-dusk`,
`river-night`, `river-rain`, `river-day-sweep`, `stream-bed`), with loudness, spectrograms and the stream mix, are in
that folder's README. It is not mounted in the kingdom route yet; see `needs:` in progress.

## Doubts

- The far approach bank is turf in quarter-metre steps with the odd tussock. In the hero it reads as a green earthwork.
  Up close it may still read as terraced: the final far-bank still (`--views farbank --tag s5`) was stopped by the host's
  capture guard at 10 min while main waited, so the finer bank has only been seen in the hero.
- The host's capture guard measures a lane's hold from when the lock's supervisor process started, so time spent
  queueing counts as holding: two single stills were stopped the instant they got the lock (after 10 and 27 minutes in
  the queue). `capture.mjs` now requeues every four minutes to stay clear of that; the guard itself is the conductor's.
- The Atlas card's arms (drawn by the Atlas from the channel id: per pale Gules and Argent, three suns) differ from the
  kingdom's own crest (drawn from the profile colours). That is two lanes' heraldry meeting at the door.

- SwiftShader only: the dusk light, lanterns and glass need a real-GPU look at
  `/kingdom/4363967` at 1920×1080 (hero view and the pose in `capture.mjs` `tavern`).
- The inn's side footing is darkStone (the shared `footings()` helper), darker than the terrace's limestone.
