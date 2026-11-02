-- Forge-only OAuth grants. No token, wish words or provider response is stored in plaintext.
create table forge_chat_grants (
  origin text not null check (origin in ('live', 'simulated')),
  person_id text not null,
  client_id text not null,
  generation bigint not null check (generation >= 0),
  ciphertext text,
  primary key (origin, person_id, client_id)
);
create table forge_chat_states (
  origin text not null check (origin in ('live', 'simulated')),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  session_id text not null,
  person_id text not null,
  client_id text not null,
  grant_generation bigint not null check (grant_generation >= 0),
  kingdom_id text not null,
  expires_ms bigint not null,
  expected_scopes jsonb not null,
  primary key (origin, state_hash)
);
create index forge_chat_states_expiry on forge_chat_states (expires_ms);
create table forge_chat_requests (
  origin text not null check (origin in ('live', 'simulated')),
  person_id text not null,
  request_id uuid not null,
  kingdom_id text not null,
  created_ms bigint not null,
  updated_ms bigint not null,
  message_id text,
  session_id text not null,
  body_digest text not null check (body_digest ~ '^[a-f0-9]{64}$'),
  projection jsonb,
  primary key (origin, person_id, request_id)
);
create unique index forge_chat_request_message on forge_chat_requests (origin, person_id, kingdom_id, message_id) where message_id is not null;
create index forge_chat_requests_latest on forge_chat_requests (origin, person_id, kingdom_id, created_ms desc);
-- Bounded exact-id race buffer, consumed when Twitch returns its message id.
create table forge_chat_observations (
  origin text not null check (origin in ('live', 'simulated')),
  person_id text not null,
  kingdom_id text not null,
  message_id text not null,
  expires_ms bigint not null,
  observation jsonb not null,
  primary key (origin, person_id, kingdom_id, message_id)
);
create index forge_chat_observations_expiry on forge_chat_observations (expires_ms);
