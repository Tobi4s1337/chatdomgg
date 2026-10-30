# Twitch IRC — condensed guide

Twitch IRC (modified RFC1459 + IRCv3 message tags) is still running, but Twitch recommends EventSub + the
Twitch API for new work. Full official text: `references/official/chat_irc.md` (commands, every tag, NOTICE
ids) and `references/official/chat_irc-migration.md`. Template: `assets/templates/irc-client.ts`.

## Contents
1. [When IRC is still worth it](#1-when-irc-is-still-worth-it)
2. [Connect & authenticate](#2-connect--authenticate)
3. [Capabilities](#3-capabilities)
4. [Join / part / send / reply / keepalive / reconnect](#4-join--part--send--reply--keepalive--reconnect)
5. [Message format & tag parsing](#5-message-format--tag-parsing)
6. [Commands you receive](#6-commands-you-receive)
7. [Key tags](#7-key-tags)
8. [Limits](#8-limits)
9. [IRC → EventSub/API mapping](#9-irc--eventsubapi-mapping)

---

## 1. When IRC is still worth it

Use **EventSub** by default (structured fragments, no parsing, official badges, shared-chat fields, Chat Bot
badge/identity, moderation events). Consider IRC only for:

- Quick read-only tools/overlays across several channels with one socket and no subscription management
  (the same 100-channel concurrent join limit applies to both).
- JOIN/PART membership events in small rooms (<1,000 users) — EventSub has no equivalent (only Get Chatters,
  which needs mod).
- Porting legacy tmi.js-style code quickly.

Downsides: string parsing, emote positions instead of fragments, no Chat Bot badge, send failures arrive as
asynchronous NOTICEs instead of a response (`is_sent`), and IRC has no `/commands` except `/me` — moderation
must use the API anyway.

## 2. Connect & authenticate

| | WebSocket | Raw IRC |
|---|---|---|
| TLS | `wss://irc-ws.chat.twitch.tv:443` | `irc://irc.chat.twitch.tv:6697` |
| Non-TLS | **unavailable** (decommissioned 2025-08-15) | `irc://irc.chat.twitch.tv:6667` (avoid) |

1. (optional, recommended first) `CAP REQ :twitch.tv/tags twitch.tv/commands`
2. `PASS oauth:<user_access_token>` — scopes `chat:read` (read) and `chat:edit` (send)
3. `NICK <lowercase login of the token's user>`

Success: numerics `001`…`376` then `GLOBALUSERSTATE` (with tags). Failure: `:tmi.twitch.tv NOTICE * :Login
authentication failed` and the connection closes; PASS/NICK out of order → `Improperly formatted auth`.
Anonymous read-only login with `NICK justinfan<digits>` (no PASS) works in practice but is **not documented by
Twitch** — fine for a toy overlay, don't build a product on it.

## 3. Capabilities

| Capability | Gives |
|---|---|
| `twitch.tv/tags` | IRCv3 tags on messages (ids, badges, emotes, colors…). Requesting tags requires also requesting commands. |
| `twitch.tv/commands` | Twitch commands: CLEARCHAT, CLEARMSG, GLOBALUSERSTATE, NOTICE, RECONNECT, ROOMSTATE, USERNOTICE, USERSTATE; lets you send `/me`. |
| `twitch.tv/membership` | JOIN/PART of other users (not sent for rooms > 1,000 users). |

Reply: `:tmi.twitch.tv CAP * ACK :…` or `CAP * NAK :…` for unsupported ones.

## 4. Join / part / send / reply / keepalive / reconnect

- `JOIN #chan1,#chan2` → `JOIN`, `353` (names), `366`, then `USERSTATE` + `ROOMSTATE` (with commands cap).
  Suspended channel → NOTICE `msg_channel_suspended`; nonexistent channel → silently ignored.
- `PART #chan`.
- `PRIVMSG #chan :text` (emotes by name). `/me` → `PRIVMSG #chan :/me waves`. That's the only command over IRC.
- Reply: `@reply-parent-msg-id=<id> PRIVMSG #chan :text` (needs the `id` tag of the parent → tags cap).
- You don't receive your own PRIVMSG; you get a `USERSTATE` instead (no text).
- `PING :tmi.twitch.tv` → answer `PONG :tmi.twitch.tv` or get disconnected (server pings even before joins).
- `RECONNECT`: server will drop you soon — reconnect and rejoin channels.
- Server may batch several messages per frame (CRLF-separated), reorder, or duplicate them.
- Phone-verified chats → NOTICE `msg_requires_verified_phone_number`; compare `msg-id`, not text.

## 5. Message format & tag parsing

```
@tag1=v1;tag2=v2 :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :message text
└─ tags (optional) └─ prefix (optional)        └─ command └─ params └─ trailing (after " :")
```

Parsing algorithm (as implemented in `parseIrcLine`):
1. If it starts with `@`, take up to the first space; split on `;`; each `key=value` (split at first `=`;
   value may be empty: `badge-info=`).
2. If next starts with `:`, prefix up to the next space; `nick` = part before `!`.
3. Trailing = everything after the first `" :"`; the rest splits on spaces into command + params.

**Tag value unescaping (IRCv3)**: `\:` → `;`, `\s` → space, `\\` → `\`, `\r` → CR, `\n` → LF, any other `\x` →
`x`, a lone trailing `\` is dropped. E.g. `system-msg=ronni\shas\ssubscribed\sfor\s6\smonths!`.

Sub-formats:
- `badges` / `source-badges`: `set/version,set/version` (e.g. `broadcaster/1,subscriber/12`); `badge-info`:
  `subscriber/16` (exact months).
- `emotes`: `id:start-end,start-end/id:start-end` — zero-based, **inclusive** end; positions count Unicode
  code points (slice `Array.from(text)`, not `text.slice`). With `/me`, positions start after `\u0001ACTION `.
- `gifs` (2026-07): `start-end|gifID|gifURL` comma-separated; use the URL unmodified.
- `/me`: trailing is `\u0001ACTION text\u0001`.
- Booleans are `0`/`1`; `vip` tag is present only when true (check presence).
- `tmi-sent-ts`: Unix ms. `color` may be empty.
- Only parse tags you know; ignore the rest. Undocumented tags (`client-nonce`, `flags`, `first-msg`,
  `returning-chatter`) are "not supported for third-party use" per the docs.

Docs typo to be aware of: the Shared Chat examples on the IRC page show `PRIVMSG #twitch:Howdy!` without the
space before `:`; real traffic has `PRIVMSG #twitch :Howdy!`.

## 6. Commands you receive

| Command | Meaning | Key tags |
|---|---|---|
| `PRIVMSG` | chat message | see §7 |
| `USERNOTICE` | sub/resub/gift/raid/… system event | `msg-id` (sub, resub, subgift, submysterygift, giftpaidupgrade, rewardgift, anongiftpaidupgrade, raid, unraid, bitsbadgetier, sharedchatnotice, modiversary, viewermilestone), `system-msg`, `msg-param-*`, `login`, `source-msg-id` |
| `CLEARCHAT` | `#chan` alone = chat cleared; `#chan :user` = user banned/timed out | `ban-duration` (seconds, timeouts only), `target-user-id`, `room-id` |
| `CLEARMSG` | single message deleted | `login`, `target-msg-id` |
| `ROOMSTATE` | on join (full) and on change (only changed tag) | `emote-only`, `followers-only` (-1 off, minutes), `r9k`, `slow` (s), `subs-only`, `room-id` |
| `USERSTATE` | after join or after you send | your badges, color, `emote-sets`, `mod`, `id` (of your sent msg) |
| `GLOBALUSERSTATE` | after login | `user-id`, `emote-sets`, `badges`, `color` |
| `NOTICE` | outcome of an action / error | `msg-id` (e.g. `msg_ratelimit`, `msg_duplicate`, `msg_slowmode`, `msg_subsonly`, `msg_followersonly`, `msg_emoteonly`, `msg_r9k`, `msg_banned`, `msg_timedout`, `msg_requires_verified_phone_number`, `msg_verified_email`, `msg_channel_suspended`, `msg_rejected`, `msg_rejected_mandatory`, `msg_bad_characters`, `msg_channel_blocked`, `msg_suspended`, `tos_ban`, `unrecognized_cmd`…), `target-user-id` |
| `JOIN`/`PART`/`353`/`366` | membership (membership cap; <1,000 users) | — |
| `PING`, `RECONNECT` | keepalive / maintenance | — |

## 7. Key tags

PRIVMSG: `id` (message id — needed for replies/deletes), `user-id`, `display-name`, `color`, `badges`,
`badge-info`, `emotes`, `gifs`, `bits` (cheer amount), `mod`, `subscriber`, `vip`, `room-id`, `tmi-sent-ts`,
`user-type` (`""`, `admin`, `global_mod`, `staff`), `reply-parent-msg-id`, `reply-parent-user-id`,
`reply-parent-user-login`, `reply-parent-display-name`, `reply-parent-msg-body`, `reply-thread-parent-msg-id`,
`reply-thread-parent-user-login`, shared chat: `source-id`, `source-room-id`, `source-badges`,
`source-badge-info`, `source-only`.

USERNOTICE `msg-param-*` (selection): `cumulative-months`, `streak-months`, `should-share-streak`, `sub-plan`
(`Prime`/`1000`/`2000`/`3000`), `sub-plan-name`, `months`, `gift-months`, `recipient-id`,
`recipient-user-name`, `recipient-display-name`, `sender-login`, `sender-name`, `promo-name`,
`promo-gift-total`, `displayName`/`login`/`viewerCount` (raid), `threshold` (bitsbadgetier),
`category=watch-streak`/`id`/`value` (viewermilestone).

## 8. Limits

| Limit | Normal account | Verified bot |
|---|---|---|
| Messages (per user, all channels) | 20 / 30 s; 100 / 30 s in channels where broadcaster/mod/VIP | 7500 / 30 s |
| Per channel when not broadcaster/mod/VIP | 1 msg / s | 1 msg / s |
| JOIN attempts | 20 / 10 s per user | 2,000 / 10 s |
| Authentication attempts (IRC only) | 20 / 10 s per user | 200 / 10 s |
| Concurrent joined channels (since 2024-05-15) | 100 (broadcaster/mod joins don't count) | — |

Exceeding message limits → messages ignored for 1 hour (except where broadcaster/mod/VIP); too many in a burst
→ silently dropped and possibly disconnected. Verified-bot reviews were paused at snapshot time.

## 9. IRC → EventSub/API mapping

| IRC | EventSub / API |
|---|---|
| `PASS`/`chat:read` read | `channel.chat.message` with `user:read:chat` (+ `user:bot` & `channel:bot`/mod for app token) |
| `PRIVMSG` send / `chat:edit` | `POST /helix/chat/messages` with `user:write:chat` |
| PRIVMSG `badges`/`badge-info` | `event.badges[] {set_id,id,info}` |
| PRIVMSG `emotes` | `message.fragments[]` type `emote` |
| PRIVMSG `reply-*` | `event.reply{parent_*, thread_*}`; send with `reply_parent_message_id` |
| PRIVMSG `bits` | `event.cheer.bits` + `cheermote` fragments |
| `CLEARCHAT` (all) | `channel.chat.clear` |
| `CLEARCHAT` (user) | `channel.chat.clear_user_messages` (no duration — use `channel.ban` for that) |
| `CLEARMSG` | `channel.chat.message_delete` |
| `ROOMSTATE` | `channel.chat_settings.update` (changes only) + Get Chat Settings on join |
| `USERSTATE`/`GLOBALUSERSTATE` | Get Users (id/name/type), Get User Emotes (`user:read:emotes`), Get User Chat Color, badges from your own messages |
| `USERNOTICE` | `channel.chat.notification` (`notice_type`: sub, resub, sub_gift, community_sub_gift, gift_paid_upgrade [incl. anon], raid, unraid, bits_badge_tier, …; `rewardgift` has no equivalent) |
| `JOIN`/`PART`/`NAMES` | none; Get Chatters (`moderator:read:chatters`, mod/broadcaster) |
| `PING`/`PONG` | WebSocket ping frames + `session_keepalive`; none for webhooks |
| `RECONNECT` | `session_reconnect` with `reconnect_url` (subscriptions carry over) |
| `NOTICE` on send | `is_sent:false` + `drop_reason` in the Send Chat Message response |
| `NOTICE` on join (banned) | Create EventSub Subscription → 403 "subscription missing proper authorization" |
| removed from room | subscription revoked; `status` e.g. `chat_user_banned` |
| `/me` | no Send Chat Message equivalent documented |
