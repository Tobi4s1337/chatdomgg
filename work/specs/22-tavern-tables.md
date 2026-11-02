# Spec 22: the tavern, a shared room whose tables are games

Status: **frozen experience and lane-local design, 2026-10-30; shared transport freeze required before production integration.**
Vision: `chatdom/ChatDom.md` principles 8–12, 15–18 and §5; `chatdom/Moments.md` §4;
`chatdom/Tech.md` §§6.4, 10.1–10.3, 11; `chatdom/Safety.md` §§3.1, 4–6 and Decided;
`chatdom/Artstyle-Soul-Feel.md` §§7–11, 14, 17; `chatdom/Quality.md`.

## What and why

A citizen crosses the tavern threshold and the same room warms into paint. Familiar people gather at the hearth,
lean against the bar and watch tiny games moving on wooden tables. Walking closer reveals the board; sitting draws
the camera into its own painted world. A person can join with a message from Twitch, or ask an empty table for a
new game in their own words. The cloth unrolls and the checked game opens there. Good games remain on the kingdom's
shelf and the monarch can crown one, with its maker's name. This is a real shared place with a real authoritative
game runtime, not a catalogue screen, local-only minigames or a demonstration of a model. Watch, chat and walk are
complete ways to belong, from nine people sharing one table to a capital with many tables and a streamer's crowd.

## Current state

- `packages/shared/src/identity.ts:4` supplies distinct `PersonId`/`KingdomId` identity domains and
  bounded tokens/times. `events.ts:14` supplies `createIntentSchema`/`createFactSchema`; these are envelopes, not
  a match catalogue or authenticated authority. Use these existing exports, never copy their definitions.
- `packages/shared/src/presence.ts` supplies public `KingdomPresenceFrame` and `PresenceFeed`. A local window slot
  is expressly not a citizen identity, authenticated seat, following age or permission to play.
- `packages/shared/src/citizen-chat.ts` is a short-lived public speech cue. It cannot supply trusted game commands,
  a durable move log, role assignment or private seat data.
- `packages/world/src/layout.ts` and `settlement/**` produce the current kingdom; `apps/web/src/kingdom/scene.ts`
  owns its scene, renderer, camera, clock and citizen integration. `apps/web/src/main.tsx` owns route mounting.
  There is currently no tavern zone, MatchRoom, Chalk interpreter, game catalogue or Taster service in this repo.
  Moments' statement that Tableware already exists describes the earlier design, not committed code here.
- `apps/codex/src/run.ts` and `providers/**` implement the Forge-specific run and judges. Reuse provider capability
  through main's adapter; do not call a Forge request schema a game spell or treat its verdict as a game approval.
- `work/references/table-games.md` records the studied authority/projection precedent. Spec 21/campfire consumes
  the same bounded engine for Dusk Court; it owns `packages/games/src/dusk-court/**`.

## Rules

1. **R1 — A room with continuity.** Build the traversable voxel tavern, threshold, bar, hearth, notice board,
   streamer's corner, tables, working seats and routes between them. Main mounts its geometry in the existing layer;
   walking through the door changes zone and blends the painterly pass without a route reload, camera cut or new
   LayerRoom. Use the same citizens and free cursor/camera. Furniture blocks movement; nobody can block a door.
   The miniature, public sign, table view and seated board are projections of the same match. Avoid a separate
   disconnected painted backdrop. Empty seats remain empty; a keeper is plainly a keeper, never a fake viewer.
2. **R2 — Shared tables.** A table has one authoritative match across kingdom layers. A 1 Hz public directory
   summary drives every layer's miniature/sign, including real watchers, phase and public activity. Sitting reserves
   a server-bound seat, with explicit lease/reconnect/leave states; watching never claims a seat. Expiry, stale
   summary and host failure have honest UI. Match ownership is independent of a LayerRoom restart. Large kingdoms
   show nearby tables and bounded avatars; remote tables still exist and are reachable, without cloning the
   streamer's match per layer. A hamlet has a beautifully composed usable table, not an oversized empty hall.
