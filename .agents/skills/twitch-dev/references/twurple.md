# Twurple (@twurple/*) — the TypeScript Twitch library

Verified 2026-10-26 against **Twurple 8.2.0** (published 2026-09-13) by installing the packages and reading
their `.d.ts`; `assets/templates/twurple-quickstart.ts` typechecks against them (tsc 5.9, strict, NodeNext),
and an `EventSubWsListener` was run against the Twitch CLI mock WebSocket server (connected, created
subscriptions, received triggered follow + redemption events, survived a reconnect test). Docs: https://twurple.js.org

## When to use Twurple vs raw `fetch`
| Use Twurple when | Use raw fetch/WebSocket when |
|---|---|
| You want typed Helix calls fast (`api.users.getUserByName`, `api.channelPoints.createCustomReward` …) | You need an endpoint Twurple 8.2 lacks: **pinned chat** (Get/Pin/Update/Unpin Chat Message, Send Chat Message `pin`), **Get Authorization By User**, **Get Clips Download** → `api.callApi(...)` or fetch |
| Token refresh plumbing for many users (RefreshingAuthProvider) | You need **conduits as a receiving transport** (Twurple can create conduits/shards via `api.eventSub`, but its listeners only consume plain WebSocket/webhook) |
| EventSub WebSocket with automatic reconnect + resubscribe | You want zero dependencies / tiny serverless functions (a webhook handler is ~40 lines) |
| Hackathon speed | You run on an edge runtime without Node APIs, or need brand-new fields the day they ship (Twurple models may lag; raw JSON never does) |

Twurple does **not** do the mandatory hourly `/validate` for you; add it (template shows how).

## Packages (all 8.2.0, ESM-only: `"type": "module"`, single `"."` export)
| Package | What | Notes |
|---|---|---|
| `@twurple/auth` | `RefreshingAuthProvider`, `AppTokenAuthProvider`, `StaticAuthProvider`, helpers `exchangeCode`, `getAppToken`, `refreshUserToken`, `revokeToken`, `getTokenInfo`, `startDeviceCodeFlow`, `exchangeDeviceCode` | DCF + public clients supported (`clientSecret` optional) |
| `@twurple/api` | `ApiClient` (Helix), incl. `api.eventSub` conduit management | peer `@twurple/auth` |
| `@twurple/eventsub-ws` | `EventSubWsListener` | user tokens; reconnect handled |
| `@twurple/eventsub-http` | `EventSubMiddleware` (Express), `EventSubHttpListener` + adapters (`DirectConnectionAdapter`, `ReverseProxyAdapter`, `EnvPortAdapter`) | app token; needs public HTTPS |
| `@twurple/eventsub-ngrok` | `NgrokAdapter` for `EventSubHttpListener` | dev tunnels |
| `@twurple/chat` | `ChatClient` — **IRC** over `wss://irc-ws.chat.twitch.tv` | scopes `chat:read chat:edit`; no Chat Bot badge |
| `@twurple/easy-bot` | `Bot` + `createBotCommand` — !command bots on top of ChatClient (IRC) + ApiClient | quickest `!hello` bot; IRC-based |
| `@twurple/ebs-helper` | Extension backend: `createExternalJwt`, config service get/set, `sendExtensionPubSub*Message`, `sendExtensionChatMessage` | see twitch-extensions skill |
| `@twurple/auth-tmi` | tmi.js adapter | legacy |
| `@twurple/pubsub` | **dead** (last 7.4.0; Twitch PubSub shut down 2025-04-14) | don't install |
| `@twurple/eventsub` | **old** (5.x) | replaced by eventsub-ws/-http |

ESM-only: use `"type": "module"` (suite default). In CommonJS, Node 22's `require(esm)` works for
these packages, or use `await import()`.

```
npm i @twurple/auth @twurple/api @twurple/eventsub-ws        # bot / overlay backend (most projects)
npm i @twurple/eventsub-http express                          # webhooks instead
```

