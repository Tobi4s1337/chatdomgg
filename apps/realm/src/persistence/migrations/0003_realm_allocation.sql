-- Founded layouts and citizen deeds (spec 34 R6). Additive only.
-- A layout revision, its plots and a deed's placement are immutable rows: streets stay put and nobody moves.
-- Global lock order: deed holder (person) row, then the kingdom's layout head, then deed rows. The kingdom writer
-- locks its realm_kingdoms row and then a deed row; it never takes a holder or head lock.

CREATE FUNCTION realm_refuse_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable; adopt a new revision instead', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- One row per kingdom with an adopted layout. The current revision moves only to an extension of itself.
CREATE TABLE realm_layout_heads (
  kingdom_id  text PRIMARY KEY CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  origin      text NOT NULL CHECK (origin IN ('live', 'simulated')),
  revision    text NOT NULL,
  -- The founding identity every later extension must share (seed and first tenure year).
  seed        text NOT NULL,
  first_year  integer NOT NULL,
  adopted_ms  bigint NOT NULL,
  founded_ms  bigint NOT NULL
);

-- Every adopted revision, whole, as canonical JSON with its digest.
CREATE TABLE realm_layouts (
  kingdom_id      text NOT NULL REFERENCES realm_layout_heads (kingdom_id),
  revision        text NOT NULL CHECK (length(revision) BETWEEN 1 AND 128),
  parent_revision text,
  plan            text NOT NULL,
  digest          text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  adopted_ms      bigint NOT NULL,
  PRIMARY KEY (kingdom_id, revision),
  FOREIGN KEY (kingdom_id, parent_revision) REFERENCES realm_layouts (kingdom_id, revision)
);
ALTER TABLE realm_layout_heads ADD FOREIGN KEY (kingdom_id, revision) REFERENCES realm_layouts (kingdom_id, revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER realm_layouts_immutable BEFORE UPDATE OR DELETE ON realm_layouts FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();

-- The home plots a revision opens for settling. `placement` is the plot's canonical transform and kind.
CREATE TABLE realm_layout_plots (
  kingdom_id   text NOT NULL,
  revision     text NOT NULL,
  plot_id      text NOT NULL CHECK (length(plot_id) BETWEEN 1 AND 128),
  slot         integer NOT NULL CHECK (slot >= 0),
  quarter_year integer NOT NULL,
  row_id       text NOT NULL,
  ordinal      integer NOT NULL CHECK (ordinal >= 0),
  placement    text NOT NULL,
  PRIMARY KEY (kingdom_id, revision, plot_id),
  UNIQUE (kingdom_id, revision, slot),
  FOREIGN KEY (kingdom_id, revision) REFERENCES realm_layouts (kingdom_id, revision)
);
CREATE TRIGGER realm_layout_plots_immutable BEFORE UPDATE OR DELETE ON realm_layout_plots FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();

-- The person lock row and the global citizen-deed count (pending deeds count). A monarch's castle is not a deed.
CREATE TABLE realm_deed_holders (
  person_id     text PRIMARY KEY CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  origin        text NOT NULL CHECK (origin IN ('live', 'simulated')),
  citizen_deeds integer NOT NULL DEFAULT 0 CHECK (citizen_deeds BETWEEN 0 AND 3),
  updated_ms    bigint NOT NULL
);

CREATE TABLE realm_deeds (
  deed_id         text PRIMARY KEY CHECK (deed_id ~ '^[a-f0-9]{32}$'),
  receipt         text NOT NULL UNIQUE CHECK (receipt ~ '^deed:[a-f0-9]{64}$'),
  person_id       text NOT NULL REFERENCES realm_deed_holders (person_id),
  kingdom_id      text NOT NULL,
  origin          text NOT NULL CHECK (origin IN ('live', 'simulated')),
  layout_revision text NOT NULL,
  plot_id         text NOT NULL,
  slot            integer NOT NULL,
  -- The original placement, copied from the plot row at allocation and never rewritten.
  placement       text NOT NULL,
  -- Why this plot: quarter/row chosen and which verified evidence chose them. `evidence` keeps the signed records.
  tenure          text NOT NULL,
  evidence        text NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending', 'installed', 'void')),
  -- The exact install command, fixed once so every retry and recovery sends identical bytes.
  install_command text,
  installed_seq   bigint,
  void_reason     text,
  allocated_ms    bigint NOT NULL,
  settled_ms      bigint,
  FOREIGN KEY (kingdom_id, layout_revision, plot_id) REFERENCES realm_layout_plots (kingdom_id, revision, plot_id),
  CHECK ((status = 'installed') = (installed_seq IS NOT NULL)),
  CHECK ((status = 'void') = (void_reason IS NOT NULL)),
  CHECK (status = 'pending' OR settled_ms IS NOT NULL)
);
CREATE UNIQUE INDEX realm_deeds_one_home_per_kingdom ON realm_deeds (kingdom_id, person_id) WHERE status <> 'void';
CREATE UNIQUE INDEX realm_deeds_one_owner_per_plot ON realm_deeds (kingdom_id, plot_id) WHERE status <> 'void';
CREATE INDEX realm_deeds_pending ON realm_deeds (kingdom_id, allocated_ms) WHERE status = 'pending';

CREATE FUNCTION realm_deed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'deeds are never deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF (NEW.deed_id, NEW.receipt, NEW.person_id, NEW.kingdom_id, NEW.origin, NEW.layout_revision, NEW.plot_id, NEW.slot, NEW.placement, NEW.tenure, NEW.evidence, NEW.allocated_ms)
     IS DISTINCT FROM (OLD.deed_id, OLD.receipt, OLD.person_id, OLD.kingdom_id, OLD.origin, OLD.layout_revision, OLD.plot_id, OLD.slot, OLD.placement, OLD.tenure, OLD.evidence, OLD.allocated_ms)
     OR (OLD.install_command IS NOT NULL AND NEW.install_command IS DISTINCT FROM OLD.install_command)
     OR (OLD.status <> 'pending' AND (NEW.status, NEW.installed_seq, NEW.void_reason, NEW.settled_ms) IS DISTINCT FROM (OLD.status, OLD.installed_seq, OLD.void_reason, OLD.settled_ms)) THEN
    RAISE EXCEPTION 'a deed''s placement is fixed once and a settled deed never changes' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_deeds_fixed BEFORE UPDATE OR DELETE ON realm_deeds FOR EACH ROW EXECUTE FUNCTION realm_deed_guard();

-- A person beyond three homes, or arriving at a full kingdom, keeps a guest light there and their history waits.
CREATE TABLE realm_guests (
  kingdom_id  text NOT NULL,
  person_id   text NOT NULL REFERENCES realm_deed_holders (person_id),
  reason      text NOT NULL CHECK (reason IN ('three-homes', 'kingdom-full')),
  since_ms    bigint NOT NULL,
  updated_ms  bigint NOT NULL,
  PRIMARY KEY (kingdom_id, person_id)
);
