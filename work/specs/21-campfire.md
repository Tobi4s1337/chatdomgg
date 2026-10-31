# Spec 21: the campfire and Dusk Court

Status: **frozen lane boundary, 2026-10-30.** The local ports below are this handoff's contract, not claims that
room, Chalk or voice exports already exist. This lane owns campfire domain handlers and voice enforcement;
main binds their trusted infrastructure ports and the integration prerequisites listed in Contracts.
Vision: `chatdom/ChatDom.md` principles 7–9, 12, 15–18 and §10's sixth signature experience;
`chatdom/Moments.md` §5; `chatdom/Tech.md` §§6.8, 10.1, 10.4–10.6;
`chatdom/World-Tree.md` §§3, 6, 14; `chatdom/Safety.md` §§7–8;
`chatdom/Artstyle-Soul-Feel.md` §§6–9, 11, 13–14; `chatdom/Quality.md` §§2–5.

## What and why

At the edge of the Wilds, a ring of logs catches the last light of the kingdom. The streamer sits with real
citizens, their faces warm in the fire. One of them has been putting out the town's lanterns. The others have
until dawn to decide whom they trust. The people watching on Twitch are the Gallery: one `!sus name` joins
their suspicion to the circle. The game is Dusk Court, a complete authored social deduction family, not a menu
or an invitation to generate unverified rules. Watching, chatting and sitting each provide a whole evening.
Voice makes the gathering intimate but is optional; a text seat has the same game rights. Everything spoken
is public. Secrets are private taps, never a second voice room. A night leaves a truthful memory, never a
permanent accusation against a citizen. The same place remains worth sitting beside between games.

## Current state

- `packages/shared/src/identity.ts:4` exports `PersonId`, `KingdomId`, `CitizenKey`, their schemas,
  `EpochMsSchema`, `TokenSchema`, `TwitchLoginSchema` and `DisplayNameSchema`. Keep decimal IDs as strings.
- `packages/shared/src/events.ts:13` exports `createIntentSchema`, `createFactSchema` and `EventCauseSchema`.
  They provide envelopes, not a campfire fact catalogue or permission to invent world events.
- `packages/shared/src/presence.ts:17` exports `PresenceInput`, `KingdomPresenceFrame`, `PresenceFeed` and
  their schemas. Public window slots are visual addresses, never proof of an authenticated person, follow
  age, consent, game seat, voice grant or invitation. A stale/offline feed cannot grant voice.
- `packages/shared/src/citizen-chat.ts:5` exports `CitizenChatCue` and its schema. It is a short public bubble,
  not a private night-message channel, persistent transcript or authenticated Gallery ballot.
- `packages/shared/src/avatar.ts`, `avatar-cape.ts` and `voxel.ts` contain the existing avatar rig,
  part/attachment/cape/voxel/material formats. `packages/content/src/avatars/index.ts` exports
  `AvatarPose`, `poseAttachments`, `partMatrix`, `compileAvatarPart` and the authored parts/palette.
- `apps/web/src/citizens/index.ts:8` exports `CitizenLook`, `CitizenSample` and `createCitizenRenderer`.
  Its public samples support walking, nod/wave and `lookYaw`; **there is no seated pose or mouth-amplitude
  API**. Do not write fictional calls or patch that shared renderer from this lane. A campfire-local pose
  adapter may use the same rig, compiled parts and materials; main may later expose a common pose seam.
- `apps/web/src/main.tsx` registers optional development surfaces. Main owns route registration and actual
  kingdom/stream integration. `apps/web/vite.config.ts` currently proxies Forge, Atlas and presence only.
- At this freeze there is **no** `apps/realm`, `apps/api`, `packages/chalk`, game/voice protocol in shared,
  Chalk runtime or LiveKit dependency in web. `@chatdom/audio` now supplies the shared mixer and bounded phrase bridge; consume its actual exported API. Spec 22 supplies the games engine; nothing below assumes that engine is already shipped.

## Rules

1. **R1 — A place with real people.** Author an outdoor clearing, grounded log seats, a tended fire, individual
   seat lanterns, an approach back toward the kingdom and a visible Wilds horizon. Use 0.125 m prop and
   0.0625 m avatar lattices and existing palette ramps. Supply 6–12 occupied-seat arrangements with no
   clipping or empty-chair spectacle. The Magistrate occupies one seat; the remaining **5–11 are players**.
   Real mode never creates people. The development cast is prominently labelled **SIMULATED** on every
   surface. With fewer people, the clearing remains a lovely social place; it does not fill seats with bots.
