# Spec 16: Citizens at ease in their kingdom

Status: **frozen 2026-10-30; launch-ready after main commits the handoff.** Actual motion, renderer, cue and
optional default bench route exist. Production kingdom policy wiring is main's merge responsibility.

Vision: `chatdom/ChatDom.md` §§2–6, principles 5–9 and 15–18; `chatdom/World-Tree.md` §2 rules 1–2 and 6–7,
§3 People, §6 Acts and §14 Decided; `chatdom/Moments.md` §§2, 6 and 9;
`chatdom/Artstyle-Soul-Feel.md` §§7–8; `chatdom/Quality.md` rules 3–5 and 20.

## What and why

A citizen settles on their doorstep, notices a passing neighbour, and gives a small nod. Another takes the
longer way around their street, pauses beside the market, looks at its bustle and goes home. When a real chat
message arrives, its speaker makes a small nod and a nearby citizen can turn to look. These are
authored toy routines: an anticipation, a clear pose, a gentle settle, and plenty of stillness between them.
The nine people in a hamlet should feel like nine distinct people sharing a place. A capital should retain that
warmth without synchronised gestures, a constant parade or a fabricated audience. This lane adds the local
behaviour policy and demonstrates it through main's actual citizen motion/rendering path. It grants no action,
friendship, progress or social claim on anyone's behalf.

## Current state

- `packages/shared/src/presence.ts` defines `KingdomPresenceFrame`: public visual slots, presence, optional
  public names, origin and freshness. It deliberately contains no chat text, private person ID or source leases.
  `PresenceFeed` is a window/presence projection, never a chat transport.
- `packages/world/src/settlement/types.ts` defines the active street graph, each home's actual `approachId`,
  the market's `nodeId` and stable visual `slot`. `homeFrame` supplies home orientation. These are navigation
  inputs, not permission to author a second router.
- `packages/world/src/citizens/index.ts` exports `createCitizenMotion(plan)` and actual motion/destination/
  goal types through `@chatdom/world`. The implemented goal seam is documented below; it is no longer an
  arrival-only API. `packages/world/src/citizens/motion.test.ts` covers motion/routing; do not re-prove it here.
- `apps/web/src/citizens/index.ts` exports the actual `createCitizenRenderer`, `CitizenSample` and
  `createDefaultCitizenLooks`. It supports distance-driven gait, `gesture: 'none' | 'nod' | 'wave'`, `lookYaw`
  and `time`. There is no separate `speak` pose or timed pose-request protocol. The lane composes existing
  sample fields as a local pure policy; it never implements bone transforms, rig evaluation or another renderer.
- `packages/shared/src/citizen-chat.ts` already defines `CitizenChatCue`, exported through `@chatdom/shared`.
  `apps/web/src/kingdom/citizen-scene.ts` consumes sanitized cues for actual bubbles/simple nods. Main integrates
  this lane's policy into that consumer at merge; the bench calls the same production motion and renderer APIs.
- The current kingdom source is labelled **SIMULATED**. Every present citizen has a body under the latest
  founder direction; anonymous slots retain anonymous presentation. This supersedes the older near-home-only
  idle/body distinction for this consumer. A live chat-cue producer is not established by the simulation bench.

## Rules

1. **R1 — Only the people supplied by main.** Consume the current present motion slots; never mint an actor,
   name, chat message, quiet viewer, townsperson or background mannequin. The same slot has one body. An
   anonymous citizen remains anonymous. Keep **SIMULATED** visible on every bench view/capture and preserve
   origin through cues and outputs. No Twitch writes, attendance inference, fabricated histories, rewards,
   votes, friendship increments, engagement counters or persistent social records come from a routine.
