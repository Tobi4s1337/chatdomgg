-- Invitation intent, actual room admission and destination chat are different facts. None is an outbound march.
-- These records deliberately do not cascade from expiring sessions/entries: a visit outlives its browser.
CREATE TABLE realm_raid_guest_heads (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  lock_revision bigint NOT NULL DEFAULT 1 CHECK (lock_revision > 0),
  stamp_sequence bigint NOT NULL DEFAULT 0 CHECK (stamp_sequence BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (origin, person_id)
);
CREATE TABLE realm_raid_guest_intents (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  session_id uuid NOT NULL,
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  raid_id text NOT NULL,
  begun_ms bigint NOT NULL CHECK (begun_ms BETWEEN 0 AND 9007199254740991),
  UNIQUE (origin, session_id, raid_id),
  FOREIGN KEY (origin, raid_id) REFERENCES realm_raid_observations (origin, raid_id)
);
CREATE INDEX realm_raid_guest_intents_entry ON realm_raid_guest_intents (origin, session_id, kingdom_id, sequence DESC);
CREATE TABLE realm_raid_guest_arrivals (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  entry_id uuid NOT NULL,
  session_id uuid NOT NULL,
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  raid_id text NOT NULL,
  intent_sequence bigint NOT NULL REFERENCES realm_raid_guest_intents (sequence),
  arrived_ms bigint NOT NULL CHECK (arrived_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (origin, entry_id),
  FOREIGN KEY (origin, raid_id) REFERENCES realm_raid_observations (origin, raid_id)
);
CREATE INDEX realm_raid_guest_arrivals_person ON realm_raid_guest_arrivals (origin, person_id, kingdom_id, raid_id);
CREATE INDEX realm_raid_guest_arrivals_intent ON realm_raid_guest_arrivals (origin, intent_sequence);
-- History survives a process restart; current walker presentation requires a room-owned 90-second lease.
CREATE TABLE realm_raid_guest_presence (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  entry_id uuid NOT NULL,
  last_seen_ms bigint NOT NULL CHECK (last_seen_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (origin, entry_id),
  FOREIGN KEY (origin, entry_id) REFERENCES realm_raid_guest_arrivals (origin, entry_id)
);
CREATE TABLE realm_raid_guest_departures (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  entry_id uuid NOT NULL,
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  departed_ms bigint NOT NULL CHECK (departed_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (origin, entry_id)
);
CREATE TABLE realm_raid_guest_chat (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 128),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  raid_id text NOT NULL,
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 9007199254740991),
  basis text NOT NULL CHECK (basis IN ('source_citizen', 'guest')),
  entry_id uuid,
  PRIMARY KEY (origin, kingdom_id, message_id),
  FOREIGN KEY (origin, raid_id) REFERENCES realm_raid_observations (origin, raid_id),
  FOREIGN KEY (origin, entry_id) REFERENCES realm_raid_guest_arrivals (origin, entry_id),
  CHECK ((basis = 'guest') = (entry_id IS NOT NULL))
);
CREATE INDEX realm_raid_guest_chat_person ON realm_raid_guest_chat (origin, person_id, kingdom_id, at_ms DESC);
-- Presence is mutable; the qualifying chat that established this visit remains an immutable fact above.
-- Only continued verified chat renews it, using provider time and the shared 90-second presence lease.
CREATE TABLE realm_raid_guest_chat_visits (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  raid_id text NOT NULL,
  proof_message_id text NOT NULL,
  last_message_id text NOT NULL CHECK (length(last_message_id) BETWEEN 1 AND 128),
  last_seen_ms bigint NOT NULL CHECK (last_seen_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (origin, person_id, kingdom_id, raid_id),
  FOREIGN KEY (origin, kingdom_id, proof_message_id) REFERENCES realm_raid_guest_chat (origin, kingdom_id, message_id)
);
CREATE TABLE realm_raid_guest_rewards (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  raid_id text NOT NULL,
  awarded_ms bigint NOT NULL CHECK (awarded_ms BETWEEN 0 AND 9007199254740991),
  utc_day bigint NOT NULL CHECK (utc_day >= 0),
  reward_slot integer CHECK (reward_slot IN (1, 2)),
  reason text NOT NULL CHECK (reason IN ('eligible', 'small_raid', 'day_cap')),
  PRIMARY KEY (origin, person_id, raid_id),
  UNIQUE (origin, person_id, utc_day, reward_slot),
  FOREIGN KEY (origin, raid_id) REFERENCES realm_raid_observations (origin, raid_id),
  CHECK (utc_day = awarded_ms / 86400000),
  CHECK ((reason = 'eligible') = (reward_slot IS NOT NULL))
);
CREATE TABLE realm_raid_guest_stamps (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  raid_id text NOT NULL,
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  kind text NOT NULL CHECK (kind IN ('visit', 'raid')),
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 9007199254740991),
  entry_id uuid,
  message_id text,
  record text NOT NULL CHECK (octet_length(record) <= 4096),
  PRIMARY KEY (origin, person_id, raid_id, kind),
  UNIQUE (origin, person_id, sequence),
  FOREIGN KEY (origin, person_id, raid_id) REFERENCES realm_raid_guest_rewards (origin, person_id, raid_id),
  FOREIGN KEY (origin, entry_id) REFERENCES realm_raid_guest_arrivals (origin, entry_id),
  FOREIGN KEY (origin, kingdom_id, message_id) REFERENCES realm_raid_guest_chat (origin, kingdom_id, message_id),
  CHECK ((kind = 'visit' AND entry_id IS NOT NULL AND message_id IS NULL)
    OR (kind = 'raid' AND entry_id IS NULL AND message_id IS NOT NULL)),
  CHECK (record::jsonb ->> 'kind' = kind AND record::jsonb ->> 'kingdomId' = kingdom_id
    AND (record::jsonb ->> 'occurredAt')::bigint = at_ms),
  CHECK ((kind = 'raid' AND record::jsonb ->> 'raidId' = raid_id AND record::jsonb -> 'arrivedWith' = 'null'::jsonb)
    OR (kind = 'visit' AND record::jsonb -> 'raidId' = 'null'::jsonb AND record::jsonb #>> '{arrivedWith,raidId}' = raid_id))
);

-- Insert guards make auth/session/observation linkage durable. Room admission itself is a process-local callback;
-- the browser and Herald have no route that can call that callback or write these tables.
CREATE FUNCTION realm_raid_guest_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE raid realm_raid_observations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'realm_raid_guest_departures' THEN
    IF NOT EXISTS (SELECT 1 FROM realm_entries e WHERE e.entry_id = NEW.entry_id AND e.origin = NEW.origin
      AND e.person_id = NEW.person_id AND e.kingdom_id = NEW.kingdom_id
      AND floor(extract(epoch FROM e.opened_at) * 1000)::bigint <= NEW.departed_ms)
      THEN RAISE EXCEPTION 'A guest departure needs its real entry'; END IF;
    IF EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = NEW.origin AND a.entry_id = NEW.entry_id
      AND a.arrived_ms > NEW.departed_ms) THEN RAISE EXCEPTION 'Departure cannot precede arrival'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO raid FROM realm_raid_observations WHERE origin = NEW.origin AND raid_id = NEW.raid_id;
  IF NOT FOUND OR raid.direction <> 'incoming' OR raid.to_kingdom_id <> NEW.kingdom_id
    THEN RAISE EXCEPTION 'A guest needs a witnessed incoming raid'; END IF;
  IF TG_TABLE_NAME = 'realm_raid_guest_intents' THEN
    IF NEW.begun_ms < raid.occurred_ms OR NEW.begun_ms >= raid.occurred_ms + 600000
      OR NOT EXISTS (SELECT 1 FROM realm_sessions s JOIN realm_persons p ON p.person_id = s.person_id
        WHERE s.session_id = NEW.session_id AND s.person_id = NEW.person_id AND s.origin = NEW.origin
          AND p.origin = NEW.origin AND s.revoked_at IS NULL
          AND s.expires_at > greatest(now(), to_timestamp(NEW.begun_ms::double precision / 1000)))
      OR EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = NEW.origin AND d.person_id = NEW.person_id
        AND d.kingdom_id = NEW.kingdom_id AND d.status <> 'void')
      THEN RAISE EXCEPTION 'A guest invitation needs a live noncitizen session in the raid window'; END IF;
  ELSIF TG_TABLE_NAME = 'realm_raid_guest_arrivals' THEN
    IF NEW.arrived_ms < raid.occurred_ms OR NEW.arrived_ms >= raid.occurred_ms + 600000
      OR NOT EXISTS (SELECT 1 FROM realm_entries e JOIN realm_raid_guest_intents i ON i.sequence = NEW.intent_sequence
        JOIN realm_sessions s ON s.session_id = e.session_id
        WHERE e.entry_id = NEW.entry_id AND e.session_id = NEW.session_id AND e.person_id = NEW.person_id
          AND e.kingdom_id = NEW.kingdom_id AND e.origin = NEW.origin
          AND i.origin = NEW.origin AND i.session_id = NEW.session_id AND i.person_id = NEW.person_id
          AND i.kingdom_id = NEW.kingdom_id AND i.raid_id = NEW.raid_id
          AND i.begun_ms <= floor(extract(epoch FROM e.opened_at) * 1000)::bigint
          AND floor(extract(epoch FROM e.opened_at) * 1000)::bigint <= NEW.arrived_ms
          AND NEW.arrived_ms >= i.begun_ms AND s.person_id = NEW.person_id AND s.origin = NEW.origin
          AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp(NEW.arrived_ms::double precision / 1000)))
      OR EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = NEW.origin AND d.person_id = NEW.person_id
        AND d.kingdom_id = NEW.kingdom_id AND d.status <> 'void')
      THEN RAISE EXCEPTION 'A guest arrival needs its session-bound entry and invitation'; END IF;
    IF EXISTS (SELECT 1 FROM realm_raid_guest_departures d WHERE d.origin = NEW.origin AND d.entry_id = NEW.entry_id
      AND d.departed_ms < NEW.arrived_ms) THEN RAISE EXCEPTION 'Arrival cannot follow departure'; END IF;
  ELSIF TG_TABLE_NAME = 'realm_raid_guest_chat' THEN
    IF NEW.at_ms < raid.occurred_ms OR NEW.at_ms >= raid.occurred_ms + 600000
      OR NOT EXISTS (SELECT 1 FROM realm_persons p WHERE p.person_id = NEW.person_id AND p.origin = NEW.origin
        AND floor(extract(epoch FROM p.created_at) * 1000)::bigint <= NEW.at_ms)
      THEN RAISE EXCEPTION 'Raid chat needs a signed-in identity in the original raid window'; END IF;
    IF NEW.basis = 'source_citizen' AND NOT EXISTS (SELECT 1 FROM realm_deeds d WHERE d.origin = NEW.origin
      AND d.person_id = NEW.person_id AND d.kingdom_id = raid.from_kingdom_id AND d.status <> 'void' AND d.allocated_ms <= NEW.at_ms)
      THEN RAISE EXCEPTION 'Source chat needs source citizenship'; END IF;
    IF NEW.basis = 'guest' AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = NEW.origin
      AND a.entry_id = NEW.entry_id AND a.person_id = NEW.person_id AND a.raid_id = NEW.raid_id AND a.arrived_ms <= NEW.at_ms)
      THEN RAISE EXCEPTION 'Guest chat needs that raid committed arrival'; END IF;
  ELSIF TG_TABLE_NAME = 'realm_raid_guest_stamps' THEN
    IF NEW.kind = 'visit' AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = NEW.origin
      AND a.entry_id = NEW.entry_id AND a.person_id = NEW.person_id AND a.raid_id = NEW.raid_id AND a.arrived_ms = NEW.at_ms)
      THEN RAISE EXCEPTION 'Visit stamps need actual arrival'; END IF;
    IF NEW.kind = 'raid' AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_chat c WHERE c.origin = NEW.origin
      AND c.kingdom_id = NEW.kingdom_id AND c.message_id = NEW.message_id AND c.person_id = NEW.person_id
      AND c.raid_id = NEW.raid_id AND c.at_ms = NEW.at_ms AND c.basis = 'source_citizen')
      THEN RAISE EXCEPTION 'A guest chat cannot become an outbound ride'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_raid_guest_intents_evidence BEFORE INSERT ON realm_raid_guest_intents FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_evidence_guard();
