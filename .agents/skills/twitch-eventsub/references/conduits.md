# EventSub Conduits

Source: `references/official/eventsub_handling-conduit-events.md` + API reference (Get/Create/Update/Delete
Conduits, Get/Update Conduit Shards). Template: `assets/templates/conduit-setup.ts` (typechecked; the Twitch CLI
has no conduit mock, so it is not runtime-tested).

## What a conduit is

A conduit is a named container of **shards**; each shard is one transport (a WebSocket session or a webhook
callback). You attach subscriptions to the **conduit** (`transport: { method: "conduit", conduit_id }`) instead of
to a specific socket/URL, and Twitch load-balances notifications across the enabled shards (hashing by channel id,
so a given channel tends to land on the same shard). Subscriptions survive shard churn: if a WebSocket shard
disconnects, you re-point the shard to a new session and the subscriptions keep working — no resubscribing.

Conduits use **app access tokens only** (create conduit, update shards, create/list subscriptions).

## When to use

- A backend that serves **many channels** (multi-tenant bot, SaaS overlay) — WebSocket's per-user limits
  (3 sockets, 300 subs/socket, cost 10) don't apply; cost model is the app-token one.
- **Chat bots with an app token** (`channel.chat.message` via conduit/webhook needs `user:bot` from the bot and
  `channel:bot` from the broadcaster or bot-is-mod) — gives the bot badge path. See the twitch-chat skill.
- You want WebSocket delivery (no public HTTPS) **and** subscriptions that don't vanish on every reconnect.
- Horizontal scale: N worker processes, each owning one or more shards.
Single-channel hackathon project with a user token? Plain WebSocket is simpler.

## Flow

1. `POST /helix/eventsub/conduits` `{ "shard_count": N }` → `{ data: [{ id, shard_count }] }` (200). Shards are
   `"0"`..`"N-1"`. Limit: **5 enabled conduits** per client id (429 when exceeded) and up to **20,000 shards per
   conduit** ("subject to change"). Conduits persist — store/reuse the id (`GET /helix/eventsub/conduits`).
2. Assign transports: `PATCH /helix/eventsub/conduits/shards`
   ```json
   { "conduit_id": "bfcfc993-…", "shards": [
       { "id": "0", "transport": { "method": "websocket", "session_id": "<from session_welcome>" } },
       { "id": "1", "transport": { "method": "webhook", "callback": "https://example.com/eventsub", "secret": "s3cre7…" } } ] }
   ```
   - **Max 100 shards per request** (publicly stated 2026-06-18) — chunk larger updates.
   - Response 202 with `data` (successful shards + status) and `errors` (`{ id, message, code }` per failed shard,
     e.g. "The websocket session is not connected", "The shard id is outside of the conduit's range").
   - WebSocket shard: connect to `wss://eventsub.wss.twitch.tv/ws`, and within **10 s of the welcome** PATCH the
     shard with that `session_id` — otherwise the socket is closed (same rule as subscribing).
   - Webhook shard: status `webhook_callback_verification_pending` until your endpoint answers the challenge
     (body has `conduit_shard: { conduit_id, shard }`); HTTPS/443/secret rules as for webhooks.
3. Subscribe: `POST /helix/eventsub/subscriptions` with app token and
   `"transport": { "method": "conduit", "conduit_id": "…" }` → 202, `status: "enabled"`.
4. Notifications arrive on whichever shard Twitch picks, in the normal transport framing (WebSocket frame or
   webhook POST); `payload.subscription.transport` is `{ method: "conduit", conduit_id }`.

## Shard statuses and failure handling

Shard status values: `enabled`, `webhook_callback_verification_pending`, `webhook_callback_verification_failed`,
`notification_failures_exceeded`, `websocket_disconnected`, `websocket_failed_ping_pong`,
`websocket_received_inbound_traffic`, `websocket_internal_error`, `websocket_network_timeout`,
`websocket_network_error`, `websocket_failed_to_reconnect`.

- A notification for a disabled shard is retried on **one** other shard; if that is disabled too, it's dropped.
  Keep shards healthy.
- A webhook shard is only disabled after an extended run of consecutive failures; a failed delivery to an
  *enabled* webhook shard is not re-routed.
- Subscribe to **`conduit.shard.disabled`** (condition `{ client_id, conduit_id? }`, app token) to be told when a
  shard goes down (event has `conduit_id`, `shard_id`, `status`, `transport`). Fix by PATCHing the shard with a new
  session id / callback. Or poll `GET /helix/eventsub/conduits/shards?conduit_id=…&status=websocket_disconnected`.
- To remove a shard: move the last shard's transport into the slot you're removing, then lower `shard_count` by 1.
- All shards disabled → conduit stays enabled; after **72 hours** with no shard re-enabled, Twitch deletes the
  conduit (and its subscriptions are disabled with `conduit_deleted`).
- WebSocket shard + `session_reconnect`: follow the normal reconnect flow (new socket to `reconnect_url`, close
  old after welcome). Status `websocket_failed_to_reconnect` means that flow didn't complete. The template simply
  re-PATCHes the shard on every welcome (fresh or reconnect), which is idempotent.

## Scaling

`PATCH /helix/eventsub/conduits` `{ "id": "<conduit>", "shard_count": M }` (200). Raising adds empty shards
(assign them); lowering disables the shards ≥ M (e.g. 100 → 50 disables 50–99). `DELETE
/helix/eventsub/conduits?id=…` (204) deletes it; its subscriptions show disabled after a while.
Subscriptions on conduits use the normal cost model. `GET /helix/eventsub/subscriptions?conduit_id=…` filters by
conduit (added 2026-04-17).

## Minimal TypeScript (see `conduit-setup.ts` for the full version)

```ts
import { EventSubWsClient } from './eventsub-ws-client.ts';
import { getAppAccessToken, ensureSubscription } from './subscribe.ts';
import { ensureConduit, updateShards } from './conduit-setup.ts';

const { access_token } = await getAppAccessToken(CLIENT_ID, CLIENT_SECRET);
const auth = { clientId: CLIENT_ID, token: access_token };
const conduit = await ensureConduit(auth, 1);                     // reuse or create, 1 shard
const ws = new EventSubWsClient({ clientId: CLIENT_ID, getUserToken: () => '', subscriptions: [] });
ws.onSessionReady = (sessionId) => void updateShards(auth, conduit.id, [{ id: '0', transport: { method: 'websocket', session_id: sessionId } }]);
ws.on('channel.chat.message', (e) => handleChat(e));
ws.start();
await ensureSubscription(auth, { type: 'channel.chat.message', version: '1',
  condition: { broadcaster_user_id: B, user_id: BOT }, transport: { method: 'conduit', conduit_id: conduit.id } });
```
Multiple processes: give each process its own shard id(s); one "admin" process creates the conduit, sets the
shard count, and owns the subscriptions.

## Pitfalls

- User token on conduit endpoints → 401. Conduits are app-token only.
- Creating a new conduit on every boot → you hit the 5-conduit limit (429). Reuse via `GET /eventsub/conduits`.
- Assigning a WebSocket shard later than 10 s after the welcome → socket closed.
- More than 100 shards in one PATCH → split it.
- Twurple 8.2.0 has no conduit helper — use these raw Helix calls (they work alongside Twurple's ApiClient).
