# Spec 03: the chat lights the kingdom

Status: **frozen 2026-10-30 after independent Astra high review.**
Vision: `chatdom/ChatDom.md` principles 2, 5, 6, 15, 17 and §5; `chatdom/Twitch.md` §4;
`chatdom/Tech.md` §6.6 and §7. Research: `work/references/herald-presence.md`.

## What and why

A real message in `tobi4s_` lights that person's window in the kingdom. People quietly connected to chat count
without being named. A real broadcast lights the castle beacon; an offline broadcast rests. The same kingdom
surface reads one source adapter whether the source is real or explicitly SIMULATED. A disconnected source never
pretends the kingdom is still receiving chat. Homes wait through absence: presence switching off is not deletion.
This lane builds the read-only Herald producer for that experience, including authorization, recovery and removal.
It does not grant houses, award loyalty, or freeze Herald's eventual outbound powers.

## Current state

- `packages/shared/src/identity.ts` defines decimal-string person/broadcaster/kingdom IDs. Logins are not identity.
- `packages/shared/src/events.ts` separates occurred, received and committed clocks and live/recovered/simulated
  origin. Do not make a chat message a durable world fact just because these generic helpers exist.
- `apps/herald` and `packages/twitch` do not exist at this draft's start. The root workspace, TypeScript, Vitest
  and ESLint scripts already cover `apps/**` and `packages/**`; lane package manifests belong in their own scope.
- Main provides the presence schemas, deterministic reducer, privacy projection, settlement window allocator,
  browser adapter and `/presence-data` development/preview proxy. Those are read-only to this lane.
- AGENTS.md names an external `atlas.env` with app keys. No reader or broadcaster grants have been established
  by this spec. A missing-grant report is a real result, never permission to display fabricated live citizens.
- No database, conduit, token, live-channel status, real home ownership or successful chat connection is assumed.

## Rules

1. **R1 — A single real producer.** Bind the local backend to `127.0.0.1:5194`. Feed the main-owned public-frame adapter through
   `GET /presence-data/stream` (SSE), backed by the shared reducer/projection and main's stable window mapping.
   No Twitch tokens, private inputs or Chatters identities cross that endpoint. Browser code never calls Twitch.
   The main adapter also consumes the simulated source through the same reducer boundary; no separate live renderer.
2. **R2 — Narrow authority.** Real acceptance targets `tobi4s_`, resolved using Get Users and checked as a numeric
   broadcaster ID. This lane has no Twitch content writes: no messages, polls, moderation, raids or announcements.
   OAuth, conduit/shard/subscription lifecycle calls are permitted ingestion setup, restricted to lane-owned IDs.
   Never enumerate/delete/replace the Surveyor's subscriptions or conduit. Public read policy does not create user
   grants. Scope expansion requires main's review; no `user:write:chat` or manage scope is requested here.
3. **R3 — Real authorization, checked.** Use an app-token conduit with one outgoing WebSocket shard. The designated
   Herald reader must previously grant this client `user:read:chat user:bot`; `tobi4s_` must grant `channel:bot
   moderator:read:chatters`. Use the broadcaster's ID as Chatters `moderator_id`, so no moderator appointment is
   required. Before subscription/polling, verify those exact grants through Get Authorization By User. An absent
   grant disables that capability and reports what is missing. App credentials alone never pass this preflight.
4. **R4 — Token lifecycle.** Keep runtime app tokens server-side in memory. Validate at startup and hourly; check
   client ID, expiry and expected app-token identity. On an authentication 401 obtain one new app token single-flight,
   validate, recheck grants and retry once. A second failure stops the capability. Revocation, user removal, missing
   grant, or wrong-client response clears affected transient state and requires fresh authorization. Subscribe to
   `user.authorization.revoke` via the conduit and act only on this configured reader/broadcaster. Broadcaster
   revocation also deletes that kingdom's Twitch-derived private binding data and current public projection;
   reader revocation stops delivery until reauthorized. Neither is authority to delete Chatdom's own homes.
   No OAuth/user/chat body appears in logs, errors, URLs, screenshots or committed files. No user access/refresh
   token is retained by the runtime or grant bootstrap.
