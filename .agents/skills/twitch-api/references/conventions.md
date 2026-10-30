# Helix conventions: auth, tokens, pagination, rate limits, errors

Source of truth: `references/official/api_guide.md` (concepts), `references/official/api_reference.md`
(per-endpoint), and the twitch-dev skill (OAuth flows, scopes). Everything here is from those docs unless
marked *(observed)*, which means verified by a live request on 2026-10-26.

## Contents
1. Request basics
2. Which token? (app vs user vs app-with-prior-authorization)
3. Identity rules: broadcaster_id / moderator_id / sender_id must match the token
4. Pagination
5. Multiple values and batching
6. Rate limits (global bucket + per-endpoint limits)
7. Errors and status codes
8. Retries and backoff
9. Timestamps, IDs, enums, forward compatibility
10. Browser / CORS usage
11. Caching advice

## 1. Request basics

```
GET https://api.twitch.tv/helix/users?login=twitchdev
Authorization: Bearer <access token>
Client-Id: <the client id that the token was issued to>
Content-Type: application/json            (only on requests with a JSON body)
```

- Both headers are required on every call (only exception: Get Channel iCalendar, which needs neither).
  The Client-Id **must be the same app** that minted the token, or you get 401.
- Responses are JSON objects with a `data` **array** — even for "get one" endpoints (`data[0]`), plus
  `pagination` and sometimes `total` / `points` / `date_range` / `template` at the top level.
- Write endpoints use a mix of query params and a JSON body — check each endpoint (e.g. Create Clip and
  Start a raid take query params only; Create Poll takes everything in the body; Create Custom Rewards takes
  `broadcaster_id` in the query and the rest in the body). `node scripts/endpoint.ts "<name>" --brief` shows it.
- Many writes return `204 No Content` with an empty body (Modify Channel Information, Send a Shoutout,
  Send Chat Announcement, Cancel a raid, Delete Custom Reward...). Don't call `res.json()` on a 204.
- Create Clip returns `202 Accepted` (async; see recipes.md).

## 2. Which token?

| Token | How you get it | Represents | Use for |
|---|---|---|---|
| App access token | client-credentials grant (`client_id` + `client_secret`) on your server | your app, no user | public data (users, streams, games, clips, videos, search, emotes, badges), EventSub webhook/conduit subscriptions, conduits, entitlements |
| User access token | authorization-code (server) or implicit (browser-only) flow, with scopes | one Twitch user | anything that reads private data or acts as a broadcaster / moderator / chatter |
| App token "with prior authorization" (†) | an app token, after the user has once authorized your client ID with the scope | your app acting for a user who granted it | chat bots and back-ends that act for many channels without storing per-user tokens |
| Extension JWT | signed by your EBS with the extension secret | the extension | Extension endpoints (see the twitch-extensions skill) |

Facts to remember:

- **No scope ⇒ app or user token both work** for most public GET endpoints (Get Users, Get Streams, Get
  Games, Search, Get Clips, Get Videos, Get Channel Information, Get Chat Settings, emotes/badges, teams...).
- **The 2026 app-token expansion (†)**: since 2026-02-27 (open beta; GA 2026-05-29) about 27 endpoints
  accept "an app access token where the application, through a prior authorization, has the X scope for the
  user represented by `broadcaster_id`/`moderator_id`/`user_id`" — e.g. Start Commercial, Get Ad Schedule,
  Get Chatters, Update Chat Settings, Send Chat Announcement, Send a Shoutout, Send Chat Message, the Pinned
  Chat endpoints, Check AutoMod Status, Manage Held AutoMod Messages, AutoMod settings, Ban/Unban, Blocked
  Terms, Delete Chat Messages, Get Moderated Channels, Shield Mode, Warn Chat User. Chat-sending ones also
  need `user:bot` (bot user) + `channel:bot` (channel). `endpoints.md` marks all of them `user or app†`.
  The user must have completed OAuth with your client ID at least once; you just don't need to keep their token.
- **User-token-only** (no app path): polls, predictions, channel points, raids, clips (Create Clip),
  followers, subscriptions, schedule writes, Modify Channel Information, VIP/moderator add/remove, whispers,
  Get Stream Key, markers, goals, hype train, charity.
