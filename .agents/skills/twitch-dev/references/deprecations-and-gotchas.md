# What's dead, what's new, and platform-wide gotchas (as of the 2026-10-26 docs snapshot)

**Old tutorials, Stack Overflow answers, npm READMEs and LLM training data are frequently wrong about
Twitch.** The platform removed several whole APIs between 2019 and 2025 and renamed/versioned many
EventSub types. Before using any Twitch API you "remember", confirm it in `references/official/` (or the
twitch-api / twitch-eventsub / twitch-chat / twitch-extensions skills). Red flags in code you're about to
write or copy: `api.twitch.tv/kraken`, `Accept: application/vnd.twitchtv.v5+json`, `pubsub-edge.twitch.tv`,
`/helix/users/follows`, `/helix/webhooks/hub`, `channel.follow` version `1`, `hype_train` version `1`,
`tmi.twitch.tv/group/user/<x>/chatters`, `ws://irc-ws.chat.twitch.tv:80`, IRC `PRIVMSG #c :/ban x`,
`tag_ids`, "Developer Rig".

Sources: `references/official/product-lifecycle.md`, `references/official/change-log.md`.

## 1. Dead or dying → replacement

| Thing | Status (date) | Use instead |
|---|---|---|
| **PubSub** (`wss://pubsub-edge.twitch.tv`, topics like `channel-points-channel-v1`, `channel-bits-events-v2`, `whispers`, `chat_moderator_actions`) | Deprecated; **shut down 2025-04-14**; migration guide removed 2026-06-12 | **EventSub** (WebSocket transport for client-side apps): `channel.channel_points_custom_reward_redemption.add`, `channel.cheer` / `channel.bits.use`, `channel.subscribe` / `.message` / `.gift` (or `channel.chat.notification`), `user.whisper.message`, `channel.moderate` v2, `automod.message.hold` v2, `channel.hype_train.*` v2, `channel.poll.*`, `channel.prediction.*` |
| ↳ *not* to be confused with **Extension PubSub** (`Send Extension PubSub Message`, `Twitch.ext.listen/send`) | still active | see the twitch-extensions skill |
| `@twurple/pubsub`, `twitch-pubsub-client`, tmi-era PubSub libs | dead with PubSub | `@twurple/eventsub-ws` or raw EventSub |
| **Twitch API v5 "Kraken"** | decommissioned 2022-02 | Helix (`https://api.twitch.tv/helix`) |
| Twitch API v3 | decommissioned 2019-09 | Helix |
| **WebSub webhooks** (`/helix/webhooks/hub`) | decommissioned 2021-09 | EventSub webhooks |
| Create/Delete Follows endpoints | decommissioned 2021-07 | none — apps cannot follow on a user's behalf |
| **Get Users Follows** (`/helix/users/follows`) | removed 2023-09-06 | Get Channel Followers (`moderator:read:followers`; broadcaster or mod) / Get Followed Channels (`user:read:follows`) |
| **`channel.follow` v1** | removed 2023-09-06 | `channel.follow` **v2** (condition `broadcaster_user_id` + `moderator_user_id`, scope `moderator:read:followers`) |
| **Hype Train EventSub v1** + **Get Hype Train Events** | deprecated 2025-06-13, **decommissioned 2025-12-04** (endpoint removed from docs 2026-02-05) | `channel.hype_train.begin/progress/end` **v2** (fields like `type` incl. golden kappa, `is_shared_train`, `shared_train_participants`, `all_time_high_level/_total`) + **Get Hype Train Status** (GA 2025-08-19). ⚠️ Twitch CLI 1.1.24 still only emits v1 hype-train payloads |
| **Non-secure IRC WebSocket** `ws://irc-ws.chat.twitch.tv:80` | decommissioned 2025-08-15 | `wss://irc-ws.chat.twitch.tv:443` (or better: EventSub chat + Send Chat Message). Plain-IRC `:6667` still listed, `:6697` TLS preferred |
| IRC slash commands in PRIVMSG (`/ban`, `/timeout`, `/mod`, `/color`, …) | removed (2023) — "the only supported command over IRC is `/me`" | Helix: Ban User, Delete Chat Messages, Add Channel Moderator, Update User Chat Color, Send Chat Announcement, Send a Shoutout, Update Chat Settings |
| `tmi.twitch.tv/group/user/<ch>/chatters` | unofficial, gone | Get Chatters (`moderator:read:chatters`) |
| Stream `tag_ids`, Replace Stream Tags, Get All Stream Tags | removed 2023 | free-form `tags` on Modify Channel Information / Get Streams |
| **Twitch Developer Rig** | decommissioned (end of support 2023-01) | Extension local test / Hosted Test in the console (twitch-extensions skill) |
| Enhanced Experiences | decommissioned 2022-04 | — |
| Legacy Drops, Quarterly Insights reports, Chat rooms | decommissioned 2021 / 2021 / 2020 | Drops (current), Insights CSV/API, — |
| Bits **Combos** event type in `channel.bits.use` | removed from event types 2026-04-02 | `channel.bits.use` `type`: `cheer`, `power_up`, `custom_power_up` |
| `channel_points_custom_reward` "animated"/"gigantified" enum values | renamed 2024-06-13 | `power_ups_message_effect`, `power_ups_gigantified_emote`; automatic reward types `message_effect`, `gigantify_an_emote`, `celebration` |
| EventSub **beta** versions | auto-deleted 30 days after the GA version ships | move to the numbered version (`1`, `2`) |
| Verified-bot ("known/verified") applications | reviews **temporarily paused** (2026 docs banner) | stay within normal limits; make your bot a mod (100 msgs/30 s) |