5. **R5 — Seven known subscriptions.** Subscribe only to version 1 `channel.chat.message`,
   `channel.chat.message_delete`, `channel.chat.clear`, `channel.chat.clear_user_messages`, `stream.online`,
   `stream.offline`, and `user.authorization.revoke`. Verify type/version, configured condition IDs, enabled state,
   conduit ownership and payload schema before mapping. Required cleanup subscriptions must be enabled before
   named chat activity is published. Unknown additions are ignored safely; malformed required fields fail closed with
   redacted counters. EventSub delivery ID, chat message ID and stream ID are different keys.
6. **R6 — One shard survives failures honestly.** Explicitly configure/reuse only the lane's conduit. Attach an
   outgoing session within the welcome deadline; watchdog keepalives; handle controlled reconnect handover without
   duplicate subscription creation. On ordinary loss repair the conduit shard and verify subscriptions; reconcile
   missing subscriptions idempotently. Accept 409 only after confirming the existing matching owned subscription.
   Back off with bounded jitter (1–60 s), cap simultaneous sockets at the controlled handover pair and stop timers/
   sockets on shutdown. A disabled or unverified shard is not healthy merely because the conduit still exists.
7. **R7 — Deduplicate and respect event time.** Bounded TTL caches dedupe delivery IDs and chat-message identities
   across a reconnect handover. Reject future, expired or pre-restart chat against the contract's clocks/TTL. A
   newly fetched current Chatters/stream observation uses its actual observation time and live source origin;
   historical recovered inputs are ignored by the world and never refresh leases, replay messages or stage a
   spectacle. Late online/offline observations cannot override a newer stream state. Report unrecoverable gaps.
   No claim of exactly-once delivery or replay of Twitch's lost events is allowed.
8. **R8 — Presence is evidence with an expiry.** Poll Chatters once per minute while the channel is live and its
   capability authorized, using `first=1000`, cursor pagination and ID dedupe. Build an observation only after a
   complete successful bounded sweep. Repeated cursor, failed page, deadline or truncation leaves coverage partial;
   never turn a partial sweep into departures or zero lights. Apply the frozen reducer's expiries, including while
   offline/disconnected. A chat act may name its author; Chatters alone may only light unnamed windows. Do not infer
   people from viewer count, an empty name, a follower list, anonymous notices or a source frame's count.
9. **R9 — Public privacy by construction.** Feed Chatters IDs only to the trusted server reducer/allocator. The
   public frame contains stable window slots and permitted names, never a lurker ID/login/display name, avatar,
   profile URL, per-person private activity or debug map. A first observed chat act may reveal that author according
   to the frozen reducer. Do not create homes or claim follow tenure from a slot assignment. The slot mapping is
   durable, server-only and uses main's frozen bindings boundary; no parallel person identity or public allocator.
   Persist new bindings atomically before publishing them, with owner-only file permissions in a configured
   external data directory. One writer owns a mapping; corrupt/unwritable storage fails closed rather than changing
   existing slots. Store only the minimal versioned kingdom/person/slot table, never roster histories or chat text.
   No name-only identities. Report slot capacity exhaustion explicitly, never merge people or invent a home.
10. **R10 — No chat text leaves ingestion.** This presence contract contains no bubbles or message text. Extract
    only the permitted identity/activity fields from real chat and discard its body immediately. Never store raw
    event envelopes, fragments, commands/text or Chatters snapshots on disk, in a database, metrics, exception
    breadcrumbs or replay fixtures. Retain only bounded message-ID/author/time metadata needed for dedupe and
    cleanup. Delete cancels that message's pending activity; user clear cancels pending activity by that author;
    room clear cancels all pending activity. Tombstones prevent late delivery from restoring canceled activity.
    `clear_user_messages` additionally maps to `remove` with `reason: moderated` and
    `until = observedAt + 600_000`: this is Chatdom's finite protective hold, never a claim Twitch imposed a ten-minute
    timeout or ban. A global chat clear does not erase identities or turn off everybody's lights. Delete alone does
    not erase the author's identity. Send a fresh current projection to SSE joiners, never historical frames.
