---
name: twitch-eventsub
description: Twitch EventSub for TypeScript/Node - receive real-time Twitch events (follows, subs, resubs, gift subs, cheers/bits, raids, channel points redemptions, polls, predictions, hype trains, goals, ad breaks, shoutouts, stream online/offline, title/category changes, chat messages and chat notifications) over WebSocket, webhooks or conduits. Exhaustive catalogue of all 83 subscription types with versions, conditions and scopes, exact payload fields, generated TS types, runtime-tested templates (WebSocket client with keepalive/reconnect, HMAC-verified webhook server, conduit setup). Use whenever a twitch bot, stream overlay, alert box, OBS browser source, chat bot with !commands or backend must react to something on Twitch, or when debugging EventSub 4003/4004 closes, signature mismatch, challenge failures, 403 missing scope, 409 conflict, revoked subscriptions, cost limits, app vs user token errors. Also Twitch CLI event trigger / websocket mock testing, PubSub migration, Twurple eventsub-ws/eventsub-http.
---

# Twitch EventSub

EventSub is how anything on Twitch *pushes* events to your code. If the user wants "when X happens on
stream, do Y" (alert, overlay animation, bot reply, DB write) — this is the skill. PubSub is gone; IRC
still exists for chat but EventSub chat (`channel.chat.message`) is the recommended path (twitch-chat skill).

## Mental model

A **subscription** = `type` + `version` + `condition` + `transport`, created with
`POST https://api.twitch.tv/helix/eventsub/subscriptions` (202 Accepted):

```json
{ "type": "channel.follow", "version": "2",
  "condition": { "broadcaster_user_id": "123", "moderator_user_id": "123" },
  "transport": { "method": "websocket", "session_id": "AQoQ…" } }
```
- `type`/`version`: from `references/subscription-types.md` (versions are strings; some types only exist as v2).
- `condition`: whose events; field names differ per type (`broadcaster_user_id`, `moderator_user_id`,
  `user_id`, `to_broadcaster_user_id`, `reward_id`, `client_id`…).
- `transport`: where to deliver — `websocket` (session_id), `webhook` (callback + secret) or `conduit` (conduit_id).
Each delivery is `{ subscription, event }`; `event` fields per type are in `references/payloads.md` /
`references/event-objects.md`. Delivery is **at least once** (dedupe by message id) and **unordered**.

## Choose the transport

| | WebSocket | Webhook | Conduit |
|---|---|---|---|
| Token to create subs | **user** access token (app token fails) | **app** access token (user token fails) | **app** access token |
| Needs public URL | no — client connects out (`wss://eventsub.wss.twitch.tv/ws`) | yes: HTTPS, port 443, no redirects | only for webhook shards |
| Subscription lifetime | dies with the socket → resubscribe on every fresh connect | until deleted/revoked | until deleted/revoked; shards can be swapped |
| Limits | per user token: 3 connections, 300 enabled subs each, `max_total_cost` 10 | cost limit grows with authorized users (examples: 10000) | 5 conduits × ≤20,000 shards; ≤100 shards per PATCH |
| Must do | subscribe within 10 s of welcome; keepalive watchdog; follow `session_reconnect` | verify HMAC on raw body; answer challenge (200 text/plain); 2xx within seconds | assign shards (10 s rule for WS shards); watch `conduit.shard.disabled` |
| Best for | hackathons, local bots, single-channel overlays/backends behind NAT | servers with HTTPS (Vercel/Fly/etc.), serverless | multi-channel bots/SaaS, app-token chat bots, scaling |

Default for a hackathon: **WebSocket on the backend** with the broadcaster's (or bot's) user token, pushing to
the overlay over your own WS/SSE. Don't put user tokens in OBS browser sources if you can avoid it.

## Authorization model (read this — it causes most 401/403s)

- **Scopes belong to the user in the condition, granted to YOUR client id.** For `channel.subscribe` the
  broadcaster must have authorized your app with `channel:read:subscriptions`.
  - WebSocket: you send *that user's* token; it must carry the scope; ids in the condition (e.g.
    `moderator_user_id`, `user_id`) must match the token's user.
  - Webhook/conduit: you send an **app token**, but Twitch still checks that the user previously granted your
    client id the scope (via any OAuth flow you ran). No prior grant → 403 even though app tokens have no scopes.
