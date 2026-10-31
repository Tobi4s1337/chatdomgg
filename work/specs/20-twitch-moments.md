# Spec 20: Twitch happens in the kingdom

Status: **frozen 2026-10-30; public fact/feed promoted by main on 2026-10-31 for the realm consumer.**
Vision: `chatdom/ChatDom.md` principles 4–9, 13, 15–18 and §§5–8, 10;
`chatdom/Moments.md` §§6, 7, 12; `chatdom/Twitch.md` §§2–15, 19, 21;
`chatdom/Monarch.md` §§6–7; `chatdom/Artstyle-Soul-Feel.md` §§8–9, 13–14.

## What and why

A sub unfurls a banner on a real person's home. A gift arrives as a parcel with a giver's seal. A raid of three
feels enormous in a hamlet; a capital receives a column of wagons under the visiting banner. Cheers belong to the
whole sky, and a Hype Train becomes a train that wakes an earned dragon. These are things to watch on the stream,
with sound, clear causes and room to breathe. The kingdom also speaks back: the monarch's decree can open a real
Twitch poll, and its result lands on the same parchment in the world. A refused or uncertain action never stages a
successful outcome. This lane builds the complete projection, presentation, director and command adapters for
Twitch both ways, including the real support-event normalizers/projector and royal/action application executors.
Main binds existing root authentication, grants, routers and durable core ports; the lane owns the event mapping,
application rules, Helix endpoint semantics and dispatch/reconciliation logic inside the disjoint modules below.

## Current state

- `packages/shared/src/events.ts:18` supplies the actual `createFactSchema(type, body)` envelope: `version`,
  `kingdomId`, per-kingdom `seq`, `occurredAt`, `receivedAt`, `committedAt`, `origin`, `type`, nullable `actor`,
  `body`, and `cause`. `createIntentSchema` supplies `{id,type,args}`. Neither helper is a catalogue, durable log,
  signature, authorized actor binding or guarantee that Twitch witnessed an outcome.
- `packages/shared/src/presence.ts` supplies `KingdomPresenceFrame`/`PresenceFeed`: public slots and permitted
  names, explicit source/epoch/freshness. `packages/shared/src/citizen-chat.ts` supplies the separate bounded
  `CitizenChatCue` with `parts`, not a top-level text field. Neither contains sub/gift/raid identities or actions.
- `packages/shared/src/atlas-raids.ts` supplies `AtlasRaid`. Its exact fields are `version`, `id`,
  `fromKingdomId`, `toKingdomId`, `viewers`, `observedAt`, nullable `occurredAt`, `evidence`, `delivery`, `source`.
  It has no riders. Legacy Surveyor SSE has receipt time only and is ephemeral, not resumable history.
- Herald's Spec 03 and `work/lanes/herald/PRD.md` own chat/chatters/stream/revocation ingest, its conduit and its
  source API. H01 is merged; remaining work belongs to that lane. No support-event producer or write capability
  currently exists. The new `apps/herald/src/twitch-moments/**` subtree owns those support consumers/normalizers
  through injected authorized subscription transport. Existing H01–H05 auth/conduit/source files stay read-only;
  this lane neither expands runtime grants nor provisions live subscriptions itself.
- Spec 07 / lane `panel-stream` owns `apps/panel/**` and `apps/web/src/stream/**`, including stage/window/strip
  fittings, source labels, safe-area composition and hide/dispose/remount. It does not yet consume a director feed.
- `apps/web/src/kingdom/scene.ts:25` has `CameraName = 'hero' | 'window' | 'citizen'`. Its actual return at the
  end of `createKingdomScene` has layout/debug/sound/build/forge/subject/receiveChat/setHour/setCamera/play/seek/
  capture/dispose. It exposes no arbitrary subject camera, scene root or spectacle attachment. Do not pretend
  `setCamera('gate')`, a cinematic lease, or a native pause API already exists.
- `packages/world/src/settlement/types.ts` supplies `SettlementPlan`, active streets, home slots/positions,
  market and castle. Main owns solid navigation and citizen motion. Spec 16 owns ambient citizen routines.
- Spec 23 / lane `raid-gate` owns kingdom travel/gate commands, private rider receipts, passports and gifts;
  Atlas A07/A12/A13/A14 retains road ledger/rendering, map Gate UI and entry/director hooks. This lane owns the
  incoming caravan spectacle and gate pennant, consuming the same `AtlasRaid` independently. It creates no road.
- Spec 24 / lane `emotes` owns approval, extrusion, caches, emote weather and inline/gesture use. This lane owns
  cheer and Power-up timing using an injected approved-effect lookup; it never approves or fetches emote assets.

## Rules

1. **R1 — Cause first, show second.** Only a validated projection, existing presence/chat cue, `AtlasRaid`, or
   authoritative gameplay result starts an effect. No frame loop, cheer threshold, local timer or successful
   fetch invents a Twitch event, person, subscription, gift recipient, strike, dragon victory or public action.
   Simulation exercises the same parser/controller/view with explicit `simulated` origin and visible SIMULATED
   on every surface. A real connection that fails remains unavailable; it never selects fixtures automatically.
2. **R2 — Public projection, private authority.** Bodies carry only permitted display names, public visual slots
   and public channel IDs. A named source may credit its public act; an anonymous giver/cheerer is “a friend of the
   realm”. Quiet citizens are never identified, tinted or individually thanked. Actor is null on the system
   projection envelope. The lane's authority-side Herald mapper retains real `PersonId`, correlation and recipient bindings
   privately through main's durable record/identity bindings; absence of person IDs in this browser contract never permits name-based identity or client authority.
   Never persist raw Twitch envelopes, chat/notices, private recipients, tokens, payload dumps or identity maps.
3. **R3 — Subs are true, restrained and local to the home.** Tier 1/Prime: home banner and ribbon; tier 2: tier
   cloak; tier 3: elegant animated rainbow cape. Window edge hue is gold/rose/rainbow; warm core, brightness,
   radius and presence remain identical. Unknown/anonymous slots receive no tint. Months add authored ribbons at
   1, 3, 6, 9, 12, 18, 24, 36, 48, 60; a shared resub notice may play a beat, badge reconciliation alone does not.
   A lapse quietly furls/dims known pieces without deleting them, moving a home, announcing a lapse or decreasing
   earned status. The view presents the upstream entitlement; it never awards a cape or changes tenure itself.
4. **R4 — Gifts live in the recipient's home.** A single parcel settles at a supplied real doorstep; a gift group
   is one cart and staggered parcels, not one independent camera cut per sub. Public recipient names come only
   from authorized public notices; never infer a recipient list from an aggregate gift count. Unknown recipients
   remain a bounded anonymous parcel procession with an honest collective caption. A recipient without a mapped
   home is welcomed at the gate pending authority's real settlement; animation cannot allocate a tent or deed.
   Seal wrapping keeps its supplied giver credit; no giver counter, rank, bigger light or personal trophy. The lane
   maps entitlement/wrapping updates through the injected domain record port; main owns the underlying ledger. Anonymous gifts use the shared friend line. Public pay-it-forward
   attribution is permitted only when explicitly projected. Aggregate gifts and recipient notices coalesce under
   one stable group key so correlated inputs never rain the same parcel twice.
