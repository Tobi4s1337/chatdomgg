<!-- source: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ -->

Contents

# Subscription Types  {#subscription-types}

| Subscription Type | Name | Version | Description |
|---|---|---|---|
| Automod Message Hold | `automod.message.hold` | `1` | A user is notified if a message is caught by automod for review. |
| Automod Message Hold V2 | `automod.message.hold` | `2` | A user is notified if a message is caught by automod for review. Only public blocked terms trigger notifications, not private ones. |
| Automod Message Update | `automod.message.update` | `1` | A message in the automod queue had its status changed. |
| Automod Message Update V2 | `automod.message.update` | `2` | A message in the automod queue had its status changed. Only public blocked terms trigger notifications, not private ones. |
| Automod Settings Update | `automod.settings.update` | `1` | A notification is sent when a broadcaster’s automod settings are updated. |
| Automod Terms Update | `automod.terms.update` | `1` | A notification is sent when a broadcaster’s automod terms are updated. Changes to private terms are not sent. |
| Channel Bits Use NEW | `channel.bits.use` | `1` | A notification is sent whenever Bits are used on a channel. |
| Channel Update | `channel.update` | `2` | A broadcaster updates their channel properties e.g., category, title, content classification labels, broadcast, or language. |
| Channel Follow | `channel.follow` | `2` | A specified channel receives a follow. |
| Channel Ad Break Begin | `channel.ad_break.begin` | `1` | A midroll commercial break has started running. |
| Channel Chat Clear | `channel.chat.clear` | `1` | A moderator or bot has cleared all messages from the chat room. |
| Channel Chat Clear User Messages | `channel.chat.clear_user_messages` | `1` | A moderator or bot has cleared all messages from a specific user. |
| Channel Chat Message | `channel.chat.message` | `1` | Any user sends a message to a specific chat room. |
| Channel Chat Message Delete | `channel.chat.message_delete` | `1` | A moderator has removed a specific message. |
| Channel Chat Notification | `channel.chat.notification` | `1` | A notification for when an event that appears in chat has occurred. |
| Channel Chat Settings Update | `channel.chat_settings.update` | `1` | A notification for when a broadcaster’s chat settings are updated. |
| Channel Chat User Message Hold | `channel.chat.user_message_hold` | `1` | A user is notified if their message is caught by automod. |
| Channel Chat User Message Update | `channel.chat.user_message_update` | `1` | A user is notified if their message’s automod status is updated. |
| Channel Shared Chat Session Begin | `channel.shared_chat.begin` | `1` | A notification when a channel becomes active in an active shared chat session. |
| Channel Shared Chat Session Update | `channel.shared_chat.update` | `1` | A notification when the active shared chat session the channel is in changes. |
| Channel Shared Chat Session End | `channel.shared_chat.end` | `1` | A notification when a channel leaves a shared chat session or the session ends. |
| Channel Subscribe | `channel.subscribe` | `1` | A notification is sent when a specified channel receives a subscriber. This does not include resubscribes. |
| Channel Subscription End | `channel.subscription.end` | `1` | A notification when a subscription to the specified channel ends. |
| Channel Subscription Gift | `channel.subscription.gift` | `1` | A notification when a viewer gives a gift subscription to one or more users in the specified channel. |
| Channel Subscription Message | `channel.subscription.message` | `1` | A notification when a user sends a resubscription chat message in a specific channel. |
| Channel Cheer | `channel.cheer` | `1` | A user cheers on the specified channel. |
| Channel Raid | `channel.raid` | `1` | A broadcaster raids another broadcaster’s channel. |
| Channel Ban | `channel.ban` | `1` | A viewer is banned from the specified channel. |
| Channel Unban | `channel.unban` | `1` | A viewer is unbanned from the specified channel. |
| Channel Unban Request Create | `channel.unban_request.create` | `1` | A user creates an unban request. |
| Channel Unban Request Resolve | `channel.unban_request.resolve` | `1` | An unban request has been resolved. |
| Channel Moderate | `channel.moderate` | `1` | A moderator performs a moderation action in a channel. |
| Channel Moderate V2 | `channel.moderate` | `2` | A moderator performs a moderation action in a channel. Includes warnings. |
| Channel Moderator Add | `channel.moderator.add` | `1` | Moderator privileges were added to a user on a specified channel. |
| Channel Moderator Remove | `channel.moderator.remove` | `1` | Moderator privileges were removed from a user on a specified channel. |
| Channel Guest Star Session Begin BETA | `channel.guest_star_session.begin` | `beta` | The host began a new Guest Star session. |
| Channel Guest Star Session End BETA | `channel.guest_star_session.end` | `beta` | A running Guest Star session has ended. |
| Channel Guest Star Guest Update BETA | `channel.guest_star_guest.update` | `beta` | A guest or a slot is updated in an active Guest Star session. |
| Channel Guest Star Settings Update BETA | `channel.guest_star_settings.update` | `beta` | The host preferences for Guest Star have been updated. |
| Channel Points Automatic Reward Redemption Add | `channel.channel_points_automatic_reward_redemption.add` | `1` | A viewer has redeemed an automatic channel points reward on the specified channel. |
| Channel Points Automatic Reward Redemption Add V2 | `channel.channel_points_automatic_reward_redemption.add` | `2` | A viewer has redeemed an automatic channel points reward on the specified channel. |
| Channel Points Custom Reward Add | `channel.channel_points_custom_reward.add` | `1` | A custom channel points reward has been created for the specified channel. |
| Channel Points Custom Reward Update | `channel.channel_points_custom_reward.update` | `1` | A custom channel points reward has been updated for the specified channel. |
| Channel Points Custom Reward Remove | `channel.channel_points_custom_reward.remove` | `1` | A custom channel points reward has been removed from the specified channel. |
| Channel Points Custom Reward Redemption Add | `channel.channel_points_custom_reward_redemption.add` | `1` | A viewer has redeemed a custom channel points reward on the specified channel. |
| Channel Points Custom Reward Redemption Update | `channel.channel_points_custom_reward_redemption.update` | `1` | A redemption of a channel points custom reward has been updated for the specified channel. |
| Channel Custom Power-ups Redemption Add NEW | `channel.custom_power_up_redemption.add` | `1` | A viewer has redeemed a custom Power-up on the specified channel. |
| Channel Poll Begin | `channel.poll.begin` | `1` | A poll started on a specified channel. |
| Channel Poll Progress | `channel.poll.progress` | `1` | Users respond to a poll on a specified channel. |
| Channel Poll End | `channel.poll.end` | `1` | A poll ended on a specified channel. |
| Channel Prediction Begin | `channel.prediction.begin` | `1` | A Prediction started on a specified channel. |
| Channel Prediction Progress | `channel.prediction.progress` | `1` | Users participated in a Prediction on a specified channel. |
| Channel Prediction Lock | `channel.prediction.lock` | `1` | A Prediction was locked on a specified channel. |
| Channel Prediction End | `channel.prediction.end` | `1` | A Prediction ended on a specified channel. |
| Channel Suspicious User Message NEW | `channel.suspicious_user.message` | `1` | A chat message has been sent by a suspicious user. |
| Channel Suspicious User Update NEW | `channel.suspicious_user.update` | `1` | A suspicious user has been updated. |
| Channel VIP Add | `channel.vip.add` | `1` | A VIP is added to the channel. |
| Channel VIP Remove | `channel.vip.remove` | `1` | A VIP is removed from the channel. |
| Channel Warning Acknowledgement | `channel.warning.acknowledge` | `1` | A user acknowledges a warning. Broadcasters and moderators can see the warning’s details. |
| Channel Warning Send NEW | `channel.warning.send` | `1` | A user is sent a warning. Broadcasters and moderators can see the warning’s details. |
| Charity Donation | `channel.charity_campaign.donate` | `1` | Sends an event notification when a user donates to the broadcaster’s charity campaign. |
| Charity Campaign Start | `channel.charity_campaign.start` | `1` | Sends an event notification when the broadcaster starts a charity campaign. |
| Charity Campaign Progress | `channel.charity_campaign.progress` | `1` | Sends an event notification when progress is made towards the campaign’s goal or when the broadcaster changes the fundraising goal. |
| Charity Campaign Stop | `channel.charity_campaign.stop` | `1` | Sends an event notification when the broadcaster stops a charity campaign. |
| Conduit Shard Disabled NEW | `conduit.shard.disabled` | `1` | Sends a notification when EventSub disables a shard due to the status of the underlying transport changing. |
| Drop Entitlement Grant | `drop.entitlement.grant` | `1` | An entitlement for a Drop is granted to a user. |
| Extension Bits Transaction Create | `extension.bits_transaction.create` | `1` | A Bits transaction occurred for a specified Twitch Extension. |
| Goal Begin | `channel.goal.begin` | `1` | Get notified when a broadcaster begins a goal. |
| Goal Progress | `channel.goal.progress` | `1` | Get notified when progress (either positive or negative) is made towards a broadcaster’s goal. |
| Goal End | `channel.goal.end` | `1` | Get notified when a broadcaster ends a goal. |
| Hype Train Begin | `channel.hype_train.begin` | `2` | A Hype Train begins on the specified channel. |
| Hype Train Progress | `channel.hype_train.progress` | `2` | A Hype Train makes progress on the specified channel. |
| Hype Train End | `channel.hype_train.end` | `2` | A Hype Train ends on the specified channel. |
| Shield Mode Begin | `channel.shield_mode.begin` | `1` | Sends a notification when the broadcaster activates Shield Mode. |
| Shield Mode End | `channel.shield_mode.end` | `1` | Sends a notification when the broadcaster deactivates Shield Mode. |
| Shoutout Create | `channel.shoutout.create` | `1` | Sends a notification when the specified broadcaster sends a Shoutout. |
| Shoutout Received | `channel.shoutout.receive` | `1` | Sends a notification when the specified broadcaster receives a Shoutout. |
| Stream Online | `stream.online` | `1` | The specified broadcaster starts a stream. |
| Stream Offline | `stream.offline` | `1` | The specified broadcaster stops a stream. |
| User Authorization Grant | `user.authorization.grant` | `1` | A user’s authorization has been granted to your client id. |
| User Authorization Revoke | `user.authorization.revoke` | `1` | A user’s authorization has been revoked for your client id. |
| User Update | `user.update` | `1` | A user has updated their account. |
| Whisper Received NEW | `user.whisper.message` | `1` | A user receives a whisper. |

## Public Beta Program  {#public-beta-program}

