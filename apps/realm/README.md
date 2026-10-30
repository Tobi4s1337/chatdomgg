# Realm server

The Colyseus server that hosts each kingdom's shared walk, and the kingdom's one durable writer. Spec:
`work/specs/34-realm-server.md`; lane PRD: `work/lanes/realm-server/PRD.md`.

## Durable authority (`src/persistence/`)

`PostgresRealmRepository` implements the frozen `RealmRepository` from `@chatdom/shared/realm`.

- **One writer per kingdom.** `acquire` takes a 15 s lease on database time with a fresh 256-bit epoch. A live lease
  refuses a second writer (`RealmLeaseHeldError`). On its own monotonic clock the holder stops 2 s before the
  database would fence it, and renews three times inside that 13 s window (every ~4.3 s), so one slow renewal never
  costs the lease. An independent watchdog closes the kingdom at the deadline even while a renewal is stalled. An expired epoch can never write again (`RealmWriterFencedError`), even if
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
- **Bootstrap is the delivered prefix.** Every delivery carries `cursor`, its outbox row id, which only grows within a
  kingdom. `PublicProjection` folds a row in at the moment it is handed to the transport, just before listeners see
  it. A bootstrap's `current` therefore holds the newest crowd frame and every published home as the rows up to
  `throughCursor` left them, and no past ritual. It never reads private state, so it cannot run ahead of its outbox.
  A writer that opens with undelivered rows bootstraps from its durable cursor and folds those rows in as it
  redelivers them.

### Delivery cursor for the browser lane

The client keeps this per kingdom connection. It must be followed exactly, because redelivery is normal:

1. On join, buffer `world` messages. Send `bootstrap` and install its `current`. Remember `writerEpoch` and
   `throughCursor` as `through`.
2. Then replay the buffer and every later `world` delivery through one rule:
   - Drop it if `delivery.writerEpoch !== writerEpoch`.
   - Drop it if `delivery.cursor <= through`: bootstrap already holds it, or it is a redelivery.
   - Otherwise apply it and set `through = delivery.cursor`. A `presence` message replaces the crowd; a `forge` or
     `home` message plays once.
   - Never compare by `delivery.sequence`: zero-fact presence frames share the previous fact's sequence.
