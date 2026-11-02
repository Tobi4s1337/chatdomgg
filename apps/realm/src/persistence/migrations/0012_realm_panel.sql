-- Private promises made before a kingdom is founded. They reserve no deed or plot and consume no home allowance.
-- The channel has no realm_kingdoms row yet, so neither identity has a foreign key to the founded realm.
CREATE TABLE realm_panel_pledges (
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  pledged_ms bigint NOT NULL CHECK (pledged_ms >= 0),
  PRIMARY KEY (kingdom_id, person_id, origin)
);
