-- "Hide my travels": the holder's own choice over the passport the Raid Gate's stamps fill. One row per person and
-- origin; no row means travels are shown. `changed_ms` only moves forward, so a card that folds it into its person
-- revision can always tell a newer choice from an older one. The stamps themselves stay in their own immutable
-- history (0011d); hiding never deletes a record, it only keeps every public projection of them closed.
CREATE TABLE realm_raid_passport_privacy (
  origin     text NOT NULL CHECK (origin IN ('live', 'simulated')),
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  hidden     boolean NOT NULL,
  revision   bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  changed_ms bigint NOT NULL CHECK (changed_ms >= 0 AND changed_ms <= 9007199254740991),
  PRIMARY KEY (origin, person_id)
);
