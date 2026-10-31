-- The monarch's seat has its own public checkpoint row. It is never a citizen home/deed.
ALTER TABLE realm_outbox DROP CONSTRAINT realm_outbox_kind_check;
ALTER TABLE realm_outbox ADD CONSTRAINT realm_outbox_kind_check
  CHECK (kind IN ('presence', 'forge', 'home', 'castle'));