2. **R2 — One motion owner.** Behaviour selects approved destination IDs and submits semantic intentions.
   Main owns active graph routing, collision, avoidance, ground height, safe stopping, headings during travel,
   speed, travelled distance and phase. Never draw a straight line to a destination, relocate a citizen,
   replace a path, change `distance`, or pause them halfway through a crossing. Wait for accepted goal/arrival
   feedback. An unavailable route leaves the citizen calmly in a legal resting state, with a bounded retry;
   it never teleports or spins through alternatives every frame.
3. **R3 — Five complete, gentle routines.** Author doorstep settling, a short street stroll, an occasional
   market visit, returning home, and noticing/greeting a passing neighbour. Each excursion ends at its real
   home frontage; homes and tenure do not move. Use only main-approved reachable active graph destinations.
   A market visit is walking, a look and a pause, never a purchase, transaction or invented game. A person
   without a reachable market still has a complete home/street routine. An already walking citizen finishes
   the current safe route segment before changing goals. Returning home is an ordinary routine, never an
   inference that the person left Twitch or a public moderation signal.
4. **R4 — Authored variety and room to rest.** Use a small authored set of routine patterns and stable
   slot/epoch-seeded timing choices. No `Math.random()`, `Date.now()`, frame-count timing or noise curves.
   Initial tuning: 12–28 s of home rest, 25–55 s between excursion opportunities, 4–9 s market pauses,
   0.7–1.5 s small gestures, and at least 90 s before the same pair greets again. These are presentation
   tuning bands, not rewards or personality claims. Select once at a state transition, not every tick.
   Diversity comes from meaningful choices, unequal pauses, modest pose timing and different routes; it must
   survive a fixed seed and must not become a jittering crowd. Tune the values by looking and record final
   authored values in the owned module README rather than adding configurable product sliders.
5. **R5 — Neighbours notice one another without claiming a relationship.** A mild nod or brief wave may occur
   when two present citizens pass within roughly 2–5 m at a safe stopping/standing location. At most one
   recipient and one active greeting per citizen. A greeting has a short look, pose and settle; the recipient
   may glance back with a seeded 80–350 ms delay. Do not force a player-controlled or monarch-controlled body
   into a response. No touch, hug, high five, approach pursuit, fabricated speech bubble or relationship
   milestone. Use a spatial neighbourhood lookup and stable tie-breaking, not all-pairs search. No crowd-wide
   wave when one neighbour comes within range.
6. **R6 — Chat has an observed cause.** Consume only main's explicit, sanitized, short-lived `CitizenChatCue`.
   Deduplicate by cue ID, reject expired/foreign-origin cues and ignore cues for missing slots. The speaker
   may look up and give one small nod using the existing renderer vocabulary. At most two nearby eligible listeners
   briefly look toward the speaker, with staggered timing; everyone else keeps their current life. Do not
   infer sentiment, friendship or commands from text, repeat a message, invent replies, or turn every line
   into applause. Main's chat-bubble consumer alone displays the supplied text. Behaviour never copies text
   into its state, intentions, logs, presence frame or diagnostic export. No cue produces movement toward a
   speaker. A burst coalesces to one current reaction per actor and never replays a backlog.
7. **R7 — Clear interruption rules.** Explicit walker input, royal acts, departures and main's reserved
   spectacle actions take priority over ambient routines. A walker or monarch may be looked at but is never
   steered or gestured by this policy. Drop a missing slot's goals, pair cooldown references and poses in the
   same update. Epoch changes and stale/offline/cleared input reset transient behaviour and do not replay old
   greetings/cues on reconnect. Do not keep a departing body public so it can finish a wave. A chat look can
   change `lookYaw` over idle or walking only; it cannot reset gait, travelled distance or root heading.
8. **R8 — Bounded local work.** Main supplies only the currently represented citizens to animate; a 50,000
   audience is not permission to animate 50,000 full bodies. Behaviour must retain no state for omitted slots
   and invent no replacements. Build the neighbourhood index once per policy step, keep transient state
   proportional to supplied actors, and cap queued cues/intentions. No new renderer, animation texture format,
   LOD system, frame-timing dashboard or simulation service. Use elapsed kingdom time and main's actual motion
   feedback; rendering rate cannot change who greets, where anyone goes or how long a pause lasts.

