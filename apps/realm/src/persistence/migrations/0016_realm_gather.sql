-- Private authoritative checkpoints and immutable accepted moves, including RNG state and absolute clocks.
-- Public table views and any eventual result delivery are separate projections of this private history.
CREATE TABLE gather_table_checkpoints (
  kingdom_id text NOT NULL CHECK (octet_length(kingdom_id) BETWEEN 1 AND 128),
  table_id text NOT NULL CHECK (octet_length(table_id) BETWEEN 1 AND 128),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  snapshot text NOT NULL CHECK (octet_length(snapshot) <= 65536),
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (kingdom_id, table_id)
);

CREATE TABLE gather_table_moves (
  kingdom_id text NOT NULL,
  actor_key text NOT NULL,
  command_id text NOT NULL CHECK (octet_length(command_id) BETWEEN 1 AND 128),
  actor_id text,
  table_id text NOT NULL,
  expected_version bigint CHECK (expected_version BETWEEN 1 AND 9007199254740990),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  payload text NOT NULL CHECK (octet_length(payload) <= 65536),
  snapshot text NOT NULL CHECK (octet_length(snapshot) <= 65536),
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (kingdom_id, actor_key, command_id),
  UNIQUE (kingdom_id, table_id, version),
  FOREIGN KEY (kingdom_id, table_id) REFERENCES gather_table_checkpoints (kingdom_id, table_id),
  CHECK (version = COALESCE(expected_version, 0) + 1),
  CHECK ((actor_id IS NULL AND actor_key = 'system') OR (actor_id IS NOT NULL AND actor_key = 'user:' || actor_id))
);

CREATE FUNCTION gather_refuse_move_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Accepted gather moves are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER gather_table_moves_immutable BEFORE UPDATE OR DELETE ON gather_table_moves
  FOR EACH ROW EXECUTE FUNCTION gather_refuse_move_rewrite();