3. **R3 — Chalk is bounded data.** Implement a strict versioned manifest and total interpreter, the Trestle host
   module, Tableware presentation vocabulary and Royal Taster. No generated JavaScript, eval, network, files,
   imports, unbounded recursion/loops, wall-clock reads or runtime callback supplied by a prompt. All randomness
   uses persisted server seed/cursor; all time comes from the injected authority clock. Phases have absolute
   deadlines, deterministic timeout actions, round limits and terminal outcomes. State is at most 64 KiB encoded. Initial local safety limits are AST depth 32 / 4,096 nodes,
   64 phases, 64 actions per phase, 64 entries per collection, 256 effects and 50,000 interpreted operations per
   command, 4 KiB command payload and 32 KiB per audience view; reject before execution/encoding on overflow.
   Vetted helpers have separate bounded input/cost checks; caps may tighten with evidence, never silently widen. Expensive jobs and
   bots deeper than level 2 run outside the room event loop. QuickJS is unnecessary unless a small vetted helper
   really needs it; if used it hosts only our authored helpers on quickjs-ng 0.16+, with explicit memory/fuel caps.
4. **R4 — Privacy is semantics.** Declare public, per-seat and server-only variables. Derive safe spectator,
   stream, team and authenticated-seat views before encoding or diffing. Legal action predicates, errors/acks,
   phase changes, deadlines, miniature summaries and logs are part of those views. Taint propagates through values
   and control flow; hidden data cannot alter a lower-visibility observable except at an explicit legal reveal.
   Simultaneous private choices resolve together at their common public deadline, without a hidden-role countdown
   or public submission counter. Same public moves in two worlds differing only in invisible state yield identical
   observable traces until declared reveal. Authoritative snapshots, RNG state and secret action arguments never
   reach browser code, director, Chronicle or public debug endpoints. Crown/deep checks cannot weaken this rule.
5. **R5 — Real games, an authored catalogue.** Ship the five named experiences: Herald's Quiz (checked question
   pack, timed answers/scoring), King's Chalk (bounded drawing/guessing rounds with checked word packs), Crown vs
   Crowd (complete legal chess, including promotion, castling, en passant, repetition/draw/timeout rules), Liar's Dice
   (private cups, legal bids/challenges and finite elimination), Lantern Regatta (public course, simultaneous route
   choices, finite race/weather rules). Document the precise rules/tutorial and all settings per family. Support
   about twelve genuinely distinct authored rule families: those five plus finite trick-taking, matching pairs,
   public grid alignment, drafting, cooperative puzzle, bluffing cards and auction-for-points families. These names
   describe the rules catalogue, not twelve buttons at the entrance. Each has actual end-to-end play and its full
   finite settings grid checked before selection. Use deterministic reviewed helper code for chess/geometry, never
   a fake opening script. King's Chalk drawings are bounded strokes with moderated public release; no arbitrary
   drawing or free text is broadcast before its required checks. Its answer matching stays server-side.
6. **R6 — Four complete chat modes.** At the streamer's table support chat as one player, many individual players,
   teams and selected seats. A single authenticated chat command joins or acts; input is normalized by main's Herald
   port and deduplicated by Twitch identity across transports/layers. Trust gates eligibility, never vote weight;
   subscriptions/Bits never buy influence, seats, priority or score. Collective turns use 20 s vote windows plus
   measured stream delay, shown clearly on stream; a snapshotted delay and main's ad-pause input define the deadline.
   Ties/zero votes have published deterministic rules. Chat's dice cup is explicitly public on stream when chat
   plays one seat; no interface promises that seat secrecy. Other seats retain their privacy. At other tables a
   player needs a seat; a passerby may always watch. Main, not this lane, sends any Twitch prediction or chat write.