## Contracts

### Landed shared and motion inputs

Import `CitizenChatCue`, `KingdomPresenceFrame` and `Vec3` through `@chatdom/shared`. The actual cue fields
are `version`, `id`, `kingdomId`, `epoch`, `origin: 'live' | 'simulated'`, `slot`, `asOf`, `expiresAt`, and
`parts` (text/emote discriminated records). There is no top-level `text` field. The schema caps lifetime at
ten seconds and bounds text/emote lengths. Policy reads only identity/source/timing/slot and never retains
`parts`. Compare kingdom, epoch, origin and expiry against current input before reacting. No cue or body field
is added to `KingdomPresenceFrame`; private ingress is inaccessible to this module.

Import `createCitizenMotion`, `CitizenMotion`, `CitizenMotionSample`, `CitizenDestination`,
`CitizenGoalRequest` and `CitizenGoalResult` from `@chatdom/world`. The existing APIs are:

```ts
motion.applyFrame(frame): boolean;
motion.sample(atMs): readonly CitizenMotionSample[];
motion.destinationsForSlot(slot): readonly CitizenDestination[];
motion.requestGoal({slot, nodeId, startAtMs}): CitizenGoalResult;
motion.routeForSlot(slot): CitizenRoute | undefined;
motion.clear(): void;
```

A destination is `{nodeId, kind: 'home' | 'street' | 'market', position}`; destinations are per-slot, not a
shared list with an invented owner field. They are approved active-graph destinations generated by main.
A sample includes `slot`, `publicName`, `state: 'walking' | 'home' | 'idle' | 'leaving'`, `position`, `heading`,
`speed`, `distance`, `walkPhase`, `homeLit`, `homeLitAtMs`, `opacity`, `goalNodeId` and `goalReached`.
Goal result is `{accepted:true}` or `{accepted:false, reason:'absent' | 'unknown-destination' |
'out-of-order' | 'blocked'}`. Request acceptance is not arrival. Start a pause only when the later sample has
that `goalNodeId` and `goalReached === true`; on rejection use a bounded retry and safe rest. Do not invent a
`reached|blocked` feedback union on samples or infer arrival from elapsed time/distance to a point.

### Lane-owned pure policy on the existing renderer vocabulary

`packages/world/src/citizen-behaviours/index.ts` exports `createCitizenBehaviours`, its small readonly input/
output types, and authored tuning. Define those **local** types in the owned subtree; no shared wire protocol
or renderer dependency belongs in world policy. Inputs include kingdom time/epoch/origin/ID, present motion
samples, per-slot approved destinations, explicit `ambientSlots: ReadonlySet<number>`, separate cue array and
actual goal accept/reject results from the previous step. The bench supplies the allowlist from its labelled
simulation control state; main supplies it from actual walker/royal/reserved control ownership at integration.
Do not infer the allowlist from a public name, subscription, rank or presence alone.

Outputs contain bounded `CitizenGoalRequest` values plus per-slot presentation overlays using only existing
`gesture: 'none' | 'nod' | 'wave'`, `lookYaw` and `time` fields. Derive relative look yaw from actual sample
positions/headings, clamp and ease it in the policy, and keep root heading/moving/distance untouched. Gesture
time is explicit seconds relative to its start. Missing/expired presentation returns to normal idle; no
`speak` field, new pose queue or direct skeleton access. The current renderer has no gesture-weight blend:
use restrained finite nods/waves, review their transitions, and report any remaining abrupt arm transition
for main's renderer polish at merge. Do not claim the existing renderer implements anticipation/settle that
it cannot express. This limit is not a blocker for the actual policy/bench contract.

