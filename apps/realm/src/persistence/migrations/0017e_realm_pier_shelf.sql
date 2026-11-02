-- The keepsake shelf at home and the belt's order (pier PI12).
-- Arranging into a taken slot swaps the two things inside one transaction. A unique index is checked row by row, so the
-- slot rule becomes a deferrable exclusion constraint with the same columns and predicate; it stays immediate unless a
-- swap defers it to the commit, where it is still enforced.
ALTER TABLE realm_items ADD CONSTRAINT realm_items_slot_places EXCLUDE USING btree (
  kingdom_id WITH =, (record->>'ownerId') WITH =, (record->>'origin') WITH =, (record->>'place') WITH =,
  ((record->>'slot')::integer) WITH =
) WHERE (record->>'place' IN ('hotbar', 'shelf')) DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX realm_items_slots;

-- Whether a person shows their shelf to visitors at their door, per kingdom and origin. Off until they choose.
CREATE TABLE realm_item_shelves (
  kingdom_id text NOT NULL,
  owner_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  shown boolean NOT NULL,
  -- The owner's approved public name when they last chose; null when they keep it to themselves.
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 128),
  revision integer NOT NULL CHECK (revision > 0),
  updated_ms bigint NOT NULL CHECK (updated_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (kingdom_id, owner_id, origin),
  CHECK (shown OR name IS NULL)
);
CREATE INDEX realm_item_shelves_shown ON realm_item_shelves (kingdom_id, origin, owner_id) WHERE shown;
