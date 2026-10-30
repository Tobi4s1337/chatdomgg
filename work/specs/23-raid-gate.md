# Spec 23: the gate opens onto a real road

Status: **frozen lane-local boundary, 2026-10-30. Main approved the ports below; live infrastructure bindings remain explicit.**
Vision: `chatdom/ChatDom.md` principles 1, 3, 5–10, 13, 15–18 and §10 item 7;
`chatdom/Moments.md` §7; `chatdom/Atlas.md` §§2, 5.2, 6, 7.3–7.6 and Decided §12;
`chatdom/Twitch.md` §§9, 12–14 and Decided §21; `chatdom/World-Tree.md` rules 9–10;
`chatdom/Artstyle-Soul-Feel.md` §§2, 5, 11–13; `chatdom/Quality.md`.

## What and why

At the end of a night, the monarch calls their people to the gate. The Atlas offers a real destination,
the monarch sees what opening the gate will do, and anyone walking may choose to march. On Twitch's actual
confirmation, the party sets out. The kingdom recedes into ink, the public caravan follows its road, and the
destination welcomes the visitors. Their homes wait behind them. A gift carries its maker's story home, and a
passport remembers a journey the kingdom actually witnessed. A later visit can follow that same road.

This lane builds the **kingdom side and server application** of that complete experience: gate controls, the
voluntary party, raid action lifecycle, travel reservation/rollback, guest/gift/passport handlers and return.
Main binds authenticated principals, routers, durable repository adapters and authorized transports; the lane
owns the feature logic rather than leaving a service-sized hole for main. The existing Atlas lane owns its map, destination finder,
road ledger, caravan rendering and map/world hand-off. Both must work together before this lane is complete.

## Current state

- `packages/shared/src/atlas-raids.ts:7` exports `AtlasRaidSchema`/`AtlasRaid`: public channel observation,
  source, observation/event times, evidence and delivery semantics. Its legacy SSE adapter at line 33 has a
  best-effort content key, **no resumable upstream event identity**, and no individual riders.
- `packages/shared/src/atlas.ts:42` exports append-only `AtlasSettler`; line 54 exports public `AtlasChannel`,
  including founded status and `unknown/general/mature/excluded` classification. `AtlasEvidence` preserves
  observed, replay and simulated provenance. `ATLAS_SPECTACLE.raidParty` already exists.
- `packages/shared/src/identity.ts` exports branded `PersonId`, `KingdomId`, `CitizenKey`, token/time schemas.
  `packages/shared/src/events.ts:13` exports strict intent/fact constructors, not a raid/travel catalogue.
  Neither these generic helpers nor `KingdomPresenceFrame` establish a person's travel permission.
- `apps/web/src/atlas/index.tsx:57` is a real Solid survey-preview map. `map/view.ts:14` currently exposes
  first-frame, selection, camera and failed-chunk callbacks; it has no completed gate/road/travel producer seam.
  `data/model.ts:8` carries expiring channel names and withheld state. Do not bypass that visibility policy.
- `work/lanes/atlas/PRD.md`: A01/A02 are complete; A07 owns durable roads; A12 owns entry/return; A13 owns the
  Atlas Raid Gate finder and map journey; A14 owns Atlas director hooks. This specification changes none of their
  ownership. Main coordinates the narrow ports described below and updates that lane's handoff if necessary.
- `apps/web/src/kingdom/scene.ts:27` accepts simulated/Herald presence and supplies a real renderer, layout,
  camera controls and sound. It does not yet expose an authenticated gate/travel host. Main owns that extension.
  `packages/content/src/civic/index.ts` supplies existing gateway, bridge, banner and crest props; the ceremonial
  gateway is permanently open (`civic/README.md`, “Ceremonial gateway”). Do not pretend its mesh has moving doors.
- `apps/web/src/main.tsx:13` owns lazy route registration. `apps/api/src` and `apps/realm/src` do not exist in
  this checkout. There is no implemented outbound action authority, authenticated travel reservation, destination
  ban check, durable passport or item transfer service to quietly reuse.

## Rules