- "No authorization required" types (`stream.online/offline`, `channel.update`, `channel.raid`,
  `channel.shared_chat.*`, `user.update`) work for any channel but cost 1 each unless that user authorized you.
- Moderator-type conditions (`channel.follow` v2, shoutouts, shield mode, automod, warnings, unban requests,
  suspicious users) need a `moderator_user_id` who is the broadcaster or a mod and granted the scope.
- Chat types (`channel.chat.*`) use `user_id` = the reading user (bot) with `user:read:chat`; app-token
  delivery also needs `user:bot` (bot) + `channel:bot` (broadcaster) or the bot being a mod.
- Webhook/conduit-only types: `drop.entitlement.grant`, `extension.bits_transaction.create`,
  `user.authorization.grant/revoke` (and `conduit.shard.disabled` uses an app token).
Scope details and OAuth flows: see the twitch-dev skill.

## Costs and limits

- `cost` 0 if the type requires user authorization or the condition user has authorized your app; else 1.
  Responses include `total`, `total_cost`, `max_total_cost` — log them.
- Max 3 subscriptions with the same type+condition (429); an identical existing one → **409** (the error body
  includes the existing id since 2026-04-17) — treat 409 as "already subscribed".
- WebSocket: `max_total_cost` 10 per user token → ≤10 "unauthorized" subs (e.g. `stream.online` for 10 other
  channels). Need more → webhooks/conduits.

## Revocation reasons (subscription `status`)

`authorization_revoked` (user disconnected your app or changed password) · `user_removed` · `version_removed`
(type+version retired — e.g. hype_train v1) · `notification_failures_exceeded` (webhook too slow/failing) ·
`moderator_removed` · `chat_user_banned` · `beta_maintenance` · `conduit_deleted` · WebSocket:
`websocket_disconnected`, `websocket_failed_ping_pong`, `websocket_received_inbound_traffic`,
`websocket_connection_unused`, `websocket_internal_error`, `websocket_network_timeout`,
`websocket_network_error`, `websocket_failed_to_reconnect`. Only enabled subscriptions deliver.

## Gotchas that cause most bugs

1. **Wrong token type** for the transport (user↔app). See table above.
2. **Version mismatch**: `channel.follow` is v2 only (needs `moderator_user_id`); `channel.update` v2;
   hype train **v2** (v1 deprecated/withdrawn); use v2 for automatic reward redemption, automod, `channel.moderate`.
   Copy versions from `EVENTSUB_VERSIONS` in `assets/templates/types.ts`.
3. **WebSocket 4003**: no subscription within 10 s of the welcome (usually all subscribe calls failed — log the
   Helix error bodies). **4001**: you sent a message on the socket — never send.
4. **Reconnect done wrong**: on `session_reconnect` connect to `reconnect_url`, keep the old socket until the
   new welcome, do NOT resubscribe. On a *lost* connection you MUST resubscribe (new session) — events in the
   gap are gone.
5. **Webhook signature fails** because the body was JSON-parsed/re-serialized before HMAC. Use raw bytes;
   message = id + timestamp + body; `sha256=` prefix; `timingSafeEqual` with equal lengths.
6. **Challenge answered as JSON** — must be 200 `text/plain` raw string.
7. **Slow webhook handler** → retries → `notification_failures_exceeded` revocation. Respond 204 first.
8. **No dedupe** → double alerts. Message ids repeat on resend; keep 10 minutes of ids.
9. **Assuming order**: hype train/goal progress can arrive before begin; poll/prediction events can interleave.
10. **Resubs**: `channel.subscribe` excludes resubs; `channel.subscription.message` only fires when the viewer
    shares it. `channel.chat.notification` (`notice_type`) sees all chat-visible sub/resub/gift/raid notices with
    just `user:read:chat`.
