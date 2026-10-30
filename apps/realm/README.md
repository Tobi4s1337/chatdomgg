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
It publishes only committed outbox rows (see *Public delivery*). Losing the lease closes the gate: decisions are
cancelled, walking stops through `allowWalking(false)` and public delivery ends.
`createDurableRealmServices` builds the `RealmRoomServices` that `createRealmServer` takes. A process opens a kingdom
once; its room and in-process services share it through counted holds (`retain`), and the last release disposes it and
releases the lease. A second room for the same kingdom in one process is refused with 409.

## Presence ingress (`src/ingress/`)

Spec 34 R7: evidence cannot vanish, and a coal is only ever earned by ten real minutes.

1. **The door.** `POST /internal/realm/ingress` is for services, never browsers (no CORS). It needs
   `Authorization: Bearer <secret>`, `Content-Type: application/json` and a body of at most 8 MiB:
   `{ "version": 1, "observation": PresenceInput }` or `{ "version": 1, "cue": CitizenChatCue }`. Secrets come from
   `REALM_INGRESS_HERALD_SECRET` and `REALM_INGRESS_PANEL_SECRET`, at least 32 characters each and different from
   each other. Without either, the route is not mounted. Secrets are compared as SHA-256 digests in constant time.
2. **The gate** (`IngressGate`) validates with the shared strict schemas, so unknown fields such as message text
   fail. It also checks what each service may report:

   | Service | May report |
   |---|---|
   | Herald | stream on/off, Chatters sweeps, chat activity, remove/restore holds |
   | panel | one person's own panel activity |
   | walker | in-process only, from principals this realm authenticated |

   A live realm refuses simulated observations, and the reverse. The only capability ingress grants is `presence`.
   No service can send a domain command, a receipt or a credit.
3. **The inbox.** An admitted observation is committed to `realm_ingress_inbox` with its source idempotency key
   (`service`, `observation.id`), its canonical digest and its capability. Then the door answers:

   | Status | Answer |
   |---|---|
   | 202 | `accepted` (now durable) or `duplicate` (already durable) |
   | 409 | the same id was used for different evidence |
   | 400 / 401 / 403 / 415 | refused, unauthenticated, wrong origin, not JSON |
   | 413 | too large |
   | 503 | storage unavailable, or 4,096 unsettled observations waiting: resend later |

   Resending is always safe.
4. **The writer drains** the inbox in acceptance order, one observation per `executeIngress`. Receipt, `presence-v1`
   checkpoint, every capability-tagged fact and the public frame commit together. The kingdom's writer does this,
   whichever process holds it. When nobody holds the kingdom, the accepting process opens it and keeps it for
   3 minutes after the last observation. Writers poll their inbox every second. A row drained twice meets its stored
   receipt, so nothing is applied twice.
5. **Evidence** (`presenceTransition`). The world presence reducer decides who is present. An interval is closed only
   between two real observations of the same person by the same source, at most one presence lease (90 s) apart,
   inside the current stream night. Anything else closes the run, so no interval opens across it: a gap, a complete
   roster without the person, a moderation hold, the stream going offline, or a new writer epoch (a restart is
   never coverage). The reducer unions the intervals, so overlapping sources and retries add nothing. When a person's
   union reaches 600,000 ms and they own a home here, the same transaction credits that night's coal, once. Every
   command is simulated first, so only acceptable ones are proposed. Command IDs are stable hashes. Lit windows are
   owned homes (`home.slot`); a frame never names anyone who did not disclose a name.
6. **Walkers.** Rooms report `join`/`reconnect`/`drop`/`leave` through `lifecycle`. A join or reconnect is observed
   at once, and everyone connected is observed again every minute. Stamps use the database clock estimated at lease
   renewal, minus 500 ms, so they are never in the database's future.
7. **Speech** (`cue`, Herald only) is relayed through `bindTransient` to the rooms present right now: at most 40
   messages per second per kingdom, with the rest dropped and counted. It is never stored or replayed.

The `presence-v1` checkpoint is deflated canonical JSON holding the reducer's private presence state and the open
evidence runs. It contains person IDs, approved public names and timings, and no chat text. The world reducer does
not export its 256-bucket FNV-1a sharding, so the codec rebuilds the buckets and checks them against the reducer
before first use. If world ever changes the layout, decoding fails closed (`RealmRecoveryError`) instead of misfiling
people.

## Public delivery (`src/outbox/`)

- **Only committed rows.** `OutboxDispatcher` reads `realm_outbox` in commit order and hands each row to the
  subscribed rooms as a `RealmPublicDelivery`. It then advances `realm_outbox_cursors.delivered_id`, fenced by the
  current unexpired epoch. Each frame is checked against the public allowlist again at the door.
