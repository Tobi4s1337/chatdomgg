# Retained royal authority

`RealmDockService` binds to `boot.services`, sharing its held kingdom, serial queue and writer lease. Its SQL
transactions lock `realm_kingdoms`, verify the API session independently, and check the unexpired writer epoch
again immediately before commit. Migration `0010_realm_dock` stores action digests, current gentle state and
presentation receipts atomically. It introduces no second writer, Twitch write, entry restriction or dragon spawn.

`mountRealmDockRoutes` exposes the shared `REALM_DOCK_ROUTES`, all behind `REALM_INTERNAL_SECRET`:

- POST status/action: exact shared request and response schemas. Actor authority comes from current session
  records and broadcaster identity. Without durable moderator identity evidence, observer access fails closed.
- GET presentations: public stage data over service-authenticated SSE; no presenter capability.
- POST presentations: the status request, matching the path kingdom, opens an independently verified broadcaster
  presenter. SSE emits a `presenter` capability, a nonceremonial `state` checkpoint, then `presentation` events.
- POST witness: the shared witness request. The capability must belong to this still connected session and must
  have delivered this exact committed event. Only this recorded acknowledgment permits an accepted receipt.

Commands wait at most 1.8 seconds for a witness. Without it the committed outcome is `unknown`; retrying the same
ID and payload retrieves its durable result. Changed payloads, stale revisions, unavailable/hidden targets and
consumed raid observations are refused. A new act has a two-second cadence. Fire gathers for ten minutes; honours
last a day. The last witnessed receipt may be gently undone for thirty seconds. Raid provenance remains consumed.
The realm offers only its harmless dusk-sky moment; incoming welcomes require a recent real normalized raid fact.

Stage checkpoints restore gate/fire/honours without replaying ceremonies or issuing receipts. Expired honours are
omitted and fresh disclosure/rights are rechecked. Connected feeds refresh checkpoints when public authority
changes. Unwitnessed ceremonies may resume for sixty seconds; witnessed ceremonies never replay on reconnect.

Focused verification (isolated random database schema, explicitly SIMULATED transport/identity):

```sh
REALM_DATABASE_TESTS=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/realm/src/dock/service.test.ts
```

The test establishes a real fenced commit, public feed without a capability, authenticated event replay and
acknowledgment, accepted idempotent retry, conflicting/stale refusal, state after writer reopening and revocation.
It makes no claim that pixels were drawn; the stream consumer owns that proof and acknowledges only after drawing.
