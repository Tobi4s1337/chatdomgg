-- Ingress that cannot vanish and public delivery that can resume (spec 34 R7). Additive only.

-- Authenticated, normalized presence observations, accepted before any writer decides them. A row is the durable
-- promise that the kingdom's writer will run it through executeIngress; its receipt in realm_ingress_receipts is the
-- answer. `settled_ms` only lets the writer skip finished rows; the receipt stays the truth. No chat text is stored:
-- the observation is a validated PresenceInput, whose schema has no room for message words.
CREATE TABLE realm_ingress_inbox (
  inbox_id        bigserial UNIQUE,
  kingdom_id      text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  source          text NOT NULL CHECK (source IN ('herald', 'panel', 'walker')),
  observation_id  text NOT NULL,
  digest          text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  -- The capability the authenticated service was granted for this observation. Ingress grants presence only.
  capability      text NOT NULL CHECK (capability = 'presence'),
  observation     text NOT NULL,
  received_ms     bigint NOT NULL,
  settled_ms      bigint,
  settled_status  text CHECK (settled_status IN ('committed', 'unchanged', 'rejected')),
  settled_reason  text,
  PRIMARY KEY (kingdom_id, source, observation_id),
  CHECK ((settled_ms IS NULL) = (settled_status IS NULL))
);
CREATE INDEX realm_ingress_inbox_pending ON realm_ingress_inbox (kingdom_id, inbox_id) WHERE settled_ms IS NULL;

-- How far committed public outbox rows have been handed to this kingdom's transport. Advanced only by the current
-- writer epoch, after delivery. Rows past it are delivered again, with the same event IDs, by whoever writes next.
CREATE TABLE realm_outbox_cursors (
  kingdom_id   text PRIMARY KEY REFERENCES realm_kingdoms (kingdom_id),
  delivered_id bigint NOT NULL CHECK (delivered_id >= 0),
  writer_epoch text NOT NULL CHECK (writer_epoch ~ '^[a-f0-9]{64}$'),
  updated_ms   bigint NOT NULL
);
