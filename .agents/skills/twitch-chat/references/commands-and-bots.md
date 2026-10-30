# Bot architecture in TypeScript: commands, permissions, queues, multi-channel, LLM bots, testing

Reference implementation: `assets/templates/chatbot.ts` (zero deps, Node ≥ 22). This file explains the design
so you can adapt it — or map it onto Twurple.

## Contents
1. [Pick the bot shape](#1-pick-the-bot-shape)
2. [Message pipeline](#2-message-pipeline)
3. [Command parsing](#3-command-parsing)
4. [Permissions from badges](#4-permissions-from-badges)
5. [Cooldowns](#5-cooldowns)
6. [Outgoing queue](#6-outgoing-queue)
7. [Tokens & refresh](#7-tokens--refresh)
8. [Multi-channel bots (conduits + app token)](#8-multi-channel-bots)
9. [State persistence](#9-state-persistence)
10. [LLM-powered chat responses — safety](#10-llm-powered-chat-responses)
11. [Testing without real chat](#11-testing)
12. [Twurple mapping](#12-twurple-mapping)

---

## 1. Pick the bot shape

| Shape | Read via | Send via | Tokens | When |
|---|---|---|---|---|
| **Single-channel hackathon bot** (template default) | EventSub **WebSocket** | Helix, user token | bot user token (`user:read:chat user:write:chat`) | fastest path; runs on a laptop; no public URL |
| Same + **Chat Bot badge** | EventSub WebSocket (user token) | Helix with **app token** (`TWITCH_SEND_WITH_APP_TOKEN=1`) | + bot authorized `user:bot`; broadcaster authorized `channel:bot` (or bot is mod) | looks official in chat; bot ≠ broadcaster |
| **Installed bot / broadcaster-as-bot** | WebSocket | Helix | broadcaster's own user token | streamer tool, overlay+chat app; never gets the badge |
| **Cloud bot for many channels** | **Conduit** (webhook and/or WebSocket shards) with **app token** | Helix app token | bot: `user:read:chat user:write:chat user:bot` once; each broadcaster: `channel:bot` | listed as "Chat Bots" in Users in Chat, no 100-channel join cap for `channel:bot` channels, no join rate limit |

Bot account vs broadcaster account: use a **separate Twitch account** for the bot (its own name, its own rate
limits, can be modded, can get the badge). Using the broadcaster's account is fine for installed tools but the
messages appear as the streamer and never get the badge. Give the bot account a verified phone number (some
channels require it to chat; whispers require it). Make it a **moderator** in channels you control:
100 msgs/30 s, no 1 msg/s per-channel cap, unaffected by slow/sub/follower-only modes, and it may then use
moderation endpoints.

## 2. Message pipeline

```
EventSub frame ─► dedupe metadata.message_id ─► switch subscription_type
   channel.chat.message ─► ignore own (chatter_user_id == bot) / ignored bots
                          ─► shared-chat filter (source_broadcaster_user_id ≠ broadcaster) 
                          ─► parseCommand (strip reply "@parent " prefix)
                          ─► lookup ─► permission ─► cooldown ─► handler ─► SendQueue ─► Helix
```

Why each step exists:
- **Dedupe**: EventSub can redeliver; `metadata.message_id` (WS) / `Twitch-Eventsub-Message-Id` (webhook).
- **Ignore own messages**: EventSub delivers the bot's own messages. A command whose reply contains a
  command trigger ("Type !hello to …") would loop forever and burn the rate limit. Also ignore other known
  bots (Nightbot, StreamElements…) to avoid bot ping-pong.
- **Shared chat**: commands from other channels in a session would otherwise fire in yours.
- **Reply prefix**: replying to the bot produces text `"@botname !cmd"`.

## 3. Command parsing

`parseCommand(text, prefix='!', replyParentLogin?)` → `{name (lower-case), args[], rest}` or null.

- Trim; if `reply` is set and text starts with `@<reply.parent_user_login>`, strip it.
- Must start with the prefix and have a non-space name right after (`"! ping"` is not a command).
- Lower-case the name; keep args' case (`!so @SomeStreamer`). `rest` keeps the raw remainder for free text.
- Aliases map to the same handler. Unknown commands: stay silent (other bots share the `!` namespace).
- Strip a leading `@` from user args and resolve logins via Get Users (`/helix/users?login=`) when needed.
- Never trust args: clamp numbers (`!dice 1e9`), cap lengths, and never interpolate into shell/SQL/HTML.

## 4. Permissions from badges

Derive per message from `event.badges` (they're the chatter's badges in this channel):

| Level | Badge `set_id` |
|---|---|
| broadcaster | `broadcaster` (or `chatter_user_id === broadcaster_user_id`) |
| moderator | `moderator` |
| vip | `vip` |
| subscriber | `subscriber`, `founder` |
| everyone | — |

Badges reflect what chat displays for that message — good enough for command gating and cheap (no API
call). If you need authoritative status (e.g. paid perks), confirm with Check User Subscription / Get
Moderators / Get VIPs (broadcaster scopes) and cache the result.

## 5. Cooldowns

- Per-user cooldown (`cmd:user` key) stops individual spam; global cooldown (`cmd` key) protects the chat and
  your send budget from 50 people typing `!dice` at once.
- Moderators/broadcaster bypass cooldowns (template behaviour).
- Record the timestamp *before* running async handlers so concurrent messages can't double-fire.
- Respond to cooldown hits silently (replying "on cooldown" doubles traffic).
- Keep cooldown state in memory; it's fine to lose on restart.

## 6. Outgoing queue

Implemented by `SendQueue` in the template:

- Sliding window 18 msgs / 30 s (non-privileged) or 90 / 30 s (bot is broadcaster/mod/VIP), plus 1.1 s spacing
  per channel when not privileged (doc limit: 1 msg/s/channel). One queue **per bot account**, shared across
  channels (the 20/30 s limit is per account across channels); per-channel spacing keyed by channel in a
  multi-channel bot.
- Truncate to 500 characters (by code point, not UTF-16 unit, to avoid broken emoji); flatten newlines.
- Bounded queue (drop oldest) — a backlog of stale replies is worse than silence.
- Identical consecutive message within 30 s is rejected by chat (`msg_duplicate`); append an invisible
  U+E0000 or vary the text.
- Check `is_sent`/`drop_reason` and 429; on 429 back off until `Ratelimit-Reset`.
- Prefer replies (`reply_parent_message_id`) for answers to a specific user — clearer than `@name`.

## 7. Tokens & refresh

- User tokens expire (check `expires_in` from `/oauth2/validate`); refresh with the refresh token + client secret
  (`POST https://id.twitch.tv/oauth2/token grant_type=refresh_token`). **Refresh tokens rotate** — persist the
  new one. Validate on startup (`GET https://id.twitch.tv/oauth2/validate`) and hourly; check scopes.
- WebSocket EventSub subscriptions live as long as the socket; a token expiring doesn't kill existing
  subscriptions, but re-subscribing after a reconnect needs a valid token.
- App tokens: client-credentials, no refresh token — just request a new one on 401.
- Quick test token: `twitch token -u -s "user:read:chat user:write:chat user:bot"` (Twitch CLI; needs
  `twitch configure` with your client id/secret and the app's redirect URI set to `http://localhost:3000`,
  the CLI's default `-p 3000`; `--dcf` uses device code flow instead). Refresh: `twitch token -R <refresh>`;
  validate: `twitch token -v <token>`. Full OAuth flows: **twitch-dev** skill.
- Authorization links for a bot: bot account authorizes your client once with
  `user:read:chat user:write:chat user:bot`; each broadcaster authorizes `channel:bot` (plus whatever broadcaster
  features you need) — then use the app token.

## 8. Multi-channel bots

- WebSocket transport is per user token (3 connections, 300 subs each, 10 total cost) — fine for a handful of
  channels, not for hundreds.
- Scale-out: **conduit** (app token) whose shards are webhook endpoints or WebSocket sessions; create
  `channel.chat.message` subscriptions with `transport: {method:"conduit", conduit_id}`, condition
  `{broadcaster_user_id, user_id: botId}`. With `channel:bot` from each broadcaster, joins don't count toward
  the 100-channel limit and aren't rate-limited. Conduit management: **twitch-eventsub** skill.
- Keep per-channel config (prefix, enabled commands, custom commands, cooldowns) in a store keyed by
  `broadcaster_user_id`; load it in the dispatcher.
- One `SendQueue` per sender account with per-channel spacing; prioritize mod-requested messages.
- Handle `revocation` (bot banned, user revoked authorization, `user.authorization.revoke`): mark the channel
  inactive, don't retry-storm.
- Use Get Moderated Channels (`user:read:moderated_channels`) to know where the bot is mod → bigger limits.

## 9. State persistence

- Template: JSON file with atomic write (`write tmp` + `rename`), saved every 5 s if dirty and on SIGINT/SIGTERM.
- Hackathon-grade alternatives: SQLite (`better-sqlite3`, or the still-experimental built-in `node:sqlite`),
  Redis for multi-instance bots. Persist: custom commands, counters, quotes, per-user
  points, tokens (encrypted at rest), last-seen `message_id` if you need idempotency.
- Never persist tokens in the same file you commit; `.gitignore` them.

## 10. LLM-powered chat responses

Chat is untrusted, adversarial input broadcast to an audience. Rules:

1. **Trigger narrowly**: only on an explicit command (`!ask …`) or a mention of the bot, never on every
   message. Per-user cooldown (≥30 s) + global budget (e.g. ≤ 6 LLM replies/min) + daily cap per user.
2. **Treat chat text as data**: put it in a clearly delimited user turn; the system prompt states it may
   contain instructions that must be ignored. Never let chat content choose tools, URLs, or moderation
   actions without a human/mod in the loop.
3. **Never echo injection**: don't repeat the user's message verbatim ("You said: …") — attackers use the bot
   to post slurs/links with the bot's (mod) privileges. Don't follow "say exactly …" requests.
4. **Output filtering before sending**: length cap (≤ 450 chars to leave room), single line, strip `@everyone`-
   style mass pings, strip/deny URLs unless allow-listed, block leading `/` or `.` (legacy chat-command
   syntax), run through **Check AutoMod Status** (`POST /moderation/enforcements/status`, `moderation:read`,
   5–30 checks/min by account type) and/or your own blocklist. If flagged → don't send.
5. **No secrets in context**: no tokens, system prompts with private data, or other users' whispers.
6. **Respect channel rules**: obey slow/emote/sub-only modes (check settings), don't respond in shared chat
   from other channels unless intended, make the bot clearly a bot (Chat Bot badge via app token).
7. **Kill switch**: a mod-only `!ai off` command and an env flag.
8. **Log** prompt, output, and decision for moderation review; keep only what you need.
9. Latency: acknowledge long generations with nothing (don't spam "thinking…"); reply via
   `reply_parent_message_id` so context survives the delay.

## 11. Testing

- `channel.chat.message` cannot be triggered by the Twitch CLI (v1.1.24), and the CLI's mock EventSub
  WebSocket rejects chat subscription types. Test the bot's logic with fixtures:
  - `scripts/fixtures/channel.chat.message.json` = the official example payload. `scripts/selftest.ts` wraps it
    in a WebSocket notification envelope, swaps in `!hello`, and asserts routing, own-message ignoring,
    dedupe, cooldowns, permissions, the reply prefix and shared-chat filtering.
  - Pattern: `makeDispatcher(router)(envelope)` with an injected `send` that records output.
- Transport: the template's EventSub client was exercised against a fake EventSub WS pair (welcome →
  notification → `session_reconnect` → welcome on the new URL) — it re-used subscriptions, closed the old
  socket after the new welcome, and routed commands on both sockets. Against `twitch event websocket
  start-server -p <port>` you can check welcome + keepalive handling.
- Live smoke test: a second account (or the broadcaster) in the channel, `!ping` → `pong`.
- Load test the queue by pushing 50 messages and checking spacing (template: 1.1 s apart non-privileged).

## 12. Twurple mapping

| Template piece | Twurple (v8) |
|---|---|
| EventSub WS + subscribe | `new EventSubWsListener({ apiClient })`, `listener.onChannelChatMessage(broadcaster, bot, e => …)`, also `onChannelChatNotification`, `onChannelChatMessageDelete`, `onChannelChatClearUserMessages`, `onChannelChatClear`, `onChannelChatSettingsUpdate`, `onChannelSharedChatSessionBegin/Update/End`, `onUserWhisperMessage` |
| Send | `apiClient.chat.sendChatMessage(broadcaster, text, { replyParentMessageId })`; app token: `sendChatMessageAsApp(bot, broadcaster, text)` |
| Announcements / shoutouts / settings | `apiClient.chat.sendAnnouncement`, `shoutoutUser`, `getSettings`/`updateSettings` |
| Badges / emotes | `apiClient.chat.getGlobalBadges`, `getChannelBadges`, `getGlobalEmotes`, `getChannelEmotes`, `getEmotesFromSets` |
| Token refresh | `RefreshingAuthProvider` (persist `onRefresh` tokens) |
| IRC | `@twurple/chat` `ChatClient` (IRC-based) — use only for read-heavy legacy cases |

Twurple doesn't give you the command router, cooldowns or send queue — keep those from the template.
