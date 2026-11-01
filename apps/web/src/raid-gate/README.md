# The Raid Gate: integration

Spec: `work/specs/23-raid-gate.md`. This folder is the browser side; the server application lives in
`apps/api/src/raid-gate/`. The browser imports only `apps/api/src/raid-gate/contracts.ts` (plus the in-page bench).

## What exists (RG01, RG07, RG08, RG09, RG10)

| Piece | File | State |
|---|---|---|
| Feature-local contract: commands, replies, strict readers | `apps/api/src/raid-gate/contracts.ts` | All spec 23 shapes, plus `{op:'gate'}` → `GateStatusView` (see spec Decisions) |
| Durable records and the CAS transaction port | `apps/api/src/raid-gate/repository.ts` | Gate pointer, raid action, party member |
| Application: gate status, preview, join, leave, read-action, close, start, Twitch cancel, reconcile | `apps/api/src/raid-gate/application.ts` | Real. Travel, passport and gift ops answer `denied: unavailable` until their task lands |
| Witnessed departure: `ingestRaid`, `recover` | `apps/api/src/raid-gate/application.ts` | Server-only; lands a correlated raid once and hands it to the Atlas road ingestion |
| Verified raid evidence and recovery | `apps/realm/src/raid-gate/{observations,http}.ts` | Mounted on the existing realm listener; immutable history, roads and pennants, with current incoming beats through the existing moment authority |
| Outbox for Twitch writes and the road handoff | `apps/api/src/raid-gate/repository.ts` | `queued` sendable, `claimed` reconcile-only, `settled` |
| Durable repository over the realm schema | `apps/api/src/raid-gate/postgres-repository.ts`, `0011_realm_raid_gate.sql` | Serializable CAS; every row passes its strict reader |
| Session principal from realm-auth's cookie | `apps/api/src/raid-gate/session.ts` | Role derived on the server: monarch by Twitch identity, citizen by deed, otherwise guest |
| Live policy | `apps/api/src/raid-gate/policy.ts` | Session and broadcaster from the realm; live, grant, consent and Atlas verdict are required ports |
| Composition and node adapter | `apps/api/src/raid-gate/service.ts` | `createRaidGateService(...)` → `{ matches, serve, close }` |
| Transactional memory repository (tests and bench only) | `apps/api/src/raid-gate/memory-repository.ts` | Never bound as production storage |
| Browser ports | `ports.ts` | `RaidGateApi`, `AtlasGateHost`, `GateKingdom`, `GateAccount` |
| Controller | `controller.ts` | Deterministic under an injected clock; late replies ignored |
| Gate board | `RaidGatePane.tsx`, `Seal.tsx`, `raid-gate.css` | Desktop dock, phone sheet |
| Route `/-/raid-gate` | `index.tsx` | Unbound by default: "The gate is shut here" |
| Bench `/-/raid-gate?bench=simulated` | `bench.ts` | The real application in the page; SIMULATED everywhere |
| Travel coordinator: reserve, prepare, commit once, reconcile, cancel, return, recover | `apps/realm/src/raid-gate/coordinator.ts` | Real; fenced whereabouts, arrival evidence, source released only after the destination's acknowledgment |
| Travel records and their durable repository | `apps/realm/src/raid-gate/records.ts`, `postgres-repository.ts` | Travel, arrival, whereabouts; tables in `0011_realm_raid_gate.sql` |
| March check for raid journeys | `createRaidMarchCheck` in `apps/api/src/raid-gate/application.ts` | Joined, landed, this raid, within five minutes |
| SIMULATED room transport (tests and bench only) | `apps/realm/src/raid-gate/simulated-rooms.ts` | Fencing generation, idempotent holds, refuses a commit after reconcile |
| Journey board | `RaidGatePane.tsx` (`TravelBoard`) | Stages from the authority, overrun, confirming, arrived, home, turned back, refused |
| Gift policy and the welcome: offer, accept, refuse, `{op:'welcome'}` | `apps/api/src/raid-gate/gifts.ts` | Real. One item transaction moves the thing, writes its lineage and settles the offer; retries return the same receipt |
| Durable gift storage and host directory | `apps/api/src/raid-gate/gift-postgres.ts`, `gift-hosts.ts`; tables in `0011_realm_raid_gate.sql` | Offers and lineage are ours; the things stay in main's item authority behind `ItemRows` |
| Arrival evidence for gifts | `apps/realm/src/raid-gate/arrivals.ts` | Present = the whereabouts still name this arrival in its kingdom, unfenced |
| SIMULATED item store (tests and bench only) | `apps/api/src/raid-gate/gift-memory.ts` | Can fail before commit or lose its answer after commit |
| Welcome controller | `welcome.ts` | Created by the gate controller once a raid journey commits as a visitor; lost presses re-sent under the same request |
| The welcome tableau and gift tags | `GuestArrival.tsx`, `VisitorGifts.tsx`, `welcome.css` | Torchlit column at the destination's gate; gifts, ledger and shelf on the board |
| Captures | `capture.mjs` | `node apps/web/src/raid-gate/capture.mjs [--only a,b]` after `pnpm build` |