1. **R1 — The monarch opens the gate.** A local crown, a foreign crown, moderator status or a URL never grants
   permission. The action authority verifies current session, source broadcaster identity, live state, consent,
   preview expiry and destination policy at execution. Only the source monarch can preview/start/cancel a raid.
   Opening the map is free of side effects. Ignoring the invitation leaves every walker where they were.
2. **R2 — One deliberate press after a preview.** Opening the gate first opens Atlas gate mode at the source
   kingdom. Its finder lists existing live road neighbours, then live same/nearby realms, then search; smaller
   live channels come first within each group, with no paid ordering. The preview identifies the target, waiting
   land/founded state, actual opted-in walker count and Twitch's countdown. It must not describe all chatters as
   marching. Start submits the authority-issued preview token once. A changed target expires the old preview.
   Disabled/revoked/unknown authorization has an explained state and reconnect action, never a fake royal button.
3. **R3 — A requested raid has not landed.** Accepted start means Twitch has a pending countdown. Gather at the
   gate while pending. Start the departure/journey only from an authority-correlated `channel.raid` observation;
   a timer, HTTP 200, observed offline state or a random same-pair historical raid is insufficient. Duplicate clicks,
   lost responses and tab reloads resume the same request ID through the action authority. Unknown outcomes say
   “Checking whether the raid began” and reconcile; never retry the write automatically. Confirmed cancellation
   turns the party back. Unobserved cancellation/expiry stays unknown until resolved, with a safe way to stay.
4. **R4 — Participation is voluntary.** Each signed-in walker explicitly joins or leaves this party; joining is
   scoped to this source, destination and request, and ends on cancel/expiry. No chatters list or raid viewer count
   supplies people. A source citizen chatting in the destination within 10 minutes may qualify through the
   authoritative evidence rule in R8; that is distinct from opting a browser into movement. A chat participant can
   enjoy the whole moment without opening a second screen. Never auto-open Twitch, replace its player, or force
   a browser to navigate to another channel. Offer a normal Watch on Twitch link where useful.
5. **R5 — Reserve, prepare, commit, acknowledge.** For every walker who chooses travel, ask the authorized
   coordinator to reserve the destination and check current access/ban/capacity. Retain the source until the
   destination world is ready and commit is acknowledged. This lane's server coordinator owns reservation,
   commit/reconcile and rollback logic against main's room-membership transport and durable repository.
   Cancel/revocation/timeout/disconnect before commit releases the reservation and restores
   source control. An ambiguous commit reconciles its ticket; it cannot join two active walking sessions or issue
   a second transfer. Late completions from a cancelled generation are ignored and released. Browser Back during
   travel cancels safely; it is not an arrival. A full destination offers wait/stay, without money or rank priority.
6. **R6 — One journey across the two hosts.** Request Atlas's normal rise from A (about 0.8 s), road journey
   (1.5–3 s) and matching drawing-to-ready-world reveal. The 12–30 s public caravan remains Atlas's observed-raid
   presentation; a personal loading journey does not change its event clock. A marching walker attaches to that
   public raid ID, not a second fake caravan. If loading takes longer, the drawing holds with actual readiness
   steps and a calm overrun state; arrival waits for the receipt, never for animation duration. Reduced motion
   gives a short ink/drawing dissolve and the same authoritative stages. Arrival role comes from destination
   authority: monarch only at home, citizen at their own door, otherwise visitor at the gate. Foreign rank/sub
   standing grants no power and no extra brightness; visiting does not create a fourth home.
7. **R7 — Waiting land is a real destination with no fabricated world.** Any permitted live Twitch channel may
   be selected even if it has no founded kingdom. Atlas resolves its existing holding, provisional pencil flag,
   or known-map edge. Preserve real channel ID/name/arms under visibility rules. The raid still happens on Twitch,
   and the road observation goes to Atlas. From Edition I its land-by-raid ledger grants the stable pencilled
   hamlet slot; before then obey the current edition's preview retention rules, never claim permanent official
   land. No voxel room, invented ruler, synthetic residents or “arrived in the kingdom” receipt is manufactured.
   Show waiting land with Watch and the authorized settler action if available. Founding remains live Genesis.
