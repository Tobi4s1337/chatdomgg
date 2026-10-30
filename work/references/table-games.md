# Reference: boardgame.io

https://github.com/boardgameio/boardgame.io · MIT · studied at `47adef2b46e375999931209ba7b41e9654c506e1`, 2026-10-30.
For: spec 22, the tavern's Chalk/Trestle/Tableware/Taster boundary, shared with Dusk Court.

## What it is

A mature turn-based game host with authoritative moves, phases, storage, reconnect, audience-specific state and
logs. Its useful precedent is separating game semantics from transport and presentation. This study is about runtime
architecture, not its lobby or visual identity. The source was downloaded to
`/tmp/chatdom-refs/boardgameio-boardgame.io` from the GitHub tarball at the revision above; no reference code was run.
A scout (`gpt-6-luna`, low) mapped authority/projection/persistence and tests; the spec author inspected the projection
and move-processing implementation and judged what fits. Primary documentation was also inspected:
[concepts](https://boardgame.io/documentation/), [secret state](https://boardgame.io/documentation/secret-state.html).

## What we take

- Mandatory server identity and serialized mutation: `src/master/master.ts:167–207` checks actions/authentication;
  `:266–301` checks active player, legal move and state revision; `src/server/transport/socketio.ts:187–200,276–281`
  queues work per match. Chatdom always binds a seat to authenticated identity, rejects stale revisions, and uses
  idempotency rather than treating a reconnect as a fresh move. No numeric coercion of Twitch IDs.
- Project before encoding/diffing: `src/master/filter-player-view.ts:17–77` filters sync/update and computes a patch
  from the already filtered old/new states. It clears undo/redo and applies plugin projections. Spectator and stream
  views require equally explicit projection; private state is never sent to a renderer for it to hide.
- Filter every side channel: `src/master/filter-player-view.ts:86–120` redacts marked move arguments; RNG plugin
  `src/plugins/plugin-random.ts:13–38` strips random state. In Chatdom logs, actions, legal-move availability,
  errors/acks, summaries, phase timing, debug and recovery routes are all audience outputs. None may carry the
  server snapshot. Private submissions are not public progress counters.
- Persist resumable semantics: `src/master/master.ts:478–549` reloads state/log/initial state for sync;
  `src/server/db/flatfile.ts:85–143` stores state and logs. Chatdom persists match revision, RNG cursor, deadlines,
  accepted commands and completion outbox atomically through its host storage port, including after process death.
- Tests establish useful examples, not a proof: `src/master/filter-player-view.test.ts:19–148,170–324` covers
  audience sync/patch and log redaction. Add Chatdom mutation tests that intentionally leak a hidden value through
  a derived public field, legal action, error, deadline or log; replay moves in two worlds and require detection.

## What we do differently

Chalk is strict data interpreted by our bounded, total interpreter. boardgame.io's JavaScript move/lifecycle
callbacks (`src/core/flow.ts:43–196,303–393`, `src/types.ts:232–376`) cannot prove totality, visibility or termination.
We use a finite expression/effect grammar, visibility taint including control flow, explicit declassification,
whole-family settings validation and two-world trace checks. Chess may use a vetted deterministic helper, never
prompted code. The room has no heavyweight bot or Taster loop. Public stream views are separate from a streamer's
private seat. The shared room is a kingdom place; there is no matchmaking lobby. None of its UI/assets are adopted.

## Leave behind

Optional authentication, arbitrary generated JavaScript, client-visible undo snapshots, metadata that inadvertently
carries credentials, numeric player-ID equality, a browser-owned clock, runtime callback escape hatches, and assuming
one redacted field establishes privacy. No adoption claim about production throughput or contemporary maintenance is
made; SwiftShader screenshots cannot establish game-loop CPU or real-GPU performance.

## License

`LICENSE:1–20` is MIT. This spec takes architecture and techniques only and ships no copied code or assets.
Any later adaptation must retain source attribution/license headers and add the adapted paths to `THIRD_PARTY.md`.