2. **R2 — One gesture opens the gathering.** Only the seated monarch opens/closes a game, invites, starts the
   lottery, chooses narration/open mic, or changes its verified settings. An invitation is an offer, never
   a forced camera move, microphone request or acceptance. One `!join` enters a named citizen into the
   current seat lottery through the main command service. Equal draws without replacement; no Bits,
   subscription, channel-point ticket, rank or purchased weight. Publish the rules before the draw, keep
   its candidate roster/seed private, and retain a private audit record. A seat is accepted explicitly and
   leased to one authenticated person, not a browser tab. Declining, missing a draw or leaving loses no home,
   earned item or standing. A game starts only when all required accepted seats and the Magistrate are present.
3. **R3 — The whole Dusk Court family.** Ship all five named roles, all 5–11 player counts, text/voice seats,
   the Gallery and every terminal outcome. The rules below are the authored settings grid and explanation
   shown before joining. They are independently authored because the cited `docs/08` role rules are absent;
   the names and the experience come from Tech §10.4. No generated code, hidden remote rules or alternate
   JavaScript game reducer substitutes for the agreed Chalk interpreter.

   | Role | Power and victory |
   |---|---|
   | Snuffer | Privately knows other Snuffers. Each night chooses one living non-Snuffer or passes. Their plurality target is attacked; a tie is resolved by persisted private match RNG. Wins when living Snuffers are at least as numerous as all other living players. |
   | Watchman | Each night inspects one other living player or passes. At dawn receives only “Snuffer” or “not a Snuffer”, privately; no exact role. Wins with the town. |
   | Lamplighter | Each night protects one living player, including self, or passes. Cannot protect the same person on consecutive nights; that restriction depends only on their own known history. Wins with the town. |
   | Fool | Has no night power. Wins alone if banished by the day ballot; that ends the game. Otherwise shares no faction victory. A night attack does not trigger the Fool's victory. |
   | Townsfolk | No night power; reads, debates and votes with the same rights. Wins with the town when no Snuffers remain. |

   There is one Watchman, one Lamplighter and one Fool. Use one Snuffer for 5–7 players and two for 8–11;
   fill the remaining seats with Townsfolk. Roles are assigned by server RNG after seats lock; no client seed
   or role table crosses the server boundary. Everyone, including roles without a night power, sees a sealed
   night card and may submit “rest”. Hidden submissions always resolve at the shared deadline, never as soon
   as the last role acts. Resolve protection, collective Snuffer target, attack, investigations, then victory.
   A protected attack has no victim and does not name the protection or target publicly. A Watchman who has
   left or been eliminated does not receive a new result. Elimination extinguishes the **game lantern**, never
   the citizen's presence light/window. Publicly reveal eliminated roles only at the published verdict/dawn;
   reveal remaining roles at normal game end. Do not decorate homes, passports or citizen names with suspicion.
4. **R4 — A finite evening with a clock.** Use a server clock, persisted deadlines and due tokens. The verified
   timing presets are `hearth` and `unhurried`; no arbitrary author expressions or unbounded user settings.

   | Phase | Hearth | Unhurried | Public consequence |
   |---|---:|---:|---|
   | Seating / acceptance | 60 s | 90 s | Unaccepted offers expire; do not start short-handed. |
   | Dusk / private role card | 15 s | 20 s | Seats lock; everyone receives only their own card. |
   | Night | 35 s | 45 s | Simultaneous secret choices; missing choice is pass/rest. |
   | Dawn | 12 s | 15 s | Approved outcome, lantern extinguishing if any, private inspection delivery. |
   | Discussion | 90 s | 120 s | Living players speak/text; Gallery suspicion opens. |
   | Ballot | 25 s | 35 s | Each living player privately chooses another living player or abstains. |
   | Runoff, if needed | 20 s | 25 s | One ballot between tied highest targets; second tie means no banishment. |
   | Verdict | 10 s | 12 s | Only the collective outcome and sanctioned public reveal. |
   | Ending | 15 s | 20 s | Reveal, outcome, thanks, return to the same clearing. |

   Gallery deadline is discussion start + that preset's discussion duration + the **authoritative host's frozen
   stream-delay allowance**. Delay is finite, 0–60 s, honestly labelled estimated if not measured; private
   player timers do not depend on hidden actions or public suspicion. Host ends discussion only when that
   public Gallery deadline is reached, then opens the ballot. The allowance is fixed per day, not extended
   by chat volume. Ties for first public suspicion are displayed as equal. No suspicion eliminates a player.
   Check victory after each elimination. Cap play at eight completed days: if neither faction nor Fool has won,
   end as a draw. At most one runoff per day. Malformed moves, absent players and silent chats cannot hang it.
   Ad breaks pause active participation windows through a host lifecycle input with stored remaining time;
   resume once, without duplicating a reveal. A 10-minute pause ceiling ends the game as interrupted, not a win.