5. **R5 — Cheers and Power-ups are shared spectacle.** Default ladder follows the newer `Twitch.md` §6: 1–99
   doorstep spark; 100 street fireworks; 500 castle emote volley; 1,000 low Hearthbeast pass; 5,000 Skyfire aurora
   with procession; 10,000 kingdom kites. The monarch can supply an approved fixed ladder. Cheer never wakes the
   dragon or grants a lasting buyer object. Power-ups: approved emote balloon for 20 s, bounded bubble dressing,
   castle confetti, or an explicitly mapped custom effect. Unknown/unapproved emote remains unavailable for that
   effect: no substitute labelled as the requested emote, external asset fetch or bypass of approval. Original
   kingdom-colour sparks/confetti remain available when an effect does not require an emote. No paid progress,
   light intensity, vote weight or buyer keepsake. Presentation emits only a bounded witnessed-beat handoff for
   Chronicle's stills; it neither records a movie nor creates Twitch clips.
6. **R6 — Trains and the earned dragon run on the actual clock.** Begin dresses the town and starts the lit steam
   train; level progress adds carriages. Level 3 authorizes a dragon request to the real battle port, level 5 the
   elder form, and verified bonus/record/Golden Kappa/treasure/shared flags select authored forms. No inference of
   Mythic/Community status from absent API fields. Hype contributors are the observed named subset, never “all
   contributors”; omitted names read “and others” unless authority supplies a valid aggregate count. A shared
   train has one battle identity and banners from the supplied session; each room renders that same battle.
   The Wyrm Bell requests the same battle for free. Strikes, fighter scaling, 2–4 minute encounter timing,
   retreat/victory, participant trophy/keepsake entitlement and daily caps are authoritative gameplay results.
   This lane implements the train, telegraphs, dragon forms/flight/retreat/victory presentation and strike input
   adapter; it cannot simulate a successful fight when that service is absent. End below level 3 gives closing
   fireworks and a sleeping stir. Pending/unavailable battle leaves the train's true state and clear status.
7. **R7 — Every other meaningful surface lands.** Implement the complete matrix below using supplied facts.
   Follow/return beats may frame an existing tent/home but cannot allocate or relocate it. Goals weave a banner,
   never fill a wonder or award progress. Poll/prediction displays reflect upstream choices/state; world building,
   match result and refunds wait for their respective authorities. Charity coins credit public donors in the
   moment; the lasting rim inscription is charity/date/total, never donors. Clip stills credit the clipper and
   link to Twitch only; no embedded player/rehost or Create Clip. Moderation privately removes/cancels the relevant
   transient actor presentation through main's existing source; no public humiliation beat or inference that a
   clear-user event proves a ban. Presence/sky/beacon remain owned by main's actual reducer/scene, never a duplicate.
8. **R8 — A raid is a visit, not an invented crowd.** Accept only raids targeting the current kingdom; dedupe by
   `id` with its original evidence/time. Compose logarithmically many wagon/banner units: 3 viewers is a small
   treasured welcome; 10,000 is a column passing for up to a minute. Wagons carry no invented avatar or rider
   name. Only main's genuinely present real people appear as citizens/guests. Unknown source kingdom is its real
   public channel land, not a forged founded kingdom. An approved tribute may be shown for the night after the
   Forge authority supplies it; never generate a substitute through the house-part Forge. A dated visitor pennant
   is projected for the gate wall; persistence belongs to authority. Raid-chain carriage banners require an
   explicit observed ordered chain supplied by the travel/Atlas owner; isolated raid records do not prove a chain.
   No caravan-side road ledger, passport stamp, ride claim, gift entitlement, automatic chat write or Start Raid
   call. An authorized raid welcome is issued once by the lane's server crier policy, independently of rendering.
9. **R9 — Director respects streamer and walkers.** Calm holds/drifts; Show cuts on meaningful beats. Window and
   strip use slower close shots and at most a climax name, not illegible wide confetti. Busy suppresses suggestions
   and automatic stage opens, holding calm framing; the actual climax still proceeds on Twitch's clock. A selected
   automatic-open preference gets a five-second cancel window; Show is an explicit host gesture. Never switch OBS
   scenes or open the stage by browser side effect. Ads hold a calm wide shot; crowd vote deadlines freeze only
   when the authoritative game port says so, while Twitch-clock spectacles continue. Preserve host safe rectangles.
   Player/build/Forge/royal camera ownership outranks this director. Every completion/cancel/failure releases the
   camera lease and returns to the actual prior view. A replay at the next break is reconstructed presentation,
   labelled EARLIER TONIGHT and SIMULATED if applicable, about 20 s, with no re-awards, commands or second public
   witnessed-beat emission. Store only bounded approved projection/choreography state; no video capture/export.
10. **R10 — Writes are deliberate, authorized and honest.** Every royal action is an authenticated streamer press
    or an explicitly authorized saved standing permission checked by the lane application executor through the
    authenticated principal/permission port. A browser name, capability hint, UI toggle
    or projection actor never authorizes a write. Preview exact public text/target before the one press. Walker
    chat uses that walker's authenticated account via its own backend port, never bot/broadcaster impersonation.
    Show unavailable/revoked/rate-limited/rejected/unknown states. Disable duplicate press while in flight. A
    timeout after dispatch is unknown and reconciled by authority; never blindly retry a non-idempotent write.
    Provider acceptance is not witnessed publication, battle outcome, VIP grant or raid arrival. A receipt may
    say Twitch accepted the request; only subsequent authoritative evidence animates the outcome. Only the Gate
    owner starts/cancels raids; this adapter delegates it and never installs a second raid writer.
11. **R11 — At both scales, no queues of thanks.** Hamlet: individual named beats with generous holds. Town: cheer
    volleys coalesce every 10 s. Capital: 20 s groups with bounded name ribbon, banners street by street and ward
    parcel waves. Burst merging preserves contributing keys so replay cannot duplicate them. Bound active effects,
    particles, labels, name lengths, geometry pools and pending director requests; no unbounded FIFO, one mesh per
    audience member, or continuously growing replay cache. Admission/overflow metrics are redacted and explicit.
    Derive intensity from thresholds/logarithms with fixed clamps, never expenditure-scaled audience status.
12. **R12 — Sound and cleanup are part of completion.** Brass horn, cloth unfurl, parcel knock/rustle, train pulse,
    firework launch/bloom and dragon cues follow the same authored elapsed-time timeline as visuals. Use the sound
    lane's injected mixer when available and deterministic original procedural fallback behind the same local
    sound port; no new dependency on an uncommitted sound API or silent animation. Muted/hidden/Busy modes obey
    the actual broadcast mix policy. Interruption cancels nodes, including tails, timers, particles and camera
    leases. Dispose/remount starts from fresh state, never replays missed gifts or writes. No downloaded audio or
    generated art dependency; any later source requires verified license/credit through main.

### Required surface matrix

