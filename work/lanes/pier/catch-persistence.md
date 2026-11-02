# PI10 atomic catch persistence

## Decisions

- One confirmed win writes one append-only catch row, its item grant receipt, item and history through the
  existing `ItemStore.transaction` and `RealmItems.grant(input, tx)`. No second connection or nested transaction.
  No fishing channel is mounted by this checkpoint. Real content and visible mood still precede mounting.
- The writer accepts only the trusted room sender and cast id. It obtains the current candidate from the
  server domain, never as an argument supplied by a browser or a submitted replay. A receipt already committed
  for this owner/kingdom/origin/cast is recoverable after expiry, disconnect or restart with a new valid seat.
- Capture the actual retained kingdom handle's `kingdomId`, `origin`, `writerEpoch` and `current`. Do not
  acquire another writer. Inside the item transaction, lock `realm_kingdoms FOR UPDATE`, verify that exact
  epoch/origin and lease expiry against database `clock_timestamp`, then repeat the fence as the last SQL
  statement before commit. Recheck local current/seat/candidate after awaits. Leave realm sequence untouched;
  fishing facts live in their own durable ledger and do not forge world reducer facts.
- Lock ordering is item advisory lock, kingdom lease row, then person, session and entry rows in explicit
  separate statements. This matches sign-in's person upsert before old-session revocation. A joined lock
  query cannot guarantee row-mark order. The core writer never takes the item advisory lock. Review this
  order again if a future core transaction grants items.
- Admission uses the real realm authenticator on this transaction's query capability. Lock the entry,
  session and person rows `FOR SHARE`, in the order above, before checking it. Revocation/identity changes then either precede this
  check or wait until its commit. Read approved public name from the locked person row; null is `a citizen`.
  No caller supplies a display name. Both admission checks use the same connection, including pool size one.
- A new write rechecks candidate identity/expiry/seat/rod/revision and the replay at both ends of the callback.
  Recompute species, size and fight seed from private cast seed and frozen environment; compare complete roll
  and terminal fight. Candidate gains private `castSeed`, `anchor` and `collisionRevision` for that audit.
- The first personal catch is a separate storied item; ordinary later common/uncommon catches stack. Rare
  fish are individual storied records. Only keepsakes will be numbered, never an ordinary fish. Determine
  firsts under the existing kingdom item lock and enforce unique personal and kingdom first indexes in SQL.
  Firsts are scoped to origin as well as kingdom, so test catches never become live firsts.
- The grant key is stable from cast id. A retry returns the same catch and current redacted item, even after
  the item moved or its spare stack was released. Never resurrect a spent stack. A cast id belonging to
  another owner refuses with the same private text as a missing cast.
- `0017c_realm_pier_catches.sql` adds the ledger and indexes. It references the existing item and grant
  receipt, checks record/column agreement and size, and refuses UPDATE/DELETE. Never edit 0017 or 0017b.
- No success callback, `caught` beat, domain cleanup or notification occurs before confirmed commit.
  The item service's ordinary post-commit push is safe because the catch is in that same commit. A confirmed
  retry can finish the old cast. An uncertain COMMIT returns an explicit uncertain result and retains the
  original cast id; the next call resolves its receipt before considering a new candidate. It never mints a
  different grant. Definite storage errors propagate as the existing typed unavailable error, not fake success.
- `postgresItemCommitGuard(tx, current)` registers at most 16 synchronous local checks. The store closes all
  transaction/query capabilities after awaiting the work callback, runs the guards, then sends COMMIT with
  no intervening await. This closes the callback-resolution microtask gap and prevents SQL behind the final
  fence. The catch guard checks retained authority and its original candidate; false or throw rolls back.
- This checkpoint does not add a public Almanac/feed, keepsake models, a rod grant or fish fixtures to the
  production catalogue. Tests build real domain candidates and their own explicit test catalogue.

## Interfaces and ownership

`apps/realm/src/fishing/catches.ts` exports `createPostgresFishingCatchWriter(options)` and its types.
Options: `kingdomId`, `origin`, `store: ItemStore`, `items: RealmItems`, `catalogue: ItemCatalogue`,
`species: FishingSpecies`, `where: string`, `authority(): FishingCatchAuthority | null`,
`candidate(personId): FishingCandidate | null`, `finish(personId, castId): boolean`,
`admit(from: RealmChannelSender, tx: ItemTransaction): Promise<{name: string} | null>`.
`FishingCatchAuthority` is the trusted structural view of `DurableKingdom`: readonly kingdomId, origin,
writerEpoch and current. `writer.keep(from, castId)` returns `{status:'kept', catch, item, replayed:boolean}`,
`{status:'refused', message}` or `{status:'uncertain', castId, message}`. Catch record includes version/id,
kingdom/origin/owner/species/item, caughtAt, personalFirst/kingdomFirst, complete rolled fish, environment,
float/anchor/revision and bounded private cast/fight proof. All returned data is copied/frozen or redacted.
Successful return is the adapter's only permission to publish a catch; never publish the private record itself.

`fishing/entry.ts` exports `createPostgresFishingAdmission({pool, origin, readiness})`, returning that `admit`
port. It reuses `createPostgresItemAdmission` after acquiring session row locks and reading approved name.
It never calls a normal pool-backed `sender.current()` inside a transaction.

The writer implementation owns `catches.ts` and 0017c. Admission, candidate additions and tests have separate
write scopes. Before any SQL migration is applied, inspect the SQL and the writer together.

0017c was reviewed, dry-run inside a rolled-back transaction, then applied through the normal runner only
in development schema `pier`. Its checksum is frozen. Any further SQL change starts at 0017d.

## Verification

Use development Postgres at checked 127.0.0.1:5410, assert `current_schema() = 'pier'`, migrate fresh with the
normal runner. Test a real domain win followed by catch+item commit, retry, recreation/restart and recovery
after an uncertain commit; ordinary stacking, personal first protection, rare isolation, origin/owner scopes,
concurrent firsts, append-only DB enforcement and item/receipt linkage. Inject failure after each write and
loss of session/candidate/epoch/lease before final commit: catch, item, history and notifications roll back.
Prove one-connection admission and row-lock ordering against concurrent revocation/takeover. Do not modify
or clean up retained catch/item rows; use unique test kingdoms and identities. Full own-stack signed-in walk,
observer, visual evidence and human playfeel remain separate PI10 requirements.