5. **R5 — The Gallery is part of the night.** A public `!sus <login>` casts or replaces one Gallery suspicion
   per authenticated non-seated person per day. Match/kingdom/day/deadline are resolved by the command host;
   display names are never an identity lookup. Reject an unknown or ambiguous target privately. Only living
   seated targets are valid. A blocked, timed-out or banned actor cannot participate; main supplies current
   eligibility. Trust may gate eligibility, never weight. Gallery suspicion is expressly **advisory**: it raises
   a small ember beside the suspect's log and gives the Magistrate an equal-voice prompt. Seated players cast
   the only banishment ballot, one each. Use the host's deduped aggregate public tally input; the rendering
   client never invents or publishes a vote. No exact audience, viewer or small participation count on stream.
   The campfire host dedupes authenticated ingress using its private storage port; only a bounded 5–11-seat
   summary reaches Chalk or the browser, at most once a second. Do not put 50,000 voter records into Chalk's
   64 KiB snapshot or 64-entry collections. Capital chat volume never becomes render work or per-message reflow.
6. **R6 — Secrets have a boundary, not a hiding class.** Match state, roles, RNG/seed, assignments, hidden
   submissions, private checks, action receipts and seat candidate rosters are server-owned. Derive a fresh
   allowlisted public view for walkers, Gallery, Magistrate, director, stream and public recording. Derive one
   owner view only after authenticating that person's live seat/epoch. Private cards never enter public DOM,
   hidden HTML, canvas, props, analytics, URLs, cache keys, localStorage, service workers, LiveKit attributes,
   metadata, data channels, network debug captures or screenshots. A player receiving an owner view cannot
   request another identity. Default Magistrate view is public, **not omniscient**. The stream surface must
   accept only `CampfirePublicView`, never `CampfireSelfView | CampfirePublicView` with a `hideSecrets` flag.
7. **R7 — Prove traces and implicit leaks.** Use Chalk's declared visibility and taint checks for legal action
   predicates, result acknowledgements, phase transitions, events and emitted effects. For each audience,
   generate two worlds equivalent in everything they may know; vary only unobservable state, replay the same
   observable inputs, and compare complete ordered view/action/error/timer/event/permission-request traces
   until an explicitly declared public reveal. Do not demand equality after legitimate declassification.
   Night activity cannot change response shape, error wording, legal moves for an uninformed viewer, early
   closure, speaking indicators or public traffic fanout. Investigation results and a Snuffer's own knowledge
   are declared owner-visible. Test valid and hostile multi-move sequences, not one snapshot. A harmless
   public receipt means only “received”, never “your guess was right”.
8. **R8 — Voice access is earned and offered.** Speaking needs sign-in, a current accepted seat, 16+ declaration,
   one-time voice consent, at least 30 days' follow age/trust tier 1, no active timeout/ban/warning, a live channel
   and seated streamer. Invites do **not** bypass these. Store no birth date, guessed age or voice print. A
   person who declines or is ineligible can hold a text seat with equal game rights; do not publicly expose why.
   Private actions use taps and fixed phrasebook lines. All free text uses real Twitch chat through the main
   chat service with Twitch moderation; this lane creates no private text messenger. No mic prompt before an
   explicit accepted voice offer and a user gesture. No private voice, ghost room or public audience mic.
9. **R9 — Permissions carry the safety.** Use a single LiveKit room per match, at most 12 people including
   Magistrate, plus the one hidden receive-only OBS listener. Issue initial tokens for two minutes via the
   lane-owned authority handler and injected signer only; microphone source only, no data publishing,
   metadata writes, room admin, recording or video.
   Recheck every join/reconnect, seat generation and current moderation; browser trust is never evidence.
   Revoke publishing **permission**, not merely track mute, on elimination, moderator silence, night, unseat,
   consent withdrawal, stream end, absent monarch or stale authority. Remove participants and deny rejoin on
   unseat/moderation. Revoke subscription too when removed; an eliminated person continues watching the public
   broadcast/text view, with no ghost-room privileges. Normal night restrictions apply uniformly to all roles.
   Keep Magistrate's public narration available according to the declared phase policy, never role state.
   The lane implements explicit Cloud revocation cutoffs and join revalidation: the initial TTL alone does not
   defeat refreshed tokens. An independent permission supervisor removes stale grants when room authority
   is lost; renewals require a current authoritative lease. This is a server responsibility, not a browser promise.
   On unknown enforcement state, silence the local broadcast bus immediately, show
   “The voices are quiet while the road returns”, and do not claim a successful unseat until authority confirms.
