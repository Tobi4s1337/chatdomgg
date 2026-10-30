-- Realm authority core. Additive only: later migrations add tables/columns, never rewrite these rows.
-- All instants are authoritative database milliseconds (floor(extract(epoch from clock_timestamp()) * 1000)).

CREATE TABLE realm_kingdoms (
  kingdom_id        text PRIMARY KEY CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  origin            text NOT NULL CHECK (origin IN ('live', 'simulated')),
  -- Last committed fact sequence. Advanced only by the fenced writer inside its commit.
  sequence          bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  writer_epoch      text CHECK (writer_epoch ~ '^[a-f0-9]{64}$'),
  writer_generation bigint NOT NULL DEFAULT 0,
  lease_expires_ms  bigint,
  created_ms        bigint NOT NULL,
  CHECK ((writer_epoch IS NULL) = (lease_expires_ms IS NULL))
);

-- Private ordered history. Canonical JSON text keeps the exact digested bytes.
CREATE TABLE realm_facts (
  kingdom_id   text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  seq          bigint NOT NULL CHECK (seq > 0),
  writer_epoch text NOT NULL,
  command_id   text NOT NULL,
  fact         text NOT NULL,
  digest       text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  committed_ms bigint NOT NULL,
  PRIMARY KEY (kingdom_id, seq)
);

-- One decided outcome per (kingdom, command). The digest separates a retry from a conflicting reuse.
CREATE TABLE realm_commands (
  kingdom_id   text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  command_id   text NOT NULL,
  digest       text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  status       text NOT NULL CHECK (status IN ('committed', 'unchanged', 'rejected')),
  sequence     bigint,
  reason       text,
  writer_epoch text NOT NULL,
  decided_ms   bigint NOT NULL,
  PRIMARY KEY (kingdom_id, command_id),
  CHECK ((status = 'committed') = (sequence IS NOT NULL)),
  CHECK ((status = 'committed') = (reason IS NULL))
);

-- Versioned private snapshots; a snapshot is written in the same transaction as the fact it covers.
CREATE TABLE realm_snapshots (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  seq        bigint NOT NULL CHECK (seq >= 0),
  version    integer NOT NULL,
  state      text NOT NULL,
  digest     text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  created_ms bigint NOT NULL,
  PRIMARY KEY (kingdom_id, seq)
);

-- Every coal balance change, written beside the fact that caused it.
CREATE TABLE realm_coal_ledger (
  kingdom_id text NOT NULL,
  seq        bigint NOT NULL,
  person_id  text NOT NULL,
  delta      integer NOT NULL CHECK (delta <> 0),
  balance    integer NOT NULL CHECK (balance >= 0),
  reason     text NOT NULL,
  PRIMARY KEY (kingdom_id, seq, person_id),
  FOREIGN KEY (kingdom_id, seq) REFERENCES realm_facts (kingdom_id, seq)
);

-- An original design exists once across every kingdom.
CREATE TABLE realm_designs (
  design_id     text PRIMARY KEY,
  kingdom_id    text NOT NULL,
  seq           bigint NOT NULL,
  attachment_id text NOT NULL,
  -- Claimed before its fact row inside the same transaction, so the reference is checked at COMMIT.
  FOREIGN KEY (kingdom_id, seq) REFERENCES realm_facts (kingdom_id, seq) DEFERRABLE INITIALLY DEFERRED
);

-- Sanitized public deliveries, committed with their fact. Never raw facts, words, rights or sessions.
CREATE TABLE realm_outbox (
  id         bigserial PRIMARY KEY,
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  sequence   bigint NOT NULL CHECK (sequence >= 0),
  event_id   text NOT NULL UNIQUE,
  kind       text NOT NULL CHECK (kind IN ('presence', 'forge', 'home')),
  plot_id    text,
  message    text NOT NULL,
  created_ms bigint NOT NULL
);
CREATE INDEX realm_outbox_kingdom ON realm_outbox (kingdom_id, id);
CREATE INDEX realm_outbox_plots ON realm_outbox (kingdom_id, plot_id) WHERE plot_id IS NOT NULL;
CREATE INDEX realm_outbox_kinds ON realm_outbox (kingdom_id, kind, id);

-- Private presence checkpoint and its per-observation receipts (no chat text; codec bytes only).
CREATE TABLE realm_ingress_checkpoints (
  kingdom_id text PRIMARY KEY REFERENCES realm_kingdoms (kingdom_id),
  revision   bigint NOT NULL CHECK (revision > 0),
  codec      text NOT NULL CHECK (codec = 'presence-v1'),
  data       bytea NOT NULL,
  updated_ms bigint NOT NULL
);
CREATE TABLE realm_ingress_receipts (
  kingdom_id          text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  source              text NOT NULL CHECK (source IN ('herald', 'panel', 'walker')),
  observation_id      text NOT NULL,
  digest              text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  status              text NOT NULL CHECK (status IN ('committed', 'unchanged', 'rejected')),
  sequence            bigint,
  reason              text,
  checkpoint_revision bigint,
  writer_epoch        text NOT NULL,
  decided_ms          bigint NOT NULL,
  PRIMARY KEY (kingdom_id, source, observation_id),
  CHECK ((status = 'committed') = (sequence IS NOT NULL)),
  CHECK ((status = 'committed') = (reason IS NULL))
);
