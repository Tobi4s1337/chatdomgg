---
name: twitch-api
description: Twitch Helix REST API (api.twitch.tv/helix) for TypeScript/Node - all 149 endpoints indexed with method, path, token type, scopes and limits, plus a typed fetch client with token refresh, rate-limit handling and pagination. Use whenever code calls the Twitch API - get users/streams/viewer count, is a channel live, change stream title or category, channel points rewards and redemptions, polls, predictions, clips, raids, shoutouts, announcements, bot chat messages, ban/timeout, mods/VIPs, AutoMod, followers, subs, bits leaderboard, hype train, goals, schedule, VODs, search, teams, EventSub/conduit management - or when debugging Helix 400/401/403/409/429 errors, Client-Id/Bearer headers, app vs user tokens, missing scopes, broadcaster_id/moderator_id mismatches, pagination cursors, Ratelimit headers. Trigger on helix, twitch api, twitch bot, overlay data, !commands that call Twitch, channel points, twurple api.
---

# Twitch Helix API

Use this skill for anything that makes HTTP calls to `https://api.twitch.tv/helix/...`: reading Twitch data
(users, streams, games, clips, followers, subs) or acting on a channel (title/category, rewards, polls,
predictions, raids, shoutouts, announcements, moderation). It gives you the conventions, an exhaustive
endpoint index, a copy-in typed client and verified recipes.

Not here (use the sibling skill): OAuth flows/scopes/app registration/Twurple setup → **twitch-dev**;
receiving real-time events (follows, subs, redemptions, chat messages) → **twitch-eventsub**; chat bots,
IRC, emotes/badges rendering, chat rate limits → **twitch-chat**; Extension endpoints with JWTs →
**twitch-extensions**.

## Mental model

1. **One base URL, two headers.** Every call is `https://api.twitch.tv/helix/<resource>` with
   `Authorization: Bearer <token>` and `Client-Id: <client id that minted that token>`. JSON bodies need
   `Content-Type: application/json`. A Client-Id that doesn't match the token's app ⇒ 401.
2. **The token decides what you may do.**
   - *App access token* (client credentials, server-side secret): your app, no user. Good for public reads
     (users, streams, games, clips, videos, search, emotes) and EventSub webhook/conduit management.
   - *User access token* (OAuth with scopes): acts **as that user**. Required for anything private or
     channel-changing. The token user must usually *be* the `broadcaster_id` (or `moderator_id`).
   - *App token with prior user authorization* (2026 expansion, GA 2026-05-29): ~27 chat/moderation/ads
     endpoints accept an app token if the user once authorized your client ID with the scope (chat sends
     also need `user:bot` + `channel:bot`). Lets one backend act for many channels. Marked `user or app†`.
3. **Responses are `{ data: [...] }`.** Always an array, even for single objects (`data[0]`). Lists add
   `pagination: { cursor }`; some add `total`/`points`. Writes often return 204 with no body.
4. **IDs are opaque strings.** User IDs look numeric — never `Number()` them. Store IDs, not logins.
5. **Multiple values = repeated keys**: `?id=1&id=2` (never comma lists), usually ≤100 per call.
6. **Cursor pagination**: `first` (page size; max varies, usually 100) + `after=<pagination.cursor>`;
   empty `pagination` object = last page.
7. **Rate limit = token bucket per client ID** (app requests) and **per client ID + user** (user requests);
   headers `Ratelimit-Limit` / `Ratelimit-Remaining` / `Ratelimit-Reset` (epoch seconds). 429 when empty.
   Some endpoints add their own limits (shoutouts, raids, announcements, AutoMod checks, VIP/mod changes).
8. **Helix is request/response only.** For "something happened" (new follower, redemption, chat message,
   stream went live) subscribe to EventSub instead of polling.

## Critical gotchas (the bugs you will actually hit)