The controller has explicit `reset()` and a deterministic `step(input)` (no browser listeners); clearing it
drops all transient actors/cues/cooldowns. On each fixed policy step, the caller samples actual motion,
invokes policy, forwards returned goals to `requestGoal`, retains real results for the next step, then maps
motion samples plus current overlays to `CitizenSample` for the returned renderer's `update(...)`. Use a small
fixed kingdom-time policy step independent of rendering cadence; bounded catch-up must not replay a greeting
backlog after a large clock jump. Keep one explicit caller loop in the bench, ready for main to reuse at merge.

The default Solid component in `apps/web/src/citizen-behaviour-bench/index.tsx` mounts at
`/-/citizen-behaviour` through main's optional route hook. It uses `createCitizenMotion`,
`createCitizenRenderer`, `createDefaultCitizenLooks`, real settlement generation, voxel worker/material/light
modules and lane policy. No alternate route solver, gait or pose evaluator. It may use relative source imports
for the lane policy until main integrates package barrel exports. Main wires the real kingdom policy consumer
and ambient-control allowlist at merge. These are explicit main integration follow-ups, not fake live behavior
or reasons to require a new shared protocol before the lane starts.

**Handoff readiness:** `apps/web/src/main.tsx` now maps `/-/citizen-behaviour` to the optional default
`citizen-behaviour-bench/index.tsx` component. The actual motion/renderer/cue contracts above exist. Main commits
those hooks and this handoff before creating the lane; the team starts the worker. Main's actual kingdom
caller/allowlist/barrel integration remains an explicit merge follow-up, not a missing lane input.

## Scope

Lane `crowd-behaviour` · branch `lane/crowd-behaviour` · worktree `../worktrees/crowd-behaviour`.

May write **only** `packages/world/src/citizen-behaviours/**`,
`apps/web/src/citizen-behaviour-bench/**`, and this lane's PRD/progress. The world subtree includes its focused
test and concise API/routine README; the bench subtree includes its capture script. Main owns package barrel
exports, optional app route hooks, the cue schema/producer, `packages/world/src/citizens/**`, settlement and
routing, `apps/web/src/citizens/**`, kingdom integration and animation. All shared contracts, package manifests, root
scripts, work references and other lanes are read-only. You are not alone in the codebase: accommodate others'
edits and never revert them. Follow `$ralph-lane`; root creates the branch/worktree and integrates the result.

## Acceptance

