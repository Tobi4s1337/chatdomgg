-- Normalized Twitch moment records, never raw provider notifications. Moment sequence is independent of domain facts.
CREATE TABLE realm_moment_values (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  record_key text NOT NULL CHECK (record_key ~ '^twitch-moments:[a-z-]+(:[A-Za-z0-9_.:-]{1,160})?$'),
  value text NOT NULL CHECK (octet_length(value) <= 33554432),
  PRIMARY KEY (kingdom_id, record_key)
);
CREATE TABLE realm_moment_heads (
  kingdom_id text PRIMARY KEY REFERENCES realm_kingdoms (kingdom_id),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0 AND sequence <= 9007199254740991)
);
CREATE TABLE realm_moment_facts (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  seq bigint NOT NULL CHECK (seq > 0 AND seq <= 9007199254740991),
  writer_epoch text NOT NULL CHECK (writer_epoch ~ '^[a-f0-9]{64}$'),
  fact text NOT NULL CHECK (octet_length(fact) <= 262144),
  committed_ms bigint NOT NULL,
  PRIMARY KEY (kingdom_id, seq)
);
ALTER TABLE realm_outbox DROP CONSTRAINT realm_outbox_kind_check;
ALTER TABLE realm_outbox ADD CONSTRAINT realm_outbox_kind_check
  CHECK (kind IN ('presence', 'forge', 'home', 'castle', 'moment'));