10. **R10 — A comfortable public voice mix.** PTT is default on every device, with a 44 px press-and-hold touch
    control and a rebindable keyboard key that never captures text entry. Release on pointer cancel, lost focus,
    tab hide, visibility change, connection loss, phase change and disposal. Open mic is desktop-only after the
    streamer's explicit choice and the speaker's explicit acceptance. Head/mouth motion uses smoothed local
    track level, with closed-mouth silence and independently timed listening poses; no speech-to-text or lip
    transcription. Spatial pan keeps every nearby seat intelligible and bounded in level; OBS gets a stable
    mix with a limiter. Noise cancellation is enabled when supported, with an honest unsupported state. The
    streamer connects mic-only through the throne; OBS excludes the streamer's track, which OBS already has.
    Monitor through OBS with headphones. No parallel browser autoplay path doubles the mix. Text seats never
    create a LiveKit participant merely to pretend they are speaking.
11. **R11 — One press quiets the fire.** Design and wire monarch/authorized Watch controls for local broadcast
    silence, a seat's publish permission, unseat and handoff to Twitch timeout. Wardens have no people powers.
    Local silence is immediate and stays active through reconnect until deliberately cleared. Never remotely
    unmute a person's device. Log actor, target, match, action, time and private reason; public exit text says
    only that someone left the fire. Twitch warning/timeout/ban removes voice and seat within one second of
    authority receipt; test races with token refresh, stale grant and rejoin. Preserve homes and earned standing.
    Reports store talk-key intervals and broadcast/VOD timestamp, not audio. Do not enable Egress, record mic
    tracks, transcribe, upload voice to AI, retain PCM, or put real voice into Studio replay. Session-only local
    listen-mute is available; persistent block/report storage and Twitch timeout belong to main's safety service.
12. **R12 — Narrate witnessed things only.** Magistrate may narrate the public log, or choose checked Voice of
    the Realm clips. The local surface consumes approved, fact-referenced text/audio cues supplied by main's
    spell runtime; it does not send roles, ballots, Twitch text or microphones to a model. For example, “Dawn.
    One lantern did not survive the night” is eligible only after the public dawn fact says exactly that.
    No generated-code narrator and no LiveKit agent. Until a clip is ready, use the approved written public
    line and authored chime; do not block the game or claim speech played. Captions and a streamer veto have
    the same fact scope. Chronicle gets approved public outcome facts and still cues only, with equal keepsakes
    for actual participants if the main ledger grants them; this lane mints nothing and renders no false reward.
13. **R13 — Absence and failure are designed.** Duplicate intents, stale revisions and replayed timeouts never
    cause two eliminations or two result receipts. Reconnect restores the same seat, own known state and remaining
    deadline only after reauthentication; it never redraws roles. A voluntary disconnect reserves a seat for
    60 seconds, silent immediately; missing private moves pass and day ballots abstain. After expiry remove the
    seat through a declared public departure; privately recompute faction viability. If departure determines a
    winner, end as interrupted rather than award a walkover. No mid-game replacement inherits a secret role.
    A server restart restores persisted state/deadlines and server RNG cursor, or ends interrupted if recovery
    cannot be trusted. Stream-offline or absent Magistrate silences voice immediately and pauses; the same
    10-minute interruption ceiling applies. An interrupted game has thanks and public memories, no fabricated
    faction result/reward or reveal of a moderation reason. Secret state is disposed/expired by the host's
    retention policy; the browser clears owner state on seat loss, sign-out and source change.
14. **R14 — Let the fire carry the scene.** Lit cheeks, broad forehead/hat silhouettes, logs warm on top and cool
    below, a small wind-blown flame with cube sparks, purple Wilds and a soft distant kingdom create three value
    groups. The flame does not blow out to white, strobe or bury a face. Compose a calm full-circle establishing
    shot, a pair/listener shot, a suspicious face shot and a dawn lantern shot. Motion settles into seats with
    grounded feet and cloth, blends into attention and returns safely to walking. The director receives public
    shot suggestions with expiry/priority; main owns camera arbitration, player controls and the return shot.
    Stream corner/strip views use closer framing rather than shrink the full UI. No raised live viewer counts,
    giant scoreboard, generic dark cards, raw IDs, emoji icons, browser-default controls or desktop UI shrunk
    onto a phone. Between rounds, empty, waiting, loading, microphone denied, text-only, reconnecting, closed,
    unsafe/stale voice, interrupted and ended states all belong to the same clearing.