11. **R11 — Live, offline and unknown differ.** Reconcile Get Streams on startup, after a gap and every minute while
    tracking this channel. Only an observed `type: live` wakes the beacon; rerun/playlist does not. A successful
    empty Get Streams response means observed offline. Failed/partial requests mean unknown or stale, retaining
    the last observation time. Chat transport health, Chatters coverage and stream state are distinct. A recent
    keepalive alone never means stream LIVE. Losing required chat/cleanup delivery marks the source unavailable:
    close SSE so main's adapter invokes `unavailable`, rather than publishing fresh LIVE frames based on Get Streams
    alone or forging a stream-offline input. Resume only after delivery coverage is restored and current state
    reconciled. All source changes and expiry advance the public frame revision.
12. **R12 — Bounded work.** Runtime requests have timeouts and cancellation, bounded concurrency and bounded queues.
    Honor rate-limit reset/remaining headers and 429, coordinate the app budget shared with Surveyor, and keep source
    freshness honest while waiting. A sweep has at most 60 pages and 45 seconds; overflow marks partial and raises
    a redacted diagnostic. At 50,000 synthetic connected identities it completes without per-person browser
    payloads beyond the frozen frame cap. Slow SSE clients are disconnected or coalesced to the latest frame;
    cleanup/removal may never be trapped behind an unbounded message queue. Record cap hits, never silently omit.
13. **R13 — Simulation is a different origin.** Synthetic fixtures/replay enter through the same parser/reducer and
    public frame path with `simulated` origin and the visible word SIMULATED. They cannot open a real Twitch writer
    or replace a failed real source silently. No real chat bodies become fixtures. Test protocol reconnection with
    owned local mocks; verify current Twitch CLI coverage before using it for chat, which needs synthetic payloads.
14. **R14 — Operable without secrets in output.** `check:auth` reports resolved configured channel/reader, capability
    availability, missing scopes, observation time and a setup path using scope names only. `status`/health separates
    configured, connecting, healthy, partial, stale, unauthorized and stopped conditions using the frozen frame's
    permitted source states. No raw provider error body. Shutdown aborts work and clears all transient chat data.

## Contracts

The reviewed first-consumer contract is frozen in `packages/shared/src/presence.ts`. Use the exported schemas/types through
the shared package. No local parallel schema or generic event catalogue is authorized.

- `PresenceInputSchema` / `PresenceInput`: trusted private ingress with `version: 1`, `id`, `kingdomId`,
  `observedAt` (epoch milliseconds), `origin: live | recovered | simulated`, and
  `kind: stream | observe | remove | restore`.
  A `stream` has `live` and nullable `sessionId`. An `observe` has `source`, `coverage` and unique `people`;
  `chatters` requires `anonymous` people and complete/partial coverage, while `chat` requires activity coverage
  and permits a named person with `displayName`. A `remove` has `personId`, reason
  `timeout | ban | forget | moderated`, and nullable `until`; this lane uses the finite `moderated` hold above.
  `restore` has only `personId` beyond common fields and requires a separately authorized genuine restore action;
  this read-only lane does not generate one from reconnect or timeout expiry. Do not invent a Twitch ban/timeout
  reason from chat-clear events. Only server code sees `personId`.
- `PRESENCE_MINUTE_MS = 60_000`, `PRESENCE_LEASE_MS = 90_000`, `STREAM_LEASE_MS = 180_000`. Use the reducer's
  lease/minute behavior, rather than inventing a second timer-based presence policy.
- `KingdomPresenceFrameSchema` / `KingdomPresenceFrame`: complete public snapshot with `version`, `kingdomId`, `epoch`,
  `sequence`, `asOf`, `origin: live | simulated`, `streamLive`, `connection: fresh | stale | offline`, and
  `windows: { slot, present, publicName, since }[]`. At most 65,535 unique slots, numbered 0–65,534. No person IDs
  or text. Absent windows have `publicName: null`; stale/offline frames cannot claim present windows.
- `PresenceFeed`: readonly `label: 'SIMULATED' | 'LIVE'` and
  `subscribe(receive: (frame: KingdomPresenceFrame) => void, unavailable: () => void): () => void`. Main's browser
  adapter implements this over SSE; labels are only shown LIVE when actual source evidence is fresh, otherwise
  the view explicitly says not connected. A transport object's label is not proof of liveness.
- `packages/world` exports the pure functions below. Main owns reducer/projection semantics; Herald persists a
  private stable `PresenceBinding` table using that boundary. A binding is not a deed, follow tenure or proof of
  citizenship. Main's real generator provides empty presentation slots, never invented owners.

