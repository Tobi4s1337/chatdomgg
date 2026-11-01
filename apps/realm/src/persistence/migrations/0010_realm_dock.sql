-- Royal acts share the retained realm writer and its fence. Presentation is acknowledged separately.
CREATE TABLE realm_dock_heads (
  kingdom_id text PRIMARY KEY REFERENCES realm_kingdoms (kingdom_id),
  revision bigint NOT NULL DEFAULT 0,
  state text NOT NULL CHECK (octet_length(state) <= 262144)
);
CREATE TABLE realm_dock_actions (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  action_id text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  outcome text NOT NULL CHECK (octet_length(outcome) <= 262144),
  event_id text,
  created_ms bigint NOT NULL,
  PRIMARY KEY (kingdom_id, origin, action_id)
);
CREATE TABLE realm_dock_presentations (
  event_id text PRIMARY KEY,
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  action_id text NOT NULL,
  presentation text NOT NULL CHECK (octet_length(presentation) <= 16384),
  created_ms bigint NOT NULL,
  witnessed_ms bigint,
  UNIQUE (kingdom_id, origin, action_id)
);
CREATE INDEX realm_dock_presentations_replay ON realm_dock_presentations (kingdom_id, created_ms);
