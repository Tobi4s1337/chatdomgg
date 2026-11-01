-- Growth is committed beside its source room fact and delivered through the existing durable public outbox.
ALTER TABLE realm_outbox DROP CONSTRAINT realm_outbox_kind_check;
ALTER TABLE realm_outbox ADD CONSTRAINT realm_outbox_kind_check
  CHECK (kind IN ('presence', 'forge', 'home', 'castle', 'moment', 'growth'));