```ts
createPresenceState(kingdomId: KingdomId, origin: 'live' | 'simulated'): PresenceState;
applyPresence(state: PresenceState, input: PresenceInput, now: number): PresenceState;
advancePresence(state: PresenceState, now: number): PresenceState;
presenceTick(state: PresenceState, minuteAt: number): {
  readonly state: PresenceState;
  readonly credit: PresenceMinuteCredit | null;
};
projectPresence(
  state: PresenceState, bindings: readonly PresenceBinding[], now: number, sequence: number, epoch?: string,
): KingdomPresenceFrame;
// PresenceBinding = { readonly personId: PersonId; readonly slot: number }
```

`now` is an injected monotonic authoritative epoch-millisecond clock; passing a backward clock throws. Future
observations and `recovered` inputs cannot refresh evidence. Keep private state server-side. `presenceTick` accepts
an exact minute boundary only, deduplicates in the state and never catches up missed minutes. Its optional private
`PresenceMinuteCredit` contains kingdom/origin/session/minute and sorted person IDs, a sampled eligibility result
only. This lane does not persist awards, rewards, watched minutes or a loyalty ledger; never publish that credit.

The SSE data is exactly one JSON `KingdomPresenceFrame` per event, validated before publication. Supply a fresh
opaque `epoch` at producer startup and monotonic `sequence` within it; the browser accepts a different epoch only
at a new transport connection. Same-epoch reconnect retains its sequence watermark. Reconnect supplies the latest
complete snapshot, never a replay log. A moderation restore never reverses a forget opt-out.

`assignPresenceSlot(bindings, personId, availableSlots)` in `packages/world/src/presence-slots.ts` returns an existing
slot, appends one unused supplied slot, or reports `slot: null` at capacity. Use the actual slots from
`generateKingdom(config).homes.map(home => home.slot)`; the config must match the main preview. Preserve the returned
bindings durably before publication. Never manufacture follow dates or real deeds from this presentation map.
The browser adapter/proxy and scenario shots are being integrated by main; H01 can start independently.

## Scope

May write `apps/herald/**`, `packages/twitch/**`, `work/lanes/herald/PRD.md`, `work/lanes/herald/progress.txt`,
`work/specs/03-herald-presence.md`, and `work/references/herald-presence.md`. Everything else is read-only, including
`packages/shared`, `packages/world`, root lockfile/manifests/scripts, web routes/global CSS and the running Surveyor.
You are not alone: preserve others' edits and ask main for integration changes. Own package manifests are allowed;
main installs dependencies/updates lockfile. Local development uses port 5194; optional grant bootstrap uses 5195.
No production deployment, server configuration, DNS, tunnels or additional public service is authorized.

## Setup and missing grants

The lane supplies these package scripts, with secrets loaded inside Node from the external env file, never pasted
into command arguments: `check:auth`, `authorize`, `provision:source`, `dev`, `replay`, and `check:source`.
Nonsecret configuration is
`HERALD_CHANNEL_LOGIN=tobi4s_`, a designated `HERALD_READER_LOGIN`, `HERALD_CONDUIT_ID` once explicitly provisioned,
`HERALD_DATA_DIR` outside the repo for the private binding table, and `HERALD_REDIRECT_URI` exactly matching an
existing registered callback. App key names remain
`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`; `EVENTSUB_SECRET` is unnecessary for a WebSocket shard. This spec creates
no credential values and assumes no existing conduit ID or grant.

1. Run `pnpm --filter @chatdom/herald check:auth`. It performs only public identity and app/grant reads. Missing
   configuration or grant returns nonzero and names the missing capability; public stream state may still work.
2. If a grant is absent, `pnpm --filter @chatdom/herald authorize -- --role reader` requests only
   `user:read:chat user:bot`; `--role broadcaster` requests only `channel:bot moderator:read:chatters`. Open the
   generated Twitch consent URL as the correct account. Never auto-launch or approve consent for the user.
3. The helper accepts only the configured existing redirect URI, binds its local callback on 5195 if that URI is
   registered for local use, verifies single-use CSRF state, exchanges the code server-side and validates exact
   user/client/scopes. It discards access/refresh tokens without revoking the grant. It prints no code/token or
   callback query. Re-run `check:auth` using the app token to verify the recorded grant.
