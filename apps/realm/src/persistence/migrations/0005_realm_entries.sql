-- One entry per consumed kingdom ticket (spec 34 R5/R8). Additive only.

-- The entry's random id is the principal's `sessionId`: the walker's identity inside one room and the key the realm
-- rechecks the Chatdom session by on every reconnect and session check. The Chatdom session id itself never reaches a
-- room, so a walker key cannot be linked across kingdoms or entries, and two windows of one session never share a
-- seat id. An entry lives exactly as long as its session: revocation and expiry end it through the join below, and
-- the API's sweep forgets entries of ended sessions.
CREATE TABLE realm_entries (
  entry_id    uuid PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES realm_sessions (session_id) ON DELETE CASCADE,
  person_id   text NOT NULL REFERENCES realm_persons (person_id),
  kingdom_id  text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  origin      text NOT NULL CHECK (origin IN ('live', 'simulated')),
  opened_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realm_entries_session ON realm_entries (session_id);
