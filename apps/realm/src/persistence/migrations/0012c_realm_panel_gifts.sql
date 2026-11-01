-- Panel Bits gifts have their own typed facts. Nothing here is a Twitch cheer or a presence credit.
CREATE TABLE realm_panel_gift_intents (
  intent_id uuid PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  extension_id text NOT NULL,
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  request_id uuid NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  sku text NOT NULL,
  gift_id text NOT NULL,
  effect_version integer NOT NULL CHECK (effect_version > 0),
  duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 1 AND 86400000),
  public_line text NOT NULL,
  target_plot_id text,
  target_slot integer CHECK (target_slot BETWEEN 0 AND 65534),
  state text NOT NULL CHECK (state IN ('open', 'cancelled', 'paid', 'committed')),
  created_ms bigint NOT NULL,
  checkout_until_ms bigint NOT NULL,
  updated_ms bigint NOT NULL,
  UNIQUE (origin, extension_id, kingdom_id, person_id, request_id),
  CHECK ((target_plot_id IS NULL) = (target_slot IS NULL)),
  CHECK (checkout_until_ms > created_ms)
);
-- A cancelled dialog can still produce a late payment. Its retained intent is never repurposed.
-- New checkouts also check paid rows while holding the kingdom writer row lock.
CREATE UNIQUE INDEX realm_panel_gift_one_checkout
  ON realm_panel_gift_intents (origin, extension_id, kingdom_id, person_id, sku) WHERE state = 'open';
CREATE INDEX realm_panel_gift_intent_matching
  ON realm_panel_gift_intents (origin, extension_id, kingdom_id, person_id, sku, created_ms);

CREATE FUNCTION realm_panel_gift_selection_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.intent_id, NEW.origin, NEW.extension_id, NEW.kingdom_id, NEW.person_id, NEW.request_id, NEW.request_digest,
      NEW.sku, NEW.gift_id, NEW.effect_version, NEW.duration_ms, NEW.public_line, NEW.target_plot_id, NEW.target_slot,
      NEW.created_ms, NEW.checkout_until_ms)
    IS DISTINCT FROM
     (OLD.intent_id, OLD.origin, OLD.extension_id, OLD.kingdom_id, OLD.person_id, OLD.request_id, OLD.request_digest,
      OLD.sku, OLD.gift_id, OLD.effect_version, OLD.duration_ms, OLD.public_line, OLD.target_plot_id, OLD.target_slot,
      OLD.created_ms, OLD.checkout_until_ms) THEN
    RAISE EXCEPTION 'a gift selection is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_panel_gift_selection_fixed BEFORE UPDATE ON realm_panel_gift_intents
  FOR EACH ROW EXECUTE FUNCTION realm_panel_gift_selection_fixed();

-- A canonical verified payment is retained even without a matching intent or an available effect.
CREATE TABLE realm_panel_gift_transactions (
  payment_ref uuid NOT NULL UNIQUE,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  extension_id text NOT NULL,
  transaction_id text NOT NULL,
  kingdom_id text NOT NULL,
  person_id text NOT NULL,
  sku text NOT NULL,
  bits integer NOT NULL CHECK (bits BETWEEN 0 AND 10000),
  in_development boolean NOT NULL,
  occurred_ms bigint NOT NULL,
  public_name text NOT NULL,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  intent_id uuid UNIQUE REFERENCES realm_panel_gift_intents (intent_id),
  fact_id text UNIQUE,
  received_ms bigint NOT NULL,
  PRIMARY KEY (origin, extension_id, transaction_id)
);
CREATE INDEX realm_panel_gift_unmatched ON realm_panel_gift_transactions (origin, kingdom_id, person_id, sku)
  WHERE fact_id IS NULL;

CREATE TABLE realm_panel_gift_heads (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL,
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  PRIMARY KEY (origin, kingdom_id)
);
CREATE TABLE realm_panel_gift_facts (
  id text PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  writer_epoch text NOT NULL,
  fact text NOT NULL,
  committed_ms bigint NOT NULL,
  UNIQUE (origin, kingdom_id, sequence)
);
ALTER TABLE realm_panel_gift_transactions ADD FOREIGN KEY (fact_id) REFERENCES realm_panel_gift_facts (id);
-- The owned public feed uses the same durable fact ID; it never repeats provider transaction data.
CREATE TABLE realm_panel_gift_outbox (
  origin text NOT NULL,
  kingdom_id text NOT NULL,
  sequence bigint NOT NULL,
  fact_id text NOT NULL UNIQUE REFERENCES realm_panel_gift_facts (id),
  PRIMARY KEY (origin, kingdom_id, sequence)
);
CREATE TABLE realm_panel_gift_reconciliation (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  extension_id text NOT NULL,
  cursor text CHECK (cursor IS NULL OR length(cursor) <= 512),
  updated_ms bigint NOT NULL,
  PRIMARY KEY (origin, extension_id)
);
CREATE TABLE realm_panel_gift_inbox (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  extension_id text NOT NULL,
  transaction_id text NOT NULL,
  queued_ms bigint NOT NULL,
  done boolean NOT NULL DEFAULT false,
  PRIMARY KEY (origin, extension_id, transaction_id)
);
CREATE INDEX realm_panel_gift_inbox_pending ON realm_panel_gift_inbox (origin, extension_id, queued_ms) WHERE done = false;