CREATE TRIGGER realm_raid_guest_arrivals_evidence BEFORE INSERT ON realm_raid_guest_arrivals FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_evidence_guard();
CREATE TRIGGER realm_raid_guest_departures_evidence BEFORE INSERT ON realm_raid_guest_departures FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_evidence_guard();
CREATE TRIGGER realm_raid_guest_chat_evidence BEFORE INSERT ON realm_raid_guest_chat FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_evidence_guard();
CREATE TRIGGER realm_raid_guest_stamps_evidence BEFORE INSERT ON realm_raid_guest_stamps FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_evidence_guard();
CREATE FUNCTION realm_raid_guest_visit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ((NEW.origin, NEW.person_id, NEW.kingdom_id, NEW.raid_id, NEW.proof_message_id)
    IS DISTINCT FROM (OLD.origin, OLD.person_id, OLD.kingdom_id, OLD.raid_id, OLD.proof_message_id)
    OR NEW.last_seen_ms < OLD.last_seen_ms) THEN RAISE EXCEPTION 'A chat visit cannot change its original proof or move backwards'; END IF;
  IF NOT EXISTS (SELECT 1 FROM realm_raid_guest_chat c WHERE c.origin = NEW.origin AND c.kingdom_id = NEW.kingdom_id
    AND c.message_id = NEW.proof_message_id AND c.person_id = NEW.person_id AND c.raid_id = NEW.raid_id AND c.at_ms <= NEW.last_seen_ms)
    THEN RAISE EXCEPTION 'A chat visit needs its original qualifying chat'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_raid_guest_chat_visits_proof BEFORE INSERT OR UPDATE ON realm_raid_guest_chat_visits FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_visit_guard();