8. **R8 — A passport is witnessed history.** Submit evidence to the passport authority only after successful
   committed arrival for an ordinary visit, or for an observed raid plus a committed walker march/source-citizen
   identity and destination-chat evidence within 10 minutes. The authority verifies it and returns the stamp.
   An unsigned welcome URL, API request, participant count or public `AtlasRaid` alone never awards a stamp.
   Ordinary visits stamp the visited kingdom; raid rides are separately traceable by their verified raid identity.
   Replayed/recovered facts can repair missing history once through authority, without replaying a welcome show.
   Stamps are public only on the citizen card, with “Hide my travels”; changing the switch requires acknowledgment
   and invalidates public card projections. The Atlas never gets per-person stamps, journeys, homes or positions.
   This lane exports a passport section for the card host; it does not take ownership of citizen cards.
9. **R9 — Guests bring kindness, never damage.** Give a voluntary, authority-backed gift offer/accept/refuse
   flow. A gift is an existing approved transferable item or an authority-issued earned welcome offering; never
   an invented Forge success or client-minted reward. Display maker, home kingdom and giver from the item receipt.
   Reject bound things: light, homes/lots, money, rank/tenure/sub pieces, Bits products, keepsakes and companions.
   A visitor may take a permitted gift home through a recorded person-to-person transfer; their existing source
   possessions are not silently copied abroad. No automatic inventory removal on a failed handoff, no currency,
   prices, coercive exchange, local gifter rank or power. Cross-kingdom swaps belong to the life/trade authority,
   not a second trading engine here. Welcomes, gifts, visits and any optional contest can never damage or take
   anyone's home, alter standing or enlist a kingdom without consent.
10. **R10 — Earned rewards cannot be farmed.** This lane's server application computes reward eligibility from
    authenticated evidence and transactional durable counters: fewer than 3 Twitch
    viewers earns no raid reward, and at most two raids per authoritative day are rewarded per person. History
    and the road still remember smaller legitimate visits; a reward cap does not erase them. Gifts someone freely
    gives are item transfers, not an uncapped automatic raid reward. Retry/dedupe/cancel cannot multiply stamps,
    welcome rewards or transfers. There is no Bits/sub tier/raid-size bonus to loyalty, score or placement.
11. **R11 — The road survives the show.** Pass only validated `AtlasRaid` observations to the existing Atlas
    host, preserving ID, occurrence versus receipt times, source, delivery and evidence. Its durable ledger owns
    dedupe, reconciliation, thickness and last-used time; this lane does not write another road store. Roads ink
    on the first witnessed raid, thicken with later verified raids, fade to dotted after an unused season and
    never disappear in a founded edition. Cross-language journeys use sea lanes. Same-pair legacy aggregates do
    not become fresh events. Atlas A07/A08 owns chronology/raid-train detection; gate receives a reference, never
    renames or invents a chain. Gifts/cheers alone do not create raid roads. This lane's integration test proves
    reload retains the actual Atlas road and its provenance after the party has cleared.
12. **R12 — Coming home is another safe journey.** Offer Return to source after arrival, clearly voluntary.
    Revalidate source access and capacity and travel through the same coordinator; expired source retention does
    not erase the return destination or create success. M/map/Back restore the Atlas camera/selection through its
    host; Atlas retains the world for 60 s for quick return. A source snapshot in memory grants no active room
    membership. Chat/panel presence continues under its own leases while browsing; travel never toggles it as an
    economy shortcut. Disconnect/reconnect restores the actual last committed location and outstanding receipt.
13. **R13 — The gate belongs to this kingdom.** Use the host's actual gate/bridge anchors, safe route and existing
    real avatar views. The little gathering reads at five viewers; a capital uses bounded representatives and
    aggregate movement, not thousands of new meshes. Do not instantiate fake people from raid counts. Existing
    civic gateway is open: use banners, a gathered party and the signal to set out; animate doors only if a future
    host supplies genuine articulated doors. Never block public egress or modify lots/collision to make a shot.
    Sound comes through the host's mix, with one physical gate/party/return cue per current event, no replayed
    backlog. Twitch-moments owns incoming wagons/tribute/pennants and its welcome cue; do not double them.