- **EventSub subscription management** (Create/Delete/Get EventSub Subscription): app token for
  webhook/conduit transports, user token for WebSocket transport. See the twitch-eventsub skill.
- **Get Channel Followers** with a user token lacking `moderator:read:followers` (or a non-mod user) still
  returns 200 but only `total`, not the list.
- **Get Users** with no `id`/`login` and a user token returns the token's own user — the easiest way to learn
  "who am I". Or call `GET https://id.twitch.tv/oauth2/validate` (returns `user_id`, `login`, `scopes`,
  `expires_in`); Twitch requires validating user tokens on startup and hourly.
- `email` in Get Users only appears with `user:read:email` and only for the token's own user.
- Refresh user tokens with `grant_type=refresh_token` on `https://id.twitch.tv/oauth2/token`; persist the
  refresh token returned. App tokens have no refresh token: request a new one when expired or on 401.
  Details: twitch-dev skill.

## 3. Identity rules (most common 401s)

Most write endpoints say "This ID must match the user ID in the user access token":

- `broadcaster_id` must be the token user for: polls, predictions, channel points, Modify Channel
  Information, Create Custom Rewards, Start a raid (`from_broadcaster_id`), Add/Remove VIP & moderator,
  schedule writes, Get Broadcaster Subscriptions, Get Creator Goals, Get Hype Train Status, Start Commercial.
  → A moderator's token **cannot** create a poll for the broadcaster. You need the broadcaster's own token.
- `moderator_id` must be the token user for moderator-style endpoints (bans, chat settings, announcements,
  shoutouts, AutoMod, blocked terms, Get Chatters, shield mode, warnings, unban requests). The broadcaster
  may pass their own ID as `moderator_id`.
- `sender_id` (Send Chat Message) / `user_id` (Create Stream Marker, Manage Held AutoMod Messages, Get User
  Emotes) likewise.
- Mismatch → **401 Unauthorized** (not 403), e.g. `"broadcaster_id does not match token"` *(observed on the
  CLI mock; docs list "The ID in broadcaster_id must match the user ID in the access token" under 401)*.
- **Channel points rewards are owned by the client ID that created them.** Update/Delete Custom Reward, Get
  Custom Reward Redemption and Update Redemption Status return **403** if the Client-Id differs. Rewards
  created in the Twitch dashboard can't be managed by your app — create your own via the API. Use
  `only_manageable_rewards=true` to list what you can manage.
- **Affiliate/Partner only**: channel points custom rewards (403 "not a partner or affiliate"), polls and
  predictions (per the polls/predictions guides), Start Commercial (and must be live), non-recurring schedule
  segments. Subscriptions/Bits data is naturally empty for non-affiliates. Test with an affiliate account or
  the CLI mock (its generated partner user has everything).

## 4. Pagination

- Cursor based. Request `first` (page size), then pass `pagination.cursor` back as `after` (forward) or
  `before` (backward, only where the endpoint lists a `before` param). `after` and `before` are mutually exclusive.
- End of list ⇒ `"pagination": {}` (no cursor). Lists are live views: a page can be empty near the end and
  items can repeat across pages — dedupe by ID if it matters.
- Page-size limits differ per endpoint (`endpoints.md` Paging column): mostly `first≤100` (default 20);
  exceptions: Get Custom Reward Redemption ≤50, Get Polls ≤20, Get Predictions ≤25, Get Channel Stream
  Schedule ≤25, Get Chatters ≤1000 (default 100), Get Drops Entitlements ≤1000. Asking for more than the max
  is a 400.
- Known quirks: Get EventSub Subscriptions has no `first`; Get Extension Live Channels returns `pagination`
  as a **string** (empty or cursor) instead of an object. Some endpoints document `first` as a String —
  send a number-looking string either way.
- Get Videos: `first`/`after`/`before` only valid with `game_id` or `user_id`, not with `id`.
- Get Broadcaster Subscriptions: don't send `after`/`before` together with `user_id`.
- Template: `helix.paginate<T>(path, query, { pageSize, limit })` (async iterator) and `helix.getAll()`.

## 5. Multiple values and batching