15. **R15 — Hear the materials without losing the conversation.** Provide varied fire crackle, grass approach,
    log settling, seat lantern, dusk/night/dawn, choice receipt, ballot seal, verdict, departure and ending cues.
    Author original procedural sound or use existing licensed assets only; no uncredited downloads or generated
    human voices. Inject the common context/output bus, with bounded overlap, ducking under public speech and
    disposal; do not start a competing AudioContext in a mounted kingdom. Unlock only on gesture, report failed
    unlock honestly, stop tails on emergency silence, and do not replay an audio backlog after tab resume. Each
    new source needs its provenance in the lane's README for main to add to `THIRD_PARTY.md` at integration.

## Contracts

### Actual shared imports

Import the identity, avatar, material, presence and chat types named in Current state from `@chatdom/shared`.
Use their schemas at appropriate trusted boundaries. They contain **no** generic match, campfire, seat lease,
voice grant, game result, trust or private-view DTO. Do not add an ambient module or cast one of those into existence.

### Coordinated games engine boundary — spec 22

The tavern lane owns `packages/games/**` **except** `packages/games/src/dusk-court/**`. Its prospective
`packages/games/src/index.ts` exports are agreed with spec 22, not existing shared contracts:

| Agreed call shape | Result |
|---|---|
| `compileChalk(manifest)` | Validated `CompiledChalk` plan or diagnostics; manifest is `ChalkManifest`. |
| `createChalkMatch(compiled, { seed, now, seats })` | `ChalkSnapshot`, server-side only. |
| `advanceChalkMatch(compiled, snapshot, command, { now })` | `ChalkStep`; input command is `ChalkCommand`. |
| `projectChalkView(compiled, snapshot, audience)` | `ChalkView`; audience is `ChalkAudience`. |

The package also exports `TasterReport`. Exact discriminated structures are documented/tested in spec 22's
first task before families consume them; these call shapes do not replace those structural types.

`ChalkCommand` has authenticated move, persisted-token timeout and trusted `public-tally` cases. The host
resolves actor/seat; expected revision and intent key reject retries/stale moves safely. `ChalkSnapshot` retains
revision, phase, round, deadline, RNG cursor, visibility-partitioned variables and hidden submissions privately.
`ChalkView` includes only that audience's allowed fields, safe actions, public deadlines and viewer-safe events.
The interpreter supports finite role variables, common-deadline hidden submissions, ordered effects,
owner-only investigation results, public tallies, round caps and explicit reveals. Taster's server-only entry
is `apps/taster/src/index.ts`. The web imports browser-safe **types/views only**, never the server interpreter,
manifest secret expressions or full snapshots. Do not import a server barrel into the stream entry.

Export Dusk Court through its owned `packages/games/src/dusk-court/index.ts`: `DUSK_COURT_MANIFEST`,
`DUSK_COURT_SETTINGS`, `DUSK_COURT_RULES`, and its verification/trace corpus. Do not edit the package root
barrel. Before the engine exists, build the manifest and tests against the agreed data shape and a **typed
injected game port**; an explicit SIMULATED presentation fixture can drive the scene. Do not implement a second
rules engine or mark verification passed until the real interpreter/Taster consumes the manifest. If an engine
feature is missing, write `needs:` and continue the unblocked scene/consent work.

### Campfire presentation boundary — lane-local, owned here

Define validated, versioned interfaces in `apps/web/src/campfire/ports.ts`; use strict allowlisted decoders,
not a flattened engine snapshot. These are local integration ports; main promotes genuinely cross-process
messages into shared before real routes launch. The domain description is deliberately precise:

| Port/type | Data and responsibility |
|---|---|
| `CampfirePublicView` | Version, kingdom/match ID, host epoch, monotone revision, server time, origin LIVE/SIMULATED, lifecycle, public phase/deadline/pause, verified settings/rules, accepted public seat labels/looks/game-lantern status, public Gallery summary, approved witnessed cues, revealed result. No roles until authorized reveal, ballots, secret choice activity, grants or full person roster. |
| `CampfireSelfView` | Separate authenticated owner envelope: seat generation, own role/known teammates, own legal choices, own receipts/history and received inspections, text/voice eligibility and private reason. Carries the public view separately; never serializes into a public envelope. |
| `CampfireSessionPort` | Subscribe public; subscribe self for the already authenticated principal; send a typed intent with match/epoch/expected revision/id; receive pending/accepted/rejected receipt. Browser cannot select actor. Unsubscribe/dispose clears private state. Lifecycle, seat offers, role actions, ballots and controls are data commands, not arbitrary strings. |
| `CampfireVoicePort` | Obtain authority-approved own grant, connect/disconnect, set own PTT, observe permitted track level and transport/enforcement status, request permission removal/unseat through host; user gesture/device permission stays local. No generic participant-admin methods exposed to untrusted UI. SDK-specific code is in one replaceable adapter. |
| `CampfireAudioPort` | Existing context/output destination, user-unlock state, common volume/ducking/kill signal, play approved Voice cue; campfire owns only its effect layer. |
| `CampfireScenePort` | Public seat/appearance positions, approved approach/return request, camera suggestion and factual public still/result callback. Position is the soles, +Z is forward, lengths metres, timestamps server milliseconds. No teleport authority and no duplicate presence light. |