11. **Gift bombs**: one `channel.subscription.gift` + N `channel.subscribe` (`is_gift: true`) — don't alert N+1 times.
12. **Bot hears itself**: `channel.chat.message` includes your bot's own messages — skip `chatter_user_id === bot`.
13. **Nullables**: anonymous cheers/gifts have `user_id: null`; optional objects are `null`, not absent.
14. **Beta types** (`version: "beta"`, Guest Star) can change any time and are deleted 30 days after GA.

## Quick start (WebSocket, no public URL)

```bash
mkdir -p src/eventsub && cp assets/templates/eventsub-ws-client.ts src/eventsub/
# Types: generate a TRIMMED types.ts with only the types you subscribe to (the full file is ~170 KB):
node scripts/gen-subscription-types.ts --only channel.follow,channel.cheer --out src/eventsub/types.ts
#   (offline: add --html-dir <dir with the two eventsub HTML pages>; or copy assets/templates/types.ts whole)
```
```ts
import { EventSubWsClient } from './eventsub/eventsub-ws-client.ts';
const B = process.env.TWITCH_BROADCASTER_ID!, ME = process.env.TWITCH_USER_ID!; // token's user (broadcaster or bot)
const es = new EventSubWsClient({
  clientId: process.env.TWITCH_CLIENT_ID!,
  getUserToken: () => process.env.TWITCH_USER_TOKEN!,   // swap for a refreshing token store
  subscriptions: [
    { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: B, moderator_user_id: ME } },
    { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: B } },
    { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: B } },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: B } },
    { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: B } },
    { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: B, user_id: ME } },
  ],
});
es.on('channel.follow', (e) => alert(`${e.user_name} followed!`));
es.on('channel.chat.message', (e) => { if (e.chatter_user_id !== ME && e.message.text.startsWith('!dice')) roll(e); });
es.onAny((e) => { if (e.type === 'channel.raid') alert(`Raid from ${e.event.from_broadcaster_user_name} (${e.event.viewers})`); });
es.start();
```
Required scopes for that list (token user = broadcaster): `moderator:read:followers channel:read:subscriptions
bits:read channel:read:redemptions user:read:chat` (raid needs none). Test without credentials:
`twitch event websocket start-server -p 8080` + `EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws TWITCH_HELIX_URL=http://127.0.0.1:8080`,
then `twitch event trigger channel.follow --transport=websocket` (references/testing.md).

Webhook instead: `assets/templates/eventsub-webhook-server.ts` (+ `subscribe.ts` to create subs with an app token).
Twurple instead: `new EventSubWsListener({ apiClient })` + `listener.onChannelFollow(b, mod, fn)` (references/websocket.md).

## Reference map