14. **R14 — Truth and failure are visible.** Design idle, no live targets, preview, denied, expired, gathering,
    pending, unknown, cancelled, reserving, loading/overrun, full, destination denied, arrived, waiting land,
    returning and reconnect states. Keep identity/private errors out of stream projections. No tokens, private
    rider list or recipient inventory enters Atlas/OBS caches, URLs or logs. Synthetic runs have SIMULATED on every
    visible surface, not only in developer controls. Replay is dated. Missing live authority disables the relevant
    action honestly; a labelled bench can exercise it, but cannot satisfy real integration acceptance.

## Contracts

Use `AtlasRaid`, `AtlasEvidence`, `AtlasChannel`, `AtlasSettler`, `PersonId`, `KingdomId`, `CitizenKey` and their
existing validators from `@chatdom/shared`. No lane edits to shared. No imports from Atlas internal model/view
classes as a substitute for a consumer contract. No browser Twitch fetch or token access. Server handlers call
only the injected authorized Twitch transport; this lane does not implement OAuth/token storage or raw Helix.

### Owned local contract and application boundary

The first consumer owns browser-safe schemas/types in `apps/api/src/raid-gate/contracts.ts`; server-only ports
and handlers live beside it. The web and realm folders import that narrow contract module, which imports only
shared/Zod and never server code. This is a proposed **feature-local API** for main's approval, not a claim a
shared protocol or existing backend already exists. Main freezes any eventual shared/network promotion.
Commands have strict validators, bounded arrays/text and no actor/role/session setter. Main's HTTP/SSE adapter
converts authenticated requests into the following application context; it never reads these fields from JSON.

```ts
type GatePrincipal = Readonly<{
  personId: PersonId; sessionId: string;
  sourceKingdomId: KingdomId; sourceRole: 'monarch' | 'citizen' | 'guest';
}>;
type GateContext = Readonly<{ principal: GatePrincipal; now: number; signal: AbortSignal }>;
type GateTarget = Readonly<{
  kingdomId: KingdomId; founded: boolean; live: boolean;
  classification: 'unknown' | 'general' | 'mature' | 'excluded';
}>;
type GatePreview = Readonly<{
  token: string; requestId: string; from: KingdomId; to: KingdomId;
  expiresAt: number; optedIn: number; target: GateTarget;
}>;
type GateActionState = 'prepared' | 'dispatching' | 'pending' | 'landed'
  | 'cancelled' | 'rejected' | 'unknown';
type GateActionView = Readonly<{
  requestId: string; revision: number; from: KingdomId; to: KingdomId;
  state: GateActionState; observedAt: number; raid: AtlasRaid | null;
}>;
type PartyView = Readonly<{
  requestId: string; joined: boolean; optedIn: number; expiresAt: number;
}>;
type TravelReason =
  | { kind: 'visit' }
  | { kind: 'raid'; requestId: string; raidId: string }
  | { kind: 'return'; arrivalId: string };
type TravelState = 'reserved' | 'preparing' | 'ready' | 'committing'
  | 'committed' | 'cancelled' | 'expired' | 'denied' | 'unknown';
type TravelView = Readonly<{
  ticket: string; revision: number; from: KingdomId; to: KingdomId;
  state: TravelState; leaseUntil: number; role: 'monarch' | 'citizen' | 'visitor' | null;
  arrivalId: string | null;
}>;
type PassportStamp = Readonly<{
  id: string; kingdomId: KingdomId; occurredAt: number;
  kind: 'visit' | 'raid'; raidId: string | null;
}>;
type PassportView = Readonly<{
  hidden: boolean; revision: number; stamps: readonly PassportStamp[]; nextCursor: string | null;
}>;
type VisitorGiftView = Readonly<{
  offerId: string; itemId: string; from: PersonId; to: PersonId;
  originKingdomId: KingdomId; makerId: PersonId; revision: number;
  state: 'offered' | 'accepted' | 'refused' | 'expired' | 'rejected' | 'unknown';
}>;
type GateCommand =
  | { op: 'preview'; requestId: string; target: KingdomId }
  | { op: 'start'; requestId: string; previewToken: string }
  | { op: 'cancel' | 'reconcile' | 'read-action' | 'join' | 'leave'; requestId: string }
  | { op: 'reserve'; requestId: string; target: KingdomId; reason: TravelReason }
  | { op: 'prepare' | 'commit' | 'cancel-travel' | 'reconcile-travel'; ticket: string }
  | { op: 'passport'; cursor: string | null }
  | { op: 'hide-travels'; requestId: string; hidden: boolean }
  | { op: 'offer-gift'; requestId: string; itemId: string; recipient: PersonId; arrivalId: string }
  | { op: 'accept-gift' | 'refuse-gift'; requestId: string; offerId: string };
type GateReply =
  | { kind: 'preview'; value: GatePreview }
  | { kind: 'action'; value: GateActionView }
  | { kind: 'party'; value: PartyView }
  | { kind: 'travel'; value: TravelView }
  | { kind: 'passport'; value: PassportView }
  | { kind: 'gift'; value: VisitorGiftView }
  | { kind: 'denied'; code: 'unauthorized' | 'stale' | 'unavailable' | 'full' | 'invalid' };
```

