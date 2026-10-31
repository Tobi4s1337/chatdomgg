-- Private names observed by trusted Twitch ingress. This is not an OIDC sign-in or a session.
-- Keeping provenance separate lets a quiet chatter later sign in as the same real person.
create table realm_citizen_names (
  person_id text not null check (person_id ~ '^[0-9]+$'),
  origin text not null check (origin in ('live', 'simulated')),
  public_name text not null check (length(public_name) between 1 and 64),
  name_approval text not null check (name_approval = 'provider-display-name-v1'),
  observed_ms bigint not null check (observed_ms >= 0),
  primary key (person_id, origin)
);
