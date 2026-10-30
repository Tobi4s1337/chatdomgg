# EventSub payloads — the ~30 most-used events

> Field lists and example JSON are GENERATED from a local HTML snapshot of dev.twitch.tv on 2026-10-26 by `scripts/gen-subscription-types.ts`
> (curation + notes in `scripts/payloads-curation.ts`). Field names/types are copied verbatim from the EventSub Reference.
> Every other type: `scripts/event-section.sh <type> [version]` or `references/event-objects.md`.
> The JSON shows only the `event` object. Full notification = `{ subscription, event }` (webhook body) or
> `{ metadata, payload: { subscription, event } }` (WebSocket frame).

Conventions that hold for every event: IDs are strings (never parse to number); `*_login` = lowercase login, `*_name` = display
name; timestamps are RFC3339 strings with nanosecond precision (`Date.parse` handles them, just loses sub-ms digits); optional
objects are `null` (not absent) when not applicable — check `!= null`. Nested shared objects (Choices, Outcomes, Reward, …) are
expanded inline below.

## Contents

- [`channel.follow` v2](#channelfollow-v2) — follower alerts
- [`channel.subscribe` v1](#channelsubscribe-v1) — new-sub alerts
- [`channel.subscription.gift` v1](#channelsubscriptiongift-v1) — gift-bomb alerts
- [`channel.subscription.message` v1](#channelsubscriptionmessage-v1) — resub alerts with message
- [`channel.cheer` v1](#channelcheer-v1) — cheer alerts (Bits in chat)
- [`channel.bits.use` v1](#channelbitsuse-v1) — all Bits usage: cheers + Power-ups
- [`channel.raid` v1](#channelraid-v1) — raid alerts / auto-shoutout
- [`channel.channel_points_custom_reward_redemption.add` v1](#channelchannelpointscustomrewardredemptionadd-v1) — channel-point redemptions (custom rewards)
- [`channel.channel_points_automatic_reward_redemption.add` v2](#channelchannelpointsautomaticrewardredemptionadd-v2) — built-in rewards (highlight message, emote unlocks, …)
- [`channel.poll.begin` v1](#channelpollbegin-v1) — poll overlays
- [`channel.poll.progress` v1](#channelpollprogress-v1) — live poll bars
- [`channel.poll.end` v1](#channelpollend-v1) — poll results
- [`channel.prediction.begin` v1](#channelpredictionbegin-v1) — prediction overlays
- [`channel.prediction.progress` v1](#channelpredictionprogress-v1) — live prediction bars
- [`channel.prediction.lock` v1](#channelpredictionlock-v1) — prediction locked
- [`channel.prediction.end` v1](#channelpredictionend-v1) — prediction results
- [`channel.hype_train.begin` v2](#channelhypetrainbegin-v2) — hype-train overlays
- [`channel.hype_train.progress` v2](#channelhypetrainprogress-v2) — hype-train level/progress bar
- [`channel.hype_train.end` v2](#channelhypetrainend-v2) — hype-train summary
- [`stream.online` v1](#streamonline-v1) — go-live notifications
- [`stream.offline` v1](#streamoffline-v1) — end-of-stream
- [`channel.update` v2](#channelupdate-v2) — title/category changes
- [`channel.chat.message` v1](#channelchatmessage-v1) — chat bots, !commands, chat overlays
- [`channel.chat.notification` v1](#channelchatnotification-v1) — subs/resubs/gifts/raids/announcements/watch streaks as seen in chat
- [`channel.ad_break.begin` v1](#channeladbreakbegin-v1) — "ads running" overlay countdown
- [`channel.goal.begin` v1](#channelgoalbegin-v1) — goal bars (follower/sub/bits goals)
- [`channel.goal.progress` v1](#channelgoalprogress-v1) — goal bar updates
- [`channel.goal.end` v1](#channelgoalend-v1) — goal completed
- [`channel.shoutout.create` v1](#channelshoutoutcreate-v1) — shoutouts sent
- [`channel.shoutout.receive` v1](#channelshoutoutreceive-v1) — shoutouts received

## channel.follow v2

A specified channel receives a follow. · scopes: `moderator:read:followers` · condition: `broadcaster_user_id`, `moderator_user_id`

- ⚠ v2 condition needs BOTH `broadcaster_user_id` and `moderator_user_id`; the token user (WebSocket) must be the broadcaster or one of their moderators, with `moderator:read:followers`. Use the broadcaster ID as moderator ID when the broadcaster authorized you.
- ⚠ There is no unfollow event. Debounce alerts per `user_id` (follow/unfollow spam would otherwise replay your alert).

**Event fields**

- `user_id` *string* — The user ID for the user now following the specified channel.
- `user_login` *string* — The user login for the user now following the specified channel.
- `user_name` *string* — The user display name for the user now following the specified channel.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `followed_at` *string* — RFC3339 timestamp of when the follow occurred.

```json
{
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "followed_at": "2020-07-15T18:16:11.17106713Z"
}
```

## channel.subscribe v1

A notification is sent when a specified channel receives a subscriber. This does not include resubscribes. · scopes: `channel:read:subscriptions` · condition: `broadcaster_user_id`

- ⚠ Fires for first-time subs and for each gifted sub recipient (`is_gift: true`). It does NOT fire for resubs — use `channel.subscription.message` (only when the viewer shares the resub in chat) or `channel.chat.notification` (`notice_type: "resub"`).
- ⚠ `tier` is a string: `"1000"`, `"2000"`, `"3000"` (Prime counts as tier `"1000"`).

**Event fields**

- `user_id` *string* — The user ID for the user who subscribed to the specified channel.
- `user_login` *string* — The user login for the user who subscribed to the specified channel.
- `user_name` *string* — The user display name for the user who subscribed to the specified channel.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `tier` *string* — The tier of the subscription. Valid values are `1000`, `2000`, and `3000`.
- `is_gift` *boolean* — Whether the subscription is a gift.

```json
{
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "tier": "1000",
  "is_gift": false
}
```

## channel.subscription.gift v1

A notification when a viewer gives a gift subscription to one or more users in the specified channel. · scopes: `channel:read:subscriptions` · condition: `broadcaster_user_id`

- ⚠ One event per gift action with `total` subs; each recipient additionally produces a `channel.subscribe` with `is_gift: true` — alert on the gift event and suppress the per-recipient ones if you want one "X gifted 10 subs" alert.
- ⚠ Anonymous gifts: `is_anonymous: true` and `user_id`/`user_login`/`user_name` are `null`. `cumulative_total` is `null` for anonymous gifts or when the gifter opted out.

**Event fields**

- `user_id` *string* — The user ID of the user who sent the subscription gift. Set to `null` if it was an anonymous subscription gift.
- `user_login` *string* — The user login of the user who sent the gift. Set to `null` if it was an anonymous subscription gift.
- `user_name` *string* — The user display name of the user who sent the gift. Set to `null` if it was an anonymous subscription gift.
- `broadcaster_user_id` *string* — The broadcaster user ID.
- `broadcaster_user_login` *string* — The broadcaster login.
- `broadcaster_user_name` *string* — The broadcaster display name.
- `total` *integer* — The number of subscriptions in the subscription gift.
- `tier` *string* — The tier of subscriptions in the subscription gift.
- `cumulative_total` *integer* — The number of subscriptions gifted by this user in the channel. This value is `null` for anonymous gifts or if the gifter has opted out of sharing this information.
- `is_anonymous` *boolean* — Whether the subscription gift was anonymous.

```json
{
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "total": 2,
  "tier": "1000",
  "cumulative_total": 284,
  "is_anonymous": false
}
```

## channel.subscription.message v1

A notification when a user sends a resubscription chat message in a specific channel. · scopes: `channel:read:subscriptions` · condition: `broadcaster_user_id`

- ⚠ Only fires when the viewer chooses to share their resub message in chat. `message.emotes` gives `begin`/`end` indexes into `message.text` (not fragments).
- ⚠ `streak_months` is `null` if the user opted out of sharing it.

**Event fields**

- `user_id` *string* — The user ID of the user who sent a resubscription chat message.
- `user_login` *string* — The user login of the user who sent a resubscription chat message.
- `user_name` *string* — The user display name of the user who a resubscription chat message.
- `broadcaster_user_id` *string* — The broadcaster user ID.
- `broadcaster_user_login` *string* — The broadcaster login.
- `broadcaster_user_name` *string* — The broadcaster display name.
- `tier` *string* — The tier of the user’s subscription.
- `message` *message* — An object that contains the resubscription message and emote information needed to recreate the message.
  - `text` *string* — The text of the resubscription chat message.
  - `emotes` *emotes* — An array that includes the emote ID and start and end positions for where the emote appears in the text.
    - `begin` *int* — The index of where the Emote starts in the text.
    - `end` *int* — The index of where the Emote ends in the text.
    - `id` *string* — The emote ID.
- `cumulative_months` *integer* — The total number of months the user has been subscribed to the channel.
- `streak_months` *integer* — The number of consecutive months the user’s current subscription has been active. This value is `null` if the user has opted out of sharing this information.
- `duration_months` *integer* — The month duration of the subscription.

```json
{
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "tier": "1000",
  "message": {"text":"Love the stream! FevziGG","emotes":[{"begin":23,"end":30,"id":"302976485"}]},
  "cumulative_months": 15,
  "streak_months": 1,
  "duration_months": 6
}
```

## channel.cheer v1

A user cheers on the specified channel. · scopes: `bits:read` · condition: `broadcaster_user_id`

- ⚠ `message` is the raw chat text including cheermote tokens (e.g. `Cheer100`). Anonymous cheers: `is_anonymous: true`, user fields `null`.
- ⚠ Prefer `channel.bits.use` if you also want Power-ups; `channel.cheer` covers cheers only.

**Event fields**

- `is_anonymous` *boolean* — Whether the user cheered anonymously or not.
- `user_id` *string* — The user ID for the user who cheered on the specified channel. This is null if `is_anonymous` is true.
- `user_login` *string* — The user login for the user who cheered on the specified channel. This is null if `is_anonymous` is true.
- `user_name` *string* — The user display name for the user who cheered on the specified channel. This is null if `is_anonymous` is true.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `message` *string* — The message sent with the cheer.
- `bits` *integer* — The number of Bits cheered.

```json
{
  "is_anonymous": false,
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "message": "pogchamp",
  "bits": 1000
}
```

## channel.bits.use v1

A notification is sent whenever Bits are used on a channel. · scopes: `bits:read` · condition: `broadcaster_user_id`

- ⚠ `type` is `cheer`, `power_up` or `custom_power_up`; `power_up` / `custom_power_up` objects are present only for those types. Bits spent in Extensions are NOT included (use `extension.bits_transaction.create`).
- ⚠ Does not fire when a streamer uses a Power-up for free in their own channel (doc "Triggers" section). Scope: `bits:read`.

**Event fields**

- `broadcaster_user_id` *string* — The User ID of the channel where the Bits were redeemed.
- `broadcaster_user_login` *string* — The login of the channel where the Bits were used.
- `broadcaster_user_name` *string* — The display name of the channel where the Bits were used.
- `user_id` *string* — The User ID of the redeeming user.
- `user_login` *string* — The login name of the redeeming user.
- `user_name` *string* — The display name of the redeeming user.
- `bits` *integer* — The number of Bits used.
- `type` *string* — Possible values are: • cheer • power_up • custom_power_up
- `message` *object* — Optional. An object that contains the user message and emote information needed to recreate the message.
  - `text` *string* — The chat message in plain text.
  - `fragments` *object[]* — The ordered list of chat message fragments.
    - `text` *string* — The message text in fragment.
    - `type` *string* — The type of message fragment. Possible values are: • text • cheermote • emote
    - `emote` *object* — Optional. The metadata pertaining to the emote.
      - `id` *string* — The ID that uniquely identifies this emote.
      - `emote_set_id` *string* — The ID that identifies the emote set that the emote belongs to.
      - `owner_id` *string* — The ID of the broadcaster who owns the emote.
      - `format` *[]string* — The formats that the emote is available in.
    - `cheermote` *object* — Optional. The metadata pertaining to the cheermote.
      - `prefix` *string* — The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase.
      - `bits` *int* — The amount of Bits cheered.
      - `tier` *int* — The tier level of the cheermote.
- `power_up` *object* — Optional. Data about a default (i.e.
  - `type` *string* — Possible values: • message_effect • celebration • gigantify_an_emote
  - `emote` *object* — Optional. Emote associated with the reward.
    - `id` *string* — The ID that uniquely identifies this emote.
    - `name` *string* — The human readable emote token.
  - `message_effect_id` *string* — Optional. The ID of the message effect.
- `custom_power_up` *object* — Optional. Data about a custom Power-up.
  - `title` *string* — The title of the custom Power-up.
  - `reward_id` *string* — The ID of the custom Power-up.

```json
{
  "user_id": "1234",
  "user_login": "cool_user",
  "user_name": "Cool_User",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cooler_user",
  "broadcaster_user_name": "Cooler_User",
  "bits": 2,
  "type": "cheer",
  "power_up": null,
  "custom_power_up": null,
  "message": {
    "text": "cheer1 hi cheer1",
    "fragments": [
      {
        "type": "cheermote",
        "text": "cheer1",
        "cheermote": {"prefix":"cheer","bits":1,"tier":1},
        "emote": null
      },
      {"type":"text","text":" hi ","cheermote":null,"emote":null},
      {
        "type": "cheermote",
        "text": "cheer1",
        "cheermote": {"prefix":"cheer","bits":1,"tier":1},
        "emote": null
      }
    ]
  }
}
```

## channel.raid v1

A broadcaster raids another broadcaster’s channel. · scopes: none · condition: `from_broadcaster_user_id`?, `to_broadcaster_user_id`?

- ⚠ Condition takes exactly one of `from_broadcaster_user_id` (raids this channel sends) or `to_broadcaster_user_id` (raids it receives). Subscribe twice for both directions. No authorization required (costs 1 unless the broadcaster authorized your app).

**Event fields**

- `from_broadcaster_user_id` *string* — The broadcaster ID that created the raid.
- `from_broadcaster_user_login` *string* — The broadcaster login that created the raid.
- `from_broadcaster_user_name` *string* — The broadcaster display name that created the raid.
- `to_broadcaster_user_id` *string* — The broadcaster ID that received the raid.
- `to_broadcaster_user_login` *string* — The broadcaster login that received the raid.
- `to_broadcaster_user_name` *string* — The broadcaster display name that received the raid.
- `viewers` *integer* — The number of viewers in the raid.

```json
{
  "from_broadcaster_user_id": "1234",
  "from_broadcaster_user_login": "cool_user",
  "from_broadcaster_user_name": "Cool_User",
  "to_broadcaster_user_id": "1337",
  "to_broadcaster_user_login": "cooler_user",
  "to_broadcaster_user_name": "Cooler_User",
  "viewers": 9001
}
```

## channel.channel_points_custom_reward_redemption.add v1

A viewer has redeemed a custom channel points reward on the specified channel. · scopes: `channel:read:redemptions` / `channel:manage:redemptions` · condition: `broadcaster_user_id`, `reward_id`?

- ⚠ Optional condition `reward_id` filters to one reward. `user_input` is `""` when the reward has no text input. `status` is `unfulfilled` unless the reward skips the request queue (then `fulfilled`).
- ⚠ To mark a redemption fulfilled/canceled use Helix Update Redemption Status — only the app (client ID) that CREATED the reward may update its redemptions (see the twitch-api skill). Rewards created in the Twitch dashboard can be listened to, but not updated.

**Event fields**

- `id` *string* — The redemption identifier.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `user_id` *string* — User ID of the user that redeemed the reward.
- `user_login` *string* — Login of the user that redeemed the reward.
- `user_name` *string* — Display name of the user that redeemed the reward.
- `user_input` *string* — The user input provided.
- `status` *string* — Defaults to `unfulfilled`. Possible values are `unknown`, `unfulfilled`, `fulfilled`, and `canceled`.
- `redeemed_at` *string* — RFC3339 timestamp of when the reward was redeemed.
- `reward` *reward* — Basic information about the reward that was redeemed, at the time it was redeemed.
  - `id` *string* — The reward identifier.
  - `title` *string* — The reward name.
  - `cost` *integer* — The reward cost.
  - `prompt` *string* — The reward description.

```json
{
  "id": "17fa2df1-ad76-4804-bfa5-a40ef63efe63",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "user_id": "9001",
  "user_login": "cooler_user",
  "user_name": "Cooler_User",
  "user_input": "pogchamp",
  "status": "unfulfilled",
  "reward": {"id":"92af127c-7326-4483-a52b-b0da0be61c01","title":"title","cost":100,"prompt":"reward prompt"},
  "redeemed_at": "2020-07-15T17:16:03.17106713Z"
}
```

## channel.channel_points_automatic_reward_redemption.add v2

A viewer has redeemed an automatic channel points reward on the specified channel. · scopes: `channel:read:redemptions` / `channel:manage:redemptions` · condition: `broadcaster_user_id`

- ⚠ Use v2: `reward` object (`type`, `channel_points`, optional `emote`) and `message.fragments`. v1 has a different shape (`reward.cost`, `reward.unlocked_emote`, `message.emotes`, `user_input`).
- ⚠ Built-in rewards like "Highlight My Message" do not appear in the custom-reward event.

**Event fields**

- `broadcaster_user_id` *string* — The ID of the channel where the reward was redeemed.
- `broadcaster_user_login` *string* — The login of the channel where the reward was redeemed.
- `broadcaster_user_name` *string* — The display name of the channel where the reward was redeemed.
- `user_id` *string* — The ID of the redeeming user.
- `user_login` *string* — The login of the redeeming user.
- `user_name` *string* — The display name of the redeeming user.
- `id` *string* — The ID of the Redemption.
- `reward` *object* — An object that contains the reward information.
  - `type` *string* — The type of reward. One of: • single_message_bypass_sub_mode • send_highlighted_message • random_sub_emote_unlock • chosen_sub_emote_unlock • chosen_modified_sub_emote_unlock
  - `channel_points` *int* — Number of channel points used.
  - `emote` *object* — Optional. Emote associated with the reward.
    - `id` *string* — The emote ID.
    - `name` *string* — The human readable emote token.
- `message` *object* — Optional. An object that contains the user message and emote information needed to recreate the message.
  - `text` *string* — The chat message in plain text.
  - `fragments` *array* — The ordered list of chat message fragments.
    - `text` *string* — The message text in fragment.
    - `type` *string* — The type of message fragment. Possible values are: • text • emote
    - `emote` *object* — Optional. The metadata pertaining to the emote.
      - `id` *string* — The ID that uniquely identifies this emote.
- `redeemed_at` *string* — The UTC date and time (in RFC3339 format) of when the reward was redeemed.

```json
{
  "broadcaster_user_id": "12826",
  "broadcaster_user_name": "Twitch",
  "broadcaster_user_login": "twitch",
  "user_id": "141981764",
  "user_name": "TwitchDev",
  "user_login": "twitchdev",
  "id": "f024099a-e0fe-4339-9a0a-a706fb59f353",
  "reward": {"type":"send_highlighted_message","channel_points":100,"emote":null},
  "message": {
    "text": "Hello world! VoHiYo",
    "fragments": [
      {"type":"text","text":"Hello world! ","emote":null},
      {"type":"emote","text":"VoHiYo","emote":{"id":"81274"}}
    ]
  },
  "redeemed_at": "2024-08-12T21:14:34.260398045Z"
}
```

## channel.poll.begin v1

A poll started on a specified channel. · scopes: `channel:read:polls` / `channel:manage:polls` · condition: `broadcaster_user_id`

- ⚠ `bits_voting` is not supported (always disabled/0). `ends_at` lets you render a countdown.

**Event fields**

- `id` *string* — ID of the poll.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Question displayed for the poll.
- `choices` *choices* — An array of choices for the poll.
  - `id` *string* — ID for the choice.
  - `title` *string* — Text displayed for the choice.
  - `bits_votes` *integer* — Not used; will be set to 0.
  - `channel_points_votes` *integer* — Number of votes received via Channel Points.
  - `votes` *integer* — Total number of votes received for the choice across all methods of voting.
- `bits_voting` *bits_voting* — Not supported.
  - `is_enabled` *boolean* — Not used; will be set to false.
  - `amount_per_vote` *integer* — Not used; will be set to 0.
- `channel_points_voting` *channel_points_voting* — The Channel Points voting settings for the poll.
  - `is_enabled` *boolean* — Indicates if Channel Points can be used for voting.
  - `amount_per_vote` *integer* — Number of Channel Points required to vote once with Channel Points.
- `started_at` *string* — The time the poll started.
- `ends_at` *string* — The time the poll will end.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "choices": [{"id":"123","title":"Yeah!"},{"id":"124","title":"No!"},{"id":"125","title":"Maybe!"}],
  "bits_voting": {"is_enabled":true,"amount_per_vote":10},
  "channel_points_voting": {"is_enabled":true,"amount_per_vote":10},
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "ends_at": "2020-07-15T17:16:08.17106713Z"
}
```

## channel.poll.progress v1

Users respond to a poll on a specified channel. · scopes: `channel:read:polls` / `channel:manage:polls` · condition: `broadcaster_user_id`

- ⚠ Sent as users vote; `choices[].votes` is the total across methods, `channel_points_votes` the Channel-Points share. Delivery order across begin/progress/end is not guaranteed — key state by poll `id`.

**Event fields**

- `id` *string* — ID of the poll.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Question displayed for the poll.
- `choices` *choices* — An array of choices for the poll.
  - `id` *string* — ID for the choice.
  - `title` *string* — Text displayed for the choice.
  - `bits_votes` *integer* — Not used; will be set to 0.
  - `channel_points_votes` *integer* — Number of votes received via Channel Points.
  - `votes` *integer* — Total number of votes received for the choice across all methods of voting.
- `bits_voting` *bits_voting* — Not supported.
  - `is_enabled` *boolean* — Not used; will be set to false.
  - `amount_per_vote` *integer* — Not used; will be set to 0.
- `channel_points_voting` *channel_points_voting* — The Channel Points voting settings for the poll.
  - `is_enabled` *boolean* — Indicates if Channel Points can be used for voting.
  - `amount_per_vote` *integer* — Number of Channel Points required to vote once with Channel Points.
- `started_at` *string* — The time the poll started.
- `ends_at` *string* — The time the poll will end.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "choices": [
    {"id":"123","title":"Yeah!","bits_votes":5,"channel_points_votes":7,"votes":12},
    {"id":"124","title":"No!","bits_votes":10,"channel_points_votes":4,"votes":14},
    {"id":"125","title":"Maybe!","bits_votes":0,"channel_points_votes":7,"votes":7}
  ],
  "bits_voting": {"is_enabled":true,"amount_per_vote":10},
  "channel_points_voting": {"is_enabled":true,"amount_per_vote":10},
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "ends_at": "2020-07-15T17:16:08.17106713Z"
}
```

## channel.poll.end v1

A poll ended on a specified channel. · scopes: `channel:read:polls` / `channel:manage:polls` · condition: `broadcaster_user_id`

- ⚠ `status`: `completed`, `archived` or `terminated`. Has `ended_at` instead of `ends_at`.

**Event fields**

- `id` *string* — ID of the poll.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Question displayed for the poll.
- `choices` *choices* — An array of choices for the poll.
  - `id` *string* — ID for the choice.
  - `title` *string* — Text displayed for the choice.
  - `bits_votes` *integer* — Not used; will be set to 0.
  - `channel_points_votes` *integer* — Number of votes received via Channel Points.
  - `votes` *integer* — Total number of votes received for the choice across all methods of voting.
- `bits_voting` *bits_voting* — Not supported.
  - `is_enabled` *boolean* — Not used; will be set to false.
  - `amount_per_vote` *integer* — Not used; will be set to 0.
- `channel_points_voting` *channel_points_voting* — The Channel Points voting settings for the poll.
  - `is_enabled` *boolean* — Indicates if Channel Points can be used for voting.
  - `amount_per_vote` *integer* — Number of Channel Points required to vote once with Channel Points.
- `status` *string* — The status of the poll. Valid values are `completed`, `archived`, and `terminated`.
- `started_at` *string* — The time the poll started.
- `ended_at` *string* — The time the poll ended.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "choices": [
    {"id":"123","title":"Blue","bits_votes":50,"channel_points_votes":70,"votes":120},
    {"id":"124","title":"Yellow","bits_votes":100,"channel_points_votes":40,"votes":140},
    {"id":"125","title":"Green","bits_votes":10,"channel_points_votes":70,"votes":80}
  ],
  "bits_voting": {"is_enabled":true,"amount_per_vote":10},
  "channel_points_voting": {"is_enabled":true,"amount_per_vote":10},
  "status": "completed",
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "ended_at": "2020-07-15T17:16:11.17106713Z"
}
```

## channel.prediction.begin v1

A Prediction started on a specified channel. · scopes: `channel:read:predictions` / `channel:manage:predictions` · condition: `broadcaster_user_id`

- ⚠ `outcomes[]` (2–10 outcomes; `color` `blue`/`pink`). `locks_at` = automatic lock time.

**Event fields**

- `id` *string* — Channel Points Prediction ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Title for the Channel Points Prediction.
- `outcomes` *outcomes* — An array of outcomes for the Channel Points Prediction.
  - `id` *string* — The outcome ID.
  - `title` *string* — The outcome title.
  - `color` *string* — The color for the outcome. Valid values are `pink` and `blue`.
  - `users` *integer* — The number of users who used Channel Points on this outcome.
  - `channel_points` *int* — The total number of Channel Points used on this outcome.
  - `top_predictors` *top_predictors* — An array of users who used the most Channel Points on this outcome.
    - `user_id` *string* — The ID of the user.
    - `user_login` *string* — The login of the user.
    - `user_name` *string* — The display name of the user.
    - `channel_points_won` *integer* — The number of Channel Points won. This value is always `null` in the event payload for Prediction progress and Prediction lock.
    - `channel_points_used` *integer* — The number of Channel Points used to participate in the Prediction.
- `started_at` *string* — The time the Channel Points Prediction started.
- `locks_at` *string* — The time the Channel Points Prediction will automatically lock.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "outcomes": [{"id":"1243456","title":"Yeah!","color":"blue"},{"id":"2243456","title":"No!","color":"pink"}],
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "locks_at": "2020-07-15T17:21:03.17106713Z"
}
```

## channel.prediction.progress v1

Users participated in a Prediction on a specified channel. · scopes: `channel:read:predictions` / `channel:manage:predictions` · condition: `broadcaster_user_id`

- ⚠ `outcomes[].top_predictors[].channel_points_won` is always `null` in progress and lock events.

**Event fields**

- `id` *string* — Channel Points Prediction ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Title for the Channel Points Prediction.
- `outcomes` *outcomes* — An array of outcomes for the Channel Points Prediction.
  - `id` *string* — The outcome ID.
  - `title` *string* — The outcome title.
  - `color` *string* — The color for the outcome. Valid values are `pink` and `blue`.
  - `users` *integer* — The number of users who used Channel Points on this outcome.
  - `channel_points` *int* — The total number of Channel Points used on this outcome.
  - `top_predictors` *top_predictors* — An array of users who used the most Channel Points on this outcome.
    - `user_id` *string* — The ID of the user.
    - `user_login` *string* — The login of the user.
    - `user_name` *string* — The display name of the user.
    - `channel_points_won` *integer* — The number of Channel Points won. This value is always `null` in the event payload for Prediction progress and Prediction lock.
    - `channel_points_used` *integer* — The number of Channel Points used to participate in the Prediction.
- `started_at` *string* — The time the Channel Points Prediction started.
- `locks_at` *string* — The time the Channel Points Prediction will automatically lock.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "outcomes": [
    {
      "id": "1243456",
      "title": "Yeah!",
      "color": "blue",
      "users": 10,
      "channel_points": 15000,
      "top_predictors": [
        {
          "user_name": "Cool_User",
          "user_login": "cool_user",
          "user_id": "1234",
          "channel_points_won": null,
          "channel_points_used": 500
        },
        {
          "user_name": "Coolest_User",
          "user_login": "coolest_user",
          "user_id": "1236",
          "channel_points_won": null,
          "channel_points_used": 200
        }
      ]
    },
    {
      "id": "2243456",
      "title": "No!",
      "color": "pink",
      "top_predictors": [
        {
          "user_name": "Cooler_User",
          "user_login": "cooler_user",
          "user_id": 12345,
          "channel_points_won": null,
          "channel_points_used": 5000
        }
      ]
    }
  ],
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "locks_at": "2020-07-15T17:21:03.17106713Z"
}
```

## channel.prediction.lock v1

A Prediction was locked on a specified channel. · scopes: `channel:read:predictions` / `channel:manage:predictions` · condition: `broadcaster_user_id`

- ⚠ Has `locked_at`; no more points can be added.

**Event fields**

- `id` *string* — Channel Points Prediction ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Title for the Channel Points Prediction.
- `outcomes` *outcomes* — An array of outcomes for the Channel Points Prediction.
  - `id` *string* — The outcome ID.
  - `title` *string* — The outcome title.
  - `color` *string* — The color for the outcome. Valid values are `pink` and `blue`.
  - `users` *integer* — The number of users who used Channel Points on this outcome.
  - `channel_points` *int* — The total number of Channel Points used on this outcome.
  - `top_predictors` *top_predictors* — An array of users who used the most Channel Points on this outcome.
    - `user_id` *string* — The ID of the user.
    - `user_login` *string* — The login of the user.
    - `user_name` *string* — The display name of the user.
    - `channel_points_won` *integer* — The number of Channel Points won. This value is always `null` in the event payload for Prediction progress and Prediction lock.
    - `channel_points_used` *integer* — The number of Channel Points used to participate in the Prediction.
- `started_at` *string* — The time the Channel Points Prediction started.
- `locked_at` *string* — The time the Channel Points Prediction was locked.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "outcomes": [
    {
      "id": "1243456",
      "title": "Yeah!",
      "color": "blue",
      "users": 10,
      "channel_points": 15000,
      "top_predictors": [
        {
          "user_name": "Cool_User",
          "user_login": "cool_user",
          "user_id": "1234",
          "channel_points_won": null,
          "channel_points_used": 500
        },
        {
          "user_name": "Coolest_User",
          "user_login": "coolest_user",
          "user_id": "1236",
          "channel_points_won": null,
          "channel_points_used": 200
        }
      ]
    },
    {
      "id": "2243456",
      "title": "No!",
      "color": "pink",
      "top_predictors": [
        {
          "user_name": "Cooler_User",
          "user_login": "cooler_user",
          "user_id": 12345,
          "channel_points_won": null,
          "channel_points_used": 5000
        }
      ]
    }
  ],
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "locked_at": "2020-07-15T17:21:03.17106713Z"
}
```

## channel.prediction.end v1

A Prediction ended on a specified channel. · scopes: `channel:read:predictions` / `channel:manage:predictions` · condition: `broadcaster_user_id`

- ⚠ `status`: `resolved` or `canceled`; read `winning_outcome_id` only when resolved.

**Event fields**

- `id` *string* — Channel Points Prediction ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `title` *string* — Title for the Channel Points Prediction.
- `winning_outcome_id` *string* — ID of the winning outcome.
- `outcomes` *outcomes* — An array of outcomes for the Channel Points Prediction.
  - `id` *string* — The outcome ID.
  - `title` *string* — The outcome title.
  - `color` *string* — The color for the outcome. Valid values are `pink` and `blue`.
  - `users` *integer* — The number of users who used Channel Points on this outcome.
  - `channel_points` *int* — The total number of Channel Points used on this outcome.
  - `top_predictors` *top_predictors* — An array of users who used the most Channel Points on this outcome.
    - `user_id` *string* — The ID of the user.
    - `user_login` *string* — The login of the user.
    - `user_name` *string* — The display name of the user.
    - `channel_points_won` *integer* — The number of Channel Points won. This value is always `null` in the event payload for Prediction progress and Prediction lock.
    - `channel_points_used` *integer* — The number of Channel Points used to participate in the Prediction.
- `status` *string* — The status of the Channel Points Prediction. Valid values are `resolved` and `canceled`.
- `started_at` *string* — The time the Channel Points Prediction started.
- `ended_at` *string* — The time the Channel Points Prediction ended.

```json
{
  "id": "1243456",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Aren’t shoes just really hard socks?",
  "winning_outcome_id": "12345",
  "outcomes": [
    {
      "id": "12345",
      "title": "Yeah!",
      "color": "blue",
      "users": 2,
      "channel_points": 15000,
      "top_predictors": [
        {
          "user_name": "Cool_User",
          "user_login": "cool_user",
          "user_id": "1234",
          "channel_points_won": 10000,
          "channel_points_used": 500
        },
        {
          "user_name": "Coolest_User",
          "user_login": "coolest_user",
          "user_id": "1236",
          "channel_points_won": 5000,
          "channel_points_used": 100
        }
      ]
    },
    {
      "id": "22435",
      "title": "No!",
      "users": 2,
      "channel_points": 200,
      "color": "pink",
      "top_predictors": [
        {
          "user_name": "Cooler_User",
          "user_login": "cooler_user",
          "user_id": 12345,
          "channel_points_won": null,
          "channel_points_used": 100
        },
        {
          "user_name": "Elite_User",
          "user_login": "elite_user",
          "user_id": 1337,
          "channel_points_won": null,
          "channel_points_used": 100
        }
      ]
    }
  ],
  "status": "resolved",
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "ended_at": "2020-07-15T17:16:11.17106713Z"
}
```

## channel.hype_train.begin v2

A Hype Train begins on the specified channel. · scopes: `channel:read:hype_train` · condition: `broadcaster_user_id`

- ⚠ v1 is deprecated/withdrawn — subscribe with version `"2"`. v2 has `type` (`regular`, `treasure`, `golden_kappa`), `is_shared_train`, `shared_train_participants`, `all_time_high_level/total` (begin only).
- ⚠ Begin is accompanied by `channel.hype_train.progress` events for the contributions that started it; order is not guaranteed (progress may arrive before begin).

**Event fields**

- `id` *string* — The Hype Train ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `total` *integer* — Total points contributed to the Hype Train.
- `progress` *integer* — The number of points contributed to the Hype Train at the current level.
- `goal` *integer* — The number of points required to reach the next level.
- `top_contributions` *top_contributions* — The contributors with the most points contributed.
  - `user_id` *string* — The ID of the user that made the contribution.
  - `user_login` *string* — The user’s login name.
  - `user_name` *string* — The user’s display name.
  - `type` *string* — The contribution method used. Possible values are: • bits - Bits contributions with Cheering and Power-ups.
  - `total` *integer* — The total amount contributed.
- `level` *integer* — The current level of the Hype Train.
- `all_time_high_level` *integer* — The all-time high level this type of Hype Train has reached for this broadcaster.
- `all_time_high_total` *integer* — The all-time high total this type of Hype Train has reached for this broadcaster.
- `shared_train_participants` *object[]* — Optional. Non-null for a shared Hype Train.
  - `broadcaster_user_id` *string* — The ID of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_login` *string* — The login of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_name` *string* — The display name of the broadcaster participating in the shared Hype Train.
- `started_at` *string* — The time when the Hype Train started.
- `expires_at` *string* — The time when the Hype Train expires.
- `type` *string* — The type of the Hype Train. Possible values are: • treasure • golden_kappa • regular
- `is_shared_train` *boolean* — Indicates if the Hype Train is shared.

```json
{
  "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "total": 137,
  "progress": 137,
  "goal": 500,
  "top_contributions": [{"user_id":"123","user_login":"pogchamp","user_name":"PogChamp","type":"bits","total":50}],
  "shared_train_participants": null,
  "level": 1,
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "expires_at": "2020-07-15T17:16:11.17106713Z",
  "is_shared_train": false,
  "type": "regular",
  "all_time_high_level": 4,
  "all_time_high_total": 2845
}
```

## channel.hype_train.progress v2

A Hype Train makes progress on the specified channel. · scopes: `channel:read:hype_train` · condition: `broadcaster_user_id`

- ⚠ `progress`/`goal` are points within the current `level`; `total` is the whole train. `expires_at` moves forward on level-up.

**Event fields**

- `id` *string* — The Hype Train ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `total` *integer* — Total points contributed to the Hype Train.
- `progress` *integer* — The number of points contributed to the Hype Train at the current level.
- `goal` *integer* — The number of points required to reach the next level.
- `top_contributions` *top_contributions* — The contributors with the most points contributed.
  - `user_id` *string* — The ID of the user that made the contribution.
  - `user_login` *string* — The user’s login name.
  - `user_name` *string* — The user’s display name.
  - `type` *string* — The contribution method used. Possible values are: • bits - Bits contributions with Cheering, Power-ups, and Extensions.
  - `total` *integer* — The total amount contributed.
- `level` *integer* — The current level of the Hype Train.
- `shared_train_participants` *object[]* — Optional. Non-null for a shared Hype Train.
  - `broadcaster_user_id` *string* — The ID of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_login` *string* — The login of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_name` *string* — The display name of the broadcaster participating in the shared Hype Train.
- `started_at` *string* — The time when the Hype Train started.
- `expires_at` *string* — The time when the Hype Train expires.
- `type` *string* — The type of the Hype Train. Possible values are: • treasure • golden_kappa • regular
- `is_shared_train` *boolean* — Indicates if the Hype Train is shared.

```json
{
  "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "total": 137,
  "progress": 137,
  "goal": 500,
  "top_contributions": [{"user_id":"123","user_login":"pogchamp","user_name":"PogChamp","type":"bits","total":50}],
  "shared_train_participants": null,
  "level": 1,
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "expires_at": "2020-07-15T17:16:11.17106713Z",
  "is_shared_train": false,
  "type": "regular"
}
```

## channel.hype_train.end v2

A Hype Train ends on the specified channel. · scopes: `channel:read:hype_train` · condition: `broadcaster_user_id`

- ⚠ Has `ended_at` and `cooldown_ends_at` (next train possible).

**Event fields**

- `id` *string* — The Hype Train ID.
- `broadcaster_user_id` *string* — The requested broadcaster ID.
- `broadcaster_user_login` *string* — The requested broadcaster login.
- `broadcaster_user_name` *string* — The requested broadcaster display name.
- `total` *integer* — Total points contributed to the Hype Train.
- `top_contributions` *object[]* — The contributors with the most points contributed.
  - `user_id` *string* — The ID of the user that made the contribution.
  - `user_login` *string* — The user’s login name.
  - `user_name` *string* — The user’s display name.
  - `type` *string* — The contribution method used. Possible values are: • bits - Bits contributions with Cheering, Power-ups, and Extensions.
  - `total` *integer* — The total amount contributed.
- `level` *integer* — The current level of the Hype Train.
- `shared_train_participants` *object[]* — Optional. Non-null for a shared Hype Train.
  - `broadcaster_user_id` *string* — The ID of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_login` *string* — The login of the broadcaster participating in the shared Hype Train.
  - `broadcaster_user_name` *string* — The display name of the broadcaster participating in the shared Hype Train.
- `started_at` *string* — The time when the Hype Train started.
- `cooldown_ends_at` *string* — The time when the Hype Train cooldown ends so that the next Hype Train can start.
- `ended_at` *string* — The time when the Hype Train ended.
- `type` *string* — The type of the Hype Train. Possible values are: • treasure • golden_kappa • regular
- `is_shared_train` *boolean* — Indicates if the Hype Train is shared.

```json
{
  "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "total": 137,
  "top_contributions": [{"user_id":"123","user_login":"pogchamp","user_name":"PogChamp","type":"bits","total":50}],
  "shared_train_participants": null,
  "level": 1,
  "started_at": "2020-07-15T17:16:03.17106713Z",
  "ended_at": "2020-07-15T17:16:11.17106713Z",
  "cooldown_ends_at": "2020-07-16T17:16:11.17106713Z",
  "is_shared_train": false,
  "type": "regular"
}
```

## stream.online v1

The specified broadcaster starts a stream. · scopes: none · condition: `broadcaster_user_id`

- ⚠ No authorization required (cost 1 unless the broadcaster authorized your app). `type` can be `live`, `playlist`, `watch_party`, `premiere`, `rerun` — filter to `live` for "going live" pings.

**Event fields**

- `id` *string* — The id of the stream.
- `broadcaster_user_id` *string* — The broadcaster’s user id.
- `broadcaster_user_login` *string* — The broadcaster’s user login.
- `broadcaster_user_name` *string* — The broadcaster’s user display name.
- `type` *string* — The stream type. Valid values are: `live`, `playlist`, `watch_party`, `premiere`, `rerun`.
- `started_at` *string* — The timestamp at which the stream went online at.

```json
{
  "id": "9001",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "type": "live",
  "started_at": "2020-10-11T10:11:12.123Z"
}
```

## stream.offline v1

The specified broadcaster stops a stream. · scopes: none · condition: `broadcaster_user_id`

- ⚠ `id` (stream id) was added on 2026-06-26; older examples omit it.

**Event fields**

- `id` *string* — The id of the stream.
- `broadcaster_user_id` *string* — The broadcaster’s user id.
- `broadcaster_user_login` *string* — The broadcaster’s user login.
- `broadcaster_user_name` *string* — The broadcaster’s user display name.

```json
{
  "id": "9001",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User"
}
```

## channel.update v2

A broadcaster updates their channel properties e.g., category, title, content classification labels, broadcast, or language. · scopes: none · condition: `broadcaster_user_id`

- ⚠ No authorization required. v2 replaced `is_mature` with `content_classification_labels` (array of label IDs).

**Event fields**

- `broadcaster_user_id` *string* — The broadcaster’s user ID.
- `broadcaster_user_login` *string* — The broadcaster’s user login.
- `broadcaster_user_name` *string* — The broadcaster’s user display name.
- `title` *string* — The channel’s stream title.
- `language` *string* — The channel’s broadcast language.
- `category_id` *string* — The channel’s category ID.
- `category_name` *string* — The category name.
- `content_classification_labels` *string[]* — Array of content classification label IDs currently applied on the Channel.

```json
{
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "title": "Best Stream Ever",
  "language": "en",
  "category_id": "12453",
  "category_name": "Grand Theft Auto",
  "content_classification_labels": ["MatureGame"]
}
```

## channel.chat.message v1

Any user sends a message to a specific chat room. · scopes: `user:read:chat` / `user:bot` / `channel:bot` · condition: `broadcaster_user_id`, `user_id`

- ⚠ Condition `user_id` is the user whose chat you READ AS (your bot / the logged-in user), not the chatter. That user needs `user:read:chat`; with an app token (webhook/conduit) also `user:bot`, plus the broadcaster's `channel:bot` or the bot being a moderator. See the twitch-chat skill for bots.
- ⚠ Fires for every message in the channel, including ones your own bot sends — ignore `chatter_user_id === botUserId` to avoid command loops.
- ⚠ Fragment `type`: `text`, `cheermote`, `emote`, `mention`, `gif` (gif added 2026-07-16; reference lists `gif.id` + `gif.url`, the change-log text says `gif_id` — read both defensively). Render from `message.fragments`, not by re-parsing `message.text`.
- ⚠ Shared chat: `source_broadcaster_user_id` / `source_message_id` / `source_badges` are non-null when the message came from another channel in the session; `is_source_only` marks messages kept in the source channel.
- ⚠ Not triggerable by Twitch CLI v1.1.24 — use the fixture in references/testing.md.

**Event fields**

- `broadcaster_user_id` *string* — The broadcaster user ID.
- `broadcaster_user_name` *string* — The broadcaster display name.
- `broadcaster_user_login` *string* — The broadcaster login.
- `chatter_user_id` *string* — The user ID of the user that sent the message.
- `chatter_user_name` *string* — The user name of the user that sent the message.
- `chatter_user_login` *string* — The user login of the user that sent the message.
- `message_id` *string* — A UUID that identifies the message.
- `message` *object* — The structured chat message.
  - `text` *string* — The chat message in plain text.
  - `fragments` *object[]* — Ordered list of chat message fragments.
    - `type` *string* — The type of message fragment. Possible values: • text • cheermote • emote • mention • gif
    - `text` *string* — Message text in fragment.
    - `cheermote` *object* — Optional. Metadata pertaining to the cheermote.
      - `prefix` *string* — The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase.
      - `bits` *int* — The amount of Bits cheered.
      - `tier` *int* — The tier level of the cheermote.
    - `emote` *object* — Optional. Metadata pertaining to the emote.
      - `id` *string* — An ID that uniquely identifies this emote.
      - `emote_set_id` *string* — An ID that identifies the emote set that the emote belongs to.
      - `owner_id` *string* — The ID of the broadcaster who owns the emote.
      - `format` *string[]* — The formats that the emote is available in.
    - `mention` *object* — Optional. Metadata pertaining to the mention.
      - `user_id` *string* — The user ID of the mentioned user.
      - `user_name` *string* — The user name of the mentioned user.
      - `user_login` *string* — The user login of the mentioned user.
    - `gif` *object* — Optional. Metadata pertaining to the GIF.
      - `id` *string* — An ID that uniquely identifies this GIF.
      - `url` *string* — The URL of the GIF asset.
- `message_type` *string* — The type of message. Possible values: • text • channel_points_highlighted • channel_points_sub_only • user_intro • power_ups_message_effect • power_ups_gigantified_emote
- `badges` *object[]* — List of chat badges.
  - `set_id` *string* — An ID that identifies this set of chat badges.
  - `id` *string* — An ID that identifies this version of the badge.
  - `info` *string* — Contains metadata related to the chat badges in the badges tag.
- `cheer` *object* — Optional. Metadata if this message is a cheer.
  - `bits` *int* — The amount of Bits the user cheered.
- `color` *string* — The color of the user’s name in the chat room.
- `reply` *object* — Optional. Metadata if this message is a reply.
  - `parent_message_id` *string* — An ID that uniquely identifies the parent message that this message is replying to.
  - `parent_message_body` *string* — The message body of the parent message.
  - `parent_user_id` *string* — User ID of the sender of the parent message.
  - `parent_user_name` *string* — User name of the sender of the parent message.
  - `parent_user_login` *string* — User login of the sender of the parent message.
  - `thread_message_id` *string* — An ID that identifies the parent message of the reply thread.
  - `thread_user_id` *string* — User ID of the sender of the thread’s parent message.
  - `thread_user_name` *string* — User name of the sender of the thread’s parent message.
  - `thread_user_login` *string* — User login of the sender of the thread’s parent message.
- `channel_points_custom_reward_id` *string* — Optional. The ID of a channel points custom reward that was redeemed.
- `source_broadcaster_user_id` *string* — Optional. The broadcaster user ID of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_broadcaster_user_name` *string* — Optional. The user name of the broadcaster of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_broadcaster_user_login` *string* — Optional. The login of the broadcaster of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_message_id` *string* — Optional. The UUID that identifies the source message from the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_badges` *object* — Optional. The list of chat badges for the chatter in the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
  - `set_id` *string* — The ID that identifies this set of chat badges.
  - `id` *string* — The ID that identifies this version of the badge.
  - `info` *string* — Contains metadata related to the chat badges in the badges tag.
- `is_source_only` *bool* — Optional. Determines if a message delivered during a shared chat session is only sent to the source channel.

```json
{
  "broadcaster_user_id": "1971641",
  "broadcaster_user_login": "streamer",
  "broadcaster_user_name": "streamer",
  "chatter_user_id": "4145994",
  "chatter_user_login": "viewer32",
  "chatter_user_name": "viewer32",
  "message_id": "cc106a89-1814-919d-454c-f4f2f970aae7",
  "message": {
    "text": "Hi chat",
    "fragments": [{"type":"text","text":"Hi chat","cheermote":null,"emote":null,"mention":null}]
  },
  "color": "#00FF7F",
  "badges": [
    {"set_id":"moderator","id":"1","info":""},
    {"set_id":"subscriber","id":"12","info":"16"},
    {"set_id":"sub-gifter","id":"1","info":""}
  ],
  "message_type": "text",
  "cheer": null,
  "reply": null,
  "channel_points_custom_reward_id": null,
  "source_broadcaster_user_id": null,
  "source_broadcaster_user_login": null,
  "source_broadcaster_user_name": null,
  "source_message_id": null,
  "source_badges": null
}
```

## channel.chat.notification v1

A notification for when an event that appears in chat has occurred. · scopes: `user:read:chat` / `user:bot` / `channel:bot` · condition: `broadcaster_user_id`, `user_id`

- ⚠ One subscription covers everything that renders as a chat notice. Switch on `notice_type`; exactly the matching object (`sub`, `resub`, `sub_gift`, `community_sub_gift`, `gift_paid_upgrade`, `prime_paid_upgrade`, `raid`, `unraid`, `pay_it_forward`, `announcement`, `bits_badge_tier`, `charity_donation`, `watch_streak`, `modiversary`, `gifted_drops_summary`, and `shared_chat_*` twins) is non-null.
- ⚠ Only needs chat-read authorization (`user:read:chat` for the reading user) — no `channel:read:subscriptions` from the broadcaster — so it is the easiest way for a chat bot to see subs/resubs. Values are as displayed in chat (e.g. `system_message`).
- ⚠ `watch_streak` (2026-04-02) and `modiversary` (2026-06-12), `gifted_drops_summary` (2026-10-01) are recent additions; always keep an `unknown`/default branch.
- ⚠ The doc example below still shows the pre-2023 name `sub_plan` inside `resub`; the field is `sub_tier` (renamed 2023-11-07 per the change log). Trust the field list.

**Event fields**

- `broadcaster_user_id` *string* — The broadcaster user ID.
- `broadcaster_user_name` *string* — The broadcaster display name.
- `broadcaster_user_login` *string* — The broadcaster login.
- `chatter_user_id` *string* — The user ID of the user that sent the message.
- `chatter_user_name` *string* — The user login of the user that sent the message.
- `chatter_is_anonymous` *bool* — Whether or not the chatter is anonymous.
- `color` *string* — The color of the user’s name in the chat room.
- `badges` *object[]* — The color of the user’s name in the chat room.
  - `set_id` *string* — An ID that identifies this set of chat badges.
  - `id` *string* — An ID that identifies this version of the badge.
  - `info` *string* — Contains metadata related to the chat badges in the badges tag.
- `system_message` *string* — The message Twitch shows in the chat room for this notice.
- `message_id` *string* — A UUID that identifies the message.
- `message` *object* — The structured chat message.
  - `text` *string* — The chat message in plain text.
  - `fragments` *object[]* — Ordered list of chat message fragments.
    - `type` *string* — The type of message fragment. Possible values: • text • cheermote • emote • mention
    - `text` *string* — Message text in fragment.
    - `cheermote` *object* — Optional. Metadata pertaining to the cheermote.
      - `prefix` *string* — The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase.
      - `bits` *int* — The amount of Bits cheered.
      - `tier` *int* — The tier level of the cheermote.
    - `emote` *object* — Optional. Metadata pertaining to the emote.
      - `id` *string* — An ID that uniquely identifies this emote.
      - `emote_set_id` *string* — An ID that identifies the emote set that the emote belongs to.
      - `owner_id` *string* — The ID of the broadcaster who owns the emote.
      - `format` *string[]* — The formats that the emote is available in.
    - `mention` *object* — Optional. Metadata pertaining to the mention.
      - `user_id` *string* — The user ID of the mentioned user.
      - `user_name` *string* — The user name of the mentioned user.
      - `user_login` *string* — The user login of the mentioned user.
- `notice_type` *string* — The type of notice. Possible values are: • sub • resub • sub_gift • community_sub_gift • gift_paid_upgrade • prime_paid_upgrade • raid • unraid • pay_it_forward • announcement • bits_badge_tier • charity_donation • watch_streak • modiversary • gifted_drops_summary • shared_chat_sub • shared_chat_resub • shared_chat_sub_gift • shared_chat_community_sub_gift • shared_chat_gift_paid_upgrade • shar…
- `sub` *object* — Information about the sub event. Null if `notice_type` is not `sub`.
  - `sub_tier` *string* — The type of subscription plan being used. Possible values are: • 1000 - First level of paid or Prime subscription.
  - `is_prime` *bool* — Indicates if the subscription was obtained through Amazon Prime.
  - `duration_months` *int* — The number of months the subscription is for.
- `resub` *object* — Information about the resub event. Null if `notice_type` is not `resub`.
  - `cumulative_months` *int* — The total number of months the user has subscribed.
  - `duration_months` *int* — The number of months the subscription is for.
  - `streak_months` *int* — The total number of months the user has subscribed.
  - `sub_tier` *string* — The type of subscription plan being used. Possible values are: • 1000 - First level of paid or Prime subscription.
  - `is_prime` *bool* — Optional. Whether or not this subscription is a Prime subscription.
  - `is_gift` *bool* — Whether or not the resub was a result of a gift.
  - `gifter_is_anonymous` *bool* — Optional. Whether or not the gift was anonymous.
  - `gifter_user_id` *string* — The user ID of the subscription gifter. Null if anonymous.
  - `gifter_user_name` *string* — The user name of the subscription gifter. Null if anonymous.
  - `gifter_user_login` *string* — Optional. The user login of the subscription gifter. Null if anonymous.
- `sub_gift` *object* — Information about the gift sub event. Null if notice_type is not sub_gift.
  - `duration_months` *int* — The number of months the subscription is for.
  - `cumulative_total` *int* — Optional. The amount of gifts the gifter has given in this channel. Null if anonymous.
  - `recipient_user_id` *string* — The user ID of the subscription gift recipient.
  - `recipient_user_name` *string* — The user name of the subscription gift recipient.
  - `recipient_user_login` *string* — The user login of the subscription gift recipient.
  - `sub_tier` *string* — The type of subscription plan being used. Possible values are: • 1000 - First level of paid or Prime subscription.
  - `community_gift_id` *string* — Optional. The ID of the associated community gift. Null if not associated with a community gift.
- `community_sub_gift` *object* — Information about the community gift sub event. Null if `notice_type` is not `community_sub_gift`.
  - `id` *string* — The ID of the associated community gift.
  - `total` *int* — Number of subscriptions being gifted.
  - `sub_tier` *string* — The type of subscription plan being used. Possible values are: • 1000 - First level of paid or Prime subscription.
  - `cumulative_total` *int* — Optional. The amount of gifts the gifter has given in this channel. Null if anonymous.
- `gift_paid_upgrade` *object* — Information about the community gift paid upgrade event. Null if `notice_type` is not `gift_paid_upgrade`.
  - `gifter_is_anonymous` *bool* — Whether the gift was given anonymously.
  - `gifter_user_id` *string* — Optional. The user ID of the user who gifted the subscription. Null if anonymous.
  - `gifter_user_name` *string* — Optional. The user name of the user who gifted the subscription. Null if anonymous.
- `prime_paid_upgrade` *object* — Information about the Prime gift paid upgrade event. Null if `notice_type` is not `prime_paid_upgrade`
  - `sub_tier` *string* — The type of subscription plan being used. Possible values are: • 1000 - First level of paid or Prime subscription.
- `pay_it_forward` *object* — Information about the pay it forward event. Null if `notice_type` is not `pay_it_forward`
  - `gifter_is_anonymous` *bool* — Whether the gift was given anonymously.
  - `gifter_user_id` *string* — The user ID of the user who gifted the subscription. Null if anonymous.
  - `gifter_user_name` *string* — Optional. The user name of the user who gifted the subscription. Null if anonymous.
  - `gifter_user_login` *string* — The user login of the user who gifted the subscription. Null if anonymous.
- `raid` *object* — Information about the raid event. Null if `notice_type` is not `raid`
  - `user_id` *string* — The user ID of the broadcaster raiding this channel.
  - `user_name` *string* — The user name of the broadcaster raiding this channel.
  - `user_login` *string* — The login name of the broadcaster raiding this channel.
  - `viewer_count` *int* — The number of viewers raiding this channel from the broadcaster’s channel.
  - `profile_image_url` *string* — Profile image URL of the broadcaster raiding this channel.
- `unraid` *object* — Returns an empty payload if `notice_type` is not `unraid`, otherwise returns null.
- `announcement` *object* — Information about the announcement event. Null if `notice_type` is not `announcement`
  - `color` *string* — Color of the announcement.
- `bits_badge_tier` *object* — Information about the Bits badge tier event. Null if `notice_type` is not `bits_badge_tier`
  - `tier` *int* — The tier of the Bits badge the user just earned.
- `charity_donation` *string* — Information about the announcement event. Null if `notice_type` is not `charity_donation`
  - `charity_name` *string* — Name of the charity.
  - `amount` *object* — An object that contains the amount of money that the user paid.
    - `value` *int* — The monetary amount.
    - `decimal_place` *int* — The number of decimal places used by the currency.
    - `currency` *string* — The ISO-4217 three-letter currency code that identifies the type of currency in value.
- `watch_streak` *object* — Information about the Watch Streak event. Null if `notice_type` is not `watch_streak`.
  - `streak_count` *int* — The number of consecutive broadcasts for which the user has been watching.
  - `channel_points_awarded` *int* — The number of channel points awarded for the Watch Streak milestone.
- `modiversary` *object* — Information about the modiversary event. Null if `notice_type` is not `modiversary`.
  - `months` *int* — The number of months the user has been a moderator in this channel.
- `gifted_drops_summary` *object* — Information about the gifted Drops summary event. Null if `notice_type` is not `gifted_drops_summary`.
  - `recipient_count` *int* — The number of users who received a gifted Drop.
- `source_broadcaster_user_id` *string* — Optional. The broadcaster user ID of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_broadcaster_user_name` *string* — Optional. The user name of the broadcaster of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_broadcaster_user_login` *string* — Optional. The login of the broadcaster of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_message_id` *string* — Optional. The UUID that identifies the source message from the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
- `source_badges` *object* — Optional. The list of chat badges for the chatter in the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster.
  - `set_id` *string* — The ID that identifies this set of chat badges.
  - `id` *string* — The ID that identifies this version of the badge.
  - `info` *string* — Contains metadata related to the chat badges in the badges tag.
- `is_source_only` *bool* — Optional. Whether the notification is only sent to the source channel. Is `null` if the notification is not in a shared chat session.
- `shared_chat_sub` *object* — Optional. Information about the `shared_chat_sub` event. Is null if `notice_type` is not `shared_chat_sub`.
- `shared_chat_resub` *object* — Optional. Information about the `shared_chat_resub` event. Is null if `notice_type` is not `shared_chat_resub`.
- `shared_chat_sub_gift` *object* — Optional. Information about the `shared_chat_sub_gift` event. Is null if `notice_type` is not `shared_chat_sub_gift`.
- `shared_chat_community_sub_gift` *object* — Optional. Information about the `shared_chat_community_sub_gift` event. Is null if `notice_type` is not `shared_chat_community_sub_gift`.
- `shared_chat_gift_paid_upgrade` *object* — Optional. Information about the `shared_chat_gift_paid_upgrade` event. Is null if `notice_type` is not `shared_chat_gift_paid_upgrade`.
- `shared_chat_prime_paid_upgrade` *object* — Optional. Information about the `shared_chat_chat_prime_paid_upgrade` event. Is null if `notice_type` is not `shared_chat_prime_paid_upgrade`.
- `shared_chat_pay_it_forward` *object* — Optional. Information about the `shared_chat_pay_it_forward` event. Is null if `notice_type` is not `shared_chat_pay_it_forward`.
- `shared_chat_raid` *object* — Optional. Information about the `shared_chat_raid` event. Is null if `notice_type` is not `shared_chat_raid`.
- `shared_chat_announcement` *object* — Optional. Information about the `shared_chat_announcement` event. Is null if `notice_type` is not `shared_chat_announcement`.
- `shared_chat_modiversary` *object* — Optional. Information about the `shared_chat_modiversary` event. Is null if `notice_type` is not `shared_chat_modiversary`.
- `shared_chat_gifted_drops_summary` *object* — Optional. Information about the `shared_chat_gifted_drops_summary` event. Is null if `notice_type` is not `shared_chat_gifted_drops_summary`.

```json
{
  "broadcaster_user_id": "1971641",
  "broadcaster_user_login": "streamer",
  "broadcaster_user_name": "streamer",
  "chatter_user_id": "49912639",
  "chatter_user_login": "viewer23",
  "chatter_user_name": "viewer23",
  "chatter_is_anonymous": false,
  "color": "",
  "badges": [],
  "system_message": "viewer23 subscribed at Tier 1. They've subscribed for 10 months!",
  "message_id": "d62235c8-47ff-a4f4--84e8-5a29a65a9c03",
  "message": {"text":"","fragments":[]},
  "notice_type": "resub",
  "sub": null,
  "resub": {
    "cumulative_months": 10,
    "duration_months": 0,
    "streak_months": null,
    "sub_plan": "1000",
    "is_gift": false,
    "gifter_is_anonymous": null,
    "gifter_user_id": null,
    "gifter_user_name": null,
    "gifter_user_login": null
  },
  "sub_gift": null,
  "community_sub_gift": null,
  "gift_paid_upgrade": null,
  "prime_paid_upgrade": null,
  "pay_it_forward": null,
  "raid": null,
  "unraid": null,
  "announcement": null,
  "bits_badge_tier": null,
  "charity_donation": null,
  "watch_streak": null,
  "modiversary": null,
  "gifted_drops_summary": null,
  "shared_chat_sub": null,
  "shared_chat_resub": null,
  "shared_chat_sub_gift": null,
  "shared_chat_community_sub_gift": null,
  "shared_chat_gift_paid_upgrade": null,
  "shared_chat_prime_paid_upgrade": null,
  "shared_chat_pay_it_forward": null,
  "shared_chat_raid": null,
  "shared_chat_announcement": null,
  "shared_chat_modiversary": null,
  "shared_chat_gifted_drops_summary": null,
  "source_broadcaster_user_id": null,
  "source_broadcaster_user_login": null,
  "source_broadcaster_user_name": null,
  "source_message_id": null,
  "source_badges": null,
  "is_source_only": null
}
```

## channel.ad_break.begin v1

A midroll commercial break has started running. · scopes: `channel:read:ads` · condition: `broadcaster_user_id`

- ⚠ Scope `channel:read:ads`. `duration_seconds` + `started_at` give the countdown; `is_automatic` true when scheduled by Ads Manager. There may be delay between the event and viewers seeing ads.

**Event fields**

- `duration_seconds` *integer* — Length in seconds of the mid-roll ad break requested
- `started_at` *string* — The UTC timestamp of when the ad break began, in RFC3339 format.
- `is_automatic` *boolean* — Indicates if the ad was automatically scheduled via Ads Manager
- `broadcaster_user_id` *string* — The broadcaster’s user ID for the channel the ad was run on.
- `broadcaster_user_login` *string* — The broadcaster’s user login for the channel the ad was run on.
- `broadcaster_user_name` *string* — The broadcaster’s user display name for the channel the ad was run on.
- `requester_user_id` *string* — The ID of the user that requested the ad.
- `requester_user_login` *string* — The login of the user that requested the ad.
- `requester_user_name` *string* — The display name of the user that requested the ad.

```json
{
  "duration_seconds": "60",
  "started_at": "2019-11-16T10:11:12.634234626Z",
  "is_automatic": "false",
  "broadcaster_user_id": "1337",
  "broadcaster_user_login": "cool_user",
  "broadcaster_user_name": "Cool_User",
  "requester_user_id": "1337",
  "requester_user_login": "cool_user",
  "requester_user_name": "Cool_User"
}
```

## channel.goal.begin v1

Get notified when a broadcaster begins a goal. · scopes: `channel:read:goals` · condition: `broadcaster_user_id`

- ⚠ Scope `channel:read:goals`. Same event shape for begin/progress/end; `type`: `follow`, `subscription`, `subscription_count`, `new_subscription`, `new_subscription_count`, `new_bit`, `new_cheerer`.

**Event fields**

- `id` *string* — An ID that identifies this event.
- `broadcaster_user_id` *string* — An ID that uniquely identifies the broadcaster.
- `broadcaster_user_name` *string* — The broadcaster’s display name.
- `broadcaster_user_login` *string* — The broadcaster’s user handle.
- `type` *string* — The type of goal. Possible values are: • follow — The goal is to increase followers.
- `description` *string* — A description of the goal, if specified.
- `is_achieved` *Boolean* — A Boolean value that indicates whether the broadcaster achieved their goal.
- `current_amount` *integer* — The goal’s current value.
- `target_amount` *integer* — The goal’s target value.
- `started_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster created the goal.
- `ended_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster ended the goal.

```json
{
  "id": "12345-cool-event",
  "broadcaster_user_id": "141981764",
  "broadcaster_user_name": "TwitchDev",
  "broadcaster_user_login": "twitchdev",
  "type": "subscription",
  "description": "Help me get partner!",
  "current_amount": 100,
  "target_amount": 220,
  "started_at": "2021-07-15T17:16:03.17106713Z"
}
```

## channel.goal.progress v1

Get notified when progress (either positive or negative) is made towards a broadcaster’s goal. · scopes: `channel:read:goals` · condition: `broadcaster_user_id`

- ⚠ Progress can be negative (lost followers). Progress may arrive before begin.

**Event fields**

- `id` *string* — An ID that identifies this event.
- `broadcaster_user_id` *string* — An ID that uniquely identifies the broadcaster.
- `broadcaster_user_name` *string* — The broadcaster’s display name.
- `broadcaster_user_login` *string* — The broadcaster’s user handle.
- `type` *string* — The type of goal. Possible values are: • follow — The goal is to increase followers.
- `description` *string* — A description of the goal, if specified.
- `is_achieved` *Boolean* — A Boolean value that indicates whether the broadcaster achieved their goal.
- `current_amount` *integer* — The goal’s current value.
- `target_amount` *integer* — The goal’s target value.
- `started_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster created the goal.
- `ended_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster ended the goal.

```json
{
  "id": "12345-cool-event",
  "broadcaster_user_id": "141981764",
  "broadcaster_user_name": "TwitchDev",
  "broadcaster_user_login": "twitchdev",
  "type": "subscription",
  "description": "Help me get partner!",
  "current_amount": 120,
  "target_amount": 220,
  "started_at": "2021-07-15T17:16:03.17106713Z"
}
```

## channel.goal.end v1

Get notified when a broadcaster ends a goal. · scopes: `channel:read:goals` · condition: `broadcaster_user_id`

- ⚠ Only end carries meaningful `is_achieved` and `ended_at`.

**Event fields**

- `id` *string* — An ID that identifies this event.
- `broadcaster_user_id` *string* — An ID that uniquely identifies the broadcaster.
- `broadcaster_user_name` *string* — The broadcaster’s display name.
- `broadcaster_user_login` *string* — The broadcaster’s user handle.
- `type` *string* — The type of goal. Possible values are: • follow — The goal is to increase followers.
- `description` *string* — A description of the goal, if specified.
- `is_achieved` *Boolean* — A Boolean value that indicates whether the broadcaster achieved their goal.
- `current_amount` *integer* — The goal’s current value.
- `target_amount` *integer* — The goal’s target value.
- `started_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster created the goal.
- `ended_at` *string* — The UTC timestamp in RFC 3339 format, which indicates when the broadcaster ended the goal.

```json
{
  "id": "12345-abc-678-defgh",
  "broadcaster_user_id": "141981764",
  "broadcaster_user_name": "TwitchDev",
  "broadcaster_user_login": "twitchdev",
  "type": "subscription",
  "description": "Help me get partner!",
  "is_achieved": false,
  "current_amount": 180,
  "target_amount": 220,
  "started_at": "2021-07-15T17:16:03.17106713Z",
  "ended_at": "2020-07-16T17:16:03.17106713Z"
}
```

## channel.shoutout.create v1

Sends a notification when the specified broadcaster sends a Shoutout. · scopes: `moderator:read:shoutouts` / `moderator:manage:shoutouts` · condition: `broadcaster_user_id`, `moderator_user_id`

- ⚠ Scope `moderator:read:shoutouts` or `moderator:manage:shoutouts`; condition needs `moderator_user_id`. `cooldown_ends_at` / `target_cooldown_ends_at` tell you when the next Shoutout is allowed.

**Event fields**

- `broadcaster_user_id` *String* — An ID that identifies the broadcaster that sent the Shoutout.
- `broadcaster_user_login` *String* — The broadcaster’s login name.
- `broadcaster_user_name` *String* — The broadcaster’s display name.
- `to_broadcaster_user_id` *String* — An ID that identifies the broadcaster that received the Shoutout.
- `to_broadcaster_user_login` *String* — The broadcaster’s login name.
- `to_broadcaster_user_name` *String* — The broadcaster’s display name.
- `moderator_user_id` *String* — An ID that identifies the moderator that sent the Shoutout.
- `moderator_user_login` *String* — The moderator’s login name.
- `moderator_user_name` *String* — The moderator’s display name.
- `viewer_count` *Integer* — The number of users that were watching the broadcaster’s stream at the time of the Shoutout.
- `started_at` *String* — The UTC timestamp (in RFC3339 format) of when the moderator sent the Shoutout.
- `cooldown_ends_at` *String* — The UTC timestamp (in RFC3339 format) of when the broadcaster may send a Shoutout to a different broadcaster.
- `target_cooldown_ends_at` *String* — The UTC timestamp (in RFC3339 format) of when the broadcaster may send another Shoutout to the broadcaster in `to_broadcaster_user_id`.

```json
{
  "broadcaster_user_id": "12345",
  "broadcaster_user_name": "SimplySimple",
  "broadcaster_user_login": "simplysimple",
  "moderator_user_id": "98765",
  "moderator_user_name": "ParticularlyParticular123",
  "moderator_user_login": "particularlyparticular123",
  "to_broadcaster_user_id": "626262",
  "to_broadcaster_user_name": "SandySanderman",
  "to_broadcaster_user_login": "sandysanderman",
  "started_at": "2022-07-26T17:00:03.17106713Z",
  "viewer_count": 860,
  "cooldown_ends_at": "2022-07-26T17:02:03.17106713Z",
  "target_cooldown_ends_at": "2022-07-26T18:00:03.17106713Z"
}
```

## channel.shoutout.receive v1

Sends a notification when the specified broadcaster receives a Shoutout. · scopes: `moderator:read:shoutouts` / `moderator:manage:shoutouts` · condition: `broadcaster_user_id`, `moderator_user_id`

- ⚠ Sent only if Twitch posts the Shoutout to the broadcaster's activity feed.

**Event fields**

- `broadcaster_user_id` *String* — An ID that identifies the broadcaster that received the Shoutout.
- `broadcaster_user_login` *String* — The broadcaster’s login name.
- `broadcaster_user_name` *String* — The broadcaster’s display name.
- `from_broadcaster_user_id` *String* — An ID that identifies the broadcaster that sent the Shoutout.
- `from_broadcaster_user_login` *String* — The broadcaster’s login name.
- `from_broadcaster_user_name` *String* — The broadcaster’s display name.
- `viewer_count` *Integer* — The number of users that were watching the from-broadcaster’s stream at the time of the Shoutout.
- `started_at` *String* — The UTC timestamp (in RFC3339 format) of when the moderator sent the Shoutout.

```json
{
  "broadcaster_user_id": "626262",
  "broadcaster_user_name": "SandySanderman",
  "broadcaster_user_login": "sandysanderman",
  "from_broadcaster_user_id": "12345",
  "from_broadcaster_user_name": "SimplySimple",
  "from_broadcaster_user_login": "simplysimple",
  "viewer_count": 860,
  "started_at": "2022-07-26T17:00:03.17106713Z"
}
```
