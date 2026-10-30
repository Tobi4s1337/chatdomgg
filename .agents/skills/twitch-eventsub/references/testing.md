# Testing EventSub locally (VERIFIED with Twitch CLI 1.1.24, 2026-10-26)

Everything below was actually run against `assets/templates/eventsub-webhook-server.ts` (port 8120) and
`assets/templates/eventsub-ws-client.ts` + the CLI mock WebSocket server (port 8121). No Twitch credentials are
needed for any of it. Replace ports/secrets with yours.

## Contents
- Webhook: trigger, bad secret, verify-subscription, dedupe, replay window, revocation, retrigger
- Events the CLI can trigger (and versions)
- Fixtures for everything else (`scripts/send-fixture.ts`)
- WebSocket mock server: start, subscribe, trigger, reconnect, close codes, keepalive, revocation, -S
- Mock quirks found
- Unit-testing handlers without network
- Real-Twitch smoke test

## Webhook transport

```bash
export TWITCH_EVENTSUB_SECRET=s3cr3t-for-local-testing-1234     # 10-100 chars
PORT=8120 node assets/templates/eventsub-webhook-server.ts &       # listens on http://localhost:8120/eventsub
```

| Command | Result observed |
|---|---|
| `twitch event trigger channel.follow -F http://localhost:8120/eventsub -s $TWITCH_EVENTSUB_SECRET` | `✔ Request Sent. Received Status Code: 204`; server logged `[follow] testFromUser followed testBroadcaster`; payload was **v2** (condition had `moderator_user_id`) |
| same with `-s wrong-secret-123456` | `✗ Invalid response. Received Status Code: 403` (signature rejected) |
| `twitch event verify-subscription channel.follow -F http://localhost:8120/eventsub -s $TWITCH_EVENTSUB_SECRET` | `✔ Valid response. Received challenge … in body` / `✔ Valid content-type header. Received type text/plain` / `✔ Valid status code. Received status 200` |
| `twitch event trigger channel.cheer -F … -s … -I dup-test-1` twice | both 204, handler ran **once** (dedupe on `Twitch-Eventsub-Message-Id`; `-I` sets that header) |
| `twitch event trigger channel.raid -F … -s … --timestamp 2020-01-01T00:00:00.000000000Z` | 403 (older than 10 min → replay protection) |
| `twitch event trigger channel.follow -F … -s … -r authorization_revoked` | 204; server logged `[revoked] channel.follow v2 status=authorization_revoked` (`-r` sets `subscription.status` and the CLI sends it as a revocation) |

Other useful flags (from `twitch event trigger --help`): `-f/--from-user` (user id of the actor), `-t/--to-user`
(broadcaster id), `-i/--item-id` (reward id / game id), `-n/--item-name`, `-C/--cost` (bits / points / amount),
`-c/--count` (fire N times), `-a/--anonymous` (gift/cheer), `--tier 1000|2000|3000`, `-S/--event-status`
(redemption status), `-G/--game-id`, `-d/--description` (stream title), `--ban-start/--ban-end`,
`--charity-current-value/--charity-target-value`, `--client-id`, `-u/--subscription-id`, `-v/--version`,
`-T/--transport webhook|websocket`, `--session <ws session>`, `-D/--no-config`.
Without `-F` the CLI just prints the JSON payload → handy to generate fixtures:
`twitch event trigger channel.subscription.gift -a -C 5 > gift.json`.