## What main binds

Short version, with the pieces above:

1. Apply the registered `apps/realm/src/persistence/migrations/0011_realm_raid_gate.sql` to the target schema
   before starting the new realm or API build. The realm requires exactly its registered migration checksums;
   startup does not apply migrations. The gate and travel Postgres suites use this registered migration directly
   with `REALM_DATABASE_TESTS=1`, without manually creating tables outside the migration ledger. Use
   `--no-fsModuleCache` when running these suites after adding a migration: the test runner's persistent transform
   cache can otherwise retain an earlier expansion of the migration file list.
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
   session). Pass `raids` (an `AuthorizedRaidTransport`: Start/Cancel a Raid with the source's `channel:manage:raids`
   user token, recording each write by `key` before calling Twitch so `reconcile(key)` can answer for a lost reply and
   says `unknown` when it cannot tell) and `roads` (the Atlas's `AtlasRoadIngress`, idempotent by raid ID). Without
   `raids` the gate gathers but `start` answers `unavailable`; without `roads` witnessed raids wait in the outbox.
   The service runs `recover()` every 15 s and once at start-up; `close()` stops it.
   Verified EventSub raid delivery is now mounted separately: Herald's durable outbox sends the strict
   `RaidObservationEnvelopeSchema` to `/internal/realm/raid-gate/observe`. The realm freezes the source/target
   request correlation on first receipt, then commits the history, outgoing landing and delivered road outbox
   together. Do not also send it through the legacy spectacle path or the API's `ingestRaid`. On live origins,
   `raid.source = 'herald'`; simulated evidence is isolated. Incoming beats keep the original event ID through the
   existing moment writer and expire after 60 seconds; history and roads do not expire. The feed/pennant route,
   migration `0011b` and cursor contract are in `work/lanes/raid-show/SEAMS.md` §2. API change subscribers still need
   cross-process revision refresh when the API gate is mounted: realm landing cannot notify an in-process API listener.
   `grants` (the source's `channel:manage:raids` state, telling revoked apart from never connected),
   `consent` (the monarch's Twitch-write switch) and `directory` (Atlas classification and whether this source may
   raid the target) have no store yet; they are main's.
3. Travel (RG09). Bind a `RealmTravelTransport` over the realm's rooms (`apps/realm/src/raid-gate/ports.ts` states the
   contract: every operation idempotent by ticket; `commit` moves the walking membership atomically only while the
   person is still at `generation - 1` in `from`, and answers the destination's role; `reconcile` never moves anyone and
   makes a later commit for that ticket fail once it answered `held` or `released`; `release('source')` lets go of the
   retained source place). Then pass it as `rooms` to `createRaidGateService({ ..., rooms })`: the service builds the
   coordinator on the realm pool (`createPostgresTravelRepository`) with the gate's own `createRaidMarchCheck`, and its
   recovery timer runs the journeys' recovery after the gate's. Without `rooms`, travel commands answer `unavailable`. The Atlas may implement `AtlasGateHost.travel(stage)` to
   rise, draw the road and reveal the destination at the pace of those stages.
4. Gifts (RG10). Pass `items: ItemRows` to `createRaidGateService({ ..., items })`: `get`, a conditional `move` (owner
   and revision, stored at `expectedRevision + 1`) and `listOwned`, all on the gift transaction's own `SqlClient`, so the
   move, the offer and the lineage row commit together. Each item carries kind, `transferable`, `paid`, maker and
   origin names (`readGiftItem`). The service composes `createVisitorGifts` with `createPostgresItemTransfers`,
   `createArrivalWitness` and `createRealmGiftHosts`. Without `items`, `welcome` and the gift ops answer `unavailable`.
   The welcome is drawn as an overlay tableau (`GuestArrivalPane`) until the kingdom host has a gate anchor in the
   world; a host's gift shelf (`{op:'welcome', arrivalId: null}`) has no host-side surface yet.
5. In the kingdom host, give the controller `createHttpRaidGateApi({ url: `/api/raid-gate/${kingdomId}`, origin })`,
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
     `{kind:'target', channel, land}`, reports `{kind:'closed'}`, resolves a named destination, and `follow(raid)`
     attaches the map to that witnessed raid's public caravan (presentation only; the road comes from the server).
   - `source`: the kingdom's `{kingdomId, name, login}`.
   - `account`: `{reconnect}` to the throne's Twitch connection, when the host has one.

   Then mount `<RaidGatePane controller={…} clock={…} />` in the kingdom host at the gate.

The route stays unbound until (1)–(7) exist. It shows the honest "The gate is shut here" state and offers no
action it cannot perform.

## The raid road (RR10)

One continuous journey from one gate to the other, at dusk: `/-/raid-gate?bench=simulated&road=1`.

| Piece | File | What it does |
|---|---|---|
| Director | `road/director.ts` | A pure schedule of acts (`gather`, `setout`, `rise`, `ride`, `hold`, `wake`, `welcome`) on a presentation clock, each gated by a fact the authority gave: the party sets out only once Twitch's raid is witnessed, the map rises only once it is drawn, the column waits at the destination gate (`hold`) until the arrival commits, and the welcome waits for the welcome reply. Pure: the same facts and time give the same frame |
| The two lands | `road/lands.ts` | MashaD4's mountain citadel rides to PinkKittyRose's river valley: real channels with real Atlas holdings, their land grown from each channel's observed seed exactly as the Genesis previews grow it. Potential land is scenery: no room, deed or audience comes with it |
| The gathering | `road/procession.tsx`, `road/tableaux.tsx`, `road/gate-shot.ts` | The leaving kingdom's camera stands outside its gate looking in over the near streets (`gateShotOf`, the gate the kingdom's own raid arrivals use). Over it a seekable SVG tableau: the gate wakes (braziers, banners unfurling), walkers arrive one by one with their own pennants, the monarch leads the column into the arch. Drawn figures until the kingdom scene can stand the party at its gate (see "What main binds" 4) |
| The arrival, in the world | `road/arrival-feed.ts` | When the column reaches the destination and its world wakes, the road hands the destination scene's `momentFeed` the witnessed raid as one SIMULATED `twitch.moment` raid fact: the kingdom's own raid arrival wakes its gate under the leaving kingdom's banner, lights the braziers, rolls the caravan in (sized by Twitch's count) and takes the gate shot. The welcome's words and the gate board sit over it; no figure is drawn on top |
| The road on the Atlas | `../atlas/road/` | `openRoadAtlas` finds both holdings in the survey, plans one deterministic road (a sea lane when the lands differ), and draws it in ink as the column walks: pencilled ahead, trodden behind. The torch column is a mark, sized by the log of the travellers, never a roster; torches are pigment dabs (the Atlas has no night) |
| Journey camera | `../atlas/road/shot.ts` | Rises out of the source drawing, rides close, pulls back to hold the whole road, closes in on arrival and dives into the destination |
| The route | `road/RaidRoad.tsx`, `road/road.css` | The real gate application on the SIMULATED bench (`bench.ts` takes a `BenchCast`), both kingdoms' worlds at dusk, the map between them, the gate board while the gate acts; every surface says SIMULATED |
| Captures | `road/capture.mjs` | `node apps/web/src/raid-gate/road/capture.mjs --only gate\|road\|welcome [--reduced]` after `pnpm build`: one still per lease of the shared capture lock. The presentation clock is frozen (`capture=1`) and seeked, and the page's `Date.now` is pinned to it, so the kingdoms' own moments are seeked too |

