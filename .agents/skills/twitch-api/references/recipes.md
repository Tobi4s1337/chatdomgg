# Helix recipes (TypeScript)

Task-oriented snippets built on `assets/templates/helix-client.ts`. Each recipe lists the endpoint(s),
token + scope, and the gotchas that bite. For exact params run `node scripts/endpoint.ts "<Endpoint>"`.

## Contents
- Setup: two clients (app + broadcaster user)
- Users, streams, channel info
  1. User by login / ID · 2. Is the channel live? viewer count · 3. Update title / category / tags
- Channel points
  4. Create a reward · 5. Fulfill / cancel redemptions · 6. Pause, disable, update, delete
- Engagement
  7. Polls · 8. Predictions · 9. Clips · 10. Stream markers · 11. Raids · 12. Shoutouts
  13. Announcements · 14. Send a chat message (bot)
- Moderation
  15. Chat settings · 16. Ban / timeout / unban / warn / delete message · 17. AutoMod
  18. VIPs and moderators · 19. Chatters list
- Community & money
  20. Followers · 21. Subscriptions · 22. Bits leaderboard & cheermotes · 23. Hype train · 24. Goals
- Content & discovery
  25. Schedule · 26. Videos / VODs · 27. Search · 28. Teams
- Pointers: EventSub management, Extensions

## Setup

```ts
import { HelixClient, AppTokenProvider, UserTokenProvider, HelixError } from "./helix-client.ts"; // or .js after build

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

// Public data: app token (client credentials) — no user needed.
export const app = new HelixClient({ clientId, token: new AppTokenProvider({ clientId, clientSecret }) });

// Acting as the broadcaster: their user token (authorization-code flow, see twitch-dev skill).
export const helix = new HelixClient({
  clientId,
  token: new UserTokenProvider({
    clientId, clientSecret,
    accessToken: stored.accessToken, refreshToken: stored.refreshToken,
    onRefresh: (t) => saveTokens(t.access_token, t.refresh_token!), // refresh tokens can rotate: persist!
  }),
});
const broadcasterId = (await helix.getUsers())[0]!.id; // no args + user token => token owner
```

Twurple equivalent: `new ApiClient({ authProvider })` from `@twurple/api` with `RefreshingAuthProvider`
from `@twurple/auth` (e.g. `api.users.getUserByName()`, `api.streams.getStreamByUserId()`,
`api.channelPoints.createCustomReward()`). See the twitch-dev skill for the Twurple guide.

---

