# Realm server

The Colyseus server that hosts each kingdom's shared walk, and the kingdom's one durable writer. Spec:
`work/specs/34-realm-server.md`; lane PRD: `work/lanes/realm-server/PRD.md`.

## Durable authority (`src/persistence/`)

`PostgresRealmRepository` implements the frozen `RealmRepository` from `@chatdom/shared/realm`.

- **One writer per kingdom.** `acquire` takes a 15 s lease on database time with a fresh 256-bit epoch. A live lease
  refuses a second writer (`RealmLeaseHeldError`). The holder renews every 5 s. On its own monotonic clock it stops
  2 s before the database would fence it. An expired epoch can never write again (`RealmWriterFencedError`), even if
  its process resumes.
- **One indivisible commit.** `execute` locks the kingdom row, checks the epoch and the expected sequence, and decides
  with the world reducer at database time. One transaction then writes the fact (canonical JSON + SHA-256), the
  command's digest and outcome, the coal ledger rows, the global design claim, a snapshot every 1,000 facts and the
  sanitized public outbox. The last statement before `COMMIT` re-checks the fence. A takeover needs the same row
  lock, so every commit is ordered before any newer epoch.
- **Idempotent by command ID.** A committed outcome is final: the same ID and payload return it, and no second fact
  is ever written. A refusal (`held`, `forbidden`, …) is stored as the latest answer, and a retry asks again. That
  way a night's coal credit refused before ten covered minutes can still commit later. The same ID with another
  payload returns `rejected/conflict`. If the authority gate closes before the write, nothing is stored and the
  result is `rejected/cold`; the command stays undecided.
- **A lost COMMIT reply** surfaces as `RealmCommitUncertainError`. Resolve it with `lookup`, which waits out any
  writer still holding the kingdom row. It is never treated as a refusal or a refund.
- **Recovery** loads the newest snapshot at or below the committed sequence. It checks the snapshot's version,
  digest, kingdom and origin, then replays the contiguous, digest-checked tail with `applyRealmFact`. A gap, a bad
  digest or a fact that cannot be replayed is a `RealmRecoveryError`. The kingdom then stays closed and is never
  replaced by an empty one.
- `loadIngress` / `executeIngress` commit the presence checkpoint, the per-observation receipt, the capability-tagged
  fact batch and the presence outbox frame in the same fenced transaction.

`DurableKingdom` is the room's `RealmRoomHandle` and the trusted in-process entry for internal services
(`execute`, `ingest`, `lookup`). It holds at most 64 pending commands; when full it rejects with `RealmBusyError`.
It publishes only committed outbox rows, in order, with stable event IDs (`<kingdom>:<seq>:<n>`). Bootstrap carries
`throughSequence` plus the current published homes and the latest presence frame, never past rituals. Losing the
lease closes the gate: decisions are cancelled, walking stops through `allowWalking(false)` and public delivery ends.
`createDurableRealmServices` builds the `RealmRoomServices` that `createRealmServer` takes.

## Homes and founded layouts (`src/allocation/`)

`AllocationService` is the only way a citizen home comes to exist (spec 34 R6). It shares the realm's Postgres schema.

- **Founded layouts are immutable.** `adoptLayout(kingdomId, plan)` stores a `SettlementPlan` whole: canonical JSON,
  its SHA-256 and one row per home plot. A later revision is adopted only as an extension. It must keep the founding
  seed and first year, and every plot's and home's transform, so streets stay put. It must also keep every paved
  stretch of public street, every approach, node, court and quarter root, and the market, castle and landform.
  Street geometry is compared stretch by stretch, not by edge ID. A new year's frontages add junctions, and the
  generator then cuts a merged lane into new segments, which renames the `streetId` of plots already on it
  (seed `rs03-517713746`: `plot:2024:41` moves from `contour:3:5:0` to `contour:3:5:121`). That is growth, not a move.
  Every occupied plot must also match its deed's original placement, apart from that segment label. The answers are
  `founded`, `extended`, `unchanged` or an explicit `rejected` with a reason (`regenerated`, `revision-conflict`,
  `superseded`, `moved-plot`, `moved-street`, `occupied-plot-changed`, `origin`, `invalid`). Database triggers
  refuse any UPDATE or DELETE of layout and plot rows.
  Rooms read the current revision with `currentLayout`; nothing regenerates a plan at startup.