- Repeat the key: `?id=1&id=2&login=foo` — **never** comma-separated (`id=1,2` is treated as one bogus value).
- Typical maxima per request: Get Users 100 `id` + 100 `login`; Get Streams 100 `user_id`/`user_login`/`game_id`;
  Get Channel Information 100 `broadcaster_id`; Get Games 100 `id`/`name`/`igdb_id`; Get Clips 100 `id`;
  Get Broadcaster Subscriptions 100 `user_id`; Get Custom Reward Redemption / Update Redemption Status 50 `id`.
- Batch lookups: resolve 500 logins as 5 calls of 100, not 500 calls. Invalid/unknown IDs are silently
  dropped, so the result may be shorter than the input — map by `id`/`login`, don't rely on order (except
  Get Clips by `id`, which preserves input order).

## 6. Rate limits

**Global token bucket** (api_guide):
- Each client ID gets a bucket of points; most requests cost 1 point; the bucket refills within a minute.
- Separate buckets: one for app-token requests (per client ID), and user-token requests are limited
  **per client ID per user** per minute. The documented example shows `Ratelimit-Limit: 800`.
- Every response carries `Ratelimit-Limit` (bucket size), `Ratelimit-Remaining` (points left) and
  `Ratelimit-Reset` (Unix epoch **seconds** when the bucket is full again).
- Out of points ⇒ `429 Too Many Requests`; wait until `Ratelimit-Reset`.
- Some endpoints return 429 for reasons unrelated to the bucket (cooldowns) — read the message; waiting for
  the bucket won't help. The template retries a 429 only when `Ratelimit-Remaining` is 0.

**Endpoint-specific limits** (in addition to the bucket; generated into the Notes column of endpoints.md):

