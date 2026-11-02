-- A person's stream-name preference. It does not change their card, deed or earned belongings.
CREATE TABLE realm_panel_privacy (
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  quiet boolean NOT NULL DEFAULT false,
  updated_ms bigint NOT NULL CHECK (updated_ms >= 0),
  PRIMARY KEY (person_id, origin)
);
