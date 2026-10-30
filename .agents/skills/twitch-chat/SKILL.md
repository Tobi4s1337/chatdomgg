---
name: twitch-chat
description: Build Twitch chat features in TypeScript/Node - chatbots with !commands, cooldowns and badge-based permissions; reading chat via EventSub (channel.chat.message, channel.chat.notification for subs, resubs, gift subs, raids, announcements, watch streaks; message deletes, clears, bans); sending with the Helix Send Chat Message API (replies, rate limits, is_sent and drop_reason, Chat Bot badge via app token with user:bot and channel:bot); chat overlays for OBS browser sources (emotes, badges, cheermotes, GIF fragments, name colors, XSS-safe rendering); moderation (ban, timeout, delete, warn, AutoMod, shield mode, pinned messages, chat settings), whispers, shared chat, and legacy Twitch IRC (tag parsing, IRC to EventSub migration). Use it whenever the user mentions a twitch bot, twitch chat, a chat overlay, !commands, emotes, badges, tmi.js, IRC, PRIVMSG, announcements, shoutouts, mods or timeouts, an AI or LLM chatbot for Twitch, or reading or sending Twitch chat messages, even without the word EventSub.
---

# Twitch Chat & Chatbots (EventSub + Helix, IRC legacy)

Use this skill for anything that reads, renders, sends or moderates Twitch chat. Sibling skills:
**twitch-dev** (hub: app registration, OAuth flows, Twurple, architecture), **twitch-eventsub** (transports:
WebSocket/webhook/conduits, non-chat events like follows/subs/redemptions), **twitch-api** (all Helix
endpoints, generic rate limits, pagination), **twitch-extensions** (panels/overlays inside the Twitch player).

Facts here come from the official docs snapshot of 2026-10-26 (changelog to 2026-10-01) in
`references/official/`. If something looks off, grep there first.

## The mental model

```
                    ┌──────────────── read ────────────────┐
Twitch chat room ── EventSub channel.chat.message ──► your bot / backend ──► overlay (WS, no tokens)
     ▲              condition {broadcaster_user_id, user_id = account you read AS}
     │
     └──── write ── POST /helix/chat/messages {broadcaster_id, sender_id, message, reply_parent_message_id?}
```

- **Reading** = an EventSub subscription per channel and type (`channel.chat.message`, `.notification`,
  `.message_delete`, `.clear_user_messages`, `.clear`, `channel.chat_settings.update`…). The `user_id` in the
  condition is the chatter identity you "join" as (normally your bot account). Subscribing *is* joining.
- **Writing** = Helix Send Chat Message. Announcements, shoutouts, pins, bans, deletes, settings are separate
  Helix endpoints (there are no slash-commands in the API).
- **Identity** = which Twitch account sends (bot vs broadcaster) and which token type you use (user vs app).
  This decides scopes, rate limits, the Chat Bot badge, and "Chat Bots" listing in Users in Chat.
- **IRC** (`wss://irc-ws.chat.twitch.tv:443`) still works and is fine for quick read-only tools, but Twitch
  recommends EventSub + API; IRC's non-TLS WebSocket was shut down 2025-08-15.

## Tokens & scopes (get this right first)

