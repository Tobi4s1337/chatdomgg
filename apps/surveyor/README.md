# @chatdom/surveyor — the Atlas data service

Reads what the running Surveyor collector has observed, exports it into this service's own data directory, and
serves the Atlas's public data below `/map-data`. It is **not** a Twitch collector: it never calls Helix, subscribes
to EventSub or reads chat, and it never writes to the collector, its database, its WAL or its retention.

Contract: [Spec 01](../../work/specs/01-atlas.md) (R1, R11, R16) and the frozen `@chatdom/shared` interchange.

## Commands

```sh
SURVEYOR_BASE_URL=http://<collector>/atlas/api SURVEYOR_DB_PATH=<surveyor.db or a supplied copy> \
  ATLAS_DATA_DIR=<own dir> pnpm --filter @chatdom/surveyor atlas:import
ATLAS_DATA_DIR=<own dir> pnpm --filter @chatdom/surveyor atlas:check [-- --revision <id>]
ATLAS_DATA_DIR=<own dir> pnpm --filter @chatdom/surveyor atlas:serve
ATLAS_DATA_DIR=<own dir> pnpm --filter @chatdom/surveyor atlas:rehearse [-- --edition 0|I]
ATLAS_DATA_DIR=<own dir> ATLAS_FOUNDER_PUBLIC_KEY=<pem or path> \
  pnpm --filter @chatdom/surveyor atlas:found -- --edition 0|I --authorization <file>
ATLAS_DATA_DIR=<own dir> ATLAS_FOUNDER_PUBLIC_KEY=<pem or path> pnpm --filter @chatdom/surveyor atlas:settle
ATLAS_DATA_DIR=<own dir> pnpm --filter @chatdom/surveyor atlas:authorize -- --edition 0|I --key <private pem> --by <login>
```

Each script builds `dist/atlas.mjs` first, so it never runs stale code. There are no defaults for the source host or
database: one environment's locations never become application constants.

| Variable | Meaning |
|---|---|
| `SURVEYOR_BASE_URL` | Required for import. The collector's `/atlas/api` base. Credentials in the URL are refused. |
| `SURVEYOR_DB_PATH` | The collector database (or a supplied snapshot) for inventories HTTP does not expose. Opened `readOnly`. Without it, import fails with `inventory-missing`. |
| `ATLAS_DATA_DIR` | Required. The only place this service writes. |
| `ATLAS_KEEP_REVISIONS` | Revisions retained after a successful import (default 3, current always kept). |
| `SURVEYOR_HTTP_TIMEOUT_MS` | Per-request timeout (default 8000). Two attempts for a 5xx or timeout, none for a 4xx. |
| `ATLAS_HOST`, `ATLAS_PORT` | Serve bind address, default `127.0.0.1:5193`. |
| `ATLAS_FOUNDER_PUBLIC_KEY` | The founder's Ed25519 public key (PEM text or a path to it). Without it no founding authorization can verify, so `found` refuses and `check` reports a founded edition as unverifiable. |

## What an import does

1. `GET status` and `GET raids/recent`, validated with `SurveyorStatusSchema` / `SurveyorRecentRaidsSchema`.
2. One deferred read transaction on the database (`readOnly: true`, SELECT only, no PRAGMA). In WAL mode this pins
   one consistent snapshot while the collector keeps sweeping; a sweep committed mid-read is not part of it.
3. Projection into strict records: every channel the source observed (≥5 viewers at some sweep), its accumulated
   live and viewer minutes, average audience, category minutes, the source's own candidate rule (average ≥25),
   raid pair **aggregates** and the recorder's individual raid observations (normalised with `AtlasRaidSchema`,
   `occurredAt: null`, content key IDs — the source keeps no upstream event ID).
4. Coherence gates: HTTP and database must describe the same collector run (first sweep time); every live channel
   must have been seen by the snapshot's last sweep; dates must sit inside the window. More than 0.5% invalid rows
   fails the import as `inventory-invalid`; fewer are counted by reason with at most ten ID samples.
5. Write to `.staging/`, fsync, re-verify every file exactly as `atlas:check` does, rename into `revisions/`, then
   swap `current.json` by rename. Readers see the previous revision until that final rename.

The observation cut (`asOf`) is the last complete sweep, never the import time. Raid inventories are cut at the
database read (`source.database.openedAt`) instead, because raids arrive between sweeps; each raid keeps its own
observation time, so two imports in one sweep interval can differ only by raids that really arrived in between. An empty source fails with
`inventory-empty`; nothing is ever manufactured from a status count.

## Data directory

```
current.json                 { revision, manifestSha256, switchedAt } — the last good revision
revisions/<revision>/        import.json + channels / games / raid-pairs / raid-observations / sweeps .ndjson
ledger/imports.ndjson        append-only: every attempt, published / unchanged / failed with a bounded reason
ledger/foundings.ndjson      append-only: every founding attempt, founded or refused, with its reasons
editions/<ed-0|ed-1>/        an official edition (see Editions); exists only after an authorized founding
previews/<preview>/          manifest.json · world.json · region-<n>.json · names.json — removed with its revision
moderation/withheld.json     optional: channels withheld from the public map (see Public visibility)
.staging/  .import.lock      transient
```

