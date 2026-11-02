-- Public preferences are independent of founding. No foreign key may accidentally found a kingdom.
CREATE TABLE realm_panel_settings (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  settings text NOT NULL CHECK (octet_length(settings) <= 4096),
  updated_ms bigint NOT NULL,
  PRIMARY KEY (origin, kingdom_id)
);
