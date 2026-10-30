# EventSub over WebSocket — full protocol

Source: `references/official/eventsub_handling-websocket-events.md`, `eventsub_websocket-reference.md`,
`eventsub_manage-subscriptions.md`. Template: `assets/templates/eventsub-ws-client.ts` (runtime-tested against the
Twitch CLI mock: subscribe, notifications, reconnect, close 4006, keepalive loss, revocation).

## Contents
- When to use WebSocket
- Connection and the 10-second rule
- Message types (welcome, keepalive, notification, reconnect, revocation) with metadata
- Ping/pong and "never send anything"
- Keepalive watchdog
- Reconnect flow (session_reconnect)
- Close codes and what to do
- Limits and costs
- Which subscriptions a session has
- TypeScript walk-through
- Twurple equivalent
- Pitfalls

## When to use WebSocket

Use it when you do NOT have a public HTTPS endpoint: local bots, desktop apps, OBS browser-source overlays,
hackathon backends behind NAT. Subscriptions are created with a **user access token** (the token of the user named
in the condition — broadcaster, moderator or bot). Subscriptions live only as long as the socket: when it dies they
are disabled and you must create new ones on a new session. Events that happen while you are disconnected are
lost (no replay). For many channels, app-token chat bots, or horizontal scale, use conduits (references/conduits.md).

## Connection and the 10-second rule

```
wss://eventsub.wss.twitch.tv/ws
wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30   # 10..600; out-of-range numbers are clamped
```

1. Connect. The first frame is `session_welcome` with `payload.session.id`.
2. Within **10 seconds** of the welcome, create at least one subscription with
   `transport: { method: "websocket", session_id }` via `POST https://api.twitch.tv/helix/eventsub/subscriptions`
   (user token + `Client-Id`). Otherwise Twitch closes with **4003 connection unused**.
   (For the welcome, `keepalive_timeout_seconds` is also the time you have to subscribe.)
3. Creating a subscription for WebSocket returns `202` with `status: "enabled"` immediately (no challenge).

The server only sends. **Anything you send except a Pong closes the socket with 4001.** Don't `ws.send()` at all.

## Message types

Every frame is a JSON text frame `{ metadata, payload }`. All timestamps are RFC3339 with nanoseconds.

| `metadata.message_type` | `payload` | Action |
|---|---|---|
| `session_welcome` | `session { id, status:"connected", connected_at, keepalive_timeout_seconds, reconnect_url:null }` | store `session.id`; subscribe within 10 s (unless this socket came from a reconnect) |
| `session_keepalive` | `{}` | reset watchdog |
| `notification` | `{ subscription, event }` (same objects as webhooks) | dedupe by `message_id`, dispatch on `subscription.type`; reset watchdog |
| `session_reconnect` | `session { id, status:"reconnecting", keepalive_timeout_seconds:null, reconnect_url, connected_at }` | open `reconnect_url` as-is, keep old socket until new welcome |
| `revocation` | `{ subscription }` with `status` = reason | stop expecting that event; maybe re-auth the user |

`metadata` always has `message_id`, `message_type`, `message_timestamp`; notification and revocation add
`subscription_type` and `subscription_version`.

