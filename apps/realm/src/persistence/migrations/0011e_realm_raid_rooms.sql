-- The room side of a journey between kingdoms (RS11, `apps/realm/src/raid-gate/room-travel.ts`). Additive only.
-- One walking membership per person with its fencing generation, and one hold per travel ticket. The travel
-- coordinator's own records (0011) decide; these rows are what the destination's door holds, commits and releases.
CREATE TABLE realm_raid_room_members (
  origin     text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  generation bigint NOT NULL CHECK (generation > 0 AND generation <= 9007199254740991),
  ticket     text NOT NULL CHECK (length(ticket) BETWEEN 1 AND 128),
  updated_ms bigint NOT NULL CHECK (updated_ms >= 0),
  PRIMARY KEY (origin, person_id)
);
CREATE INDEX realm_raid_room_members_kingdom ON realm_raid_room_members (origin, kingdom_id, updated_ms DESC);

CREATE TABLE realm_raid_room_tickets (
  origin          text NOT NULL CHECK (origin IN ('live', 'simulated')),
  ticket          text NOT NULL CHECK (length(ticket) BETWEEN 1 AND 128 AND ticket ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  person_id       text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  session_id      text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
  from_kingdom_id text NOT NULL CHECK (from_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  to_kingdom_id   text NOT NULL CHECK (to_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  generation      bigint NOT NULL CHECK (generation > 0 AND generation <= 9007199254740991),
  kind            text NOT NULL CHECK (kind IN ('visit', 'raid', 'return')),
  -- held: a place is kept; committed: the walker moved; released: it will never commit (released or reconciled).
  state           text NOT NULL CHECK (state IN ('held', 'committed', 'released')),
  lease_until_ms  bigint NOT NULL CHECK (lease_until_ms >= 0),
  prepared        boolean NOT NULL DEFAULT false,
  role            text CHECK (role IN ('monarch', 'citizen', 'visitor')),
  committed_ms    bigint CHECK (committed_ms >= 0),
  source_released boolean NOT NULL DEFAULT false,
  created_ms      bigint NOT NULL CHECK (created_ms >= 0),
  updated_ms      bigint NOT NULL CHECK (updated_ms >= created_ms),
  PRIMARY KEY (origin, ticket),
  CHECK (from_kingdom_id <> to_kingdom_id),
  CHECK ((state = 'committed') = (role IS NOT NULL AND committed_ms IS NOT NULL)),
  CHECK (NOT source_released OR state = 'committed')
);
CREATE INDEX realm_raid_room_tickets_door ON realm_raid_room_tickets (origin, to_kingdom_id, state, lease_until_ms);
CREATE INDEX realm_raid_room_tickets_arrived ON realm_raid_room_tickets (origin, person_id, to_kingdom_id, committed_ms DESC) WHERE state = 'committed';