A revision ID is `obs-<asOf UTC>-<content hash>`; the same source content always yields the same revision, so a
repeated import records `unchanged` and writes nothing.

## Retention

- Stream facts (title, game, audience, start) leave the export once a channel has been offline for 24 hours.
- Avatars are kept only from Twitch's CDN and only when the source confirmed them within 24 hours.
- Only `ATLAS_KEEP_REVISIONS` revisions remain; older ones, with their raw names and titles, are deleted.
- The collector's own retention (recorder `keepDays`) is reported, never changed or extended.
- Content labels are not collected by the source: every channel is `unknown` and stays so.

## Restore procedure

- **A bad import** never becomes current; nothing to restore. Read the reason in `ledger/imports.ndjson`.
- **Return to an earlier revision**: `atlas:check -- --revision <id>` must pass; then write `current.json` as a temp
  file with that revision and its `import.json` SHA-256 and rename it over `current.json`. `atlas:serve` picks it up.
- **Corruption** (a failed `atlas:check`): delete the revision folder and re-run `atlas:import`. The source is the
  record of truth; this directory is derived and can always be rebuilt while the source retains the data.
- **A stuck lock** from a crashed import is reclaimed automatically when its process no longer exists.

## Served routes (`atlas:serve`)

Only fixed routes, `GET`/`HEAD`, matched exactly — there is no file serving, so traversal is just a 404.

| Route | Body |
|---|---|
| `/map-data/v1/survey` | Public survey of the current revision: dates, coverage, founding eligibility, aggregate counts. ETag = revision. 503 before the first import. |
| `/map-data/v1/health` | `{ ok, revision, asOf }` or 503. |
| `/map-data/v1/preview` | Pointer to the current revision's survey preview, pinning `world.json` by hash. 503 `no-preview` until drawn. |
| `/map-data/v1/preview/<id>/world.json`, `…/region-<n>.json` | Immutable geometry keyed by channel ID (`max-age` one year, ETag, gzip). No logins, names or other raw Twitch content. 404 once pruned. |
| `/map-data/v1/preview/<id>/names` | The names projection: logins and display names of the drawn holdings, each with `freshUntil`, plus `withheld` IDs. `no-cache` with ETag, rebuilt at least every minute. 503 `names-unavailable` while the withheld list is unreadable. |

A broken pointer swap keeps serving the last good revision.

## Public visibility (R16)

Every published fact about a channel passes `publicVisibility` (`src/policy/visibility.ts`):

- **Gone** (deleted or banned at the source) and **gambling** channels never get land. Gambling is the versioned
  list `gambling-categories-1` of Twitch's real-money categories by game ID (Slots, Virtual Casino, Poker): a channel
  is excluded when they hold ≥ 25 % of its observed minutes, or when its latest stream was in one. Each preview
  records the policy version and how many candidates it kept off.
- **Raw names** live only in the preview's `names.json`, never in the immutable files, and leave the service only
  through the names projection: a name the source has not confirmed within 24 hours is omitted, so the map shows
  the shield alone.
- **Withheld** channels (hidden, removed, a name pulled by moderation) are listed in
  `<ATLAS_DATA_DIR>/moderation/withheld.json`: `{ "version": 1, "updatedAt": <ms>, "kingdomIds": ["…"] }`, no
  reasons. Write it as a temp file and rename it into place. The next names request lists them as withheld, so
  open maps draw their land bare at the next refresh (every five minutes) and new maps at once; the immutable
  geometry is not redrawn. An unreadable list refuses all names rather than reviving anyone, and `atlas:check`
  reports it.

## Geography

The world is drawn from one revision with the family taxonomy `src/cartography/families-1.json` and algorithm
`survey-preview-4`. The same revision, taxonomy bytes and algorithm always give the same `world.json`, byte for byte;
`atlas:check` rebuilds the current preview and fails if they differ.

