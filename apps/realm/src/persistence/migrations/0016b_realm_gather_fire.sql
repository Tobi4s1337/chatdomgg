-- The campfire's private checkpoint per kingdom fire: the running Dusk Court with its roles, night taps, ballots,
-- the Gallery's identities for the current day, the seed and cursor, and absolute deadlines. Never public.
CREATE TABLE gather_fire_checkpoints (
  kingdom_id text NOT NULL CHECK (octet_length(kingdom_id) BETWEEN 1 AND 128),
  site text NOT NULL CHECK (octet_length(site) BETWEEN 1 AND 64),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  snapshot text NOT NULL CHECK (octet_length(snapshot) <= 2097152),
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (kingdom_id, site)
);
