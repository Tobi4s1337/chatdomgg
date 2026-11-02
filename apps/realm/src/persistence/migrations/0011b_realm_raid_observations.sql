-- Witnessed raids are history, not an expiring spectacle queue. The feed is append-only; only its delivery
-- bookkeeping changes. A locked head allocates commit-ordered cursors, so concurrent commits cannot skip a road.
CREATE TABLE realm_raid_feed_heads (
  origin text PRIMARY KEY CHECK (origin IN ('live', 'simulated')),
  sequence bigint NOT NULL CHECK (sequence >= 0 AND sequence <= 9007199254740991)
);
INSERT INTO realm_raid_feed_heads (origin, sequence) VALUES ('live', 0), ('simulated', 0);

CREATE TABLE realm_raid_observations (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  sequence bigint NOT NULL CHECK (sequence > 0 AND sequence <= 9007199254740991),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
  raid_id text NOT NULL CHECK (raid_id ~ '^raid\.[a-f0-9]{64}$'),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  from_kingdom_id text NOT NULL CHECK (from_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  to_kingdom_id text NOT NULL CHECK (to_kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  occurred_ms bigint NOT NULL CHECK (occurred_ms >= 0 AND occurred_ms <= 9007199254740991),
  received_ms bigint NOT NULL CHECK (received_ms >= 0 AND received_ms + 5000 >= occurred_ms AND received_ms <= 9007199254740991),
  action_request_id text CHECK (action_request_id IS NULL OR length(action_request_id) BETWEEN 1 AND 128),
  observation text NOT NULL CHECK (octet_length(observation) <= 8192),
  raid text NOT NULL CHECK (octet_length(raid) <= 4096),
  PRIMARY KEY (origin, event_id),
  UNIQUE (origin, sequence),
  UNIQUE (origin, raid_id),
  CHECK (from_kingdom_id <> to_kingdom_id),
  CHECK (kingdom_id = CASE direction WHEN 'incoming' THEN to_kingdom_id ELSE from_kingdom_id END),
  CHECK (observation::jsonb ->> 'id' = event_id),
  CHECK (observation::jsonb ->> 'origin' = origin),
  CHECK (observation::jsonb ->> 'kingdomId' = kingdom_id),
  CHECK (observation::jsonb ->> 'direction' = direction),
  CHECK (observation::jsonb #>> '{from,kingdomId}' = from_kingdom_id),
  CHECK (observation::jsonb #>> '{to,kingdomId}' = to_kingdom_id),
  CHECK ((observation::jsonb ->> 'occurredAt')::bigint = occurred_ms),
  CHECK ((observation::jsonb ->> 'receivedAt')::bigint = received_ms),
  CHECK (raid::jsonb ->> 'id' = raid_id),
  CHECK (raid::jsonb ->> 'fromKingdomId' = from_kingdom_id),
  CHECK (raid::jsonb ->> 'toKingdomId' = to_kingdom_id),
  CHECK ((raid::jsonb ->> 'observedAt')::bigint = received_ms),
  CHECK ((raid::jsonb ->> 'occurredAt')::bigint = occurred_ms)
);
CREATE INDEX realm_raid_observations_pennants ON realm_raid_observations (origin, to_kingdom_id, sequence DESC) WHERE direction = 'incoming';
CREATE TRIGGER realm_raid_observations_immutable BEFORE UPDATE OR DELETE ON realm_raid_observations
  FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();

CREATE TABLE realm_raid_observation_effects (
  origin text NOT NULL,
  event_id text NOT NULL,
  beat_state text NOT NULL CHECK (beat_state IN ('pending', 'complete', 'expired', 'none')),
  retry_at bigint NOT NULL DEFAULT 0 CHECK (retry_at >= 0 AND retry_at <= 9007199254740991),
  PRIMARY KEY (origin, event_id),
  FOREIGN KEY (origin, event_id) REFERENCES realm_raid_observations (origin, event_id)
);
CREATE INDEX realm_raid_observation_effects_pending ON realm_raid_observation_effects (origin, retry_at, event_id) WHERE beat_state = 'pending';