- **Languages.** A language with ≥600 candidates is a continent; smaller ones are isles of the Isles of Many Tongues.
- **Realms** (`realm-threshold-1`). A continent is divided into realms: the Crossroads at its heart, one realm for
  each family of games with at least max(24, 1.5 % of the continent's channels), and the Wilds at its edge for
  smaller families and unassigned games. An isle is one realm. A channel's family is the one holding most of its
  observed minutes across all of that family's games.
- **Variety** (`variety-1`). A channel with ≥120 observed minutes, no community above 50 % and at least three
  communities of ≥12 % each lives in the Crossroads. Each family is one community; each unassigned game is its own.
- **Patches.** Inside a realm, channels sit with others who mostly stream the same game. All of a region's patches
  are relaxed together, so a continent stays one landmass and each realm one contiguous province.
- **The Outer Isles.** Six empty, lobed islands (about 5 % of the land) belong to no language. They take newcomers
  whose realm has no room left.
- **Hamlet lattice** (`hex-1`). Waiting land is cut into hamlet slots on a fixed lattice in 1/20-unit fixed point
  (pitch 1.6 × 1.4, odd rows offset). A slot is usable when it is on land, in its realm, ≥0.9 from the coast and
  ≥0.6 clear of every other holding. A slot's holding ID is `s:<i>:<j>` and never changes. Each realm's free slots
  are counted in the world file.

The taxonomy is a **proposal** (`status: proposed`) until the founder reviews it. The map shows the families' plain
names, and the `realmName` proposals wait for that review. Edition I refuses an unreviewed taxonomy.

## Editions (R2–R5)

An edition is frozen land plus an append-only ledger of who holds what on it. Founding is a team decision: nothing
here founds an edition on its own, and no test founds one outside a temporary directory.

```
editions/<id>/edition.json   the shared AtlasEdition (frozen, world hash, realm count)
              founding.json  revision, observation window, taxonomy ref, the signed authorization, founder key hash
              taxonomy.json  the exact taxonomy bytes it was drawn with; settlement uses these, never the repo's
              world.json     frozen geometry; its SHA-256 is the edition's world hash
              ledger.ndjson  settle / tombstone / restore / night lines, each naming the SHA-256 of the line before
              heads.ndjson   every acknowledged ledger head (lines, settlers, hash, revision)
```

- **Founding gates.** `atlas:found` refuses, and says every reason at once, when the edition already exists, when the
  source's own observation window is shorter than 48 h (Edition 0) or 7 days (Edition I), when Edition I's taxonomy
  is unreviewed, or when there is no founder key, no authorization, or an authorization that names another edition,
  revision or taxonomy, is dated in the future, or does not verify. A refusal writes only its line in
  `ledger/foundings.ndjson`. An unreadable withheld list is a refusal too. A founding draws the world, settles every
  mapped channel as `f:<ordinal>` in channel ID order, lays a `hidden` tombstone on each holding of a channel on the
  withheld list before its first night closes, writes the edition to staging, verifies it completely and renames it
  into place. `founding.json` records the list it read (`sha256:<bytes>` or `none`) and how many it hid. It never
  replaces an existing edition.
- **Authorization.** The founder signs `{kind, edition, revision, taxonomySha256, issuedAt, issuedBy}` (canonical JSON)
  with an Ed25519 key that stays on the founder's machine: `atlas:authorize --key <private pem>` prints the file to
  pass to `--authorization`. The service holds only the public key.
- **Settlement.** `atlas:settle` settles the current revision into every founded edition, once per revision and only
  for a revision newer than the last night.
  - Newcomers who reach the candidate rule are settled largest first on the nearest free slot of their realm,
    aimed at the centre of their raid ties there. When the realm is full they go to the nearest Outer Isle. When
    that is full too they are counted as deferred, and never given land somebody holds.
  - Edition I also grants a hamlet to a small channel raided by a settled kingdom after the last night. A raid
    target the survey has not observed gets nothing and is counted.
  - A channel withheld by moderation gets a `hidden` tombstone. It is restored only when it has left the list and
    the revision actually observed it, not gone: a channel missing from a sweep may be hidden, deleted or banned,
    so absence never restores anything. A gone channel gets a `gone` tombstone. Its holding is abandoned for 30 days
    and then waiting land, and nobody else is ever granted it.
  - Hidden outranks gone. A channel that is both gone and withheld gets a `hidden` tombstone, so its land waits at
    once. A holding already tombstoned as gone that is then withheld gets a `hidden` tombstone over it, at the next
    run, with or without a newer survey. The ledger accepts a `hidden` tombstone over a `gone` one, and refuses every
    other second tombstone.
  - A holding's tier is fixed when it is granted. The map may draw a growing kingdom one tier larger.
- **Crash safety.** The new ledger is written beside the old one and renamed over it, and only then is its head
  acknowledged. An interrupted settlement leaves an unacknowledged tail: `check` reports it, and the next `settle`
  verifies it and then acknowledges it.
- **Proof.** `atlas:check` verifies every edition:
  - the world hash and the taxonomy bytes;
  - the whole hash chain with canonical encoding, one owner per holding and one holding per channel;
  - that every acknowledged head is still a prefix (no earlier address changed);
  - every holding on its realm's dry land without overlap, and slot holdings exactly on the lattice;
  - the founding gates and the signature, and that `founding.json` agrees with the founding night's settlements
    and hidden tombstones.
- **Rehearsal.** `atlas:rehearse` draws an edition in memory from the oldest kept revision and settles every later one
  into it. After each night it proves that nothing moved and every invariant holds. It writes nothing.