3. A new `writerEpoch` (the room's `writerEpoch` changes, or a reconnect lands on a new writer) means a new
   bootstrap. Start again from step 1. Delivered public messages are never a reason to replay spectacle that
   bootstrap already installed.

`deliveryCursor` in `postgres.integration.test.ts` is this rule as executable reference.

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
| `realm_ingress_inbox` | authenticated observations accepted before any writer decides them (`0004`) |
| `realm_outbox_cursors` | per-kingdom durable delivery cursor, moved only by the current epoch (`0004`) |

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

Database limits are listed in the next section.

## Limits, readiness and diagnostics (`src/limits/`, `src/diagnostics/`)

Every queue, socket and wait has a finite ceiling (spec 34 R9). `REALM_LIMITS` in `src/limits/` is the one
catalogue. Values owned by another module are referenced there, never copied.

| Ceiling | Value | What happens past it |
|---|---|---|
| Incoming protocol frames per client | 90/s (Colyseus counts from the second frame of each window) | The sender is closed with 4002. Its walker is removed, and **no reconnect seat** is kept, so the next entry needs a fresh ticket. |
| Walking integration | 30 Hz, one input per walker per tick | Extra inputs wait in the queue below and never add a step. An empty tick moves nobody. |
| Input queue per walker | 8 | Colyseus drops the oldest input. Dropped inputs are never integrated. |
| Inbound WebSocket frame | 16 KiB | uWS closes the socket before buffering the frame. The largest legitimate intent is under 1 KiB. |
| Outbound buffer per socket | 1 MiB, `closeOnBackpressureLimit` | uWS drops the send and closes the socket (1006), so the decoder is never left stale. The room keeps a 30 s seat; the client reconnects and receives full state. |
| Walkers plus reconnect seats | 300 | Colyseus refuses the join. Seats in their grace period count. |
| Reconnect grace | 30 s | The seat ends and the walker leaves. |
| Session recheck | every 1 s, 3 s answer limit | No answer in time ends the entry with 4003 `Entry unavailable`. |
| Actions in flight per walker | 1 | The next intent gets an immediate `held` receipt (`Your previous request is still being confirmed…`). Nothing is queued. |
| Action reply | 8 s | The walker gets an `unavailable` receipt and should reconnect to check. The slot frees only when the work itself settles. |
| Writer queue per kingdom | 64 commands | `RealmBusyError` (`realm.busy`) at once. |
| Unstarted command wait | 10 s | `RealmBusyError`. The command never ran, so the caller may retry it unchanged. |
| Outbox dispatch batch | 256 rows | The next batch is read after the transport takes this one. A failure redelivers it after 1 s. |
| Transient relay | 40/s per kingdom | The message is dropped and counted, never queued. |
| Ingress body / inbox | 8 MiB / 4,096 waiting per kingdom | 413 / 503 `Send it again`. |
| Database pool | 8 connections; 3 s connect, 5 s statement, 6 s query, 10 s idle-in-transaction | The statement fails with a secret-free description; a stalled lock holder is cut off so its lease can move on. |
| Shutdown | 5 s for queued commits, 5 s for the last delivery | The process snapshots only if drained, then releases only its own lease. |

**Readiness.** `RealmReadiness` probes its dependencies every 2 s, each with a 1.5 s answer limit: the database
(`SELECT 1`), sessions (`realm_sessions`, live entry only) and writer leases. The writer probe fails when an open
kingdom is no longer current, or has less than a third of its lease window left, meaning two renewals in a row did
not land. After two consecutive misses a dependency is **held**:

- `holdEntry` refuses new arrivals with 503 `The kingdom is not taking new arrivals while <reason>. Nothing was
  changed; try again shortly.` This happens before a ticket is burned or an avatar exists.
- Kingdoms refuse new owned commands at once with `RealmHeldError` (`realm.held`) instead of queueing them behind a
  store that is not answering. Ingress rows stay in the inbox, and pending deeds stay pending until recovery.
- People already inside keep walking: walking needs no store.

The hold lifts on the first good probe.

**Routes** (on the realm port, no CORS):

- `GET /healthz` answers `200 { version, alive: true, uptimeMs }` while the process answers. Restart only on this.
- `GET /readyz` answers 200 when every dependency is ready, otherwise 503. The body gives `ready` and `held` (the
  reason), plus each dependency's `ready`, `reason`, `latencyMs` and `failures`. Under `limits`, it gives the
  measured high-water marks beside their ceilings (input queue, actions per walker, socket backpressure bytes,
  pending commands, outbox batch, database connections and waiting), refusals (dropped sends, held/late actions,
  busy/held/expired commands, dropped transient messages), closes by `phase:reason`, writer closures by category and
  each open kingdom's delivery cursor.

Nothing in either body is a secret: they hold counts, byte sizes and fixed reason categories. Close reasons are the
code's meaning (`left`, `connection-lost`, `frame-too-large`, `protocol-or-rate`, `entry-ended`, `server-shutdown`,
…), never the message that went with the code.

**Transport and room composition** (the integrator recipe; `main.ts` does exactly this):

```ts
const diagnostics = new RealmDiagnostics();
const readiness = new RealmReadiness([databaseProbe(pool), authProbe(pool) /* live entry */, writerProbe(() => services.kingdoms.values())]);
const held = () => readiness.held();
const services = createDurableRealmServices({
  repository, outbox, auth: holdEntry(authenticator, held), hold: held, kingdom, log,
  attach: kingdom => {
    const forget = kingdom.onClosed(reason => diagnostics.writerClosed(kingdom, reason));
    const detach = ingress.attach(kingdom);
    return () => { forget(); detach(); };
  },
});
const { server, transport } = createRealmServer(services, diagnostics); // uWS caps + `dropped` + room observer
diagnostics.watch({ pool });
mountDiagnosticsRoutes(transport.app, readiness, diagnostics, () => services.kingdoms.values());
await readiness.start();
// Colyseus keeps ONE onShutdown callback: stop readiness and diagnostics there, then ingress, then the pool.
server.onShutdown(async () => { readiness.stop(); diagnostics.stop(); await ingress.stop(); await pool.end(); });
```

