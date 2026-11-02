-- Item records are retained even after a gathered stack is spent.
CREATE TABLE realm_items (
  id text PRIMARY KEY,
  kingdom_id text NOT NULL,
  record jsonb NOT NULL,
  CHECK ((jsonb_typeof(record) = 'object' AND record ?& ARRAY['version','id','defId','branch','ownerId','kingdomId','origin','place','slot','count','storied','number','story','source','detail','createdAt','revision']
    AND jsonb_typeof(record->'version') = 'number' AND record->>'version' = '1'
    AND jsonb_typeof(record->'id') = 'string' AND record->>'id' = id
    AND jsonb_typeof(record->'kingdomId') = 'string' AND record->>'kingdomId' = kingdom_id
    AND jsonb_typeof(record->'defId') = 'string' AND jsonb_typeof(record->'ownerId') = 'string'
    AND record->>'branch' IN ('worn','held','placed','kept','gathered','used-up')
    AND record->>'origin' IN ('live','simulated') AND record->>'place' IN ('worn','hand','hotbar','lot','shelf','bag','away','spent')
    AND jsonb_typeof(record->'count') = 'number' AND jsonb_typeof(record->'revision') = 'number'
    AND jsonb_typeof(record->'storied') = 'boolean' AND jsonb_typeof(record->'createdAt') = 'number'
    AND jsonb_typeof(record->'story') = 'object' AND record->'story' ?& ARRAY['by','kingdomId','where','at','line']
    AND record->'story'->>'kingdomId' = kingdom_id AND jsonb_typeof(record->'source') = 'object'
    AND record->'source' ?& ARRAY['kind','ref'] AND jsonb_typeof(record->'detail') = 'object'
    AND jsonb_typeof(record->'number') IN ('number','null')) IS TRUE),
  CHECK ((record->>'revision')::integer >= 0),
  CHECK ((record->>'count')::integer > 0 OR
    ((record->>'count')::integer = 0 AND record->>'storied' = 'false' AND record->>'branch' = 'gathered' AND record->>'place' = 'spent')),
  CHECK (record->>'storied' <> 'true' OR ((record->>'count')::integer = 1 AND record->>'place' <> 'spent')),
  CHECK ((record->>'place' IN ('hotbar', 'shelf') AND jsonb_typeof(record->'slot') = 'number' AND (record->>'slot')::integer BETWEEN 0 AND 63)
    OR (record->>'place' NOT IN ('hotbar', 'shelf') AND record->'slot' = 'null'::jsonb))
);
CREATE INDEX realm_items_owner ON realm_items (kingdom_id, (record->>'ownerId'));
CREATE UNIQUE INDEX realm_items_slots ON realm_items (kingdom_id, (record->>'ownerId'), (record->>'origin'), (record->>'place'), ((record->>'slot')::integer)) WHERE record->>'place' IN ('hotbar', 'shelf');
CREATE UNIQUE INDEX realm_items_hand ON realm_items (kingdom_id, (record->>'ownerId'), (record->>'origin')) WHERE record->>'place' = 'hand';
CREATE TABLE realm_item_events (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id text NOT NULL REFERENCES realm_items(id), event jsonb NOT NULL);
CREATE INDEX realm_item_events_item_sequence ON realm_item_events (item_id, sequence);
CREATE TABLE realm_item_grants (kingdom_id text NOT NULL, owner_id text NOT NULL, origin text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, item_id text NOT NULL REFERENCES realm_items(id), PRIMARY KEY (kingdom_id, owner_id, origin, key));
CREATE TABLE realm_item_numbers (kingdom_id text NOT NULL, def_id text NOT NULL, number integer NOT NULL CHECK (number > 0), PRIMARY KEY (kingdom_id, def_id));
CREATE TABLE realm_item_shared_numbers (kingdom_id text NOT NULL, key text NOT NULL, def_id text NOT NULL, fingerprint text NOT NULL, number integer NOT NULL CHECK (number > 0), PRIMARY KEY (kingdom_id, key));
CREATE TABLE realm_item_hidden_names (person_id text PRIMARY KEY);

CREATE FUNCTION realm_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'item records cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.record->>'revision')::integer <> 0 THEN RAISE EXCEPTION 'new item revision must be zero'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.kingdom_id <> OLD.kingdom_id OR
     NEW.record->'version' IS DISTINCT FROM OLD.record->'version' OR
     NEW.record->'id' IS DISTINCT FROM OLD.record->'id' OR
     NEW.record->'defId' IS DISTINCT FROM OLD.record->'defId' OR
     NEW.record->'branch' IS DISTINCT FROM OLD.record->'branch' OR
     NEW.record->'origin' IS DISTINCT FROM OLD.record->'origin' OR
     NEW.record->'kingdomId' IS DISTINCT FROM OLD.record->'kingdomId' OR
     NEW.record->'story' IS DISTINCT FROM OLD.record->'story' OR
     NEW.record->'source' IS DISTINCT FROM OLD.record->'source' OR
     NEW.record->'createdAt' IS DISTINCT FROM OLD.record->'createdAt' OR
     NEW.record->'number' IS DISTINCT FROM OLD.record->'number' OR
     NEW.record->'storied' IS DISTINCT FROM OLD.record->'storied' OR
     (OLD.record->>'count' = '0' AND NEW.record->'count' IS DISTINCT FROM OLD.record->'count') OR
     (OLD.record->>'storied' = 'true' AND (NEW.record->>'count')::integer < (OLD.record->>'count')::integer) OR
     (NEW.record->>'revision')::integer <> (OLD.record->>'revision')::integer + 1
  THEN RAISE EXCEPTION 'item identity, story, or revision is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_item_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON realm_items FOR EACH ROW EXECUTE FUNCTION realm_item_guard();
CREATE FUNCTION realm_item_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'item history and receipts are append-only'; END $$;
CREATE TRIGGER realm_item_events_immutable BEFORE UPDATE OR DELETE ON realm_item_events FOR EACH ROW EXECUTE FUNCTION realm_item_append_only();
CREATE TRIGGER realm_item_shared_numbers_immutable BEFORE UPDATE OR DELETE ON realm_item_shared_numbers FOR EACH ROW EXECUTE FUNCTION realm_item_append_only();
CREATE TRIGGER realm_item_grants_immutable BEFORE UPDATE OR DELETE ON realm_item_grants FOR EACH ROW EXECUTE FUNCTION realm_item_append_only();
