# raid-show seams

These seams were frozen on 1 November 2026. To change one, write to both lanes' SEAMS.md. Until the other side lands, show the honest unavailable state and never a stand-in that pretends. Ask with a `needs:` line in `progress.txt` that has the exact patch written out.

## 1. The gate-mode picker (atlas-map provides, raid-show consumes)

atlas-map exports `mountAtlas(el, { mode: 'gate', ... })`, or its equivalent, from `apps/web/src/atlas`. raid-show adapts it to the existing browser port `AtlasGateHost` in `apps/web/src/raid-gate/ports.ts`, and never reaches into Atlas internals.

What raid-show needs from gate mode:
- `open(from)` and `close()`: the map opens at the source kingdom. Opening it has no side effects.
- A pick event, `{ kind: 'pick', kingdomId }`, and a close event, delivered through `subscribe`. The finder's order belongs to atlas-map: live road neighbours first, then live same-language or nearby realms, then search, with smaller live channels first in each group and never paid ordering.
- `resolve(kingdomId)` returns the channel and its land (`founded` or waiting land), under the Atlas's own visibility rules.
- `follow(raid)` attaches the viewer's map to the public caravan of one witnessed `AtlasRaid`, once per raid ID. It is presentation only.
- `travel(stage)` takes the stages `rise | road | drawing | arrived | back`, once per ticket, at the pace of the authority's answers: about 0.8 s rise and 1.5–3 s road (spec 23 R6). The map retains the source world for 60 s for a quick return.
- The wax seals and arms come from the Atlas's public `heraldry` module, so the gate, the caravan and the map show identical arms.

raid-show owns the preview, the Start press and everything after it. Until gate mode exists, the gate board runs with `atlas: null` and says the map is not available. It never shows a stand-in picker.

## 2. The roads feed (raid-show publishes, atlas-map stores and draws)

raid-show writes every witnessed raid, in both directions, into an append-only feed in the realm. Incoming raids into a kingdom and gate departures out of one are both included. Verified ingress writes the feed and any gate landing together. The gate's `AtlasRoadIngress.observe` acknowledges only an identical, already witnessed feed record; it cannot invent a road from a caller assertion. The atomic landing settles its road outbox as delivered, so recovery does not create another store or another road.

- Route: `GET /realm/raid-roads?after=<cursor>&limit=<n>` on the realm (registered by `mountRaidShowRoutes` in `apps/realm/src/main.ts`, code in `apps/realm/src/raid-gate/{http,observations}.ts`). `limit` is at most 200. The public gateway also allows `/live-realm-data/realm/raid-roads` and the direct route.
- Reply: `{ version: 1, items: AtlasRaid[], next: string | null }`. Every item passes `AtlasRaidSchema` (`packages/shared/src/atlas-raids.ts`) with `source: 'herald'` and `delivery: 'resumable'`. `id` is stable and derived from the EventSub message ID, `occurredAt` is Twitch's event time, and `observedAt` is the receipt time.
- Guarantees:
  - Items are ordered by a monotonic feed sequence, and a cursor resumes exactly after a restart.
  - A raid appears once, even when Twitch delivers it twice.
  - The feed holds no person data (no riders, no walkers, no stamps), only channel-level public facts.
  - A live realm never serves a simulated-origin record.
- Cursor contract: omit `after` on the first read. Every nonempty page returns its tail cursor, even the last page. Persist it after applying the items. Poll again with that cursor; an empty page returns `items: []` and preserves the cursor. Cursors are opaque to consumers, origin-bound and ordered by commit, rather than by event time. Never reset to the beginning because a page has fewer than `limit` items.
- Exact EventSub IDs remain private evidence; public raid IDs are `raid.` plus the SHA-256 of that ID. Both channel identities and the original provider time remain immutable on redelivery, with the existing five-second clock allowance. A newer receipt never refreshes the show.
- Dated pennants: `GET /realm/raid-pennants/:kingdomId?limit=24` (maximum 64) returns `{version:1,items:[{raidId,from:{kingdomId,login,name},occurredAt}]}`, newest incoming feed sequence first. The wall derives the same arms from `from.kingdomId`; no person data is exposed. The public gateway allows this literal read, including through `/live-realm-data`.
- atlas-map owns dedupe at its ledger, thickness, the fade to dotted after an unused season and never deleting a road (spec 23 R11). Following a road on the map takes you there. raid-show writes no second road store and renames no chain.