| Cause | Readable on-stream consequence | Reverse command or owned authority seam |
|---|---|---|
| Online/offline; present/chat/follow/return | Existing beacon/windows; brief supplied home/tent frame; witnessed bubbles | Presence/cue producer, settlement and Ballad remain main; no second producer |
| Sub/resub/end/gifts | Banner, ribbon, tier edge, parcel/cart/wave | Entitlement/history mapper and real home anchors |
| Cheer/Power-up | Full threshold ladder, approved balloon/effect/confetti | Approved ladder and emote-effect cache; no new paid privilege |
| Reward redemption | Rain/tree/bell/approved mapped moment; communal scaffold only from actual pool progress | Reward-pack enable + redemption outcome/refund via authenticated backend |
| Hype/free Wyrm Bell | Train, bunting, contributor subset, earned dragon battle stages | Authoritative strike/haul/chant input and battle results; same free/paid caps |
| Goal | Weave/raise banner and dated ribbon | Goal state; never a wonder/progression mutation |
| Poll/decree | Inked proclamation, choices, authoritative winner | Preview/create/end poll; no channel-points extra voting |
| Prediction/match | Tavern odds board, lock, outcome or cancellation | Preview/create/lock/resolve/refund prediction; authority binds real match result |
| Incoming raid/observed chain | Caravan, source colours, dated pennant, approved tribute | `AtlasRaid`; Spec 23 private riders/travel; Atlas roads |
| Shared chat | Session bridge/banners; source crest on authorized public speech | Session owner supplies channels, active bridges and shared battle identity |
| Shoutout given/received | Crossroads signpost / arriving pennant and crier line | Preview and Send Shoutout; persistent signpost authority |
| Ad/category/title | Calm wide/ad-rest state; authored weather/music request; gate proclamation | Main applies allowed weather/sky and game vote-pause policies |
| Mod/VIP | Supplied Knight/Noble ceremony and dress | Explicit VIP action; mods mirror Twitch, never sell/create status |
| Charity | Wishing well/coins and campaign rim at end | Public campaign projections; no donation/payment handling |
| Existing clip | Credited Gallery still and Twitch link | Read-only existing clip projection; never create/rehost a clip |
| Crier/walker text/optional marker | Exact preview, honest dispatch/result state | Announcement, own-account chat, opt-in stream marker |
| Gate out | Destination preview, true accepted/pending/cancelled state | Delegate Spec 23 royal gate port, never duplicate Start Raid |

## Contracts

### Bounded projections, built on the existing envelope

The public body/fact/feed now live in `packages/shared/src/twitch-moments.ts`, exported as
`@chatdom/shared/twitch-moments`. The original web contracts module re-exports them and keeps lane-local
command/application schemas. This promotes the accepted shapes unchanged for the realm's first consumer.
Main owns source authentication/signing, durable storage and root endpoint integration; the lane owns actual
upstream mapping and application/executor semantics.

`TwitchMomentBodySchema` is a strict discriminated union on `kind`. Every variant has `key: TokenSchema`
(stable semantic event/entity key) and `displayUntil: EpochMsSchema` (latest time to start its transient beat).
`TwitchMomentFactSchema = createFactSchema('twitch.moment', TwitchMomentBodySchema)` additionally requires
`actor === null`, `displayUntil >= occurredAt` and `displayUntil <= occurredAt + 300_000`. Expired or recovered
facts may update newer known visual state but never start a historical spectacle. A snapshot restoration has no
public “just happened” beat. Epoch/source reset is transport metadata, not an invented field on the shared envelope.

Use these reusable **local** bounded records:

- `Credit = {displayName: DisplayNameSchema, slot: UIntSchema.max(65534).nullable()} | null`. Null is anonymous;
  never use a name or a null slot as identity. `PublicRecipient = {noticeKey: TokenSchema, credit: Credit}`.
- `Channel = {kingdomId: KingdomIdSchema, displayName: DisplayNameSchema, crestKey: TokenSchema.nullable()}`.
  A crest key references an approved host cache; never a URL or arbitrary SVG.
- `Choice = {id: TokenSchema, title: string[1..80], votes: UIntSchema}`; counts are presentation only.
  `StatePhase = 'begin' | 'progress' | 'end'`; all arrays unique by their explicit IDs/keys.
- Safe public strings are escaped text only. No raw HTML, URLs except HTTPS Twitch links in the clip variant,
  style/code/shader input, JSON plans, private reasons or arbitrary renderer properties.

| `kind` | Exact variant fields in addition to key/displayUntil |
|---|---|
| `follow` | `credit: Credit`, `returning: boolean`, `homeSlot: slot|null`; no tenure or home grant |
| `subscription` | `credit: Credit`, `tier: 'prime'|'1'|'2'|'3'`, `months: UInt.max(1200)`, `active: boolean`, `sharedNotice: boolean`, `founder: boolean` |
| `gifts` | `groupKey: Token`, `giver: Credit`, `tier: '1'|'2'|'3'`, `total: UInt.min(1).max(100000)`, `recipients: PublicRecipient[0..100]`, `forwardedFrom: Credit`; total may exceed disclosed recipients |
| `cheer` | `credit: Credit`, `bits: UInt.min(1).max(100000000)` |
| `power-up` | `credit: Credit`, `effect: 'emote-balloon'|'message-effect'|'celebration'|'custom'`, `emoteId: Token|null`, `mappingKey: Token|null`; emote-balloon requires emoteId, custom requires mappingKey |
| `redemption` | `redemptionKey: Token`, `credit: Credit`, `mappingKey: Token`, `status: 'pending'|'fulfilled'|'cancelled'`; only fulfilled starts an irreversible mapped presentation |
| `hype` | `trainKey: Token`, `phase: StatePhase`, `level: UInt.min(1).max(100000)`, `progress: UInt`, `goal: UInt.min(1)`, `endsAt: EpochMs`, `contributors: Credit[0..32]`, `otherContributors: UInt|null`, `golden: boolean`, `treasure: boolean`, `record: boolean`, `sharedSessionKey: Token|null`; no asserted complete contributor list |
| `battle` | `battleKey: Token`, `source: 'hype'|'wyrm-bell'`, `phase: 'summoning'|'active'|'victory'|'retreat'`, `form: 'young'|'elder'|'10'|'25'|'50'|'100'|'record'|'golden'`, `startsAt: EpochMs`, `endsAt: EpochMs`, `healthPermille: UInt.max(1000)`, `fighters: UInt`, `acceptedStrikes: UInt`, `sharedSessionKey: Token|null`; authority alone selects these fields |
| `goal` | `goalKey: Token`, `phase: StatePhase`, `title: string[1..120]`, `current: UInt`, `target: UInt.min(1)` |
| `poll` | `pollKey: Token`, `phase: StatePhase`, `title: string[1..120]`, `choices: Choice[2..5]`, `endsAt: EpochMs`, `winnerId: Token|null`, `cancelled: boolean`; winner must reference a supplied choice |
| `prediction` | `predictionKey: Token`, `phase: 'begin'|'progress'|'locked'|'resolved'|'cancelled'`, `title: string[1..120]`, `outcomes: Choice[2..10]`, `locksAt: EpochMs`, `winnerId: Token|null`; winner must reference an outcome |
| `shared-chat` | `sessionKey: Token`, `phase: 'begin'|'update'|'end'`, `channels: Channel[1..6]` |
| `shoutout` | `direction: 'given'|'received'`, `channel: Channel`, `text: string[0..240]` |
| `ad` | `endsAt: EpochMs`; current source has no per-viewer ad receipt |
| `channel` | `title: string[0..240]`, `categoryId: Token|null`, `weatherKey: Token|null`, `musicKey: Token|null`; mappings reference host-approved fixed sets |
| `office` | `credit: Credit`, `office: 'moderator'|'vip'`, `active: boolean`; removals have no public spectacle |
| `charity` | `campaignKey: Token`, `phase: StatePhase`, `name: string[1..120]`, `currency: string[3..8]`, `currencyExponent: UInt.max(6)`, `minorUnits: UInt`, `targetMinorUnits: UInt|null`, `donation: {key:Token,credit:Credit,minorUnits:UInt}|null`; integer amount with explicit producer-supplied currency exponent, no floating money calculation |
| `clip-still` | `clipKey: Token`, `title: string[1..140]`, `clipper: string[1..128]`, `twitchUrl: HTTPS clips.twitch.tv or www.twitch.tv/.../clip/...`, `stillKey: Token`; approved host still cache only |

