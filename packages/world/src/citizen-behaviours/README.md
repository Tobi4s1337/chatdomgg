# Citizen behaviours

Local, ambient presentation for the citizens main already supplies (spec 16). The policy walks present people
through gentle street routines by asking main's motion for approved destinations, notices neighbours, lets a
witnessed chat line turn a few heads, and returns
small overlays in the citizen renderer's existing vocabulary: `gesture: 'none' | 'nod' | 'wave'`, `lookYaw` and
`time`. It owns no route, body, identity, chat text, relationship or record. Routines and greetings are
presentation only: no friendship, purchase, reward, attendance or act on anyone's behalf is created or stored.

## API

```ts
import { createCitizenBehaviours, dueBehaviourSteps, BEHAVIOUR_TUNING } from './citizen-behaviours';

const policy = createCitizenBehaviours();
const step = policy.step({ kingdomId, epoch, origin, atMs, samples, ambientSlots,
  destinationsFor: slot => motion.destinationsForSlot(slot),   // main's approved places, per slot
  answers,                                                     // main's results for the previous step's goals
  cues });                                                     // main's validated CitizenChatCues, resent every step
// → { atMs, overlays, encounters, started, goals, transitions, routines, reactions, reacted, cues }
policy.present(samples, atMs);   // overlays at any render time on or after the latest step
policy.reset();                  // drop every actor, contact, cooldown, claim, routine and pose
policy.stats;                    // { actors, contacts, cooldowns, encounters, releases, claims, pending,
                                 //   reactions, cuesSeen, cuesWaiting }
```

- `samples` are main's actual `CitizenMotionSample`s at `atMs`. They are the only people the policy may animate.
  A `leaving` sample takes no part: its encounter, cooldowns, claims, routine and poses are dropped in that step.
- `ambientSlots` is the caller's allowlist of bodies ambient routines may pose or send anywhere. Walker input,
  royal acts and reserved spectacle actions are excluded by the caller. An excluded person can still be looked
  at (and greeted), but never receives an overlay or a goal; a takeover releases them in the same step and
  their routine resumes from whatever motion shows when they are handed back.
- `goals` are `CitizenGoalRequest`s for `motion.requestGoal`, at most `maxGoalsPerStep`, each starting on the next
  step. Pass `{ request, result }` for every one of them as `answers` in the next step. Acceptance is not arrival:
  a pause begins only on a sample with that `goalNodeId` and `goalReached`. An unanswered goal is retried.
- `transitions` (`request`, `refused`, `arrive`, `held`, `resume`) and `routines` (per slot: routine, activity,
  node, pattern, since/until) are slot-only views for tests and the bench. They are not persisted and carry no
  names. `encounters` / `started` are the greeting records (`startMs`, `poseAtMs`, `poseEndMs`, `endMs`,
  `glanceAtMs`).
- `cues` are main's `CitizenChatCueSchema`-validated cues. The input type is `CitizenChatCueSignal`, the cue
  without `parts`: the policy reads ID, kingdom, epoch, origin, slot, `asOf` and `expiresAt`, copies those fields
  and keeps no cue object, so the words never reach its state, output or stats. Passing the same cues on every step
  is the intended use. `reactions` / `reacted` are the active and new chat reactions (cue ID, origin, speaker,
  `speakerNods`, nod window, listeners with their look windows). `cues` notes what became of each decided cue:
  `reacted`, `coalesced`, `crowded`, `duplicate`, `expired`, `stale`, `foreign` or `absent`.
- A new kingdom, epoch or origin, or a backward clock, resets the policy. A forward gap larger than
  `maxGapMs` drops transient looks and contacts and restarts routine timers from what motion shows: nothing is
  replayed, and nobody leaves their door in step with everyone else when the clock lands.

`fixture.ts` holds the SIMULATED nine-neighbour street, the SIMULATED 240-slot town and the SIMULATED chat script
(`createSimulatedChat`) shared by the scenario test and the bench. They are labelled input fixtures, not producers, and are not exported from the barrel.