CREATE FUNCTION realm_raid_guest_reward_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE viewers bigint;
BEGIN
  SELECT (o.observation::jsonb ->> 'viewers')::bigint INTO viewers FROM realm_raid_observations o
    WHERE o.origin = NEW.origin AND o.raid_id = NEW.raid_id AND o.direction = 'incoming';
  IF NOT FOUND OR (viewers < 3) <> (NEW.reason = 'small_raid') THEN RAISE EXCEPTION 'Reward eligibility needs the witnessed raid size'; END IF;
  IF NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = NEW.origin AND a.person_id = NEW.person_id
      AND a.raid_id = NEW.raid_id AND a.arrived_ms = NEW.awarded_ms)
    AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_chat c WHERE c.origin = NEW.origin AND c.person_id = NEW.person_id
      AND c.raid_id = NEW.raid_id AND c.at_ms = NEW.awarded_ms AND c.basis = 'source_citizen')
    THEN RAISE EXCEPTION 'A reward decision needs qualifying guest evidence'; END IF;
  IF NEW.reason = 'day_cap' AND (SELECT count(*) FROM realm_raid_guest_rewards r WHERE r.origin = NEW.origin
    AND r.person_id = NEW.person_id AND r.utc_day = NEW.utc_day AND r.reward_slot IS NOT NULL) < 2
    THEN RAISE EXCEPTION 'A daily reward cap needs two occupied slots'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_raid_guest_rewards_evidence BEFORE INSERT ON realm_raid_guest_rewards FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_reward_guard();
