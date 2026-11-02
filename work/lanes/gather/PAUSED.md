# Gather paused

Resumed 2026-11-02 06:20: the lane continues from this state (see the last progress line). The evidence and parked paths below still hold.

Explicit user pause. Last green commit: `79c1f050`. GA10 remains unchecked.

The original Dice desktop capture was cancelled through its live handle and completed with exit 130 before lease acquisition. The log contains only waiting/queued lines. No realm, preview, game result or new screenshot started; phone was never queued. The former active record at `/tmp/chatdom-gather/ga10-dice-sounded-desktop.active.json` now records terminal cancellation. Do not poll/reuse it as a live job.

The startup-recovery check is written and passes (2026-11-02, `apps/realm/src/games/turn-tables.test.ts`, "interrupts Pong once when startup loses the acknowledgement and its read-back"). The first startup commits the Pong interruption, loses its acknowledgement and its read-back, and refuses to open. A fresh startup finds the interruption durable and writes no second one. Stones keeps its state and turn clock, and Dice keeps its private draw sequence, byte for byte.

Prerequisite evidence: `work/evidence/gather/ga10-native-db-prerequisite.json`. The temporary native PostgreSQL 17.11 binaries are installed only in `/tmp/chatdom-gather/native-pg-deps`; their version command works, but no cluster or server was started. This execution namespace maps UID/GID 0 only, and the non-root child probe failed. Native checks still need a supported non-root execution context or isolated configured database. No host configuration changed.

On explicit resume, follow the lane protocol from current state, preserve this evidence, and choose the next unblocked GA10 requirement. The west-chair browser approach and same-person replacement remain blocked and must not be retried blindly.