Export a default Solid surface from `apps/web/src/campfire/index.tsx`, plus a public-only stream entry from
`public.tsx`. Keep `self.tsx` out of its import graph. Export a mount/create function for the three.js clearing
with explicit `update(publicView, atMs)`, resize and disposal; it can attach to a main-owned scene rather than
create a second world. The demo harness belongs here and uses injected ports. Avoid CSS/global listeners
outside the root. Every time/pose/particle sample is seekable and deterministic under fixed public time.

### Lane-owned server application and injected infrastructure

Implement `apps/realm/src/campfire/**` as the campfire application host: lobby/offer/lottery/seat lease lifecycle,
Chalk match lifecycle and persisted deadlines, private projections/delivery, authenticated Gallery dedupe/tallies,
moderation and live/ad transitions, result outbox, rehydration and the independent voice permission supervisor.
Reuse the games lane's pure Trestle/Chalk modules; do not introduce another rules interpreter. Main does not
rebuild this domain logic. Implement `apps/api/src/campfire/**` as callable authenticated request handlers for
public/self subscriptions, join/accept/leave, game intents, grants, consent withdrawal and authorized controls.
The lane provides schemas, ownership checks, error/status mapping and effects; main supplies router registration.

Define these server-only ports next to those handlers; never export them through web or the public recorder:

| Infrastructure port | Main supplies; campfire implements the policy around it |
|---|---|
| Principal/capabilities | Verified principal, kingdom, current role/moderation/live/follow-age/consent facts and freshness. No client-provided actor or trust is authoritative. Lane checks each action and self-view subscription. |
| Durable transaction | Atomic transaction/CAS, private snapshot, lobby/seat generations, due tokens, intent dedupe, private lottery audit, bounded Gallery records, result/effect outbox and restore. Lane defines records/migrations and transaction semantics; main binds storage driver/session store and writer fencing. |
| LiveKit control | Sign short grants, update/remove participant, explicit Cloud revoke cutoff, receive verified joins/permission acknowledgements and reconcile current participants. Lane derives permissions, checks every join and owns retry/reconciliation/supervisor policy; main binds credentials/client/project/verified webhook infrastructure. |
| Clock/delivery | Authoritative clock/scheduler, authenticated owner/public channels, normalized verified Twitch ingress and ad/moderation/live inputs. Lane owns due-token validation, projection choice, recipient checks and Gallery tally windows. |
| World/Voice/safety | Idempotent world result sink, checked fact/audio/still cues, current safety decisions and audit/report sink. Lane emits typed public results/reports; main's ledger, provider and persistent safety services own their external effects. |

A local durable harness runs the actual handlers/supervisor with a test database/file driver and an injected
LiveKit service adapter. Fake voice adapters test deterministic behavior; a configured real LiveKit room then
proves transport enforcement. These are two evidence levels, neither a substitute for the other.

### Main-owned prerequisites and integration proof

Main registers the bench (`/-/campfire`), kingdom/stream/panel mounts and actual router; binds real
sign-in/session/CSRF, principal/capability and session-store/storage drivers, trusted Twitch ingress, shared
wire types and LiveKit/provider infrastructure. Main pins/installs SDK dependencies before first import;
the lane implements both browser SDK adapter and server domain handlers. It never edits another manifest or
lockfile. Main supplies common audio routing or accepts the lane's local bus adapter. Missing infrastructure
is a concrete `needs:` with the real handlers runnable through injected ports, never a fake live success.
No production voice exposure until the shared wire boundary is validated and the integrated system proves
owner isolation, modified-client revocation, reconnect and the broadcast-only mix.

## Scope

May write **only** `packages/games/src/dusk-court/**`, `apps/web/src/campfire/**`,
`apps/realm/src/campfire/**`, `apps/api/src/campfire/**`, and this lane's
`work/lanes/campfire/PRD.md`/`progress.txt`. These are one campfire feature; tavern explicitly excludes the
Dusk Court subtree. Tests, local durable harness, capture script, procedural art/effects, server record schemas,
README and provenance stay within those subtrees. Do not edit shared, main.tsx, Vite/workspace config,
package manifests/lockfile, world reducers, other realm/API/Twitch/provider services, citizens, content barrels,
audio library, global CSS, other lane files, `THIRD_PARTY.md` or this frozen spec. Main binds infrastructure.
You are not alone: preserve other work. Lane workers follow `$ralph-lane`; sub-agents never run git.