- **At-least-once, never exactly-once.** If a process dies, or its acknowledgement fails, between handing over and
  acknowledging, the rows after the durable cursor go out again with the same `eventId` and `sequence`. The same
  writer retries after 1 s; otherwise the next writer does, starting with its first subscriber. A kingdom seen for
  the first time starts its cursor at its newest row, not at history.
- **Event IDs.** Fact rows use `<kingdom>:<seq>:<n>`. Presence frames use `<kingdom>:<seq>:p<checkpoint revision>`;
  their `frame.sequence` is that durable revision and `frame.epoch` is `realm:<kingdom>`, so frames never repeat
  across restarts.
- **Bootstrap** adopts the committed state and the public rows it produced in one synchronous step. Its `current`
  therefore holds every published home (with committed attachments) and the newest crowd frame at or below
  `throughSequence`, and no past ritual.

### Delivery cursor for the browser lane

The client keeps this per kingdom connection. It must be followed exactly, because redelivery is normal:

1. On join, buffer `world` messages. Send `bootstrap` and install its `current`. Remember `writerEpoch`,
   `throughSequence` as `through`, and the bootstrap presence frame's `frame.sequence` as `frame` (−1 if there is
   none).
2. Then replay the buffer and every later `world` delivery through one rule:
   - Drop it if `delivery.writerEpoch !== writerEpoch`.
   - Drop it if its `eventId` is in the seen set. Keep the last 1,024 event IDs; that comfortably covers the
     256-row redelivery batch.
   - A `presence` message applies only if `message.frame.sequence > frame`. It replaces the crowd and sets `frame`.
     Zero-fact frames share the previous fact's `sequence`, so never compare presence by `delivery.sequence`.
   - A `forge` or `home` message applies only if `delivery.sequence > through`. It then sets
     `through = delivery.sequence`, so a ritual plays once.