The parser rejects cross-field contradictions, duplicate IDs, impossible times and oversize input. Bounds are
security/resource limits, not a claim of Twitch's exact product caps. The owned Herald module chooses one
authoritative source per event family, correlates gift aggregates/recipient notices, marks resub sharing, redacts
identities and preserves original occurred/observed clocks. Raw provider parsing stays in that server module;
no raw provider notice reaches browser code.

`TwitchMomentFeed` is an **injected** source with a real lane-owned feed/HTTP adapter; main mounts its handler
at an explicitly supplied route and binds source authentication. There is no guessed default live endpoint:

```ts
interface TwitchMomentFeed {
  readonly origin: 'live' | 'simulated';
  subscribe(
    reset: (info: {epoch: string; asOf: number; throughSeq: number;
      current: readonly TwitchMomentFact[]}) => void,
    receive: (epoch: string, fact: TwitchMomentFact) => void,
    unavailable: () => void,
  ): () => void;
}
```

Validate transport metadata using shared Token/EpochMs/UInt schemas and cap current state at 1024 facts; exceeding
that cap is unavailable/partial evidence, never a silently complete snapshot. A production producer can aggregate
current public state to the contracted representation budget; it cannot drop entitlements or identities from its
private ledger. On reset, validate kingdom/origin and `seq <= throughSeq`, replace bounded state, suppress effects,
and set the watermark. Incremental facts require matching epoch, kingdom and expected origin; shared `recovered`
origin is accepted only as non-animating restoration. Facts with `seq <= watermark` cannot replay. Gaps in the
kingdom sequence are allowed because other fact types share it. Out-of-order source delivery requires a new current
reset rather than replaying stale lower sequence values. Unavailable/reset/epoch change cancels transient effects,
private command previews, camera leases and pending name ribbons without deleting known homes or earned pieces.

Existing `KingdomPresenceFrame`, `CitizenChatCue` and `AtlasRaid` enter separate typed methods; never copy chat text
into the moment log or add riders to `AtlasRaid`. Cue lifetime and moderation clearing stay with main's current
chat consumer. A raid's origin comes from its `evidence`, not connection type or viewer count.

### Commands and results

`TwitchActionIntentSchema = createIntentSchema('twitch.action', TwitchActionArgsSchema)` uses strict arguments
with a `kind` discriminator. It is a request, with no actor, OAuth scope, token or success field supplied by the UI.
Main's existing root auth resolves the principal. The lane application executor validates that principal against
kingdom/actor role, current permission, target, preview and private anti-replay/action records on every request.

| `args.kind` | Exact remaining fields |
|---|---|
| `poll-create` | `title: string[1..60]`, `choices: string[1..25][2..5]`, `durationSeconds: UInt.min(15).max(1800)`; unique choices; backend disables extra channel-points voting |
| `poll-end` | `pollKey: Token`, `outcome: 'terminate'|'archive'` |
| `prediction-create` | `title: string[1..45]`, `outcomes: string[1..25][2..10]`, `windowSeconds: UInt.min(30).max(1800)`, `matchKey: Token` |
| `prediction-settle` | `predictionKey: Token`, `matchKey: Token`, `outcome: 'lock'|'cancel'|'resolve'`, `winnerId: Token|null`; winnerId is non-null exactly for resolve; backend verifies actual match outcome |
| `vip-add` | `targetPersonId: PersonIdSchema`; private request, never copied into public projection |
| `announcement` | `message: string[1..500]`, `colour: 'primary'|'blue'|'green'|'orange'|'purple'` |
| `shoutout` | `targetKingdomId: KingdomIdSchema` |
| `reward-pack` | `enabled: boolean`, `packKey: Token`; fixed registered pack, no arbitrary reward API proxy |
| `marker` | `description: string[0..140]`; requires main's actual saved standing permission |
| `walker-chat` | `message: string[1..500]`, `replyTo: Token|null`; caller's own authenticated account only |

A separate `KingdomMomentIntentSchema = createIntentSchema('kingdom.moment', ...)` has args
`{kind:'strike',battleKey:Token}`, `{kind:'haul'}`, or `{kind:'fireworks-chant'}`. It goes to the authoritative
world/gameplay port, never Helix; one authenticated person contributes at the permitted cadence. Free dragon,
fireworks and chat vote/guess fallbacks must exercise the same earned/moment rules. Missing a service disables
its command honestly; it never increments a local tally as a substitute for authoritative acceptance.

`ActionResultSchema` is a strict union, always with matching `intentId: Token`:
`{status:'accepted', receiptKey:Token, acceptedAt:EpochMs, providerId:Token|null}`;
`{status:'rejected', reason:'permission'|'revoked'|'ineligible'|'rate-limit'|'conflict'|'invalid'|'moderation', retryAt:EpochMs|null}`;
`{status:'unavailable'}`; or `{status:'unknown', reconciliationKey:Token}`. Bounded private receipt IDs may remain
in the owner's pending action state; do not export them in public labels, Chronicle beats, captions or analytics.
A failed HTTP connection before dispatch can be unavailable; an ambiguous result after dispatch is unknown.

```ts
interface ActionPort<I> {
  capabilities(): ReadonlyMap<I['args']['kind'],
    {available: boolean; reason: 'ready'|'permission'|'revoked'|'ineligible'|'rate-limit'|'unavailable';
      retryAt: number | null}>;
  submit(intent: I, signal: AbortSignal): Promise<ActionResult>;
  reconcile(reconciliationKey: string, signal: AbortSignal): Promise<ActionResult>;
}
```

Use an appropriate TypeScript generic constraint for `I`; this illustrative signature is not a new shared type.
Backend permission remains authoritative on every submit/reconcile. The lane builds the real executor/handler
and client adapter described below; main supplies authenticated root/Helix/record bindings. Default unbound ports
are unavailable. Explicit fixture transports exercise those same executors/schemas and label results SIMULATED.
No browser persistence of private action arguments, token storage, inferred success or blind retries. Gate
commands use a main-converted facade to Spec 23's local `RaidGateApi.request(command,signal)` and
`subscribe(requestId,onReply,signal)`: preview/open/cancel maps to its preview/start/cancel/reconcile/read-action
commands and prepared/dispatching/pending/landed/cancelled/rejected/unknown states. No second raid schema/writer.