## Acceptance

Run from repository root after each task, once new concerns are resolved:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/games/src/dusk-court apps/web/src/campfire apps/realm/src/campfire apps/api/src/campfire
pnpm build
node apps/web/src/campfire/capture.mjs --base-url http://127.0.0.1:5190
```

The worker creates the focused test/capture entries; until they exist these are planned commands, not evidence.
Capture imports the existing `packages/testing/capture-lock.mjs` queue, uses Chrome/SwiftShader, waits for a
meaningful `window.__chatdomReady`, and checks source label, console failures, correct public/private surface
and viewport overflow. Main registers the development surface before branch use. Use the existing running preview
or a free assigned 5170–5199 development port; never stop another person's server. Private role shots use only
fixture identities/roles, never a real session. Capture output goes under `shots/campfire/`; append concise paths
and judgement to progress. Main copies selected evidence at integration; no video creation or live mic recording.

The main acceptance tour is one **complete six-seat secret-and-voice scenario**, using the real authored
manifest, actual campfire handlers and durable host. Five players plus Magistrate accept seats; one player takes
a text seat. Deliver a role only to its owner; compare the public/stream/Magistrate traces against an equivalent
secret world. Submit a night choice, retry it from another tab, advance only at the common deadline, deliver the
Watchman's own inspection, and confirm a public Gallery suspicion followed by one equal seated ballot. Restore
the host mid-secret phase without redrawing roles or replaying the result. During discussion, remove a speaker's
permission, replay its old grant and attempt republish/rejoin: voice must stay absent. The broadcast contains no
private choice/card and does not double the monarch's mic. Finish with a public result or a truthful interruption.
Run it with injected infrastructure immediately; repeat the voice segment against a real configured LiveKit room
when available. Record which evidence is simulated and which is actual transport enforcement.

Focused tests guard the nonvisual invariants behind that tour: the full finite role/timing settings grid,
terminal/timeout rules, two-world multi-move privacy including errors/legal moves, unauthorized/wrong-owner
requests, duplicate deadlines/results, lease generations and PTT release. Feed 50,000 authenticated simulated
Gallery identities through the server tally path once, asserting equality/dedupe and bounded output, without
rendering an army. Do not turn this into broad town, Atlas or every-state screenshot matrices.

Then look at the moment: `circle@1440x900.png`, `circle@390x844.png`, `dawn@1920x1080.png`,
`stream@1280x720.png` and one fixture private-hand phone shot. Inspect the warm faces in the desktop circle,
not another full capture matrix. If the control is mounted in the panel, inspect it at 318×496; inspect the
actual configured corner/strip framing at integration. Check horizon, feet/log contact, text readability,
lantern outcome and absence of private state on stream. Listen to the materials and a consenting live test
conversation; watch sit/stand, mouth silence and camera return. Screenshots establish neither sound nor timing.

Open all selected images with `view_image` as `$look` requires; fix cheap, flat, clipped or unexplained work.
No broad town/Atlas recaptures per campfire task. Main runs `pnpm verify` and integrated real-service checks before
merging/claiming launch-ready. Real-GPU targets remain unmeasured here: request the same fire/face/stream tour
on Tobias's PC, laptop/phone and OBS and identify the exact scene/camera/time to measure. A source-labelled
fixture proves composition and interaction only, not a live Twitch, identity, privacy or LiveKit success.

## Quality bar

This must earn “we sat around the campfire with the streamer and I got accused of being the wolf.” The place
holds before the game does: the logs have weight, the clearing belongs to its kingdom, quiet people are welcome,
and every face is worth a close shot. Restrained materials and audio make a long conversation comfortable.
The public stream is readable with UI mostly out of frame; the private hand can be operated by a thumb.
An honest text seat and interrupted night receive as much care as a winning reveal. The definitive proof is
several real people playing a full game, an audience member joining through one chat command, and a moderator
cutting an unsafe mic without a secret or voice reappearing on reconnect. No generated painted asset is needed
for this outdoor voxel scene; any later requested painting goes through `$chatdom-art` outside this code lane.

## References

- `work/references/prototypes.md`: FIFO facts/presentation seam and director expiry/return; independently
  reimplement, keeping prototype identity/reward assumptions out. No inherited Dusk Court implementation exists.
- `work/references/citizen-motion.md` and `crowd-animation.md`: grounded avatar routes, distance-driven gait,
  distinct timing and explicit rendering limits. Add an approved approach, never random walk-through-log paths.
- `work/references/sky-fog-time.md`, `voxel-meshing-light.md`: warm/cool night separation, stable fog and material
  rendering. Reuse current renderer contracts; no new world-lighting engine in this lane.
- Current primary LiveKit documentation checked 2026-10-30: [token lifecycle and grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
  describes source-limited publication, refreshed tokens and Cloud revocation; [participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
  documents permission updates/removal and the explicit revocation cutoff. Take the security constraints,
  not an assumption that mute or short initial TTL enforces a seat. SDK version behavior is main's integration check.
- Spec 22, `work/specs/22-tavern-tables.md`: bounded declarative Chalk and Taster, visibility-derived views,
  trace tests and the coordinated engine API. No external code copied; normal reference/source credits apply.

## Not now

This lane does not own the Royal Audience UI, generated game rules, other tavern games, voice outside the
campfire, private voice/text, real-person recordings, a new world/ledger, sign-in implementation, production deployment,
LiveKit project creation or hosting configuration. These are ownership boundaries, not cuts to the campfire.
The full Dusk Court, Gallery, text seats, public voice, truthful narration, failure states and real integration
proof above remain required; an unavailable dependency stays visible in progress instead of becoming pretend success.

## Decisions

- **2026-10-30 — One campfire, one rules engine.** Campfire authors Dusk Court in its excluded subtree of
  `packages/games`; tavern owns Chalk/Taster. Inject a typed adapter while they proceed independently, then
  prove the actual manifest in that engine. Campfire owns its session/seat/private-view handlers and voice
  supervisor through injected infrastructure;
  main binds trusted principals, router/storage/LiveKit services and the shared wire boundary.
- **2026-10-30 — Six to twelve includes the streamer.** Five to eleven players plus a nonplaying Magistrate
  fits the vision's voice bound and lets a five-viewer hamlet play every named role. No fake player fills the fire.
- **2026-10-30 — Authored rules where the old depth docs are absent.** The role powers, timing presets,
  eight-day bound, Fool outcome, advisory Gallery and deterministic missing-input behavior above are intentional
  local design decisions, to be verified across the full settings grid; they are not quotations of missing docs.
- **2026-10-30 — No hidden night progress or omniscient streamer.** A public Magistrate and fixed night deadline
  protect the show from accidental spoilers. Legitimate reveals are explicit declassifications, not arbitrary
  snapshot differences waived after a leak test fails.
- **2026-10-30 — Voice controls fail quiet.** Local emergency silence is immediate; only authority-confirmed
  permissions establish a removed mic. Token refresh/cutoff/join races are launch evidence, not optional polish.
- **2026-10-30 — Separate lanterns.** Dusk Court extinguishes a game token beside a log. Presence remains the
  citizen's warm home window; elimination never says someone stopped belonging to the kingdom.

- **2026-10-30 — Complete feature ownership.** The campfire lane owns its realm/API application handlers,
  domain persistence semantics, private projections and LiveKit permission supervisor, plus the browser adapter.
  Main binds infrastructure rather than inheriting unfinished feature logic. One deep secret/voice scenario
  and focused invariant tests establish behavior; the small final image set establishes the moment.
- **2026-10-30 — Independent work without false verification.** CF02 can finish the complete manifest,
  settings and trace corpus while Chalk is being implemented; handlers/scene use the typed injected port.
  Only real engine/Taster runs establish termination, fairness and privacy, and CF05 cannot close without
  those reports. No second reducer or fixture pass fills that dependency.

- **2026-10-31 — Current handoff: a lighter chat-led Dusk Court.** Keep the accepted CF01 clearing and make a legible, stream-staged gathering where chat votes one person once and the streamer leads. Deliver the lightweight playable presentation and vote handling through already approved boundaries; explicitly label simulated people, votes and events. The streamer cannot see private information they are not entitled to. Do not expand the current handoff into a full private-role game engine, voice infrastructure, tavern, walking or high places; those remain in the wider vision. The lane implements feature-local vote and room adapters against existing ports; main owns shared contract changes and cross-surface identity and authority bindings. A simulated round does not establish live integration.

- **2026-10-31 — Current handoff verification and ownership.** For each visual change inspect one stream-first 1920×1080 capture; use typecheck and affected tests for the step. This supersedes the older per-task capture matrix for this handoff. The lane implements feature-local durable adapters and runtime behavior against existing ports; main owns shared contracts and cross-surface authority and integration bindings. Report only actual missing authority or contract seams.