All string IDs/tokens/cursors above are locally validated opaque bounded tokens, not permission by possession;
each lookup checks the authenticated principal and expected kingdom. Numeric fields use existing shared safe
integer/time validation. Runtime unions enforce landed iff matching raid, committed iff arrival/role, positive
revision, and state-specific expiry. A public passport with hidden=true has empty stamps/null cursor. Page size
is 50 with a cap of 200 returned records per session view; no whole-kingdom party/person export.

`createRaidGateApplication(deps)` in `apps/api/src/raid-gate/index.ts` exports
`handle(context: GateContext, command: unknown): Promise<GateReply>`,
`ingestRaid(observation: TrustedRaidObservation)`, `ingestChat(evidence: DestinationChatEvidence)` and
`recover(now: number, limit: number)`. The latter ingestion/recovery methods are server-only and never exposed
as viewer commands. `TrustedRaidObservation` is `{raid: AtlasRaid, upstreamEventId: string | null,
actionRequestId: string | null, receivedAt: number}` supplied only by main's verified ingress adapter.
`DestinationChatEvidence` is `{personId: PersonId, kingdomId: KingdomId, eventId: string, occurredAt: number}`
from verified transient ingest; it contains no chat body. Source citizenship at the raid time is checked through
the repository, not asserted by the viewer. A null/ambiguous correlation cannot mark an outbound request landed.

The lane owns the following concrete logic and its server-only types. Main supplies mechanical I/O adapters,
not a replacement feature service:

| Owned application/type | What this lane implements | Main's injected infrastructure port |
|---|---|---|
| `RaidActionRecord`, `PartyMemberRecord`, `RaidGateApplication` | Persist preview/actor/pair/expiry; claim start once; pending/unknown/cancel/landed transitions; verified event correlation; monotonic revisions; party membership and public-safe count. Dispatch is an outbox intent so a process crash cannot silently repeat a possibly accepted raid. | `RaidGateRepository.transaction(fn)` for atomic/CAS record writes and outbox; `AuthorizedRaidTransport.start/cancel/reconcile` using authenticated source authorization; `GatePolicy.readTarget/checkPrincipal` for current live/classification/grant policy. |
| `TravelRecord`, `ArrivalRecord`, `RaidTravelCoordinator` in `apps/realm/src/raid-gate/**` | Session-bound leased reservation; prepare/readiness, single commit generation, acknowledgment/reconciliation and rollback; access recheck, return-to-source and recovery; private immutable arrival evidence. The coordinator owns the protocol, not just a pane around it. | The same durable repository; `RealmTravelTransport.checkAdmission/reserve/prepare/commit/reconcile/release`, with idempotent ticket keys and actual room readiness/membership outcomes. Main binds existing/future room primitives and destination moderation; no second room server here. |
| `PassportRecord`, `RaidRewardRecord`, `GuestHistoryApplication` | Verify committed arrival/march or source-citizen/destination-chat proof; award once; count daily rewarded raids transactionally; persist hide preference and emit invalidation on change; project public/private pages. Automatic awards happen from trusted committed evidence, never a viewer-provided stamp command. | Repository evidence/citizenship reads and transactional history/reward writes; `ProjectionInvalidator.invalidateCitizenCard(personId, revision)` implemented by main's card/cache adapter. |
| `VisitorGiftRecord`, `ItemTransferRecord`, `VisitorGiftApplication` | Offer expiry/recipient/arrival checks; allowed-kind and provenance rules; accept/refuse/idempotent reconciliation; reserve item revision and atomically transfer once with giver/origin lineage; no duplication or loss across crash. | `ItemTransferRepository.transaction(fn)` exposes actual approved item/owner/revision/policy reads, conditional ownership update, transfer-lineage append and gift-receipt write in one transaction. Main binds authoritative item storage; no copied inventory. |