CREATE FUNCTION realm_raid_guest_presence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ((NEW.origin, NEW.entry_id) IS DISTINCT FROM (OLD.origin, OLD.entry_id)
    OR NEW.last_seen_ms < OLD.last_seen_ms) THEN RAISE EXCEPTION 'A guest presence lease cannot change identity or move backwards'; END IF;
  IF NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = NEW.origin AND a.entry_id = NEW.entry_id
    AND a.arrived_ms <= NEW.last_seen_ms) THEN RAISE EXCEPTION 'A guest presence lease needs committed arrival'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_raid_guest_presence_proof BEFORE INSERT OR UPDATE ON realm_raid_guest_presence FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_presence_guard();

-- The runtime filter is a courtesy, not allocation authority: a raid begin can race a separate settlement
-- transaction. Serialize NEW home allocation on the SAME person head as guest evidence. A concurrent serializable
-- transaction retries its whole decision; a known guest refusal rolls back reservation/holder/deed together.
-- Existing nonvoid homes keep all their rights and normal install/update paths, regardless of later visits.
CREATE FUNCTION realm_raid_guest_deed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'void' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'void' THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO realm_raid_guest_heads (origin, person_id) VALUES (NEW.origin, NEW.person_id)
    ON CONFLICT (origin, person_id) DO NOTHING;
  UPDATE realm_raid_guest_heads SET lock_revision = lock_revision + 1
    WHERE origin = NEW.origin AND person_id = NEW.person_id;
  IF EXISTS (
    SELECT 1 FROM realm_raid_guest_intents i
      JOIN realm_sessions s ON s.session_id = i.session_id AND s.person_id = i.person_id AND s.origin = i.origin
      JOIN realm_raid_observations o ON o.origin = i.origin AND o.raid_id = i.raid_id
    WHERE i.origin = NEW.origin AND i.person_id = NEW.person_id AND i.kingdom_id = NEW.kingdom_id
      AND i.begun_ms <= NEW.allocated_ms AND o.occurred_ms <= NEW.allocated_ms AND o.occurred_ms + 600000 > NEW.allocated_ms
      AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp(NEW.allocated_ms::double precision / 1000))
      AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_arrivals a WHERE a.origin = i.origin AND a.intent_sequence = i.sequence)
  ) OR EXISTS (
    SELECT 1 FROM realm_raid_guest_arrivals a
      JOIN realm_entries e ON e.entry_id = a.entry_id AND e.session_id = a.session_id AND e.person_id = a.person_id
        AND e.kingdom_id = a.kingdom_id AND e.origin = a.origin
      JOIN realm_sessions s ON s.session_id = a.session_id AND s.person_id = a.person_id AND s.origin = a.origin
      JOIN realm_raid_guest_presence gp ON gp.origin = a.origin AND gp.entry_id = a.entry_id
    WHERE a.origin = NEW.origin AND a.person_id = NEW.person_id AND a.kingdom_id = NEW.kingdom_id
      AND a.arrived_ms <= NEW.allocated_ms AND gp.last_seen_ms + 90000 > NEW.allocated_ms
      AND s.revoked_at IS NULL AND s.expires_at > greatest(now(), to_timestamp(NEW.allocated_ms::double precision / 1000))
      AND NOT EXISTS (SELECT 1 FROM realm_raid_guest_departures d WHERE d.origin = a.origin AND d.entry_id = a.entry_id)
  ) OR EXISTS (
    SELECT 1 FROM realm_raid_guest_chat_visits v
      JOIN realm_raid_guest_chat c ON c.origin = v.origin AND c.kingdom_id = v.kingdom_id AND c.message_id = v.proof_message_id
    WHERE v.origin = NEW.origin AND v.person_id = NEW.person_id AND v.kingdom_id = NEW.kingdom_id
      -- Chat's original provider clock may lead normalized presence by at most five seconds. The authority has
      -- already verified this bound and the exact raid window; withholding allocation grants no stamp or power.
      AND c.at_ms <= NEW.allocated_ms + 5000 AND v.last_seen_ms + 90000 > NEW.allocated_ms
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'RG001', MESSAGE = 'A raid visit does not create a home';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realm_deeds_raid_guest_guard BEFORE INSERT OR UPDATE ON realm_deeds
  FOR EACH ROW EXECUTE FUNCTION realm_raid_guest_deed_guard();
CREATE TRIGGER realm_raid_guest_intents_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_intents FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
CREATE TRIGGER realm_raid_guest_arrivals_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_arrivals FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
CREATE TRIGGER realm_raid_guest_departures_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_departures FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
CREATE TRIGGER realm_raid_guest_chat_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_chat FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
CREATE TRIGGER realm_raid_guest_rewards_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_rewards FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
CREATE TRIGGER realm_raid_guest_stamps_immutable BEFORE UPDATE OR DELETE ON realm_raid_guest_stamps FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();
