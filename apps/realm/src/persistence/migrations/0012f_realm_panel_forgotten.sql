-- A person who asked to be forgotten ("Forget me", "!chatdom forget"), across every kingdom of one origin. The row
-- holds only the account number, the origin and the time. Nothing more of them is noted in any kingdom, including one
-- they first appear in afterwards, until they take their place in a kingdom again.
CREATE TABLE realm_panel_forgotten (
  person_id text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  origin    text NOT NULL CHECK (origin IN ('live', 'simulated')),
  since_ms  bigint NOT NULL CHECK (since_ms >= 0),
  PRIMARY KEY (person_id, origin)
);

-- The kingdoms where a forgotten person has taken their place again since. Their fresh consent counts only there. A
-- new forget removes these rows.
CREATE TABLE realm_panel_returned (
  kingdom_id text NOT NULL REFERENCES realm_kingdoms (kingdom_id),
  person_id  text NOT NULL CHECK (person_id ~ '^[1-9][0-9]{0,31}$'),
  since_ms   bigint NOT NULL CHECK (since_ms >= 0),
  PRIMARY KEY (kingdom_id, person_id)
);

-- Whether a kingdom must keep nothing of this person: forgotten in its origin, and not returned there.
CREATE FUNCTION realm_panel_withheld(p_kingdom text, p_person text, p_origin text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM realm_panel_forgotten f WHERE f.person_id = p_person AND f.origin = p_origin)
    AND NOT EXISTS (SELECT 1 FROM realm_panel_returned r WHERE r.kingdom_id = p_kingdom AND r.person_id = p_person)
$$;

-- Every guarded write takes this lock shared before it checks the note. Forget takes it exclusively once, after its
-- note commits, so it waits out any write that checked before the note; every later write sees the note.
CREATE FUNCTION realm_panel_forget_barrier() RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock_shared(hashtextextended('chatdom.realm.panel.forget', 0))
$$;

-- The ingress inbox keeps nothing of a withheld person. Every source (chat, panel, walker), in every realm process,
-- stores through this one insert, so an observation that was already on its way when they asked, or a chat line
-- after, in any kingdom, is kept without their entry. Others in the same observation stay, so a roster still says who
-- else is there. Controls (forget, moderation) carry only the account number and stay whole: they are what keeps the
-- hold. The digest stays the sender's, so a retry still meets this row as a duplicate.
CREATE FUNCTION realm_panel_forgotten_inbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  observed jsonb;
  kept jsonb;
  kingdom_origin text;
BEGIN
  PERFORM realm_panel_forget_barrier();
  IF NOT EXISTS (SELECT 1 FROM realm_panel_forgotten) THEN RETURN NEW; END IF;
  observed := NEW.observation::jsonb;
  IF observed ->> 'kind' IS DISTINCT FROM 'observe' OR jsonb_typeof(observed -> 'people') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  SELECT origin INTO kingdom_origin FROM realm_kingdoms WHERE kingdom_id = NEW.kingdom_id;
  kingdom_origin := coalesce(kingdom_origin, observed ->> 'origin');
  SELECT coalesce(jsonb_agg(p.person ORDER BY p.ordinal), '[]'::jsonb) INTO kept
    FROM jsonb_array_elements(observed -> 'people') WITH ORDINALITY AS p (person, ordinal)
    WHERE NOT realm_panel_withheld(NEW.kingdom_id, p.person ->> 'personId', kingdom_origin);
  IF jsonb_array_length(kept) <> jsonb_array_length(observed -> 'people') THEN
    NEW.observation := jsonb_set(observed, '{people}', kept)::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_panel_forgotten_inbox BEFORE INSERT ON realm_ingress_inbox FOR EACH ROW EXECUTE FUNCTION realm_panel_forgotten_inbox();

-- The Twitch display name the realm keeps is one row per person, so it is written again only once they have taken
-- their place somewhere since forgetting. A chat line anywhere else stores no name: the write is skipped, not refused,
-- so the sender carries on.
CREATE FUNCTION realm_panel_forgotten_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM realm_panel_forget_barrier();
  IF EXISTS (SELECT 1 FROM realm_panel_forgotten f WHERE f.person_id = NEW.person_id AND f.origin = NEW.origin)
    AND NOT EXISTS (SELECT 1 FROM realm_panel_returned r JOIN realm_kingdoms k USING (kingdom_id)
      WHERE r.person_id = NEW.person_id AND k.origin = NEW.origin) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER realm_panel_forgotten_name BEFORE INSERT OR UPDATE ON realm_citizen_names FOR EACH ROW EXECUTE FUNCTION realm_panel_forgotten_name();