Repository ports are narrow persistence primitives. Define their exact local transaction interface alongside the
records in `repository.ts`: get/put action with expected revision; get/put party member; get/put travel and arrival;
find pending records by bounded cursor; get/append passport evidence and reward claim with unique keys; read/set
passport privacy; get/put gift offer; append/claim/complete outbox. Every mutation returns the stored receipt or
revision conflict. Record schemas retain owner/session/source/target, idempotency key, revision, provenance,
lease and state-specific evidence; they do not retain OAuth credentials or chat text. Preview token hashes
and opaque reservation IDs are permitted. Main reviews these local record
schemas with the first consumer before writing a database adapter. Use unique keys for request/person,
arrival/person, raid/person/reward-day and offer/item-revision; retries return existing receipts.

`AuthorizedRaidTransport` returns `{kind:'accepted',createdAt:number}`, `{kind:'rejected',code:string}` or
`{kind:'unknown'}`; accepted never means landed. `RealmTravelTransport` returns an explicit pending/acknowledged/
denied/unknown outcome for each ticket operation, including the actual destination role on acknowledgment.
A timeout after possible dispatch is unknown. Recover first reconciles external state, then retries only a
provably undispatched outbox item. Source release occurs only after the destination commit acknowledgment;
an uncertain commit fences both further movement and duplicate dispatch until reconciled. No distributed
transaction is pretended across Twitch/rooms and the repository. The room transport must honor a per-person
membership fencing generation or an atomic move: retaining the source for rollback does not leave two active
walking leases. The coordinator increments/checks the generation in its durable record before committing.
All server time comes from main's clock.

`createRaidTravelCoordinator(deps)` exports `reserve(context, requestId, target, reason)`,
`prepare(context, ticket)`, `commit(context, ticket)`, `cancel(context, ticket)`,
`reconcile(context, ticket)` and `recover(now, limit)`, returning `Promise<TravelView>` for user operations.
The API application delegates travel commands here. `GuestHistoryApplication` and `VisitorGiftApplication`
are internal application modules behind `handle`, not separate network services or extra public routers.

### Browser and Atlas composition

`apps/web/src/raid-gate/ports.ts` defines `RaidGateApi.request(command, signal)` and
`subscribe(requestId, onReply, signal)` using the safe contract above. Main supplies authenticated transport;
the lane implements the controller, projections and service-backed interaction. Private server records never
cross this API. The following presentation ports remain separate:

| Local port | Required behavior; owner |
|---|---|
| `AtlasGateHost` | Open/close gate finder; resolve founded/waiting/edge target; preserve/restore camera/selection; present rise/road/drawing; attach to public raid ID; submit validated observation to existing road ingestion; report receipt. Atlas owns implementation and road/holding storage. |
| `GateWorldHost` | Actual gate/bridge/gathering/return anchors, safe routes and consenting avatar views; framing, actual readiness, host audio and reduced-motion/stream mode. Main binds kingdom/director primitives; this lane owns the gate presentation adapter, never renderer/global loop/light field. |

Export `createRaidGateController(ports)` with subscribe/snapshot/open/preview/start/cancel/join/leave/travel/return/
reconcile/dispose operations, `RaidGatePane`, `GuestArrivalPane`, `PassportSection` and `VisitorGiftPane` from
`apps/web/src/raid-gate/index.ts`. Narrow the command signatures to these existing IDs and opaque validated tokens;
do not expose actor-ID setters. Each async operation accepts an abort signal and ignores obsolete completions.
Controller transitions are deterministic under an injected clock and observations; retries are authority requests,
not client fact creation. UI components consume the controller/projections and do not call services themselves.

The stream projection is separate: source/target public crest references, safe party state/count, public raid ID,
evidence and stage only. Passport/items/private denial details stay out. `onObservedRaid(raid: AtlasRaid)` is public
observation input, never a stamp/transfer/role-grant command. Twitch-moments consumes the same incoming observation
independently for its caravan; no circular import or second incoming show.

