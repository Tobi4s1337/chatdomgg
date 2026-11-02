-- Citizen looks (play PL11): a person's saved look, its immutable recipe and pieces granted on the server. Additive only.
-- Recipes are content-addressed: `token` is `lk.` + 40 hex of the SHA-256 of the canonical recipe, so a token's
-- recipe never changes. A recipe carries no person; the link is the one current-look row per person.

CREATE TABLE realm_look_recipes (
  token      text PRIMARY KEY CHECK (token ~ '^lk\.[a-f0-9]{40}$'),
  -- Canonical JSON (sorted keys), exactly the bytes the token was hashed from.
  recipe     text NOT NULL CHECK (length(recipe) BETWEEN 2 AND 8192),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Rewriting a recipe would change what a published token means. Removal stays possible for moderation.
CREATE TRIGGER realm_look_recipes_immutable BEFORE UPDATE ON realm_look_recipes FOR EACH ROW EXECUTE FUNCTION realm_refuse_rewrite();

CREATE TABLE realm_citizen_looks (
  person_id text PRIMARY KEY REFERENCES realm_persons (person_id),
  origin    text NOT NULL CHECK (origin IN ('live', 'simulated')),
  token     text NOT NULL REFERENCES realm_look_recipes (token),
  saved_ms  bigint NOT NULL CHECK (saved_ms >= 0)
);

-- Pieces granted server-side (the Forge's worn twin). A forger may never have signed in, so this names the Twitch
-- user ID without requiring a person row; the grant waits for them. First grant wins per person and piece.
CREATE TABLE realm_wardrobe_grants (
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  piece_id   text NOT NULL CHECK (length(piece_id) BETWEEN 1 AND 128),
  origin     text NOT NULL CHECK (origin IN ('live', 'simulated')),
  slot       text NOT NULL CHECK (slot IN ('hat', 'held', 'back', 'neck', 'badge')),
  source     text NOT NULL CHECK (source = 'forge'),
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  recipe     text NOT NULL CHECK (length(recipe) BETWEEN 1 AND 65536),
  granted_ms bigint NOT NULL CHECK (granted_ms >= 0),
  PRIMARY KEY (person_id, piece_id)
);
CREATE INDEX realm_wardrobe_grants_newest ON realm_wardrobe_grants (person_id, granted_ms DESC);
