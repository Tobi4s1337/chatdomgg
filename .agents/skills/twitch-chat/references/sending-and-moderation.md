# Sending messages & moderating chat (Helix)

All endpoints are under `https://api.twitch.tv/helix`, need `Authorization: Bearer <token>` + `Client-Id`.
"App token via prior authorization" = an app access token works if the named user previously authorized your
client with the listed scopes (and, where noted, `user:bot` / `channel:bot`). Verbatim details:
`grep -n "^## Send Chat Message" -A 80` in the twitch-api skill's `references/official/api_reference.md`
(this skill's `references/official/` holds the chat guides).

## Contents
1. [Send Chat Message](#1-send-chat-message)
2. [Rate limits for sending](#2-rate-limits-for-sending)
3. [Announcements, shoutouts, pinned messages](#3-announcements-shoutouts-pinned-messages)
4. [Chat settings](#4-chat-settings)
5. [Bans, timeouts, deletes, warnings](#5-bans-timeouts-deletes-warnings)
6. [AutoMod, blocked terms, unban requests, suspicious users, Shield Mode](#6-automod-blocked-terms-unban-requests-suspicious-users-shield-mode)
7. [Moderators, VIPs, chatters, colors](#7-moderators-vips-chatters-colors)
8. [Whispers](#8-whispers)
9. [Endpoint/scope quick table](#9-endpointscope-quick-table)

---

## 1. Send Chat Message

`POST /chat/messages` — JSON body:

| Field | Req | Notes |
|---|---|---|
| `broadcaster_id` | yes | channel to post in |
| `sender_id` | yes | the bot/user id; must match the token's user (user token) |
| `message` | yes | **max 500 characters**; emotes by case-sensitive name; 422 if too large |
| `reply_parent_message_id` | no | `message_id` from channel.chat.message → threaded reply. Don't prepend `@user` yourself; Twitch shows it. |
| `for_source_only` | no | **app token only** (400 with user token). Shared chat: `true` (default for app tokens since 2025-05-19) = only `broadcaster_id`'s channel; `false` = all channels in the session. User tokens always send to all. |
| `pin` | no | NEW (2026-05): send + pin for 20 minutes. Needs `moderator:manage:chat_messages`, sender must be broadcaster/mod; cannot combine with `reply_parent_message_id`/`for_source_only`; if the pin fails the message isn't sent. |

Authorization (one of):
- **User token** with `user:write:chat` (sender = token user). Shows as a normal user message.
- **App token**, where the sender authorized `user:write:chat` + `user:bot`, and the broadcaster authorized
  `channel:bot` **or** the sender is a moderator there. → This is the only way to get the **Chat Bot badge**
  (sender ≠ broadcaster). Twurple: `apiClient.chat.sendChatMessageAsApp(user, broadcaster, text)`.

Response `200`: `{"data":[{"message_id":"…","is_sent":true,"drop_reason":null}]}`.
**HTTP 200 does not mean delivered** — always check `is_sent`. When false, `message_id` is `""` and
`drop_reason: {code, message}` explains (docs show `automod_held` "Your message has been held for review by
Automod."). The full list of codes is not documented — log `code`+`message`, don't hardcode. Expect drops for
chat restrictions the bot doesn't satisfy: slow mode, followers-only, subscriber-only, emote-only, unique-chat
(r9k), duplicate message within 30 s, AutoMod/blocked terms, verified-phone/email requirements, being
timed out. Pre-empt with Get Chat Settings / `channel.chat_settings.update`, or make the bot a mod/VIP.

Errors: 400 (bad ids / `for_source_only` with user token / pin conflicts), 401 (scope/token/client-id
mismatch, `sender_id` ≠ token user), 403 (sender not permitted in that room — e.g. banned), 422 (too long),
429 (rate limit).

```ts
const r = await fetch('https://api.twitch.tv/helix/chat/messages', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
  body: JSON.stringify({ broadcaster_id, sender_id: botId, message: text.slice(0, 500), reply_parent_message_id }),
});
const { data: [res] } = await r.json() as SendChatMessageResponse;
if (!res.is_sent) console.warn('dropped', res.drop_reason);
```

## 2. Rate limits for sending

Two independent layers:

1. **Helix bucket**: Send Chat Message has its *own* bucket (the `Ratelimit-Limit` header may show a much
   larger number than your normal bucket) and doesn't consume your regular Helix budget. On 429 wait until
   `Ratelimit-Reset` (epoch seconds).
2. **Chat limits** (enforced by chat itself, per **sending user account**, summed over all channels and all
   app instances using that account):

| Account | Limit |
|---|---|
| Normal, in channels where it is **not** broadcaster/mod/VIP | **20 messages / 30 s**, and **1 message / second per channel** |
| Normal, where it **is** broadcaster/mod/VIP | **100 messages / 30 s** (these still count toward the 20/30 s bucket; after it's full, privileged channels keep working until 100) |
| Verified bot (rarely granted; reviews paused as of the snapshot) | 7500 / 30 s; still 1 msg/s per channel where not broadcaster/mod/VIP |

Exceeding them: Twitch ignores the bot's messages for **1 hour** (except where the bot is
broadcaster/mod/VIP). Design for ~10 % headroom; queue, coalesce, and drop low-value messages rather than
flooding. The template `SendQueue` uses 18/30 s (or 90/30 s privileged) + 1.1 s per-channel spacing. Simply
making the bot a **moderator** (or VIP) in the channel is the cheapest way to raise limits and skip slow mode.

Other per-endpoint limits: announcements 1 per 2 s; shoutouts 1 per 2 min and same target 1 per 60 min;
Add/Remove Moderator & VIP 10 per 10 s; Check AutoMod Status 5/min & 50/h (normal), 10/100 (affiliate),
30/300 (partner); whispers below. Ban/Unban/Warn document a per-minute per-broadcaster 429 without numbers.

## 3. Announcements, shoutouts, pinned messages

**Send Chat Announcement** `POST /chat/announcements?broadcaster_id=&moderator_id=` body
`{message (≤500, longer truncated), color?: blue|green|orange|purple|primary, for_source_only?}` → 204.
Scope `moderator:manage:announcements` (user token), or app token with that + `user:bot` from the moderator and
`channel:bot` from the broadcaster. Cannot be a reply. Shared chat behaviour like Send Chat Message
(`for_source_only` default `true` with app tokens). 1 per 2 s → 429.

**Send a Shoutout** `POST /chat/shoutouts?from_broadcaster_id=&to_broadcaster_id=&moderator_id=` → 204.
Scope `moderator:manage:shoutouts` (app-token variant needs `user:bot` + `channel:bot`). Requires the
broadcaster to be live with ≥1 viewer; no self-shoutouts; 1 per 2 min, same target 1 per 60 min.
Events: `channel.shoutout.create` (includes cooldown info) / `.receive`.

**Pinned chat messages** — open beta 2026-05-15, **GA 2026-05-29**. One mod-pinned message per channel.

| Endpoint | Method / params | Scope |
|---|---|---|
| Get Pinned Chat Message | `GET /chat/pins?broadcaster_id=&moderator_id=` → `message_id, sender_user_*, pinned_by_user_*, message{text,fragments}, starts_at, ends_at (null = until stream ends), updated_at` | `moderator:read:chat_messages` or `moderator:manage:chat_messages` |
| Pin Chat Message | `PUT /chat/pins?broadcaster_id=&moderator_id=&message_id=[&duration_seconds=30..1800]` → 204; replaces an existing pin; no duration = until stream ends; 409 if already pinned | `moderator:manage:chat_messages` |
| Update Pinned Chat Message | `PATCH /chat/pins?…&message_id=[&duration_seconds=]` → 204 (duration counted from now) | same |
| Unpin Chat Message | `DELETE /chat/pins?…&message_id=` → 204 | same |

App-token variant for all four: scope + `user:bot` from the moderator, `channel:bot` from the broadcaster.
Or use `pin:true` on Send Chat Message (fixed 20 min). No EventSub event for pin changes is documented.

## 4. Chat settings

- **Get Chat Settings** `GET /chat/settings?broadcaster_id=[&moderator_id=]` — app or user token. With a
  moderator user token incl. `moderator:read:chat_settings` also returns `non_moderator_chat_delay(_duration)`.
- **Update Chat Settings** `PATCH /chat/settings?broadcaster_id=&moderator_id=` — `moderator:manage:chat_settings`
  (app token via prior authorization OK). Body fields (all optional): `emote_mode`, `follower_mode` +
  `follower_mode_duration` (0–129600 min), `non_moderator_chat_delay` + `_duration` (2/4/6 s), `slow_mode` +
  `slow_mode_wait_time` (3–120 s), `subscriber_mode`, `unique_chat_mode`. To change a duration you must also
  send its boolean (`slow_mode:true, slow_mode_wait_time:10`).

## 5. Bans, timeouts, deletes, warnings

| Action | Endpoint | Scope | Notes |
|---|---|---|---|
| Ban / timeout | `POST /moderation/bans?broadcaster_id=&moderator_id=` body `{"data":{"user_id","duration"?,"reason"?}}` | `moderator:manage:banned_users` (app token: + `user:bot` from mod) | no `duration` = permanent ban; timeout 1…1,209,600 s (2 weeks); `duration:1` ends a timeout early; can't convert a ban into a timeout; reason ≤ 500 chars |
| Unban / untimeout | `DELETE /moderation/bans?broadcaster_id=&moderator_id=&user_id=` | same | |
| List banned | `GET /moderation/banned?broadcaster_id=` | `moderation:read` or `moderator:manage:banned_users` | broadcaster token |
| Delete message(s) | `DELETE /moderation/chat?broadcaster_id=&moderator_id=[&message_id=]` | `moderator:manage:chat_messages` | message must be < 6 h old, not from the broadcaster or another mod; omit `message_id` = clear whole chat |
| Warn | `POST /moderation/warnings?broadcaster_id=&moderator_id=` body `{"data":{"user_id","reason"}}` (reason required, ≤500) | `moderator:manage:warnings` | user can't chat until they acknowledge; new warning replaces old |

The moderator in `moderator_id` must match the token user and be a mod (or the broadcaster) — so a bot that
moderates must be **modded** in the channel. Events to watch: `channel.ban`, `channel.unban`,
`channel.chat.clear_user_messages`, `channel.chat.message_delete`, `channel.warning.*`, `channel.moderate`.

## 6. AutoMod, blocked terms, unban requests, suspicious users, Shield Mode

- **Held messages**: subscribe `automod.message.hold` (v2) with `moderator:manage:automod`, then
  `POST /moderation/automod/message` body `{"user_id": <moderator id>, "msg_id": <held message_id>, "action": "ALLOW"|"DENY"}`.
  (The `user_id` here is the **moderator** making the decision — must match the token.)
- **Check AutoMod Status** `POST /moderation/enforcements/status?broadcaster_id=` body
  `{"data":[{"msg_id","msg_text"}]}` (≤100) — `moderation:read`; rate limits in §2. Use it to pre-check
  what your LLM bot is about to say.
- **AutoMod settings** `GET|PUT /moderation/automod/settings?broadcaster_id=&moderator_id=`
  (`moderator:read:automod_settings` / `moderator:manage:automod_settings`): `overall_level` or per-category
  levels (aggression, bullying, disability, misogyny, race_ethnicity_or_religion, sex_based_terms,
  sexuality_sex_or_gender, swearing).
- **Blocked terms** `GET|POST|DELETE /moderation/blocked_terms` (`moderator:read:blocked_terms` /
  `moderator:manage:blocked_terms`): `text` 2–500 chars, `*` wildcard only at word start/end; `id` to delete.
- **Unban requests** `GET /moderation/unban_requests?broadcaster_id=&moderator_id=&status=pending|approved|denied|acknowledged|canceled`
  and `PATCH …&unban_request_id=&status=approved|denied[&resolution_text=]` — user token only,
  `moderator:read:unban_requests` / `moderator:manage:unban_requests`. Events `channel.unban_request.create/resolve`.
- **Suspicious users** (GA 2026-02-05) `POST /moderation/suspicious_users?broadcaster_id=&moderator_id=&user_id=&status=ACTIVE_MONITORING|RESTRICTED`
  / `DELETE …` — `moderator:manage:suspicious_users` (app or user token). Restricted users' messages only reach
  mods via `channel.suspicious_user.message` (`moderator:read:suspicious_users`).
- **Shield Mode** `GET|PUT /moderation/shield_mode?broadcaster_id=&moderator_id=` body `{"is_active":true}` —
  `moderator:read:shield_mode` / `moderator:manage:shield_mode`; events `channel.shield_mode.begin/end`.

## 7. Moderators, VIPs, chatters, colors

| Endpoint | Scope / token | Notes |
|---|---|---|
| `GET /moderation/moderators?broadcaster_id=[&user_id=…]` | broadcaster user token, `moderation:read` or `channel:manage:moderators` | ≤100 user_id filters |
| `POST`/`DELETE /moderation/moderators?broadcaster_id=&user_id=` | broadcaster, `channel:manage:moderators` | 10 per 10 s |
| `GET /moderation/channels?user_id=` | `user:read:moderated_channels` | channels the bot can moderate — handy for multi-channel bots |
| `GET /channels/vips?broadcaster_id=` | broadcaster, `channel:read:vips` / `channel:manage:vips` | |
| `POST`/`DELETE /channels/vips?broadcaster_id=&user_id=` | `channel:manage:vips` | 10 per 10 s |
| `GET /chat/chatters?broadcaster_id=&moderator_id=[&first≤1000]` | `moderator:read:chatters` (mod/broadcaster) | delayed list + `total`; the only replacement for IRC JOIN/PART/NAMES |
| `GET /chat/color?user_id=…` (≤100) | any token | `""` if unset |
| `PUT /chat/color?user_id=&color=` | `user:manage:chat_color` | named colors for all; hex (`%23RRGGBB`) for Turbo/Prime only |
| `GET`/`PUT`/`DELETE /users/blocks` | `user:read:blocked_users` / `user:manage:blocked_users` | user-level block list (not channel bans) |

## 8. Whispers

`POST /whispers?from_user_id=&to_user_id=` body `{"message": "…"}` → **204 even if silently dropped**.

- User token with `user:manage:whispers`; `from_user_id` = token user; sender needs a **verified phone number**.
- Limits: max **40 unique recipients per day**; within that, **3 whispers/s** and **100/min**. Verified bots
  get no higher limits; there's no way to raise them.
- Length: **500 chars** to someone you've never whispered before, **10,000** if you have.
- 400 when the recipient blocks whispers from strangers; 403 for suspended senders / sender settings; 429 limits.
- The API may silently drop policy-violating whispers (still 204).
- Receive: `user.whisper.message` EventSub (`user:read:whispers` or `user:manage:whispers`).
- Use whispers sparingly (e.g. one-time codes to a known user); post in chat or use an Extension for broadcast-
  style interaction.

## 9. Endpoint/scope quick table

| Want to… | Scope (user token) |
|---|---|
| read chat (EventSub) | `user:read:chat` (+ `user:bot`, + broadcaster `channel:bot` for app-token subs) |
| send chat | `user:write:chat` (+ `user:bot`, + broadcaster `channel:bot` or mod status for app-token sends) |
| IRC read / send | `chat:read` / `chat:edit` |
| announcements / shoutouts | `moderator:manage:announcements` / `moderator:manage:shoutouts` |
| delete msgs, clear chat, pin | `moderator:manage:chat_messages` (read pins: `moderator:read:chat_messages`) |
| ban / timeout / unban | `moderator:manage:banned_users` |
| warn | `moderator:manage:warnings` |
| chat settings | `moderator:read:chat_settings` / `moderator:manage:chat_settings` |
| chatters list | `moderator:read:chatters` |
| AutoMod queue / settings | `moderator:manage:automod` / `moderator:read|manage:automod_settings` |
| blocked terms | `moderator:read|manage:blocked_terms` |
| unban requests | `moderator:read|manage:unban_requests` |
| suspicious users | `moderator:read|manage:suspicious_users` |
| shield mode | `moderator:read|manage:shield_mode` |
| mods / VIPs (broadcaster) | `moderation:read`, `channel:manage:moderators`, `channel:read|manage:vips` |
| whispers | `user:read:whispers`, `user:manage:whispers` |
| emotes the user owns | `user:read:emotes` |
| chat color | `user:manage:chat_color` |
