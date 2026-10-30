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