`twitch event retrigger -i <subscription/event id> -F <url> -s <secret>` resends a previous event (ids are in the
CLI's local event cache). `twitch event verify-subscription` also takes `-b <broadcaster>` and `-v`.

## What the CLI can trigger (v1.1.24)

`twitch event trigger --help` lists exactly these (use the full type string):
channel.ad_break.begin, channel.ban, channel.channel_points_custom_reward.add/.remove/.update,
channel.channel_points_custom_reward_redemption.add/.update, channel.charity_campaign.donate/.progress/.start/.stop,
channel.cheer, channel.follow, channel.goal.begin/.end/.progress, channel.hype_train.begin/.end/.progress,
channel.moderator.add/.remove, channel.poll.begin/.end/.progress, channel.prediction.begin/.end/.lock/.progress,
channel.raid, channel.shield_mode.begin/.end, channel.shoutout.create/.receive, channel.subscribe,
channel.subscription.end/.gift/.message, channel.unban, channel.unban_request.create/.resolve, channel.update,
drop.entitlement.grant, extension.bits_transaction.create, stream.offline, stream.online,
user.authorization.grant/.revoke, user.update.

Version notes found by running it:
- `channel.follow` → only v2 (`-v 1` → "Valid version(s): 2").
- `channel.update` → needs `-v 1` or `-v 2` ("Use --version to specify").
- `channel.hype_train.*` → **only v1** (`-v 2` → "Valid version(s): 1"); the payload is the deprecated v1 shape
  (`last_contribution`, no `type`/`is_shared_train`). Test v2 handlers with fixtures.
- NOT triggerable ("Invalid event"): `channel.chat.message`, `channel.chat.notification`, `channel.bits.use`,
  automatic reward redemption, chat/moderation/automod/suspicious-user/warning/VIP/whisper/power-up types.
  Use fixtures.

## Fixtures for everything else

`assets/fixtures/<type>.v<version>.json` = the official notification example (`{subscription, event}`) for 82 of
83 type+versions (generated; `drop.entitlement.grant` has no single-event example). `scripts/send-fixture.ts`
signs and POSTs one exactly like Twitch:

```bash
node scripts/send-fixture.ts channel.chat.message -F http://localhost:8120/eventsub -s $TWITCH_EVENTSUB_SECRET --set 'event.message.text="!dice"'
node scripts/send-fixture.ts channel.hype_train.begin@2 -F http://localhost:8120/eventsub -s $TWITCH_EVENTSUB_SECRET
node scripts/send-fixture.ts channel.chat.notification -F … -s … --id same-1      # run twice → processed once
node scripts/send-fixture.ts channel.bits.use -F … -s … --message-type webhook_callback_verification
node scripts/send-fixture.ts channel.bits.use -F … -s … --message-type revocation
node scripts/send-fixture.ts stream.online -F … -s wrong-secret-xyz               # → HTTP 403
node scripts/send-fixture.ts stream.online -F … -s … --timestamp 2020-01-01T00:00:00Z   # → HTTP 403
```
Observed: 204 / 204 / 204+204 (second deduped) / `HTTP 200 body=<uuid>` + `✔ challenge echoed correctly` / 204 and
`[revoked] channel.bits.use v1 status=authorization_revoked` / 403 / 403.

`--set path=value` edits the fixture (JSON-parsed value, dot path), e.g. a chat command, a GIF fragment:
```bash
node scripts/send-fixture.ts channel.chat.message -F … -s … \
  --set 'event.message.fragments=[{"type":"gif","text":"","cheermote":null,"emote":null,"mention":null,"gif":{"id":"abc","url":"https://example.com/x.gif"}}]'
```
(Reference doc names the GIF fields `gif.id` + `gif.url`; the 2026-07-16 change-log text says `gif_id` — handle both.)

## WebSocket: the CLI mock server

```bash
twitch event websocket start-server -p 8121          # ws://127.0.0.1:8121/ws ; subs API at http://127.0.0.1:8121/eventsub/subscriptions
EVENTSUB_WS_URL=ws://127.0.0.1:8121/ws TWITCH_HELIX_URL=http://127.0.0.1:8121 \
TWITCH_CLIENT_ID=x TWITCH_USER_TOKEN=x TWITCH_BROADCASTER_ID=1 TWITCH_USER_ID=1 \
  node assets/templates/eventsub-ws-demo.ts
```
Observed client log:
```
[eventsub] connected, session 100a9323_e5dd9a3c; subscribing…
[eventsub] subscribed channel.follow v2 (cost 0)
[eventsub] subscribed channel.cheer v1 (cost 0)
[eventsub] subscribed stream.online v1 (cost 0)
[eventsub] subscribe channel.chat.message v1 FAILED: Error: HTTP 400 {"error":"Bad Request","message":"The combination of values in the type and version fields is not valid","status":400}
```
(the mock doesn't know `channel.chat.message`).

| Command (second terminal) | Observed |
|---|---|
| `twitch event trigger channel.follow --transport=websocket` | `✔ Forwarded for use in mock EventSub WebSocket server`; client: `[follow] testFromUser → testBroadcaster`. Goes to all connected clients; add `--session <id>` to target one |
| `twitch event websocket reconnect` | client got `session_reconnect` with `reconnect_url: ws://127.0.0.1:8121/ws?reconnect_id=…`, opened it, got a welcome with a **new** session id, closed the old socket; a follow triggered afterwards was delivered without resubscribing |
| `twitch event websocket close --session=<id> --reason=4006` | client: `closed 4006 network error; reconnecting…` → new session, resubscribed; mock GET then showed the old subs as `websocket_network_error` and new ones `enabled` |
| `twitch event websocket keepalive --session=<id> --enabled=false` | no more keepalives; the template's watchdog fired after 12 s (10 s + 2 s grace) and reconnected/resubscribed |
| `twitch event trigger channel.follow --transport=websocket -r authorization_revoked` | client: `[eventsub] REVOKED channel.follow v2: authorization_revoked` (see quirk 3) |
| `twitch event websocket subscription --status=user_removed --subscription=<sub id> --session=<session id>` | changes the status shown by the mock GET; sends no message. All three flags are required; `authorization_revoked` is rejected (only websocket/`user_removed`-style statuses) |
| `twitch event websocket start-server -p 8121 -S` | requires subscriptions: a client that subscribes nothing is closed with **4003 connection unused after ~10 s** |
| connect with `?keepalive_timeout_seconds=30` | welcome echoed `keepalive_timeout_seconds: 30` |

Mock subscription API (`POST/GET/DELETE http://127.0.0.1:<port>/eventsub/subscriptions` — no `/helix` prefix):
needs a `Client-Id` header (any value; without it: 400 "Client-Id header required"); `Authorization` is not checked;
validates `session_id`; returns real-looking `{data, total, total_cost, max_total_cost: 10}`.

## Mock quirks found (CLI 1.1.24)

1. `trigger -I <id>` sets the webhook message-id header only; WebSocket frames always get a random `message_id`,
   so WS de-duplication can't be tested via the CLI → use `client.injectNotification(fixture, sameId)` twice.
2. The mock subscriptions GET ignores `type=` / `status=` filters (returns everything).
3. Revocations over WebSocket are sent framed as `message_type: "notification"` with no `event` — real Twitch uses
   `message_type: "revocation"`. The template handles both.
4. `twitch event websocket reconnect` keeps "reconnect testing" active; `close` is then refused ("Cannot activate this
   command while reconnect testing is active") — restart the server to test close codes.
5. Webhook transport is rejected by the WS mock's subscription API (`method` not valid) — expected.
6. After some commands the CLI prints a Go panic from its update checker (`areWeRunningLatestVersion … index out of
   range`) — harmless, the command already ran.
7. `twitch mock-api` (Helix mock) has no `/eventsub/*` or conduit endpoints; conduit code can't be tested locally.

## Unit-testing handlers without network

```ts
import { readFileSync } from 'node:fs';
import { EventSubWsClient } from './eventsub-ws-client.ts';
const c = new EventSubWsClient({ clientId: 'x', getUserToken: () => 'x', subscriptions: [] });
c.on('channel.chat.message', (e) => console.log(e.chatter_user_name, e.message.text));
const fx = JSON.parse(readFileSync('assets/fixtures/channel.chat.message.v1.json', 'utf8'));
await c.injectNotification(fx, 'a');
await c.injectNotification(fx, 'a');   // deduped
```
Verified output: `chat: viewer32 Hi chat [ 'text' ]` printed once. For webhooks call `handleEventSubMessage()` from
the server template directly with a signed body (see `send-fixture.ts` for the HMAC lines).

## Real-Twitch smoke test (needs credentials)

1. User token with the scopes (WebSocket) or app token + prior user authorization (webhook/conduit).
2. `node assets/templates/subscribe.ts list` → check `status`, `cost`, `total_cost/max_total_cost`.
3. Cheapest live checks: change your stream title (→ `channel.update`), follow from a second account
   (→ `channel.follow`), type in chat (→ `channel.chat.message`), create a custom reward and redeem it.
4. `node assets/templates/subscribe.ts cleanup` removes disabled leftovers (revoked, disconnected sessions).
