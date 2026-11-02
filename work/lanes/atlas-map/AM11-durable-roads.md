# AM11: durable memory checkpoint, 2 November 2026

AM11 stays unchecked. This checkpoint builds the service's durable memory and
recovery path; the map still uses its existing road projection. No visual surface
changed, so there are no new screenshots or performance claims.

## Decisions

- `roads/ledger.ndjson` under `ATLAS_DATA_DIR` is the append-only source of truth.
  Records have sequence numbers and a SHA-256 chain. Indexes, counts and cursors
  rebuild from it. Only channel IDs and validated observations enter it; no names,
  avatars, riders, credentials or personal journeys.
- One writer holds SQLite's OS file lease for the service's lifetime. The lease
  database is not the road store and must never be unlinked to bypass a live lock.
  Process death releases the lease. Local filesystem locking and fsync are required.
- Single observations fsync before receipt. Batches of at most 200 validate their
  inputs first, write synchronously without yielding, and fsync once before any
  receipts return. Backfill uses batches of 32 and yields between them. The initial
  per-record recovery guard timed out after 120 seconds; group commit made the
  complete crash/recovery/restart demonstration finish in 33.699 seconds.
- Any uncertain append poisons the instance: it returns no success and refuses
  subsequent reads/writes until reopened. Complete corrupt records fail closed.
  Only an unterminated, unacknowledged final fragment may be removed, after the
  entire complete prefix verifies. Restart reads bounded chunks and records.
- Stable IDs deduplicate forever; changed facts under the same ID are conflicts.
  Across different sources, the same directed pair within the named 30-second
  window deduplicates, retaining durable aliases. Distinct IDs from the same source
  and reverse-direction raids remain distinct. This is a documented legacy-source
  heuristic, not a claim that the collector supplied upstream event identity.
- Event and receipt clocks remain unchanged. Out-of-order events update the
  story's minimum/maximum time. Recovered observations retain observed evidence;
  simulated and replay presentation envelopes cannot enter this product ledger.

## Connected code

The Atlas service owns and stops the road runtime. It backfills its current local
import's recorder file, pins the open file, verifies the whole file's schema,
hash, length and count in a bounded first pass, then applies it in a second pass.
No collector process or source database is opened or changed by this runtime.
The import revision checkpoint is written only after application completes.
Repeated imports and interrupted prefixes safely retry through durable IDs.

Set `ATLAS_RAID_FEED_URL` to the full raid-show `/realm/raid-roads` endpoint to
enable the existing pull seam. The consumer validates the entire bounded page,
requires witnessed resumable herald raids with provider event times, and commits
its tail cursor with the last observation. Empty pages preserve the cursor;
short pages never reset it. Each origin/path gets its own cursor namespace.
The producer's normal HTTP URL must contain no credentials, query or fragment.
One poll runs at a time, every 15 seconds after the previous pass finishes, with
an eight-second network deadline and a 256 KiB page ceiling. Closing aborts and
awaits the poll before releasing the writer. Failures log fixed source-specific
codes, never payloads or URLs. Missing producer configuration means unconnected,
not “no raids.” Recovered history has no caravan callback.

## Verification

All commands ran niced and on cores 0–8.

- 27 focused tests passed across `roads/ledger.test.ts`,
  `roads/ledger-fault.test.ts`, `roads/sources.test.ts`, and `serve.test.ts`.
  These include aliases/restarts, event-time reordering, same-source identities,
  simultaneous delivery, invalid bodies, stale cursor CAS, source-page validation,
  byte limits, partial-page retry, poisoned fsync, batch recovery, corrupt imports,
  original abort reasons, source preservation, poll isolation and shutdown.
- Scoped TypeScript including the changed modules and their tests, scoped ESLint,
  `git diff --check`, and the Surveyor production build passed.
- `apps/surveyor/src/roads/checks/recovery.mjs` ran the built service against a
  fresh isolated copy of the real owned recorder import. It refused a competing
  writer, killed its own writer with SIGKILL after 512 records and before the
  recorder checkpoint, then restarted and recovered all 58,159 expected raid IDs
  over 53,876 undirected road pairs. The canonical-ID hash matches the source.
  A further clean restart left all 33,546,237 journal bytes unchanged, SHA-256
  `5bebdee2b7efc9feaf06a605d03030b6aeebecbc2a3872e13ab7417bfb179217`.
  Both source copies retained their bytes and metadata. Evidence:
  `work/evidence/atlas-map/am11-road-recovery.json`.
- The real guard used only its own child processes at `127.0.0.2:5199`. All exited.
  No import, Twitch request, production service access, deployment or push occurred.

To repeat the manual guard, build Surveyor, then from the repository root run
`nice -n 10 taskset -c 0-8 node apps/surveyor/src/roads/checks/recovery.mjs`.
`ATLAS_DATA_DIR` selects the already verified seed; the guard creates its own
ignored `road-recovery-*` directory beside it and leaves it for inspection.

## Operator adoption and recovery

After integration, rebuild and restart the Atlas service through its operator.
Keep the road directory on durable local storage, preserve it across imports and
preview pruning, and configure the real raid-show feed URL. Existing imports need
no re-survey to seed roads. Stop the service before taking a filesystem copy of
the entire road directory. Restore that copy as a unit and let the ledger verify
it. Do not manually edit records, drop the journal, remove the writer lease, or
reset a cursor to hide corruption. An uncertain write requires a service restart;
reopening resolves it from the journal, then the producer retries safely.

## Remaining AM11 work and doubts

- Live Surveyor SSE intake and current recorder gap recovery between imports.
- Pair-aggregate reconciliation, without manufacturing individual events or times.
- Public road projections through the current visibility policy, road stories,
  provisional endpoints, sea lanes, logarithmic width and the 90-day dotted fade.
- Fresh-only public caravans, reload suppression, and the exact gate host/finder.
- Required real road/restart, sea lane, caravan and finder screenshots at all sizes.
  No live raid-show feed or real tobi4s_ raid entered this checkpoint's ledger.
- The in-memory identity/event indexes grow with permanent history even though
  file replay is bounded; measure their footprint when the read/render layer lands.

AM10's recorded card, host-CSP, real-GPU and physical-phone blockers remain open.