### Real server consumers and application executors owned by this lane

These are **new disjoint modules**, not edits to Herald H01–H05, root auth, root API routes or shared core.
Freeze their precise local TypeScript/Zod ports with their first consumer in TM01/TM04. Implement real provider
semantics behind those ports; the injected transport is a binding seam, not a request for main to write the logic.

`apps/herald/src/twitch-moments/index.ts` exports `createTwitchMomentIngest(options)` with `start`,
`observeChatMetadata`, `reconcile`, `stop`, and a public-current/feed subscriber adapter. It owns:

- A strict server-only `ProviderNotification` parser with delivery ID, actual subscription type/version/condition,
  occurred/received clocks, verified source origin and the exact provider event body. The injected subscription
  transport has already authenticated delivery; the consumer still checks authorized type/version, configured
  broadcaster/reader/moderator condition and payload broadcaster. Unknown/wrong-channel/malformed input never
  reaches the projector. Limit raw body bytes before parsing in its transport wrapper; never log raw input.
- An explicit capability-to-subscription plan: `channel.chat.notification` v1 and metadata tee of already owned
  chat messages for permitted chat notices/badges; `channel.follow` v2; subscription subscribe/end/gift/message v1;
  `channel.bits.use` v1; custom reward redemption add/update v1; Hype begin/progress/end v2; goal begin/progress/end
  v1; poll begin/progress/end v1; prediction begin/progress/lock/end v1; shared-chat begin/update/end v1; shoutout
  create/receive v1; ad-break begin v1; channel update v2; moderator/VIP add/remove v1; charity campaign start/
  progress/stop/donate v1. Only capabilities explicitly supplied as currently authorized may enter the plan.
  Existing online/offline/chat/delete/clear/revoke ownership remains H03: tee its permitted metadata/lifecycle
  observations, never provision a second source or replace its cleanup. Incoming raids consume existing Atlas/Gate
  evidence rather than introduce a second raid observer. Read-only existing clip queries are separately opt-in.
- Actual normalization and private identity mapping for every supported source. `observeChatMetadata` accepts
  only server-side `{deliveryId,kingdomId,personId,displayName,observedAt,subscriberBadgeMonths,subscriberTier,
  origin}` (nullable badge/tier), no message text or archive. Map decimal `PersonId` via the injected canonical
  citizen/home/disclosure port; do not resolve identity by display name. Public chat metadata may update known
  entitlement appearance without staging a shared resub unless a genuine shared notice exists.
- Exactly one selected canonical event family source. Structured subscription events and chat-notification
  fallback never emit two celebrations for the same act. Gift grouping uses an actual provider community gift
  key when present. Without a reliable shared key, structured aggregate gifts produce a collective wave and
  structured recipient updates affect entitlement only; never guess correlations from time, count or giver name.
  Tier-1 fallback supports only facts that its actual notice/badge carries. Source changes produce a non-animating
  reset. Anonymous gifts/cheers stay anonymous even if another private record could identify the payer.
- Transactional duplicate claim, entitlement/wrapping domain updates, current-state reduction and public-fact
  append through the injected records/core port. Persist only minimal provider IDs, private actor bindings and
  required domain state, never raw messages/notices/payloads. Correct reordered begin/progress/end by provider
  entity/time/state, not receipt arrival; a delayed begin cannot resurrect a completed poll/train/campaign.
- Capability loss immediately stops affected consumers, cancels pending output and exposes unavailable state.
  Use bounded reconciliation reads for currently observable subscriptions, polls, predictions, rewards, Hype,
  goals/shared session/channel/charity/VIPs where authorized. Preserve partial/unknown coverage, original clocks
  and historical recovery origin. A failed/partial read is never an empty list, lapse, cancelled prediction or
  historical celebration. No gap reconstruction invents people, contributions, recipients or outcomes.

The local `AuthorizedSubscriptionTransport.subscribe(plan, receive, unavailable, signal)` owns delivery wiring,
not grants. A plan contains exact declared type/version/conditions and a capability key. Main binds its existing
verified grant/transport system; unbound/unauthorized entries are unavailable. The lane never reads OAuth secrets,
adds runtime grants, edits H01 capability literals or provisions live subscriptions. Its normalizer/projector and
subscription plan are fully executable against the same injected transport in local tests and real bindings.

The injected `MomentRecordPort.transact(kingdomId, work)` is serializable and durable under main's core adapter.
The transaction exposes lane-owned namespaced `get(key)`, `put(key,value)`, `claim(key)` and `appendFact(body,
clocks,cause,origin)`. Values are validated against strict server-only domain record schemas; keys cannot escape
the `twitch-moments` namespace. `claim` and domain updates plus fact append commit atomically. Core assigns the
actual per-kingdom seq/envelope; the lane does not create a tab-owned log. Main supplies engine/transaction/core
bindings; the lane implements domain repositories/reducers and all record transitions, including gift dedupe,
sub state, provider action receipts and recovery. A failed transaction publishes nothing and is not acknowledged.

`apps/api/src/twitch-moments/index.ts` exports `createTwitchMomentApplication(options)` and fetch-compatible
`createTwitchMomentHandler(application)`. The handler implements capabilities, preview, submit, reconcile and
public-current/stream responses using the contracts above. Main mounts it at a configured route; the lane owns
request parsing, bounded JSON/SSE output, backpressure/coalescing and service/error semantics. API mutations obtain
principal and CSRF/session verification from injected `principalFor(request)`; no request body carries authority.
The application accepts the already authenticated principal and independently checks role, kingdom, current grant,
preview expiry/body digest, target, standing permission, match binding and per-action cooldown before dispatch.
A walker can send only as their own principal; monarch-only operations compare the real broadcaster identity.

The lane implements the exact endpoint transformations through an injected typed `AuthorizedHelixTransport`:

| Local action | Helix operation and required executor behavior |
|---|---|
| poll-create/end | POST/PATCH `/helix/polls`; correct broadcaster token, choices/duration, disable extra points voting; end uses provider ID and documented status |
| prediction-create/settle | POST/PATCH `/helix/predictions`; store provider IDs/outcome mappings; lock/cancel/resolve only the bound match and real result; cancellation refunds via Twitch status, never a local payout |
| vip-add | POST `/helix/channels/vips`; authenticated monarch + target ID; handle slot/full/ineligible/mod conflicts without success ceremony |
| announcement | POST `/helix/chat/announcements`; correct broadcaster/moderator credential context, exact previewed text/colour; source-only shared-chat behavior follows actual token support |
| shoutout | POST `/helix/chat/shoutouts`; proper broadcaster/moderator target IDs, live/eligibility and local/provider cooldown handling |
| reward-pack | GET/POST/PATCH app-owned `/helix/channel_points/custom_rewards`; fixed registered definitions, persist owned reward IDs, enable/disable only those; checkpoint partial pack progress |
| redemption resolution | PATCH `/helix/channel_points/custom_rewards/redemptions`; only owned reward/provider IDs after authoritative fulfilled/cancelled result, never pre-fulfil on animation |
| marker | POST `/helix/streams/markers`; real enabled standing permission/live availability, exact description |
| walker-chat | POST `/helix/chat/messages`; actual walker sender context and reply ID; parse `is_sent`/`drop_reason`, since HTTP 200 alone is not sent |