Current product status (lifecycle page): Active — Authentication (OIDC, user, app tokens), Chat (IRC),
Drops, Embeds, Extensions, EventSub (Webhooks, WebSockets, Conduits), Game Engine Plugins, Insights &
Analytics, Mobile Deep Links, Twitch API (Helix), Twitch CLI. Deprecated — PubSub. Decommissioned — the rest above.

## 2. 2024 → 2026 changelog digest (what builders should know)

**Chat & bots**
- 2024-01-25 **Send Chat Message** API + `channel.chat.message` EventSub (chat without IRC). Since then:
  chat-related types `channel.chat.notification`, `.clear`, `.clear_user_messages`, `.message_delete`,
  `channel.chat_settings.update`, `channel.chat.user_message_hold/update`.
- 2024-09 **Shared Chat** (`channel.shared_chat.begin/update/end`, Get Shared Chat Session; `source_*` fields
  on chat events/IRC tags). 2025-04-10 `is_source_only` / `for_source_only`; since **2025-05-19** app-token
  messages go **only to the source channel by default** (`for_source_only` defaults to true for app tokens;
  not allowed with user tokens → 400). 2026-04-02 same parameter for **Send Chat Announcement** (+ app-token support).
- 2025-08-28 **Chatbot badge & chat identity** rules documented (app token + `user:bot` + `channel:bot`/mod).
- 2026-05-15 (beta) → **2026-05-29 GA: Pinned chat messages** — Get/Pin/Update/Unpin Chat Message, and
  `pin` on Send Chat Message (sender must be broadcaster/mod; needs `moderator:manage:chat_messages`; pinned 20 min).
- 2026-07-16 `channel.chat.message` **`gif` fragment** (`gif: { gif_id, url }` alongside `text`); 2026-07-17 IRC `gif` tag.
- `channel.chat.notification` notice types added: **watch streaks** (2026-04-02; IRC `viewermilestone`),
  **modiversary** / `shared_chat_modiversary` (2026-06-12), `gifted_drops_summary` /
  `shared_chat_gifted_drops_summary` (2026-10-01), and `unknown` (documented 2026-06-08) — **always handle
  unknown notice types gracefully**.
- 2024 Warnings (`Warn Chat User`, `channel.warning.send/acknowledge`, `moderator:*:warnings`), `channel.moderate` **v2**.
- 2024 Suspicious users (`channel.suspicious_user.message/update`); 2026-02-05 GA Add/Remove Suspicious Status.
- AutoMod v2 (`automod.message.hold/update` v2, public blocked terms only); 2026-09-16 `blocked_link` reason.

**Monetization & engagement**
- 2025-02-27 **`channel.bits.use`** GA — one event for all Bits usage (cheers + Power-ups); 2026-04 Custom
  Power-ups added, Combos removed.