## Auth providers
```ts
import { RefreshingAuthProvider, AppTokenAuthProvider, StaticAuthProvider, type AccessToken } from '@twurple/auth';

// App token only (public data, webhook/conduit subscription management, sendChatMessageAsApp):
const appAuth = new AppTokenAuthProvider(clientId, clientSecret);

// Users + automatic refresh (the normal choice). clientSecret may be omitted for PUBLIC clients.
const auth = new RefreshingAuthProvider({ clientId, clientSecret /*, redirectUri for addUserForCode */ });
auth.onRefresh((userId: string, token: AccessToken) => saveToken(userId, token)); // MUST persist (rotation!)
auth.onRefreshFailure((userId, error) => markNeedsReauth(userId, error));
auth.addUser(userId, token, ['chat']);              // you know the user id
const id = await auth.addUserForToken(token, ['chat']); // Twurple calls /validate to find the user id
// also: addUserForCode(code, intents), startDeviceCodeFlow(scopes) + addUserForDeviceCode(deviceCode, scopes, intents)

declare function saveToken(userId: string, t: AccessToken): void;
declare function markNeedsReauth(userId: string, e: Error): void;
```
`AccessToken` = `{ accessToken, refreshToken: string|null, scope: string[], expiresIn: number|null, obtainmentTimestamp: number }`
(`expiresIn` seconds from `obtainmentTimestamp` ms). Persist it as-is (JSON) — that is Twurple's documented
storage format. ⚠️ `RefreshingAuthProvider.addUser` **throws without a refresh token** ("Trying to add user …
without refresh token") — implicit-flow tokens go into `StaticAuthProvider(clientId, accessToken, scopes)`.
A `RefreshingAuthProvider` with a `clientSecret` can also mint app tokens (`getAppAccessToken()`), so one
provider serves both user- and app-token calls.

**Intents** map a role to a user: `addUser(botId, token, ['chat'])` then `api.asIntent(['chat'], ctx => ...)`.
ChatClient / easy-bot use `authIntents` to pick the bot account.

## ApiClient (Helix)
```ts
import { ApiClient } from '@twurple/api';
const api = new ApiClient({ authProvider: auth });             // optional: logger, batchDelay, fetchOptions
const user = await api.users.getUserByName('twitchdev');        // HelixUser | null
const stream = await api.streams.getStreamByUserId(user!.id);   // null if offline
await api.asUser(broadcasterId, (ctx) => ctx.channels.updateChannelInfo(broadcasterId, { title: 'New' }));
const reward = await api.channelPoints.createCustomReward(broadcasterId, { title: 'Hydrate', cost: 500 });
await api.chat.sendChatMessageAsApp(botId, broadcasterId, 'hi', { replyParentMessageId: msgId }); // badge
await api.asUser(botId, (ctx) => ctx.chat.sendChatMessage(broadcasterId, 'hi'));                 // user token
for await (const f of api.channels.getChannelFollowersPaginated(broadcasterId)) { /* ... */ }
// escape hatch for endpoints Twurple doesn't model yet:
const pinned = await api.callApi<{ data: unknown[] }>({ type: 'helix', url: 'chat/pins', query: { broadcaster_id: broadcasterId, moderator_id: botId }, userId: botId });
```
Sub-APIs: `bits channels channelPoints charity chat clips contentClassificationLabels entitlements eventSub
extensions games goals hypeTrain moderation polls predictions raids schedule search streams subscriptions
teams users videos whispers`. Rate limiting is built in (`api.rateLimiterStats`). Which user's token is
used: the user "in context" — Twurple infers it from the broadcaster/moderator parameter when that user is
in the provider; force it with `asUser`/`asIntent`, force app token with `withoutUser`.
(`GET /helix/chat/pins?broadcaster_id&moderator_id` = Get Pinned Chat Message; Pin = `PUT` same path with
`message_id`, optional `duration_seconds` 30–1800 — details in the twitch-api skill.)

## EventSubWsListener (WebSocket transport — no public URL)
```ts
import { EventSubWsListener } from '@twurple/eventsub-ws';
const listener = new EventSubWsListener({ apiClient: api });
listener.onChannelChatMessage(broadcasterId, botId, (e) => console.log(e.chatterDisplayName, e.messageText, e.messageParts));
listener.onChannelFollow(broadcasterId, broadcasterId /* moderator */, (e) => console.log(e.userDisplayName));
listener.onChannelRedemptionAdd(broadcasterId, async (e) => { /* e.rewardTitle, e.input; e.updateStatus('FULFILLED') */ });
listener.onChannelHypeTrainBeginV2(broadcasterId, (e) => console.log(e.level, e.type)); // use V2 variants
listener.onSubscriptionCreateFailure((sub, err) => console.error(sub.id, err.message));
listener.onRevoke((sub, status) => console.error('revoked', sub.id, status));
listener.onUserSocketDisconnect((userId, err) => console.warn('socket down', userId, err?.message));
listener.start();
```
- Handlers exist for every current type: e.g. `onStreamOnline/Offline`, `onChannelUpdate`, `onChannelSubscription(/Gift/Message/End)`,
  `onChannelCheer`, `onChannelBitsUse`, `onChannelRaidTo/From`, `onChannelRewardAdd/Update/Remove`,
  `onChannelRedemptionAdd(ForReward)/Update`, `onChannelAutomaticRewardRedemptionAddV2`, `onChannelPowerUpRedemptionAdd`,
  `onChannelPoll*`, `onChannelPrediction*`, `onChannelGoal*`, `onChannelHypeTrain*V2`, `onChannelShoutoutCreate/Receive`,
  `onChannelAdBreakBegin`, `onChannelChatMessage/Notification/Clear/ClearUserMessages/MessageDelete/SettingsUpdate`,
  `onChannelModerate`, `onChannelBan/Unban`, `onChannelWarningSend/Acknowledge`, `onChannelVipAdd/Remove`,
  `onAutoModMessageHoldV2/UpdateV2`, `onChannelSuspiciousUser*`, `onChannelSharedChatSession*`, `onUserWhisperMessage`, …
  (non-V2 hype train handlers still exist in the typings but Twitch decommissioned v1.)
- Twurple keeps one socket per user token (Twitch allows 3 sockets / 300 subs per user token); it reconnects
  and resubscribes. Remember: events during a disconnect are **not replayed**.
- Event objects are classes with getters (`e.chatterDisplayName`), not the raw snake_case JSON. Newest fields
  may be missing from the class (8.2 chat-message fragments are typed only as `text|cheermote|emote|mention` —
  no `gif` fragment (Twitch added it 2026-07-16); chat-notification types include `watch_streak` but not
  `modiversary` or `gifted_drops_summary` (2026-06/10)) — raw data is on the internal payload; if you depend on brand-new
  fields, parse the payload yourself (raw WebSocket client: see the twitch-eventsub skill).
- **Local testing**: `twitch event websocket start-server -p 8080` and run your app with `TWURPLE_MOCK_API_PORT=8080`
  → listener connects to `ws://127.0.0.1:8080/ws` and POSTs subscriptions to `http://localhost:8080/eventsub/subscriptions` ✅.
  `await sub.getCliTestCommand()` returns e.g. `twitch event trigger follow -T websocket --session <id> -u <sub id>` ✅.
  ⚠️ Twurple routes notifications by **subscription id**: a plain `twitch event trigger channel.follow -T websocket`
  (random id) is dropped with "Notification from unknown event received" ✅. Always pass `-u <subscription id>`
  (from `getCliTestCommand()` or `GET /eventsub/subscriptions` on the mock) — then the handler fires ✅.
  Reconnect test (`twitch event websocket reconnect`) was handled transparently (new session, subs kept) ✅.
  ⚠️ With that env var set, **all** Helix calls go to `http://localhost:8080/mock/...` and auth calls to
  `http://localhost:8080/auth/...` (Twurple's URL switch), which the WebSocket mock server doesn't serve — avoid
  Helix calls in that test mode (and the mock rejects `channel.chat.message`; test chat with fixtures).

## EventSub over webhooks
```ts
import express from 'express';
import { EventSubMiddleware } from '@twurple/eventsub-http';
const appApi = new ApiClient({ authProvider: new AppTokenAuthProvider(clientId, clientSecret) }); // webhooks = app token
const middleware = new EventSubMiddleware({
  apiClient: appApi,
  hostName: 'abc123.trycloudflare.com',   // public HTTPS host Twitch can reach (port 443)
  pathPrefix: '/twitch',                  // callbacks under https://host/twitch/...
  secret: process.env.TWITCH_EVENTSUB_SECRET!, // 10-100 chars
});
const app = express();
middleware.apply(app);                    // BEFORE express.json(): it needs the raw body for HMAC
app.listen(3000, async () => {
  await middleware.markAsReady();        // only now are subscriptions created (Twitch verifies the callback)
  middleware.onChannelFollow(broadcasterId, broadcasterId, (e) => console.log(e.userDisplayName));
});
```
`EventSubHttpListener({ apiClient, adapter: new ReverseProxyAdapter({ hostName, port }), secret })` runs its own
server (`DirectConnectionAdapter` needs a cert; `NgrokAdapter` from `@twurple/eventsub-ngrok` for dev).
Twurple resumes matching existing subscriptions on restart. For subscriptions on behalf of users the users
must have authorized your client with the needed scopes earlier (webhooks never use their tokens directly).

## Conduits
Twurple 8.2 has full conduit **management** on `api.eventSub`: `createConduit(shardCount)`, `getConduits()`,
`updateConduit(id, shardCount)`, `deleteConduit(id)`, `getConduitShards(id)`, `updateConduitShards(id, shards)`, and
`createSubscription(type, version, condition, { method: 'conduit', conduit_id })`. Its **listeners do not act as
conduit shards** (no API to attach an `EventSubWsListener` session to a shard). For a conduit you write the shard
consumer yourself (raw WebSocket: welcome → `updateConduitShards` within 10 s → handle notifications) —
see the twitch-eventsub skill. For a hackathon you almost never need conduits.

## ChatClient / easy-bot (IRC) — when they still make sense
```ts
import { Bot, createBotCommand } from '@twurple/easy-bot';
const bot = new Bot({ authProvider: auth, channels: ['yourchannel'], commands: [
  createBotCommand('dice', (_params, { reply }) => reply(`You rolled ${1 + Math.floor(Math.random() * 6)}`), { userCooldown: 10 }),
] });
bot.onSub(({ userName }) => void bot.say('yourchannel', `Thanks @${userName}!`));
```
Fine for a 10-minute prototype. Trade-offs: IRC scopes (`chat:read chat:edit`), no Chat Bot badge, the bot
won't show in the Chat Bots list, and Twitch's current guidance is EventSub (`channel.chat.message`) + Send
Chat Message. Prefer `EventSubWsListener.onChannelChatMessage` + `api.chat.sendChatMessage(AsApp)` (template).

## Template
`assets/templates/twurple-quickstart.ts`: RefreshingAuthProvider fed from `scripts/token.ts`'s token file with
atomic persistence on refresh, hourly validation, EventSubWsListener for chat/follow/redemption/cheer/sub/raid/
hype-train v2, `!hello` reply via Send Chat Message (app token → badge when a secret is configured).