**Main-owned activation prerequisites:** approve these feature-local API/repository/transport shapes; bind
authenticated principals and HTTP/event routing, durable storage transactions, authorized Twitch transport and
room membership primitives, item storage and card invalidation; route `/-/raid-gate` and kingdom gate host;
Atlas A07/A12/A13 road/entry/gate implementation. This lane supplies all raid/travel/passport/gift application
handlers and their recovery logic. A future shared/network freeze is main's work before its first transport consumer.
Worker reports the concrete missing method/evidence as `needs:` and continues unblocked UI/controller work. The lane
is not marked complete while any required real binding is missing, and never ships a fixture adapter by default.

## Scope

Write only `apps/web/src/raid-gate/**` (including owned styles, tests, bench, capture script and integration README),
`apps/api/src/raid-gate/**`, `apps/realm/src/raid-gate/**`,
`work/specs/23-raid-gate.md`, `work/lanes/raid-gate/{PRD.md,progress.txt}`. Everything else is read-only.
No Atlas/surveyor edits, shared contracts, main scene/router, other API/realm folders, Herald, Twitch-moments,
citizen cards, world/item storage implementations, root manifests/scripts or general audio/content edits. Main binds exported modules and
Atlas's owner implements its side of the approved port. Submit exact integration call sites in the README.
You are not alone: preserve others' edits and coordinate through main. Sub-agents never run git.

## Acceptance

