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
