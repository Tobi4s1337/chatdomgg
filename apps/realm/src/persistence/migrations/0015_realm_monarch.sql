-- The monarch's chosen title, per kingdom. A missing row is the default title ("Monarch"); only the verified
-- broadcaster writes it, through the realm's monarch channel. No foreign key: a title never founds a kingdom.
CREATE TABLE realm_monarch_titles (
  origin text NOT NULL CHECK (origin IN ('live', 'simulated')),
  kingdom_id text NOT NULL CHECK (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  title text NOT NULL CHECK (title IN ('Monarch', 'King', 'Queen')),
  updated_ms bigint NOT NULL CHECK (updated_ms >= 0),
  PRIMARY KEY (origin, kingdom_id)
);
