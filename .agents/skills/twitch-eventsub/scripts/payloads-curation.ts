// Hand-curated list of the most-used EventSub events for references/payloads.md.
// Field lists and example JSON are pulled from the official docs by gen-subscription-types.ts;
// only the `notes` below are hand-written (keep them short, factual, and sourced from the docs).

export type Curated = { type: string; version: string; why: string; notes: string[] };

export const CURATED: Curated[] = [
  {
    type: 'channel.follow', version: '2', why: 'follower alerts',
    notes: [
      'v2 condition needs BOTH `broadcaster_user_id` and `moderator_user_id`; the token user (WebSocket) must be the broadcaster or one of their moderators, with `moderator:read:followers`. Use the broadcaster ID as moderator ID when the broadcaster authorized you.',
      'There is no unfollow event. Debounce alerts per `user_id` (follow/unfollow spam would otherwise replay your alert).',
    ],
  },
  {
    type: 'channel.subscribe', version: '1', why: 'new-sub alerts',
    notes: [
      'Fires for first-time subs and for each gifted sub recipient (`is_gift: true`). It does NOT fire for resubs — use `channel.subscription.message` (only when the viewer shares the resub in chat) or `channel.chat.notification` (`notice_type: "resub"`).',
      '`tier` is a string: `"1000"`, `"2000"`, `"3000"` (Prime counts as tier `"1000"`).',
    ],
  },
  {
    type: 'channel.subscription.gift', version: '1', why: 'gift-bomb alerts',
    notes: [
      'One event per gift action with `total` subs; each recipient additionally produces a `channel.subscribe` with `is_gift: true` — alert on the gift event and suppress the per-recipient ones if you want one "X gifted 10 subs" alert.',
      'Anonymous gifts: `is_anonymous: true` and `user_id`/`user_login`/`user_name` are `null`. `cumulative_total` is `null` for anonymous gifts or when the gifter opted out.',
    ],
  },
  {
    type: 'channel.subscription.message', version: '1', why: 'resub alerts with message',
    notes: [
      'Only fires when the viewer chooses to share their resub message in chat. `message.emotes` gives `begin`/`end` indexes into `message.text` (not fragments).',
      '`streak_months` is `null` if the user opted out of sharing it.',
    ],
  },
  {
    type: 'channel.cheer', version: '1', why: 'cheer alerts (Bits in chat)',
    notes: [
      '`message` is the raw chat text including cheermote tokens (e.g. `Cheer100`). Anonymous cheers: `is_anonymous: true`, user fields `null`.',
      'Prefer `channel.bits.use` if you also want Power-ups; `channel.cheer` covers cheers only.',
    ],
  },
  {
    type: 'channel.bits.use', version: '1', why: 'all Bits usage: cheers + Power-ups',
    notes: [
      '`type` is `cheer`, `power_up` or `custom_power_up`; `power_up` / `custom_power_up` objects are present only for those types. Bits spent in Extensions are NOT included (use `extension.bits_transaction.create`).',
      'Does not fire when a streamer uses a Power-up for free in their own channel (doc "Triggers" section). Scope: `bits:read`.',
    ],
  },
  {
    type: 'channel.raid', version: '1', why: 'raid alerts / auto-shoutout',
    notes: [
      'Condition takes exactly one of `from_broadcaster_user_id` (raids this channel sends) or `to_broadcaster_user_id` (raids it receives). Subscribe twice for both directions. No authorization required (costs 1 unless the broadcaster authorized your app).',
    ],
  },
  {
    type: 'channel.channel_points_custom_reward_redemption.add', version: '1', why: 'channel-point redemptions (custom rewards)',
    notes: [
      'Optional condition `reward_id` filters to one reward. `user_input` is `""` when the reward has no text input. `status` is `unfulfilled` unless the reward skips the request queue (then `fulfilled`).',
      'To mark a redemption fulfilled/canceled use Helix Update Redemption Status — only the app (client ID) that CREATED the reward may update its redemptions (see the twitch-api skill). Rewards created in the Twitch dashboard can be listened to, but not updated.',
    ],
  },
  {
    type: 'channel.channel_points_automatic_reward_redemption.add', version: '2', why: 'built-in rewards (highlight message, emote unlocks, …)',
    notes: [
      'Use v2: `reward` object (`type`, `channel_points`, optional `emote`) and `message.fragments`. v1 has a different shape (`reward.cost`, `reward.unlocked_emote`, `message.emotes`, `user_input`).',
      'Built-in rewards like "Highlight My Message" do not appear in the custom-reward event.',
    ],
  },
  { type: 'channel.poll.begin', version: '1', why: 'poll overlays', notes: ['`bits_voting` is not supported (always disabled/0). `ends_at` lets you render a countdown.'] },
  { type: 'channel.poll.progress', version: '1', why: 'live poll bars', notes: ['Sent as users vote; `choices[].votes` is the total across methods, `channel_points_votes` the Channel-Points share. Delivery order across begin/progress/end is not guaranteed — key state by poll `id`.'] },
  { type: 'channel.poll.end', version: '1', why: 'poll results', notes: ['`status`: `completed`, `archived` or `terminated`. Has `ended_at` instead of `ends_at`.'] },
  { type: 'channel.prediction.begin', version: '1', why: 'prediction overlays', notes: ['`outcomes[]` (2–10 outcomes; `color` `blue`/`pink`). `locks_at` = automatic lock time.'] },
  { type: 'channel.prediction.progress', version: '1', why: 'live prediction bars', notes: ['`outcomes[].top_predictors[].channel_points_won` is always `null` in progress and lock events.'] },
  { type: 'channel.prediction.lock', version: '1', why: 'prediction locked', notes: ['Has `locked_at`; no more points can be added.'] },
  { type: 'channel.prediction.end', version: '1', why: 'prediction results', notes: ['`status`: `resolved` or `canceled`; read `winning_outcome_id` only when resolved.'] },
  {
    type: 'channel.hype_train.begin', version: '2', why: 'hype-train overlays',
    notes: [
      'v1 is deprecated/withdrawn — subscribe with version `"2"`. v2 has `type` (`regular`, `treasure`, `golden_kappa`), `is_shared_train`, `shared_train_participants`, `all_time_high_level/total` (begin only).',
      'Begin is accompanied by `channel.hype_train.progress` events for the contributions that started it; order is not guaranteed (progress may arrive before begin).',
    ],
  },
  { type: 'channel.hype_train.progress', version: '2', why: 'hype-train level/progress bar', notes: ['`progress`/`goal` are points within the current `level`; `total` is the whole train. `expires_at` moves forward on level-up.'] },
  { type: 'channel.hype_train.end', version: '2', why: 'hype-train summary', notes: ['Has `ended_at` and `cooldown_ends_at` (next train possible).'] },
  { type: 'stream.online', version: '1', why: 'go-live notifications', notes: ['No authorization required (cost 1 unless the broadcaster authorized your app). `type` can be `live`, `playlist`, `watch_party`, `premiere`, `rerun` — filter to `live` for "going live" pings.'] },
  { type: 'stream.offline', version: '1', why: 'end-of-stream', notes: ['`id` (stream id) was added on 2026-06-26; older examples omit it.'] },
  { type: 'channel.update', version: '2', why: 'title/category changes', notes: ['No authorization required. v2 replaced `is_mature` with `content_classification_labels` (array of label IDs).'] },
  {
    type: 'channel.chat.message', version: '1', why: 'chat bots, !commands, chat overlays',
    notes: [
      'Condition `user_id` is the user whose chat you READ AS (your bot / the logged-in user), not the chatter. That user needs `user:read:chat`; with an app token (webhook/conduit) also `user:bot`, plus the broadcaster\'s `channel:bot` or the bot being a moderator. See the twitch-chat skill for bots.',
      'Fires for every message in the channel, including ones your own bot sends — ignore `chatter_user_id === botUserId` to avoid command loops.',
      'Fragment `type`: `text`, `cheermote`, `emote`, `mention`, `gif` (gif added 2026-07-16; reference lists `gif.id` + `gif.url`, the change-log text says `gif_id` — read both defensively). Render from `message.fragments`, not by re-parsing `message.text`.',
      'Shared chat: `source_broadcaster_user_id` / `source_message_id` / `source_badges` are non-null when the message came from another channel in the session; `is_source_only` marks messages kept in the source channel.',
      'Not triggerable by Twitch CLI v1.1.24 — use the fixture in references/testing.md.',
    ],
  },
  {
    type: 'channel.chat.notification', version: '1', why: 'subs/resubs/gifts/raids/announcements/watch streaks as seen in chat',
    notes: [
      'One subscription covers everything that renders as a chat notice. Switch on `notice_type`; exactly the matching object (`sub`, `resub`, `sub_gift`, `community_sub_gift`, `gift_paid_upgrade`, `prime_paid_upgrade`, `raid`, `unraid`, `pay_it_forward`, `announcement`, `bits_badge_tier`, `charity_donation`, `watch_streak`, `modiversary`, `gifted_drops_summary`, and `shared_chat_*` twins) is non-null.',
      'Only needs chat-read authorization (`user:read:chat` for the reading user) — no `channel:read:subscriptions` from the broadcaster — so it is the easiest way for a chat bot to see subs/resubs. Values are as displayed in chat (e.g. `system_message`).',
      '`watch_streak` (2026-04-02) and `modiversary` (2026-06-12), `gifted_drops_summary` (2026-10-01) are recent additions; always keep an `unknown`/default branch.',
      'The doc example below still shows the pre-2023 name `sub_plan` inside `resub`; the field is `sub_tier` (renamed 2023-11-07 per the change log). Trust the field list.',
    ],
  },
  { type: 'channel.ad_break.begin', version: '1', why: '"ads running" overlay countdown', notes: ['Scope `channel:read:ads`. `duration_seconds` + `started_at` give the countdown; `is_automatic` true when scheduled by Ads Manager. There may be delay between the event and viewers seeing ads.'] },
  { type: 'channel.goal.begin', version: '1', why: 'goal bars (follower/sub/bits goals)', notes: ['Scope `channel:read:goals`. Same event shape for begin/progress/end; `type`: `follow`, `subscription`, `subscription_count`, `new_subscription`, `new_subscription_count`, `new_bit`, `new_cheerer`.'] },
  { type: 'channel.goal.progress', version: '1', why: 'goal bar updates', notes: ['Progress can be negative (lost followers). Progress may arrive before begin.'] },
  { type: 'channel.goal.end', version: '1', why: 'goal completed', notes: ['Only end carries meaningful `is_achieved` and `ended_at`.'] },
  { type: 'channel.shoutout.create', version: '1', why: 'shoutouts sent', notes: ['Scope `moderator:read:shoutouts` or `moderator:manage:shoutouts`; condition needs `moderator_user_id`. `cooldown_ends_at` / `target_cooldown_ends_at` tell you when the next Shoutout is allowed.'] },
  { type: 'channel.shoutout.receive', version: '1', why: 'shoutouts received', notes: ['Sent only if Twitch posts the Shoutout to the broadcaster\'s activity feed.'] },
];