3. A new `writerEpoch` (the room's `writerEpoch` changes, or a reconnect lands on a new writer) means a new
   bootstrap. Clear the seen set and start again from step 1. Delivered public messages are never a reason to
   replay spectacle that bootstrap already installed.

`deliveryCursor` in `postgres.integration.test.ts` is this rule as executable reference.

## Seats and reconnect (`src/auth/seats.ts`)

Spec 34 R8: a reconnect is a checked lease on one seat. `RealmSeats` is the policy and `kingdom-room.ts` the
Colyseus adapter around it.

- **One seat per person per room.** A fresh authenticated entry by someone who already has a seat replaces it.
  The newest window wins: the old socket closes with 4409 (or its grace is cancelled), its reconnect token dies, and
  the new walker starts where the old one stood. Nobody gets a second avatar, and nobody is locked out by a
  forgotten tab.
- **Drop.** A socket that drops (1001, 1005, 1006, a reload, a lost network) stops movement at once: queued input is
  cleared, velocity zeroed, and nothing moves the walker until it reconnects. The seat is held for 30 s, or until
  the session ends if that is sooner. A seat the server ended gets no grace.
- **Session checks.** Every seat, connected or dropped, has its entry checked against the session store once a second
  (3 s timeout per question). `false` ends the seat (4401). An unanswered check holds walking without closing; after
  15 s without an answer the seat ends with 4503. Session expiry ends the seat without asking.
- **Reconnect** resumes only the same seat, only while it is still this person's, and only after `current` answers
  `true` during the handshake. Colyseus keeps its own input sequence and acknowledgement epoch; there is no
  application sequence.
- **Writer epochs.** Seats live in one room, which lives under one writer lease. A process restart starts new rooms
  under a new epoch, so every old token is refused and the person enters again with a fresh ticket. An in-process
  lease loss closes the room through main's `RealmRoomEffects.close` (4003). The dropped seats' graces end with it.

### Browser contract

The browser source belongs to the browser lane; this is what it must do. `connectRealm` in
`apps/web/src/realm/client.ts` already does steps 1–3.

1. **Storage.** Keep the reconnect token in `sessionStorage`, so it is per tab. The key is `[endpoint, kingdomId,
   resumeScope]`, where `resumeScope` comes from `GET /api/realm/session`. The value is `room.reconnectionToken`,
   exactly as the SDK gives it: `k:<kingdomId>:<token>`. Never split, log or send it anywhere. The patched SDK splits
   it at the last colon on both reconnect paths. Never store a ticket.
2. **Rotation.** The token changes on every join and every reconnect. Save it after `joinOrCreate`/`reconnect`
   resolves, and after automatic reconnects in a microtask queued from `room.onReconnect` (the SDK assigns the new
   token after that callback returns). An older token is refused (524).
3. **Reload.** Try `client.reconnect(saved, KingdomRoomState)` first. If it rejects, delete the key and enter fresh
   with a new ticket. The rejection codes are:

   | Code | Meaning |
   |---|---|
   | 524 | token invalid or expired: rotated, grace over, seat ended or replaced |
   | 522 | `room "k:…" has been disposed`: the server restarted, or the writer moved, and nobody has entered since |
   | 4401 / 4409 / 4410 / 4503 | refused during the handshake by the seat check (meanings below); the socket then closes with 4003 |

4. **Lost network.** The SDK reconnects on its own after 1001, 1005, 1006 and 4010 (`room.onDrop`). It does so only
   if the room was joined at least 5 s earlier, and tries 15 times with backoff up to 5 s. Show "Reconnecting…" from
   `onDrop` until `onReconnect` or `onLeave`.
5. **`room.onLeave(code, reason)`** ends the room. The `reason` is a person-readable sentence that is safe to show.

   | Code | What happened | What the browser does |
   |---|---|---|
   | 4000 | the person left | clear this tab's key |
   | 4001 | the realm process is shutting down | clear the key; enter fresh after a short backoff (1–5 s) |
   | 4002 | protocol violation (message rate, invalid intent) | clear the key; offer Walk again |
   | 4003 | reconnect failed, or the kingdom's writer moved | clear the key; enter fresh with a new ticket |
   | 4401 | session ended: signed out, revoked, moderated or expired | clear every key for this `resumeScope`; read the session; if anonymous, show Walk (sign-in) |
   | 4409 | the same person walked in from another window | clear this tab's key; show "Walking in another window" with a Walk-here button; never rejoin automatically |
   | 4503 | the session store did not answer for 15 s | clear the key; enter fresh after a pause (5–15 s) |

   4410 only appears as a reconnect refusal ("this seat has ended"): enter fresh.
6. **Signout.** After `POST /api/realm/signout`, clear every key for that `resumeScope`. The server ends the seat
   within about a second, whether it is connected or waiting out its grace.
7. Walker ids are per entry. Use them only as keys for this room session; never persist or show them.

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
| `realm_ingress_inbox` | authenticated observations accepted before any writer decides them (`0004`) |
| `realm_outbox_cursors` | per-kingdom durable delivery cursor, moved only by the current epoch (`0004`) |
| `realm_entries` | one row per consumed ticket; its random id is the walker's room id and the session-check key (`0005`) |

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
(`POST /reference/session`). With `REALM_INGRESS_HERALD_SECRET` set, Herald's SIMULATED replay can post
presence to `POST /internal/realm/ingress`. Its facts live in Postgres and survive restarts. Without `REALM_SIMULATED=1`, the server
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
missing. It migrates a random `realm_test_*` schema and drops only that schema. It proves three things:

- Two writers race, a lost COMMIT reply is resolved by lookup, and a stale epoch is fenced: one spend, one fact and
  one outcome.
- A committed fact survives a full room server restart and returns through bootstrap.
- R7: Herald evidence enters through the authenticated door. The observation that completes ten minutes commits
  the interval, the credit and the frame together. The process dies the moment its transport takes the frame,
  before acknowledging or settling. The next writer then:
  - redelivers the frame with the same event ID;
  - answers Herald's retry with `duplicate`;
  - returns the stored receipt to a direct retry;
  - starts evidence runs again instead of covering the outage.

  Throughout there is one coal, one credit fact, overlap is never counted twice, and the public payload holds no
  person ID, right, session, secret or chat.

R8 has two halves. `src/auth/seats.test.ts` checks the seat policy with no database: replacement, the 30 s grace
bounded by the session, revocation during the grace, expiry, and the unanswered-store hold. The reconnect harness
runs inside the sign-in suite (`apps/api/src/realm-auth/auth.integration.test.ts`), which already holds real
sessions. It starts this server's durable composition through `src/auth/reconnect-harness.ts` and drives the real SDK
on `k:424243`. It covers: a reload through explicit reconnect, a lost network through automatic reconnect, rotated
and refused tokens, a second window, signout during the grace, expiry while connected, and a restart that refuses
every old token (automatic reconnect ends in 4003, a saved token in 522) before an authenticated fresh entry.

Vitest caches transformed modules in `node_modules/.vitest-cache`, and that cache does not notice a new migration
file behind `import.meta.glob`. After adding a migration, run `pnpm exec vitest --clearCache` once, or the suite will
see an old list.

## Ports and processes

Realm 5191 (this server), API 5192, web preview 5190 (the team's). Lane development runs use their own schema
(`REALM_DATABASE_SCHEMA=realm_lane_rs01`), so diverging lane branches never stamp the shared `realm` schema with
migrations that another branch does not carry.
