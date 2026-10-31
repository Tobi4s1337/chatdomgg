# The Raid Gate: integration

Spec: `work/specs/23-raid-gate.md`. This folder is the browser side; the server application lives in
`apps/api/src/raid-gate/`. The browser imports only `apps/api/src/raid-gate/contracts.ts` (plus the in-page bench).

## What exists (RG01, RG07)

| Piece | File | State |
|---|---|---|
| Feature-local contract: commands, replies, strict readers | `apps/api/src/raid-gate/contracts.ts` | All spec 23 shapes, plus `{op:'gate'}` → `GateStatusView` (see spec Decisions) |
| Durable records and the CAS transaction port | `apps/api/src/raid-gate/repository.ts` | Gate pointer, raid action, party member |
| Application: gate status, preview, join, leave, read-action, close (`cancel` before start) | `apps/api/src/raid-gate/application.ts` | Real. Start, Twitch cancel and later ops answer `denied: unavailable` until their task lands |
| Durable repository over the realm schema | `apps/api/src/raid-gate/postgres-repository.ts`, `realm-migration.sql` | Serializable CAS; every row passes its strict reader |
| Session principal from realm-auth's cookie | `apps/api/src/raid-gate/session.ts` | Role derived on the server: monarch by Twitch identity, citizen by deed, otherwise guest |
| Live policy | `apps/api/src/raid-gate/policy.ts` | Session and broadcaster from the realm; live, grant, consent and Atlas verdict are required ports |
| Composition and node adapter | `apps/api/src/raid-gate/service.ts` | `createRaidGateService(...)` → `{ matches, serve, close }` |
| Transactional memory repository (tests and bench only) | `apps/api/src/raid-gate/memory-repository.ts` | Never bound as production storage |
| Browser ports | `ports.ts` | `RaidGateApi`, `AtlasGateHost`, `GateKingdom`, `GateAccount` |
| Controller | `controller.ts` | Deterministic under an injected clock; late replies ignored |
| Gate board | `RaidGatePane.tsx`, `Seal.tsx`, `raid-gate.css` | Desktop dock, phone sheet |
| Route `/-/raid-gate` | `index.tsx` | Unbound by default: "The gate is shut here" |
| Bench `/-/raid-gate?bench=simulated` | `bench.ts` | The real application in the page; SIMULATED everywhere |
| Captures | `capture.mjs` | `node apps/web/src/raid-gate/capture.mjs [--only a,b]` after `pnpm build` |

## What main binds

Short version, with the pieces above:

1. Register `apps/api/src/raid-gate/realm-migration.sql` unchanged as
   `apps/realm/src/persistence/migrations/0009_realm_raid_gate.sql`, then delete the `?raw` fallback in
   `postgres.integration.test.ts` and run it once with `REALM_DATABASE_TESTS=1`.
2. In `apps/api/src/main.ts`:
   ```ts
   const raidGate = createRaidGateService({
     pool, origin: config.mode, issuer: provider.issuer,
     sessionCookie: config.secureCookies ? '__Host-chatdom_session' : 'chatdom_session',
     publicOrigin: config.publicOrigin, origins: [config.publicOrigin], clock: Date.now,
     policyPorts: { live, grants, consent, directory },
   });
   if (raidGate.matches(request.url)) { await raidGate.serve(request, response); return; }   // before routes()
   // stop(): raidGate.close();
   ```
   `live` = `createHelixLiveChannels(new HelixReader(...))` (needs `@chatdom/twitch` in `apps/api` and an app-token
   session). `grants` (the source's `channel:manage:raids` state, telling revoked apart from never connected),
   `consent` (the monarch's Twitch-write switch) and `directory` (Atlas classification and whether this source may
   raid the target) have no store yet; they are main's.
3. In the kingdom host, give the controller `createHttpRaidGateApi({ url: `/api/raid-gate/${kingdomId}`, origin })`,
   the Atlas `AtlasGateHost`, the source face and the throne's `{ reconnect }`, and mount `RaidGatePane` at the gate
   anchor.

The longer contract each port honours:

1. **API adapter.** Mount `createRaidGateApplication(deps).handle(context, body)` behind the authenticated router.
   Build `context.principal` from the session, never from the body:
   `{ personId, sessionId, sourceKingdomId, sourceRole }`, with `now` from the server clock and the request's
   abort signal. Return the reply as JSON. The browser re-reads every reply with `readGateReply` and refuses
   anything malformed.
2. **Change stream.** Pass a `GateNotifier` in `deps.notifier`. On `changed({kingdomId, requestId, revision})`,
   re-run `handle(subscriberContext, {op:'gate'})` for each subscriber in that kingdom and push the reply down
   their SSE/WebSocket. The change itself carries nothing private, and each reply is computed with that
   subscriber's own principal.
3. **`GatePolicy`.**
   - `readStanding(principal)`: whether the session is current, whether this person is verified as the
     source broadcaster (Twitch identity), whether the source is live, the source's `channel:manage:raids` grant
     (`granted | missing | revoked | unknown`), and the monarch's consent for Twitch writes (`enabled | disabled`).
   - `readTarget(from, target)`: the destination's live state, founded flag and Atlas classification, plus
     whether this source may raid it. Return `null` for an unknown channel.
4. **`PreviewTokens`.** `issue()` returns a random opaque token (≥128 bits, `[A-Za-z0-9]`); `hash()` returns its
   SHA-256 hex. Only the hash is stored.
5. **`RaidGateRepository`.** One serializable transaction over three tables, each a compare-and-set on
   `revision` (0 creates, the new record is exactly one higher, a conflict returns what is stored now):
   - `gate_pointer` keyed by `kingdomId`
   - `raid_action` keyed by `requestId`
   - `party_member` keyed by `(requestId, personId)`
   Decode rows with `readGatePointer`, `readActionRecord` and `readMemberRecord`. The records hold no OAuth
   credentials or chat text.
6. **`origin`.** `live` only when the policy, transports and storage are the real ones; otherwise `simulated`.
7. **Browser composition.** Give `createRaidGateController` the following:
   - `api`: a `RaidGateApi` whose `request` POSTs the command and whose `subscribe(null, …)` listens to (2).
     Set `origin` to match the server.
   - `atlas`: the Atlas lane's `AtlasGateHost`, which opens gate mode at the source, reports the pick as
     `{kind:'target', channel, land}`, reports `{kind:'closed'}`, and resolves a named destination.
   - `source`: the kingdom's `{kingdomId, name, login}`.
   - `account`: `{reconnect}` to the throne's Twitch connection, when the host has one.

   Then mount `<RaidGatePane controller={…} clock={…} />` in the kingdom host at the gate.

The route stays unbound until (1)–(7) exist. It shows the honest "The gate is shut here" state and offers no
action it cannot perform.