`createKingdomRoom(services, observer)` takes the observer as an optional second argument (it defaults to a no-op).
The frozen ports are unchanged.

**Browser behaviour** (for the web lane):

- Close 4002 means the client was closed for its frame rate or an invalid message. Do not auto-reconnect; request a
  fresh ticket.
- Close 1006 after a stall means the socket fell 1 MiB behind. Reconnect with the saved token: full state arrives,
  then apply the delivery cursor rule above.
- A `held` receipt means wait for the earlier receipt.

## Tests

```bash
pnpm exec vitest run apps/realm
REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/persistence/postgres.integration.test.ts
```

The Postgres suite runs only with `REALM_DATABASE_TESTS=1`, and then fails rather than skips if `DATABASE_URL` is
missing. It migrates a random `realm_test_*` schema and drops only that schema. It proves four things:

- Two writers race, a lost COMMIT reply is resolved by lookup, and a stale epoch is fenced: one spend, one fact and
  one outcome.
- A committed fact survives a full room server restart and returns through bootstrap.
- R6: one person races into four kingdoms while a process dies mid-allocation, loses a COMMIT reply and stops before
  installing. There are three deeds, the castle stays apart, the guest is retained, pending deeds install on reopen,
  forged installs are refused and layouts are immutable. Every home in these tests comes from a real allocated deed.
- R7: Herald evidence enters through the authenticated door. The observation that completes ten minutes commits
  the interval, the credit and the frame together. The process dies the moment its transport takes the frame,
  before acknowledging or settling. The next writer then:
  - redelivers the frame with the same event ID;
  - answers Herald's retry with `duplicate`;
  - returns the stored receipt to a direct retry;
  - starts evidence runs again instead of covering the outage.

  Throughout there is one coal, one credit fact, overlap is never counted twice, and the public payload holds no
  person ID, right, session, secret or chat.

Vitest caches transformed modules in `node_modules/.vitest-cache`, and that cache does not notice a new migration
file behind `import.meta.glob`. After adding a migration, run `pnpm exec vitest --clearCache` once, or the suite will
see an old list.

`src/diagnostics/limits.test.ts` (R9) runs in the ordinary suite, without Postgres. It uses the real uWS server,
real SDK clients, the production room and `DurableKingdom` over a store the test can stall. Six things happen:

1. A walker floods 75–82 inputs/s; its distance stays within the 30 Hz bound and its input queue peaks at 8.
2. A 300-frame burst is closed with 4002, and its reconnect token is refused.
3. The largest legitimate intent gets a receipt, and a 16 KiB frame closes its socket.
4. A client that really stops reading (`ws` `pause()`) during a 48 KiB-per-row public burst is closed at
   1 MiB of buffered bytes, while the healthy walker receives every row in cursor order. The stalled client
   then reconnects to the same seat with full state.
5. Storage stalls: 64 commands are held, the 65th is refused at once, and the 63 waiting ones are refused
   unstarted at 10 s. Readiness holds new commands and arrivals with a reason, `/readyz` answers 503,
   `/healthz` answers 200, and walking continues.
6. The session service stalls: the second and third actions get `held` at once, and the entry ends with 4003.

The test prints one `[realm limits] SIMULATED {…}` line with the measured report.

## Ports and processes

Realm 5191 (this server), API 5192, web preview 5190 (the team's). Lane development runs use their own schema
(`REALM_DATABASE_SCHEMA=realm_lane_rs01`), so diverging lane branches never stamp the shared `realm` schema with
migrations that another branch does not carry. The RS06 smoke ran the built server on 5194 (5191 was held by an
earlier lane process) against `realm_lane_rs06` (0001–0004 applied), and was stopped after the check.
