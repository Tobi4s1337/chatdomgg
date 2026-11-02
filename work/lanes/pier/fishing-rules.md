# PI10 fishing rules

## Decisions

- This checkpoint builds the rules, not a reachable fishing UI. No room handler is mounted until the durable
  catch writer and the visible water mood are present. A won fight is a candidate, never a claimed bag item.
- All times supplied to the domain come from its server clock. Requests contain no timestamps, position,
  seed, species, size or outcome. The room adapter must supply the current seat, owned rod and founded pose.
- Draw begins on the fishing lip. Release after 200–1600 ms casts 2–7 m from the front edge, using the current
  server yaw, within 35 degrees of outwards. Charge expires after 5 s. The float flies for 650 ms.
- The fishing lip is the front 1.1 m of the T-head, with a 0.45 m margin from both ends. The walker is grounded,
  within 0.3 m vertically of the deck, and on the current collision revision. A water sample is required at
  every 0.25 m along the cast beyond the deck: the same surface and at least 1 m of depth. The plan, adopted
  installation and pose are server inputs. No lake under land, stale revision or absent installation qualifies.
- A cast belongs to the exact seat token that drew it. Moving 0.8 m from its anchor, leaving the lip,
  disconnecting, changing collision revision or losing the rod cancels it. A new process starts with no casts.
- The environment is frozen at water landing, using the shared time mapping and water mood. A versioned seeded
  species roll selects only eligible authored content; no eligible species means refusal. Independent keyed
  random rolls choose bite wait, size and fight seed, so VFX cannot change mechanics.
- Biome comes from the trusted installation's adopted recipe identity. Landscape character and style are not
  biomes. Existing persisted plans have lost this identity: `biome: null` uses `unknown` and qualifies only
  wildcard habitats until grand-world exports the adopted biome. The site finder records `unknown` honestly.
- Wait is 4–11 s. Two nibbles at 45% and 76% of the wait precede the bite. Strike windows are 1200 ms common,
  1050 ms uncommon, 900 ms rare. The window includes its opening instant and excludes its closing instant.
  An early strike or a missed window ends the cast; repeated strikes cannot farm a new fish from one cast.
- A fight advances in 50 ms integer steps, for at most 600 steps. Inputs take effect at the next step after
  their actual server receipt; the server tape records only changed reel edges. No retrospective inputs.
  Receipt times never rewind, even if the process wall clock does. Per-cast sequence numbers strictly increase.
- Profiles are `dart`, `steady`, `surge`. All use advance warning, alternating rests/runs, and fatigue.
  Tension and progress are integers 0–10000. Holding through runs snaps; sustained slack throws the hook.
  Failure wins over landing at the same tick. No equipment, rank or payment modifies a fight or species odds.
- The replay verifier validates and bounds its entire input before stepping, recomputes from seed, profile and
  accepted tape, and compares the complete terminal result. A client-supplied tape is never a grant capability.
- A won fight stops in `landing`, with its immutable server candidate. It emits no `caught` event and grants
  nothing. The next checkpoint will atomically store catch, item and receipt, then publish catch success.
- Active casts are capped at 48 per domain, one per person. State and event queues are finite. The caller drains
  beats after every action/tick. Completed/cancelled casts leave the active map. There are no resting timers.
- Until the kingdom clock lands, `kingdomFishingHour(serverTime)` maps UTC epoch milliseconds to the real
  24-hour day; dawn [5,8), day [8,18), dusk [18,21), night otherwise. This is a single replaceable fallback,
  not a second client clock. Mood is a stable per-kingdom 30-minute bucket. It must be drawn before fishing ships.

## Ownership and interfaces

`packages/shared/src/fishing.ts` adds the strict control schema, environment types and single clock/mood mapping.
`apps/realm/src/fishing/fight.ts` owns the pure bounded fight and replay. `cast.ts` owns server cast transitions;
`cast-site.ts` owns pose/aim/water geometry. Auth, rod ownership and adopted geometry are trusted server ports,
not fields accepted from the socket. `species.ts` validates and rolls authored species supplied by the server.
Content models and definitions remain unregistered until they exist and have been reviewed visually.

The fight module exports `FIGHT_TICK_MS = 50`, `MAX_FIGHT_TICKS = 600`, `FightProfile = 'dart' | 'steady' | 'surge'`,
`FightInput { tick: number; reel: boolean }`, and `FightState` with integer `tick`, `tension`, `progress`, `slack`,
`phase: 'rest' | 'warning' | 'run'`, `tired: boolean`, `outcome: 'active' | 'landed' | 'snapped' | 'escaped' | 'timeout'`.
`createFight(seed, profile)` creates tick zero; `stepFight(state, reel)` returns the next state and never mutates
the argument. `replayFight({seed, profile, inputs, throughTick})` validates and returns a state; `verifyFight`
also takes `claimed: FightState` and returns false for malformed or altered evidence. Inputs apply before
the named step (ticks 1–600), at most one changed edge per step, initially not reeling. State contains any
additional deterministic fields required to resume/replay; verification compares all of them.

The implemented version-1 tuning starts at tension 3000. Below 800 for 30 consecutive ticks throws the hook.
Rest/warning reeling raises tension by 64/55/62 units per tick (dart/steady/surge); runs by 440/380/410.
Fatigue starts at ticks 120/140/160, reducing those loads by 18 and 110. Giving line reduces tension by 110
outside runs, while a running fish keeps it taut (+25, +15 tired). Reel progress outside runs is 78/70/75
(+35 tired), during runs 20; giving line loses 6 outside runs, 12 during runs (6 tired). Warning lasts
15/18/20 ticks. Seeded rest and run intervals vary by profile. Failure order is snap, slack, timeout, landing.
Changing these rules later requires a new replay version; persisted receipts must retain their original rules.
In 768 automated trials using only displayed tension and phase, fair catches took 10.2–16.6 seconds. This is
not human playfeel or network-latency evidence.

## References

- [TIDELINE study](references/tideline.md): one-button pressure and advance warning; independent deterministic
  mechanics, finite lifetime and server authority replace its rendering-driven rules. Ideas only, no copied code.

## Verification

Exercise fair adaptive reeling over many seeds and every profile, hold-only snap, idle escape, fatigue, exact
window boundaries, time subdivision independence, malformed/forged replay, bounded huge time jumps, sequence
retries, position/revision/seat/rod cancellation, and fresh-process cast loss without any item grant. These are
domain checks; SDK, Postgres atomicity, signed-in end-to-end fishing and visual evidence remain PI10 obligations.