- **401 because the ID doesn't match the token.** Create Poll/Prediction, rewards, Modify Channel
  Information, Start a raid, schedule, subs, goals, hype train need the **broadcaster's own** token
  (a mod's or editor's token won't do). Moderator endpoints need `moderator_id` = token user. Mismatch is
  a 401, not a 403 — don't waste time on scopes before checking IDs.
- **Missing scope ⇒ 401** too. Check the Scopes column in `references/endpoints.md`; re-run OAuth with the
  scope added (existing tokens never gain scopes). `GET https://id.twitch.tv/oauth2/validate` shows a token's scopes.
- **Channel points rewards belong to the client ID that created them.** Your app can't update/delete
  dashboard-made rewards or fulfill their redemptions (403). Create rewards via the API and store their IDs.
- **Affiliate/Partner only**: custom rewards, polls, predictions, commercials (403 otherwise). Test with the
  CLI mock's partner user or an affiliate account.
- **Get Channel Followers** needs a broadcaster/mod user token with `moderator:read:followers`; otherwise
  you only get `total`. Viewer-side "do I follow X?" is Get Followed Channels with `user:read:follows`.
- **Create Clip is async** (202): poll Get Clips by id for up to ~60 s. Channel must be live.
- **Shoutouts**: live with ≥1 viewer, 1 per 2 min, same target 1 per 60 min; the 429 is a cooldown, not the
  bucket — don't blind-retry. Raids: 10 requests / 10 min, 90-second countdown, 409 if already raiding.
- **Page sizes aren't uniform**: Get Custom Reward Redemption ≤50, Get Polls ≤20, Get Predictions ≤25,
  Get Chatters ≤1000. Over the max ⇒ 400.
- **Send Chat Message can return 200 with `is_sent: false`** — check `drop_reason`.
- **Deprecated fields lie**: `view_count` (users), `tag_ids` and `is_mature` (streams), poll `bits_*`.
  "Get Hype Train Events" no longer exists → Get Hype Train Status.
- **Never ship the client secret or an app token to a browser/overlay.** Helix allows CORS (`*`), so a
  browser *can* call it with a user token from the implicit flow — but overlays should talk to your backend.
- **Don't match on error `message` strings**; Twitch changes them. Use status codes.
- `for_source_only` (shared chat) on Send Chat Message/Announcement is **app-token only** (400 with a user token).

## Quick start (TypeScript, Node 22+)

Copy `assets/templates/helix-client.ts` into the project (zero dependencies, ESM, strict-TS clean).

```ts
import { HelixClient, AppTokenProvider, UserTokenProvider, HelixError } from "./helix-client.ts";

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

// App token: public data
const app = new HelixClient({ clientId, token: new AppTokenProvider({ clientId, clientSecret }) });
const user = await app.getUserByLogin("twitchdev");
const { data: [stream] } = await app.getStreams({ user_id: [user!.id] });
console.log(stream ? `LIVE: ${stream.title} (${stream.viewer_count} viewers)` : "offline");

// User token: act as the broadcaster (tokens from your OAuth flow; refresh + persist automatically)
const helix = new HelixClient({
  clientId,
  token: new UserTokenProvider({ clientId, clientSecret, accessToken, refreshToken,
    onRefresh: (t) => db.saveTokens(t.access_token, t.refresh_token) }),
});
const me = (await helix.getUsers())[0]!;                 // token owner
await helix.updateChannel(me.id, { title: "Hackathon build!" });
const poll = await helix.createPoll({ broadcaster_id: me.id, title: "Ship it?",
  choices: [{ title: "Yes" }, { title: "Also yes" }], duration: 60 });

// Pagination as an async iterator
for await (const f of helix.paginate<{ user_name: string }>("/channels/followers", { broadcaster_id: me.id }, { limit: 500 })) {
  console.log(f.user_name);
}

// Anything without a helper
await helix.request("POST", "/streams/markers", { body: { user_id: me.id, description: "clip this" } });

// Errors
try { await helix.startRaid(me.id, "12345"); }
catch (e) { if (e instanceof HelixError && e.status === 409) console.log("already raiding"); else throw e; }
```

The client: sends both headers, encodes arrays as repeated keys, refreshes once on 401, waits for
`Ratelimit-Reset` when the bucket is empty, retries bucket-429s with jitter (but throws cooldown-429s),
retries 503 once, and exports typed shapes (`User`, `Stream`, `Channel`, `CustomReward`, `Redemption`,
`Poll`, `Prediction`, `Clip`, `Follower`, `Subscription`, ...) with field names copied from the reference.
For a mock server pass `baseUrl: "http://localhost:8110/mock"` and `authBaseUrl: "http://localhost:8110/auth"`.

Twurple alternative: `@twurple/api` `ApiClient` + `@twurple/auth` `RefreshingAuthProvider` wraps the same
endpoints (`api.users.getUserByName`, `api.channelPoints.createCustomReward`, ...). Good for speed; see
twitch-dev for setup. Use the endpoint index here either way to know token types, scopes and limits.

## Workflow for a new feature

1. Find the endpoint: `grep -i "reward" references/endpoints.md` (or browse by category).
2. Read its token/scope/status/paging/limit columns; note the identity rule (whose token?).
3. Print the full official section: `node scripts/endpoint.ts "Update Redemption Status"`.
4. Check `references/recipes.md` for the flow and gotchas; `references/conventions.md` for cross-cutting rules.
5. Use a typed helper or `helix.request()`; add a response interface by copying field names from step 3.
6. Test against the CLI mock (`references/testing.md`, `node scripts/smoke-test.ts`).
7. If it's an "on event" feature, pair it with an EventSub subscription (twitch-eventsub skill).

## Reference map

| File | Read / use when |
|---|---|
| `references/endpoints.md` | **Generated index of all 149 Helix endpoints** in 30 categories: method + path, token type (incl. app† expansion), scopes, NEW/BETA status, page-size max, extra rate limits, purpose. Start here to pick an endpoint or check a scope. |
| `references/conventions.md` | Headers, which token type, identity rules, pagination, batching ids, rate-limit buckets + per-endpoint limits table, error body + status code meanings (400–503), retry/backoff, RFC3339/IDs, CORS/browser rules, caching. |
| `references/recipes.md` | Task recipes in TS with endpoint + scope + gotchas: users, live status, title/category, channel points, polls, predictions, clips, markers, raids, shoutouts, announcements, bot chat message, chat settings, bans/timeouts/warns, AutoMod, VIPs/mods, chatters, followers, subs, bits, hype train, goals, schedule, videos, search, teams; pointers for EventSub & Extensions. |
| `references/testing.md` | Exact Twitch CLI mock-API commands that work (generate/start, /mock, /auth/token, /auth/authorize user tokens, /units), mock-vs-real differences, smoke test. |
| `references/official/api_reference.md` | Official reference (≈13.5k lines, every endpoint's params/body/response/codes/examples). Don't read whole — use `scripts/endpoint.ts` or grep. |
| `references/official/api_guide.md` | Official concepts: rate limits, pagination, IDs, timestamps, breaking-change policy. |
| `references/official/api_get-started.md`, `api.md` | Official intro / first call. |
| `references/official/api_{polls,predictions,clips,markers,raids,goals,schedule,videos,moderation}.md` | Official feature guides (moderation guide is long: bans, AutoMod, blocked terms, shield mode, chat settings walkthroughs). |
| `scripts/endpoint.ts` | `node scripts/endpoint.ts "Create Poll"` prints that endpoint's full official section; fuzzy, case-insensitive; also matches anchors (`create-poll`) and paths (`"POST /helix/polls"`); lists candidates when ambiguous; `--brief` = auth + URL + query params only; `--list` = all endpoints. |
| `scripts/gen-endpoints.py` | Regenerates `references/endpoints.md` from the official snapshot (`python3 -I scripts/gen-endpoints.py`); run after twitch-dev's `refresh-docs.sh`; exits non-zero if sections and summary table disagree. |
| `scripts/smoke-test.ts` | Runtime check of the template client against the Twitch CLI mock (port 8110) + a local 429 fake (port 8111). |
| `assets/templates/helix-client.ts` | Copy-in typed Helix client (tokens, refresh, rate limits, pagination, ~25 helpers, response types). |

## Looking up details

```bash
node scripts/endpoint.ts "send chat message"            # full section
node scripts/endpoint.ts reward                         # ambiguous -> lists the 5 custom-reward endpoints
grep -n "^## Create Poll  " references/official/api_reference.md   # heading line (two spaces before {#anchor})
grep -n "moderator:read:followers" references/endpoints.md        # who needs this scope
grep -n "| BETA |\|| NEW |" references/endpoints.md               # newer / beta endpoints
grep -n -i "Rate Limit" references/official/api_reference.md      # all endpoint-specific limits
```

Docs snapshot: dev.twitch.tv, fetched 2026-10-26 (changelog through 2026-10-01). BETA endpoints today:
the 12 Guest Star endpoints. NEW (recently GA): Get Custom Power-up, pinned chat (Get/Pin/Update/Unpin),
Create Clip From VOD, Get Clips Download, Get Authorization By User, Add/Remove Suspicious Status.
When in doubt, `node scripts/endpoint.ts` beats memory — field names and limits change.
