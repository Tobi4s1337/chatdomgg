# Rendering chat: overlays (OBS browser sources) and chat UIs

Everything needed to turn `channel.chat.message` events into pixels safely. Working implementation:
`assets/templates/overlay/` (render-model.ts = pure logic, chat-overlay.ts = DOM, overlay-relay.ts = backend).

## Contents
1. [Architecture](#1-architecture)
2. [Emotes: CDN template](#2-emotes-cdn-template)
3. [Emote endpoints](#3-emote-endpoints)
4. [Badges](#4-badges)
5. [Cheermotes](#5-cheermotes)
6. [Names, colors, mentions, replies, GIFs](#6-names-colors-mentions-replies-gifs)
7. [Deletion, clears, bans](#7-deletion-clears-bans)
8. [Security (XSS) checklist](#8-security-xss-checklist)
9. [OBS browser-source specifics](#9-obs-browser-source-specifics)
10. [Third-party emotes (7TV / BTTV / FFZ)](#10-third-party-emotes)
11. [Verified behaviour](#11-verified-behaviour)

---

## 1. Architecture

```
Twitch EventSub ──(WS/webhook, tokens)──> your backend ──(ws://localhost/ws, JSON, no tokens)──> overlay page in OBS
                                          │ caches badges + cheermotes (Helix, any app/user token)
```

- **Never put access tokens or client secrets in the overlay URL/JS.** Browser-source URLs get shown on
  stream, pasted in Discord, and are readable by anyone with the scene collection.
- The backend subscribes to `channel.chat.message`, `.message_delete`, `.clear_user_messages`, `.clear`
  (+ `.notification` for alerts) and forwards the raw `event` with its `subscription_type`.
- Protocol used by the templates (`OverlayServerMessage` in chat-types.ts):
  `{kind:"assets", assets:{badges:{"set_id/id":{url1x,url2x,url4x,title}}, cheermotes:[...]}}` once per
  connection, then `{kind:"event", subscriptionType, event}` per notification, `{kind:"ping"}` every 25 s.
- Alternative without a backend: an overlay that itself connects to EventSub WebSocket needs a user token in
  the browser — acceptable only for a local, private tool. Don't ship it.

## 2. Emotes: CDN template

Get Global Emotes / Get Channel Emotes / Get Emote Sets / Get User Emotes return a top-level `template`:

```
https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}
```

| Placeholder | Values | Notes |
|---|---|---|
| `{{id}}` | emote id (from the `emote` fragment) | ids can be non-numeric strings (e.g. `emotesv2_…`) — URL-encode, don't parse as int |
| `{{format}}` | `static`, `animated` | use `animated` only if the fragment's `format` array contains it |
| `{{theme_mode}}` | `light`, `dark` | variant tuned for light or dark backgrounds — match your overlay background |
| `{{scale}}` | `1.0` (28px), `2.0` (56px), `3.0` (112px) | request 2.0/3.0 and size with CSS for crisp HiDPI |

Docs example: twitchRaid (id 62836) → `https://static-cdn.jtvnw.net/emoticons/v2/62836/static/light/3.0`
(asserted in selftest). The `emote` fragment already contains `id` and `format`, so you **don't need any API
call to render emotes** — the template is constant. Prefer the template over the `images.url_1x/2x/4x` fields
(those are always static + light).

```ts
const url = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(e.id)}/${e.format.includes('animated') ? 'animated' : 'static'}/dark/2.0`;
```

## 3. Emote endpoints

| Endpoint | Auth | Use |
|---|---|---|
| `GET /helix/chat/emotes/global` | app or user token | global Twitch emotes (emote picker, autocomplete) |
| `GET /helix/chat/emotes?broadcaster_id=` | app or user token | channel's sub/bits-tier/follower emotes (`emote_type`, `tier`) |
| `GET /helix/chat/emotes/set?emote_set_id=…` (≤25 ids) | app or user token | resolve emote sets |
| `GET /helix/chat/emotes/user?user_id=[&broadcaster_id=][&after=]` | user token, `user:read:emotes`, `user_id` = token user | everything the user can type (paginated) — for chat clients' emote pickers |

Sending emotes: just type the case-sensitive name (`HeyGuys`) in the message; no colons.

## 4. Badges

- `GET /helix/chat/badges/global` and `GET /helix/chat/badges?broadcaster_id=` (app or user token).
- Response: `data[] = {set_id, versions[{id, image_url_1x (18px), image_url_2x (36px), image_url_4x (72px),
  title, description, click_action, click_url}]}`.
- Build one map keyed `"${set_id}/${id}"`: load global first, then channel (channel overrides — custom
  subscriber and bits badges live there). Look up each `badges[]` entry of the message; skip unknown keys.
- Badge `id` is a string ("12", "1000", or arbitrary like "Alliance") — never do arithmetic on it.
- Refresh the cache occasionally (hours) or when the broadcaster changes badges; cache per channel.
- Shared chat: render `badges` (this channel). Optionally show `source_badges` + the origin channel name.

## 5. Cheermotes

`GET /helix/bits/cheermotes[?broadcaster_id=]` (app or user token) → `data[] = {prefix, tiers[], type, order,
is_charitable, last_updated}`; each tier: `{min_bits, id ("1","100","500","1000","5000","10000","100000"),
color, images[theme dark|light][format animated|static][size "1"|"1.5"|"2"|"3"|"4"], can_cheer,
show_in_bits_card}`.

Cheermote fragment: `{prefix (lower-case), bits, tier}`. Match prefix case-insensitively; pick the tier with
the highest `min_bits <= bits` (or `id == String(tier)`); draw the image and the bit count in `color`.
Pass `broadcaster_id` to include `channel_custom` cheermotes. `type: display_only` is internal — ignore.

## 6. Names, colors, mentions, replies, GIFs

- **Name**: show `chatter_user_name` (display name; may be CJK etc.). If it differs from the login only by case
  you're fine; if it's localized, some UIs show `name (login)`.
- **Color**: `color` is `#RRGGBB` or `""`. Validate with `/^#[0-9a-f]{6}$/i` before it reaches CSS. The fallback
  Twitch uses for unset colors is not documented — the template picks deterministically (hash of user id)
  from the 15 named chat colors of Update User Chat Color (blue, blue_violet, cadet_blue, chocolate, coral,
  dodger_blue, firebrick, golden_rod, green, hot_pink, orange_red, red, sea_green, spring_green,
  yellow_green). Consider lightening dark colors on dark backgrounds for readability. Bulk lookup:
  `GET /helix/chat/color?user_id=…` (≤100).
- **Mentions**: style `mention` fragments; highlight when `mention.user_id` is the broadcaster/viewer.
  Plain-text `@name` inside a `text` fragment is not a mention (user may not exist).
- **Replies**: `reply.parent_user_*`/`parent_message_body` give context ("↪ replying to @x: …"). The text
  starts with an auto-inserted mention of the parent — the template drops that leading mention fragment when
  it matches `reply.parent_user_id`.
- **Highlights**: `message_type: channel_points_highlighted` (render highlighted), `user_intro` (first-time
  chatter intro), `power_ups_message_effect` / `power_ups_gigantified_emote` (render the emote big).
- **GIF fragments** (2026-07): `<img src={gif.url}>` exactly as provided ("must not be modified"); use
  `fragment.text` (the GIF title) as alt; cap size with CSS. Also arrives over IRC as the `gifs` tag.
- **/me**: EventSub has no `/me` flag documented on channel.chat.message; IRC shows it as `\u0001ACTION …\u0001`.

## 7. Deletion, clears, bans

| Event | Overlay action |
|---|---|
| `channel.chat.message_delete` | remove element with `data-msg-id == message_id` |
| `channel.chat.clear_user_messages` | remove all elements with `data-user-id == target_user_id` (ban/timeout) |
| `channel.chat.clear` | remove everything |

Store `message_id` and `chatter_user_id` on each rendered row (data attributes). A **non-moderator chat delay**
(`non_moderator_chat_delay`, 2/4/6 s, visible via Get Chat Settings with a moderator token) exists for exactly
this reason; an overlay can mimic it by buffering messages N seconds before display so mods can delete first.

## 8. Security (XSS) checklist

Chat text is attacker-controlled and an overlay runs inside OBS (a Chromium with access to your scene). Rules:

1. Build DOM with `createElement` + `textContent` / `createTextNode`. **Never** `innerHTML`, `insertAdjacentHTML`,
   `outerHTML`, `document.write`, or framework escape hatches (`v-html`, `dangerouslySetInnerHTML`) with chat data.
   (In Vue/Nuxt `{{ }}` interpolation is safe; `v-html` is not.)
2. URLs into `src` only from fragment metadata you construct (emote template) or `https:` URLs from Twitch
   (badges, cheermotes, GIF url). Reject other protocols (`javascript:`, `data:`).
3. Colors: regex-validate before `style.color`. Never interpolate chat strings into CSS or `style` attributes.
4. Display names may contain unexpected Unicode — still text; use `overflow-wrap:anywhere` for long tokens.
5. Add a CSP (`script-src 'self'`) to the overlay page (the template does).
6. Don't `eval`/`new Function` anything from the socket; validate `kind`/`subscriptionType` before use.
7. Rate-limit DOM growth: cap message count (`max`), drop oldest.

## 9. OBS browser-source specifics

- Body/background **transparent** (OBS composites it); text needs a shadow or a translucent card to stay
  readable on any game footage.
- Size the source in OBS (e.g. 450×800) and lay out with `position:fixed; bottom:0; display:flex;
  flex-direction:column; justify-content:flex-end` so new messages push up.
- Entry animation with CSS keyframes (transform/opacity only — cheap); fade-out after N seconds (`fade=30`
  query param in the template) then remove the node; respect `prefers-reduced-motion`.
- OBS keeps the page alive between scenes only if "Shutdown source when not visible" is off; reconnect logic
  (exponential backoff) must exist either way. "Refresh browser when scene becomes active" reloads the page.
- Pass options via query string (`?theme=dark&scale=2.0&hideCommands=1&hide=<botId>&highlight=<login>&max=30`).
- Hide your own bot's lines and `!commands` if they're noise; keep them in the backend logs.
- Fonts: load locally or from Google Fonts; OBS caches. Large emote scales (3.0) look best at 1.75–2em height.

## 10. Third-party emotes

7TV, BetterTTV (BTTV) and FrankerFaceZ (FFZ) emotes are **not** Twitch emotes: they arrive as plain `text`
fragments. Supporting them means fetching each provider's public emote lists for the channel (by Twitch user
id) and replacing matching words in text fragments yourself. They are optional, third-party, unversioned by
Twitch and can change without notice — keep it behind a flag, cache aggressively, and fall back to text.
Many viewers expect them in overlays for popular channels, so it's a nice-to-have, not a requirement.

## 11. Verified behaviour

- `node scripts/selftest.ts` asserts the emote URL template against the docs example and checks fragment →
  node mapping using the official "RAID TombRaid RAID twitchRaid RAID" payload, color fallback and
  `javascript:` GIF URL rejection.
- `node overlay/overlay-relay.ts --demo` (after `npx tsc -p overlay/tsconfig.json`) was loaded in headless
  Chrome: messages rendered with the VIP badge, the HeyGuys emote from the real CDN, mention highlighting,
  and `<b>not</b>` shown literally as text; path traversal requests to the static server return 404.