Run from the lane worktree after each coherent task:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/world/src/citizen-behaviours/behaviours.test.ts
pnpm test
pnpm build
```

Keep **one useful scenario-driven policy seam test** in that file. Feed the same nine-person fixture through
main's actual motion adapter and policy: a safe neighbour encounter, a stroll with delayed/blocked arrival,
a market pause followed by home, a duplicate/expired chat burst, explicit control takeover and a removed slot.
Assert visible intentions have real present actors and causes; a pause cannot begin before arrival; no
blocked goal teleports; control/removal cancels ambient intent; duplicate cues cannot restart reactions; replay
with different render sample intervals gives the same semantic transition times. Use actual adapter feedback,
not a mock that unconditionally declares every goal reached. Do not snapshot catalogue data or create a test
per pose. One directed long-step/reset case may live in the same scenario where it catches timer catch-up.

Use a free documented port in 5170–5199; 5190 remains main's preview and 5193/5194 remain team-reserved. Start
only the preview you own, for example:

```sh
pnpm --filter @chatdom/web preview --port 5196 --strictPort
node apps/web/src/citizen-behaviour-bench/capture.mjs --base-url http://127.0.0.1:5196
```

The capture script follows `$look`: headless Chrome/SwiftShader, seed and fixed kingdom time, readiness after
the real motion and geometry/material assets have produced a meaningful frame, and failure on browser/worker
errors. The bench sets `window.__chatdomReady === true` only after that first meaningful frame; captures wait
for it. Provide deterministic scenario controls in the bench to reach doorstep/greeting, street passing,
market pause, return-home, chat burst and takeover/removal; these controls act only on labelled simulation.
Screenshots are captured at 1440×900 and 390×844, plus a 1920×1080 stream-distance composition and 1280×720
legibility check. Capture a small timed contact sheet of anticipation/pose/settle for greeting and chat look;
a single frozen pose is not motion evidence. Save under `shots/citizen-behaviour/`, then open every contact
sheet and representative full frames with `view_image`. Judge nine-person and 240-slot scenes at dusk, with
one midday pass to reveal foot sliding and hand/body intersections. The 240-slot fixture uses main's existing
representation budget; it never implies a performance claim for 50,000 rendered bodies.

Record what was seen: asynchronous people, clear safe pauses, return-home completion, anonymous presentation,
no gesture storm on chat bursts, no route/pose jump on a goal interruption, and no stale cue after reconnect.
Root runs `pnpm verify` on integration and wires policy/goals/overlays into the kingdom consumer at merge. SwiftShader establishes
appearance only. Any needed real-GPU check belongs in the final evidence block, with path/viewport/action;
do not expand this lane into crowd benchmarking or infrastructure work.

## Quality bar

Read the person before the routine. Heads turn slightly before the hand moves; a wave has a clear silhouette
and one soft settle, rather than continuous wrist noise. The market has time to breathe. Neighbours can pass
without both stopping; walkers always retain their movement. Repeated frames look authored rather than
machine-synchronised. Warm window light remains the evidence of presence; behaviour adds no glow or status.
Feet, capes and hands retain main's existing grounded animation and clearances. Reuse the real wardrobe,
lighting and citizen renderer, with simple readable bench controls and **SIMULATED** labelling. No generated
portraits, particle celebration, auto speech, artificial shopping UI or fake successful social act.

## References

- `work/references/crowd-animation.md`: take stable citizen timing, actual-distance gait continuity, masked
  upper-body actions, restrained 80–350 ms reaction staggering and shared attachment pose. Its source has no
  verified license: original implementation only. Do not import its random schedules or crowd-count claims.
- `work/references/settlement-streets.md`: active streets and real approaches determine destinations; policy
  cannot route through reservations or use geometric proximity as proof of reachability.
- `chatdom/Artstyle-Soul-Feel.md` §§7–8: authored poses, modest anticipation/overshoot/settle, heads noticing a
  speaker, and slight habit/timing diversity. The existing reference study suffices; no new research lane.

## Not now

This lane does not own locomotion, collision, navigation graphs, rendering/LOD, cloth or face animation,
network authority, live Twitch ingestion, chat transport/bubbles, moderation, presence leases, rewards,
friendship/consented paired acts, shops, games, townsfolk, companions, spectacle choreography or monarch acts.
The routines are complete ambient presentation for supplied citizens; missing main-owned hooks are explicit
integration needs, never permission for a parallel simulation or a fake live producer.

## Decisions

- **2026-10-30 — Gentle life, no invented engagement.** Ambient strolling, small greetings and market looks
  are local visual routines. They create no witnessed social fact, progress, paid priority or stored relation.
- **2026-10-30 — Follow the founder's current body direction.** Every present citizen has a body, including
  the current labelled simulation's anonymous visual slots. The main-owned presence projection alone controls
  which slots exist. No extra body-eligibility server protocol is introduced by this lane.
- **2026-10-30 — Existing goal and pose fields suffice.** `destinationsForSlot`, `requestGoal`,
  `goalNodeId`/`goalReached` are implemented. Policy produces existing `none|nod|wave`, `lookYaw` and `time`
  overlays, not a new timed pose protocol. Main owns rig evaluation and kingdom wiring at merge. A finite
  current renderer gesture may have a visible transition; record actual evidence rather than claiming a blend.
- **2026-10-30 — Separate chat cue exists.** The bounded public `CitizenChatCue` has explicit origin and
  `parts`. Chat text never enters `PresenceFeed`, policy state, emitted intentions or logs. Main's current
  simulation can supply cues; live delivery remains unclaimed until a real producer is supplied and checked.