## 3. Scene mounts (grand-world owns `apps/web/src/kingdom/scene.ts` and the stream host)

raid-show mounts through existing hooks and its own new `apps/web/src/kingdom/moments/raid-*.ts` files. The incoming caravan already rides `SceneOptions.momentFeed`. raid-show asks for the following with `needs:` lines, and grand-world or the integrator adds a small typed mount.

- **Gate party:** a read-only mount fed with `{ phase: 'gather' | 'setout', leader: walker slot | 'standard', marchers: walker slots, progress }`. It draws the real walkers at `placeAnchor('gate')`, lit through the light field, and walks them out through the gate on set-out. This is the mount the raid-road lane asked for, and it replaces the paper figures.
- **Raid guests:** guests who arrive with a raid start at the gate. The realm spawn for a non-citizen arriving with a witnessed raid uses the gate anchor. This needs a patch to the spawn fallback in `apps/realm/src/founded/provider.ts` (realm core, the integrator's).
- **Pennant wall:** a mount for dated pennants beside the gate, fed from the realm (raider arms, date, raid ID), at most N shown with the newest first.
- **Camera:** the gate shot through the existing `CameraLease`, and the gate anchor's screen point so words and seals sit over it.
- **Shutter (stream host, `apps/web/src/stream/**`):** the stream view honours `{ shutter: 'on' | 'off' }` from the realm within one second. It cuts to a calm wide shot with no names, no made things and no voices until the shutter is lifted.
- **Grand land:** grand-world keeps a true gate anchor, a walkable gate route and the light field on the grand land, as on the old land.

## 4. The HUD slot (play provides the slot, raid-show provides the pieces)

play owns the in-world HUD, the Esc menu and the minimap, and gives them typed slots. raid-show mounts its own pieces into play's slot:
- `RaidCall`: "MashaD4's raid is at the gate" for people here, and the march call (join, leave, Twitch's countdown) when the monarch opens the gate.
- `RaidGuestWelcome`: the greeting by name for a guest who walked in, plus a Watch on Twitch link.
- `RaidJourney`: the journey stages and Return home.
- **Guest crest on walkers:** `guestCrest(slot) → { kingdomId, arms, colours } | null`, which play's walker label and outfit layer draw as a crest and pennant. raid-show never edits walker rendering.

Until the slot exists, raid-show renders these pieces in its own gate overlay and moves them into the slot when it lands.

## 5. Generic chat commands (Herald provides; gather, pier and other realm features register)

**2026-11-01 — Founder-requested replacement for gather's proposed game-specific ingress (§3 of gather's SEAMS.md).** No gather command list or game-specific route enters Herald. Gather and pier adopt this shared seam; their SEAMS.md should point here instead of asking for `parseGatherCommand` in Herald.

Rechecked against gather's section 3 in its worktree: the common envelope replaces `GatherChatEnvelopeSchema` and `GATHER_CHAT_ROUTE` at this boundary. Gather can retain its game-local parser for argument validation, but Herald never imports it. The generic transport and registry pass 41 focused checks, including all six requested names, moderation cleanup and restarted delivery. There are deliberately no registrations for another lane's games here: until gather and pier install their handlers below, the common route returns `ignored`.

- Shared contract: `packages/shared/src/chat-commands.ts`, exported by `@chatdom/shared`. `parseChatCommand(text)` parses any lowercase command name (case-insensitive input), up to 32 name characters and a nullable argument of at most 32 characters. Controls are refused. All six requested names (`sus`, `drop`, `roll`, `hold`, `pull`, `fish`) use the same path. Existing private `!forge` and battle `!strike` retain their existing owners. Ordinary `!` messages remain excluded from speech.
- Route: `POST /internal/realm/chat-commands` (`CHAT_COMMAND_ROUTE`), mounted on the existing realm listener by one additive `mountChatCommandRoute` call in `main.ts`. Same Herald bearer authentication as other private ingress; panel credentials are refused. The public gateway never exposes it. Strict 4 KiB body, no query parameters, origin isolation, bounded concurrency.
- `ChatCommandEnvelopeSchema` is the **direct body**, with common fields `{version:1,origin:'live'|'simulated',kingdomId,messageId,at}`. Command bodies add `{kind:'command',chatter:{twitchId,login,displayName},command,arg}`. `messageId` is Twitch's actual chat message ID; `at` is its witnessed event time. No ordinary chat body or provider payload is forwarded.
- Cleanup bodies add `{kind:'cleanup',twitchId,reason:'ban'|'timeout'|'delete'|'clear',targetMessageId}`. Here `messageId` is the EventSub delivery ID. A delete has its author and target chat message ID. Other cleanup has `targetMessageId:null`; `twitchId:null` means a room clear. `channel.chat.clear_user_messages` reports `reason:'clear'` with an identity: that event does not distinguish bans from timeouts, and Herald does not guess. Cleanup bypasses incomplete chat coverage and still invalidates pending commands.
- Herald persists commands before acknowledging the mock/webhook delivery, retries after restart/lost answer, and retains the original 30-second command deadline (`CHAT_COMMAND_MAX_AGE_MS`). Cleanup never age-expires. It has reserved bounded outbox capacity. A refused enqueue rejects, leaves no successful dedupe claim, and permits retry of the same delivery/message ID. Realm replies `202 {version:1,status:'accepted'|'duplicate'|'ignored'}` only after the handler resolves; explicit `ignored` is terminal for this route. EventSub WebSocket cannot acknowledge or request replay after a crash before local persistence; health reports local refusal.
- Realm registration lives in `apps/realm/src/raid-gate/chat-commands.ts` (owned here; the API is generic). Each feature registers once during wiring before listen:

  ```ts
  import { realmChatCommands } from '../raid-gate/chat-commands';
  const unregister = realmChatCommands.register({
    id: 'gather', commands: ['sus', 'drop', 'roll', 'hold', 'pull'],
    command: input => games.chat(input),
    cleanup: input => games.cleanup(input),
  });
  // pier registers id:'pier', commands:['fish'] through this same API.
  // Call unregister() on feature disposal.
  ```

- Handlers receive typed `ChatCommand` / `ChatCommandCleanup` and resolve `'accepted' | 'duplicate' | 'ignored'`. They own their game state, eligibility, argument meanings, turn clocks and rate limits. They **persist their inbox claim and move together**, deduplicate by kingdom/message ID, and enforce per-player rules. They persist timestamped identity/message/room tombstones so cleanup arriving before its command cannot resurrect a vote. Cleanup fans out to all registered handlers; any failure yields 503 and retries all, so handler cleanup must be idempotent. One command has one registered owner; overlapping registration fails atomically. Unknown commands and games not waiting for input are ignored. No handler replies in Twitch chat through this seam.
- The router rejects commands more than five seconds ahead and ignores commands 30 seconds old, but delivers arbitrarily delayed cleanup. It is a dispatcher, not a durable game inbox. Until gather/pier register, their commands receive an honest `ignored` response. Their realm modules and migrations remain theirs; Herald needs no edits when another game registers.

## Other seams

- **Raid welcome crier (realm authority, Herald sender).** `0011c_realm_raid_crier.sql` records one welcome job with each witnessed incoming raid of at least three viewers. This is Twitch.md's welcome threshold; history is retained below it. `apps/realm/src/raid-gate/crier.ts` owns default `rare`, persisted `silent | rare | herald`, revision CAS, budgets and irreversible claims. `silent` suppresses queued jobs permanently, so re-enabling never replays an earlier welcome. `recover()` independently expires queued welcomes after the original 60-second window and marks abandoned claims unknown after 15 seconds. No stamp or guest evidence comes from a welcome or its link.
- **Welcome sender contract.** Strict local schemas live in `apps/api/src/raid-gate/crier-contracts.ts`. The Herald-only `POST /internal/realm/raid-gate/crier/claim` accepts `{version:1,origin,kingdomId,senderId}` and returns `200 {version:1,claim:null|RaidCrierClaim}` after the claim commits. `claim` carries its ID, raid ID, target, bot sender, text and a dispatch expiry capped at five seconds and the original welcome window. A lost claim answer consumes the attempt: claims are never reclaimed. The sender posts only once; only `POST .../crier/receipt` retries, returning `202 {version:1,status:'accepted'|'duplicate'}`. Sent, refused and uncertain outcomes remain distinct. An auto-aged unknown may be repaired by the same claim's definite sent/refused receipt. A terminal receipt conflict retires the local receipt without calling it accepted or reposting chat.
- **No bot audience.** Herald ignores the distinct designated reader/bot's own chat before presence, speech and command submission. Reading as the broadcaster still counts that person's chat. Mock-door raid compatibility canonicalizes only the CLI's mixed-case login fields; production keeps strict Twitch-login validation. The CLI's display names, channel IDs, count and event timestamp are retained.
- **Crier limits and integration.** All claimed attempts count, including refused and unknown results. Claim reservations allow at most 20 per bot per 35 seconds, one per kingdom per 65 seconds and six per kingdom per 3,605 seconds, providing five seconds of dispatch headroom around Twitch.md's 20/30s, one/minute and six/hour limits. There are no other bound chat writers in this checkout. Any future crier/royal writer must share this budget authority instead of adding an independent counter; the existing `ProviderBudgetPort` remains the integration seam. The welcome's priority is `raid-welcome`.
- **Activating a real welcome (integrator, RS13 with Tobias present).** Apply `0011c`, set the realm's explicit `REALM_PUBLIC_ORIGIN`, and enable the live Herald with `HERALD_RAID_CRIER_ENABLED=1` only for the authorized live run. The realm mounts the private routes only with an explicit public origin, so a mock run never silently creates invitations to the real site. Herald otherwise reports `operator_disabled` or `realm_unconfigured` honestly. Actual sends require the same app-token session as the live source, current bot `user:bot` / `user:write:chat` and broadcaster `channel:bot` grants, a distinct bot account, and tobi4s_'s exact login and ID `129634568`. It always sets `for_source_only:true`, including in shared chat. The existing Helix session may renew after a definite 401 within the claim deadline; a 429 or ambiguous failure never reposts. `is_sent:false` is refused, never success. The mock command installs `RecordingRaidCrierTransport` and exposes its bounded recorded lines only in the private mock `/health`; it has no live send transport.
- **Broadcaster crier setting (front-door hook required).** The standalone API mounts `GET|POST /api/raid-gate/crier/:kingdomId`. Only that kingdom's authenticated broadcaster may read or change it; POST requires the existing session-bound CSRF token and same Origin. GET returns `{version,origin,kingdomId,revision,mode,csrfToken}`, POST takes `{version:1,mode,expectedRevision}` and returns the acknowledged setting. The public route allowlist is present. The public gateway runs its own auth dispatch rather than `apps/api/src/main.ts`; front-door must apply this exact additive line before `authRoutes` in `apps/api/src/public/main.ts` for the setting to be reachable through that gateway:

  ```diff
      case 'auth':
  +     if (await (await import('../raid-gate/crier-settings')).handleRaidCrierSetting(request, response, { pool, config: auth })) return;
        if (!await authRoutes(request, response)) unavailableJson(response, 404, 'No such route');
  ```

  Until that hook lands, the public gateway correctly returns 404 for the setting. The standalone API and private welcome flow work independently; no route is advertised as bound before its owner installs it.

- **Passport stamps (raid-show to front-door, panel-window and the integrator).** raid-show exports a reader from `apps/api/src/raid-gate` that implements the `stamps(person, cursor, signal)` port of `apps/api/src/passport/read.ts`, with the hide switch. The hard-coded empty travel lists (`apps/api/src/public/panel/reading.ts:188`, front-door; panel adapters, panel-window) switch to it.
- **Forged gifts (forge-wish).** A forged piece becomes giftable only through a typed port from forge-wish: owner, revision, transferable, and a conditional owner change in one transaction. Until then, the only giftable thing is the welcome offering, held in raid-show's own tables.
- **Migration (the integrator).** `apps/realm/src/persistence/migrations/0011_realm_raid_gate.sql` is a new file in its own commit. The live schema must be migrated before the live realm runs a build that carries it.
- **Observation migration (the integrator).** `0011b_realm_raid_observations.sql` adds the append-only history/feed and recovery bookkeeping. Apply it before deploying a realm bundle carrying it. The gate landing, feed row, sequence head and road outbox settlement share one serializable transaction. No live schema or service is changed by this lane.
- **Gate notifications (RS11 wiring).** Realm-side outgoing landing is durable in the shared gate tables. When binding the API gate, re-read revisions from storage for existing subscribers (or supply a typed cross-process notification port); an in-process API `GateNotifier` alone cannot see commits made by realm. Retry of the original evidence must never correlate it to a later gate request.
- **Live deploy (Tobias and the integrator).** The live Herald and realm pick up the outgoing subscription and the new scopes only after the merged build is deployed and tobi4s_ re-grants. raid-show never restarts them.
