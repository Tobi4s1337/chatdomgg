-- Names hidden from the pier's public pages after moderation in that kingdom's chat. The person's own records stay theirs.
CREATE TABLE realm_pier_hidden_names (
  kingdom_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id text NOT NULL,
  hidden_ms bigint NOT NULL CHECK (hidden_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (kingdom_id, origin, person_id)
);

-- The Almanac reads the biggest catch of each species without scanning every record.
CREATE INDEX realm_fishing_catches_weight
  ON realm_fishing_catches (kingdom_id, origin, species_id, ((record->'fish'->>'weightG')::integer) DESC, caught_ms);