## Caller loop

`apps/web/src/citizen-behaviour-bench/loop.ts` is the one caller loop, ready for the kingdom consumer:

```ts
for (const atMs of dueBehaviourSteps(lastStepMs, nowMs)) {     // fixed 100 ms grid in kingdom time
  lastStepMs = atMs;
  motion.applyFrame(latestPublicFrame);                         // main's frame source, when it changed
  const step = policy.step({ kingdomId, epoch, origin, atMs, samples: motion.sample(atMs), ambientSlots,
    destinationsFor: slot => motion.destinationsForSlot(slot), answers });
  answers = step.goals.map(request => ({ request, result: motion.requestGoal(request) }));
}
// On a source reconnect, before the next step: policy.reset(); answers = []; lastStepMs = null (motion carries on).
const samples = motion.sample(nowMs), overlays = policy.present(samples, nowMs);
renderer.update(samples.map(s => toCitizenSample(s, overlays.get(s.slot), lookFor(s))), camera);
```

Steps sit on an absolute grid, so render cadence cannot change who greets, who goes where, or how long anyone
pauses (the scenario test replays one 400 s story at 60 Hz, 20 Hz, 4 Hz and 1.4 Hz and compares every
transition). More than `maxCatchUpSteps` due steps collapse to one, which the policy treats as a jump.

## Routines

Five authored routines, all on main's motion: the policy only chooses approved node IDs and waits for main.

- **Coming home and the doorstep.** Everyone's first walk is main's own arrival route. On every homecoming the
  person rests at their door for 12–28 s. Seven in ten glance once back toward the lane shortly after arriving
  (0.55–0.9 rad, held 1–2.2 s); about half of long rests hold one quieter glance in the middle.
- **Excursion opportunities** come 25–55 s apart, never inside the doorstep rest. At each one the person stays
  home (22 %), visits the market (24 %, when it is free and not recently refused) or strolls. Chosen once.
- **A short stroll** is one of three patterns: `door-to-door` (a place 5–16 m along their own walk, 2.2–4.2 s
  pause), `lane-end` (16–42 m, 3–6 s) or `loop` (6–24 m, then a second place 12–42 m out, at least 6 m from the
  first). Each pause holds one look along the lane (0.4–0.78 rad). The same first place is not chosen twice
  running when there is another.
- **The market visit** is a walk to the market node, a 4–9 s pause with a look over one side of the square, a
  breath, then the other side, and the walk home. Nothing is bought and nothing is recorded.
- **Returning home** ends every excursion at the person's own frontage. A refusal never strands anyone: they
  rest exactly where motion left them and ask again.
- **Neighbours notice one another** (below), at doors, at stops and in passing.

## A witnessed chat line

A sanitized `CitizenChatCue` is the only cause: no words are read, no sentiment, friendship or command is
inferred, no reply is invented and nobody walks toward anyone.

- **The reaction.** The speaker's head lifts for 160–320 ms, then one renderer nod cycle (1.047 s, phased to
  begin and end at its shallowest pitch). The closest neighbours within 10 m who can turn toward the speaker (up to
  0.65 rad past their neck limit: a line is heard, not seen) look, at most two: the first 80–350 ms after the nod
  begins, the second 160–380 ms later; each eases in over 380–520 ms, holds 1.1–2.2 s and settles over
  0.48–0.68 s. The speaker's head answers the first listener at 45 % of a full turn, while that listener looks.
  Everyone else keeps their life; walkers keep walking and only `lookYaw` changes.