7. **R7 — Words become a checked game.** At an empty table, reuse a verified shelf match in under 1 s where possible;
   otherwise a real Codex run chooses a verified family, finite settings, fixed house-rule options, library board
   style/pieces and checked skin text. It also states testable prompt promises. A 10–20 s table-dressing ritual
   follows actual observed work; it never fakes a completed check. The game agent runs read-only with scratch storage and only narrow compile/preview/taste tools: no publish,
   credentials, arbitrary process execution or network beyond main's tool service. The host runs input and final
   judges outside the agent context, then Taster jobs outside the room. Judge exact composed public words/skin
   independently of maker trust, tier or money; only a safe released result reaches a public sink. Sound rules, bounded termination, seat fairness, promise
   fulfillment and two-world trace secrecy must all pass for that immutable hash. Failed/timed-out/unsure checks
   do not publish. Give the maker a clear private status and retry/nearest-family choice. Softening is disclosed
   before generation; holds/refusals never appear on the table, notice board, stream or public logs with the prompt,
   maker, reason or timing that identifies them. No anonymous refusal spectacle is required by this lane.
8. **R8 — Full new-rules path, evidence switch.** Implement constrained Chalk generation, verification, rejection,
   trace persistence and nearest verified variant handling. Keep new-rules activation off until at least 60 of
   100 real chat prompts pass every check, with the corpus/report pinned and main explicitly admitting that evidence.
   Synthetic prompts and mocks cannot satisfy this gate. It is a production switch, not permission to leave the
   path unimplemented. Launch family variants retain the same external safety gates. No roulette/slots premise,
   sexual/drinking coercion, stakes, currency entry fee, real-person pieces or rule harming homes/standing.
9. **R9 — Games stay, crowns mean something.** Persist a played game's immutable manifest, author identity/credit,
   lineage, rule/style/settings versions and exact verification report on the kingdom shelf. Prompt copies reuse
   the checked hash; edits create a new version and invalidate prior approval. Crown requests trigger deep Taster,
   Codex polish with a changelog, re-checks and recorded human plays before only the monarch's one-gesture crown.
   Declined/pending crown states stay honest. Export/import checked crowned games between kingdoms with author
   credit and origin/lineage retained. Recipient kingdom safety approval remains required; cross-kingdom
   re-crowning policy is a main/founder decision, not silently invented here. Ordinary adoption cannot forge a
   royal crown. Hide/revoke propagates to derivatives, summaries and shelf access through main's policy port.
10. **R10 — Durable play, no local rewards.** Host command acceptance, revision/state, RNG/timers, result and outbox
    are persisted atomically through a storage port. Duplicate intent or restarted result delivery cannot apply
    twice. Resume after tab/server/layer failure without redealing or extending a deadline for an advantage.
    Uncrowned games return the `practice` reward classification; matches emit typed results only. Kingdom/ledger
    ownership is main's, and games never mint balances, ranks, copies, trophies or permanent standing directly.
    No progress disappears when a person leaves. Abort is a witnessed terminal state, never a fabricated win.
11. **R11 — Every table has its own hand.** Quiz is illuminated manuscript; Chalk slate; chess oil-painted board
    with restrained move arrows; dice a candlelit close-up; regatta watercolour. Draw game state using one
    Tableware vocabulary of cards/dice/tokens/grids/hands/bids, with genuine interactive affordances. Generated
    art is a reviewed immutable board-style library supplied by main/art lane, never on-demand board skins.
    Miniatures are voxel, with recognisable game silhouettes. Cloth unroll, cup rattle, piece settle, chalk scrape
    and return-to-room have physical sounds through the host audio bus; no new context, stream speech or autoplay.
    Text is readable at phone/stream sizes, touch targets at least 44 CSS px, focus/keyboard rules complete, and
    reduced motion changes camera choreography without changing match deadlines or hiding public facts.