Token type/scope/identity requirements come from the official reference and current authorized transport context,
not hard-coded assumptions from monetization tier. The transport supplies credential-bound requests, provider
status/headers/data, dispatch certainty and cancellation; the application never receives tokens. It still validates
response bodies and actual provider IDs, distinguishes 204 from JSON success, maps 400/401/403/409/422/425/429/
5xx safely and honors rate headers/cooldowns. A 401 may trigger the transport's bounded refresh only when that
transport can establish whether a mutation was dispatched; there is no general mutation retry wrapper.

The application owns record-backed action lifecycle `prepared → dispatching → accepted|rejected|unknown`, plus
unavailable-before-dispatch. Atomically claim `(kingdom,principal,intentId)` and the previewed body digest before
any call; a duplicate returns the prior result, while reused ID with different args is rejected. Concurrent
submits cannot double-dispatch. Save dispatching before leaving the transaction, perform the provider call outside
it, then commit its parsed result. A crash/abort/timeout after dispatch may have succeeded: persist unknown and
never resend automatically. Retain only minimal private action metadata/digests/provider IDs, no walker chat text
or notice archive. Reconciliation queries documented readable provider state and correlates exact IDs where
available; it never guesses a newly created poll/reward by title or marks a lost announcement/chat send successful
because an HTTP read worked. Ambiguous/no-read-endpoint cases remain unknown, expose the real uncertainty and
cannot retry the same action ID. A recovered desired state may update a non-animating projection without claiming
this request caused it. Only exact provider acceptance evidence yields an accepted receipt; actual public outcome
continues through the normal observed projector, so dispatch/reconciliation cannot emit a fake celebration.

The application also exposes server-only `applyRedemptionResolution({kingdomId,redemptionKey,status},context)`
for authenticated authoritative fulfilled/cancelled results, and `onWitnessedMoment(fact,context)` for the crier's
allowed standing permissions. These are not arbitrary browser commands. The lane implements the crier policy:
silent/rare/herald setting; one welcome with kingdom link for a genuine raid of at least three; Gate destination,
requested decree opening/result, at most two climax lines a stream, the requested `!chatdom` link and private
quiet/forget confirmations. No sub/cheer thanks, money totals, lapse/timeout reports or quiet-user mentions.
Apply six non-royal lines/hour/kingdom and no two within a minute; use the injected shared provider-budget permit
with priority safety, Gate, decrees, raid welcomes, climaxes and actual token-specific chat limits. Claim the
witnessed cause and dispatch record once; a replay/unknown retry cannot post a duplicate. Crier messages use the
configured Herald sender credential context, not walker or broadcaster impersonation. No valid standing
permission/send grant or available global permit means no write, with honest private capability state. Main
binds the persisted preference and shared budget/credential transport; the lane implements the policy/executor.

Use the existing record port for action recovery across application restart and current permission checks during
reconcile. The free strike/haul/chant executors delegate to the real realm gameplay application, verify principal/
kingdom/current encounter and preserve its accepted/refused result; the battle simulation/earned ledger remains
main's core. Gate preview/start/cancel/reconcile uses Spec 23's application and never this module's Helix transport.

### Visual, director and owner integration ports

Export a pure clocked controller and a disposable view from `apps/web/src/twitch-moments/index.ts`:
`createTwitchMoments(options)` returns `reset`, `receiveFact`, `receivePresence`, `receiveChat`, `receiveRaid`,
`setPresentation`, `sample(atMs)`, `previewAction`, `submitAction`, `dispose`. Validate unknown external values at
entry. `sample` returns bounded visual/director/audio commands; it mutates no world state. A separate
`createTwitchMomentView(host)` applies those frames, owning only its attached groups/pools/listeners. Keep authored
poses, effect durations and resource caps in the module README and deterministic tests, not a product control grid.

The **lane-local host** supplies:

- Main's existing `SettlementPlan`, a dedicated removable `THREE.Group` parent under the real scene, current
  public home/window/doorstep anchors by supplied slot, castle/plaza/gate/bridge/track anchors and approved
  kingdom palette/crest references. An anchor can be unavailable. Never derive a deed from a layout slot.
- An approved effect lookup structurally narrowed from Spec 24's `resolveApprovedEmote(id,'effect')`:
  `{id, revision, origin:'live'|'simulated', frames:readonly {blueprint:VoxelBlueprint,durationMs:number}[], periodMs}`
  or null. Keep exact revision/origin and immutable geometry. Main maps the emote owner's export; no mandatory
  sibling implementation dependency or duplicate decoder/approval/cache. Reject simulated geometry in live mode.
- A clock and sound port `play(cue, atMs, gain): cancellation`, with scoped finite cue identifiers and mode-aware
  gain. The bench provides original procedural cues; main can map the existing sound lane at integration.
- A camera lease port: `acquire(owner,priority,signal)` returns null or a lease with `read()`, `write(pose)` and
  `release()`. `CameraPose` is local `{eye:Vec3,target:Vec3,fov:number}`. Main arbitrates ownership; a lease can be
  revoked. The lane's director derives legal finite poses from supplied subject anchors and safe rectangles,
  eases between them on kingdom time, checks occlusion/near bounds through supplied host validation, and restores
  the lease's actual prior pose. It never writes a camera without a valid lease. Do not edit player controls.
- A presentation host callback for `suggestShow`/`requestStage`/`cancelStage` and a bounded witnessed-beat callback
  for future Chronicle stills. These callbacks disclose their absence; they never imply OBS scene control or a
  saved Chronicle. Only the host's real streamer gesture/permission approves opening. No exported video feature.
- `setPresentation({layout:'stage'|'window'|'strip',mood:'calm'|'show',busy,visible,safeRects,autoOpenKinds})`;
  rectangle coordinates are normalized to the actual picture. Hidden means release all leases/audio/effects,
  unsubscribe and dispose as required by the existing stream mount; remount takes a fresh source reset.

**Main-owned integration work, explicit:** add the optional `/-/twitch-moments` route for the bench before its
first review; attach the production view/controller inside the existing kingdom scene; expose the small scene
parent/anchors/camera-lease lifecycle; bind the lane's real Herald consumer and API handlers to existing
auth/grants/routers, authorized subscription/Helix transports and durable shared-core ports; connect stream
mode/safe-area settings and complete emote/Gate/sound bindings. Main does not implement the lane's event
normalizers, provider endpoint mapping, action application rules or reconciliation state machine later. The lane supplies an exact small
integration example under its owned README and demonstrates those ports in its runnable bench. It cannot edit
kingdom/stream, existing Herald auth/H01–H05 files, realm/shared core or root API routers to bypass those bindings. The current renderer lacks these hooks; a working
bench is evidence for this lane's real reusable view/controller, never evidence of completed live integration.
Main resolves required integration needs before declaring the production Moments experience shipped.

