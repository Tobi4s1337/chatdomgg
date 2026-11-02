# Private FW10 realm proof

`proof.mjs prepare` serves the actual durable realm composition with no model calls. `proof.mjs pilot` additionally
sends one lane-authored wish, outside the frozen twenty, through the authenticated private Herald HTTP door.
The actual coordinator, separate gates, native assembler/contact sheet, approval sink, write gate, reducer,
PostgreSQL coal ledger and public outbox decide its outcome. The pilot passes only on an authoritative delivery
with real CLI accounting, one spent coal and one durable public completion. A private non-delivery keeps the coal
and is recorded as a failed pilot. A recognized usage limit stops model calls and records `blocked: codex limit`.

Load `DATABASE_URL` privately with `node --env-file`; never print it. Set `REALM_DATABASE_SCHEMA=realm_forge_wish`,
then run the driver under `nice -n 10` with `prepare` or `pilot`. It defaults to loopback port **5173**;
`FORGE_WISH_PROOF_PORT` permits 5170–5189 except reserved 5187. A TCP reservation refuses an occupied port.
Do not run concurrently with another lane check, capture or proof process. The launcher builds into ignored
`apps/realm/src/forge-proof/dist/`, preserving native networking dependencies, and forwards termination to its
owned child. Its ten-minute deadline requests normal shutdown.
The installed uWebSockets transport ignores its hostname parameter. This harness binds only its own native
app to `127.0.0.1`, checks the native bind callback and retains the transport's socket tracking and shutdown.

The driver guards the exact search path before migrations and current schema afterwards. Each run adopts its own
new simulated kingdom and settles two simulated citizens through the production signed-tenure allocator and
native home furnisher. Every discovered slot is real. Rights and ten minutes of authored presence qualification
commit through the retained writer; the HTTP ingress refuses direct balance commands. Authenticated stream
observations must commit before coal qualification and a chat witness must precede the wish. No Twitch write,
production realm schema access, live founded-file change, copied credential or API-key fallback occurs.

Each run has a new mode-0700 directory under `/tmp/chatdom-forge-wish/`. Summaries, optional call accounting,
exact result sheets/draft metadata and realm identifiers use mode 0600. No original wish text or raw CLI output
enters accounting. A successful piece retains its authored creation input only through the normal private realm
attachment path. Database/founded proof data remains in the lane namespace and private directory for inspection;
the operator never clears a schema or unrelated rows.

A version-only probe runs inside the served process before a pilot wish can be submitted. It records finite
launch/resolution metadata, no raw output or environment values. The adapter first honors an executable on an
absolute PATH directory, then checks beside the running Node binary, changing only the child PATH. Preparation
can succeed while this probe fails; that means the realm foundation is ready, not that model access works.

Shutdown aborts HTTP and model work immediately, waits for the tracked CLI cleanup, and flushes accounting before
database release waits. Registered signal shutdown flushes too; it cannot rely only on the main function's finalizer.
The forced realm shutdown ceiling remains five seconds, and abrupt kernel/process death cannot flush memory.

This is a private integration harness. It supplies no product bypass, sign-in UI, real citizen identity or real chat
permission. It proves neither the walk's wish box nor rendered ritual timing. It does not run or replace the frozen
twenty, count toward its three-run allowance, or prove stored-sheet repeatability. Those remain FW10 acceptance work.

## Twenty and stress (FW10)

`proof.mjs twenty` sends the frozen twenty (`apps/codex/src/fixtures/fw10-wishes.ts`) through the same served realm,
one simulated citizen and home per wish, at most two in flight, with real model calls; it counts toward the frozen
set's three-run allowance. `proof.mjs stress` is the same composition with controlled answers in place of model calls
(1.5 to 4 s each): it reproduces writer contention without spending real wishes and never counts as a run.
The chat witness is resent like Herald resends it (same observation id, up to four sends) and a failed witness is
recorded per wish instead of ending the run. Both modes write `twenty.json` (fixture ids, outcomes, timings, quality),
`landed.png` (contact sheet of landed pieces), `operations.jsonl` (word-free authority notes and run faults from the
bridge's `forgeLog`) and `realm.log` (the realm's own operational lines) into the private run directory, all mode 0600.
A failed run records only a SQLSTATE or Node error code and an application message that names no host, user or address.