12. **R12 — Honest development and bounded cost.** Bench fixtures, generated bot participants and simulated crowd
    are visibly SIMULATED in every view/capture. Live mode with missing services stays unavailable rather than
    filling with bots. Aim for <=12 additional room draws on phone / 24 desktop for its painterly treatment, one
    extra interior light on phone / four desktop, and no per-frame texture baking or validation. Measure/report
    actual scene costs and Taster jobs; do not claim real-GPU timing from SwiftShader or copy prototype throughput.

## Contracts

### Existing shared contracts (consume exactly)

`PersonId`, `KingdomId`, `EpochMsSchema`, `TokenSchema`, `Sha256Schema`, `createIntentSchema`,
`createFactSchema`, `KingdomPresenceFrame` and `PresenceFeed` already exist in `@chatdom/shared`.
None grants authentication, seat ownership, moderation permission or a game publish decision.

### Main-owned missing shared groups (freeze before production adapters)

Main must create/test the actual symbols and representative hostile fixtures; this spec intentionally does not
claim these names or shapes already exist. Report `needs:` rather than duplicating a guessed protocol:

- Authenticated room/match identity, actor-to-seat capabilities, leases/reconnect and layer-zone membership.
- Versioned bounded manifest reference, public 1 Hz table summary and audience-view envelope; move/timeout/tally
  commands, expected revision, idempotent ack and typed terminal result with practice classification.
- Crowd window IDs, identity deduplication, trust eligibility, stream-delay samples and ad-pause authority.
- Game spell request/observed phases, external judge verdict/report references, safe publish/hide/revoke and
  crown authority; persistence/outbox and kingdom result consumption.

Main owns shared auth/room catalogues, realm adapter registration, route hooks, environment/dependencies and final
integration. Local modules can be built/tested through explicit ports before those groups freeze; no production
route or browser transport may serialize a lane-local authoritative snapshot as an expedient protocol.

### Lane-local engine API (new work, not frozen shared network types)

The lane implements these named exports in `packages/games/src/index.ts`, with browser-safe type/view exports
separate from server-only interpreter/host modules. Its first task documents exact discriminated types and tests
before families consume them; compatible additions serve campfire without editing its subtree:

- `ChalkManifest`, `CompiledChalk`, `ChalkSnapshot`, `ChalkCommand`, `ChalkAudience`, `ChalkView`, `ChalkStep`,
  `TasterReport`; `compileChalk`, `createChalkMatch`, `advanceChalkMatch`, `projectChalkView`.
- `compileChalk(manifest)` returns a validated compiled plan or diagnostics, never executes supplied code.
  The manifest has finite typed variables with visibility labels, phases/deadlines, actions/guards, ordered effects,
  explicit reveals, limits, terminal rules, settings domains, promise predicates and presentation references.
- `createChalkMatch(compiled, {seed, now, seats})` initializes a server snapshot; `advanceChalkMatch(compiled,
  snapshot, command, {now})` is deterministic and returns next snapshot plus public/private projected events or
  a safe rejected-step result. The host resolves actor identity before building a command. Commands discriminate
  move, persisted timeout-token and validated public tally; carry expected revision and idempotency key.
- Snapshot includes revision, phase, round, absolute deadline, RNG cursor, variable partitions and hidden
  submissions. `projectChalkView(compiled, snapshot, audience)` returns only permitted values, safe legal actions,
  public phase/deadline and viewer-safe events. Never export a live snapshot from a browser-safe entry point.
- Support per-seat roles, server RNG assignment, simultaneous secret choices, public vote/revote, bounded effect
  priority, owner-only investigation and a hard round limit for campfire's Dusk Court. Its authored manifest and
  tests live exclusively in `packages/games/src/dusk-court/**`; this lane tests the common primitives using small
  neutral fixtures rather than duplicating Dusk Court content.
- `apps/taster/src/index.ts` exports server-only `runTaster` over a bounded manifest/job plus injected limits,
  cancellation and deterministic seeds, returning `TasterReport`. Fail closed on incomplete/expired jobs.

