-- One coalesced obligation per observed channel; no HTTP is performed in its transactions.
CREATE TABLE realm_panel_settings_mirror (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL,
  extension_id text,
  binding_id uuid,
  claim_id uuid,
  lease_until_ms bigint NOT NULL DEFAULT 0,
  not_before_ms bigint NOT NULL DEFAULT 0,
  next_attempt_ms bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  verified_content text,
  verified_ms bigint,
  PRIMARY KEY (origin, kingdom_id),
  CHECK ((verified_content IS NULL) = (verified_ms IS NULL)),
  CHECK (verified_content IS NULL OR octet_length(verified_content) <= 3072)
);
CREATE INDEX realm_panel_settings_mirror_due ON realm_panel_settings_mirror
  (origin, next_attempt_ms, kingdom_id);
CREATE INDEX realm_panel_settings_mirror_claims ON realm_panel_settings_mirror
  (origin, binding_id, lease_until_ms) WHERE claim_id IS NOT NULL;
-- Existing saved preferences must recover without a browser opening them again.
INSERT INTO realm_panel_settings_mirror (origin, kingdom_id)
  SELECT origin, kingdom_id FROM realm_panel_settings;

-- This composition serves one Extension per origin. A shared HTTP quota includes reads and writes.
CREATE TABLE realm_panel_settings_mirror_quota (
  origin text PRIMARY KEY CHECK (origin IN ('live', 'simulated')),
  extension_id text,
  binding_id uuid,
  next_http_ms bigint NOT NULL DEFAULT 0
);
INSERT INTO realm_panel_settings_mirror_quota (origin) VALUES ('live'), ('simulated');
