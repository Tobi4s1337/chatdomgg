-- A witnessed incoming raid may cause one bot welcome. Never reclaim an attempt: its reply may have been lost.
-- Locking and writing this origin head serializes budget reservation and setting changes across every worker.
CREATE TABLE realm_raid_crier_heads (
  origin text PRIMARY KEY CHECK (origin IN ('live', 'simulated'))
);
INSERT INTO realm_raid_crier_heads (origin) VALUES ('live'), ('simulated');

-- Missing settings mean rare, revision zero. Only a monarch configuration persists a first revision.
CREATE TABLE realm_raid_crier_settings (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  revision bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  mode text NOT NULL CHECK (mode IN ('silent', 'rare', 'herald')),
  PRIMARY KEY (origin, kingdom_id)
);
CREATE TABLE realm_raid_crier_jobs (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  event_id text NOT NULL,
  raid_id text NOT NULL CHECK (raid_id ~ '^raid\.[a-f0-9]{64}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  occurred_ms bigint NOT NULL CHECK (occurred_ms >= 0 AND occurred_ms <= 9007199254740991),
  state text NOT NULL CHECK (state IN ('queued', 'claimed', 'sent', 'refused', 'unknown', 'expired', 'suppressed')),
  claim_id text UNIQUE CHECK (claim_id IS NULL OR claim_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  sender_id text CHECK (sender_id IS NULL OR sender_id ~ '^[1-9][0-9]{0,31}$'),
  claimed_ms bigint CHECK (claimed_ms IS NULL OR (claimed_ms >= 0 AND claimed_ms <= 9007199254740991)),
  claim text CHECK (claim IS NULL OR octet_length(claim) <= 4096),
  outcome text CHECK (outcome IS NULL OR octet_length(outcome) <= 512),
  PRIMARY KEY (origin, event_id),
  UNIQUE (origin, raid_id),
  FOREIGN KEY (origin, event_id) REFERENCES realm_raid_observations (origin, event_id),
  CHECK (sender_id IS NULL OR sender_id <> kingdom_id),
  CHECK ((state IN ('claimed', 'sent', 'refused', 'unknown') AND claim_id IS NOT NULL AND sender_id IS NOT NULL AND claimed_ms IS NOT NULL AND claim IS NOT NULL)
    OR (state IN ('queued', 'expired', 'suppressed') AND claim_id IS NULL AND sender_id IS NULL AND claimed_ms IS NULL AND claim IS NULL AND outcome IS NULL)),
  CHECK (claim IS NULL OR (claim::jsonb ->> 'claimId' = claim_id AND claim::jsonb ->> 'origin' = origin
    AND claim::jsonb ->> 'kingdomId' = kingdom_id AND claim::jsonb ->> 'senderId' = sender_id AND claim::jsonb ->> 'raidId' = raid_id)),
  CHECK ((state = 'sent' AND outcome IS NOT NULL AND outcome::jsonb ->> 'status' = 'sent')
    OR (state = 'refused' AND outcome IS NOT NULL AND outcome::jsonb ->> 'status' = 'refused')
    OR (state = 'unknown' AND (outcome IS NULL OR outcome::jsonb ->> 'status' = 'unknown'))
    OR (state IN ('queued', 'claimed', 'expired', 'suppressed') AND outcome IS NULL))
);
CREATE INDEX realm_raid_crier_pending ON realm_raid_crier_jobs (origin, kingdom_id, occurred_ms, event_id) WHERE state = 'queued';
CREATE INDEX realm_raid_crier_sender_budget ON realm_raid_crier_jobs (origin, sender_id, claimed_ms) WHERE claimed_ms IS NOT NULL;
CREATE INDEX realm_raid_crier_kingdom_budget ON realm_raid_crier_jobs (origin, kingdom_id, claimed_ms) WHERE claimed_ms IS NOT NULL;

-- Job identity remains linked to immutable observation history, and a claim can be assigned only once.
CREATE FUNCTION realm_raid_crier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Raid welcome history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('queued', 'suppressed') OR NOT EXISTS (
      SELECT 1 FROM realm_raid_observations o WHERE o.origin = NEW.origin AND o.event_id = NEW.event_id
        AND o.raid_id = NEW.raid_id AND o.kingdom_id = NEW.kingdom_id AND o.occurred_ms = NEW.occurred_ms
        AND o.direction = 'incoming' AND (o.observation::jsonb ->> 'viewers')::bigint >= 3
    ) THEN RAISE EXCEPTION 'A welcome needs a witnessed incoming raid of at least three viewers'; END IF;
  ELSE
    IF (NEW.origin, NEW.event_id, NEW.raid_id, NEW.kingdom_id, NEW.occurred_ms)
      IS DISTINCT FROM (OLD.origin, OLD.event_id, OLD.raid_id, OLD.kingdom_id, OLD.occurred_ms)
      THEN RAISE EXCEPTION 'Raid welcome identity is immutable'; END IF;
    IF OLD.claim_id IS NOT NULL AND (NEW.claim_id, NEW.sender_id, NEW.claimed_ms, NEW.claim)
      IS DISTINCT FROM (OLD.claim_id, OLD.sender_id, OLD.claimed_ms, OLD.claim)
      THEN RAISE EXCEPTION 'A raid welcome claim cannot be replaced'; END IF;
    IF NOT (
      (OLD.state = 'queued' AND NEW.state IN ('claimed', 'expired', 'suppressed'))
      OR (OLD.state = 'claimed' AND NEW.state IN ('sent', 'refused', 'unknown'))
      OR (OLD.state = 'unknown' AND NEW.state = 'sent')
      OR (OLD.state = 'unknown' AND NEW.state = 'refused' AND OLD.outcome IS NULL)
      OR (OLD.state = 'unknown' AND NEW.state = 'unknown' AND OLD.outcome IS NULL)
    ) THEN RAISE EXCEPTION 'A raid welcome cannot be retried or its final receipt changed'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_raid_crier_history BEFORE INSERT OR UPDATE OR DELETE ON realm_raid_crier_jobs
  FOR EACH ROW EXECUTE FUNCTION realm_raid_crier_guard();

-- Facts witnessed before this worker deployed are still eligible only within their original sixty-second window.
-- The claim authority expires old rows before selecting one; migration never refreshes their provider time.
INSERT INTO realm_raid_crier_jobs (origin, event_id, raid_id, kingdom_id, occurred_ms, state)
  SELECT origin, event_id, raid_id, kingdom_id, occurred_ms, 'queued' FROM realm_raid_observations
  WHERE direction = 'incoming' AND (observation::jsonb ->> 'viewers')::bigint >= 3;