The host adapter never treats a client-supplied timeout or actor field as authority.

Host adapters (lane-local `apps/realm/src/matches/tavern/**`) compose the pure host with injected auth, durable
storage/transaction, clock, RNG initialization, audience delivery and result outbox ports. Game spell code
(`apps/codex/src/games/**`) takes provider/judge/report/store ports; no credentials or provider implementation is
hardcoded. A real local durable harness exercises these modules; in-memory mocks alone cannot establish R10.
Main supplies production ports and entry registration, rather than rebuilding the lane's domain behavior.

## Scope

May write `packages/games/**` **except** `packages/games/src/dusk-court/**`, `apps/taster/**`,
`apps/web/src/tavern/**`, `apps/realm/src/matches/tavern/**`, `apps/codex/src/games/**`,
`work/specs/22-tavern-tables.md`, `work/lanes/tavern-tables/{PRD.md,progress.txt}`.
Tests, owned bench HTML/entry, capture script, README and credits live within these subtrees. New package manifests
inside new owned packages are allowed; root/workspace lockfile, existing manifests and barrels remain main-owned.
Generated evidence goes to ignored `shots/tavern-tables/**` or `/tmp/chatdom-tavern-tables/**`.
Everything else is read-only, especially `packages/shared`, `world`, `render`, `content`, `audio`, the kingdom scene,
main.tsx, existing Codex providers, Herald, panel, root scripts and Dusk Court's subtree. You are not alone; preserve
other edits, never widen scope or implement another lane's work. Main owns branch/worktree creation and merges.
The study reference note is authored in the spec-writing turn; implementation workers read it, not rewrite it.

## Acceptance

