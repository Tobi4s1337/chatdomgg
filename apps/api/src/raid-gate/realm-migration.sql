-- The Raid Gate's durable records (spec 23). Additive only.
-- Main registers this file unchanged as apps/realm/src/persistence/migrations/0009_realm_raid_gate.sql; once applied
-- it is never edited (the migrator stops on a changed checksum), so later changes arrive as new migrations.
--
-- Each row keeps the canonical record exactly as `apps/api/src/raid-gate/repository.ts` defines it, as JSON text, and
-- its strict reader decodes it on every read. The key columns are copies checked against that text. A write is a
-- compare-and-set on `revision`. Records hold no OAuth credential and no chat text; the preview token exists only as
-- its SHA-256 hash inside the action record.

-- One open gate per source kingdom. Moving this pointer is what supersedes an older, unstarted preview.
CREATE TABLE realm_raid_gate_pointers (
  kingdom_id text PRIMARY KEY CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  request_id text CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 128),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  CHECK (record::jsonb ->> 'kingdomId' = kingdom_id),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision),
  CHECK ((record::jsonb ->> 'requestId') IS NOT DISTINCT FROM request_id)
);

-- One monarch's one decision: preview, Twitch's answer and the opted-in count, kept in one row.
CREATE TABLE realm_raid_gate_actions (
  request_id      text PRIMARY KEY CHECK (length(request_id) BETWEEN 1 AND 128 AND request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  from_kingdom_id text NOT NULL CHECK (from_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  to_kingdom_id   text NOT NULL CHECK (to_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  state           text NOT NULL CHECK (state IN ('prepared', 'dispatching', 'pending', 'landed', 'cancelled', 'rejected', 'unknown')),
  origin          text NOT NULL CHECK (origin IN ('live', 'simulated')),
  revision        bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record          text NOT NULL CHECK (octet_length(record) <= 32768),
  CHECK (from_kingdom_id <> to_kingdom_id),
  CHECK (record::jsonb ->> 'requestId' = request_id),
  CHECK (record::jsonb ->> 'from' = from_kingdom_id),
  CHECK (record::jsonb ->> 'to' = to_kingdom_id),
  CHECK (record::jsonb ->> 'state' = state),
  CHECK (record::jsonb ->> 'origin' = origin),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_gate_actions_source ON realm_raid_gate_actions (from_kingdom_id, state);

-- One person's choice for one request. The action's opted-in count changes in the same transaction.
CREATE TABLE realm_raid_gate_members (
  request_id text NOT NULL,
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  joined     boolean NOT NULL,
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  PRIMARY KEY (request_id, person_id),
  -- Checked at commit, so a transaction may write the member and its action in either order.
  FOREIGN KEY (request_id) REFERENCES realm_raid_gate_actions (request_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (record::jsonb ->> 'requestId' = request_id),
  CHECK (record::jsonb ->> 'personId' = person_id),
  CHECK ((record::jsonb ->> 'joined')::boolean = joined),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_gate_actions_state ON realm_raid_gate_actions (state, request_id COLLATE "C");

-- One external effect per request and kind (start, cancel, road), written in the same transaction as the decision
-- that wants it. Its ID is the idempotency key handed to the Twitch or Atlas transport. A `claimed` Twitch write may
-- have happened and is only ever reconciled, never sent again.
CREATE TABLE realm_raid_gate_outbox (
  outbox_id  text PRIMARY KEY CHECK (length(outbox_id) BETWEEN 3 AND 140),
  request_id text NOT NULL REFERENCES realm_raid_gate_actions (request_id) DEFERRABLE INITIALLY DEFERRED,
  kind       text NOT NULL CHECK (kind IN ('start', 'cancel', 'road')),
  state      text NOT NULL CHECK (state IN ('queued', 'claimed', 'settled')),
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  CHECK (outbox_id = request_id || '/' || kind),
  CHECK (record::jsonb ->> 'id' = outbox_id),
  CHECK (record::jsonb ->> 'requestId' = request_id),
  CHECK (record::jsonb ->> 'kind' = kind),
  CHECK (record::jsonb ->> 'state' = state),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_gate_outbox_state ON realm_raid_gate_outbox (state, outbox_id COLLATE "C");