| File | Read / use when |
|---|---|
| `references/subscription-types.md` | choosing a type: all 83 type+versions (79 types) by domain with version, status, condition fields, scopes, transport limits, removed versions. GENERATED |
| `references/subscription-types.json` | same catalogue machine-readable (scripts, validation) |
| `references/payloads.md` | writing handlers for the ~30 common events: field trees + official example JSON + gotchas |
| `references/event-objects.md` | exact `event` fields of ANY type, every condition object, shared objects (Reward, Choices, Outcomes…). GENERATED |
| `references/websocket.md` | WebSocket protocol: messages, keepalive watchdog, reconnect, close codes 4000–4007, limits, Twurple |
| `references/webhooks.md` | webhook HMAC, headers, challenge, revocation, raw body in Express/Nuxt-h3/Hono, tunnels |
| `references/conduits.md` | conduits/shards: create, assign (≤100/req), subscribe, disabled shards, scaling, limits |
| `references/testing.md` | VERIFIED Twitch CLI commands (trigger, verify-subscription, ws mock, reconnect, close), fixtures, mock quirks |
| `references/official/*.md` | official doc snapshot (do not edit): subscription types, handling-*, websocket-reference, manage-subscriptions. `eventsub_eventsub-reference.md` has every payload object table; `event-objects.md` is the curated, cleaned version |
| `assets/templates/types.ts` | typed events/conditions for EVERY type, `EVENTSUB_VERSIONS`, `EventSubEnvelope` union, WS frame types. GENERATED, ~170 KB — prefer `gen-subscription-types.ts --only … --out …` for a project |
| `assets/templates/eventsub-ws-client.ts` | copy: zero-dep WebSocket client (welcome→subscribe, watchdog, reconnect incl. old-socket-dies-mid-handover race, revocation, dedupe, typed `on()`) |
| `assets/templates/eventsub-ws-demo.ts` | runnable demo of the client (env-configured; also against the CLI mock) — don't copy into projects |
| `assets/templates/eventsub-webhook-server.ts` | copy: node:http webhook receiver (raw body, HMAC, challenge, replay/dedupe, 204-then-process) + framework-agnostic `handleEventSubMessage` |
| `assets/templates/subscribe.ts` | copy/CLI: app token, create/ensure (409-safe)/list/delete/cleanup subscriptions |
| `assets/templates/conduit-setup.ts` | copy: conduit create/reuse, shard assignment (WS or webhook), conduit subscriptions |
| `assets/fixtures/<type>.v<ver>.json` | official example notification per type (82) for tests / `injectNotification()` |
| `scripts/event-section.sh <type> [ver]` | print the official section + event field table for one type (`--fields-only`, `--section-only`, `--list`) |
| `scripts/send-fixture.ts` | send a signed webhook built from a fixture (types the CLI can't trigger, dedupe/replay/challenge tests) |
| `scripts/gen-subscription-types.ts` | regenerate catalogue, event-objects, payloads, types.ts, fixtures (live fetch or `--html-dir`) after docs refresh; `--only a,b --out f` writes a trimmed types.ts for a project |
| `scripts/reconnect-race-test.ts` | regression test (needs `ws`): old socket closes before the reconnect welcome → must not open a duplicate session |
| `scripts/payloads-curation.ts` | the list + hand-written notes behind payloads.md |

## Looking up details

```bash
scripts/event-section.sh channel.chat.notification --fields-only     # every field of one event
grep -n "^### channel.hype_train" references/subscription-types.md    # catalogue entry
grep -n "^### Channel Points Custom Reward Redemption Add Event" references/event-objects.md
grep -n "^### channel.raid" references/official/eventsub_eventsub-subscription-types.md
grep -n "^## \(Reconnect\|Close\) message" references/official/eventsub_handling-websocket-events.md
grep -n "notification_failures_exceeded" references/official/*.md
```
Helix endpoint details (Create/Get/Delete EventSub Subscription, conduits): see the twitch-api skill
(`grep -n "^## Create EventSub Subscription" …/api_reference.md` there).

## Coming from PubSub (shut down; the official migration guide was removed 2026-06-12)

| Old PubSub topic | EventSub type(s) |
|---|---|
| `channel-bits-events-v2` | `channel.cheer` (or `channel.bits.use` for cheers + Power-ups) |
| `channel-points-channel-v1` | `channel.channel_points_custom_reward_redemption.add` (+ `…automatic_reward_redemption.add` v2) |
| `channel-subscribe-events-v1` | `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift` (or `channel.chat.notification`) |
| `chat_moderator_actions` | `channel.moderate` v2 (or `channel.ban`/`unban`/`chat.message_delete`…) |
| `automod-queue` / `user-moderation-notifications` | `automod.message.hold`/`update` v2 / `channel.chat.user_message_hold`/`update` |
| `whispers` | `user.whisper.message` |
| `video-playback-by-id` | `stream.online` / `stream.offline` |
| hype train / polls / predictions topics | `channel.hype_train.*` v2 / `channel.poll.*` / `channel.prediction.*` |

## Related skills

- **twitch-dev** — app registration, OAuth flows (getting the user/app tokens and scopes EventSub needs), Twurple setup.
- **twitch-api** — Helix calls you make in reaction to events (fulfill redemptions, shoutouts, send chat).
- **twitch-chat** — chat bots on EventSub (`channel.chat.message`, Send Chat Message, badges/emotes rendering).
- **twitch-extensions** — Extension PubSub/EBS; `extension.bits_transaction.create` lives here.

After `twitch-dev/scripts/refresh-docs.sh`, run `node scripts/gen-subscription-types.ts` (fetches the two
EventSub pages live) and check its WARNINGS and the change log for new/removed types.
