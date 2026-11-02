-- The fifth FK column makes the catch reference the exact item in its grant receipt.
CREATE UNIQUE INDEX realm_item_grants_catch_link
  ON realm_item_grants (kingdom_id, owner_id, origin, key, item_id);

CREATE TABLE realm_fishing_catches (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms(kingdom_id),
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  id text NOT NULL CHECK (id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  owner_id text NOT NULL,
  species_id text NOT NULL CHECK (species_id ~ '^fish:[a-z][a-z0-9-]{0,63}$'),
  item_id text NOT NULL REFERENCES realm_items(id),
  grant_key text NOT NULL CHECK (grant_key = 'fishing:catch:1:' || id),
  caught_ms bigint NOT NULL CHECK (caught_ms BETWEEN 0 AND 9007199254740991),
  personal_first boolean NOT NULL,
  kingdom_first boolean NOT NULL,
  record jsonb NOT NULL,
  CHECK (NOT kingdom_first OR personal_first),
  PRIMARY KEY (kingdom_id, origin, id),
  FOREIGN KEY (kingdom_id, owner_id, origin, grant_key, item_id)
    REFERENCES realm_item_grants (kingdom_id, owner_id, origin, key, item_id),
  CHECK (octet_length(record::text) <= 32768),
  CHECK ((jsonb_typeof(record) = 'object' AND record ?& ARRAY[
      'version','id','kingdomId','origin','ownerId','speciesId','itemId','grantKey','caughtAt',
      'personalFirst','kingdomFirst','rarity','fish','environment','float','anchor','collisionRevision','proof']
    AND record->'version' = '1'::jsonb
    AND jsonb_typeof(record->'id') = 'string' AND record->>'id' = id
    AND jsonb_typeof(record->'kingdomId') = 'string' AND record->>'kingdomId' = kingdom_id
    AND jsonb_typeof(record->'origin') = 'string' AND record->>'origin' = origin
    AND jsonb_typeof(record->'ownerId') = 'string' AND record->>'ownerId' = owner_id
    AND jsonb_typeof(record->'speciesId') = 'string' AND record->>'speciesId' = species_id
    AND jsonb_typeof(record->'itemId') = 'string' AND record->>'itemId' = item_id
    AND jsonb_typeof(record->'grantKey') = 'string' AND record->>'grantKey' = grant_key
    AND jsonb_typeof(record->'caughtAt') = 'number' AND record->>'caughtAt' = caught_ms::text
    AND record->'personalFirst' = to_jsonb(personal_first)
    AND record->'kingdomFirst' = to_jsonb(kingdom_first)
    AND record->>'rarity' IN ('common','uncommon','rare')
    AND jsonb_typeof(record->'fish') = 'object' AND record->'fish'->>'speciesId' = species_id
    AND jsonb_typeof(record->'environment') = 'object'
    AND jsonb_typeof(record->'float') = 'array' AND jsonb_array_length(record->'float') = 3
    AND jsonb_typeof(record->'anchor') = 'array' AND jsonb_array_length(record->'anchor') = 3
    AND jsonb_typeof(record->'collisionRevision') = 'number'
    AND (record->>'collisionRevision')::numeric BETWEEN 0 AND 9007199254740991
    AND (record->>'collisionRevision')::numeric = trunc((record->>'collisionRevision')::numeric)
    AND jsonb_typeof(record->'proof') = 'object'
    AND record->'proof' ?& ARRAY['version','castSeed','fightSeed','inputs','result']
    AND record->'proof'->'version' = '1'::jsonb
    AND jsonb_typeof(record->'proof'->'castSeed') = 'number'
    AND (record->'proof'->>'castSeed')::numeric BETWEEN 0 AND 4294967295
    AND (record->'proof'->>'castSeed')::numeric = trunc((record->'proof'->>'castSeed')::numeric)
    AND jsonb_typeof(record->'proof'->'fightSeed') = 'number'
    AND (record->'proof'->>'fightSeed')::numeric BETWEEN 0 AND 4294967295
    AND (record->'proof'->>'fightSeed')::numeric = trunc((record->'proof'->>'fightSeed')::numeric)
    AND jsonb_typeof(record->'proof'->'inputs') = 'array'
    AND jsonb_array_length(record->'proof'->'inputs') BETWEEN 1 AND 600
    AND jsonb_typeof(record->'proof'->'result') = 'object'
    AND record->'proof'->'result'->'version' = '1'::jsonb
    AND record->'proof'->'result'->>'outcome' = 'landed'
    AND record->'proof'->'result'->'progress' = '10000'::jsonb
    AND record->'proof'->'result'->'seed' = record->'proof'->'fightSeed'
    AND record->'proof'->'result'->'profile' = record->'fish'->'fight'
    AND jsonb_typeof(record->'proof'->'result'->'tick') = 'number'
    AND (record->'proof'->'result'->>'tick')::numeric BETWEEN 1 AND 599
    AND (record->'proof'->'result'->>'tick')::numeric = trunc((record->'proof'->'result'->>'tick')::numeric)) IS TRUE)
);

-- Firsts are witnessed facts of one species and origin, never a simulated/live shared counter.
CREATE UNIQUE INDEX realm_fishing_personal_first
  ON realm_fishing_catches (kingdom_id, origin, owner_id, species_id) WHERE personal_first;
CREATE UNIQUE INDEX realm_fishing_kingdom_first
  ON realm_fishing_catches (kingdom_id, origin, species_id) WHERE kingdom_first;
CREATE INDEX realm_fishing_owner_species
  ON realm_fishing_catches (kingdom_id, origin, owner_id, species_id);
CREATE INDEX realm_fishing_kingdom_species
  ON realm_fishing_catches (kingdom_id, origin, species_id);

CREATE FUNCTION realm_fishing_catch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'fishing catches are append-only'; END IF;
  SELECT record INTO item FROM realm_items WHERE id = NEW.item_id AND kingdom_id = NEW.kingdom_id;
  IF item IS NULL OR item->>'ownerId' IS DISTINCT FROM NEW.owner_id
     OR item->>'origin' IS DISTINCT FROM NEW.origin OR item->>'defId' IS DISTINCT FROM NEW.species_id
     OR item->>'branch' IS DISTINCT FROM 'gathered' OR item->'number' IS DISTINCT FROM 'null'::jsonb
     OR item->'storied' IS DISTINCT FROM to_jsonb(NEW.personal_first OR NEW.record->>'rarity' = 'rare')
  THEN RAISE EXCEPTION 'a fishing catch must reference its granted fish'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_fishing_catch_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON realm_fishing_catches
  FOR EACH ROW EXECUTE FUNCTION realm_fishing_catch_guard();
