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

-- One person's one journey between kingdoms (RG09, `apps/realm/src/raid-gate/records.ts`): reserved, readied, committed
-- once, or rolled back. Unique per (person, request) so a retried reservation returns its ticket.
CREATE TABLE realm_raid_travel (
  ticket     text PRIMARY KEY CHECK (length(ticket) BETWEEN 1 AND 128 AND ticket ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  state      text NOT NULL CHECK (state IN ('reserved', 'preparing', 'ready', 'committing', 'committed', 'cancelled', 'expired', 'denied', 'unknown')),
  release    text NOT NULL CHECK (release IN ('none', 'destination', 'source')),
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  UNIQUE (person_id, request_id),
  CHECK (record::jsonb ->> 'ticket' = ticket),
  CHECK (record::jsonb ->> 'personId' = person_id),
  CHECK (record::jsonb ->> 'requestId' = request_id),
  CHECK (record::jsonb ->> 'state' = state),
  CHECK (record::jsonb ->> 'release' = release),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_travel_open ON realm_raid_travel (ticket COLLATE "C") WHERE state IN ('reserved', 'preparing', 'ready', 'committing', 'unknown');
CREATE INDEX realm_raid_travel_release ON realm_raid_travel (ticket COLLATE "C") WHERE release <> 'none';

-- Immutable evidence that a destination acknowledged one person's arrival, one per committed ticket. Never public.
CREATE TABLE realm_raid_arrivals (
  arrival_id text PRIMARY KEY CHECK (length(arrival_id) BETWEEN 1 AND 140),
  ticket     text NOT NULL UNIQUE REFERENCES realm_raid_travel (ticket) DEFERRABLE INITIALLY DEFERRED,
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  revision   bigint NOT NULL CHECK (revision = 1),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  CHECK (arrival_id = 'arrival.' || ticket),
  CHECK (record::jsonb ->> 'arrivalId' = arrival_id),
  CHECK (record::jsonb ->> 'ticket' = ticket),
  CHECK (record::jsonb ->> 'personId' = person_id),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);

-- The one authoritative walking location per person, its membership fencing generation and outstanding journey.
CREATE TABLE realm_raid_whereabouts (
  person_id  text PRIMARY KEY CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  generation bigint NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
  -- The arrival that put the person here (null where they always were) and when this record last changed: the welcome
  -- lists the guests standing in a kingdom from these (RG10).
  arrival_id text CHECK (arrival_id IS NULL OR length(arrival_id) BETWEEN 1 AND 140),
  updated_at bigint NOT NULL CHECK (updated_at >= 0 AND updated_at <= 9007199254740991),
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record     text NOT NULL CHECK (octet_length(record) <= 4096),
  CHECK (record::jsonb ->> 'personId' = person_id),
  CHECK (record::jsonb ->> 'kingdomId' = kingdom_id),
  CHECK ((record::jsonb ->> 'generation')::bigint = generation),
  CHECK (record::jsonb ->> 'arrivalId' IS NOT DISTINCT FROM arrival_id),
  CHECK ((record::jsonb ->> 'updatedAt')::bigint = updated_at),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_whereabouts_arrived ON realm_raid_whereabouts (kingdom_id, updated_at DESC, person_id COLLATE "C") WHERE arrival_id IS NOT NULL;

-- One visitor gift offer around one acknowledged arrival (RG10, `apps/api/src/raid-gate/gifts.ts`): offered by its
-- owner, then accepted, refused, expired or rejected once. Unique per (giver, request) so a retried offer finds its
-- record, and at most one open offer per thing. The thing itself stays in main's item authority; nothing here owns it.
-- Both unique indexes stay non-deferrable: they are the arbiters of the adapter's `on conflict do nothing`.
CREATE TABLE realm_raid_gifts (
  offer_id     text PRIMARY KEY CHECK (length(offer_id) BETWEEN 1 AND 128 AND offer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  giver_id     text NOT NULL CHECK (giver_id ~ '^[1-9][0-9]{0,31}$'),
  request_id   text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  recipient_id text NOT NULL CHECK (recipient_id ~ '^[1-9][0-9]{0,31}$'),
  arrival_id   text NOT NULL CHECK (length(arrival_id) BETWEEN 1 AND 128),
  kingdom_id   text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  item_id      text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  state        text NOT NULL CHECK (state IN ('offered', 'accepted', 'refused', 'expired', 'rejected')),
  offered_at   bigint NOT NULL CHECK (offered_at >= 0 AND offered_at <= 9007199254740991),
  origin       text NOT NULL CHECK (origin IN ('live', 'simulated')),
  revision     bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  record       text NOT NULL CHECK (octet_length(record) <= 8192),
  UNIQUE (giver_id, request_id),
  CHECK (giver_id <> recipient_id),
  CHECK (record::jsonb ->> 'offerId' = offer_id),
  CHECK (record::jsonb ->> 'giverId' = giver_id),
  CHECK (record::jsonb ->> 'requestId' = request_id),
  CHECK (record::jsonb ->> 'recipientId' = recipient_id),
  CHECK (record::jsonb ->> 'arrivalId' = arrival_id),
  CHECK (record::jsonb ->> 'kingdomId' = kingdom_id),
  CHECK (record::jsonb ->> 'itemId' = item_id),
  CHECK (record::jsonb ->> 'state' = state),
  CHECK ((record::jsonb ->> 'offeredAt')::bigint = offered_at),
  CHECK (record::jsonb ->> 'origin' = origin),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE UNIQUE INDEX realm_raid_gifts_open ON realm_raid_gifts (item_id) WHERE state = 'offered';
CREATE INDEX realm_raid_gifts_arrival ON realm_raid_gifts (arrival_id, offered_at DESC, offer_id COLLATE "C");
CREATE INDEX realm_raid_gifts_giver ON realm_raid_gifts (kingdom_id, giver_id, offered_at DESC, offer_id COLLATE "C");
CREATE INDEX realm_raid_gifts_recipient ON realm_raid_gifts (kingdom_id, recipient_id, offered_at DESC, offer_id COLLATE "C");

-- The append-only lineage of one ownership transfer, written in the transaction that moved the thing and accepted its
-- offer. Its ID is the offer's, so one offer moves a thing once. Never rewritten or deleted (`realm_refuse_rewrite`,
-- migration 0003).
CREATE TABLE realm_raid_item_transfers (
  transfer_id text PRIMARY KEY REFERENCES realm_raid_gifts (offer_id) DEFERRABLE INITIALLY DEFERRED,
  item_id     text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  origin      text NOT NULL CHECK (origin IN ('live', 'simulated')),
  revision    bigint NOT NULL CHECK (revision = 1),
  record      text NOT NULL CHECK (octet_length(record) <= 4096),
  CHECK (record::jsonb ->> 'transferId' = transfer_id),
  CHECK (record::jsonb ->> 'offerId' = transfer_id),
  CHECK (record::jsonb ->> 'itemId' = item_id),
  CHECK (record::jsonb ->> 'origin' = origin),
  CHECK ((record::jsonb ->> 'revision')::bigint = revision)
);
CREATE INDEX realm_raid_item_transfers_item ON realm_raid_item_transfers (item_id);
CREATE TRIGGER realm_raid_item_transfers_immutable BEFORE UPDATE OR DELETE ON realm_raid_item_transfers FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