| Endpoint | Limit |
|---|---|
| Send Chat Announcement | one announcement every 2 seconds |
| Send a Shoutout | 1 per 2 minutes; same target once per 60 minutes (429 otherwise); broadcaster must be live |
| Start a raid / Cancel a raid | 10 requests per 10-minute window |
| Check AutoMod Status | per channel by account type: Normal 5/min·50/h, Affiliate 10/min·100/h, Partner 30/min·300/h |
| Add/Remove Channel Moderator, Add/Remove Channel VIP | 10 per 10-second window |
| Send Whisper | 40 unique recipients/day; 3 whispers/s; 100/min |
| Get Clips Download | 100 requests per minute |
| Get/Set Extension Configuration Segment | 20 per minute |
| Send Extension PubSub Message | 100 per minute per extension client ID + broadcaster |
| Send Extension Chat Message | 12 per minute per channel |
| Start Commercial | cooldown: wait `retry_after` seconds (Get Ad Schedule: a new ad can't run until 8 min after the previous) |
| Modify Channel Information | 409 "User set the Branded Content flag too frequently" |
| Pinned chat (Pin/Update/Unpin) | 429 "rate limit for pinning messages has been exceeded" (no number documented) |

Not documented by Twitch (so don't invent numbers): Create Clip, Create Poll/Prediction, Modify Channel
Information (title/category), Create Custom Rewards. Chat message send rates follow chat limits — see the
twitch-chat skill. Create Custom Rewards has a per-channel maximum number of rewards (400 "exceeds the
maximum number of rewards allowed per channel"; the count isn't stated in the reference).

## 7. Errors and status codes

Error body (all endpoints):

```json
{ "error": "Unauthorized", "status": 401, "message": "Invalid OAuth token" }
```

Don't branch on `message` strings (Twitch says they may change); branch on status + endpoint semantics.

| Code | Typical meaning on Helix |
|---|---|
| 200 / 202 / 204 | OK / accepted async (Create Clip) / OK, empty body |
| 400 | missing or invalid param, value out of range, AutoMod rejected text (poll/prediction/reward titles), mutually exclusive params, broadcaster not live (Start Commercial), `for_source_only` with a user token |
| 401 | missing/invalid/expired token; missing scope; Client-Id ≠ token's client; ID param ≠ token user |
| 403 | token user lacks a role/privilege: not a moderator/editor, not partner/affiliate, reward created by another client ID, clips restricted, user banned |
| 404 | resource or user not found; for some endpoints "broadcaster must be live" (Create Clip, Create Stream Marker — which also 404s if VODs are disabled) |
| 409 | conflict: EventSub subscription already exists (body includes the existing `id` since 2026-04-17), already raiding, ban state being changed concurrently (retry), no VIP slots, message already pinned, Branded Content flag toggled too often |
| 410 | Create EventSub Subscription: that subscription type+version was removed |
| 422 | Send Chat Message / Send Extension PubSub Message: message too large; Add Channel Moderator: user is a VIP (remove VIP first); Add Channel VIP: user is a moderator; Remove Channel VIP: user isn't a VIP |
| 425 | Too Early — e.g. Add Channel VIP before the broadcaster completed "Build a Community" |
| 429 | bucket empty or endpoint cooldown |
| 500 | Twitch-side error; retry later |
| 503 | Service Unavailable — the docs say retry once |

## 8. Retries and backoff

- **401**: refresh (user token via refresh_token; app token via client credentials) then retry **once**.
  If it fails again, the user revoked access or the scope is missing — re-run OAuth.
- **429 with `Ratelimit-Remaining: 0`**: sleep until `Ratelimit-Reset` (+ small jitter) and retry.
  429 with points remaining = endpoint cooldown: surface it to the user / schedule later.
- **503**: retry once after ~1 s. **500/502/504**: retry with exponential backoff (1 s, 2 s, 4 s) for
  idempotent GETs; be careful re-sending POSTs (you might create two polls/rewards).
- **409** on Ban/Unban/Warn: someone else is changing state — retry after a short delay.
- Proactive: when `Ratelimit-Remaining` hits 0, pause the queue until reset instead of firing and failing.
- Parallelism: modest concurrency (≤ 5–10 in flight) is fine; batch IDs first.

## 9. Timestamps, IDs, enums, compatibility

- All Helix timestamps are RFC3339 (`2026-10-26T20:39:45Z`); EventSub uses nanosecond precision. Parse with
  `new Date(s)`; send `new Date().toISOString()`.
- All IDs are **opaque strings** (user IDs look numeric but never parse them to numbers; reward/poll/clip
  IDs are UUID-like). Logins are lowercase; display names may differ in case or be localized (CJK).
- Enum values are case-sensitive unless stated (`UNFULFILLED`, `TERMINATED`, `blue`, `live`...).
- Ignore unknown response fields; Twitch adds fields and enum values without notice. Don't depend on
  returned URL formats (except documented `{width}x{height}` templates in thumbnails/box art).
- Deprecated fields still present: `view_count` (Get Users), `tag_ids` and `is_mature` (Get Streams),
  `is_mature` (Start a raid), `bits_*` in polls (always 0/false). "Get Hype Train Events" was removed
  2026-02-05 → use Get Hype Train Status + EventSub hype train v2.

## 10. Browser / CORS usage

- Helix sends `Access-Control-Allow-Origin: *` and allows `Authorization, Client-Id, Content-Type` on
  preflight *(observed 2026-10-26)*, so a browser page *can* call Helix directly.
- **Never ship a client secret or app access token to the browser** (an app token lets anyone burn your
  rate limit and act as your app). Overlays and static pages should either (a) call your own backend, which
  holds tokens and caches results, or (b) use the **implicit grant** to get a user token in the browser
  (no secret, no refresh token; token arrives in the URL fragment).
- OBS browser-source overlays: no login UI available → use a backend + WebSocket/SSE push to the overlay,
  and EventSub for live events (see the twitch-eventsub skill). Don't poll Helix from every overlay instance.
- Extensions use the Extension Helper and JWTs instead (twitch-extensions skill).

## 11. Caching advice

- Users/channels (profile image, display name), games/categories, global emotes/badges, cheermotes, teams:
  cache for hours; they rarely change. Key users by ID, keep a login→ID map.
- Stream status/viewer count: viewer counts move slowly; polling Get Streams every 30–60 s (batched, up to
  100 `user_id` per call) is plenty. Prefer EventSub `stream.online`/`stream.offline` for state changes.
- Followers/subs counts: poll sparingly or use EventSub `channel.follow` (v2) / `channel.subscribe`.
- Don't cache tokens in code; store refresh tokens encrypted per user; keep app tokens in memory and renew.
- Helix doesn't document ETag/conditional requests — don't rely on them.