## Scope

Lane `twitch-moments` · branch `lane/twitch-moments` · worktree `../worktrees/twitch-moments`.

May write **only** `apps/web/src/twitch-moments/**`, `apps/web/src/twitch-moments-bench/**`,
`apps/herald/src/twitch-moments/**`, `apps/api/src/twitch-moments/**`, and this lane's
`work/lanes/twitch-moments/{PRD.md,progress.txt}`. Local contracts, tests, capture script, procedural spectacle
geometry/sound and README stay in those subtrees. Use existing renderer/material/voxel/settlement/citizen APIs;
the bench composes them without an alternate production renderer, motion solver or storage engine. Server domain
repositories/projectors/executors live in the two owned backend modules and use main's core/transport bindings.
Main owns route hooks, scene attachment, root scripts/manifests/lockfile, third-party credits and spec amendments.

Everything else is read-only: especially `packages/shared/**`, Herald outside its new `src/twitch-moments/**`
subtree, API outside its new `src/twitch-moments/**` subtree, `packages/twitch/**`, panel/stream,
kingdom scene, Forge, crowd, sound/emote/Gate lanes, Atlas road/history code and work references. You are not alone
in the codebase; preserve others' edits and accommodate their landed APIs. Follow `$ralph-lane`, `$chatdom-vision`,
`$look`; use the Twitch skill hub for any adapter/API question. No deployment, Extension publication, OAuth scope
expansion, live Twitch write execution, live subscription provisioning, root route registration or infrastructure
change in this lane. Real endpoint/executor/consumer logic is in scope; exercising it uses injected local
provider transports until main supplies authorized bindings.
Main/team may explicitly authorize a targeted integration check only on `tobi4s_` after reviewing the concrete port.

## Acceptance