What main binds for the live road:

1. The kingdom host mounts the route's three layers in place of its own canvases: the source kingdom scene keeps
   rendering through `gather` and `setout`, the Atlas road takes over at `rise`, and the destination scene is
   revealed at `wake`. The facts come from the gate controller's snapshot exactly as `RaidRoad.observe()` reads them.
2. `AtlasGateHost.travel(stage)` can be implemented by `openRoadAtlas(...).show(mapFrame(momentAt(...)))`; the
   ride length is `rideSeconds` (12–30 s by distance, spec 23).
3. A live destination gets its raid arrival from its realm's own moment feed (main's ingress); the road's
   `createRoadArrivalFeed` is SIMULATED only, and a live scene refuses its facts by origin.
4. The party as people. The kingdom's raid arrival brings wagons and nobody rides them; the leaving gate's party is
   still drawn. For the party to be the same citizens seen on the streets, the kingdom scene needs a read-only gate-party
   mount on `SceneOptions.momentFeed` (the exact `needs:` is in `work/lanes/raid-road/progress.txt`): a column of
   `caravanCount(viewers)` citizens dressed by the crowd's seeded look (from raid ID and place in the column, never a
   viewer's identity), the first carrying the source's banner, the rest a pennant and a torch lit through the light
   field, walking in from `placeAnchor('gate')` for an incoming raid, and out through it for a gate-party frame
   `{ phase: 'gather' | 'setout', marchers, progress }`, plus the gate anchor's screen point for the words.