4. If the callback is not registered or no reader account is designated, report precisely that dependency in
   `progress.txt`; main/team supplies registration/account choice. No new app, moderator role or secret is invented.
   `pnpm --filter @chatdom/herald provision:source -- --create-development-conduit` explicitly creates one
   development conduit only if no owned configured conduit exists; record its ID outside the repo with other
   nonsecret deployment configuration. If the app has no remaining conduit capacity, stop and report it. Never
   select an arbitrary existing conduit or evict another service's conduit.
5. Without grants, `replay` remains independently usable and SIMULATED. That does not complete the required real
   chat integration. A redacted check log distinguishes “missing grant,” “channel offline” and “no message observed.”

## Acceptance

For each code task run `pnpm typecheck`, `pnpm lint`, `pnpm test -- apps/herald packages/twitch`, and `pnpm build`;
all must pass. At the integration milestone run `pnpm verify` after main has wired its producer/consumer seams.
The package source check must exercise the actual endpoint and shared reducer/projector, not an unrelated echo.

| Evidence | Required result |
|---|---|
| Authorization | Mock wrong client/user/grant, denied consent/CSRF, expired app token, concurrent 401, revoke and 403; runtime stops affected capability, emits no secret/text and no fake healthy state |
| Protocol | Mock welcome deadline, keepalive loss, reconnect overlap, ordinary shard loss, 409 conflict, disabled shard, duplicate/reordered delivery, bad condition/version and shutdown; one owned active path, bounded timers/caches |
| Chat/privacy | Inject names, HTML/RTL/long text, lone Chatters identities, 50,000-user sweep, duplicate pages, page failure and cap; anonymous frame has no lurker identifiers/names; successful named chat lights one stable slot |
| Cleanup | Delete before/after delivery, user/room clear, TTL, stalled SSE consumer and new SSE joiner; no chat text is ever published/stored, canceled pending activity cannot return, expired presence remains absent |
| Stream/source | Startup live/offline/unknown, rerun, stale/late online/offline, lost keepalive with still-live stream, unavailable Chatters; provenance/freshness preserved and no guessed offline/live |
| Recovery/storage | Restart with same durable mapping and reconnect with same chat ID; slots remain stable, transient text is absent, recovered observations create no live chat spectacle |
| Real read | `check:auth`, then a real authorized `tobi4s_` source session and received real message through `/presence-data/stream`; record timestamps/counts and public window change, never message body/token or secret env values |
| Missing grant | Exact nonzero diagnostic and consent/setup path demonstrated. This can complete auth tooling but does not tick real-read acceptance; leave integration task incomplete until actual grant/message evidence exists |

Main owns the browser presentation. Once main wires its scenario, run `pnpm shots --area herald` and capture
1440×900, 390×844 and stream
1920×1080, then open every relevant file with `view_image`. Evidence belongs under `shots/herald/`: real named
window, anonymous Chatters window, stale source, offline beacon and SIMULATED replay; simulated captures have a
`simulated-` filename and visible label. Extend scenario hooks only through main, not by editing the shared shot
script in this lane. Screenshots must not expose real chat text or unnamed-user identities. Server-only tasks
before integration need tests/redacted logs, not decorative screenshots. Real read evidence remains mandatory;
synthetic frames alone do not demonstrate Twitch integration.

## Quality bar

One actual message must reach the warm citizen window through the same trusted path that survives deletion and a
reconnect. No raw IDs or provider errors appear in the kingdom. Newcomers are real people, quiet ones stay unnamed,
and an observed source failure remains understandable. The real projection must stand beside the simulated kingdom
without fake homes, crowds or LIVE claims. Window/beacon art follows `chatdom/Artstyle-Soul-Feel.md` and main's
presence/settlement implementation; the Herald lane contributes truthful data, not a separate status dashboard.

## References

- `work/references/herald-presence.md`: current official authorization matrix, conduit WebSocket transport,
  grant verification, bounded reconciliation and the limits of Chatters evidence.
- `.agents/skills/twitch-dev/SKILL.md`, `twitch-chat/SKILL.md`, `twitch-api/SKILL.md` and `twitch-eventsub/SKILL.md`:
  local protocol/testing references. Recheck official docs before changing event versions/scopes or CLI assumptions.

## Not now