## 1. Get a user by login or ID
- **Get Users** `GET /users` — app or user token, no scope (`user:read:email` adds `email` for the token's own user).
```ts
const user = await app.getUserByLogin("twitchdev");          // undefined if not found / banned
const many = await app.getUsers({ login: ["a", "b"], id: ["141981764"] }); // ≤100 of each, mixed is OK
```
- Logins are lowercase; store the **ID** (logins can be renamed). Unknown logins are silently omitted.

## 2. Is the channel live? Viewer count
- **Get Streams** `GET /streams?user_id=…` — app or user, no scope.
```ts
const { data } = await app.getStreams({ user_id: [broadcasterId] });
const live = data[0]; // undefined => offline
if (live) console.log(live.title, live.game_name, live.viewer_count, live.started_at);
const thumb = live?.thumbnail_url.replace("{width}", "640").replace("{height}", "360");
```
- Offline channels are simply absent from `data` (no error). Up to 100 `user_id` per call — batch.
- For instant online/offline use EventSub `stream.online` / `stream.offline` (twitch-eventsub skill).
- Title/category while offline: use Get Channel Information (`app.getChannels([id])`).

## 3. Update title / category / tags
- **Modify Channel Information** `PATCH /channels?broadcaster_id=` — user token of the broadcaster,
  `channel:manage:broadcast`. Returns 204.
- Find the category ID with **Search Categories** (fuzzy) or **Get Games** (`name` must match exactly).
```ts
const cat = (await app.searchCategories("just chatting")).data[0];
await helix.updateChannel(broadcasterId, { title: "Building a Twitch bot live!", game_id: cat?.id, tags: ["English", "Coding"] });
```
- `title` can't be empty; `tags` ≤10 (empty array clears); `game_id: "0"` or `""` unsets. `delay` partners only.
- Editors can't use their own token here — the token user must be the broadcaster.

## 4. Channel points: create a custom reward
- **Create Custom Rewards** `POST /channel_points/custom_rewards?broadcaster_id=` — user (broadcaster),
  `channel:manage:redemptions`. Affiliate/Partner only (403 otherwise).
```ts
const reward = await helix.createCustomReward(broadcasterId, {
  title: "Hydrate!", cost: 500, prompt: "Tell me what to drink", is_user_input_required: true,
  is_global_cooldown_enabled: true, global_cooldown_seconds: 60, background_color: "#9147FF",
});
```
- **Only the client ID that created a reward can update/delete it or read/update its redemptions** (403
  otherwise). Rewards made in the dashboard are read-only for you — create yours via the API at setup time
  and store the reward ID. List yours with `getCustomRewards(id, { only_manageable_rewards: true })`.
- `title` ≤45 chars and unique in the channel; `cost` ≥1; `prompt` ≤200; cooldown 1–604800 s.
- Listen for redemptions with EventSub `channel.channel_points_custom_reward_redemption.add` (same scope).

## 5. Fulfill or cancel redemptions
- **Get Custom Reward Redemption** (page max 50) / **Update Redemption Status** `PATCH …/redemptions?broadcaster_id&reward_id&id=…` body `{status}`.
```ts
for await (const r of helix.getRedemptions(broadcasterId, reward.id, "UNFULFILLED")) {
  const ok = await doTheThing(r.user_input);
  await helix.updateRedemptionStatus(broadcasterId, reward.id, [r.id], ok ? "FULFILLED" : "CANCELED"); // CANCELED refunds
}
```
- Only `UNFULFILLED` redemptions can be updated. Up to 50 `id` per call. If the reward has
  `should_redemptions_skip_request_queue: true`, redemptions arrive already FULFILLED (can't refund).

## 6. Pause / disable / update / delete a reward
```ts
await helix.updateCustomReward(broadcasterId, reward.id, { is_paused: true });   // e.g. while offline
await helix.updateCustomReward(broadcasterId, reward.id, { is_enabled: false }); // hidden from viewers
await helix.deleteCustomReward(broadcasterId, reward.id); // UNFULFILLED redemptions get marked FULFILLED
```

## 7. Polls
- **Create Poll** `POST /polls` (body), **End Poll** `PATCH /polls`, **Get Polls** `GET /polls?broadcaster_id` (page ≤20).
- User (broadcaster), `channel:manage:polls` (`channel:read:polls` for Get). Affiliate/Partner only. One active poll at a time.
```ts
const poll = await helix.createPoll({ broadcaster_id: broadcasterId, title: "Next game?",
  choices: [{ title: "Celeste" }, { title: "Hades" }], duration: 120,
  channel_points_voting_enabled: true, channel_points_per_vote: 100 });
// later / on demand:
const final = await helix.endPoll(broadcasterId, poll.id, "TERMINATED"); // ARCHIVED hides it
final.choices.forEach((c) => console.log(c.title, c.votes));
```
- Limits: title ≤60, 2–5 choices ≤25 chars each, duration 15–1800 s. Text goes through AutoMod (400 if rejected).
- `bits_voting_enabled`/`bits_votes` are dead fields (always false/0).
- Live progress: EventSub `channel.poll.begin/progress/end` rather than polling Get Polls.

## 8. Predictions (create → lock → resolve)
- **Create Prediction** `POST /predictions`, **End Prediction** `PATCH /predictions` — user (broadcaster), `channel:manage:predictions`. Affiliate/Partner only.
```ts
const p = await helix.createPrediction({ broadcaster_id: broadcasterId, title: "Will I beat the boss?",
  outcomes: [{ title: "Yes" }, { title: "No" }], prediction_window: 120 });
await helix.endPrediction(broadcasterId, p.id, "LOCKED");                       // stop new predictions
await helix.endPrediction(broadcasterId, p.id, "RESOLVED", p.outcomes[0]!.id); // pay out
// or: await helix.endPrediction(broadcasterId, p.id, "CANCELED");             // refund everyone
```
- Title ≤45, 2–10 outcomes ≤25 chars, window 30–1800 s. `RESOLVED` requires `winning_outcome_id`.
  Only one active/locked prediction at a time.
- Events: `channel.prediction.begin/progress/lock/end`.

## 9. Clips (async!)
- **Create Clip** `POST /clips?broadcaster_id=` — user, `clips:edit`; channel must be **live**; returns
  **202** with `{id, edit_url}`. Optional `title`, `duration` (5–60 s, default 30).
- The clip isn't ready yet: poll **Get Clips** `?id=` until it appears; if not there after ~60 s, assume failure.
```ts
const clip = await helix.createClipAndWait(broadcasterId); // createClip + poll getClips every 3 s
if (clip) console.log(clip.url, clip.embed_url, clip.thumbnail_url);
```
- 403: clips disabled / restricted to followers/subs / user banned. 404: not live.
- **Create Clip From VOD** `POST /videos/clips` and **Get Clips Download** `GET /clips/downloads` (100
  req/min) need `editor:manage:clips` or `channel:manage:clips`.
- Embedding clips (`embed_url` + `parent=` domain) → twitch-dev skill (embed).

## 10. Stream markers
- **Create Stream Marker** `POST /streams/markers` body `{user_id, description?}` — user, `channel:manage:broadcast`
  (token user = broadcaster or an editor). 404 if not live or VODs disabled. `description` ≤140.
```ts
await helix.request("POST", "/streams/markers", { body: { user_id: broadcasterId, description: "epic moment" } });
```
- **Get Stream Markers** `GET /streams/markers?user_id|video_id` — `user:read:broadcast` or `channel:manage:broadcast`.

## 11. Raids
- **Start a raid** `POST /raids?from_broadcaster_id&to_broadcaster_id`, **Cancel a raid** `DELETE /raids?broadcaster_id`
  — user (raider), `channel:manage:raids`. Limit 10 requests / 10 min. 409 if already raiding.
```ts
const target = await app.getUserByLogin("somefriend");
await helix.startRaid(broadcasterId, target!.id); // pending ~90 s; broadcaster can click "Raid Now" in UI
// await helix.cancelRaid(broadcasterId);
```
- Incoming/outgoing raid events: EventSub `channel.raid`.

## 12. Shoutouts
- **Send a Shoutout** `POST /chat/shoutouts?from_broadcaster_id&to_broadcaster_id&moderator_id` —
  `moderator:manage:shoutouts`; moderator_id = token user (broadcaster or mod). 204.
- Broadcaster must be live with ≥1 viewer (400 otherwise); 1 shoutout per 2 min, same target once per
  60 min → 429 otherwise (don't blind-retry). Can't shout out yourself (400).
```ts
await helix.sendShoutout(broadcasterId, target!.id, broadcasterId);
```

## 13. Announcements
- **Send Chat Announcement** `POST /chat/announcements?broadcaster_id&moderator_id` body `{message, color?}`
  — `moderator:manage:announcements`; app† path needs `user:bot` + `channel:bot` too. ≤500 chars; 1 per 2 s.
```ts
await helix.sendAnnouncement(broadcasterId, broadcasterId, "Giveaway starts now!", "purple");
```
- `for_source_only` (shared chat) only works with an app token — with a user token it's a 400.

## 14. Send a chat message (bot)
- **Send Chat Message** `POST /chat/messages` body `{broadcaster_id, sender_id, message, reply_parent_message_id?}`.
- User token of the bot with `user:write:chat`, **or** app token where the bot granted `user:write:chat` +
  `user:bot` and the channel granted `channel:bot` (or the bot is a mod) → shows the Chat Bot badge.
```ts
const r = await bot.sendChatMessage({ broadcaster_id: broadcasterId, sender_id: botUserId, message: "Hello chat!" });
if (!r.is_sent) console.warn("dropped:", r.drop_reason?.code, r.drop_reason?.message); // 200 but not sent
```
- ≤500 chars; 422 = too large. Reading chat is EventSub `channel.chat.message`. Full chatbot guide,
  rate limits and IRC → twitch-chat skill.

## 15. Chat settings
- **Get Chat Settings** (app or user) / **Update Chat Settings** `PATCH /chat/settings?broadcaster_id&moderator_id`
  — `moderator:manage:chat_settings`. Send only fields you change.
```ts
await helix.request("PATCH", "/chat/settings", {
  query: { broadcaster_id: broadcasterId, moderator_id: broadcasterId },
  body: { slow_mode: true, slow_mode_wait_time: 10, follower_mode: true, follower_mode_duration: 10, emote_mode: false },
});
```
- slow_mode_wait_time 3–120 s; follower_mode_duration 0–129600 min; non_moderator_chat_delay_duration 2/4/6.

## 16. Ban, timeout, unban, warn, delete a message
- **Ban User** `POST /moderation/bans?broadcaster_id&moderator_id` body `{ data: { user_id, duration?, reason? } }`
  — `moderator:manage:banned_users`. No `duration` = permanent ban; `duration` 1–1209600 s = timeout.
- **Unban User** `DELETE /moderation/bans?broadcaster_id&moderator_id&user_id`.
- **Warn Chat User** `POST /moderation/warnings` body `{ data: { user_id, reason } }` — `moderator:manage:warnings`.
- **Delete Chat Messages** `DELETE /moderation/chat?broadcaster_id&moderator_id&message_id` (omit message_id = clear chat;
  message must be < 6 h old) — `moderator:manage:chat_messages`.
```ts
const q = { broadcaster_id: broadcasterId, moderator_id: modId };
await helix.request("POST", "/moderation/bans", { query: q, body: { data: { user_id: badId, duration: 600, reason: "spam" } } });
await helix.request("DELETE", "/moderation/bans", { query: { ...q, user_id: badId } });
await helix.request("DELETE", "/moderation/chat", { query: { ...q, message_id: msgId } });
```
- Note the `data` wrapper object in the ban/warn body. 409 = someone else is changing that user's ban
  state → retry shortly. 400 if the user may not be banned/timed out or is already banned.

## 17. AutoMod
- **Check AutoMod Status** `POST /moderation/enforcements/status?broadcaster_id` body `{data:[{msg_id, msg_text}]}` (≤100 msgs)
  — `moderation:read`. Strict per-channel limits (Normal 5/min, Affiliate 10/min, Partner 30/min).
- **Manage Held AutoMod Messages** `POST /moderation/automod/message` body `{user_id, msg_id, action: "ALLOW"|"DENY"}`
  — `moderator:manage:automod`; `user_id` = the moderator (token user). Held message IDs come from EventSub
  `automod.message.hold` (v2).
- **Get/Update AutoMod Settings** `GET|PUT /moderation/automod/settings?broadcaster_id&moderator_id` — `moderator:read|manage:automod_settings`.
- Blocked terms: `GET|POST|DELETE /moderation/blocked_terms` — `moderator:read|manage:blocked_terms`.

## 18. VIPs and moderators
- **Add/Remove Channel VIP** `POST|DELETE /channels/vips?broadcaster_id&user_id` — `channel:manage:vips`;
  **Add/Remove Channel Moderator** `POST|DELETE /moderation/moderators?broadcaster_id&user_id` — `channel:manage:moderators`.
  Broadcaster token only. 10 adds/removes per 10 s.
- Errors: 422 when the user is already the other role (remove VIP before modding and vice versa); 409 no VIP
  slots; 425 broadcaster hasn't completed "Build a Community".
- **Get VIPs** / **Get Moderators** accept up to 100 `user_id` to check membership in one call.

## 19. Who is in chat
- **Get Chatters** `GET /chat/chatters?broadcaster_id&moderator_id` — `moderator:read:chatters`, page ≤1000.
```ts
const chatters = await helix.getAll<{ user_id: string; user_login: string; user_name: string }>(
  "/chat/chatters", { broadcaster_id: broadcasterId, moderator_id: broadcasterId }, { pageSize: 1000 });
```
- The docs note a delay between users joining/leaving and the list updating; for activity-based features
  use chat messages from EventSub.

## 20. Followers
- **Get Channel Followers** `GET /channels/followers?broadcaster_id[&user_id]` — user token of the
  broadcaster or a moderator with `moderator:read:followers`. Without it you still get `total` only.
```ts
const { total, data } = await helix.getChannelFollowers(broadcasterId, { first: 5 }); // newest first
const follows = (await helix.getChannelFollowers(broadcasterId, { user_id: viewerId })).data.length > 0;
```
- "Does *this viewer* follow X" from the viewer's own token: **Get Followed Channels**
  `GET /channels/followed?user_id=<viewer>&broadcaster_id=X` — `user:read:follows`.
- New-follower alerts: EventSub `channel.follow` v2 (same scope).

## 21. Subscriptions
- **Get Broadcaster Subscriptions** `GET /subscriptions?broadcaster_id` — broadcaster token, `channel:read:subscriptions`.
  Response also has `total` (sub count) and `points` (sub points). Filter with up to 100 `user_id`.
```ts
const subs = await helix.getSubscriptions(broadcasterId, { first: 100 });
console.log(subs.total, subs.points, subs.data.map((s) => `${s.user_name} T${Number(s.tier) / 1000}${s.is_gift ? " (gift)" : ""}`));
```
- Viewer-side check: **Check User Subscription** `GET /subscriptions/user?broadcaster_id&user_id` with the
  viewer's token + `user:read:subscriptions` (404 = not subscribed).
- Alerts: EventSub `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message`.

## 22. Bits leaderboard & cheermotes
- **Get Bits Leaderboard** `GET /bits/leaderboard?count&period=day|week|month|year|all&started_at` — broadcaster token, `bits:read`.
  `count` 1–100 (default 10); periods use PST.
```ts
const lb = await helix.request<{ data: { user_name: string; rank: number; score: number }[]; total: number }>(
  "GET", "/bits/leaderboard", { query: { count: 10, period: "week" } });
```
- **Get Cheermotes** `GET /bits/cheermotes[?broadcaster_id]` — app or user. Cache it (render cheer images in an overlay).
- Live cheers: EventSub `channel.cheer` / `channel.bits.use`.

## 23. Hype train status
- **Get Hype Train Status** `GET /hypetrain/status?broadcaster_id` — broadcaster token, `channel:read:hype_train`.
  Returns `current` (null if none: `level`, `total`, `progress`, `goal`, `top_contributions`, `expires_at`,
  `type`, `is_shared_train`), `all_time_high`, `shared_all_time_high`.
- "Get Hype Train Events" was removed (2026-02-05). For live overlays use EventSub hype train v2 events.

## 24. Creator goals
- **Get Creator Goals** `GET /goals?broadcaster_id` — broadcaster token, `channel:read:goals`. Types include
  `follower`, `subscription`, `subscription_count`, `new_subscription`, `new_subscription_count`,
  `new_bit`, `new_cheerer` (2026-06-25). Use EventSub `channel.goal.*` for progress updates.

## 25. Schedule
- **Get Channel Stream Schedule** `GET /schedule?broadcaster_id` — app or user; page ≤25; 404 if no schedule.
- **Create Channel Stream Schedule Segment** `POST /schedule/segment?broadcaster_id` body `{start_time, timezone, duration, is_recurring?, category_id?, title?}`
  — `channel:manage:schedule`. `duration` minutes 30–1380; non-recurring needs Affiliate/Partner.
- Update/Delete segment: `PATCH|DELETE /schedule/segment?broadcaster_id&id`; vacation: `PATCH /schedule/settings`.
- iCal feed needs no auth: `GET /schedule/icalendar?broadcaster_id=…`.

## 26. Videos / VODs
- **Get Videos** `GET /videos?user_id=…&type=archive|highlight|upload&sort=time&first=…` — app or user.
  Exactly one of `id` (≤100) / `user_id` / `game_id`; paging only with user_id/game_id.
- VODs (archives) expire (14 days for normal broadcasters, 60 for others like partners); `duration` is a
  string like `"3m21s"`.
- **Delete Videos** `DELETE /videos?id=…` — `channel:manage:videos`.

## 27. Search
- **Search Categories** `GET /search/categories?query=` and **Search Channels** `GET /search/channels?query=&live_only=true`
  — app or user, page ≤100. Search Channels only returns channels that streamed in the last 6 months.
  `URLSearchParams` encodes the query for you (the template does this).

## 28. Teams
- **Get Channel Teams** `GET /teams/channel?broadcaster_id` and **Get Teams** `GET /teams?name=|id=` — app or user.
  `background_image_url` and `banner` may be null.

---

## EventSub subscription management (pointer)
`POST /eventsub/subscriptions`, `GET /eventsub/subscriptions` (no `first`; filter by `status`, `type`,
`user_id`, `subscription_id`, `conduit_id`), `DELETE /eventsub/subscriptions?id=`; conduits under
`/eventsub/conduits` (app token). Token rule: **app token for webhook/conduit, user token for WebSocket**.
409 on duplicates returns the existing subscription `id`. Everything else (transports, types, payloads) →
**twitch-eventsub** skill.

## Extensions (pointer)
Extension endpoints (configuration segments, Extension PubSub, extension chat, secrets, Bits products, live
channels) use an **EBS-signed JWT**, not an OAuth token, and have their own rate limits → **twitch-extensions** skill.