Run from the lane worktree after each coherent task:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run apps/web/src/twitch-moments/moments.test.ts
pnpm test
pnpm build
```

Keep **one meaningful integrated scenario test** in `moments.test.ts`, extended as the feature grows. It starts
with synthetic provider notifications through the actual server normalizer/private mapper/record reducer, passes
through actual API application executors with a local recording provider transport, and checks public controller
output. Cover duplicate/reordered provider notifications and wrong-condition rejection; exact request method/
path/body/credential context for a representative decree and own-account unsent chat; concurrent duplicate
submit; partial reward-pack progress; record failure before dispatch; crash/timeout after dispatch; and revoke
before reconcile. A restarted application uses the same injected record store and cannot resend an unknown write.
No raw notice/chat/token enters public output or durable records. This is one causal integration scenario, not
a test per endpoint/catalogue entry. Continue through nine named/anonymous slots, shared resub vs restoration, correlated gift group/recipient update,
anonymous cheer, a 20 s burst, Hype level 3 plus authoritative retreat, same free battle form, duplicate raid,
Busy/ad/camera takeover, accepted/unknown/rejected/revoked action and epoch reset. Feed real Zod envelopes and
exercise actual controller/view command outputs. Assert no tint/name on anonymous slots, no duplicate parcel or
replayed lower sequence, recovered state causes no spectacle, no cheer summons a dragon, no acceptance implies a
witnessed outcome, no local strike creates victory and every interruption releases resources/leases. Re-sample
with different render frame intervals and check equal semantic effect timing. Validate oversize/malformed/private
extra keys fail at the boundary. No schema snapshot catalogue, test per string or self-fulfilling mock success.

The bench's default export at `apps/web/src/twitch-moments-bench/index.tsx` mounts through main's optional
`/-/twitch-moments` route. It shows SIMULATED on the full bench and clean output; an explicit unavailable-live
mode is separate. Task 1 must show a real home banner unfurl in the actual crafted kingdom materials. It
uses existing scene construction/render APIs and the same exported normalizer/projector/controller/view as
production integration,
with real deterministic timeline controls; no static mock image, hard-coded success banner or hidden fixture origin.

Use a free documented port in 5170–5199; do not assume any occupied port is yours. Main's 5190, Atlas 5193,
Herald 5194 and spell 5195 remain reserved. Example after checking availability:

```sh
pnpm --filter @chatdom/web preview --port 5198 --strictPort
node apps/web/src/twitch-moments-bench/capture.mjs --base-url http://127.0.0.1:5198
```

The lane-local capture script uses `packages/testing/capture-lock.mjs` with lane priority **before** opening its
browser/owned preview; never remove the lock or kill another process. Use Chrome/SwiftShader and deterministic
seed/hour/elapsed time. Wait for actual geometry/material/asset completion and the first meaningful frame before
`window.__chatdomReady = true`; fail on browser/worker errors. Write `shots/twitch-moments/` and include:

- Web 1440×900 and 390×844: single named sub, anonymous quiet neighbour, gift single/cart/partial-recipient
  aggregate, late/lapsed quiet state and unavailable-live action preview. No hidden overflow or focus loss.
- Stream 1920×1080 and 1280×720: cheer ladder contact sheet, train below 3/earned dragon active/retreat/victory,
  raid of 3 and a 10,000-viewer wagon column, charity/poll/prediction/signpost and free Wyrm Bell counterpart.
  “Victory” here requires a labelled authoritative simulation fact; it is never a live game claim.
- Corner 480×270 and strip 1280×180: named banner/parcel/raid climax and calm/Busy/ad states. Check text and
  subject stay out of safe rectangles. Add a five-second automatic-open cancellation and camera takeover check.
- A timed contact sheet of anticipation/action/settle for banner/parcel/firework/dragon arrival; inspect the
  sequence and listen to its procedural cues in the browser. Static shots alone cannot prove motion or sound.
  An EARLIER TONIGHT reconstruction produces no second action, award or witnessed-beat output.
- Burst harness: five/nine-person hamlet plus 50,000-event capital-shaped synthetic inputs driving the same
  controller with bounded 240 represented actors from existing APIs. Report admitted/coalesced/dropped cue counts,
  maximum active pools/labels/queue sizes and resource release after hide/reset/context loss. This is neither
  50,000 fabricated people nor a SwiftShader frame-time claim. Missing actual population remains missing.
- Public export/log inspection: no private IDs/receipts, secrets, raw notices/chat or private action arguments;
  anonymous credit stays anonymous; source/time/evidence distinctions survive reconnection.

Open contact sheets and representative full frames at their actual sizes with `view_image`; fix anything cheap.
Review every surface in the matrix at least once through the bench; a small contact sheet can group less prominent
states. The lane has no panel write scope: export headless view state for panel owner review and ask main for a
318×496 integration capture if panel moments are attached. Main runs `pnpm verify` plus the new integration route
and real-producer checks at merge. Keep retained evidence copying in main's scope; ignored shots are lane evidence.
Real-GPU follow-up belongs in the evidence block: 1920×1080 OBS stage/window beside a game, cue timing/audio and
hidden resource release. Do not claim 4 ms/60 fps or six-hour operational proof on this server.

## Quality bar

The home is the subject of the sub, the recipient the subject of the gift, the visiting kingdom the subject of
the raid, and the whole town the subject of the cheer. Brass, cloth, parchment, wood and clay read as different
materials. Banners catch a small breeze, parcels have weight and settle, fireworks have a launch and a quiet end,
and the train has a silhouette before it has particles. The dragon is an authored creature with clear poses,
telegraph and no-loss retreat, not a stretched chimney ornament. Five people get intimate acknowledgement; a
capital gets a lovely composed gathering without a rain of names. Pay attention to negative space and warm windows
under every effect. No generic alert cards, numerical supporter rankings, screen-filling white flashes, endless
particle noise or every event fighting for camera time. Effects are bounded, legible and easy to interrupt.

## References

- `work/references/prototypes.md`, Lanternmere director/choreography: explicit beat expiry, priorities/cooldown,
  motivated focus and return, presentation separate from simulation. Ideas only; reimplement here and leave
  random camera paths, fabricated people, old rewards and player-control capture behind.
- `work/references/crowd-animation.md`: restrained staggered reactions and stable timing, no synchronized
  population storms. Its source has no verified license; original code only, no copied assets or implementation.
- `work/references/herald-presence.md`: preserve real source, original clock, cleanup, privacy and grant boundaries;
  its seven read subscriptions do not authorize this lane's future support producers or outbound actions.
- `work/references/sky-fog-time.md`, `voxel-meshing-light.md`, `settlement-streets.md`: compose the existing studied
  renderer and valid supplied anchors; no competing light field, weather engine, camera input or street solver.
- [Twitch EventSub catalogue](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), checked 2026-10-30:
  actual type/version coverage is an ingestion concern. The local presentation catalogue is not a mirror of it.
- [Twitch EventSub reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference/), checked 2026-10-30: aggregate
  provider records need an explicit public projection, and source support never implies complete participant data.
- [Twitch Helix reference](https://dev.twitch.tv/docs/api/reference/), checked 2026-10-30: authorized backend owns
  request semantics/refusals. Lane action bounds are UI/contract constraints and must be rechecked by that owner.

`$study-reference` was applied by reading the existing reference studies; the Twitch hub, API and EventSub
skills supply the reviewed subscription/endpoint mechanics. Recheck the current official endpoint/type section
at each first real consumer rather than copying remembered auth or product eligibility rules; no new rendering/motion library or
copied technique is introduced. The current director/choreography study and existing renderer work are sufficient
for this adapter. A worker proposing a new library or borrowed geometry must study/license it and ask main for
out-of-scope attribution before use. This spec creates no generated painting or external audio dependency.

## Not now

Ownership boundaries, not omissions from Moments §§6/12: this lane does not provision live Twitch subscriptions/
grants, implement root auth/realm durability/signing or the storage engine, allocate homes,
write road ledgers/passports, build an emote approval pipeline, author arbitrary Forge tributes, run authoritative
combat/game voting or build the throne/panel/OBS scene switcher. It supplies the complete presentations, validated
projection/command adapters, actual support-event normalizers/projector, authenticated-principal application
executors, record-backed idempotency/reconciliation and truthful unavailable states for all those causes.
The owned modules apply entitlement/wrapping and action-record domain updates through durable injected ports;
they do not hand their mapping or executor work back to main.
Main retains the production integration obligations above; no requested moment is considered shipped merely
because it can be demonstrated by a fixture. No auto-clips, video product, external-game control or new paid status.

## Decisions

- **2026-10-31 — Realm owns live support delivery.** Main adds the optional, existing-chat-grant
  `channel.chat.notification@1` subscription to Herald's verified conduit. Only the existing normalizer's
  stripped `RealmSupportObservation` enters Herald's bounded durable outbox; raw provider bodies/chat never
  enter it. The Herald-only ingress commits through the kingdom writer queue/lease, normalized record port,
  independent per-kingdom moment sequence and realm public outbox. Public `moment` deltas contain a validated
  fact plus `current`; checkpoint-only `moments.current` carries the watermark and lasting state. Room and
  public stream observers restore that state quietly and animate only subsequent cursor-ordered deliveries.
  Quiet citizens stay anonymous, and the keep's slot remains independent of street deeds. No new entitlement,
  coal, payment or write authority follows from this transport. Structured subscription sources, badge
  metadata tee, other event families and bidirectional action executors still need their explicit bindings;
  this does not claim a real event occurred or that TM03's spectacle is accepted.

- **2026-10-30 — Local first-consumer catalogue.** Main accepted the lane-owned bounded Zod catalogue on the
  existing fact/intent envelope. There are no invented shared exports. Main reviews the precise local schema and
  binds the lane's private identity mapper, real producers/executors and authorized transports before live use.
- **2026-10-30 — Incoming caravan and travel are separate consumers of the same evidence.** Spec 23 agreed:
  this lane renders wagons/pennants; Gate owns kingdom travel/private receipts, Atlas owns roads/chain evidence.
  `AtlasRaid` remains unchanged and never carries riders. No duplicate raid writer or public identity inference.
- **2026-10-30 — Reuse approved emote effects.** Spec 24 agreed the injected structural effect subset above;
  no new source decoder/cache or cross-lane mandatory import. Exact approved revision and origin survive adapters.
- **2026-10-30 — Newer Twitch table wins.** For 500 Bits, use the castle emote volley in `Twitch.md` §6 rather
  than Moments §12's older meteor shower. Nothing in the cheer ladder wakes the dragon.
- **2026-10-30 — Full production paths, explicit owners.** An injected port is executable architecture, not proof
  its producer exists. This lane builds both-direction
  adapters, all presentations and the actual support mapper/action executors now; main binds root authority,
  authentication, transports/storage and stream attachment before claiming real Twitch support. No fixture-only reduction of scope.

- **2026-10-30 — Team owns the real backend volume.** Review expands this lane into the disjoint Herald/API
  subtrees above. The lane implements support normalization/projector, domain record transitions, authenticated-
  principal application rules, actual Helix mappings and durable unknown/reconcile behavior. Main binds root
  auth/grants/routers/transports/core; it does not inherit mapper/write application implementation. Existing
  Herald H01–H05/auth files, runtime grants and the Gate raid writer remain untouched.

- **2026-10-31 — Current handoff: events are the physics of the stream.** Stage a readable, crafted real-kingdom response to an actual event when its main-owned feed exists; otherwise visibly label the rehearsal SIMULATED. TM01/TM02 support and TM03 sky spectacle were merged on main; preserve their work and do not claim an observed real cheer or hype train. First refine the merged sky curtains and the gift parcel contrast already requested in progress. The lane implements feature-local adapters and event handling against approved ports. Main owns shared contracts, cross-surface authority and root integration bindings; report only actually missing seams. The stream director must return control after the beat.

- **2026-10-31 — Current handoff verification and ownership.** For each visual change inspect one stream-first 1920×1080 capture; use typecheck and affected tests for the step. This supersedes the older per-task capture matrix for this handoff. The lane implements feature-local durable adapters and runtime behavior against existing ports; main owns shared contracts and cross-surface authority and integration bindings. Report only actual missing authority or contract seams.
