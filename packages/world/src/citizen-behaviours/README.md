# Citizen behaviours

Local, ambient presentation for the citizens main already supplies (spec 16). The policy notices people who are
present and returns small overlays in the citizen renderer's existing vocabulary: `gesture: 'none' | 'nod' |
'wave'`, `lookYaw` and `time`. It owns no route, body, identity, chat text, relationship or record. Greetings
are presentation only: no friendship, reward, attendance or act on anyone's behalf is created or stored.

## API

```ts
import { createCitizenBehaviours, dueBehaviourSteps, BEHAVIOUR_TUNING } from './citizen-behaviours';

const policy = createCitizenBehaviours();
policy.step({ kingdomId, epoch, origin, atMs, samples, ambientSlots }); // → { atMs, overlays, encounters, started }
policy.present(samples, atMs);   // overlays at any render time on or after the latest step
policy.reset();                  // drop every actor, contact, cooldown and pose
policy.stats;                    // { actors, contacts, cooldowns, encounters, releases }
```

- `samples` are main's actual `CitizenMotionSample`s at `atMs`. They are the only people the policy may animate.
  A `leaving` sample takes no part: its encounter, cooldowns and poses are dropped in that same step.
- `ambientSlots` is the caller's allowlist of bodies ambient routines may pose. Walker input, royal acts and
  reserved spectacle actions are excluded by the caller. An excluded person can still be looked at, but never
  receives an overlay; a takeover releases them in the same step.
- `encounters` / `started` are slot-only transition records (`startMs`, `poseAtMs`, `poseEndMs`, `endMs`,
  `glanceAtMs`) for tests and the bench. They are not persisted and carry no names.
- A new kingdom, epoch or origin, or a backward clock, resets the policy. A forward gap larger than
  `maxGapMs` drops transient looks and contacts; nothing is replayed.

`fixture.ts` is the SIMULATED nine-neighbour street shared by the scenario test and the bench. It is a labelled
input fixture, not a producer, and is not exported from the barrel.

## Caller loop

`apps/web/src/citizen-behaviour-bench/loop.ts` is the one caller loop, ready for the kingdom consumer:

```ts
for (const atMs of dueBehaviourSteps(lastStepMs, nowMs)) {     // fixed 100 ms grid in kingdom time
  lastStepMs = atMs;
  motion.applyFrame(latestPublicFrame);                         // main's frame source
  policy.step({ kingdomId, epoch, origin, atMs, samples: motion.sample(atMs), ambientSlots });
}
const samples = motion.sample(nowMs), overlays = policy.present(samples, nowMs);
renderer.update(samples.map(s => toCitizenSample(s, overlays.get(s.slot), lookFor(s))), camera);
```

Steps sit on an absolute grid, so render cadence cannot change who greets, when, or for how long (the scenario
test replays one story at 60 Hz, 20 Hz, 4 Hz and 1.4 Hz and compares transitions). More than
`maxCatchUpSteps` due steps collapse to one, which the policy treats as a jump.

## Routines

**Neighbours notice one another.** One spatial grid per step (cell = keep range, 3×3 query, six closest per
person with distance/slot tie-breaking). A pair that comes within range opens a *contact*; the contact is decided
once, while it stays open, from a stable `kingdom:epoch:origin:a:b:since` seed: whether to greet, who greets,
nod or wave, and every timing. Static neighbours therefore never re-greet; a fresh meeting must leave and
re-enter range, and the same pair also waits 90–120 s.

- The noticer is either **settled** (standing at a reached goal for 1.2 s) or **a walker at cruising pace**
  within 5 m. A walker keeps walking: overlays never touch heading, gait, speed or distance.
- **Both must see each other**: the other person is inside the noticer's field of view, and the noticer is
  within the other's neck limit plus 0.35 rad. Nobody greets a back, and nobody glances over their shoulder.
- Nobody greets in their first 2.5 s in the street, while fading in, or while in another encounter.
  One encounter per person at a time; that is what prevents a crowd-wide wave when one person passes many.
- Timeline: the head turns first (300–480 ms), then the gesture, a held look (250–650 ms), then the head settles
  (420–640 ms). The recipient glances 80–350 ms after the gesture begins, without a gesture of their own.
- Interruptions: a removed or departing person drops out in the same step. A surviving partner eases their head
  back over 420 ms; a gesture already under way finishes its own cycle rather than snapping off.

## Authored tuning

All values live in `tuning.ts` and were set by watching the bench.

| Value | Setting | Why |
|---|---|---|
| Notice range | 7 m, kept to 7.5 m | Main's doorsteps sit 6.2–6.7 m from the lane centre in every hamlet seed measured |
| Nod / wave | nod ≤ 4.5 m (12 % wave), wave 45 % beyond | A nod reads close; a wave carries across a lane |
| Greet chance | 72 % per contact | Leaves some meetings as a simple pass |
| Walker range | ≤ 5 m, speed ≥ 0.6 m/s | Spec's 2–5 m band; never while starting or stopping |
| Pair cooldown | 90–120 s | Spec minimum 90 s |
| Personal rest | 8–16 s after a greeting | Stops one person greeting a stream of passers |
| Gesture clock | nod one full cycle (1.047 s) from phase −π/12; wave 1.5 sways (1.178 s) | Follows the renderer's fixed curves (below) |

## Renderer limit

The current renderer has no gesture weight or blend. Its nod pitch is `.14 + .12 sin(6t)` and its wave arm is
`1.75 + .22 sin(8t)` while the gesture is set, and zero otherwise. The policy phases the nod to begin and end at
its shallowest pitch (0.02 rad), so the head enters and leaves the dip almost without a step. The wave cannot be
hidden: the right arm jumps about 1.8 rad when it starts and when it ends. Waves are kept rare for that reason
and should get an eased arm weight in main's rig polish.

## Main integration at merge

- Export the barrel (`createCitizenBehaviours`, `dueBehaviourSteps`, types) from `@chatdom/world`.
- In `apps/web/src/kingdom/citizen-scene.ts`, run the caller loop above and pass the overlays into the
  renderer samples; supply `ambientSlots` from actual walker/royal/reserved control ownership.
- **needs (main motion):** a home arrival ends facing the house (`homeHeading = -outward`), so a citizen resting
  on their doorstep cannot see the lane behind them. Doorstep noticing needs the rest heading to face the
  street after arrival, or a street-facing doorstep goal. Until then greetings come from walkers who see each
  other, and settled noticing happens wherever a resting heading faces other people.