No outbound action catalogue or writer, command/game parsing, Forge/AI forwarding, follower/subscription economy,
minute/nights/coal ledger, Genesis, real-home allocation/ownership, whole-platform ingestion, panel identity,
production database/inbox/Valkey deployment, webhook shards, scaling policy or future Herald powers. This bounded
lane is the first real presence producer on a frozen contract; it does not silently freeze the rest of Herald.

## Decisions

- **2026-10-30 — Explicit replay origin.** SSE transport and evidence origin are independent. The browser's
  single adapter takes an explicit expected origin (`live` by default, `simulated` for Herald replay) and derives
  its feed label from that choice. It rejects cross-origin frames while retaining all schema/realm/epoch/sequence/
  freshness checks. The replay URL is `/?source=herald&presenceOrigin=simulated`, including the equivalent stream
  route. This corrects main's initial live-only adapter without changing the public frame schema.

- **2026-10-30 — Read-only first consumer.** Main authorizes real read integration for `tobi4s_`; no outbound Twitch
  action is part of this lane. Missing grants are a visible dependency, never simulated success.
- **2026-10-30 — App-token conduit with outgoing shard.** Main chose one app-token conduit and one WebSocket shard
  to preserve the Tech account model without requiring public HTTPS or retaining Herald user tokens. Generic
  user-token WebSocket and webhook implementations are outside scope.
- **2026-10-30 — One browser adapter.** Main owns shared presence inputs/public projection, deterministic reducer,
  the private slot-binding contract and web integration. Herald persists the stable private bindings and owns the
  real SSE producer on 5194;
  simulated and real sources traverse the same reducer and adapter. A window slot is not a grant of a home.
- **2026-10-30 — Moderation is a protective hold.** Main chose a contract-specific `moderated` removal for
  `channel.chat.clear_user_messages`, held ten minutes from its observation time. The reason names Chatdom's
  protective behavior and makes no claim about Twitch's unknown ban/timeout duration. Global clear only clears
  transient activity buffers. Text/bubbles stay outside this presence contract.
- **2026-10-30 — H01 lane choices (herald worker).** Scripts run one Vite SSR bundle (`apps/herald/dist/herald.mjs`,
  every dependency inlined), rebuilt by each script, because workspace sources use extensionless imports Node cannot
  run directly. App keys are read only from the external secrets file and are never placed in `process.env`;
  nonsecret `HERALD_*` settings come from the environment or the optional `~/.config/chatdom/herald.env`.
  Re-consent for one role also requests the Herald scopes the same account already granted, so one account in both
  roles never loses the other grant; non-Herald scopes are never requested. A `user.authorization.revoke` for a
  configured account blocks its capabilities until Get Authorization By User first shows the grant gone and then
  shows a new one. Helix admission keeps 100 points of the shared client bucket in reserve for the Surveyor. The
  consent callback answers with a 303 to a result page, so the code does not stay in the address bar or history.
- **2026-10-30 — H02 lane choices (herald worker).** Real ingest and SIMULATED replay both produce one narrow
  `Observation` type (chat author ID + display name, Chatters IDs, stream state, user clear) with no field that
  could hold text; one mapper turns it into `PresenceInput`, namespacing input IDs per key family (`chat:`,
  `sweep:`, `stream:`, `clear:`) so delivery, message and stream keys never collide. Display names lose control
  and bidi override/isolate characters; a name with nothing left keeps its author unnamed. The binding table is
  `<HERALD_DATA_DIR>/presence/<kingdomId>.json` (default `~/.local/share/chatdom/herald`; refused inside the
  repository), `[personId, slot]` pairs only, mode 0600 in a 0700 directory, written temp+fsync+rename+dir-fsync
  under a lock file `<pid> <start> <nonce>` created atomically (hard link of a finished file); a second store in
  the same process is refused, a lock is stale only when its PID is gone, reused (different `/proc` start time)
  or this PID from an earlier run, and every write first re-reads the lock to prove it still belongs to it; corrupt, foreign, insecure or unwritable tables stop the source rather than move a slot.
  SIMULATED sources keep bindings in memory, so synthetic people never reach a real data directory. The presentation
  layout comes from `HERALD_KINGDOM_SEED/TIER/FIRST_YEAR/YEAR`, defaulting to a hamlet seeded by the channel login
  and founded in a fixed 2026 so slot numbers keep naming the same homes next year. Frames are re-projected on every
  applied input and on a 1 s expiry tick; the sequence advances only when `streamLive`, `connection` or windows
  change. SSE events are bare `data:` frames with `retry: 2000` and 15 s comment keepalives; a subscriber holds at
  most one unsent frame (newer replaces older) and is disconnected after 10 s continuously backed up; 32
  subscribers at most. An unavailable source answers 503 and closes open streams. Health is `GET /health` on
  5194, outside the proxied `/presence-data` prefix. When the input queue (2,048) is full, activity observations
  are dropped and counted; removals and stream changes always queue.