Run from the repo root:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run apps/api/src/raid-gate apps/realm/src/raid-gate apps/web/src/raid-gate
pnpm build
node apps/web/src/raid-gate/capture.mjs
pnpm verify
```

Worker creates the scoped capture script. Use the existing repo capture lock/protocol, one Chromium at a time;
main has registered the optional /-/raid-gate entry. An owned bench.html entry may also run without root edits. Preview runs on 5190; main owns start/stop and any service ports.
No source collector/process/server configuration changes. `pnpm verify` is the integration gate after composition,
not a substitute for the specific behaviors below.

- Build one meaningful service/transport integration test at
  `apps/api/src/raid-gate/application.integration.test.ts`: send strict commands through the real application
  handler with a server-supplied principal, transactional test repository and controlled authorized transports.
  Preview/join/start, lose the start response, restart the application, reconcile without a second Twitch write,
  deliver the verified raid twice, reserve/prepare/commit, lose the destination acknowledgment and recover.
  Assert exactly one raid write, one committed walking location, one arrival/stamp/reward claim and no source
  release before destination acknowledgment. Finish with an accepted gift retry and hidden-passport projection;
  assert one ownership transfer, retained provenance and no public travel data after hiding. This exercises
  actual owned server logic, not a duplicate UI state simulator. Label its transport observations SIMULATED.
- Add focused guard cases only where they protect distinct invariants: foreign/non-monarch command rejected
  before dispatch; mismatched/ambiguous raid cannot land; cancellation releases a known uncommitted lease;
  destination denial preserves source; false/late rider proof cannot stamp; bound/paid item cannot transfer;
  fewer-than-3 and daily reward cap cannot be bypassed. Avoid a combinatorial suite for every visual state.
- In the mounted kingdom/Atlas flow demonstrate departure, founded arrival, return and a road retained after
  reload through Atlas's actual ledger, plus the waiting-land path without a fabricated room. Reuse Atlas's
  own seasonal/edition/visibility invariants instead of retesting its whole implementation. Do not found an
  edition, mint land or call a real raid as a test side effect. The remaining UI states are demonstrated in
  the concise capture sheets below, not an invisible exhaustive test matrix.
- Capture and open with `view_image`: `shots/raid-gate/gate-desktop.png` at 1440×900,
  `gate-phone.png` at 390×844, `departure-stream.png` at 1920×1080; founded arrival, waiting land, return, unknown,
  denial/full, overrun and reduced-motion sheets at the applicable sizes. Check five-person and 50,000-person
  contexts, with actual consenting avatar representatives, legible crests, clear action focus and no clipped phone
  sheet. All controlled fixtures remain visibly SIMULATED. Inspect motion and listen to the host-mixed cues;
  report listening or real-GPU limitations plainly.
- Real integration acceptance requires these owned server handlers, main's authenticated storage/transport
  bindings and Atlas module working
  together. A live Twitch write is optional evidence only when explicitly scheduled under the development
  allowlist: it goes to `tobi4s_`, through the raid application and main's authorized transport, with the current
  monarch's preview/gesture.
  Never target a stranger to prove an endpoint. Without an authorized real write, distinguish official-protocol
  test evidence from live observed ingest; never claim a simulated raid was real.

## Quality bar

The gate is a place people gather, not a raid settings dashboard. Brass fittings, a crest seal, timber shutters on
the UI and a handful of warm figures make the invitation readable at stream distance. The kingdom remains cool
and inhabited behind it; the map becomes a day drawing with restrained ink roads, never a glowing night network.
The observed cause and resulting journey read without a developer explaining them. Uncertainty has calm language
and a useful action. A cancelled march settles back into ordinary life; it does not punish anyone.

Use existing authored civic props and the host's actual people. Keep added work bounded: no additional renderer,
global animation loop or light; at most 32 transient gate ornaments, 12 extra draws desktop/stream and 8 phone;
party representations use the host's crowd LOD budget. Do not allocate per-person sockets/meshes from a raid
count. Local cues reuse the audio host and skip expired attacks after seek/reconnect. Existing presence windows,
camera ownership, sound mute and source visibility remain authoritative. No generated art or outside assets are
needed; any proposed sample must be permissively licensed with a root-ready credit for main.

## References

- `work/references/atlas-cartography.md`: already studied MapLibre/OpenLayers interruptible flights, pointer
  anchoring and two-map-device craft; reuse Atlas's implementation rather than adding another map engine. Its
  Surveyor findings are why a legacy SSE key cannot prove a distinct person's ride or a resumable raid.
- `work/references/herald-presence.md`: separate transport identity/event time, represent gaps honestly, preserve
  transient chat privacy and source grants. No new token/client implementation belongs in this lane.
- [Twitch Start/Cancel Raid reference](https://dev.twitch.tv/docs/api/reference/#start-a-raid), checked
  2026-10-30: broadcaster user authorization and source identity; response establishes pending request, while
  EventSub establishes occurrence. Its mature flag is deprecated, so it is no destination-safety signal.
- [Twitch raid guide](https://dev.twitch.tv/docs/api/raids/) and
  [channel.raid catalogue](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelraid), checked
  2026-10-30: countdown/cancellation behavior and public source/target/count payload, with no rider roster.
  These primary protocol sources and the already-studied cartography note cover this adapter work; no new
  third-party engine or copied source is proposed.

## Not now

No duplicate Atlas, road ledger, map finder, entry renderer or raid-train detector; no direct Twitch writer,
new OAuth flow, kingdom founding, incoming caravan/tribute show, citizen-card ownership, duplicate inventory/world stores,
cross-kingdom swap engine or contest scoring. Those remain their named owners. Their required integration is
part of acceptance, not permission to replace them or defer the gate's full travel/gift/history experience.

## Decisions

- **2026-10-30 — Preserve existing Atlas ownership.** Main explicitly retains A07/A12/A13/A14 in the Atlas lane.
  This lane supplies the kingdom gate and personal travel adapters; main coordinates the `AtlasGateHost` seam.
  The Atlas PRD is read-only here. The map's public caravan is one observed event, never an individual roster.
- **2026-10-30 — The lane owns the feature services.** Main's review expands ownership to
  `apps/api/src/raid-gate/**` and `apps/realm/src/raid-gate/**`: real raid/party, reservation/rollback,
  passport/reward and visitor-gift application handlers, recovery and local records. Main supplies authenticated
  principals/router, durable storage and authorized Twitch/room/item transport adapters, not the feature logic.
  The feature-local API above is proposed for main's approval; shared/network promotion stays main-owned.
  Fixture-only completion fails. One end-to-end application/transport recovery test plus targeted invariants
  is required; an exhaustive invisible matrix is not.
- **2026-10-30 — History survives reward caps.** Fewer than three riders and the daily rewarded-raid cap prevent
  automatic raid reward farming; they do not erase witnessed journeys or honest Atlas roads.