| Setup | Token used | Scopes / authorizations |
|---|---|---|
| Bot reads chat over **EventSub WebSocket** | **user** token of the bot (WebSocket subs require user tokens) | `user:read:chat` |
| Bot sends as itself, plain | user token of the bot | `user:write:chat` |
| Bot sends **with Chat Bot badge** | **app** token (client credentials) | bot authorized `user:write:chat` + `user:bot`; broadcaster authorized `channel:bot` **or** bot is a mod there |
| Cloud bot reads many channels (webhook/conduit) | app token | bot authorized `user:read:chat` + `user:bot`; each broadcaster `channel:bot` (or bot is mod) |
| Installed bot / chat client using broadcaster's account | broadcaster's user token | `user:read:chat` (+ `user:write:chat`) |
| IRC | user token as `PASS oauth:<token>` | `chat:read`, `chat:edit` |
| Moderation actions | user token of a **moderator** (or app token + that mod's prior authorization; some also need `user:bot`) | `moderator:manage:*` (see references/sending-and-moderation.md §9) |
| Whispers | user token | `user:manage:whispers` (send), `user:read:whispers` (receive) |

**Chat Bot badge** — all four must hold (docs "Chatbot Badge and Chat Identity"):
1. message sent with **Send Chat Message** (not IRC), 2. using an **app access token**, 3. bot has `channel:bot`
from that broadcaster **or** is a moderator there, 4. the bot account is **not** the broadcaster.
The badge replaces the bot's global vanity badge. **Listed under "Chat Bots" in Users in Chat** requires:
reading via `channel.chat.message` with an **app token** and `channel:bot` from the broadcaster (mod status
isn't enough), bot ≠ broadcaster — so EventSub-WebSocket or IRC readers are never listed there. Verified-bot
status does *not* grant the badge (and verification reviews are paused per the docs).

**Bot account vs broadcaster account**: use a dedicated bot account for anything public (own name, own rate
limits, can be modded, can get the badge, give it a verified phone number). Running as the broadcaster is fine
for personal/installed tools but messages look like the streamer typed them and never get the badge.

## Limits that matter

| What | Limit |
|---|---|
| Message length | **500 characters** (Send Chat Message → 422 if longer; announcements truncate) |
| Chat send rate, per bot **account** across all channels | **20 msgs / 30 s**; **100 / 30 s** in channels where it's broadcaster/mod/VIP; verified bots 7500 / 30 s |
| Per channel when not broadcaster/mod/VIP | **1 msg / s** |
| Penalty | messages ignored for **1 hour** (except where broadcaster/mod/VIP) |
| Send Chat Message Helix bucket | separate from your normal Helix bucket (header may show a bigger number) |
| Concurrent joined channels per account | **100** (joins as broadcaster/mod, or via `channel:bot` + app token, don't count) |
| Join attempts | 20 / 10 s per user (2,000 verified); not applied to app-token `channel.chat.message` subs |
| EventSub WebSocket | 3 connections per user token, 300 enabled subs each, subscribe within **10 s** of welcome |
| Announcements / shoutouts | 1 per 2 s / 1 per 2 min (same target 1 per 60 min) |
| Whispers | 40 unique recipients/day, 3/s, 100/min; 500 chars to new recipients (10,000 otherwise); verified phone required |

## Gotchas that cause most bugs

1. **Your bot receives its own messages** over EventSub (IRC never echoed them). Always
   `if (ev.chatter_user_id === botId) return;` — otherwise replies containing `!cmd` loop forever. Ignore
   other bots too.
2. **HTTP 200 ≠ sent.** Check `data[0].is_sent`; on `false`, `drop_reason {code, message}` says why (docs show
   `automod_held`; the code list isn't documented — log it). Slow/followers/sub/emote-only/unique mode,
   duplicate message (same text within 30 s), AutoMod and phone-verification all drop messages silently
   otherwise. Make the bot a **mod** (or VIP) to dodge most of them and get the higher limits.
3. **Replies prefix the text**: a reply arrives as `"@parentlogin !cmd"`. Strip `@${reply.parent_user_login}`
   before parsing commands; don't add `@user` yourself when sending with `reply_parent_message_id`.
4. **Shared chat**: messages and notices from other channels in a session show up with
   `source_broadcaster_user_id` ≠ null; `badges` are this channel's, `source_badges` the origin's; notices
   use `shared_chat_<type>` objects (and `<type>` is null). Sending with an app token defaults to
   `for_source_only: true` (only your channel); user tokens always fan out and reject `for_source_only` (400).
5. **Deletes & clears must propagate**: handle `channel.chat.message_delete` (by `message_id`),
   `channel.chat.clear_user_messages` (ban/timeout → remove all of that user's lines) and `channel.chat.clear`
   in every overlay/UI — otherwise moderated content stays on stream.
6. **WebSocket subscriptions die with the socket**. On a normal close: new session + resubscribe. On
   `session_reconnect`: connect to `reconnect_url`, keep subscriptions, close the old socket only after the new
   `session_welcome`. Dedupe on `metadata.message_id`.
7. **403 "subscription missing proper authorization"** when subscribing = missing scope/`channel:bot`, the bot is
   banned/timed out there, or the 100-channel join limit. Later bans/timeouts **revoke** subscriptions
   (`status: chat_user_banned`) — handle `revocation`.
8. **`color` can be `""`** — pick a fallback; validate `#RRGGBB` before it touches CSS.
9. **Never `innerHTML` chat text** (or `v-html`). Build DOM with `textContent`; only https URLs into `src`.
10. **Emotes need no API call**: the fragment has `id` + `format`; URL template
    `https://static-cdn.jtvnw.net/emoticons/v2/{id}/{static|animated}/{light|dark}/{1.0|2.0|3.0}`.
    Badges and cheermotes do need Get Global/Channel Chat Badges and Get Cheermotes (cache them).
11. **Fragments evolve**: `gif` fragments arrived 2026-07 (`gif.url` must be used unmodified; the changelog
    says `gif_id`, the reference says `id`). Render unknown fragment types as `fragment.text`.
12. **Notification payload quirks**: `resub.sub_tier` (table) vs `resub.sub_plan` (example) — read both;
    `notice_type` gains values over time (`watch_streak`, `modiversary`, `gifted_drops_summary`, `unknown`).
13. **Restricted suspicious users' messages** never appear in `channel.chat.message`; only moderators see them
    via `channel.suspicious_user.message`.
14. **Chat settings on join**: EventSub only sends changes; call Get Chat Settings after subscribing.
15. **Tokens**: user tokens expire and refresh tokens rotate — persist the new refresh token. App tokens: just
    re-request on 401.
16. **Testing**: the Twitch CLI cannot trigger `channel.chat.*` events and its mock WebSocket rejects chat
    subscription types (400) — use the fixtures in `scripts/fixtures/` (verbatim doc examples).

## Quick start (single-channel bot, 10 minutes)

1. Register an app at dev.twitch.tv/console (redirect `http://localhost:3000` for the CLI). Details: twitch-dev.
2. Create/choose a bot account. Get its user token (log in as the **bot** in the browser):
   `twitch configure` then `twitch token -u -s "user:read:chat user:write:chat user:bot"`.
3. IDs: `twitch api get users -q login=<bot> -q login=<channel>` (or `GET /helix/users?login=`).
4. Copy `assets/templates/{chatbot.ts,chat-types.ts,package.json}` into your project and run:
   ```bash
   TWITCH_CLIENT_ID=... TWITCH_BOT_USER_TOKEN=... TWITCH_CHANNEL_USER_ID=<broadcaster id> node chatbot.ts
   ```
   (Node ≥ 22.18 runs `.ts` directly; otherwise `npx tsx chatbot.ts`.) Type `!ping` in chat → `pong` as a reply.
5. Badge: have the broadcaster authorize your app with `channel:bot` (or mod the bot), set
   `TWITCH_CLIENT_SECRET` + `TWITCH_SEND_WITH_APP_TOKEN=1`. Mod the bot and set `BOT_IS_PRIVILEGED=1` for
   100 msgs/30 s.
6. Overlay: `npx tsc -p overlay/tsconfig.json && node overlay/overlay-relay.ts --demo`, add
   `http://localhost:8131/?fade=30&hideCommands=1` as an OBS Browser Source; then wire the relay to the bot
   (`makeDispatcher(router, { onAny: relay.forward })`) and drop `--demo`.

Minimal read/send without the template (EventSub WebSocket, user token):

```ts
const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
ws.onmessage = async (e) => {
  const m = JSON.parse(String(e.data));
  if (m.metadata.message_type === 'session_welcome') {
    await helix('POST', '/eventsub/subscriptions', { type: 'channel.chat.message', version: '1',
      condition: { broadcaster_user_id: CHANNEL_ID, user_id: BOT_ID },
      transport: { method: 'websocket', session_id: m.payload.session.id } });          // expect 202
  } else if (m.metadata.subscription_type === 'channel.chat.message') {
    const ev = m.payload.event;
    if (ev.chatter_user_id === BOT_ID) return;                                           // gotcha #1
    if (ev.message.text.trim() === '!ping') {
      const r = await helix('POST', '/chat/messages', { broadcaster_id: CHANNEL_ID, sender_id: BOT_ID,
        message: 'pong', reply_parent_message_id: ev.message_id });
      if (!r.data[0].is_sent) console.warn(r.data[0].drop_reason);                       // gotcha #2
    }
  }
};
// helix(): fetch(`https://api.twitch.tv/helix${path}`, { method, headers: { Authorization: `Bearer ${USER_TOKEN}`,
//   'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
```

Twurple equivalent: `new EventSubWsListener({ apiClient }).onChannelChatMessage(channel, bot, e => …)` and
`apiClient.chat.sendChatMessage(channel, 'pong', { replyParentMessageId: e.messageId })`
(`sendChatMessageAsApp(bot, channel, text)` for the badge). Full mapping: references/commands-and-bots.md §12.

## Reference map

| File | Read / use when |
|---|---|
| `references/eventsub-chat.md` | Subscribing to any chat-related EventSub type: generated index (type, version, condition, verbatim authorization), payload fields of channel.chat.message / notification (all `notice_type`s) / delete / clear / settings / held messages / shared chat / suspicious users / AutoMod / whispers, fragment & badge model, testing notes |
| `references/rendering.md` | Building a chat overlay or chat UI: emote CDN template, emote/badge/cheermote endpoints, colors, mentions, replies, GIFs, deletions, XSS checklist, OBS browser-source tips, 7TV/BTTV/FFZ note |
| `references/sending-and-moderation.md` | Sending (body, `is_sent`/`drop_reason`, `for_source_only`, `pin`), exact rate limits, announcements, shoutouts, pinned messages (GA 2026-05-29), chat settings, ban/timeout/delete/warn, AutoMod, blocked terms, unban requests, suspicious users, Shield Mode, mods/VIPs/chatters, whispers, scope table |
| `references/commands-and-bots.md` | Designing a bot: shapes (WebSocket vs conduit, user vs app token), pipeline, command parsing, permissions from badges, cooldowns, send queue, token refresh, multi-channel, persistence, **LLM chatbot safety**, testing with fixtures, Twurple mapping |
| `references/irc.md` | Working with Twitch IRC: endpoints, auth, CAP, commands, tag parsing & unescaping, NOTICE ids, limits, full IRC → EventSub/API mapping |
| `references/official/*.md` | Verbatim official chat docs (chat overview & rate limits, authenticating, example bot, IRC reference, IRC migration, send/receive, whispers). Don't edit — regenerated by twitch-dev's refresh script |
| `assets/templates/chatbot.ts` | Copy for a working EventSub-WebSocket bot: command router (cooldowns, permissions), rate-limited send queue, app-token sending for the badge, reconnect handling, token refresh, JSON state. Exports pure pieces for tests |
| `assets/templates/chat-types.ts` | Types for chat events, fragments, badges, notifications, Helix chat responses, overlay protocol |
| `assets/templates/irc-client.ts` | Minimal IRC client over global WebSocket + exported parsers (`parseIrcLine`, `unescapeTagValue`, `parseBadges`, `parseEmotes`, `parseGifs`) |
| `assets/templates/overlay/chat-overlay.html` + `chat-overlay.ts` | OBS browser-source chat overlay (DOM-safe rendering, delete/clear handling, query-string options) |
| `assets/templates/overlay/render-model.ts` | Pure fragment → render-node logic (emote URLs, badge lookup, cheermote tiers, color fallback, URL checks) |
| `assets/templates/overlay/overlay-relay.ts` | Backend relay: serves the overlay, `/ws` fan-out, `fetchOverlayAssets()` for badges/cheermotes, `--demo` mode |
| `assets/templates/overlay/tsconfig.json`, `assets/templates/package.json`, `scripts/package.json` | Build config for the browser part; ESM (`"type": "module"`) package + deps (`ws` only for the relay) |
| `scripts/selftest.ts` | `node scripts/selftest.ts` — tests IRC parsing (doc lines), command parsing, permissions, limiter, bot dispatch with the official channel.chat.message example, render model |
| `scripts/fixtures/*.json` | Verbatim official example payloads (chat message, shared-chat message, resub notification, emote message) — feed them to your handlers |
| `scripts/gen-chat-eventsub-index.py` | Regenerates the index table in eventsub-chat.md from the docs (`python3 -I scripts/gen-chat-eventsub-index.py [html-dir]`) |

## Looking up details

```bash
cd references/official
grep -n "^## \|^### " chat.md                         # overview, rate limits, Chatbot Badge section
grep -n -A 25 "^## Chatbot Badge" chat.md              # exact badge / Users-in-Chat requirements
grep -n -A 30 "^### Twitch Chat Rate Limits" chat.md   # send limits table
grep -n -A 40 "^### PRIVMSG Tags" chat_irc.md          # any IRC tag
grep -n "^| msg_" chat_irc.md                          # NOTICE msg-id list
grep -n -B2 -A12 "^| IRC msg-id" chat_irc-migration.md # USERNOTICE -> notice_type table
```

EventSub payload tables and the Helix reference live in the sibling skills' snapshots
(twitch-eventsub: `eventsub_eventsub-subscription-types.md`; twitch-api: `api_reference.md`, e.g.
`grep -n "^## Send Chat Message" api_reference.md`). The latest changes: twitch-dev's `change-log.md`.