- **2026-10-30 — H03 lane choices (herald worker).** All Helix calls share one `HelixSession` (single-flight 401
  renewal, the shared request budget). Writes never wait out a 429: on conduit or subscription creation it means a
  client limit (`limit_reached`), not pacing; 410 is `gone`. Provisioning and the runtime touch only
  `HERALD_CONDUIT_ID`: its existence and shape through Get Conduit Shards (404 means missing or another client's,
  never a fallback to some other conduit) and its subscriptions through the `conduit_id` filter; Get Conduits is
  never called. `--create-development-conduit` creates one single-shard conduit only when none is configured or the
  configured one is gone (Twitch deletes a conduit 72 hours after its last shard went down), and records the ID in
  the nonsecret settings file (atomic rewrite, 0600). A 409 is accepted only when a fresh listing of this conduit
  shows the matching enabled subscription; an identical one elsewhere is `conflict` and left untouched. Only this
  conduit's own disabled copies of planned subscriptions are deleted before recreating. Chat subscriptions are
  never requested before Get Authorization By User shows their grants, so a missing grant is reported without a
  403 probe. Publishing requires `channel.chat.message`, the three cleanup types and `user.authorization.revoke`
  enabled; `stream.online`/`offline` are wanted but not required, because H04's Get Streams reconciliation also
  observes stream state. The shard re-assigns its session on every welcome, including after a controlled handover
  (idempotent); the attach deadline is welcome + 10 s, the welcome timeout 15 s, the watchdog keepalive + 3 s;
  backoff takes a random point in the upper half of 1 s × 2ⁿ, capped at 60 s; reconnect URLs are followed only on
  the configured scheme and host. A gap is recorded only for delivery Herald had and lost. Every 60 s (and after
  each attach, revocation or grant change) Get Conduit Shards must show shard 0 enabled on our session, else the
  shard is repaired. Event time is `message_timestamp`: up to 5 s after our receipt it is taken at receipt time
  (the message existed by then, and the reducer ignores future observations), further ahead is rejected as
  future, older than the presence lease is expired, and before this ingest started is pre-start. Dedupe keys and
  tombstones (message IDs, per-author clear times, the room clear time) live ten minutes in bounded maps with
  counted evictions. Delete, user clear and room clear cancel activity still waiting in the source queue through a
  guard asked right before it applies, including after its binding write. A room clear never changes presence.
  Messages a shared chat brings in from another channel are guests, not citizens (`chatdom/Twitch.md` §9), and
  light nothing. Delivery health is on local `/health` as `source.delivery`: shard state, coverage by type, gaps
  and counters, never IDs, names or bodies.
- **2026-10-30 — H04 lane choices (herald worker).** Pushed `stream.online`/`offline` and polled Get Streams both
  enter one `StreamTracker`, the only path from stream state to the source. Get Streams is asked at startup, every
  minute and after every return of chat coverage (Twitch does not replay a gap). The source publishes again only
  once that read has settled, so the first frame after a gap already carries the current state. Get Streams is
  cached and can trail EventSub, so for 120 s after a pushed change a contradicting answer is set aside as lag.
  Broadcasts that ended stay ended (bounded list of 64 IDs); a real restart brings its own `stream.online`. A
  listed non-`live` type (an error) and a failed request change nothing. The last observation keeps its time and
  the reducer's 180 s stream lease turns it stale; minute polls while offline keep the beacon `offline`, not `stale`.
  Health keeps `live`/`offline`/`unknown` and whether the state was `recovered` after a gap. Get Streams parsing drops
  title, game and viewer count. Get Chatters parsing keeps only user IDs and the cursor, never logins or names. A
  sweep runs only while a fresh live broadcast is observed and the broadcaster's grant holds. It uses
  `first=1000`, at most 60 pages and 45 s, and dedupes by ID. It is `complete` only when Twitch returns a last page
  without a cursor. Page cap, deadline, a cursor seen before, a failed page or a 429 that resets past the deadline
  make it partial: a partial sweep refreshes only the people it saw, and one that saw nobody submits nothing. Its
  observation time is when the first page was asked for, so departures never outrun the evidence. A sweep never
  overlaps the next minute; the skipped minute is counted. A refused sweep (401/403) asks the authority to recheck
  the grant. Chatters people get durable slots through the same binding table as chat authors and stay unnamed.