Welcome:
```json
{"metadata":{"message_id":"96a3f3b5-5dec-4eed-908e-e11ee657416c","message_type":"session_welcome","message_timestamp":"2023-07-19T14:56:51.634234626Z"},
 "payload":{"session":{"id":"AQoQILE98gtqShGmLD7AM6yJThAB","status":"connected","connected_at":"2023-07-19T14:56:51.616329898Z","keepalive_timeout_seconds":10,"reconnect_url":null}}}
```
Notification:
```json
{"metadata":{"message_id":"befa7b53-d79d-478f-86b9-120f112b044e","message_type":"notification","message_timestamp":"2022-11-16T10:11:12.464757833Z","subscription_type":"channel.follow","subscription_version":"1"},
 "payload":{"subscription":{"id":"f1c2a387-161a-49f9-a165-0f21d7a4e1c4","status":"enabled","type":"channel.follow","version":"1","cost":1,"condition":{"broadcaster_user_id":"12826"},"transport":{"method":"websocket","session_id":"AQoQexAWVYKSTIu4ec_2VAxyuhAB"},"created_at":"2022-11-16T10:11:12.464757833Z"},
            "event":{"user_id":"1337","user_login":"awesome_user","user_name":"Awesome_User","broadcaster_user_id":"12826","broadcaster_user_login":"twitch","broadcaster_user_name":"Twitch","followed_at":"2023-07-15T18:16:11.17106713Z"}}}
```
Reconnect:
```json
{"metadata":{"message_id":"84c1e79a-2a4b-4c13-ba0b-4312293e9308","message_type":"session_reconnect","message_timestamp":"2022-11-18T09:10:11.634234626Z"},
 "payload":{"session":{"id":"AQoQexAWVYKSTIu4ec_2VAxyuhAB","status":"reconnecting","keepalive_timeout_seconds":null,"reconnect_url":"wss://eventsub.wss.twitch.tv?...","connected_at":"2022-11-16T10:11:12.634234626Z"}}}
```
Revocation (`payload.subscription.status` is the reason):
`authorization_revoked` (user revoked your app / changed password), `user_removed` (user no longer exists),
`version_removed` (type+version retired). You get it once; no more events for that subscription.
Webhook-only reason `notification_failures_exceeded` never appears here.

## Ping/pong

Twitch sends standard WebSocket Ping frames; you must answer with Pong or get **4002**. Browsers and Node's
global `WebSocket` (undici) answer automatically — do nothing. Pings do NOT reset the keepalive timer.

## Keepalive watchdog

Twitch sends `session_keepalive` whenever no notification was sent within `keepalive_timeout_seconds`. So:
reset a timer on every keepalive **and** every notification; if it fires (add ~1–2 s grace for latency), treat the
connection as dead → close it, open a **fresh** connection to the base URL and **re-create all subscriptions**
(new session). A larger `keepalive_timeout_seconds` means less traffic but slower detection of a dead link.
Verified: with the CLI mock's `twitch event websocket keepalive --session=<id> --enabled=false`, the template
detected the dead link after 12 s and resubscribed on a new session.

## Reconnect flow (`session_reconnect`)