- **Three citizen homes per person, globally.** `allocate` locks the person's `realm_deed_holders` row, then the
  kingdom's layout head, and commits a pending deed that already counts. Database checks hold the count at 0–3 and
  allow one live deed per person per kingdom and one owner per plot. The monarch asking in their own kingdom (the
  kingdom ID is the broadcaster's Twitch ID) gets `castle`: a seat, never a deed and never one of the three. A
  fourth kingdom, or a full one, answers `guest` and keeps a `realm_guests` row, so the guest light and history
  wait there. Asking again is idempotent by person and kingdom. A lost COMMIT reply is resolved through that key.
- **The address rule.** The verified follow year picks the tenure quarter. A follow before the founded years goes
  to the oldest quarter. Unknown history goes to the edge of the newest quarter. The follow date's place in its
  year picks the row (the street segment, oldest first). Verified subscription months move the choice one street
  toward the castle, once and never into another quarter. A full row spills outward, a full quarter to the nearest
  quarter. The deed keeps the chosen placement, the reasons (`tenure`) and the signed evidence records.
- **Evidence is signed, never inferred.** `TenureEvidenceVerifier` accepts HMAC-SHA256 records from the Herald
  (`helix.channel-followers` for `followed_at`, `chat.badge-info` or `eventsub.subscription-message` for months).
  Records are keyed by `REALM_EVIDENCE_KEY` (≥32 bytes hex) and must match the kingdom, the person and the origin.
  Unknown history stays `null`; nothing is derived from a slot, a sign-in or a payment.
- **Install inside the writer's transaction.** `prepare` furnishes the deed's first home once and fixes the exact
  `home.installAllocated` command on the deed. `install` commits it through the kingdom's fenced writer.
  `verifyAllocation` is always one of the repository's commit guards. It accepts a home only for a pending deed whose
  receipt, kingdom, origin, owner, plot, slot, layout revision and exact command match, and it marks the deed
  `installed` in the same COMMIT. A refused install (`conflict`) voids the still-pending deed and releases its plot
  and count. A cold or busy writer leaves it pending.
- **Pending-install recovery.** A crash between allocation and install leaves a counted pending deed. Pass
  `afterOpen: kingdom => allocations.recover(kingdom)` to `createDurableRealmServices`, and each kingdom then installs
  its pending deeds before the first walker enters. A crash can neither free a slot nor create a fourth home.

Composition for a live kingdom (main owns the furnisher and the collision world):

```ts
const allocations = new AllocationService(pool, { origin: 'live', verifier: new TenureEvidenceVerifier('live', tenureEvidenceKey()), furnish });
const services = createDurableRealmServices({ repository, auth,
  kingdom: async id => ({ world, spawn, layoutRevision: (await allocations.currentLayout(id))!.revision }),
  afterOpen: kingdom => allocations.recover(kingdom) });
```

`furnish(deed)` returns the deed's first home. That means approved starter content in the plot's family
(`deed.placement.style`), its digest and approved names. Until one is composed, deeds stay pending and counted.

### Schema and migrations

Migrations are additive SQL files in `src/persistence/migrations/`, applied in file order and recorded with
checksums in `realm_schema_migrations`. Editing an applied file stops startup. The API reads the same schema; it
does not run migrations of its own.

| Table | Holds |
|---|---|
| `realm_kingdoms` | origin, committed sequence, writer epoch, generation and lease expiry |
| `realm_facts` | private ordered history (canonical JSON text and its digest) |
| `realm_commands` | one outcome per `(kingdom, commandId)` with the command digest |
| `realm_snapshots` | versioned, digested private snapshots |
| `realm_coal_ledger` | every coal balance change beside the fact that caused it |
| `realm_designs` | globally unique original design IDs |
| `realm_outbox` | sanitized public deliveries (never words, rights, sessions or owners) |
| `realm_ingress_checkpoints`, `realm_ingress_receipts` | presence checkpoint bytes and per-observation dedupe |
| `realm_layout_heads`, `realm_layouts`, `realm_layout_plots` | each kingdom's current revision and every adopted plan and home plot (immutable) |
| `realm_deed_holders` | the per-person lock row and global citizen-deed count (0–3) |
| `realm_deeds` | receipt, placement, tenure, evidence, fixed install command and status (`pending`/`installed`/`void`) |
| `realm_guests` | people kept as guests in a kingdom (`three-homes` or `kingdom-full`) |

## Running locally

Configuration comes from the ignored root `.env`: `DATABASE_URL`, plus optional `REALM_DATABASE_SCHEMA` (default
`realm`) and `REALM_PORT` (default 5191). The server never prints the connection string.

```bash
# Apply migrations to the schema (creates it if needed; never drops or rewrites anything).
node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs [--schema realm]

pnpm --filter @chatdom/realm build
REALM_SIMULATED=1 pnpm --filter @chatdom/realm start
```

`REALM_SIMULATED=1` serves the labelled SIMULATED kingdom `999000001` with SIMULATED entry tickets
(`POST /reference/session`). Its facts live in Postgres and survive restarts. Without `REALM_SIMULATED=1`, the server
refuses to start until the verified Twitch session service is wired in; live mode has no bypass and no memory
court. `REALM_SIMULATED=1 REALM_STORAGE=memory` keeps main's memory-only reference court; nothing is saved there.

Every startup failure exits with status 1 and one secret-free line:

| Condition | Message |
|---|---|
| no `DATABASE_URL` | `DATABASE_URL is not configured; the realm has no durable store and will not start without one.` |
| schema not migrated | `The realm schema is not migrated. Run apps/realm/scripts/migrate.mjs first.` |
| older or edited schema | `Realm migration <id> is not applied…` / `…differs from this build; migrations are append-only.` |
| unreachable host | `The realm database is unreachable.` |
| wrong credentials | `The realm database refused the configured credentials.` |
| live mode | `Live realm entry requires the verified Twitch session service…` |

Database limits (`REALM_DATABASE_LIMITS`): 8 pooled connections, 3 s connect, 5 s statement, 6 s query and 10 s
idle-in-transaction timeouts. The last one ends a stalled lock holder so its lease can move on.

## Tests

```bash
pnpm exec vitest run apps/realm
REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/persistence/postgres.integration.test.ts
```

The Postgres suite runs only with `REALM_DATABASE_TESTS=1`, and then fails rather than skips if `DATABASE_URL` is
missing. It migrates a random `realm_test_*` schema and drops only that schema. It proves that two writers race,
that a lost COMMIT reply is resolved by lookup, and that a stale epoch is fenced: one spend, one fact and one outcome.
It also proves that a committed fact survives a full room server restart and returns through bootstrap. The
allocation test races one person into four kingdoms and lets a process die mid-allocation, lose a COMMIT reply and
stop before installing. It proves three deeds, the castle apart, a retained guest, recovery on reopen, refused
forged installs and immutable layouts. Every home in these tests comes from a real allocated deed.

Vitest caches transformed modules on disk (`node_modules/.vitest-cache`), keyed by each file's own content. The
migration list is a build-time glob in `migrate.ts`, so after adding a migration run `pnpm exec vitest --clearCache`
once, or the suite migrates without the new file.

## Ports and processes

Realm 5191 (this server), API 5192, web preview 5190 (the team's). Lane development runs use their own schema
(`REALM_DATABASE_SCHEMA=realm_lane_rs01`), so diverging lane branches never stamp the shared `realm` schema with
migrations that another branch does not carry.
