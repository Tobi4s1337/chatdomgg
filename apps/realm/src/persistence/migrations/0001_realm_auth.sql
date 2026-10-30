-- Sign-in, Chatdom sessions and single-use kingdom tickets.
-- The API issues; the realm consumes tickets and rechecks sessions. Only hashes of browser secrets are stored.

-- One row per real person, keyed by the verified OIDC subject (the Twitch user ID, the same ID chat uses).
create table realm_persons (
  person_id text primary key check (person_id ~ '^[1-9][0-9]{0,31}$'),
  origin text not null check (origin in ('live', 'simulated')),
  identity_issuer text not null check (length(identity_issuer) between 1 and 256),
  -- Approved public name and its evidence; null means the approved anonymous presentation.
  public_name text check (public_name is null or length(public_name) between 1 and 128),
  name_approval text check (name_approval is null or length(name_approval) between 1 and 64),
  name_approved_at timestamptz,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz not null default now(),
  check ((public_name is null) = (name_approval is null) and (public_name is null) = (name_approved_at is null))
);

-- Server-bound, browser-bound, one-use OIDC state and nonce.
create table realm_sign_in_attempts (
  state_hash bytea primary key check (length(state_hash) = 32),
  nonce_hash bytea not null check (length(nonce_hash) = 32),
  binding_hash bytea not null check (length(binding_hash) = 32),
  return_to text not null check (length(return_to) between 1 and 256),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index realm_sign_in_attempts_expiry on realm_sign_in_attempts (expires_at);

create table realm_sessions (
  session_id uuid primary key,
  handle_hash bytea not null unique check (length(handle_hash) = 32),
  person_id text not null references realm_persons (person_id),
  origin text not null check (origin in ('live', 'simulated')),
  -- Opaque browser storage partition. Grants nothing; rotates with every new session.
  resume_scope text not null unique check (length(resume_scope) between 16 and 128),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or revoked_reason in ('signout', 'revoked', 'replaced', 'moderated')),
  check ((revoked_at is null) = (revoked_reason is null))
);
create index realm_sessions_person on realm_sessions (person_id) where revoked_at is null;

create table realm_tickets (
  ticket_hash bytea primary key check (length(ticket_hash) = 32),
  session_id uuid not null references realm_sessions (session_id),
  person_id text not null references realm_persons (person_id),
  kingdom_id text not null check (kingdom_id ~ '^[1-9][0-9]{0,31}$'),
  protocol integer not null check (protocol = 1),
  origin text not null check (origin in ('live', 'simulated')),
  -- The web origin that requested it (audit only; the realm endpoint is trusted configuration).
  requested_by text not null check (length(requested_by) between 1 and 256),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at)
);
create index realm_tickets_session on realm_tickets (session_id, issued_at);
create index realm_tickets_expiry on realm_tickets (expires_at);