- **Validity.** A cue for another kingdom, epoch or origin is `foreign`; past `expiresAt`, `expired`; said before
  this body was present in the current story (a reconnect or reset) or first heard more than 1.5 s after it was
  said, `stale` (main's bubble still shows it); for a slot with no present body, `absent`. A cue said up to a moment
  ahead waits for its `asOf`. Every decided ID is kept until 10 s past its expiry (at most 256), so every resend is a
  `duplicate`.
- **Coalescing.** One current reaction per person: a line from someone already speaking or listening, or within
  6–10 s of their own last reaction, is `coalesced`. At most one reaction per eight present people (rounded up,
  never more than four), one per 20 m neighbourhood, and starts 400 ms apart; other lines are `crowded` and only
  show their bubble. A burst therefore turns a few heads and never replays a backlog: in the SIMULATED street, six
  lines in a second (one person three times) turn two of them into reactions and move three people.
- **Interruptions.** A speaker under walker, royal or reserved control is released at once and never posed, but
  their listeners may keep looking. A listener taken over just stops (they are no longer the policy's). A speaker
  who leaves ends the reaction in the same step and their listeners ease back over 420 ms. A listener who leaves is
  dropped, and the speaker's answering look eases back. A clock jump drops every reaction and waiting cue; a reset
  forgets everything, and the same line offered again after it is `stale`.

**Known ground.** Destinations carry no walk length, and straight-line distance lies: main's hearthwick hamlet
has an inactive lane piece between `join:12` and `join:20`, so two doors 8 m apart are a 200 m walk. Each person
therefore learns, from their own motion samples only, which approved places they have actually walked past
(within 1.4 m) and how many metres along their walk from home each one is. Strolls choose from that known ground
by walked metres. With little known ground a stroll may step to an approved place within 12 m of somewhere known
(35 %, or 70 % when the only known place is the last one visited; never in their first two outings). The walk
teaches its real length, so a long way round is not chosen again. Someone with no known ground at all first walks
to the nearest approved place within 10 m of their door. This records nothing beyond the present session.

**Arrivals, refusals and control.**
- A goal is asked for only while the person stands at an actual arrival, never mid-walk. Its start is the next
  step; a pause or rest starts on the first sample that reports that goal reached.
- `blocked` / `unknown-destination` for a stop drops that stop; the person waits 2.5–5 s where they stand and
  carries on (a refused market is not asked for again for 120 s). For home it backs off from 2.5–5 s, doubling, to
  at most 30 s. `out-of-order` and lost answers are retried twice on the next step, then back off the same way.
- Stops are claimed, so two people never stand on one node; homes are never claimed. Nobody leaves while a
  greeting they are part of is under way.

## Authored tuning

All values live in `tuning.ts` and were set by watching the bench.

| Value | Setting | Why |
|---|---|---|
| Doorstep rest | 12–28 s after every homecoming | Spec band; the warm window has time to read before anyone leaves again |
| Opportunities | every 25–55 s; stay 22 %, market 24 %, stroll otherwise | Nine people over 400 s make ~35 excursions with ~40 pauses, 3 of them at the market, and ~13 greetings: a street that breathes, not a parade |
| Stroll pauses | 2.2–4.2 s / 3–6 s / 2.4–4.6 s by pattern | Long enough for one look to land and settle, short enough that a stop is a pause, not a vigil |
| Market pause | 4–9 s, two looks | Spec band; the square gets one look each way |
| Looks | in 0.56–1.0 s with an 8 % overshoot, hold 0.7–2.2 s, out 0.64–1.2 s | A toy with weight: the head arrives a touch past its angle and settles; no continuous scanning |
| First look | 0.45–1.1 s after an arrival | The body arrives and settles before the head turns |
| Pass radius | 1.4 m | Lanes are walked up to 1.1 m off centre |
| Goals per step | 8 | Bounds caller work; in the 240-slot town later slots simply wait a step |
| Notice range | 7 m, kept to 7.5 m | Main's doorsteps sit 6.2–6.7 m from the lane centre in every hamlet seed measured |
| Nod / wave | nod ≤ 4.5 m (12 % wave), wave 45 % beyond | A nod reads close; a wave carries across a lane |
| Greet chance | 72 % per contact | Leaves some meetings as a simple pass |
| Walker range | ≤ 5 m, speed ≥ 0.6 m/s | Spec's 2–5 m band; never while starting or stopping |
| Pair cooldown | 90–120 s | Spec minimum 90 s |
| Personal rest | 8–16 s after a greeting | Stops one person greeting a stream of passers |
| Gesture clock | nod one full cycle (1.047 s) from phase −π/12; wave 1.5 sways (1.178 s) | Follows the renderer's fixed curves (below) |
| Listening range | 10 m, closest two who can turn, 0.65 rad past the neck | Main's hamlet doors stand 9.0–9.1 m apart and doorstep rests face the house, so the neighbour either side sits ~90° aside |
| Chat timing | lift 160–320 ms, nod 1.047 s, looks 80–350 ms then +160–380 ms after it, hold 1.1–2.2 s | The head moves before the next head; two listeners never turn on the same frame |
| Speaker answer | 45 % of a turn toward the first listener | Reads as a shared moment without a second gesture |
| Chat storm cap | 1 per 8 people (max 4), 1 per 20 m, 400 ms apart, speaker rest 6–10 s, listener rest 3–5 s | A doorstep frame shows at most one reaction; a fast chatter does not nod every line |
| Fresh window | 1.5 s from `asOf` | A late line only shows its bubble; heads never turn for an old line |

## Renderer limit

The current renderer has no gesture weight or blend. Its nod pitch is `.14 + .12 sin(6t)` and its wave arm is
`1.75 + .22 sin(8t)` while the gesture is set, and zero otherwise. The policy phases the nod to begin and end at
its shallowest pitch (0.02 rad), so the head enters and leaves the dip almost without a step. The wave cannot be
hidden: the right arm jumps about 1.8 rad when it starts and when it ends. Waves are kept rare for that reason
and should get an eased arm weight in main's rig polish.

## Main integration at merge

- Export the barrel (`createCitizenBehaviours`, `dueBehaviourSteps`, types) from `@chatdom/world`. (Already done on
  `integration/kingdom-queue`; the new chat types come through the same barrel.)
- **Chat in `citizen-scene.ts`:** pass `cues: [...speech.values()]` into every `behaviours.step(...)`; the policy
  decides each ID once. Then drop the consumer's own speaker gesture (`speech.has(slot) … ? 'nod'`, which nods for
  the whole bubble lifetime) so the speaker's finite nod and the listeners' looks come only from the overlays. Keep
  `receiveChat`'s validation, bubbles and `speechLabels` as they are; the policy never displays or stores words.
  `resetBehaviours()` on a source change already gives the reconnect behaviour above.
- In `apps/web/src/kingdom/citizen-scene.ts`, run the caller loop above: forward `step.goals` to
  `motion.requestGoal`, pass the results back as `answers`, and pass the overlays into the renderer samples
  (with `speed` for capes); supply `ambientSlots` from actual walker/royal/reserved control ownership.
- **needs (main motion):** a home arrival ends facing the house (`homeHeading = -outward`), so a citizen resting
  on their doorstep cannot see the lane behind them; their doorstep glance is a look over the shoulder. Doorstep
  noticing needs the rest heading to face the street after arrival, or a street-facing doorstep goal.
- **needs (main motion):** `requestGoal` costs ~20 ms in the 240-home town (a whole-graph shortest-path search
  from the target and a sample of every citizen per call). The policy bounds goals to 8 per step; main may want
  a cached per-target search and a single-slot sample.
- **needs (main settlement):** `contour:1:1:6` (`join:12`→`join:20`) is inactive in the hearthwick hamlet while
  homes on both sides are lived in, splitting one street into a 200 m walk. Known ground keeps strolls off it.
  Destinations with a walk length from the slot's home would let the policy skip learning it.
- Motion has no avoidance: a walker can pass through someone paused at a stop. Stops are claimed so two pausing
  people never overlap, but passing bodies are main's.