Run from the repository root after each coherent task:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/games apps/taster apps/realm/src/matches/tavern apps/codex/src/games apps/web/src/tavern
pnpm build
```

Tests must prove behavior, not just schema acceptance: all authored family/settings combinations complete with
legal play; seeded replay reproduces state; illegal/out-of-turn/stale/oversized moves do not mutate; no-activity
timeouts finish; King’s Chalk cannot expose an unapproved stroke/word. Whole-family verification enumerates every
supported finite setting combination, uses rotated seats/paired seeds, reports sample sizes and confidence bounds
against per-family fairness criteria (not one universal 50% target for asymmetric/cooperative games). Every setting
has a completion bound and witnessed tests for each prompt promise. No failed/unvisited setting can inherit a pass.
Taster never labels playout sampling a proof of all possible play; static bounds/taint provide the corresponding
structural guarantees. Save reproducible reports with seeds, manifest/runtime/check versions and diagnostic traces.

Plant at least four leak mutations: hidden cup changes legal actions; secret role changes phase/deadline; hidden
submission enters a log/error/summary; hidden state leaks only after two public moves. Require compile/Taster failure.
Check spectator, other seat, own seat, team and stream views over sync, update, reconnect, logs and summary. Compare
full observable traces, including errors and ack shape; a single snapshot equality assertion is insufficient.

Exercise real durable host modules through a local harness: two browser contexts at the same table plus spectator;
simultaneous seat claim; forged actor/crown; duplicate move; disconnect/rejoin; tab close; host restart mid-secret
phase; layer restart; timeout while nobody is connected; crash between result commit and delivery; duplicate result
redelivery; hidden/revoked game and derivative access. Resume the same revision/RNG/deadline and deliver one result.
Run 50,000 simulated unique chat identities through vote deduplication/window closure outside rendering, report
bounded state/bytes/event-loop work, and show nine-person shared play without inventing people.

Create and run:

```sh
node apps/web/src/tavern/capture.mjs
```

Its standalone owned Vite bench may open `/src/tavern/bench/index.html` before main's route hook. Acquire
`acquireCaptureLock` from `packages/testing/capture-lock.mjs` before any owned server/browser, including with
`--base-url`. Use Chrome/SwiftShader, serial captures, a free port 5170–5199 (5190 main; 5193/5194 reserved), owned
process cleanup and `finally` lock release. Never remove the shared lock or kill another process. Mark
`window.__chatdomReady` only after actual room, avatars, miniatures and board assets render. Fail on console/page/
worker errors. Capture 1440×900 and 390×844 web, 1920×1080 stream and 318×496 panel projection harness: threshold
outside/inside continuity, hamlet and busy room, walking/spectating, all five boards, seat camera push/return,
prompt preparation/pending/approved result, stale/reconnect and crown/author plaque. Label all harness data
SIMULATED. Open contact sheets and representative full frames with `view_image` using `$look`, repair occlusion,
clipping, generic materials, tiny controls or secret-state leaks. Record actual listening or listening limitation
for physical table sounds. Provide motion/reduced-motion evidence. Main runs `pnpm verify` and reviews integrated
kingdom/stream/panel paths after merging; the operator is not the production integration acceptance.

## Quality bar

A warm room full of people whose presence is true. The miniature looks worth approaching; the transition makes
sitting feel like entering the table's world; a missed connection feels like waiting at a real table with friends.
No card-grid game lobby, dashboard chrome, browser-default form, fake watcher count, placeholder board image,
permanent full-screen modal or unreviewed model skin. Use Artstyle §§10–11 and Quality's slop list at every size.
The tavern must be pleasant to watch without reading instructions or opening another screen.

**Art dependency:** main/art lane supplies reviewed board-style images, piece sets, licenses and content hashes
for illuminated manuscript, slate, oil, candlelit dice and watercolour before visual acceptance. This code lane
owns authored voxel furniture/miniatures and shaders/presentation but never generates substitute bitmap art.
Missing art is a `needs:` item; procedural placeholders are not shippable acceptance evidence.

## References

- `work/references/table-games.md`: authoritative serialized moves, per-audience projection before patches,
  persistence/reconnect; Chatdom adds total data, taint and trace checks. No framework/lobby or code import assumed.
- `work/references/prototypes.md`: learn the injected clock/event/effect seam; leave browser-owned state, fake
  crowd and heuristic approvals behind. Earlier prototypes are evidence, not production code.
- `work/references/crowd-animation.md`, `citizen-motion.md`: real people, bounded nearby presentation and common
  time; no fabricated tavern citizens and no independent animation architecture.
- `work/references/voxel-meshing-light.md`, `sky-fog-time.md`: reuse the voxel/material/light system; interior
  treatment blends locally and never changes the kingdom's presence-window brightness.

## Not now

Production auth/LayerRoom integration, shared protocol ownership, root route registration, Twitch writes,
LiveKit/voice, ledger/reward minting, board-image generation, Dusk Court content, Royal Audience and theatre
belong to their named owners. They are integration seams, not cuts to the shared tavern or prompted games.
Unrestricted code execution and gambling stakes never belong in Chatdom. New rules are implemented with the
founder's evidence activation gate, not enabled by synthetic success. No production infrastructure deployment.

## Decisions

- **2026-10-30 — Main explicitly delegated bounded engine and Taster implementation to this lane.** Use
  `packages/games`, replacing PLAN's earlier prospective `packages/chalk` path for this handoff. Main retains
  shared/auth/routing authority and reviews the interpreter/privacy core before production admission.
- **2026-10-30 — Dusk Court shares one engine.** Campfire owns only its content subtree under this package;
  this lane owns the common primitives and excludes that subtree. The APIs above are new lane-local implementation
  targets, not claims of an existing frozen shared game protocol. Shared groups must freeze before live adapters.
- **2026-10-30 — Full scope, honest readiness.** All named games, roughly twelve verified families, prompt
  variants, gated new rules, shelf and crown pipeline belong in this lane. The code lane does not substitute
  missing shared contracts or board art with a fake live success. Main supplies those dependencies before handoff
  is described as production-ready; worker can make independent visible progress through the truthful bench.