Twitch sends it ~30 s before it drops your edge server.
1. Immediately open a second socket to `payload.session.reconnect_url` **exactly as given** (don't add params).
2. Keep the old socket open and keep processing its notifications — it delivers until the new one is welcomed.
3. When the new socket's `session_welcome` arrives: make it current, close the old one. **Do not resubscribe** —
   subscriptions carry over. (The session id may differ — the CLI mock gave a new id.)
4. If you never connect, or never close the old socket, the old one gets **4004** after 30 s.
Reconnecting via `reconnect_url` does not count against the 3-connection limit.

Losing the connection (network, 4000/4005/4006, watchdog) is different: there is no reconnect_url, the
subscriptions on that session become disabled (`websocket_disconnected`, `websocket_network_timeout`, …), and you
must connect fresh and resubscribe. Back off exponentially (1 s → 60 s) to avoid hammering Helix.

## Close codes

| Code | Reason | What to do |
|---|---|---|
| 4000 | Internal server error | reconnect fresh with backoff, resubscribe |
| 4001 | Client sent inbound traffic | BUG: you sent a message. Remove all `send()` calls |
| 4002 | Client failed ping-pong | your client isn't answering pings (custom socket lib?) |
| 4003 | Connection unused | no subscription within 10 s of welcome → token/scope/condition wrong, or subscribing too late (check Helix responses) |
| 4004 | Reconnect grace time expired | you didn't complete the reconnect flow within 30 s → reconnect fresh |
| 4005 | Network timeout | transient → reconnect fresh |
| 4006 | Network error | transient → reconnect fresh (verified with the CLI mock `close --reason=4006`) |
| 4007 | Invalid reconnect | the reconnect URL was bad → reconnect fresh |

## Limits and costs (per user token = client id + user id)

- Max **3** WebSocket connections with enabled subscriptions (reconnect-URL sockets don't count). Use ONE
  connection until you have a reason for more — one socket can carry many types and channels.
- Max **300** enabled subscriptions per connection (disabled ones don't count).
- `max_total_cost` is **10** across all your WebSocket subscriptions. Cost is 0 for types that require the user's
  authorization (or when the condition user authorized your app) and 1 otherwise — so at most 10 subscriptions
  on *other* channels for "no authorization required" types such as `stream.online` / `channel.update` /
  `channel.raid`. For more, use webhooks/conduits (cost limit grows with authorized users; examples show 10000).
- Max 3 subscriptions with the same `type` + `condition` (429 above that); 409 if an identical one exists.
- `GET /helix/eventsub/subscriptions` with the user token lists them; disabled WebSocket subscriptions are listed
  for at least 1 minute (webhooks: at least 10 days). Filter by `session_id` in `transport` to find "mine".

## TypeScript walk-through (what `eventsub-ws-client.ts` does)

```ts
import { EventSubWsClient } from './eventsub-ws-client.ts';

const client = new EventSubWsClient({
  clientId: process.env.TWITCH_CLIENT_ID!,
  getUserToken: () => tokenStore.getFreshUserToken(), // refresh before it expires; called before each Helix POST
  subscriptions: [
    { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: B, moderator_user_id: ME } },
    { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: B, user_id: ME } },
    { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: B } },
  ],
  // url: 'ws://127.0.0.1:8121/ws', helixBase: 'http://127.0.0.1:8121'   // Twitch CLI mock
});
client.on('channel.follow', (e) => overlay.push({ kind: 'follow', name: e.user_name }));   // e is typed
client.onAny((e) => { switch (e.type) { case 'channel.chat.message': e.event.message.fragments; break; } });
client.onRevocation = (sub) => console.warn('revoked', sub.type, sub.status);
client.start();
```

Key implementation points (all in the template):
1. `open(url, isReconnect)` — new `WebSocket(url)`; for a reconnect, the new socket only becomes "current" after
   its welcome; `onclose` of a non-current socket is ignored.
2. On a fresh welcome: `Promise.allSettled(subscriptions.map(createSubscription))` with the session id — log each
   failure with the HTTP body (401 wrong token type / expired, 403 missing scope, 409 exists, 429 limits).
3. Watchdog: `setTimeout(keepalive_timeout_seconds*1000 + 2000)` reset on every frame on the current socket.
4. Dedupe: `Map<message_id, expiry>` (10 min). Twitch delivers at least once; a resend has the same id.
5. Dispatch: flatten `{type: subscription.type, event}` into the `EventSubEnvelope` union from `types.ts` so
   `switch (e.type)` narrows `e.event` (TS can't narrow on the nested `subscription.type`).
6. `injectNotification(fixture)` runs a `{subscription, event}` fixture through dedupe + dispatch for unit tests
   (fixtures: `assets/fixtures/*.json`).

Browser/OBS overlay: the same class works in the browser (delete the `node:url` import + demo block). But a
user token in a browser source is a secret that can be extracted — prefer a backend that holds the token and
pushes to the overlay over your own WebSocket/SSE.

## Twurple equivalent

```ts
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';   // 8.x
const listener = new EventSubWsListener({ apiClient: new ApiClient({ authProvider }) }); // config also takes `url`
listener.onChannelFollow(broadcasterId, moderatorId, (e) => console.log(e.userDisplayName));
listener.onChannelChatMessage(broadcasterId, botUserId, (e) => console.log(e.messageText));
listener.onChannelHypeTrainBeginV2(broadcasterId, (e) => {});   // use the V2 methods for hype train
listener.start();
```
Twurple handles welcome/reconnect/keepalive/resubscribe and picks the user token per condition user from the
auth provider (add users with the needed scopes). It has no conduit support in 8.2.0.

## Pitfalls

- App access token on a WebSocket subscription → 401/400. WebSocket = user token, always.
- Subscribing for another broadcaster's `channel.follow` needs `moderator_user_id` = the token user (a mod).
- Creating subscriptions on every reconnect-URL welcome → duplicates/409s. Only on fresh sessions.
- Forgetting to dedupe → double alerts after Twitch resends.
- Long synchronous work in `onmessage` delays keepalive processing → false watchdog trips. Keep handlers fast,
  queue heavy work.
- Many browser tabs/overlay instances each opening sockets hit the 3-connection limit per user — centralize.