- **2026-10-30 — H02 freshness and captures (herald worker).** Main's adapter expires a frame one presence lease
  (90 s) after its `asOf` and ignores a frame whose sequence does not rise, so a steady kingdom (quiet people
  re-observed each minute, a resting offline beacon) would read as a lost connection. The source therefore projects
  an unchanged frame again with a new sequence and `asOf` once it is 30 s old (`FRESHNESS_REFRESH_MS`), only while
  available. The sequence still never advances without a new projection. Until main adds `pnpm shots --area herald`,
  `pnpm --filter @chatdom/herald shots -- --base-url <main preview>` is the lane's capture script: it starts each
  SIMULATED replay (and with `--live` the real `dev` source) on 5194 with the layout main's scene renders (seed,
  tier, first year 2025 for a hamlet and 2022 for a town, year 2026), waits on Herald's local health for the
  scenario's state, opens `/?source=herald[&presenceOrigin=simulated]` and `/stream`, fails when the ribbon, lit
  windows or names contradict that health, and writes `shots/herald/simulated-<scenario>@…` / `live@…` plus a
  `report.json` of conditions and counts only. Main can call it from its own shots area unchanged.
- **2026-10-30 — H02 real source (herald worker).** With tobi4s_'s four grants recorded, `dev` runs the real source
  end to end: shard attached, seven subscriptions enabled, Get Streams settled, frames published. The capture
  script checks a real source against main's ribbon wording for its frame (`fresh` LIVE CHAT, `offline` STREAM
  RESTING, `stale` CONNECTION LOST), refuses lit windows while it is not fresh or beyond the frame's present
  count, and waits for the first published frame before shooting. Main's scene now lays out homes with
  `generateSettlementPlan`; its slots equal `generateKingdom`'s for the hamlet 2025, town 2022 and hamlet 2026
  layouts at seed `willowmere`, so Herald keeps binding to `generateKingdom` until the lane is merged with main.
- **2026-10-30 — H03 real-read evidence (founder).** Writing chat needs `user:write:chat`, which this lane never
  requests, so Herald cannot produce its own test message. H03's real proof is the live provisioning against
  `tobi4s_`: the owned conduit, shard 0 attached, all seven subscriptions enabled with the granted scopes and the
  authorized `dev` source publishing through `/presence-data/stream`, together with green protocol tests. The first
  real chat line arrives only when someone types in `tobi4s_`. It is recorded later as a redacted timestamp with
  counts. It is not a blocker for H03.
- **2026-10-30 — Handover gap (herald worker, H03 follow-up).** If the old EventSub socket closes before the
  reconnect target is welcomed, nothing is delivered until the new session is attached. The shard therefore detaches
  at once (`handover_gap`, gap open from the close), keeps the pending target, and reports the gap when that target
  attaches (or when it fails and a fresh session repairs the shard). The runtime closes SSE on the detach and, on
  re-attach, reconciles Get Streams before publishing again, exactly as after ordinary loss.
- **2026-10-30 — H04 evidence (herald worker).** `check:auth -- --observe` reads Get Streams once and runs one
  bounded Chatters sweep with the same code `dev` uses, printing conditions and counts only; it feeds nothing into
  presence, so it may run while the channel is offline (a running source still sweeps only while live). The lane
  capture script's `restart` run plays the SIMULATED evening twice over a scratch binding table in a temporary
  directory (`replay --bindings <dir>`, refused for Herald's real data directory), with sweep order reversed the
  second time, and requires each public frame to seat every lit window and name on the same slot. A control run
  without the table must seat them differently, so the comparison can fail.
