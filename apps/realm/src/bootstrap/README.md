# Durable realm composition

`createDurableRealmBoot` consumes a real configured `pg.Pool`, its checked schema, one origin, a persistent
`foundedDirectory`, the actual `TenureEvidenceVerifier`, service ingress credentials and the host's required
`foundedAccess(target, request)` policy. It exposes the retained `services`, repository, allocation service,
founded loader/store/reader, ingress, diagnostics and readiness. It never adopts or generates a settlement plan.
No furnisher means existing allocation leaves deeds pending; no naming approval is inferred.

Every cold `services.open`/`retain` resolves the actual adopted head and prewarms pinned native content and sampled
terrain before the registry acquires its writer. The existing `loader.options(kingdomId, committedState)` then
resolves the exact committed home overrides inside that held writer. An absent adopted head refuses explicitly
before creating an empty realm writer row.

`boot.createServer()` mounts `REALM_FOUNDED_ROUTES` unchanged, plus diagnostics and configured ingress. The host can
pass `{ mountIngress(app) }` when its domain ingress bridge owns the same existing service route. It can install
its actual Forge guards via `repositoryOptions` and bind the bridge/authority with `attach(kingdom)`. Call
`bridge.use(boot.services)` before listening. The host owns schema assertion, `readiness.start()`, listen, server
shutdown and finally pool closure; `boot.stop()` releases this composition's service timers and writers.

Manifest reads authorize before retaining, use the same `services.retain` as rooms/ingress, await the actual
`preparePublicCheckpoint`, and require `loader.current(...).manifestFor(checkpoint)` plus the exact adopted world
object. They recheck access and the public checkpoint before returning and release only their own hold. A cold
entry therefore needs no fabricated principal, existing walker or second writer. Scene reads use the exact
integrity-checked store bytes, validate their allowlisted identity, enforce origin and the same withdrawal policy,
then obtain the current manifest through that same retained authority. A valid baseline or superseded stored hash
is refused unless it is the exact current authority-adopted/public-checkpoint-matching scene. The reader rechecks
access after that comparison. All responses are no-store, including hash-addressed scenes, because the
browser cache must not bypass a later withdrawal. No response contains private authority state.

Main's accepted access decision makes the approved current geometry allowlist public. Standalone main permits
only its configured origin through this current-only reader; no raw stored hash grants permission. A future
explicit withdrawal/veil policy composes as the required injected `foundedAccess` veto, checked at each read.
`denyFoundedReads` is also exported for hosts that cannot yet supply their actual policy. The request copies only
authorization/cookie/origin during the synchronous uWS callback. Policies that use browser identity must verify
it themselves; headers alone do not establish identity.

Standalone durable configuration adds `REALM_FOUNDED_DIRECTORY` (use an ignored host path, for example a directory
ending in `.local`) and the existing `REALM_EVIDENCE_KEY`, alongside `DATABASE_URL`, `REALM_DATABASE_SCHEMA` and
optional ingress secrets. No values are logged. No automatic schema migration, key generation or infrastructure
change happens at boot. `REALM_SIMULATED=1 REALM_STORAGE=memory` explicitly selects the old walking reference;
durable simulated mode uses real simulated database sessions and exact adopted plans, without a reference ticket
issuer. Live mode has no `/reference/session` route.

Focused evidence: `REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run
apps/realm/src/bootstrap/durable.test.ts` passes against a fresh throwaway schema and filesystem directory. It
checks unfounded refusal before writer creation, denied reads, cold exact manifests/scene bytes, the shared held
writer/world, foreign-origin ticket refusal, stable restart receipts and corrupt-byte refusal. The test community
and identity are explicitly SIMULATED; it proves no live sign-in, founding, naming, approval or browser journey.