When new subscription types are added to EventSub, or existing subscription types receive an update, they are occasionally released as a public beta and denoted with the [BETA](/docs/product-lifecycle#api-endpoint-and-subscription-classifications) tag. This provides the community an opportunity to provide feedback via [UserVoice](https://twitch.uservoice.com/forums/310213-developers) to make sure it meets expectations before a more established version is committed. Subscription types that are in beta are unstable and may change at any time, and as a result, should not be used in a production environment. If you decide to use beta subscription types, ensure that you have robust error handling and are prepared for unexpected behaviours.

Unless otherwise noted, EventSub subscriptions that were released as a public beta will be available for 30 days after their generally available version is released. Subscriptions should be updated to the new version (v1, v2, etc.) during this timeframe. Any active beta subscriptions beyond 30 days will be automatically deleted.

## Channel Subscriptions  {#channel-subscriptions}

### automod.message.hold  {#automodmessagehold}

The `automod.message.hold` subscription type notifies a user if a message was caught by automod for review.

### Authorization  {#authorization}

Requires a user access token that includes the `moderator:manage:automod` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:manage:automod` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Message Hold Request Body  {#automod-message-hold-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.message.hold`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-message-hold-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Message Hold Webhook Example  {#automod-message-hold-webhook-example}

```
{
    "type": "automod.message.hold",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Message Hold Notification Payload  {#automod-message-hold-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-message-hold-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "automod.message.hold",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "9001"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "1337",
    "broadcaster_user_name": "blah",
    "broadcaster_user_login": "blahblah",
    "user_id": "456789012",
    "user_name": "baduser",
    "user_login": "baduserbla",
    "message_id": "bad-message-id",
    "message": "This is a bad message… ",
    "level": 5,
    "category": "aggressive",
    "held_at": "2022-12-02T15:00:00.00Z",
    "fragments": {
      "emotes": [
        {
          "text": "badtextemote1",
          "id": "emote-123",
          "set-id": "set-emote-1"
        },
        {
          "text": "badtextemote2",
          "id": "emote-234",
          "set-id": "set-emote-2"
        }
      ],
      "cheermotes": [
        {
          "text": "badtextcheermote1",
          "amount": 1000,
          "prefix": "prefix",
          "tier": 1
        }
      ]
    }
  }
}

```

### automod.message.hold V2  {#automodmessagehold-v2}

NEW The `automod.message.hold` subscription type notifies a user if a message was caught by automod for review. Only public blocked terms trigger notifications, not private ones.

### Authorization  {#authorization-1}

Requires a user access token that includes the `moderator:manage:automod` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:manage:automod` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Message Hold Request Body  {#automod-message-hold-request-body-1}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.message.hold`. |
| `version` | String | Yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-message-hold-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Message Hold Webhook Example  {#automod-message-hold-webhook-example-1}

```
{
    "type": "automod.message.hold",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Message Hold Notification Payload  {#automod-message-hold-notification-payload-1}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-message-hold-event-v2) | The event information. |

```
{
 "subscription": {
   "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
   "type": "automod.message.hold",
   "version": "2",
   "status": "enabled",
   "cost": 0,
   "condition": {
     "broadcaster_user_id": "1337",
     "moderator_user_id": "9001"
   },
   "transport": {
     "method": "webhook",
     "callback": "https://example.com/webhooks/callback"
   },
   "created_at": "2023-04-11T10:11:12.123Z"
 },
 "event": {
   "broadcaster_user_id": "1337",
   "broadcaster_user_login": "blah",
   "broadcaster_user_name": "blahblah",
   "user_id": "4242",
   "user_login": "baduser",
   "user_name": "badbaduser",
   "message_id": "bad-message-id",
   "message": {
     "text": "This is a bad message… pogchamp",
     "fragments": [
       {
         "type": "text",
         "text": "This is a bad message… ",
         "cheermote": null,
         "emote": null
       },
       {
         "type": "cheermote",
         "text": "pogchamp",
         "cheermote": {
           "prefix": "pogchamp",
           "bits": 1000,
           "tier": 1
         },
         "emote": null
       }
     ]
   },
   "reason": "automod",
   "automod": {
     "category": "aggressive",
     "level": 1,
     "boundaries": [
       {
         "start_pos": 0,
         "end_pos": 10
       },
       {
         "start_pos": 20,
         "end_pos": 30
       }
     ]
   },
   "blocked_term": null,
   "held_at": "2022-12-02T15:00:00.00Z"
 }
}

```

### automod.message.update  {#automodmessageupdate}

The `automod.message.update` subscription type sends notification when a message in the automod queue has its status changed.

### Authorization  {#authorization-2}

Requires a user access token that includes the `moderator:manage:automod` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:manage:automod` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Message Update Request Body  {#automod-message-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.message.update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-message-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Message Update Webhook Example  {#automod-message-update-webhook-example}

```
{
    "type": "automod.message.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Message Update Notification Payload  {#automod-message-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-message-update-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "automod.message.update",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "9001"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "1337",
    "broadcaster_user_name": "blah",
    "broadcaster_user_login": "blahblah",
    "user_id": "456789012",
    "user_name": "baduser",
    "user_login": "baduserbla",
    "moderator_user_id": "9001",
    "moderator_user_login": "the_mod",
    "moderator_user_name": "The_Mod",
    "message_id": "bad-message-id",
    "message": "This is a bad message… ",
    "level": 5,
    "category": "aggressive",
    "status": "approved",
    "held_at": "2022-12-02T15:00:00.00Z",
    "fragments": {
      "emotes": [
        {
          "text": "badtextemote1",
          "id": "emote-123",
          "set-id": "set-emote-1"
        },
        {
          "text": "badtextemote2",
          "id": "emote-234",
          "set-id": "set-emote-2"
        }
      ],
      "cheermotes": [
        {
          "text": "badtextcheermote1",
          "amount": 1000,
          "prefix": "prefix",
          "tier": 1
        }
      ]
    }
  }
}

```

### automod.message.update V2  {#automodmessageupdate-v2}

NEW The `automod.message.update` subscription type sends notification when a message in the automod queue has its status changed. Only public blocked terms trigger notifications, not private ones.

### Authorization  {#authorization-3}

Requires a user access token that includes the `moderator:manage:automod` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:manage:automod` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Message Update Request Body  {#automod-message-update-request-body-1}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.message.update`. |
| `version` | String | Yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-message-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Message Update Webhook Example  {#automod-message-update-webhook-example-1}

```
{
    "type": "automod.message.update",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Message Update Notification Payload  {#automod-message-update-notification-payload-1}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-message-update-event-v2) | The event information. |

```
{
 "subscription": {
   "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
   "type": "automod.message.hold",
   "version": "2",
   "status": "enabled",
   "cost": 0,
   "condition": {
     "broadcaster_user_id": "1337",
     "moderator_user_id": "9001"
   },
   "transport": {
     "method": "webhook",
     "callback": "https://example.com/webhooks/callback"
   },
   "created_at": "2023-04-11T10:11:12.123Z"
 },
 "event": {
   "broadcaster_user_id": "1337",
   "broadcaster_user_login": "blah",
   "broadcaster_user_name": "blahblah",
   "moderator_user_id": "9001",
   "moderator_user_login": "the_mod",
   "moderator_user_name": "The_Mod",
   "user_id": "4242",
   "user_login": "baduser",
   "user_name": "badbaduser",
   "message_id": "bad-message-id",
   "message": {
     "text": "This is a bad message… pogchamp",
     "fragments": [
       {
         "type": "text",
         "text": "This is a bad message… ",
         "cheermote": null,
         "emote": null
       },
       {
         "type": "cheermote",
         "text": "pogchamp",
         "cheermote": {
           "prefix": "pogchamp",
           "bits": 1000,
           "tier": 1
         },
         "emote": null
       }
     ]
   },
   "reason": "automod",
   "automod": null,
   "blocked_term": {
     "terms_found": [
       {
         "term_id": "123",
         "owner_broadcaster_user_id": "1337",
         "owner_broadcaster_user_login": "blah",
         "owner_broadcaster_user_name": "blahblah",
         "boundary": {
           "start_pos": 0,
           "end_pos": 30
         }
       }
     ]
   },
   "status": "approved",
   "held_at": "2022-12-02T15:00:00.00Z"
 }
}

```

### automod.settings.update  {#automodsettingsupdate}

The `automod.settings.update` subscription type sends a notification when a broadcaster’s automod settings are updated.

### Authorization  {#authorization-4}

Requires a user access token that includes the `moderator:read:automod_settings` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:read:automod_settings` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Settings Update Request Body  {#automod-settings-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.settings.update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-settings-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Settings Update Webhook Example  {#automod-settings-update-webhook-example}

```
{
    "type": "automod.settings.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Settings Update Notification Payload  {#automod-settings-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-settings-update-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "automod.settings.update",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "9001"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "data": [
      {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "CoolUser",
        "broadcaster_user_login": "cooluser",
        "moderator_user_id": "9001",
        "moderator_user_name": "CoolMod",
        "moderator_user_login": "coolmod",
        "overall_level": null,
        "disability": 3,
        "aggression": 3,
        "sexuality_sex_or_gender": 3,
        "misogyny": 3,
        "bullying": 3,
        "swearing": 0,
        "race_ethnicity_or_religion": 3,
        "sex_based_terms":30
      }
    ]
  }
}

```

### automod.terms.update  {#automodtermsupdate}

The `automod.terms.update` subscription type sends a notification when a broadcaster’s automod terms are updated. Changes to private terms are not sent.

### Authorization  {#authorization-5}

Requires a user access token that includes the `moderator:manage:automod` scope. The ID in the `moderator_user_id` condition parameter must match the user ID in the access token. If app access token used, then additionally requires the `moderator:manage:automod` scope for the moderator.

The moderator must be a moderator or broadcaster for the specified broadcaster.

### Automod Terms Update Request Body  {#automod-terms-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `automod.terms.update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#automod-terms-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Automod Terms Update Webhook Example  {#automod-terms-update-webhook-example}

```
{
    "type": "automod.terms.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Automod Terms Update Notification Payload  {#automod-terms-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#automod-terms-update-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "automod.terms.update",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "9001"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "1337",
    "broadcaster_user_name": "blah",
    "broadcaster_user_login": "blahblah",
    "moderator_user_id": "9001",
    "moderator_user_login": "the_mod",
    "moderator_user_name": "The_Mod",
    "action": "bad-message-id",
    "from_automod": true,
    "terms": ["automodterm1", "automodterm2", "automodterm3"]
  }
}

```

### channel.bits.use  {#channelbitsuse}

NEW The `channel.bits.use` subscription type sends a notification whenever Bits are used on a channel.

### Triggers  {#triggers}

This event is designed to be an all-purpose event for when Bits are used in a channel and might be updated in the future as more Twitch features use Bits.

Currently, this event will be sent when a user:

- Cheers
- Uses a Power-up

- Will not emit when a streamer uses a Power-up for free in their own channel
- Uses a custom Power-up BETA

- Will not emit when a streamer uses a Power-up for free in their own channel

Bits transactions via Twitch Extensions are not included in this subscription type.

### Authorization  {#authorization-6}

Requires a user access token that includes the **bits:read** scope.

### Bits Use Message Request Body  {#bits-use-message-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | Yes | The subscription type name: `channel.bits.use`. |
| `version` | string | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-bits-use-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Bits Use Message Webhook Example  {#channel-bits-use-message-webhook-example}

```
{
    "type": "channel.bits.use",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1971641"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Bits Use Message Notification Payload  {#channel-bits-use-message-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-bits-use-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.bits.use",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
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
          "cheermote": {
            "prefix": "cheer",
            "bits": 1,
            "tier": 1
          },
          "emote": null
        },
        {
          "type": "text",
          "text": " hi ",
          "cheermote": null,
          "emote": null
        },
        {
          "type": "cheermote",
          "text": "cheer1",
          "cheermote": {
            "prefix": "cheer",
            "bits": 1,
            "tier": 1
          },
          "emote": null
        }
      ]
    }
  }
}

```

### channel.update  {#channelupdate}

The `channel.update` subscription type sends notifications when a broadcaster updates the category, title, [content classification labels](https://safety.twitch.tv/s/article/Content-Classification-Guidelines), or broadcast language for their channel.

### Authorization  {#authorization-7}

No authorization required.

### Channel Update Request Body  {#channel-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.update`. |
| `version` | string | yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-update-condition) | yes | Pass in the `broadcaster_user_id `for the channel you want updates for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Update Webhook Example  {#channel-update-webhook-example}

```
{
    "type": "channel.update",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Update Notification Payload  {#channel-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-update-event) | Returns the user ID, user name, title, language, category ID, category name, and content classification labels for the given broadcaster. |

### Channel Update Notification Example  {#channel-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.update",
        "version": "2",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-06-29T17:20:33.860897266Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "title": "Best Stream Ever",
        "language": "en",
        "category_id": "12453",
        "category_name": "Grand Theft Auto",
        "content_classification_labels": [ "MatureGame" ]
    }
}

```

### channel.follow  {#channelfollow}

The `channel.follow` subscription type sends a notification when a specified channel receives a follow.

### Authorization  {#authorization-8}

Must have `moderator:read:followers` scope.

### Channel Follow Request Body  {#channel-follow-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.follow`. |
| `version` | string | yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-follow-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Follow Webhook Example  {#channel-follow-webhook-example}

```
{
    "type": "channel.follow",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Follow Notification Payload  {#channel-follow-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-follow-event) | The event information. Contains the user ID and user name of the follower and the broadcaster user ID and broadcaster user name. |

### Channel Follow Webhook Notification Example  {#channel-follow-webhook-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.follow",
        "version": "2",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337",
           "moderator_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "followed_at": "2020-07-15T18:16:11.17106713Z"
    }
}

```

### channel.ad_break.begin  {#channelad_breakbegin}

The `channel.ad_break.begin` subscription type sends a notification when a user runs a midroll commercial break, either manually or automatically via ads manager.

### Authorization  {#authorization-9}

Must have `channel:read:ads` scope.

### Channel Ad Break Begin Request Body  {#channel-ad-break-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.ad_break.begin`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-ad-break-begin-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Ad Break Begin Webhook Example  {#channel-ad-break-begin-webhook-example}

```
{
    "type": "channel.ad_break.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Ad Break Begin Notification Payload  {#channel-ad-break-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-ad-break-begin-event) | The event information. |

### Channel Ad Break Begin Notification Example  {#channel-ad-break-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.ad_break.begin",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337",
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "duration_seconds": "60",
        "started_at": "2019-11-16T10:11:12.634234626Z",
        "is_automatic": "false",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "requester_user_id": "1337",
        "requester_user_login": "cool_user",
        "requester_user_name": "Cool_User",
    }
}

```

### channel.chat.clear  {#channelchatclear}

The `channel.chat.clear` subscription type sends a notification when a moderator or bot clears all messages from the chat room.

### Authorization  {#authorization-10}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Clear Request Body  {#channel-chat-clear-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.clear`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-clear-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat Clear Webhook Example  {#channel-chat-clear-webhook-example}

```
{
    "type": "channel.chat.clear",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Clear Notification Payload  {#channel-chat-clear-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-clear-event) | The event information. |

### Channel Chat Clear Notification Example  {#channel-chat-clear-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.clear",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "user_id": "9001"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user"
    }
}

```

### channel.chat.clear_user_messages  {#channelchatclear_user_messages}

The `channel.chat.clear_user_messages` subscription type sends a notification when a moderator or bot clears all messages for a specific user.

### Authorization  {#authorization-11}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Clear User Messages Request Body  {#channel-chat-clear-user-messages-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.clear_user_messages`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-clear-user-messages-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat Clear User Messages Webhook Example  {#channel-chat-clear-user-messages-webhook-example}

```
{
    "type": "channel.chat.clear_user_messages",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Clear User Messages Notification Payload  {#channel-chat-clear-user-messages-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-clear-user-messages-event) | The event information. |

### Channel Chat Clear User Messages Notification Example  {#channel-chat-clear-user-messages-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.clear_user_messages",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "user_id": "9001"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "target_user_id": "7734",
        "target_user_name": "Uncool_viewer",
        "target_user_login": "uncool_viewer"
    }
}

```

### channel.chat.message  {#channelchatmessage}

NEW The `channel.chat.message` subscription type sends a notification when any user sends a message to a channel’s chat room.

### Authorization  {#authorization-12}

Requires `user:read:chat` scope from the chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Message Request Body  {#channel-chat-message-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.message`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-message-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat Message Webhook Example  {#channel-chat-message-webhook-example}

```
{
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Message Payload  {#channel-chat-message-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-message-event) | The event information. |

### Regular Chat Message Example  {#regular-chat-message-example}

```
{
  "subscription": {
    "id": "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    "status": "enabled",
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641",
      "user_id": "2914196"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQHR3s6Mb4T8GFB1l3DlPfiRIGY2VsbC1h"
    },
    "created_at": "2023-11-06T18:11:47.492253549Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "chatter_user_id": "4145994",
    "chatter_user_login": "viewer32",
    "chatter_user_name": "viewer32",
    "message_id": "cc106a89-1814-919d-454c-f4f2f970aae7",
    "message": {
      "text": "Hi chat",
      "fragments": [
        {
          "type": "text",
          "text": "Hi chat",
          "cheermote": null,
          "emote": null,
          "mention": null
        }
      ]
    },
    "color": "#00FF7F",
    "badges": [
      {
        "set_id": "moderator",
        "id": "1",
        "info": ""
      },
      {
        "set_id": "subscriber",
        "id": "12",
        "info": "16"
      },
      {
        "set_id": "sub-gifter",
        "id": "1",
        "info": ""
      }
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
}

```

### Shared Chat Message Example  {#shared-chat-message-example}

```
{
  "subscription": {
    "id": "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    "status": "enabled",
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641",
      "user_id": "2914196"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQHR3s6Mb4T8GFB1l3DlPfiRIGY2VsbC1h"
    },
    "created_at": "2023-11-06T18:11:47.492253549Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "chatter_user_id": "4145994",
    "chatter_user_login": "viewer32",
    "chatter_user_name": "viewer32",
    "message_id": "cc106a89-1814-919d-454c-f4f2f970aae7",
    "message": {
      "text": "Hi chat",
      "fragments": [
        {
          "type": "text",
          "text": "Hi chat",
          "cheermote": null,
          "emote": null,
          "mention": null
        }
      ]
    },
    "color": "#00FF7F",
    "badges": [
      {
        "set_id": "moderator",
        "id": "1",
        "info": ""
      },
      {
        "set_id": "subscriber",
        "id": "12",
        "info": "16"
      },
      {
        "set_id": "sub-gifter",
        "id": "1",
        "info": ""
      }
    ],
    "message_type": "text",
    "cheer": null,
    "reply": null,
    "channel_points_custom_reward_id": null,
    "source_broadcaster_user_id": "112233",
    "source_broadcaster_user_login": "streamer33",
    "source_broadcaster_user_name": "streamer33",
    "source_message_id": "e03f6d5d-8ec8-4c63-b473-9e5fe61e289b",
    "source_badges": [
      {
        "set_id": "subscriber",
        "id": "3",
        "info": "3"
      }
    ],
    "is_source_only": true
  }
}

```

### channel.chat.message_delete  {#channelchatmessage_delete}

The `channel.chat.message_delete` subscription type sends a notification when a moderator removes a specific message.

### Authorization  {#authorization-13}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Message Delete Request Body  {#channel-chat-message-delete-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.message_delete`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-message-delete-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat Message Delete Webhook Example  {#channel-chat-message-delete-webhook-example}

```
{
    "type": "channel.chat.message_delete",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Message Delete Notification Payload  {#channel-chat-message-delete-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-message-delete-event) | The event information. |

### Channel Chat Message Delete Notification Example  {#channel-chat-message-delete-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.message_delete",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "user_id": "9001"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "target_user_id": "7734",
        "target_user_name": "Uncool_viewer",
        "target_user_login": "uncool_viewer",
        "message_id": "ab24e0b0-2260-4bac-94e4-05eedd4ecd0e"
    }
}

```

### channel.chat.notification  {#channelchatnotification}

The `channel.chat.notification` subscription type sends a notification when an event that appears in chat occurs, such as someone subscribing to the channel or a subscription is gifted.

### Authorization  {#authorization-14}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Notification Request Body  {#channel-chat-notification-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.notification`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-notification-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat Notification Webhook Example  {#channel-chat-notification-webhook-example}

```
{
    "type": "channel.chat.notification",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1971641",
        "user_id": "2914196"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Notification Notification Payload  {#channel-chat-notification-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-notification-event) | The event information. |

### Regular Chat Notification Example  {#regular-chat-notification-example}

```
{
  "subscription": {
    "id": "dc1a3cfc-a930-4972-bf9e-0ffc4e7a8996",
    "status": "enabled",
    "type": "channel.chat.notification",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641",
      "user_id": "2914196"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h"
    },
    "created_at": "2023-10-06T18:04:38.807682738Z",
    "cost": 0
  },
  "event": {
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
    "message": {
      "text": "",
      "fragments": []
    },
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
}

```

### Shared Chat Notification Example  {#shared-chat-notification-example}

```
{
    "subscription": {
        "id": "dc1a3cfc-a930-4972-bf9e-0ffc4e7a8996",
        "status": "enabled",
        "type": "channel.chat.notification",
        "version": "1",
        "condition": {
            "broadcaster_user_id": "1971641",
            "user_id": "2914196"
        },
        "transport": {
            "method": "websocket",
            "session_id": "AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h"
        },
        "created_at": "2023-10-06T18:04:38.807682738Z",
        "cost": 0
    },
    "event": {
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
        "message": {
            "text": "",
            "fragments": []
        },
        "notice_type": "shared_chat_resub",
        "sub": null,
        "resub": null,
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
        "shared_chat_resub": {
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
        "shared_chat_sub_gift": null,
        "shared_chat_community_sub_gift": null,
        "shared_chat_gift_paid_upgrade": null,
        "shared_chat_prime_paid_upgrade": null,
        "shared_chat_pay_it_forward": null,
        "shared_chat_raid": null,
        "shared_chat_unraid": null,
        "shared_chat_announcement": null,
        "shared_chat_bits_badge_tier": null,
        "shared_chat_charity_donation": null,
        "shared_chat_modiversary": null,
        "shared_chat_gifted_drops_summary": null,
        "source_broadcaster_user_id": "112233",
        "source_broadcaster_user_login": "streamer33",
        "source_broadcaster_user_name": "streamer33",
        "source_message_id": "2be7193d-0366-4453-b6ec-b288ce9f2c39",
        "source_badges": [{
            "set_id": "subscriber",
            "id": "3",
            "info": "3"
        }],
        "is_source_only": true
    }
}

```

### channel.chat_settings.update  {#channelchat_settingsupdate}

NEW This event sends a notification when a broadcaster’s chat settings are updated.

### Authorization  {#authorization-15}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user, and either `channel:bot` scope from broadcaster or moderator status.

### Channel Chat Settings Update Request Body  {#channel-chat-settings-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.chat_settings.update`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-settings-update-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Chat Settings Update Webhook Example  {#channel-chat-settings-update-webhook-example}

```
{
    "type": "channel.chat_settings.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001",
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat Settings Update Notification Payload  {#channel-chat-settings-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-settings-update-event) | The event information. Contains information about the updated chat mode for the channel. |

### Channel Chat Settings Update Notification Example  {#channel-chat-settings-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat_settings.update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "user_id": "9001"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "emote_mode": true,
        "follower_mode": false,
        "follower_mode_duration_minutes": null,
        "slow_mode": true,
        "slow_mode_wait_time_seconds": 10,
        "subscriber_mode": false,
        "unique_chat_mode": false
    }
}

```

### channel.chat.user_message_hold  {#channelchatuser_message_hold}

NEW The `channel.chat.user_message_hold` subscription type notifies a user if their message is caught by automod.

### Authorization  {#authorization-16}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user.

### Channel Chat User Message Hold Request Body  {#channel-chat-user-message-hold-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.user_message_hold`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-user-message-hold-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat User Message Hold Webhook Example  {#channel-chat-user-message-hold-webhook-example}

```
{
    "type": "channel.chat.user_message_hold",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat User Message Hold Notification Payload  {#channel-chat-user-message-hold-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-user-message-hold-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.chat.user_message_hold",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "user_id": "9001"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "123",
    "broadcaster_user_login": "bob",
    "broadcaster_user_name": "Bob",
    "user_id": "456",
    "user_login": "tom",
    "user_name": "Tommy",
    "message_id": "789",
    "message": {
      "text": "hey world",
      "fragments": [
        {
          "type": "emote",
          "text": "hey world",
          "cheermote": null,
          "emote": {
            "id": "foo",
            "emote_set_id": "7"
          }
        },
        {
          "type": "cheermote",
          "text": "bye world",
          "cheermote": {
            "prefix": "prefix",
            "bits": 100,
            "tier": 1
          },
          "emote": null
        },
        {
          "type": "text",
          "text": "surprise",
          "cheermote": null,
          "emote": null
        }
      ]
    }
  }
}

```

### channel.chat.user_message_update  {#channelchatuser_message_update}

NEW The `channel.chat.user_message_update` subscription type notifies a user if their message’s automod status is updated.

### Authorization  {#authorization-17}

Requires `user:read:chat` scope from chatting user. If app access token used, then additionally requires `user:bot` scope from chatting user.

### Channel Chat User Message Update Request Body  {#channel-chat-user-message-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.chat.user_message_update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-chat-user-message-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Chat User Message Update Webhook Example  {#channel-chat-user-message-update-webhook-example}

```
{
    "type": "channel.chat.user_message_update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "user_id": "9001"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Chat User Message Update Notification Payload  {#channel-chat-user-message-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-chat-user-message-update-event) | The event information. |

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.user_message_update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "user_id": "9001"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
   "broadcaster_user_id": "123",
   "broadcaster_user_login": "bob",
   "broadcaster_user_name": "Bob",
   "user_id": "456",
   "user_login": "tom",
   "user_name": "Tommy",
   "status": "approved",
   "message_id": "789",
   "message": {
     "text": "hey world",
     "fragments": [
       {
         "type": "emote",
         "text": "hey world",
         "cheermote": null,
         "emote": {
             "id": "foo",
             "emote_set_id": "7"
         }
       },
       {
         "type": "cheermote",
         "text": "bye world",
         "cheermote": {
             "prefix": "prefix",
             "bits": 100,
             "tier": 1
         },
         "emote": null
       },
       {
         "type": "text",
         "text": "surprise",
         "cheermote": null,
         "emote": null
       }
     ]
   }
 }
}

```

### channel.subscribe  {#channelsubscribe}

The `channel.subscribe` subscription type sends a notification when a specified channel receives a subscriber. This does not include resubscribes.

### Authorization  {#authorization-18}

Must have `channel:read:subscriptions` scope.

### Channel Subscribe Request Body  {#channel-subscribe-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.subscribe`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-subscribe-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Subscribe Webhook Example  {#channel-subscribe-webhook-example}

```
{
    "type": "channel.subscribe",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Subscribe Notification Payload  {#channel-subscribe-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-subscribe-event) | The event information. Contains the user ID and user name of the subscriber, the broadcaster user ID and broadcaster user name, and whether the subscription is a gift. |

### Channel Subscribe Webhook Notification Example  {#channel-subscribe-webhook-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.subscribe",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "tier": "1000",
        "is_gift": false
    }
}

```

### channel.subscription.end  {#channelsubscriptionend}

The `channel.subscription.end` subscription type sends a notification when a subscription to the specified channel expires.

### Authorization  {#authorization-19}

Must have `channel:read:subscriptions` scope.

### Channel Subscription End Request Body  {#channel-subscription-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.subscription.end`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-subscription-end-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Subscription End Webhook Example  {#channel-subscription-end-webhook-example}

```
{
    "type": "channel.subscription.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Subscription End Notification Payload  {#channel-subscription-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the EventSub subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-subscription-end-event) | The event information. Contains the user ID, user login, and user display name of the user whose subscription has expired, as well as the broadcaster user ID, broadcaster login, and broadcaster display name. |

### Channel Subscription End Webhook Notification Example  {#channel-subscription-end-webhook-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.subscription.end",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "tier": "1000",
        "is_gift": false
    }
}

```

### channel.subscription.gift  {#channelsubscriptiongift}

The `channel.subscription.gift` subscription type sends a notification when a user gives one or more gifted subscriptions in a channel.

### Authorization  {#authorization-20}

Must have `channel:read:subscriptions` scope.

### Channel Subscription Gift Request Body  {#channel-subscription-gift-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.subscription.gift`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-subscription-gift-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Subscription Gift Webhook Example  {#channel-subscription-gift-webhook-example}

```
{
    "type": "channel.subscription.gift",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Subscription Gift Notification Payload  {#channel-subscription-gift-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the EventSub subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-subscription-gift-event) | The event information. Contains information about the user who gave the gift subscriptions, and the number and tier of subscriptions included in the gift. |

### Channel Subscription Gift Webhook Notification Example  {#channel-subscription-gift-webhook-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.subscription.gift",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "total": 2,
        "tier": "1000",
        "cumulative_total": 284, //null if anonymous or not shared by the user
        "is_anonymous": false
    }
}

```

### channel.subscription.message  {#channelsubscriptionmessage}

The `channel.subscription.message` subscription type sends a notification when a user sends a resubscription chat message in a specific channel.

### Authorization  {#authorization-21}

Must have `channel:read:subscriptions` scope.

### Channel Subscription Message Request Body  {#channel-subscription-message-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.subscription.message`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-subscription-message-condition) | yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Subscription Message Webhook Example  {#channel-subscription-message-webhook-example}

```
{
    "type": "channel.subscription.message",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Subscription Message Notification Payload  {#channel-subscription-message-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the EventSub subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-subscription-message-event) | The event information. Contains information about the user who resubscribed and their resubscription chat message. |

### Channel Subscription Message Webhook Notification Example  {#channel-subscription-message-webhook-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.subscription.message",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "tier": "1000",
        "message": {
            "text": "Love the stream! FevziGG",
            "emotes": [
                {
                    "begin": 23,
                    "end": 30,
                    "id": "302976485"
                }
            ]
        },
        "cumulative_months": 15,
        "streak_months": 1, // null if not shared
        "duration_months": 6
    }
}

```

### channel.cheer  {#channelcheer}

The `channel.cheer` subscription type sends a notification when a user cheers on the specified channel.

### Authorization  {#authorization-22}

Must have `bits:read` scope.

### Channel Cheer Request Body  {#channel-cheer-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.cheer`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-cheer-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive cheer notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Cheer Webhook Example  {#channel-cheer-webhook-example}

```
{
    "type": "channel.cheer",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Cheer Notification Payload  {#channel-cheer-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-cheer-event) | The event information. Contains the user ID and user name of the cheering user along with the broadcaster user id and broadcaster user name. |

### Channel Cheer Notification Example  {#channel-cheer-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.cheer",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "is_anonymous": false,
        "user_id": "1234",          // null if is_anonymous=true
        "user_login": "cool_user",  // null if is_anonymous=true
        "user_name": "Cool_User",   // null if is_anonymous=true
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "message": "pogchamp",
        "bits": 1000
    }
}

```

### channel.raid  {#channelraid}

The `channel.raid` subscription type sends a notification when a broadcaster raids another broadcaster’s channel.

### Authorization  {#authorization-23}

No authorization required.

### Channel Raid Request Body  {#channel-raid-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.raid`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-raid-condition) | yes | Subscription-specific parameters. Set either the `from_broadcaster_user_id` or `to_broadcaster_user_id` condition parameter but not both. If you pass both parameters, the subscription request fails. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Raid Webhook Example  {#channel-raid-webhook-example}

```
{
    "type": "channel.raid",
    "version": "1",
    "condition": {
        "to_broadcaster_user_id": "1337" // could provide from_broadcaster_user_id instead
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Raid Notification Payload  {#channel-raid-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-raid-event) | The event information. Contains the from and to broadcaster information along with the number of viewers in the raid. Will only notify for raids that appear in chat. |

### Channel Raid Notification Example  {#channel-raid-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.raid",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "to_broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "from_broadcaster_user_id": "1234",
        "from_broadcaster_user_login": "cool_user",
        "from_broadcaster_user_name": "Cool_User",
        "to_broadcaster_user_id": "1337",
        "to_broadcaster_user_login": "cooler_user",
        "to_broadcaster_user_name": "Cooler_User",
        "viewers": 9001
    }
}

```

### channel.ban  {#channelban}

The `channel.ban` subscription type sends a notification when a viewer is timed out or banned from the specified channel.

### Authorization  {#authorization-24}

Must have `channel:moderate` scope.

### Channel Ban Request Body  {#channel-ban-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.ban`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-ban-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive ban notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Ban Webhook Example  {#channel-ban-webhook-example}

```
{
    "type": "channel.ban",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Ban Notification Payload  {#channel-ban-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-ban-event) | The event information. Will notify on timeouts as well as bans. Contains the user ID and user name of the banned user, the broadcaster user ID and broadcaster user name, the user ID and user name of the moderator who issued the ban/timeout, the reason, and expiration time if it is a timeout. |

### Channel Ban Notification Example  {#channel-ban-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.ban",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "moderator_user_id": "1339",
        "moderator_user_login": "mod_user",
        "moderator_user_name": "Mod_User",
        "reason": "Offensive language",
        "banned_at": "2020-07-15T18:15:11.17106713Z",
        "ends_at": "2020-07-15T18:16:11.17106713Z",
        "is_permanent": false
    }
}

```

### channel.unban  {#channelunban}

The `channel.unban` subscription type sends a notification when a viewer is unbanned from the specified channel.

### Authorization  {#authorization-25}

Must have `channel:moderate` scope.

### Channel Unban Request Body  {#channel-unban-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.unban`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-unban-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive unban notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Unban Webhook Example  {#channel-unban-webhook-example}

```
{
    "type": "channel.unban",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Unban Notification Payload  {#channel-unban-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-unban-event) | The event information. Contains the user ID and user name of the unbanned user, the broadcaster user id and broadcaster user name, as well as the user ID and user name of the moderator who issued the unban. |

### Channel Unban Notification Example  {#channel-unban-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.unban",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User",
        "moderator_user_id": "1339",
        "moderator_user_login": "mod_user",
        "moderator_user_name": "Mod_User"
    }
}

```

### channel.unban_request.create  {#channelunban_requestcreate}

NEW The `channel.unban_request.create` subscription type sends a notification when a user creates an unban request.

### Authorization  {#authorization-26}

Must have `moderator:read:unban_requests` or `moderator:manage:unban_requests` scope.

### Channel Unban Request Create Request Body  {#channel-unban-request-create-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.unban_request.create`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-unban-request-create-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Unban Request Create Webhook Example  {#channel-unban-request-create-webhook-example}

```
{
  "type": "channel.unban_request.create",
  "version": "1",
  "condition": {
    "broadcaster_user_id": "1337",
    "moderator_user_id": "1338"
  },
  "transport": {
    "method": "webhook",
    "callback": "https://example.com/webhooks/callback",
    "secret": "s3cRe7"
  }
}

```

### Channel Unban Request Create Notification Payload  {#channel-unban-request-create-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-unban-request-create-event) | The event information. |

### Channel Unban Request Create Notification Example  {#channel-unban-request-create-notification-example}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.unban_request.create",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "1338"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "id": "60",
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "cool_user",
    "broadcaster_user_name": "Cool_User",
    "user_id": "1339",
    "user_login": "not_cool_user",
    "user_name": "Not_Cool_User",
    "text": "unban me",
    "created_at": "2023-11-16T10:11:12.634234626Z"
  }
}

```

### channel.unban_request.resolve  {#channelunban_requestresolve}

NEW The `channel.unban_request.resolve` subscription type sends a notification when an unban request has been resolved.

### Authorization  {#authorization-27}

Must have `moderator:read:unban_requests` or `moderator:manage:unban_requests` scope.

If you use webhooks, the user in `moderator_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the [Authentication section](/docs/authentication/) of Create EventSub Subscription.

If you use WebSockets, the ID in `moderator_id` must match the user ID in the user access token.

### Channel Unban Request Resolve Request Body  {#channel-unban-request-resolve-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.unban_request.resolve`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-unban-request-resolve-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Unban Request Resolve Webhook Example  {#channel-unban-request-resolve-webhook-example}

```
{
  "type": "channel.unban_request.resolve",
  "version": "1",
  "condition": {
    "broadcaster_user_id": "1337",
    "moderator_user_id": "1338"
  },
  "transport": {
    "method": "webhook",
    "callback": "https://example.com/webhooks/callback",
    "secret": "s3cRe7"
  }
}

```

### Channel Unban Request Resolve Notification Payload  {#channel-unban-request-resolve-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-unban-request-resolve-event) | The event information. |

### Channel Unban Request Resolve Notification Example  {#channel-unban-request-resolve-notification-example}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.unban_request.resolve",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337",
      "moderator_user_id": "1338"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "id": "60",
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "cool_user",
    "broadcaster_user_name": "Cool_User",
    "moderator_user_id": "1337",
    "moderator_user_login": "cool_user",
    "moderator_user_name": "Cool_User",
    "user_id": "1339",
    "user_login": "not_cool_user",
    "user_name": "Not_Cool_User",
    "resolution_text": "no",
    "status": "denied"
  }
}

```

### channel.moderate  {#channelmoderate}

The `channel.moderate` subscription type sends a notification when a moderator performs a moderation action in a channel. Some of these actions affect chatters in other channels during Shared Chat.

### Authorization  {#authorization-28}

Must have all of the following scopes:

- `moderator:read:blocked_terms` OR `moderator:manage:blocked_terms`
- `moderator:read:chat_settings` OR `moderator:manage:chat_settings`
- `moderator:read:unban_requests` OR `moderator:manage:unban_requests`
- `moderator:read:banned_users` OR `moderator:manage:banned_users`
- `moderator:read:chat_messages` OR `moderator:manage:chat_messages`
- `moderator:read:moderators`
- `moderator:read:vips`

### Channel Moderate Request Body  {#channel-moderate-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.moderate`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-moderate-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Moderate Webhook Example  {#channel-moderate-webhook-example}

```
{
    "type": "channel.moderate",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "423374343",
        "moderator_user_id": "424596340"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Moderate Notification Payload  {#channel-moderate-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-moderate-event) | The event information. |

### Payload Example - Adding a Moderator  {#payload-example---adding-a-moderator}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1337"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "action": "mod",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": {
      "user_id": "141981764",
      "user_login": "twitchdev",
      "user_name": "TwitchDev"
    },
    "unmod": null,
    "ban": null,
    "unban": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null,
    "shared_chat_ban": null,
    "shared_chat_unban": null,
    "shared_chat_timeout": null,
    "shared_chat_untimeout": null,
    "shared_chat_delete": null
  }
}

```

### Channel Moderate Example - Timing out a user in a Shared Chat  {#channel-moderate-example---timing-out-a-user-in-a-shared-chat}

```
{
  "broadcaster_user_id": "423374343",
  "broadcaster_user_login": "glowillig",
  "broadcaster_user_name": "glowillig",
  "source_broadcaster_user_id": "41292030",
  "source_broadcaster_user_login": "adflynn404",
  "source_broadcaster_user_name": "adflynn404",
  "moderator_user_id": "424596340",
  "moderator_user_login": "quotrok",
  "moderator_user_name": "quotrok",
  "action": "shared_chat_timeout",
  "followers": null,
  "slow": null,
  "vip": null,
  "unvip": null,
  "mod": null,
  "unmod": null,
  "ban": null,
  "unban": null,
  "timeout": null,
  "untimeout": null,
  "raid": null,
  "unraid": null,
  "delete": null,
  "automod_terms": null,
  "unban_request": null,
  "shared_chat_ban": null,
  "shared_chat_unban": null,
  "shared_chat_timeout": {
      "user_id": "141981764",
      "user_login": "twitchdev",
      "user_name": "TwitchDev",
      "reason": "Does not like pineapple on pizza.",
      "expires_at": "2022-03-15T02:00:28Z"
  },
  "shared_chat_untimeout": null,
  "shared_chat_delete": null,
}

```

### Payload Example - Emote only mode  {#payload-example---emote-only-mode}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1337"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "action": "emoteonly",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null,
    "shared_chat_ban": null,
    "shared_chat_unban": null,
    "shared_chat_timeout": null,
    "shared_chat_untimeout": null,
    "shared_chat_delete": null
  }

```

### channel.moderate v2  {#channelmoderate-v2}

NEW The `channel.moderate` subscription type sends a notification when a moderator performs a moderation action in a channel. Some of these actions affect chatters in other channels during Shared Chat.

- This is the second version of `channel.moderate` with warnings added.

### Authorization  {#authorization-29}

Must have all of the following scopes:

- `moderator:read:blocked_terms` OR `moderator:manage:blocked_terms`
- `moderator:read:chat_settings` OR `moderator:manage:chat_settings`
- `moderator:read:unban_requests` OR `moderator:manage:unban_requests`
- `moderator:read:banned_users` OR `moderator:manage:banned_users`
- `moderator:read:chat_messages` OR `moderator:manage:chat_messages`
- `moderator:read:warnings` OR `moderator:manage:warnings`
- `moderator:read:moderators`
- `moderator:read:vips`

### Channel Moderate V2 Request Body  {#channel-moderate-v2-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.moderate`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-moderate-v2-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Moderate V2 Webhook Example  {#channel-moderate-v2-webhook-example}

```
{
    "type": "channel.moderate",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "423374343",
        "moderator_user_id": "424596340"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Moderate V2 Notification Payload  {#channel-moderate-v2-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-moderate-event-v2) | The event information. |

### Payload Example - Issuing a Warning  {#payload-example---issuing-a-warning}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "2",
    "condition": {
      "broadcaster_user_id": "423374343",
      "moderator_user_id": "424596340"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
      "broadcaster_user_id": "423374343",
      "broadcaster_user_login": "glowillig",
      "broadcaster_user_name": "glowillig",
      "source_broadcaster_user_id": "41292030",
      "source_broadcaster_user_login": "adflynn404",
      "source_broadcaster_user_name": "adflynn404",
      "moderator_user_id": "424596340",
      "moderator_user_login": "quotrok",
      "moderator_user_name": "quotrok",
      "action": "warn",
      "followers": null,
      "slow": null,
      "vip": null,
      "unvip": null,
      "warn": {
        "user_id": "141981764",
        "user_login": "twitchdev",
        "user_name": "TwitchDev",
        "reason": "cut it out",
        "chat_rules_cited": null,
      },
      "unmod": null,
      "ban": null,
      "unban": null,
      "timeout": null,
      "untimeout": null,
      "raid": null,
      "unraid": null,
      "delete": null,
      "automod_terms": null,
      "unban_request": null,
      "shared_chat_ban": null,
      "shared_chat_unban": null,
      "shared_chat_timeout": null,
      "shared_chat_untimeout": null,
      "shared_chat_delete": null
  }
}

```

### Channel Moderate Example - Timing out a user in a Shared Chat  {#channel-moderate-example---timing-out-a-user-in-a-shared-chat-1}

```
{
    "subscription": {
        "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
        "status": "enabled",
        "type": "channel.moderate",
        "version": "2",
        "condition": {
            "broadcaster_user_id": "423374343",
            "moderator_user_id": "424596340"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2024-02-23T21:12:33.771005262Z"
    },
    "event": {
        "broadcaster_user_id": "423374343",
        "broadcaster_user_login": "glowillig",
        "broadcaster_user_name": "glowillig",
        "source_broadcaster_user_id": "41292030",
        "source_broadcaster_user_login": "adflynn404",
        "source_broadcaster_user_name": "adflynn404",
        "moderator_user_id": "424596340",
        "moderator_user_login": "quotrok",
        "moderator_user_name": "quotrok",
        "action": "ban",
        "followers": null,
        "slow": null,
        "vip": null,
        "unvip": null,
        "warn": null,
        "unmod": null,
        "ban": null,
        "unban": null,
        "timeout": null,
        "untimeout": null,
        "raid": null,
        "unraid": null,
        "delete": null,
        "automod_terms": null,
        "unban_request": null,
        "shared_chat_ban": null,
        "shared_chat_unban": null,
        "shared_chat_timeout": {
            "user_id": "141981764",
            "user_login": "twitchdev",
            "user_name": "TwitchDev",
            "reason": "Has never seen the Harry Potter films.",
            "expires_at": "2022-03-15T02:00:28Z"
        },
        "shared_chat_untimeout": null,
        "shared_chat_delete": null
    }
}

```

### Payload Example - Adding a Moderator  {#payload-example---adding-a-moderator-1}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "2",
    "condition": {
      "broadcaster_user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "423374343",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "action": "mod",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "warn": null,
    "mod": {
      "user_id": "141981764",
      "user_login": "twitchdev",
      "user_name": "TwitchDev"
    },
    "unmod": null,
    "ban": null,
    "unban": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null,
    "shared_chat_ban": null,
    "shared_chat_unban": null,
    "shared_chat_timeout": null,
    "shared_chat_untimeout": null,
    "shared_chat_delete": null
  }
}

```

### Payload Example - Timing out a user  {#payload-example---timing-out-a-user}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "2",
    "condition": {
      "broadcaster_user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "423374343",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "action": "timeout",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": null,
    "warn": null,
    "timeout": {
      "user_id": "141981764",
      "user_login": "twitchdev",
      "user_name": "TwitchDev",
      "reason": "Does not like pineapple on pizza.",
      "expires_at": "2022-03-15T02:00:28Z"
    },
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null,
    "shared_chat_ban": null,
    "shared_chat_unban": null,
    "shared_chat_timeout": null,
    "shared_chat_untimeout": null,
    "shared_chat_delete": null
  }
}

```

### Payload Example - Emote only mode  {#payload-example---emote-only-mode-1}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "2",
    "condition": {
      "broadcaster_user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "423374343",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "action": "emoteonly",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": null,
    "warn": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null,
    "shared_chat_ban": null,
    "shared_chat_unban": null,
    "shared_chat_timeout": null,
    "shared_chat_untimeout": null,
    "shared_chat_delete": null
  }

```

### channel.moderator.add  {#channelmoderatoradd}

The `channel.moderator.add` subscription type sends a notification when a user is given moderator privileges on a specified channel.

### Authorization  {#authorization-30}

Must have `moderation:read` scope.

### Channel Moderator Add Request Body  {#channel-moderator-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.moderator.add`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-moderator-add-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive moderator addition notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Moderator Add Example  {#channel-moderator-add-example}

```
{
    "type": "channel.moderator.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Moderator Add Notification Payload  {#channel-moderator-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-moderator-add-event) | The event information. Contains user information of the new moderator as well as broadcaster information of the channel the event occurred on. |

### Channel Moderator Add Notification Example  {#channel-moderator-add-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.moderator.add",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "mod_user",
        "user_name": "Mod_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User"
    }
}

```

### channel.moderator.remove  {#channelmoderatorremove}

The `channel.moderator.remove` subscription type sends a notification when a user has moderator privileges removed on a specified channel.

### Authorization  {#authorization-31}

Must have `moderation:read` scope.

### Channel Moderator Remove Request Body  {#channel-moderator-remove-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.moderator.remove`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-moderator-remove-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive moderator removal notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Moderator Remove Example  {#channel-moderator-remove-example}

```
{
    "type": "channel.moderator.remove",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Moderator Remove Notification Payload  {#channel-moderator-remove-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-moderator-remove-event) | The event information. Contains user information of the old moderator as well as broadcaster information of the channel the event occurred on. |

### Channel Moderator Remove Notification Example  {#channel-moderator-remove-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.moderator.remove",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1234",
        "user_login": "not_mod_user",
        "user_name": "Not_Mod_User",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cooler_user",
        "broadcaster_user_name": "Cooler_User"
    }
}

```

### channel.guest_star_session.begin  {#channelguest_star_sessionbegin}

BETA The `channel.guest_star_session.begin` subscription type sends a notification when the host begins a new Guest Star session.

### Authorization  {#authorization-32}

Must have `channel:read:guest_star`, `channel:manage:guest_star`, `moderator:read:guest_star` or `moderator:manage:guest_star` scope.

### Channel Guest Star Session Begin Request Body  {#channel-guest-star-session-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.guest_star_session.begin`. |
| `version` | String | Yes | The subscription type version: `beta`. |
| `condition` | Object | Yes | An object that contains subscription-specific parameters. |
| `broadcaster_user_id` | String | Yes | The broadcaster user ID for the channel you want to receive Guest Star session begin notifications for. |
| `moderator_user_id` | String | Yes | The user ID of the moderator or broadcaster of the specified channel. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Guest Star Session Begin Example  {#channel-guest-star-session-begin-example}

```
{
    "type": "channel.guest_star_session.begin",
    "version": "beta",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "1338"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Guest Star Session Begin Notification Payload  {#channel-guest-star-session-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-guest-star-session-begin-event) | The event information. |

### Channel Guest Star Session Begin Notification Example  {#channel-guest-star-session-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.guest_star_session.begin",
        "version": "beta",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "moderator_user_id": "1338"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "moderator_user_id": "1338",
        "moderator_user_name": "Cool_Mod",
        "moderator_user_login": "cool_mod",
        "session_id": "2KFRQbFtpmfyD3IevNRnCzOPRJI",
        "started_at": "2023-04-11T16:20:03.17106713Z"
    }
}

```

### channel.guest_star_session.end  {#channelguest_star_sessionend}

BETA The `channel.guest_star_session.end` subscription type sends a notification when a running Guest Star session is ended by the host, or automatically by the system.

### Authorization  {#authorization-33}

Must have `channel:read:guest_star`, `channel:manage:guest_star`, `moderator:read:guest_star` or `moderator:manage:guest_star` scope.

### Channel Guest Star Session End Request Body  {#channel-guest-star-session-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.guest_star_session.end`. |
| `version` | String | Yes | The subscription type version: `beta`. |
| `condition` | Object | Yes | An object that contains subscription-specific parameters. |
| `broadcaster_user_id` | String | Yes | The broadcaster user ID for the channel you want to receive Guest Star session end notifications for. |
| `moderator_user_id` | String | Yes | The user ID of the moderator or broadcaster of the specified channel. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Guest Star Session End Example  {#channel-guest-star-session-end-example}

```
{
    "type": "channel.guest_star_session.end",
    "version": "beta",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "1338"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Guest Star Session End Notification Payload  {#channel-guest-star-session-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-guest-star-session-end-event) | The event information. |

### Channel Guest Star Session End Notification Example  {#channel-guest-star-session-end-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.guest_star_session.end",
        "version": "beta",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "moderator_user_id": "1338"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:22.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "moderator_user_id": "1338",
        "moderator_user_name": "Cool_Mod",
        "moderator_user_login": "cool_mod",
        "session_id": "2KFRQbFtpmfyD3IevNRnCzOPRJI",
        "started_at": "2023-04-11T16:20:03.17106713Z",
        "ended_at": "2023-04-11T17:51:29.153485Z"
    }
}

```

### channel.guest_star_guest.update  {#channelguest_star_guestupdate}

BETA The `channel.guest_star_guest.update` subscription type sends a notification when a guest or a slot is updated in an active Guest Star session.

### Authorization  {#authorization-34}

Must have `channel:read:guest_star`, `channel:manage:guest_star`, `moderator:read:guest_star` or `moderator:manage:guest_star` scope.

### Channel Guest Star Guest Update Request Body  {#channel-guest-star-guest-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.guest_star_guest.update`. |
| `version` | String | Yes | The subscription type version: `beta`. |
| `condition` | Object | Yes | An object that contains subscription-specific parameters. |
| `broadcaster_user_id` | String | Yes | The broadcaster user ID for the channel you want to receive Guest Star guest update notifications for. |
| `moderator_user_id` | String | Yes | The user ID of the moderator or broadcaster of the specified channel. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Guest Star Guest Update Example  {#channel-guest-star-guest-update-example}

```
{
    "type": "channel.guest_star_guest.update",
    "version": "beta",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "1312"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Guest Star Guest Update Notification Payload  {#channel-guest-star-guest-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-guest-star-guest-update-event) | The event information. |

### Channel Guest Star Guest Update Notification Example  {#channel-guest-star-guest-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.guest_star_guest.update",
        "version": "beta",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "moderator_user_id": "1312"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:32.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "session_id": "2KFRQbFtpmfyD3IevNRnCzOPRJI",
        "moderator_user_id": "1312",
        "moderator_user_name": "Cool_Mod",
        "moderator_user_login": "cool_mod",
        "guest_user_id": "1234",
        "guest_user_name": "Cool_Guest",
        "guest_user_login": "cool_guest",
        "slot_id": "1",
        "state": "live",
        "host_video_enabled": true,
        "host_audio_enabled": true,
        "host_volume": 100
    }
}

```

### channel.guest_star_settings.update  {#channelguest_star_settingsupdate}

BETA The `channel.guest_star_settings.update` subscription type sends a notification when the host preferences for Guest Star have been updated.

### Authorization  {#authorization-35}

Must have `channel:read:guest_star`, `channel:manage:guest_star`, `moderator:read:guest_star` or `moderator:manage:guest_star` scope.

### Channel Guest Star Settings Update Request Body  {#channel-guest-star-settings-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.guest_star_settings.update`. |
| `version` | String | Yes | The subscription type version: `beta`. |
| `condition` | Object | Yes | An object that contains subscription-specific parameters. |
| `broadcaster_user_id` | String | Yes | The broadcaster user ID for the channel you want to receive Guest Star settings update notifications for. |
| `moderator_user_id` | String | Yes | The user ID of the moderator or broadcaster of the specified channel. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Guest Star Settings Update Example  {#channel-guest-star-settings-update-example}

```
{
    "type": "channel.guest_star_settings.update",
    "version": "beta",
    "condition": {
        "broadcaster_user_id": "1337",
        "moderator_user_id": "1312"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Guest Star Settings Update Notification Payload  {#channel-guest-star-settings-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-guest-star-settings-update-event) | The event information. |

### Channel Guest Star Settings Update Notification Example  {#channel-guest-star-settings-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.guest_star_settings.update",
        "version": "beta",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "moderator_user_id": "1312"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:52.123Z"
    },
    "event": {
        "broadcaster_user_id": "1337",
        "broadcaster_user_name": "Cool_User",
        "broadcaster_user_login": "cool_user",
        "is_moderator_send_live_enabled": true,
        "slot_count": 5,
        "is_browser_source_audio_enabled": true,
        "group_layout": "tiled"
    }
}

```

### channel.channel_points_automatic_reward_redemption.add  {#channelchannel_points_automatic_reward_redemptionadd}

The `channel.channel_points_automatic_reward_redemption.add` subscription type sends a notification when a viewer has redeemed an automatic channel points reward on the specified channel.

### Authorization  {#authorization-36}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Automatic Reward Add Request Body  {#channel-points-automatic-reward-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.channel_points_automatic_reward_redemption.add`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-automatic-reward-redemption-add-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Points Automatic Reward Redemption Add Webhook Example  {#channel-points-automatic-reward-redemption-add-webhook-example}

```
{
    "type": "channel.channel_points_automatic_reward_redemption.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "12826"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Automatic Reward Redemption Add Notification Payload  {#channel-points-automatic-reward-redemption-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-automatic-reward-redemption-add-event) | The event information. |

### Channel Points Automatic Reward Add Notification Example  {#channel-points-automatic-reward-add-notification-example}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.channel_points_automatic_reward_redemption.add",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "12826",
    "broadcaster_user_name": "Twitch",
    "broadcaster_user_login": "twitch",
    "user_id": "141981764",
    "user_name": "TwitchDev",
    "user_login": "twitchdev",
    "id": "f024099a-e0fe-4339-9a0a-a706fb59f353",
    "reward": {
      "type": "send_highlighted_message",
      "cost": 100,
      "unlocked_emote": null
    },
    "message": {
      "text": "Hello world! VoHiYo",
      "emotes": [
        {
          "id": "81274",
          "begin": 13,
          "end": 18
        }
      ]
    },
    "user_input": "Hello world! VoHiYo ",
    "redeemed_at": "2024-02-23T21:14:34.260398045Z"
  }
}

```

### channel.channel_points_automatic_reward_redemption.add V2  {#channelchannel_points_automatic_reward_redemptionadd-v2}

NEW The `channel.channel_points_automatic_reward_redemption.add` subscription type sends a notification when a viewer has redeemed an automatic channel points reward on the specified channel.

### Authorization  {#authorization-37}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Automatic Reward Add V2 Request Body  {#channel-points-automatic-reward-add-v2-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.channel_points_automatic_reward_redemption.add`. |
| `version` | String | Yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-automatic-reward-redemption-add-v2-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Points Automatic Reward Redemption Add V2 Webhook Example  {#channel-points-automatic-reward-redemption-add-v2-webhook-example}

```
{
    "type": "channel.channel_points_automatic_reward_redemption.add",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "12826"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Automatic Reward Redemption Add V2 Notification Payload  {#channel-points-automatic-reward-redemption-add-v2-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-automatic-reward-redemption-add-v2-event) | The event information. |

### Channel Points Automatic Reward Add V2 Notification Example  {#channel-points-automatic-reward-add-v2-notification-example}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.channel_points_automatic_reward_redemption.add",
    "version": "2",
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "12826",
    "broadcaster_user_name": "Twitch",
    "broadcaster_user_login": "twitch",
    "user_id": "141981764",
    "user_name": "TwitchDev",
    "user_login": "twitchdev",
    "id": "f024099a-e0fe-4339-9a0a-a706fb59f353",
    "reward": {
      "type": "send_highlighted_message",
      "channel_points": 100,
      "emote": null
    },
    "message": {
      "text": "Hello world! VoHiYo",
      "fragments": [
        {
          "type": "text",
          "text": "Hello world! ",
          "emote": null
        },
        {
          "type": "emote",
          "text": "VoHiYo",
          "emote": {
            "id": "81274"
          }
        }
      ]
    },
    "redeemed_at": "2024-08-12T21:14:34.260398045Z"
  }
}

```

### channel.channel_points_custom_reward.add  {#channelchannel_points_custom_rewardadd}

The `channel.channel_points_custom_reward.add` subscription type sends a notification when a custom channel points reward has been created for the specified channel.

### Authorization  {#authorization-38}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Custom Reward Add Request Body  {#channel-points-custom-reward-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.channel_points_custom_reward.add`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-add-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive channel points customer reward add notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Points Custom Reward Add Webhook Example  {#channel-points-custom-reward-add-webhook-example}

```
{
    "type": "channel.channel_points_custom_reward.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Custom Reward Add Notification Payload  {#channel-points-custom-reward-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-add-event) | The event information. Contains data about the custom reward added to the broadcaster’s channel. |

### Channel Points Custom Reward Add Notification Example  {#channel-points-custom-reward-add-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.channel_points_custom_reward.add",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "9001",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "is_enabled": true,
        "is_paused": false,
        "is_in_stock": true,
        "title": "Cool Reward",
        "cost": 100,
        "prompt": "reward prompt",
        "is_user_input_required": true,
        "should_redemptions_skip_request_queue": false,
        "cooldown_expires_at": null,
        "redemptions_redeemed_current_stream": null,
        "max_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "max_per_user_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "global_cooldown": {
            "is_enabled": true,
            "seconds": 1000
        },
        "background_color": "#FA1ED2",
        "image": {
            "url_1x": "https://static-cdn.jtvnw.net/image-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/image-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/image-4.png"
        },
        "default_image": {
            "url_1x": "https://static-cdn.jtvnw.net/default-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/default-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/default-4.png"
        }
    }
}

```

### channel.channel_points_custom_reward.update  {#channelchannel_points_custom_rewardupdate}

The `channel.channel_points_custom_reward.update` subscription type sends a notification when a custom channel points reward has been updated for the specified channel.

### Authorization  {#authorization-39}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Custom Reward Update Request Body  {#channel-points-custom-reward-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.channel_points_custom_reward.update`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-update-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive channel points custom reward update notifications for. You can optionally pass in a reward id to only receive notifications for a specific reward. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Points Custom Reward Update Webhook Example  {#channel-points-custom-reward-update-webhook-example}

```
{
    "type": "channel.channel_points_custom_reward.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "reward_id": "9001" // optional to only get notifications for a specific reward
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Custom Reward Update Notification Payload  {#channel-points-custom-reward-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-update-event) | The event information. Contains data about the custom reward updated on the broadcaster’s channel. |

### Channel Points Custom Reward Update Notification Example  {#channel-points-custom-reward-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.channel_points_custom_reward.update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"

        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "9001",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "is_enabled": true,
        "is_paused": false,
        "is_in_stock": true,
        "title": "Cool Reward",
        "cost": 100,
        "prompt": "reward prompt",
        "is_user_input_required": true,
        "should_redemptions_skip_request_queue": false,
        "cooldown_expires_at": "2019-11-16T10:11:12.634234626Z",
        "redemptions_redeemed_current_stream": 123,
        "max_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "max_per_user_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "global_cooldown": {
            "is_enabled": true,
            "seconds": 1000
        },
        "background_color": "#FA1ED2",
        "image": {
            "url_1x": "https://static-cdn.jtvnw.net/image-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/image-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/image-4.png"
        },
        "default_image": {
            "url_1x": "https://static-cdn.jtvnw.net/default-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/default-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/default-4.png"
        }
    }
}

```

### channel.channel_points_custom_reward.remove  {#channelchannel_points_custom_rewardremove}

The `channel.channel_points_custom_reward.remove` subscription type sends a notification when a custom channel points reward has been removed from the specified channel.

### Authorization  {#authorization-40}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Custom Reward Remove Request Body  {#channel-points-custom-reward-remove-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.channel_points_custom_reward.remove`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-remove-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive channel points custom reward remove notifications for. You can optionally pass in a reward ID to only receive notifications for a specific reward. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Points Custom Reward Remove Webhook Example  {#channel-points-custom-reward-remove-webhook-example}

```
{
    "type": "channel.channel_points_custom_reward.remove",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "reward_id": "9001" // optional to only get notifications for a specific reward
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Custom Reward Remove Notification Payload  {#channel-points-custom-reward-remove-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-remove-event) | The event information. Contains data about the custom reward removed from the broadcaster’s channel. |

### Channel Points Custom Reward Remove Notification Example  {#channel-points-custom-reward-remove-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.channel_points_custom_reward.remove",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "reward_id": 12345
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "9001",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "is_enabled": true,
        "is_paused": false,
        "is_in_stock": true,
        "title": "Cool Reward",
        "cost": 100,
        "prompt": "reward prompt",
        "is_user_input_required": true,
        "should_redemptions_skip_request_queue": false,
        "cooldown_expires_at": "2019-11-16T10:11:12.123Z",
        "redemptions_redeemed_current_stream": 123,
        "max_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "max_per_user_per_stream": {
            "is_enabled": true,
            "value": 1000
        },
        "global_cooldown": {
            "is_enabled": true,
            "seconds": 1000
        },
        "background_color": "#FA1ED2",
        "image": {
            "url_1x": "https://static-cdn.jtvnw.net/image-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/image-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/image-4.png"
        },
        "default_image": {
            "url_1x": "https://static-cdn.jtvnw.net/default-1.png",
            "url_2x": "https://static-cdn.jtvnw.net/default-2.png",
            "url_4x": "https://static-cdn.jtvnw.net/default-4.png"
        }
    }
}

```

### channel.channel_points_custom_reward_redemption.add  {#channelchannel_points_custom_reward_redemptionadd}

The `channel.channel_points_custom_reward_redemption.add` subscription type sends a notification when a viewer has redeemed a custom channel points reward on the specified channel.

### Authorization  {#authorization-41}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Custom Reward Redemption Add Request Body  {#channel-points-custom-reward-redemption-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.channel_points_custom_reward_redemption.add`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-redemption-add-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive channel points custom reward redemption notifications for. You can optionally pass in a reward id to only receive notifications for a specific reward. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Points Custom Reward Redemption Add Webhook Example  {#channel-points-custom-reward-redemption-add-webhook-example}

```
{
    "type": "channel.channel_points_custom_reward_redemption.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific reward
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Custom Reward Redemption Add Notification Payload  {#channel-points-custom-reward-redemption-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-redemption-add-event) | The event information. Contains data about the redemption of the custom reward on the broadcaster’s channel. |

### Channel Points Custom Reward Redemption Add Notification Example  {#channel-points-custom-reward-redemption-add-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.channel_points_custom_reward_redemption.add",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific reward
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "17fa2df1-ad76-4804-bfa5-a40ef63efe63",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "user_id": "9001",
        "user_login": "cooler_user",
        "user_name": "Cooler_User",
        "user_input": "pogchamp",
        "status": "unfulfilled",
        "reward": {
            "id": "92af127c-7326-4483-a52b-b0da0be61c01",
            "title": "title",
            "cost": 100,
            "prompt": "reward prompt"
        },
        "redeemed_at": "2020-07-15T17:16:03.17106713Z"
    }
}

```

### channel.channel_points_custom_reward_redemption.update  {#channelchannel_points_custom_reward_redemptionupdate}

The `channel.channel_points_custom_reward_redemption.update` subscription type sends a notification when a redemption of a channel points custom reward has been updated for the specified channel.

### Authorization  {#authorization-42}

Must have `channel:read:redemptions` or `channel:manage:redemptions` scope.

### Channel Points Custom Reward Redemption Update Request Body  {#channel-points-custom-reward-redemption-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.channel_points_custom_reward_redemption.update`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-redemption-update-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive channel points custom reward redemption update notifications for. You can optionally pass in a reward id to only receive notifications for a specific reward. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Points Custom Reward Redemption Update Webhook Example  {#channel-points-custom-reward-redemption-update-webhook-example}

```
{
    "type": "channel.channel_points_custom_reward_redemption.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific reward
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Points Custom Reward Redemption Update Notification Payload  {#channel-points-custom-reward-redemption-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-points-custom-reward-redemption-update-event) | The event information. Contains data about the custom reward redemption update from the broadcaster’s channel. |

### Channel Points Custom Reward Redemption Update Notification Example  {#channel-points-custom-reward-redemption-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.channel_points_custom_reward_redemption.update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific reward
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "17fa2df1-ad76-4804-bfa5-a40ef63efe63",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "user_id": "9001",
        "user_login": "cooler_user",
        "user_name": "Cooler_User",
        "user_input": "pogchamp",
        "status": "fulfilled",  // Either fulfilled or cancelled
        "reward": {
            "id": "92af127c-7326-4483-a52b-b0da0be61c01",
            "title": "title",
            "cost": 100,
            "prompt": "reward prompt"
        },
        "redeemed_at": "2020-07-15T17:16:03.17106713Z"
    }
}

```

### channel.custom_power_up_redemption.add  {#channelcustom_power_up_redemptionadd}

The `channel.custom_power_up_redemption.add` subscription type sends a notification when a viewer has redeemed a custom Power-up on the specified channel.

### Authorization  {#authorization-43}

Must have `bits:read` scope.

### Channel Custom Power-up Redemption Add Request Body  {#channel-custom-power-up-redemption-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.custom_power_up_redemption.add`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-custom-power-up-redemption-add-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive custom Power-up redemption notifications for. You can optionally pass in a Power-up id to only receive notifications for a specific Power-up. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Custom Power-up Redemption Add Webhook Example  {#channel-custom-power-up-redemption-add-webhook-example}

```
{
    "type": "channel.custom_power_up_redemption.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337",
        "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific Power-up
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Custom Power-up Redemption Add Notification Payload  {#channel-custom-power-up-redemption-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-custom-power-up-redemption-add-event) | The event information. Contains data about the redemption of the custom Power-up on the broadcaster’s channel. |

### Channel Custom Power-up Redemption Add Notification Example  {#channel-custom-power-up-redemption-add-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.custom_power_up_redemption.add",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337",
            "reward_id": "92af127c-7326-4483-a52b-b0da0be61c01" // optional; gets notifications for a specific Power-up
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2026-05-01T10:11:12.634234626Z"
    },
    "event": {
        "id": "17fa2df1-ad76-4804-bfa5-a40ef63efe63",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "user_id": "9001",
        "user_login": "cooler_user",
        "user_name": "Cooler_User",
        "user_input": "pogchamp",
        "status": "unfulfilled",
        "custom_power_up": {
            "id": "92af127c-7326-4483-a52b-b0da0be61c01",
            "title": "title",
            "bits": 100,
            "prompt": "Power-up prompt"
        },
        "redeemed_at": "2026-05-01T17:16:03.17106713Z"
    }
}

```

### channel.poll.begin  {#channelpollbegin}

The `channel.poll.begin` subscription type sends a notification when a poll begins on the specified channel.

### Authorization  {#authorization-44}

Must have `channel:read:polls` or `channel:manage:polls` scope.

### Channel Poll Begin Request Body  {#channel-poll-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.poll.begin`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-poll-begin-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive poll begin notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Poll Begin Example  {#channel-poll-begin-example}

```
{
    "type": "channel.poll.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Poll Begin Notification Payload  {#channel-poll-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-poll-begin-event) | The event information. |

### Channel Poll Begin Notification Example  {#channel-poll-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.poll.begin",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1243456",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "title": "Aren’t shoes just really hard socks?",
        "choices": [
            {"id": "123", "title": "Yeah!"},
            {"id": "124", "title": "No!"},
            {"id": "125", "title": "Maybe!"}
        ],
        "bits_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "channel_points_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "ends_at": "2020-07-15T17:16:08.17106713Z"
    }
}

```

### channel.poll.progress  {#channelpollprogress}

The `channel.poll.progress` subscription type sends a notification when users respond to a poll on the specified channel.

### Authorization  {#authorization-45}

Must have `channel:read:polls` or `channel:manage:polls` scope.

### Channel Poll Progress Request Body  {#channel-poll-progress-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.poll.progress`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-poll-progress-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive poll progress notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Poll Progress Example  {#channel-poll-progress-example}

```
{
    "type": "channel.poll.progress",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Poll Progress Notification Payload  {#channel-poll-progress-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-poll-progress-event) | The event information. |

### Channel Poll Progress Notification Example  {#channel-poll-progress-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.poll.progress",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1243456",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "title": "Aren’t shoes just really hard socks?",
        "choices": [
            {"id": "123", "title": "Yeah!", "bits_votes": 5, "channel_points_votes": 7, "votes": 12},
            {"id": "124", "title": "No!", "bits_votes": 10, "channel_points_votes": 4, "votes": 14},
            {"id": "125", "title": "Maybe!", "bits_votes": 0, "channel_points_votes": 7, "votes": 7}
        ],
        "bits_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "channel_points_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "ends_at": "2020-07-15T17:16:08.17106713Z"
    }
}

```

### channel.poll.end  {#channelpollend}

The `channel.poll.end` subscription type sends a notification when a poll ends on the specified channel.

### Authorization  {#authorization-46}

Must have `channel:read:polls` or `channel:manage:polls` scope.

### Channel Poll End Request Body  {#channel-poll-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.poll.end`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-poll-end-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive poll end notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Poll End Example  {#channel-poll-end-example}

```
{
    "type": "channel.poll.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Poll End Notification Payload  {#channel-poll-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-poll-end-event) | The event information. |

### Channel Poll End Notification Example  {#channel-poll-end-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.poll.end",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1243456",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "title": "Aren’t shoes just really hard socks?",
        "choices": [
            {"id": "123", "title": "Blue", "bits_votes": 50, "channel_points_votes": 70, "votes": 120},
            {"id": "124", "title": "Yellow", "bits_votes": 100, "channel_points_votes": 40, "votes": 140},
            {"id": "125", "title": "Green", "bits_votes": 10, "channel_points_votes": 70, "votes": 80}
        ],
        "bits_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "channel_points_voting": {
            "is_enabled": true,
            "amount_per_vote": 10
        },
        "status": "completed",
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "ended_at": "2020-07-15T17:16:11.17106713Z"
    }
}

```

### channel.prediction.begin  {#channelpredictionbegin}

The `channel.prediction.begin` subscription type sends a notification when a Prediction begins on the specified channel.

### Authorization  {#authorization-47}

Must have `channel:read:predictions` or `channel:manage:predictions` scope.

### Channel Prediction Begin Request Body  {#channel-prediction-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.prediction.begin`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-prediction-begin-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive prediction begin notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Prediction Begin Example  {#channel-prediction-begin-example}

```
{
    "type": "channel.prediction.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Prediction Begin Notification Payload  {#channel-prediction-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-prediction-begin-event) | The event information. |

### Channel Prediction Begin Notification Example  {#channel-prediction-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.prediction.begin",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1243456",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "title": "Aren’t shoes just really hard socks?",
        "outcomes": [
            {"id": "1243456", "title": "Yeah!", "color": "blue"},
            {"id": "2243456", "title": "No!", "color": "pink"},
        ],
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "locks_at": "2020-07-15T17:21:03.17106713Z"
    }
}

```

### channel.prediction.progress  {#channelpredictionprogress}

The `channel.prediction.progress` subscription type sends a notification when users participate in a Prediction on the specified channel.

### Authorization  {#authorization-48}

Must have `channel:read:predictions` or `channel:manage:predictions` scope.

### Channel Prediction Progress Request Body  {#channel-prediction-progress-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.prediction.progress`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-prediction-progress-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive prediction progress notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Prediction Progress Example  {#channel-prediction-progress-example}

```
{
    "type": "channel.prediction.progress",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Prediction Progress Notification Payload  {#channel-prediction-progress-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-prediction-progress-event) | The event information. |

### Channel Prediction Progress Notification Example  {#channel-prediction-progress-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.prediction.progress",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
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
                "top_predictors": [ // contains up to 10 users
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
                "top_predictors": [ // contains up to 10 users
                    {
                        "user_name": "Cooler_User",
                        "user_login": "cooler_user",
                        "user_id": 12345,
                        "channel_points_won": null,
                        "channel_points_used": 5000
                    }
                ]
            },
        ],
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "locks_at": "2020-07-15T17:21:03.17106713Z"
    }
}

```

### channel.prediction.lock  {#channelpredictionlock}

The `channel.prediction.lock` subscription type sends a notification when a Prediction is locked on the specified channel.

### Authorization  {#authorization-49}

Must have `channel:read:predictions` or `channel:manage:predictions` scope.

### Channel Prediction Lock Request Body  {#channel-prediction-lock-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.prediction.lock`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-prediction-lock-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive prediction lock notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Prediction Lock Example  {#channel-prediction-lock-example}

```
{
    "type": "channel.prediction.lock",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Prediction Lock Notification Payload  {#channel-prediction-lock-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-prediction-lock-event) | The event information. |

### Channel Prediction Lock Notification Example  {#channel-prediction-lock-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.prediction.lock",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
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
                "top_predictors": [ // contains up to 10 users
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
                "top_predictors": [ // contains up to 10 users
                    {
                        "user_name": "Cooler_User",
                        "user_login": "cooler_user",
                        "user_id": 12345,
                        "channel_points_won": null,
                        "channel_points_used": 5000
                    }
                ]
            },
        ],
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "locked_at": "2020-07-15T17:21:03.17106713Z"
    }
}

```

### channel.prediction.end  {#channelpredictionend}

The `channel.prediction.end` subscription type sends a notification when a Prediction ends on the specified channel.

### Authorization  {#authorization-50}

Must have `channel:read:predictions` or `channel:manage:predictions` scope.

### Channel Prediction End Request Body  {#channel-prediction-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.prediction.end`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-prediction-end-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to receive prediction lock notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Prediction End Example  {#channel-prediction-end-example}

```
{
    "type": "channel.prediction.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Prediction End Notification Payload  {#channel-prediction-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-prediction-end-event) | The event information. |

### Channel Prediction End Notification Example  {#channel-prediction-end-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.prediction.end",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
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
                "color": "blue", // can be blue or pink
                "users": 2,
                "channel_points": 15000,
                "top_predictors": [ // contains up to 10 users
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
                    },
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
                        "channel_points_won": null, // null if result is refund or loss
                        "channel_points_used": 100
                    },
                    {
                        "user_name": "Elite_User",
                        "user_login": "elite_user",
                        "user_id": 1337,
                        "channel_points_won": null, // null if result is refund or loss
                        "channel_points_used": 100
                    }
                ]
            }
        ],
        "status": "resolved", // valid values: resolved, canceled
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "ended_at": "2020-07-15T17:16:11.17106713Z"
    }
}

```

### channel.suspicious_user.update  {#channelsuspicious_userupdate}

NEW The `channel.suspicious_user.update` subscription type sends a notification when a suspicious user has been updated.

### Authorization  {#authorization-51}

Requires the `moderator:read:suspicious_users` scope. If you use webhooks, the user in moderator_user_id must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the [Authentication section](/docs/authentication/) of Create EventSub Subscription.

If you use WebSockets, the ID in `moderator_user_id` must match the user ID in the user access token.

### Channel Suspicious User Update Request Body  {#channel-suspicious-user-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.suspicious_user.update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-suspicious-user-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Suspicious User Update Webhook Example  {#suspicious-user-update-webhook-example}

```
{
    "type": "channel.suspicious_user.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1050263435",
        "moderator_user_id": "1050263436"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Suspicious User Update Notification Payload  {#suspicious-user-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-suspicious-user-update-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.suspicious_user.update",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1050263435",
      "moderator_user_id": "1050263436"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "1050263435",
    "broadcaster_user_name": "77f111cbb75341449f5",
    "broadcaster_user_login": "77f111cbb75341449f5",
    "moderator_user_id": "1050263436",
    "moderator_user_name": "29087e59dfc441968f6",
    "moderator_user_login": "29087e59dfc441968f6",
    "user_id": "1050263437",
    "user_name": "06fbcc75952245c5a87",
    "user_login": "06fbcc75952245c5a87",
    "low_trust_status": "restricted"
  }
}

```

### channel.suspicious_user.message  {#channelsuspicious_usermessage}

NEW The `channel.suspicious_user.message` subscription type sends a notification when a chat message has been sent from a suspicious user.

### Authorization  {#authorization-52}

Requires the `moderator:read:suspicious_users` scope.

If you use webhooks, the user in `moderator_user_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the [Authentication section](/docs/authentication/) of Create EventSub Subscription.

If you use WebSockets, the ID in `moderator_user_id` must match the user ID in the user access token.

### Suspicious User Message Request Body  {#suspicious-user-message-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.suspicious_user.message`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-suspicious-user-message-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Suspicious User Message Webhook Example  {#suspicious-user-message-webhook-example}

```
{
    "type": "channel.suspicious_user.message",
    "version": "1",
    "condition": {
        "moderator_user_id": "9001",
        "broadcaster_user_id": "1050263432"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Suspicious User Message Notification Payload  {#suspicious-user-message-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-suspicious-user-message-event) | The event information. |

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.suspicious_user.message",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "moderator_user_id": "9001",
      "broadcaster_user_id": "1050263432"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "1050263432",
    "broadcaster_user_name": "dcf9dd9336034d23b65",
    "broadcaster_user_login": "dcf9dd9336034d23b65",
    "user_id": "1050263434",
    "user_name": "4a46e2cf2e2f4d6a9e6",
    "user_login": "4a46e2cf2e2f4d6a9e6",
    "low_trust_status": "active_monitoring",
    "shared_ban_channel_ids": [
      "100",
      "200"
    ],
    "types": [
      "ban_evader"
    ],
    "ban_evasion_evaluation": "likely",
    "message": {
      "message_id": "101010",
      "text": "bad stuff pogchamp",
      "fragments": [
        {
          "type": "emote",
          "text": "bad stuff",
          "cheermote": null,
          "emote": {
            "id": "899",
            "emote_set_id": "1"
          }
        },
        {
          "type": "cheermote",
          "text": "pogchamp",
          "cheermote": {
            "prefix": "pogchamp",
            "bits": 100,
            "tier": 1
          },
          "emote": null
        }
      ]
    }
  }
}

```

### channel.vip.add  {#channelvipadd}

NEW The `channel.vip.add` subscription type sends a notification when a VIP is added to the channel.

### Authorization  {#authorization-53}

Must have `channel:read:vips` or `channel:manage:vips` scope.

### Channel VIP Add Request Body  {#channel-vip-add-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.vip.add`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-vip-add-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel VIP Add Webhook Example  {#channel-vip-add-webhook-example}

```
{
    "type": "channel.vip.add",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel VIP Add Notification Payload  {#channel-vip-add-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-vip-add-event) | The event information. |

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.vip.add",
    "version": "1",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "user_id": "1234",
    "user_login": "mod_user",
    "user_name": "Mod_User",
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "cooler_user",
    "broadcaster_user_name": "Cooler_User"
  }
}

```

### channel.vip.remove  {#channelvipremove}

NEW The `channel.vip.remove` subscription type sends a notification when a VIP is removed from the channel.

### Authorization  {#authorization-54}

Must have `channel:read:vips` or `channel:manage:vips` scope.

### Channel VIP Remove Request Body  {#channel-vip-remove-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.vip.remove`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-vip-remove-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel VIP Remove Webhook Example  {#channel-vip-remove-webhook-example}

```
{
    "type": "channel.vip.remove",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel VIP Remove Notification Payload  {#channel-vip-remove-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-vip-remove-event) | The event information. |

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.vip.remove",
    "version": "1",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "1337"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "user_id": "1234",
    "user_login": "mod_user",
    "user_name": "Mod_User",
    "broadcaster_user_id": "1337",
    "broadcaster_user_login": "cooler_user",
    "broadcaster_user_name": "Cooler_User"
  }
}

```

### channel.warning.acknowledge  {#channelwarningacknowledge}

NEW The `channel.warning.acknowledge` subscription type sends a notification when a warning is acknowledged by a user. Broadcasters and moderators can see the warning’s details.

### Authorization  {#authorization-55}

Must have the `moderator:read:warnings` or `moderator:manage:warnings` scope.

### Channel Warning Acknowledge Request Body  {#channel-warning-acknowledge-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.warning.acknowledge`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-warning-acknowledge-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Warning Acknowledge Webhook Example  {#channel-warning-acknowledge-webhook-example}

```
{
    "type": "channel.warning.acknowledge",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "423374343",
        "moderator_user_id": "424596340"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Warning Acknowledge Notification Payload  {#channel-warning-acknowledge-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-warning-acknowledge-event) | Event information. Contains information about the warned user. |

### Channel Warning Acknowledge Notification Payload Example  {#channel-warning-acknowledge-notification-payload-example}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.warning.acknowledge",
    "version": "1",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "423374343",
      "moderator_user_id": "424596340"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "423374343",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "user_id": "141981764",
    "user_login": "twitchdev",
    "user_name": "TwitchDev"
  }
}

```

### channel.warning.send  {#channelwarningsend}

NEW The `channel.warning.send` subscription type sends a notification when a warning is sent to a user. Broadcasters and moderators can see the warning’s details.

### Authorization  {#authorization-56}

Must have the `moderator:read:warnings` or `moderator:manage:warnings` scope.

### Channel Warning Send Request Body  {#channel-warning-send-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.warning.send`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-warning-send-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Warning Send Webhook Example  {#channel-warning-send-webhook-example}

```
{
    "type": "channel.warning.send",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "423374343",
        "moderator_user_id": "424596340"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Warning Send Notification Payload  {#channel-warning-send-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-warning-send-event) | Event information. Contains information about the warning including the user, the reason for the warning, and the cited rules for reference. |

### Channel Warning Send Notification Payload Example  {#channel-warning-send-notification-payload-example}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.warning.send",
    "version": "1",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "423374343",
      "moderator_user_id": "424596340"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "423374343",
    "broadcaster_user_login": "glowillig",
    "broadcaster_user_name": "glowillig",
    "moderator_user_id": "424596340",
    "moderator_user_login": "quotrok",
    "moderator_user_name": "quotrok",
    "user_id": "141981764",
    "user_login": "twitchdev",
    "user_name": "TwitchDev",
    "reason": "cut it out",
    "chat_rules_cited": null
  }
}

```

### channel.hype_train.begin  {#channelhype_trainbegin}

The `channel.hype_train.begin` subscription type sends a notification when a Hype Train begins on the specified channel. In addition to a `channel.hype_train.begin` event, one `channel.hype_train.progress` event will be sent for each contribution that caused the Hype Train to begin. EventSub does not make strong assurances about the order of message delivery, so it is possible to receive `channel.hype_train.progress` notifications before you receive the corresponding `channel.hype_train.begin` notification.

After the Hype Train begins, any additional cheers or subscriptions on the channel will cause `channel.hype_train.progress` notifications to be sent. When the Hype Train is over, `channel.hype_train.end` is emitted.

### Authorization  {#authorization-57}

Must have `channel:read:hype_train` scope.

### Channel Hype Train Begin Request Body  {#channel-hype-train-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.hype_train.begin`. |
| `version` | string | yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#hype-train-begin-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to Hype Train begin notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Hype Train Begin Webhook Example  {#channel-hype-train-begin-webhook-example}

```
{
    "type": "channel.hype_train.begin",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Hype Train Begin Notification Payload  {#channel-hype-train-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#hype-train-begin-event) | Event information. Contains Hype Train information like the level, goal, top contributors, start time, and expiration time. |

### Channel Hype Train Begin Notification Example  {#channel-hype-train-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.hype_train.begin",
        "version": "2",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "total": 137,
        "progress": 137,
        "goal": 500,
        "top_contributions": [
            {
                "user_id": "123",
                "user_login": "pogchamp",
                "user_name": "PogChamp",
                "type": "bits",
                "total": 50
            }
        ],
        "shared_train_participants": null,
        "level": 1,
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "expires_at": "2020-07-15T17:16:11.17106713Z",
        "is_shared_train": false,
        "type": "regular",
        "all_time_high_level": 4,
        "all_time_high_total": 2845
    }
}

```

### channel.hype_train.progress  {#channelhype_trainprogress}

The `channel.hype_train.progress` subscription type sends a notification when a Hype Train makes progress on the specified channel. `channel.hype_train.progress` notifications are sent periodically while a Hype Train is making progress. EventSub does not make strong assurances about the order of message delivery, so it is possible to receive `channel.hype_train.progress` before you receive the corresponding `channel.hype_train.begin`.

When the Hype Train is over, `channel.hype_train.end` is emitted.

### Authorization  {#authorization-58}

Must have `channel:read:hype_train` scope.

### Channel Hype Train Progress Request Body  {#channel-hype-train-progress-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.hype_train.progress`. |
| `version` | string | yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#hype-train-progress-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to Hype Train progress notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Hype Train Progress Webhook Example  {#channel-hype-train-progress-webhook-example}

```
{
    "type": "channel.hype_train.progress",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Hype Train Progress Notification Payload  {#channel-hype-train-progress-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#hype-train-progress-event) | Event information. Contains Hype Train information like the level, goal, top contributors, last contribution, start time, and expiration time. |

### Channel Hype Train Progress Notification Example  {#channel-hype-train-progress-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.hype_train.progress",
        "version": "2",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "total": 137,
        "progress": 137,
        "goal": 500,
        "top_contributions": [
            {
                "user_id": "123",
                "user_login": "pogchamp",
                "user_name": "PogChamp",
                "type": "bits",
                "total": 50
            }
        ],
        "shared_train_participants": null,
        "level": 1,
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "expires_at": "2020-07-15T17:16:11.17106713Z",
        "is_shared_train": false,
        "type": "regular"
    }
}

```

### channel.hype_train.end  {#channelhype_trainend}

The `channel.hype_train.end` subscription type sends a notification when a Hype Train ends on the specified channel.

### Authorization  {#authorization-59}

Must have `channel:read:hype_train` scope.

### Channel Hype Train End Request Body  {#channel-hype-train-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.hype_train.end`. |
| `version` | string | yes | The subscription type version: `2`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#hype-train-end-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to Hype Train end notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Channel Hype Train End Webhook Example  {#channel-hype-train-end-webhook-example}

```
{
    "type": "channel.hype_train.end",
    "version": "2",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Hype Train End Notification Payload  {#channel-hype-train-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#hype-train-end-event) | Event information. Contains Hype Train information like the level, top contributors, start time, end time, and cooldown end time. |

### Channel Hype Train End Notification Example  {#channel-hype-train-end-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.hype_train.end",
        "version": "2",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "1b0AsbInCHZW2SQFQkCzqN07Ib2",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "total": 137,
        "top_contributions": [
            {
                "user_id": "123",
                "user_login": "pogchamp",
                "user_name": "PogChamp",
                "type": "bits",
                "total": 50
            }
        ],
        "shared_train_participants": null,
        "level": 1,
        "started_at": "2020-07-15T17:16:03.17106713Z",
        "ended_at": "2020-07-15T17:16:11.17106713Z",
        "cooldown_ends_at": "2020-07-16T17:16:11.17106713Z",
        "is_shared_train": false,
        "type": "regular"
    }
}

```

### channel.charity_campaign.donate  {#channelcharity_campaigndonate}

Sends a notification when a user donates to the broadcaster’s charity campaign.

### Authorization  {#authorization-60}

Requires the **channel:read:charity** scope.

### Request Body  {#request-body}

The following table describes the JSON object that you pass in the body of the request when you [create the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.charity_campaign.donate**. |
| version | String | Yes | The subscription type version: `1` |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when users donate to their campaign. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example}

```
{
    "type": "channel.charity_campaign.donate",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "123456"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#charity-donation-event) | The donation event’s data. |

### Notification Example  {#notification-example}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.charity_campaign.donate",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "123456"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.123Z"
  },
  "event": {
    "id": "a1b2c3-aabb-4455-d1e2f3",
    "campaign_id": "123-abc-456-def",
    "broadcaster_user_id": "123456",
    "broadcaster_user_name": "SunnySideUp",
    "broadcaster_user_login": "sunnysideup",
    "user_id": "654321",
    "user_login": "generoususer1",
    "user_name": "GenerousUser1",
    "charity_name": "Example name",
    "charity_description": "Example description",
    "charity_logo": "https://abc.cloudfront.net/ppgf/1000/100.png",
    "charity_website": "https://www.example.com",
    "amount": {
      "value": 10000,
      "decimal_places": 2,
      "currency": "USD"
    }
  }
}

```

### channel.charity_campaign.start  {#channelcharity_campaignstart}

Sends a notification when the broadcaster starts a charity campaign.

It’s possible to receive this event after the Progress event.

### Authorization  {#authorization-61}

Requires the **channel:read:charity** scope.

### Request Body  {#request-body-1}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.charity_campaign.start**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they start a charity campaign. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-1}

```
{
    "type": "channel.charity_campaign.start",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "123456"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-1}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#charity-campaign-start-event) | The event’s data. |

### Notification Example  {#notification-example-1}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.charity_campaign.start",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "123456"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.12339824Z"
  },
  "event": {
    "id": "123-abc-456-def",
    "broadcaster_id": "123456",
    "broadcaster_name": "SunnySideUp",
    "broadcaster_login": "sunnysideup",
    "charity_name": "Example name",
    "charity_description": "Example description",
    "charity_logo": "https://abc.cloudfront.net/ppgf/1000/100.png",
    "charity_website": "https://www.example.com",
    "current_amount": {
      "value": 0,
      "decimal_places": 2,
      "currency": "USD"
    },
    "target_amount": {
      "value": 1500000,
      "decimal_places": 2,
      "currency": "USD"
    },
    "started_at": "2022-07-26T17:00:03.17106713Z"
  }
}

```

### channel.charity_campaign.progress  {#channelcharity_campaignprogress}

Sends notifications when progress is made towards the campaign’s goal or when the broadcaster changes the fundraising goal.

It’s possible to receive this event before the Start event.

To get donation information, subscribe to the channel.charity_campaign.donate event.

### Authorization  {#authorization-62}

Requires the **channel:read:charity** scope.

### Request Body  {#request-body-2}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.charity_campaign.progress**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when their campaign makes progress or is updated. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-2}

```
{
    "type": "channel.charity_campaign.progress",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "123456"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-2}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#charity-campaign-progress-event) | The event’s data. |

### Notification Example  {#notification-example-2}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.charity_campaign.progress",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "123456"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.12339824Z"
  },
  "event": {
    "id": "123-abc-456-def",
    "broadcaster_id": "123456",
    "broadcaster_name": "SunnySideUp",
    "broadcaster_login": "sunnysideup",
    "charity_name": "Example name",
    "charity_description": "Example description",
    "charity_logo": "https://abc.cloudfront.net/ppgf/1000/100.png",
    "charity_website": "https://www.example.com",
    "current_amount": {
      "value": 260000,
      "decimal_places": 2,
      "currency": "USD"
    },
    "target_amount": {
      "value": 1500000,
      "decimal_places": 2,
      "currency": "USD"
    }
  }
}

```

### channel.charity_campaign.stop  {#channelcharity_campaignstop}

Sends a notification when the broadcaster stops a charity campaign.

### Authorization  {#authorization-63}

Requires the **channel:read:charity** scope.

### Request Body  {#request-body-3}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.charity_campaign.stop**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they stop a charity campaign. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-3}

```
{
    "type": "channel.charity_campaign.stop",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "123456"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-3}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#charity-campaign-stop-event) | The event’s data. |

### Notification Example  {#notification-example-3}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.charity_campaign.stop",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "123456"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.12339824Z"
  },
  "event": {
    "id": "123-abc-456-def",
    "broadcaster_id": "123456",
    "broadcaster_name": "SunnySideUp",
    "broadcaster_login": "sunnysideup",
    "charity_name": "Example name",
    "charity_description": "Example description",
    "charity_logo": "https://abc.cloudfront.net/ppgf/1000/100.png",
    "charity_website": "https://www.example.com",
    "current_amount": {
      "value": 1450000,
      "decimal_places": 2,
      "currency": "USD"
    },
    "target_amount": {
      "value": 1500000,
      "decimal_places": 2,
      "currency": "USD"
    },
    "stopped_at": "2022-07-26T22:00:03.17106713Z"
  }
}

```

### channel.shared_chat.begin  {#channelshared_chatbegin}

NEW The `channel.shared_chat.begin` subscription type sends a notification when a channel becomes active in an active shared chat session.

### Authorization  {#authorization-64}

No authorization required.

### Channel Shared Chat Session Begin Request Body  {#channel-shared-chat-session-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.shared_chat.begin`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-begin-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Shared Chat Session Begin Webhook Example  {#channel-shared-chat-session-begin-webhook-example}

```
{
    "type": "channel.shared_chat.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1971641"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Shared Chat Session Begin Notification Payload  {#channel-shared-chat-session-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-begin-event) | The event information. |

### Shared Chat Session Begin Payload Example  {#shared-chat-session-begin-payload-example}

```
{
  "subscription": {
    "id": "bf0602d2-5b39-4ece-b1a4-44191d52df6b",
    "status": "enabled",
    "type": "channel.shared_chat.begin",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h"
    },
    "created_at": "2023-10-06T18:04:38.807682738Z",
    "cost": 0
  },
  "event": {
    "session_id": "2b64a92a-dbb8-424e-b1c3-304423ba1b6f",
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "host_broadcaster_user_id": "1971641",
    "host_broadcaster_user_login": "streamer",
    "host_broadcaster_user_name": "streamer",
    "participants": [
      {
        "broadcaster_user_id": "1971641",
        "broadcaster_user_name": "streamer",
        "broadcaster_user_login": "streamer"
      },
      {
        "broadcaster_user_id": "112233",
        "broadcaster_user_name": "streamer33",
        "broadcaster_user_login": "streamer33"
      }
    ]
  }
}

```

### channel.shared_chat.update  {#channelshared_chatupdate}

NEW The `channel.shared_chat.update` subscription type sends a notification when the active shared chat session the channel is in changes.

### Authorization  {#authorization-65}

No authorization required.

### Channel Shared Chat Session Update Request Body  {#channel-shared-chat-session-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.shared_chat.update`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-update-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Shared Chat Session Update Webhook Example  {#channel-shared-chat-session-update-webhook-example}

```
{
    "type": "channel.shared_chat.update",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1971641"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Shared Chat Session Update Notification Payload  {#channel-shared-chat-session-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-update-event) | The event information. |

### Channel Shared Chat Session Update Payload Example  {#channel-shared-chat-session-update-payload-example}

```
{
  "subscription": {
    "id": "5f65d0a7-0069-4f2b-944b-bc81b160ae49",
    "status": "enabled",
    "type": "channel.shared_chat.update",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "1971641"
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h"
    },
    "created_at": "2023-10-06T18:04:38.807682738Z",
    "cost": 0
  },
  "event": {
    "session_id": "2b64a92a-dbb8-424e-b1c3-304423ba1b6f",
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "host_broadcaster_user_id": "1971641",
    "host_broadcaster_user_login": "streamer",
    "host_broadcaster_user_name": "streamer",
    "participants": [
      {
        "broadcaster_user_id": "1971641",
        "broadcaster_user_name": "streamer",
        "broadcaster_user_login": "streamer"
      },
      {
        "broadcaster_user_id": "112233",
        "broadcaster_user_name": "streamer33",
        "broadcaster_user_login": "streamer33"
      },
      {
        "broadcaster_user_id": "332211",
        "broadcaster_user_name": "streamer11",
        "broadcaster_user_login": "streamer11"
      }
    ]
  }
}

```

### channel.shared_chat.end  {#channelshared_chatend}

NEW The `channel.shared_chat.end` subscription type sends a notification when a channel leaves a shared chat session or the session ends.

### Authorization  {#authorization-66}

No authorization required.

### Channel Shared Chat Session End Request Body  {#channel-shared-chat-session-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `channel.shared_chat.end`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-end-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Channel Shared Chat Session End Webhook Example  {#channel-shared-chat-session-end-webhook-example}

```
{
    "type": "channel.shared_chat.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1971641"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Channel Shared Chat Session End Notification Payload  {#channel-shared-chat-session-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#channel-shared-chat-session-end-event) | The event information. |

### Channel Shared Chat Session End Payload Example  {#channel-shared-chat-session-end-payload-example}

```
{
  "subscription": {
    "id": "84a875f1-1dc0-43b2-8ed3-d7db4d650c37",
    "status": "enabled",
    "type": "channel.shared_chat.end",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "112233",
    },
    "transport": {
      "method": "websocket",
      "session_id": "AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h"
    },
    "created_at": "2023-10-06T18:04:38.807682738Z",
    "cost": 0
  },
  "event": {
    "session_id": "2b64a92a-dbb8-424e-b1c3-304423ba1b6f",
    "broadcaster_user_id": "1971641",
    "broadcaster_user_login": "streamer",
    "broadcaster_user_name": "streamer",
    "host_broadcaster_user_id": "1971641",
    "host_broadcaster_user_login": "streamer",
    "host_broadcaster_user_name": "streamer"
  }
}

```

### channel.shield_mode.begin  {#channelshield_modebegin}

Sends a notification when the broadcaster activates Shield Mode.

This event informs the subscriber that the broadcaster’s moderation settings were changed based on the broadcaster’s Shield Mode configuration settings.

### Authorization  {#authorization-67}

Requires the **moderator:read:shield_mode** or **moderator:manage:shield_mode** scope.

If you use [webhooks](/docs/eventsub/handling-webhook-events), the user in `moderator_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the Authorization section of [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription).

If you use [WebSockets](/docs/eventsub/handling-websocket-events), the ID in `moderator_id` must match the user ID in the user access token.

### Request Body  {#request-body-4}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.shield_mode.begin**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they activate Shield Mode. |
| moderator_user_id | String | Yes | The ID of the broadcaster or one of the broadcaster’s moderators. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-4}

```
{
    "type": "channel.shield_mode.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "12345",
        "moderator_user_id": "98765"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-4}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#shield-mode) | The event’s data. |

### Notification Example  {#notification-example-4}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.shield_mode.begin",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "12345",
      "moderator_user_id": "98765"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.1236739Z"
  },
  "event": {
    "broadcaster_user_id": "12345",
    "broadcaster_user_name": "SimplySimple",
    "broadcaster_user_login": "simplysimple",
    "moderator_user_id": "98765",
    "moderator_user_name": "ParticularlyParticular123",
    "moderator_user_login": "particularlyparticular123",
    "started_at": "2022-07-26T17:00:03.17106713Z"
  }
}

```

### channel.shield_mode.end  {#channelshield_modeend}

Sends a notification when the broadcaster deactivates Shield Mode.

This event informs the subscriber that the broadcaster’s moderation settings were changed back to the broadcaster’s previous moderation settings.

### Authorization  {#authorization-68}

Requires the **moderator:read:shield_mode** or **moderator:manage:shield_mode** scope.

If you use [webhooks](/docs/eventsub/handling-webhook-events), the user in `moderator_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the Authorization section of [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription).

If you use [WebSockets](/docs/eventsub/handling-websocket-events), the ID in `moderator_id` must match the user ID in the user access token.

### Request Body  {#request-body-5}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.shield_mode.end**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they deactivate Shield Mode. |
| moderator_user_id | String | Yes | The ID of the broadcaster or one of the broadcaster’s moderators. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-5}

```
{
    "type": "channel.shield_mode.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "12345",
        "moderator_user_id": "98765"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-5}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#shield-mode) | The event’s data. |

### Notification Example  {#notification-example-5}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.shield_mode.end",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "12345",
      "moderator_user_id": "98765"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.1236739Z"
  },
  "event": {
    "broadcaster_user_id": "12345",
    "broadcaster_user_name": "SimplySimple",
    "broadcaster_user_login": "simplysimple",
    "moderator_user_id": "98765",
    "moderator_user_name": "ParticularlyParticular123",
    "moderator_user_login": "particularlyparticular123",
    "ended_at": "2022-07-27T01:30:23.17106713Z"
  }
}

```

### channel.shoutout.create  {#channelshoutoutcreate}

Sends a notification when the specified broadcaster sends a Shoutout.

### Authorization  {#authorization-69}

Requires the **moderator:read:shoutouts** or **moderator:manage:shoutouts** scope.

If you use [webhooks](/docs/eventsub/handling-webhook-events), the user in `moderator_user_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the Authorization section of [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription).

If you use [WebSockets](/docs/eventsub/handling-websocket-events), the ID in `moderator_user_id` must match the user ID in the user access token.

### Request Body  {#request-body-6}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.shoutout.create**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they send a Shoutout. |
| moderator_user_id | String | Yes | The ID of the broadcaster that gave the Shoutout or one of the broadcaster’s moderators. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-6}

```
{
    "type": "channel.shoutout.create",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "12345",
        "moderator_user_id": "98765"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-6}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference#shoutout-create) | The event’s data. |

### Notification Example  {#notification-example-6}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.shoutout.create",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "12345",
      "moderator_user_id": "98765"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.1236739Z"
  },
  "event": {
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
    "target_cooldown_ends_at":"2022-07-26T18:00:03.17106713Z"
  }
}

```

### channel.shoutout.receive  {#channelshoutoutreceive}

Sends a notification when the specified broadcaster receives a Shoutout.

**NOTE** Sent only if Twitch posts the Shoutout to the broadcaster’s activity feed.

### Authorization  {#authorization-70}

Requires the **moderator:read:shoutouts** or **moderator:manage:shoutouts** scope.

If you use [webhooks](/docs/eventsub/handling-webhook-events), the user in `moderator_user_id` must have granted your app (client ID) one of the above permissions prior to your app subscribing to this subscription type. To learn more, see the Authorization section of [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription).

If you use [WebSockets](/docs/eventsub/handling-websocket-events), the ID in `moderator_user_id` must match the user ID in the user access token.

### Request Body  {#request-body-7}

The following table describes the JSON object that you pass in the body of the request when [creating the subscription](/docs/api/reference#create-eventsub-subscription).

| Field | Type | Required? | Description |
|---|---|---|---|
| type | String | Yes | The event you want to receive notifications about. Must be set to **channel.shoutout.receive**. |
| version | String | Yes | The definition of the subscription request to use. Must be set to **1**. |
| condition | Object | Yes | An object that contains subscription-specific parameters. |
| broadcaster_user_id | String | Yes | The ID of the broadcaster that you want to receive notifications about when they receive a Shoutout. |
| moderator_user_id | String | Yes | The ID of the broadcaster that received the Shoutout or one of the broadcaster’s moderators. |
| transport | [Transport](/docs/eventsub/eventsub-reference#transport) | Yes | The transport details that you want Twitch to use when sending event notifications. |

### Webhook Example  {#webhook-example-7}

```
{
    "type": "channel.shoutout.receive",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "626262",
        "moderator_user_id": "98765"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe78s9fg8"
    }
}

```

### Notification Payload  {#notification-payload-7}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference#subscription) | The subscription’s information. |
| `event` | [event](/docs/eventsub/eventsub-reference#shoutout-received) | The event’s data. |

### Notification Example  {#notification-example-7}

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.shoutout.receive",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "626262",
      "moderator_user_id": "98765"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2022-07-25T10:11:12.1236739Z"
  },
  "event": {
    "broadcaster_user_id": "626262",
    "broadcaster_user_name": "SandySanderman",
    "broadcaster_user_login": "sandysanderman",
    "from_broadcaster_user_id": "12345",
    "from_broadcaster_user_name": "SimplySimple",
    "from_broadcaster_user_login": "simplysimple",
    "viewer_count": 860,
    "started_at": "2022-07-26T17:00:03.17106713Z"
  }
}

```

### conduit.shard.disabled  {#conduitsharddisabled}

NEW The `conduit.shard.disabled` subscription type sends a notification when EventSub disables a shard due to the status of the underlying transport changing.

### Authorization  {#authorization-71}

App access token where the client ID matches the client ID in the condition. If `conduit_id` is specified, the client must be the owner of the conduit.

### Conduit Shard Disabled Request Body  {#conduit-shard-disabled-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `conduit.shard.disabled`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#conduit-shard-disabled-condition) | Yes | Subscription-specific parameters. Optionally pass in the conduit ID for the conduit you want to receive events for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Conduit Shard Disabled Example  {#conduit-shard-disabled-example}

```
{
    "type": "conduit.shard.disabled",
    "version": "1",
    "condition": {
        "client_id": "uo6dggojyb8d6soh92zknwmi5ej1q2"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Conduit Shard Disabled Notification Payload  {#conduit-shard-disabled-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference#conduit-shard-disabled-event) | The event information. |

### Conduit Shard Disabled Notification Example  {#conduit-shard-disabled-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "conduit.shard.disabled",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "client_id": "uo6dggojyb8d6soh92zknwmi5ej1q2"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "conduit_id": "bfcfc993-26b1-b876-44d9-afe75a379dac",
        "shard_id": "4",
        "status": "websocket_disconnected",
        "transport": {
            "method": "websocket",
            "session_id": "ad1c9fc3-0d99-4eb7-8a04-8608e8ff9ec9",
            "connected_at": "2020-11-10T14:32:18.730260295Z",
            "disconnected_at": "2020-11-11T14:32:18.730260295Z"
        }
    }
}

```

### drop.entitlement.grant  {#dropentitlementgrant}

The `drop.entitlement.grant` subscription type sends a notification when an entitlement for a Drop is granted to a user.

**NOTE** This subscription type is only supported by webhooks and conduits, and cannot be used with WebSockets.

### Authorization  {#authorization-72}

App access token required. The client ID associated with the access token must be owned by a user who is part of the specified organization.

### Drop Entitlement Grant Request Body  {#drop-entitlement-grant-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `drop.entitlement.grant`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#drop-entitlement-grant-condition) | yes | Subscription-specific parameters. Pass in the `organization_id` to subscribe to all drop entitlement grant notifications for that organization. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |
| `is_batching_enabled` | string | yes | Needs to be true for this subscription type. |

### Drop Entitlement Grant Webhook Example  {#drop-entitlement-grant-webhook-example}

```
{
    "type": "drop.entitlement.grant",
    "version": "1",
    "condition": {
        "organization_id": "9001",
        "category_id": "9002", // optional to specify category/game
        "campaign_id": "9003"  // optional to specify campaign
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    },
    "is_batching_enabled": true,
}

```

### Drop Entitlement Grant Notification Payload  {#drop-entitlement-grant-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `events` | [event](/docs/eventsub/eventsub-reference/#drop-entitlement-grant-event) | Event information. Contains Drop entitlement information. |

### Drop Entitlement Grant Notification Example  {#drop-entitlement-grant-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "drop.entitlement.grant",
        "version": "1",
        "status": "enabled",
        "condition": {
           "organization_id": "9001",
            "category_id": "9002", // included if specified in subscription
            "campaign_id": "9003"  // included if specified in subscription
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "events": [
        {
            "id": "bf7c8577-e3e3-4881-a78a-e9446641d45d",
            "data": {
                "organization_id": "9001",
                "category_id": "9002",
                "category_name": "Fortnite",
                "campaign_id": "9003",
                "user_id": "1234",
                "user_name": "Cool_User", // display name
                "user_login": "cool_user",
                "entitlement_id": "fb78259e-fb81-4d1b-8333-34a06ffc24c0",
                "benefit_id": "74c52265-e214-48a6-91b9-23b6014e8041",
                "created_at": "2019-01-28T04:17:53.325Z"
            }
        },
        {
            "id": "bf7c8577-e3e3-4881-a78a-e9446641d45c",
            "data": {
                "organization_id": "9001",
                "category_id": "9002",
                "category_name": "Fortnite",
                "campaign_id": "9003",
                "user_id": "12345",
                "user_name": "Cooler_User", // display name
                "user_login": "cooler_user",
                "entitlement_id": "fb78259e-fb81-4d1b-8333-34a06ffc24c0",
                "benefit_id": "74c52265-e214-48a6-91b9-23b6014e8041",
                "created_at": "2019-01-28T04:17:53.325Z"
            }
        }
    ]
}

```

Note that the payload structure is different from other subscription types. Events bound for `drop.entitlement.grant` subscriptions are batched. Developers can expect to receive roughly 0-5 HTTP requests per second. HTTP request bodies will not exceed 250KB.

### extension.bits_transaction.create  {#extensionbits_transactioncreate}

The `extension.bits_transaction.create` subscription type sends a notification when a new transaction is created for a Twitch Extension.

**NOTE** This subscription type is only supported by webhooks and conduits, and cannot be used with WebSockets.

### Authorization  {#authorization-73}

The OAuth token client ID must match the Extension client ID.

### Extension Bits Transaction Create Request Body  {#extension-bits-transaction-create-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `extension.bits_transaction.create`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#extension-bits-transaction-create-condition) | yes | Subscription-specific parameters. Pass in the Extension client ID you want to receive Bits transaction notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Extension Bits Transaction Create Webhook Example  {#extension-bits-transaction-create-webhook-example}

```
{
    "type": "extension.bits_transaction.create",
    "version": "1",
    "condition": {
        "extension_client_id": "deadbeef"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Extension Bits Transaction Create Notification Payload  {#extension-bits-transaction-create-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#extension-bits-transaction-create-event) | Event information. Contains Extension Bits transaction information. |

### Extension Bits Transaction Create Notification Example  {#extension-bits-transaction-create-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "extension.bits_transaction.create",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "extension_client_id": "deadbeef"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "bits-tx-id",
        "extension_client_id": "deadbeef",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "user_name": "Coolest_User",
        "user_login": "coolest_user",
        "user_id": "1236",
        "product": {
            "name": "great_product",
            "sku": "skuskusku",
            "bits": 1234,
            "in_development": false
        }
    }
}

```

## Goal Subscriptions  {#goal-subscriptions}

### channel.goal.begin  {#channelgoalbegin}

[NEW](/docs/product-lifecycle) Notifies the subscriber when the specified broadcaster begins a goal.

**NOTE:** It’s possible to receive the Begin event after receiving Progress events.

### Authorization  {#authorization-74}

Requires a user OAuth access token with scope set to **channel:read:goals**.

### Goal Begin Request Body  {#goal-begin-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.goal.begin`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [Condition](/docs/eventsub/eventsub-reference/#goals-condition) | yes | Set the **Condition** object’s `broadcaster_user_id` field to the ID of the broadcaster whose goals you want to get notified about. |
| `transport` | [Transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Goal Begin Webhook Example  {#goal-begin-webhook-example}

```
{
    "type": "channel.goal.begin",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "141981764"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Goal Begin Notification Payload  {#goal-begin-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [Subscription](/docs/eventsub/eventsub-reference/#subscription) | Identifies the event you subscribed to. |
| `event` | [Event](/docs/eventsub/eventsub-reference/#goals-event) | Contains the event’s data. |

### Goal Begin Notification Example  {#goal-begin-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "status": "enabled",
        "type": "channel.goal.begin",
        "version": "1",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "141981764"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2021-07-15T10:11:12.123Z"
    },
    "event": {
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
}

```

### channel.goal.progress  {#channelgoalprogress}

[NEW](/docs/product-lifecycle) Notifies the subscriber when progress is made towards the specified broadcaster’s goal. Progress could be positive (added followers) or negative (lost followers).

**NOTE:** It’s possible to receive Progress events before receiving the Begin event.

### Authorization  {#authorization-75}

Requires a user OAuth access token with scope set to **channel:read:goals**.

### Goal Progress Request Body  {#goal-progress-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.goal.progress`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [Condition](/docs/eventsub/eventsub-reference/#goals-condition) | yes | Set the **Condition** object’s `broadcaster_user_id` field to the ID of the broadcaster whose goals you want to get notified about. |
| `transport` | [Transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Goal Progress Webhook Example  {#goal-progress-webhook-example}

```
{
    "type": "channel.goal.progress",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "141981764"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Goal Progress Notification Payload  {#goal-progress-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [Subscription](/docs/eventsub/eventsub-reference/#subscription) | Identifies the event you subscribed to. |
| `event` | [Event](/docs/eventsub/eventsub-reference/#goals-event) | Contains the event’s data. |

### Goal Progress Notification Example  {#goal-progress-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "status": "enabled",
        "type": "channel.goal.progress",
        "version": "1",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "141981764"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2021-07-15T10:11:12.123Z"
    },
    "event": {
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
}

```

### channel.goal.end  {#channelgoalend}

[NEW](/docs/product-lifecycle) Notifies the subscriber when the specified broadcaster ends a goal.

### Authorization  {#authorization-76}

Requires a user OAuth access token with scope set to **channel:read:goals**.

### Goal End Request Body  {#goal-end-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `channel.goal.end`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [Condition](/docs/eventsub/eventsub-reference/#goals-condition) | yes | Set the **Condition** object’s `broadcaster_user_id` field to the ID of the broadcaster whose goals you want to get notified about. |
| `transport` | [Transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Goal End Webhook Example  {#goal-end-webhook-example}

```
{
    "type": "channel.goal.end",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "141981764"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Goal End Notification Payload  {#goal-end-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [Subscription](/docs/eventsub/eventsub-reference/#subscription) | Identifies the event you subscribed to. |
| `event` | [Event](/docs/eventsub/eventsub-reference/#goals-event) | Contains the event’s data. |

### Goal End Notification Example  {#goal-end-notification-example}

Notice that the event object also includes the `is_achieved` and `ended_at` fields, which the begin and progress events don’t include.

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "status": "enabled",
        "type": "channel.goal.end",
        "version": "1",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "141981764"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2021-07-15T10:11:12.123Z"
    },
    "event": {
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
}

```

## Stream Subscriptions  {#stream-subscriptions}

### stream.online  {#streamonline}

The `stream.online` subscription type sends a notification when the specified broadcaster starts a stream.

### Authorization  {#authorization-77}

No authorization required.

### Stream Online Request Body  {#stream-online-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `stream.online`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#stream-online-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to get updates for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Stream Online Webhook Example  {#stream-online-webhook-example}

```
{
    "type": "stream.online",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Stream Online Notification Payload  {#stream-online-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#stream-online-event) | Event information. Contains the stream ID, broadcaster user ID, broadcaster user name, and the stream type. |

### Stream Online Notification Example  {#stream-online-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "stream.online",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "id": "9001",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User",
        "type": "live",
        "started_at": "2020-10-11T10:11:12.123Z"
    }
}

```

### stream.offline  {#streamoffline}

The `stream.offline` subscription type sends a notification when the specified broadcaster stops a stream.

### Authorization  {#authorization-78}

No authorization required.

### Stream Offline Request Body  {#stream-offline-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `stream.offline`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#stream-offline-condition) | yes | Subscription-specific parameters. Pass in the broadcaster user ID for the channel you want to get updates for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### Stream Offline Webhook Example  {#stream-offline-webhook-example}

```
{
    "type": "stream.offline",
    "version": "1",
    "condition": {
        "broadcaster_user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Stream Offline Notification Payload  {#stream-offline-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#stream-offline-event) | Event information. Contains the broadcaster user ID and broadcaster user name. |

### Stream Offline Notification Example  {#stream-offline-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "stream.offline",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "1337"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z",
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        }
    },
    "event": {
        "id": "9001",
        "broadcaster_user_id": "1337",
        "broadcaster_user_login": "cool_user",
        "broadcaster_user_name": "Cool_User"
    }
}

```

## User Subscriptions  {#user-subscriptions}

### user.authorization.grant  {#userauthorizationgrant}

The `user.authorization.grant` subscription type sends a notification when a user’s authorization has been granted to your client id.

**NOTE** This subscription type is only supported by webhooks and conduits, and cannot be used with WebSockets.

### Authorization  {#authorization-79}

Provided `client_id` must match the client id in the application access token.

### User Authorization Grant Request Body  {#user-authorization-grant-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `user.authorization.grant`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#user-authorization-grant-condition) | yes | Subscription-specific parameters. Pass in the client ID of the application you want to get user authorization grant notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### User Authorization Grant Webhook Example  {#user-authorization-grant-webhook-example}

```
{
    "type": "user.authorization.grant",
    "version": "1",
    "condition": {
        "client_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### User Authorization Grant Notification Payload  {#user-authorization-grant-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#user-authorization-grant-event) | Event information. Contains your application’s client ID and the user ID of the user who granted authorization to your application. |

### User Authorization Grant Notification Example  {#user-authorization-grant-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "user.authorization.grant",
        "version": "1",
        "status": "enabled",
        "cost": 1,
        "condition": {
            "client_id": "crq72vsaoijkc83xx42hz6i37"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "client_id": "crq72vsaoijkc83xx42hz6i37",
        "user_id": "1337",
        "user_login": "cool_user",
        "user_name": "Cool_User"
    }
}

```

### user.authorization.revoke  {#userauthorizationrevoke}

The `user.authorization.revoke` subscription type sends a notification when a user’s authorization has been revoked for your client id. Use this webhook to meet government requirements for handling user data, such as GDPR, LGPD, or CCPA.

**NOTE** This subscription type is only supported by webhooks and conduits, and cannot be used with WebSockets.

### Authorization  {#authorization-80}

Provided `client_id` must match the client id in the application access token.

### User Authorization Revoke Request Body  {#user-authorization-revoke-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `user.authorization.revoke`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#user-authorization-revoke-condition) | yes | Subscription-specific parameters. Pass in the client ID of the application you want to get user authorization revoke notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### User Authorization Revoke Webhook Example  {#user-authorization-revoke-webhook-example}

```
{
    "type": "user.authorization.revoke",
    "version": "1",
    "condition": {
        "client_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### User Authorization Revoke Notification Payload  {#user-authorization-revoke-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#user-authorization-revoke-event) | Event information. Contains your application’s client ID and the user ID of the user who revoked authorization for your application. |

### User Authorization Revoke Notification Example  {#user-authorization-revoke-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "user.authorization.revoke",
        "version": "1",
        "status": "enabled",
        "cost": 1,
        "condition": {
            "client_id": "crq72vsaoijkc83xx42hz6i37"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "client_id": "crq72vsaoijkc83xx42hz6i37",
        "user_id": "1337",
        "user_login": "cool_user",  // Null if the user no longer exists
        "user_name": "Cool_User"    // Null if the user no longer exists
    }
}

```

### user.update  {#userupdate}

The `user.update` subscription type sends a notification when user updates their account.

### Authorization  {#authorization-81}

No authorization required. If you have the `user:read:email` scope, the notification will include `email` field.

### User Update Request Body  {#user-update-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name: `user.update`. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#user-update-condition) | yes | Subscription-specific parameters. Pass in the user ID for the user you want update notifications for. |
| `transport` | [transport](/docs/eventsub/eventsub-reference/#transport) | yes | Transport-specific parameters. |

### User Update Webhook Example  {#user-update-webhook-example}

```
{
    "type": "user.update",
    "version": "1",
    "condition": {
        "user_id": "1337"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### User Update Notification Payload  {#user-update-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](/docs/eventsub/eventsub-reference/#subscription) | Subscription information. |
| `event` | [event](/docs/eventsub/eventsub-reference/#user-update-event) | Event information. Contains the user ID, user name, and description. The event includes the user’s email address if the app used to request this event type includes the `user:read:email` scope for the user. See [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription). |

### User Update Notification Example  {#user-update-notification-example}

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "user.update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
           "user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2019-11-16T10:11:12.634234626Z"
    },
    "event": {
        "user_id": "1337",
        "user_login": "cool_user",
        "user_name": "Cool_User",
        "email": "user@email.com",  // Requires user:read:email scope
        "email_verified": true,
        "description": "cool description"
    }
}

```

### user.whisper.message  {#userwhispermessage}

NEW The `user.whisper.message` subscription type sends a notification when a user receives a whisper. Event Triggers - Anyone whispers the specified user.

### Authorization  {#authorization-82}

Must have oauth scope `user:read:whispers` or `user:manage:whispers`.

### Whisper Received Request Body  {#whisper-received-request-body}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | String | Yes | The subscription type name: `user.whisper.message`. |
| `version` | String | Yes | The subscription type version: `1`. |
| `condition` | [condition](/docs/eventsub/eventsub-reference/#whisper-received-condition) | Yes | Subscription-specific parameters. |
| `transport` | [transport](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#transport) | Yes | Transport-specific parameters. |

### Whisper Received Webhook Example  {#whisper-received-webhook-example}

```
{
    "type": "user.whisper.message",
    "version": "1",
    "condition": {
        "user_id": "423374343"
    },
    "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback",
        "secret": "s3cRe7"
    }
}

```

### Whisper Received Notification Payload  {#whisper-received-notification-payload}

| Name | Type | Description |
|---|---|---|
| `subscription` | [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#subscription) | Metadata about the subscription. |
| `event` | [event](/docs/eventsub/eventsub-reference/#whisper-received-event) | The event information. |

### Whisper Received Notification Example  {#whisper-received-notification-example}

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "user.whisper.message",
    "version": "1",
    "condition": {
      "user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "from_user_id": "423374343",
    "from_user_login": "glowillig",
    "from_user_name": "glowillig",
    "to_user_id": "424596340",
    "to_user_login": "quotrok",
    "to_user_name": "quotrok",
    "whisper_id": "some-whisper-id",
    "whisper": {
      "text": "a secret"
    }
  }
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