- 2025-02-27 `channel.channel_points_automatic_reward_redemption.add` **v2**.
- 2026-05-19 GA **Custom Power-ups**: Get Custom Power-up + `channel.custom_power_up_redemption.add` v1 (`bits:read`).
- 2025-08-19 Get Hype Train Status GA; v2 hype train types (see table).
- 2024/2026 Creator Goals types `new_bit`, `new_cheerer`.

**Clips**: 2025-12-19 Create Clip gets `title`, `duration`, 2K/vertical; **Create Clip From VOD** (GA 2026-02-05;
`channel:manage:clips` / `editor:manage:clips`); **Get Clips Download** (GA 2025-10-30).

**Auth / platform**
- 2025-10-18 beta → 2025-10-30 GA **Get Authorization By User** (app token; which scopes a user granted).
- 2026-02-27 beta → **2026-05-29 GA: app access token support for many endpoints** ("app token where the
  user previously authorized the scope": ads, chatters, chat settings, announcements, shoutouts, moderation,
  AutoMod, blocked terms, shield mode, warnings, moderated channels, pinned chat…). Old docs saying "user
  token only" are outdated for these.
- Conduits GA 2024-01-25; 2026-06-18 Update Conduit Shards max **100 shards per call** stated.
- 2025-05-09 Get EventSub Subscriptions `subscription_id` filter; 2026-04-17 `conduit_id` filter, and **409 Conflict
  now returns the existing subscription's id** on Create.
- 2025-03-18: disabled WebSocket subscriptions stay visible in Get EventSub Subscriptions ≥ 1 min (webhooks ≥ 10 days).
- 2026-06-26 `stream.offline` payload gained `id`.
- 2026-03-25 changelog RSS feed exists — subscribe if you maintain an integration.

**Extensions**: 2024-07-09 no Apple dev account / iOS allowlist needed for mobile extensions; 2025-10-06
monetization strategies guide; 2026-07-31 CSP updates (`connect-src` adds `blob:`, img-src Twitch CDN);
2026-06-08 unused `onPositionChanged` removed from SDK docs. → twitch-extensions skill.

## 3. Top platform-wide gotchas (cause most bugs)
1. **Wrong token type for the EventSub transport**: WebSocket = user token; webhook/conduit = app token.
2. **User IDs, not logins**, everywhere in conditions and Helix params; logins can change. Resolve once via Get Users.
3. **Scopes are per (client ID, user)**: the *broadcaster* must authorize scopes for broadcaster data; a bot's
   token cannot read the broadcaster's subs/redemptions. `channel.follow` v2 needs a moderator id.
4. **Affiliate/partner-only features** (channel points, polls, predictions, ads, subs): 403 on test accounts.
5. **Channel point rewards are owned by the client ID that created them** — you can only fulfill/refund
   redemptions of rewards your app created (create them via the API, not the dashboard).
6. **Webhook HMAC over the raw body** (`message_id + timestamp + body`), reply to the verification
   challenge as `text/plain`, answer within a few seconds, dedupe by `message_id`, reject >10-min-old.
7. **WebSocket**: subscribe within 10 s of `session_welcome`; follow `session_reconnect` URLs; handle keepalive
   timeout; subscriptions don't survive a new session (except via reconnect URL) and missed events aren't replayed.
8. **Validate tokens hourly**; refresh reactively on 401; persist rotated refresh tokens; ≤ 50 live access
   tokens per refresh token.
9. **Send Chat Message returns 200 even when dropped** — check `is_sent` / `drop_reason`. Messages ≤ 500 chars.
10. **Don't react to your own bot's messages** (infinite loops) — compare `chatter_user_id` with the bot id.
11. **Shared chat**: messages from other channels in a shared session arrive with `source_broadcaster_user_id`;
    decide whether your bot answers them; app-token sends default to source-only.
12. **Rate limits**: Helix token bucket per client ID (and per user for user tokens); chat 20/30 s (100 as mod/VIP/broadcaster).
13. **CORS**: Helix is meant to be called from servers. Never put the client secret in a browser/overlay;
    front-ends get data from your backend.
14. **Beta features can change or be removed** without notice; beta subs are deleted 30 days after GA.
15. **Twitch CLI ≠ production**: trigger set is incomplete (no chat, bits.use, v2 hype train), mock API lacks
    chat endpoints/scopes — see `twitch-cli.md` §10.
