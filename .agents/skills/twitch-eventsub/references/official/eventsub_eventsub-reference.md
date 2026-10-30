<!-- source: https://dev.twitch.tv/docs/eventsub/eventsub-reference/ -->

Contents

# EventSub Reference  {#eventsub-reference}

## Request fields  {#request-fields}

| Name | Type | Required? | Description |
|---|---|---|---|
| `type` | string | yes | The subscription type name. |
| `version` | string | yes | The subscription type version: `1`. |
| `condition` | condition | yes | Subscription-specific parameters. The parameters inside this object differ by subscription type and may differ by version. |
| `transport` | transport | yes | Transport-specific parameters. |

## Response fields  {#response-fields}

| Name | Type | Description |
|---|---|---|
| `subscription` | subscription | Contains subscription metadata. |
| `event` | event | The event information. The fields inside this object differ by subscription type. |

# Objects  {#objects}

## Bits Voting  {#bits-voting}

**NOTE**: Bits voting is not supported.

| Name | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Not used; will be set to **false**. |
| `amount_per_vote` | integer | Not used; will be set to 0. |

## Channel Points Voting  {#channel-points-voting}

| Name | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Indicates if Channel Points can be used for voting. |
| `amount_per_vote` | integer | Number of Channel Points required to vote once with Channel Points. |

## Choices  {#choices}

An array of the choices for a particular poll. Each poll’s event payload includes a choices array. The choices array contains an object that describes each choice and, if applicable, the votes for that choice.

| Name | Type | Description |
|---|---|---|
| `id` | string | ID for the choice. |
| `title` | string | Text displayed for the choice. |
| `bits_votes` | integer | Not used; will be set to 0. |
| `channel_points_votes` | integer | Number of votes received via Channel Points. |
| `votes` | integer | Total number of votes received for the choice across all methods of voting. |

## Conditions  {#conditions}

### Automod Message Hold Condition  {#automod-message-hold-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the broadcaster (channel). |
| `moderator_user_id` | String | Yes | User ID of the moderator. |

### Automod Message Update Condition  {#automod-message-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the broadcaster (channel). Maximum:1. |
| `moderator_user_id` | String | Yes | User ID of the moderator. |

### Automod Settings Update Condition  {#automod-settings-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the broadcaster (channel). Maximum:1. |
| `moderator_user_id` | String | Yes | User ID of the moderator. |

### Automod Terms Update Condition  {#automod-terms-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the broadcaster (channel). Maximum:1. |
| `moderator_user_id` | String | Yes | User ID of the moderator creating the subscription. Maximum:1 |

### Channel Ad Break Begin Condition  {#channel-ad-break-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The ID of the broadcaster that you want to get Channel Ad Break begin notifications for. Maximum: 1 |

### Channel Ban Condition  {#channel-ban-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get ban notifications for. |

### Channel Bits Use Condition  {#channel-bits-use-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The user ID of the channel broadcaster. Maximum: 1. |

### Channel Chat Clear Condition  {#channel-chat-clear-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | User ID of the channel to receive chat clear events for. |
| `user_id` | string | yes | The user ID to read chat as. |

### Channel Chat Clear User Messages Condition  {#channel-chat-clear-user-messages-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | User ID of the channel to receive chat clear user messages events for. |
| `user_id` | string | yes | The user ID to read chat as. |

### Channel Chat Message Condition  {#channel-chat-message-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the channel to receive chat message events for. |
| `user_id` | string | yes | The User ID to read chat as. |

### Channel Chat Message Delete Condition  {#channel-chat-message-delete-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | User ID of the channel to receive chat message delete events for. |
| `user_id` | string | yes | The user ID to read chat as. |

### Channel Chat Notification Condition  {#channel-chat-notification-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | User ID of the channel to receive chat notification events for. |
| `user_id` | string | yes | The user ID to read chat as. |

### Channel Chat Settings Update Condition  {#channel-chat-settings-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | User ID of the channel to receive chat settings update events for. |
| `user_id` | string | yes | The user ID to read chat as. |

### Channel Chat User Message Hold Condition  {#channel-chat-user-message-hold-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the channel to receive chat message events for. |
| `user_id` | String | Yes | The user ID to read chat as. |

### Channel Chat User Message Update Condition  {#channel-chat-user-message-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | User ID of the channel to receive chat message events for. |
| `user_id` | String | Yes | The user ID to read chat as. |

### Channel Subscribe Condition  {#channel-subscribe-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get subscribe notifications for. |

### Channel Subscription End Condition  {#channel-subscription-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get subscription end notifications for. |

### Channel Subscription Gift Condition  {#channel-subscription-gift-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get subscription gift notifications for. |

### Channel Subscription Message Condition  {#channel-subscription-message-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get resubscription chat message notifications for. |

### Channel Cheer Condition  {#channel-cheer-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get cheer notifications for. |

### Channel Update Condition  {#channel-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get updates for. |

### Channel Follow Condition  {#channel-follow-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get follow notifications for. |
| `moderator_user_id` | string | yes | The ID of the moderator of the channel you want to get follow notifications for. If you have authorization from the broadcaster rather than a moderator, specify the broadcaster’s user ID here. |

### Channel Unban Condition  {#channel-unban-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get unban notifications for. |

### Channel Unban Request Create Condition  {#channel-unban-request-create-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `moderator_user_id` | string | yes | The ID of the user that has permission to moderate the broadcaster’s channel and has granted your app permission to subscribe to this subscription type. |
| `broadcaster_user_id` | string | yes | The ID of the broadcaster you want to get chat unban request notifications for. Maximum: 1. |

### Channel Unban Request Resolve Condition  {#channel-unban-request-resolve-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `moderator_user_id` | string | yes | The ID of the user that has permission to moderate the broadcaster’s channel and has granted your app permission to subscribe to this subscription type. |
| `broadcaster_user_id` | string | yes | The ID of the broadcaster you want to get unban request resolution notifications for. Maximum: 1. |

### Channel Raid Condition  {#channel-raid-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `from_broadcaster_user_id` | string | no | The broadcaster user ID that created the channel raid you want to get notifications for. Use this parameter if you want to know when a specific broadcaster raids another broadcaster. The channel raid condition must include either `from_broadcaster_user_id` or `to_broadcaster_user_id`. |
| `to_broadcaster_user_id` | string | no | The broadcaster user ID that received the channel raid you want to get notifications for. Use this parameter if you want to know when a specific broadcaster is raided by another broadcaster. The channel raid condition must include either `from_broadcaster_user_id` or `to_broadcaster_user_id`. |

### Channel Moderate Condition  {#channel-moderate-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | The user ID of the broadcaster. |
| `moderator_user_id` | String | Yes | The user ID of the moderator. |

### Channel Moderate V2 Condition  {#channel-moderate-v2-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | The user ID of the broadcaster. |
| `moderator_user_id` | String | Yes | The user ID of the moderator. |

### Channel Moderator Add Condition  {#channel-moderator-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get moderator addition notifications for. |

### Channel Moderator Remove Condition  {#channel-moderator-remove-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to get moderator removal notifications for. |

### Channel Guest Star Session Begin Condition  {#channel-guest-star-session-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | yes | The broadcaster user ID of the channel hosting the Guest Star Session |
| `moderator_user_id` | String | yes | The user ID of the moderator or broadcaster of the specified channel. |

### Channel Guest Star Session End Condition  {#channel-guest-star-session-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | yes | The broadcaster user ID of the channel hosting the Guest Star Session |
| `moderator_user_id` | String | yes | The user ID of the moderator or broadcaster of the specified channel. |

### Channel Guest Star Guest Update Condition  {#channel-guest-star-guest-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | yes | The broadcaster user ID of the channel hosting the Guest Star Session |
| `moderator_user_id` | String | yes | The user ID of the moderator or broadcaster of the specified channel. |

### Channel Guest Star Settings Update Condition  {#channel-guest-star-settings-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | yes | The broadcaster user ID of the channel hosting the Guest Star Session |
| `moderator_user_id` | String | yes | The user ID of the moderator or broadcaster of the specified channel. |

### Channel Points Automatic Reward Redemption Add Condition  {#channel-points-automatic-reward-redemption-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points reward add notifications for. |

### Channel Points Automatic Reward Redemption Add V2 Condition  {#channel-points-automatic-reward-redemption-add-v2-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points reward add notifications for. |

### Channel Points Custom Reward Add Condition  {#channel-points-custom-reward-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points custom reward add notifications for. |

### Channel Points Custom Reward Update Condition  {#channel-points-custom-reward-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points custom reward update notifications for. |
| `reward_id` | string | no | Optional. Specify a reward id to only receive notifications for a specific reward. |

### Channel Points Custom Reward Remove Condition  {#channel-points-custom-reward-remove-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points custom reward remove notifications for. |
| `reward_id` | string | no | Optional. Specify a reward id to only receive notifications for a specific reward. |

### Channel Points Custom Reward Redemption Add Condition  {#channel-points-custom-reward-redemption-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points custom reward redemption add notifications for. |
| `reward_id` | string | no | Optional. Specify a reward id to only receive notifications for a specific reward. |

### Channel Points Custom Reward Redemption Update Condition  {#channel-points-custom-reward-redemption-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive channel points custom reward redemption update notifications for. |
| `reward_id` | string | no | Optional. Specify a reward id to only receive notifications for a specific reward. |

### Channel Custom Power-up Redemption Add Condition  {#channel-custom-power-up-redemption-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID for the channel you want to receive custom Power-up redemption add notifications for. |
| `reward_id` | string | no | Optional. Specify a reward id to only receive notifications for a specific custom Power-up. |

### Channel Poll Begin Condition  {#channel-poll-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “poll begin” notifications will be received. |

### Channel Poll Progress Condition  {#channel-poll-progress-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “poll progress” notifications will be received. |

### Channel Poll End Condition  {#channel-poll-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “poll end” notifications will be received. |

### Channel Prediction Begin Condition  {#channel-prediction-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “prediction begin” notifications will be received. |

### Channel Prediction Progress Condition  {#channel-prediction-progress-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “prediction progress” notifications will be received. |

### Channel Prediction Lock Condition  {#channel-prediction-lock-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “prediction lock” notifications will be received. |

### Channel Prediction End Condition  {#channel-prediction-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID of the channel for which “prediction end” notifications will be received. |

### Channel Shared Chat Session Begin Condition  {#channel-shared-chat-session-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the channel to receive shared chat session begin events for. |

### Channel Shared Chat Session Update Condition  {#channel-shared-chat-session-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the channel to receive shared chat session update events for. |

### Channel Shared Chat Session End Condition  {#channel-shared-chat-session-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the channel to receive shared chat session end events for. |

### Channel Suspicious User Message Condition  {#channel-suspicious-user-message-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `moderator_user_id` | String | Yes | The ID of a user that has permission to moderate the broadcaster’s channel and has granted your app permission to subscribe to this subscription type. |
| `broadcaster_user_id` | String | Yes | User ID of the channel to receive chat message events for. |

### Channel Suspicious User Update Condition  {#channel-suspicious-user-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `moderator_user_id` | String | Yes | The ID of a user that has permission to moderate the broadcaster’s channel and has granted your app permission to subscribe to this subscription type. |
| `broadcaster_user_id` | String | Yes | The broadcaster you want to get chat unban request notifications for. |

### Channel VIP Add Condition  {#channel-vip-add-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | The User ID of the broadcaster (channel) Maximum: 1 |

### Channel VIP Remove Condition  {#channel-vip-remove-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | String | Yes | The User ID of the broadcaster (channel) Maximum: 1 |

### Channel Warning Acknowledge Condition  {#channel-warning-acknowledge-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the broadcaster. |
| `moderator_user_id` | string | yes | The User ID of the moderator. |

### Channel Warning Send Condition  {#channel-warning-send-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The User ID of the broadcaster. |
| `moderator_user_id` | string | yes | The User ID of the moderator. |

### Conduit Shard Disabled Condition  {#conduit-shard-disabled-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `client_id` | string | yes | Your application’s client id. The provided client_id must match the client ID in the application access token. |
| `conduit_id` | string | no | The conduit ID to receive events for. If omitted, events for all of this client’s conduits are sent. |

### Drop Entitlement Grant Condition  {#drop-entitlement-grant-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `organization_id` | string | yes | The organization ID of the organization that owns the game on the developer portal. |
| `category_id` | string | no | The category (or game) ID of the game for which entitlement notifications will be received. |
| `campaign_id` | string | no | The campaign ID for a specific campaign for which entitlement notifications will be received. |

### Extension Bits Transaction Create Condition  {#extension-bits-transaction-create-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `extension_client_id` | string | yes | The client ID of the extension. |

### Goals Condition  {#goals-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The ID of the broadcaster to get notified about. The ID must match the `user_id` in the OAuth access token. |

### Hype Train Begin Condition  {#hype-train-begin-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The ID of the broadcaster that you want to get Hype Train begin notifications for. |

### Hype Train Progress Condition  {#hype-train-progress-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The ID of the broadcaster that you want to get Hype Train progress notifications for. |

### Hype Train End Condition  {#hype-train-end-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The ID of the broadcaster that you want to get Hype Train end notifications for. |

### Stream Online Condition  {#stream-online-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID you want to get stream online notifications for. |

### Stream Offline Condition  {#stream-offline-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `broadcaster_user_id` | string | yes | The broadcaster user ID you want to get stream offline notifications for. |

### User Authorization Grant Condition  {#user-authorization-grant-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `client_id` | string | yes | Your application’s client id. The provided `client_id` must match the client id in the application access token. |

### User Authorization Revoke Condition  {#user-authorization-revoke-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `client_id` | string | yes | Your application’s client id. The provided `client_id` must match the client id in the application access token. |

### User Update Condition  {#user-update-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `user_id` | string | yes | The user ID for the user you want update notifications for. |

### Whisper Received Condition  {#whisper-received-condition}

| Name | Type | Required? | Description |
|---|---|---|---|
| `user_id` | String | Yes | The user_id of the person receiving whispers. |

## Custom Power Up  {#custom-power-up}

| Name | Type | Description |
|---|---|---|
| `id` | string | The unique ID for this Custom Power-up. |
| `title` | string | The user-viewable name of this Custom Power-up. |
| `bits` | int | The cost of the Custom Power-up to redeem. |
| `prompt` | string | The creator-provided description for this Power-up. |

## Emotes  {#emotes}

| Name | Type | Description |
|---|---|---|
| `begin` | int | The index of where the Emote starts in the text. |
| `end` | int | The index of where the Emote ends in the text. |
| `id` | string | The emote ID. |

## Events  {#events}

### Automod Message Hold Event  {#automod-message-hold-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The message sender’s user ID. |
| `user_login` | String | The message sender’s login name. |
| `user_name` | String | The message sender’s display name. |
| `message_id` | String | The ID of the message that was flagged by automod. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Metadata surrounding the potential inappropriate fragments of the message. |
| `text` | String | Message text in a fragment. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |
| `category` | String | The category of the message. |
| `level` | Int | The level of severity. Measured between 1 to 4. |
| `held_at` | String | The timestamp of when automod saved the message. |

### Automod Message Hold Event V2  {#automod-message-hold-event-v2}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The message sender’s user ID. |
| `user_login` | String | The message sender’s login name. |
| `user_name` | String | The message sender’s display name. |
| `message_id` | String | The ID of the held message. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Metadata surrounding the potential inappropriate fragments of the message. |
| `type` | String | One of three options:  - text - emote - cheermote |
| `text` | String | Message text in a fragment. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |
| `held_at` | String | The timestamp of when automod saved the message. |
| `reason` | String | Possible values are:   - automod - blocked_term - blocked_link |
| `automod` | Object | Optional. If the message was caught by automod, this will be populated. |
| `category` | String | The category of the caught message. |
| `level` | Int | The level of severity (1-4). |
| `boundaries` | Object[] | The bounds of the text that caused the message to be caught. |
| `start_pos` | Int | Index in the message for the start of the problem (0 indexed, inclusive). |
| `end_pos` | Int | Index in the message for the end of the problem (0 indexed, inclusive). |
| `blocked_term` | Object | Optional. If the message was caught due to a blocked term or a blocked link, this will be populated. |
| `terms_found` | Object[] | The list of blocked terms found in the message. |
| `term_id` | String | The id of the blocked term found. |
| `boundary` | Object | The bounds of the text that caused the message to be caught. |
| `start_pos` | Int | Index in the message for the start of the problem (0 indexed, inclusive). |
| `end_pos` | Int | Index in the message for the end of the problem (0 indexed, inclusive). |
| `owner_broadcaster_user_id` | String | The id of the broadcaster that owns the blocked term. |
| `owner_broadcaster_user_login` | String | The login of the broadcaster that owns the blocked term. |
| `owner_broadcaster_user_name` | String | The username of the broadcaster that owns the blocked term. |

### Automod Message Update Event  {#automod-message-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The message sender’s user ID. |
| `user_login` | String | The message sender’s login name. |
| `user_name` | String | The message sender’s display name. |
| `moderator_user_id` | String | The ID of the moderator. |
| `moderator_user_name` | String | TThe moderator’s user name. |
| `moderator_user_login` | String | The login of the moderator. |
| `message_id` | String | The ID of the message that was flagged by automod. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Metadata surrounding the potential inappropriate fragments of the message. |
| `text` | String | Message text in a fragment. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |
| `category` | String | The category of the message. |
| `level` | Int | The level of severity. Measured between 1 to 4. |
| `status` | String | The message’s status. Possible values are:  - Approved - Denied - Expired |
| `held_at` | String | The timestamp of when automod saved the message. |

### Automod Message Update Event V2  {#automod-message-update-event-v2}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The message sender’s user ID. |
| `user_login` | String | The message sender’s login name. |
| `user_name` | String | The message sender’s display name. |
| `moderator_user_id` | String | The ID of the moderator. |
| `moderator_user_name` | String | TThe moderator’s user name. |
| `moderator_user_login` | String | The login of the moderator. |
| `message_id` | String | The ID of the message that was flagged by automod. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Metadata surrounding the potential inappropriate fragments of the message. |
| `text` | String | Message text in a fragment. |
| `type` | String | One of three options:  - text - emote - cheermote |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |
| `status` | String | The message’s status. Possible values are:  - Approved - Denied - Expired |
| `held_at` | String | The timestamp of when automod saved the message. |
| `reason` | String | The reason why the message was caught. Possible values are:   - automod - blocked_term - blocked_link |
| `automod` | Object | Optional. If the message was caught by automod, this will be populated. |
| `category` | String | The category of the caught message. |
| `level` | Int | The level of severity (1-4). |
| `boundaries` | Object[] | The bounds of the text that caused the message to be caught. |
| `start_pos` | Int | Index in the message for the start of the problem (Starting at 0). |
| `end_pos` | Int | Index in the message for the end of the problem (Starting at 0). |
| `blocked_term` | Object | Optional. If the message was caught due to a blocked term or a blocked link, this will be populated. |
| `terms_found` | Object[] | The list of blocked terms found in the message. |
| `term_id` | String | The id of the blocked term found. |
| `boundary` | Object | The bounds of the text that caused the message to be caught. |
| `start_pos` | Int | Index in the message for the start of the problem (0 indexed, inclusive). |
| `end_pos` | Int | Index in the message for the end of the problem (0 indexed, inclusive). |
| `owner_broadcaster_user_id` | String | The id of the broadcaster that owns the blocked term. |
| `owner_broadcaster_user_login` | String | The login of the broadcaster that owns the blocked term. |
| `owner_broadcaster_user_name` | String | The username of the broadcaster that owns the blocked term. |

### Automod Settings Update Event  {#automod-settings-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `moderator_user_id` | String | The ID of the moderator who changed the channel settings. |
| `moderator_user_login` | String | The moderator’s login. |
| `moderator_user_name` | String | The moderator’s user name. |
| `bullying` | Int | The Automod level for hostility involving name calling or insults. |
| `overall_level` | Int (or Null) | The default AutoMod level for the broadcaster. This field is null if the broadcaster has set one or more of the individual settings. |
| `disability` | Int | The Automod level for discrimination against disability. |
| `race_ethnicity_or_religion` | Int | The Automod level for racial discrimination. |
| `misogyny` | Int | The Automod level for discrimination against women. |
| `sexuality_sex_or_gender` | Int | The AutoMod level for discrimination based on sexuality, sex, or gender. |
| `aggression` | Int | The Automod level for hostility involving aggression. |
| `sex_based_terms` | Int | The Automod level for sexual content. |
| `swearing` | Int | The Automod level for profanity. |

### Automod Terms Update Event  {#automod-terms-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | string | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | string | The user name of the broadcaster specified in the request. |
| `moderator_user_id` | string | The ID of the moderator who changed the channel settings. |
| `moderator_user_login` | string | The moderator’s login. |
| `moderator_user_name` | string | The moderator’s user name. |
| `action` | string | The status change applied to the terms. Possible options are:   - add_permitted - remove_permitted - add_blocked - remove_blocked |
| `from_automod` | bool | Indicates whether this term was added due to an Automod message approve/deny action. |
| `terms` | string[] | The list of terms that had a status change. |

### Channel Ad Break Begin Event  {#channel-ad-break-begin-event}

| Name | Type | Description |
|---|---|---|
| `duration_seconds` | integer | Length in seconds of the mid-roll ad break requested |
| `started_at` | string | The UTC timestamp of when the ad break began, in RFC3339 format. Note that there is potential delay between this event, when the streamer requested the ad break, and when the viewers will see ads. |
| `is_automatic` | boolean | Indicates if the ad was automatically scheduled via Ads Manager |
| `broadcaster_user_id` | string | The broadcaster’s user ID for the channel the ad was run on. |
| `broadcaster_user_login` | string | The broadcaster’s user login for the channel the ad was run on. |
| `broadcaster_user_name` | string | The broadcaster’s user display name for the channel the ad was run on. |
| `requester_user_id` | string | The ID of the user that requested the ad. For automatic ads, this will be the ID of the broadcaster. |
| `requester_user_login` | string | The login of the user that requested the ad. |
| `requester_user_name` | string | The display name of the user that requested the ad. |

### Channel Ban Event  {#channel-ban-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID for the user who was banned on the specified channel. |
| `user_login` | string | The user login for the user who was banned on the specified channel. |
| `user_name` | string | The user display name for the user who was banned on the specified channel. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `moderator_user_id` | string | The user ID of the issuer of the ban. |
| `moderator_user_login` | string | The user login of the issuer of the ban. |
| `moderator_user_name` | string | The user name of the issuer of the ban. |
| `reason` | string | The reason behind the ban. |
| `banned_at` | string | The UTC date and time (in RFC3339 format) of when the user was banned or put in a timeout. |
| `ends_at` | string | The UTC date and time (in RFC3339 format) of when the timeout ends. Is **null** if the user was banned instead of put in a timeout. |
| `is_permanent` | boolean | Indicates whether the ban is permanent (true) or a timeout (false). If true, `ends_at` will be null. |

### Channel Bits Use Event  {#channel-bits-use-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The User ID of the channel where the Bits were redeemed. |
| `broadcaster_user_login` | string | The login of the channel where the Bits were used. |
| `broadcaster_user_name` | string | The display name of the channel where the Bits were used. |
| `user_id` | string | The User ID of the redeeming user. |
| `user_login` | string | The login name of the redeeming user. |
| `user_name` | string | The display name of the redeeming user. |
| `bits` | integer | The number of Bits used. |
| `type` | string | Possible values are:   - cheer - power_up - custom_power_up |
| `message` | object | Optional. An object that contains the user message and emote information needed to recreate the message. |
| `text` | string | The chat message in plain text. |
| `fragments` | object[] | The ordered list of chat message fragments. |
| `text` | string | The message text in fragment. |
| `type` | string | The type of message fragment. Possible values are:   - text - cheermote - emote |
| `emote` | object | Optional. The metadata pertaining to the emote. |
| `id` | string | The ID that uniquely identifies this emote. |
| `emote_set_id` | string | The ID that identifies the emote set that the emote belongs to. |
| `owner_id` | string | The ID of the broadcaster who owns the emote. |
| `format` | []string | The formats that the emote is available in. For example, if the emote is available only as a static PNG, the array contains only static. But if the emote is available as a static PNG and an animated GIF, the array contains static and animated. The possible formats are:   - **animated** - An animated GIF is available for this emote. - **static** - A static PNG file is available for this emote. |
| `cheermote` | object | Optional. The metadata pertaining to the cheermote. |
| `prefix` | string | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | int | The amount of Bits cheered. |
| `tier` | int | The tier level of the cheermote. |
| `power_up` | object | Optional. Data about a default (i.e. built-in) Power-up. |
| `type` | string | Possible values:   - message_effect - celebration - gigantify_an_emote |
| `emote` | object | Optional. Emote associated with the reward. |
| `id` | string | The ID that uniquely identifies this emote. |
| `name` | string | The human readable emote token. |
| `message_effect_id` | string | Optional. The ID of the message effect. |
| `custom_power_up` | object | Optional. Data about a custom Power-up. |
| `title` | string | The title of the custom Power-up. |
| `reward_id` | string | The ID of the custom Power-up. |

### Channel Chat Clear Event  {#channel-chat-clear-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `broadcaster_user_login` | string | The broadcaster login. |

### Channel Chat Clear User Messages Event  {#channel-chat-clear-user-messages-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `target_user_id` | string | The ID of the user that was banned or put in a timeout. All of their messages are deleted. |
| `target_user_name` | string | The user name of the user that was banned or put in a timeout. |
| `target_user_login` | string | The user login of the user that was banned or put in a timeout. |

### Channel Chat Message Event  {#channel-chat-message-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `chatter_user_id` | string | The user ID of the user that sent the message. |
| `chatter_user_name` | string | The user name of the user that sent the message. |
| `chatter_user_login` | string | The user login of the user that sent the message. |
| `message_id` | string | A UUID that identifies the message. |
| `message` | object | The structured chat message. |
| `text` | string | The chat message in plain text. |
| `fragments` | object[] | Ordered list of chat message fragments. |
| `type` | string | The type of message fragment. Possible values:   - text - cheermote - emote - mention - gif |
| `text` | string | Message text in fragment. |
| `cheermote` | object | **Optional**. Metadata pertaining to the cheermote. |
| `prefix` | string | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | int | The amount of Bits cheered. |
| `tier` | int | The tier level of the cheermote. |
| `emote` | object | **Optional**. Metadata pertaining to the emote. |
| `id` | string | An ID that uniquely identifies this emote. |
| `emote_set_id` | string | An ID that identifies the emote set that the emote belongs to. |
| `owner_id` | string | The ID of the broadcaster who owns the emote. |
| `format` | string[] | The formats that the emote is available in. For example, if the emote is available only as a static PNG, the array contains only static. But if the emote is available as a static PNG and an animated GIF, the array contains static and animated. The possible formats are:   - animated - An animated GIF is available for this emote. - static - A static PNG file is available for this emote. |
| `mention` | object | **Optional**. Metadata pertaining to the mention. |
| `user_id` | string | The user ID of the mentioned user. |
| `user_name` | string | The user name of the mentioned user. |
| `user_login` | string | The user login of the mentioned user. |
| `gif` | object | **Optional**. Metadata pertaining to the GIF. |
| `id` | string | An ID that uniquely identifies this GIF. |
| `url` | string | The URL of the GIF asset. Applications rendering the GIF must use the full URL provided; it must not be modified. |
| `message_type` | string | The type of message. Possible values:   - text - channel_points_highlighted - channel_points_sub_only - user_intro - power_ups_message_effect - power_ups_gigantified_emote |
| `badges` | object[] | List of chat badges. |
| `set_id` | string | An ID that identifies this set of chat badges. For example, Bits or Subscriber. |
| `id` | string | An ID that identifies this version of the badge. The ID can be any value. For example, for Bits, the ID is the Bits tier level, but for World of Warcraft, it could be Alliance or Horde. |
| `info` | string | Contains metadata related to the chat badges in the badges tag. Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| `cheer` | object | **Optional**. Metadata if this message is a cheer. |
| `bits` | int | The amount of Bits the user cheered. |
| `color` | string | The color of the user’s name in the chat room. This is a hexadecimal RGB color code in the form, `#&lt;RGB&gt;`. This tag may be empty if it is never set. |
| `reply` | object | **Optional**. Metadata if this message is a reply. |
| `parent_message_id` | string | An ID that uniquely identifies the parent message that this message is replying to. |
| `parent_message_body` | string | The message body of the parent message. |
| `parent_user_id` | string | User ID of the sender of the parent message. |
| `parent_user_name` | string | User name of the sender of the parent message. |
| `parent_user_login` | string | User login of the sender of the parent message. |
| `thread_message_id` | string | An ID that identifies the parent message of the reply thread. |
| `thread_user_id` | string | User ID of the sender of the thread’s parent message. |
| `thread_user_name` | string | User name of the sender of the thread’s parent message. |
| `thread_user_login` | string | User login of the sender of the thread’s parent message. |
| `channel_points_custom_reward_id` | string | **Optional**. The ID of a channel points custom reward that was redeemed. |
| `source_broadcaster_user_id` | string | **Optional**. The broadcaster user ID of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_broadcaster_user_name` | string | **Optional**. The user name of the broadcaster of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_broadcaster_user_login` | string | **Optional**. The login of the broadcaster of the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_message_id` | string | **Optional**. The UUID that identifies the source message from the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_badges` | object | **Optional**. The list of chat badges for the chatter in the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `set_id` | string | The ID that identifies this set of chat badges. For example, Bits or Subscriber. |
| `id` | string | The ID that identifies this version of the badge. The ID can be any value. For example, for Bits, the ID is the Bits tier level, but for World of Warcraft, it could be Alliance or Horde. |
| `info` | string | Contains metadata related to the chat badges in the badges tag. Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| `is_source_only` | bool | **Optional.** Determines if a message delivered during a shared chat session is only sent to the source channel. Has no effect if the message is not sent during a shared chat session. |

### Channel Chat Message Delete Event  {#channel-chat-message-delete-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `target_user_id` | string | The ID of the user whose message was deleted. |
| `target_user_name` | string | The user name of the user whose message was deleted. |
| `target_user_login` | string | The user login of the user whose message was deleted. |
| `message_id` | string | A UUID that identifies the message that was removed. |

### Channel Chat Notification Event  {#channel-chat-notification-event}

Note: The list below does contain the current set of supported usernotice types that are shared during shared chat. However, these are subject to change.

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `chatter_user_id` | string | The user ID of the user that sent the message. |
| `chatter_user_name` | string | The user login of the user that sent the message. |
| `chatter_is_anonymous` | bool | Whether or not the chatter is anonymous. |
| `color` | string | The color of the user’s name in the chat room. |
| `badges` | object[] | The color of the user’s name in the chat room. |
| `set_id` | string | An ID that identifies this set of chat badges. For example, Bits or Subscriber. |
| `id` | string | An ID that identifies this version of the badge. The ID can be any value. For example, for Bits, the ID is the Bits tier level, but for World of Warcraft, it could be Alliance or Horde. |
| `info` | string | Contains metadata related to the chat badges in the badges tag. Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| `system_message` | string | The message Twitch shows in the chat room for this notice. |
| `message_id` | string | A UUID that identifies the message. |
| `message` | object | The structured chat message. |
| `text` | object | The chat message in plain text. |
| `fragments` | object[] | Ordered list of chat message fragments. |
| `type` | string | The type of message fragment. Possible values:   - text - cheermote - emote - mention |
| `text` | string | Message text in fragment. |
| `cheermote` | object | **Optional**. Metadata pertaining to the cheermote. |
| `prefix` | string | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | int | The amount of Bits cheered. |
| `tier` | int | The tier level of the cheermote. |
| `emote` | object | **Optional**. Metadata pertaining to the emote. |
| `id` | string | An ID that uniquely identifies this emote. |
| `emote_set_id` | string | An ID that identifies the emote set that the emote belongs to. |
| `owner_id` | string | The ID of the broadcaster who owns the emote. |
| `format` | string[] | The formats that the emote is available in. For example, if the emote is available only as a static PNG, the array contains only static. But if the emote is available as a static PNG and an animated GIF, the array contains static and animated. The possible formats are:   - animated - An animated GIF is available for this emote. - static - A static PNG file is available for this emote. |
| `mention` | object | **Optional**. Metadata pertaining to the mention. |
| `user_id` | string | The user ID of the mentioned user. |
| `user_name` | string | The user name of the mentioned user. |
| `user_login` | string | The user login of the mentioned user. |
| `notice_type` | string | The type of notice. Possible values are:   - sub - resub - sub_gift - community_sub_gift - gift_paid_upgrade - prime_paid_upgrade - raid - unraid - pay_it_forward - announcement - bits_badge_tier - charity_donation - watch_streak - modiversary - gifted_drops_summary - shared_chat_sub - shared_chat_resub - shared_chat_sub_gift - shared_chat_community_sub_gift - shared_chat_gift_paid_upgrade - shared_chat_prime_paid_upgrade - shared_chat_raid - shared_chat_pay_it_forward - shared_chat_announcement - shared_chat_modiversary - shared_chat_gifted_drops_summary - unknown |
| `sub` | object | Information about the sub event. Null if `notice_type` is not `sub`. |
| `sub_tier` | string | The type of subscription plan being used. Possible values are:   - 1000 - First level of paid or Prime subscription. - 2000 - Second level of paid subscription. - 3000 - Third level of paid subscription. |
| `is_prime` | bool | Indicates if the subscription was obtained through Amazon Prime. |
| `duration_months` | int | The number of months the subscription is for. |
| `resub` | object | Information about the resub event. Null if `notice_type` is not `resub`. |
| `cumulative_months` | int | The total number of months the user has subscribed. |
| `duration_months` | int | The number of months the subscription is for. |
| `streak_months` | int | The total number of months the user has subscribed. |
| `sub_tier` | string | The type of subscription plan being used. Possible values are:   - 1000 - First level of paid or Prime subscription. - 2000 - Second level of paid subscription. - 3000 - Third level of paid subscription. |
| `is_prime` | bool | **Optional**. Whether or not this subscription is a Prime subscription. |
| `is_gift` | bool | Whether or not the resub was a result of a gift. |
| `gifter_is_anonymous` | bool | **Optional**. Whether or not the gift was anonymous. |
| `gifter_user_id` | string | The user ID of the subscription gifter. Null if anonymous. |
| `gifter_user_name` | string | The user name of the subscription gifter. Null if anonymous. |
| `gifter_user_login` | string | **Optional**. The user login of the subscription gifter. Null if anonymous. |
| `sub_gift` | object | Information about the gift sub event. Null if notice_type is not sub_gift. |
| `duration_months` | int | The number of months the subscription is for. |
| `cumulative_total` | int | **Optional**. The amount of gifts the gifter has given in this channel. Null if anonymous. |
| `recipient_user_id` | string | The user ID of the subscription gift recipient. |
| `recipient_user_name` | string | The user name of the subscription gift recipient. |
| `recipient_user_login` | string | The user login of the subscription gift recipient. |
| `sub_tier` | string | The type of subscription plan being used. Possible values are:   - 1000 - First level of paid or Prime subscription. - 2000 - Second level of paid subscription. - 3000 - Third level of paid subscription. |
| `community_gift_id` | string | **Optional**. The ID of the associated community gift. Null if not associated with a community gift. |
| `community_sub_gift` | object | Information about the community gift sub event. Null if `notice_type` is not `community_sub_gift`. |
| `id` | string | The ID of the associated community gift. |
| `total` | int | Number of subscriptions being gifted. |
| `sub_tier` | string | The type of subscription plan being used. Possible values are:   - 1000 - First level of paid or Prime subscription. - 2000 - Second level of paid subscription. - 3000 - Third level of paid subscription. |
| `cumulative_total` | int | **Optional**. The amount of gifts the gifter has given in this channel. Null if anonymous. |
| `gift_paid_upgrade` | object | Information about the community gift paid upgrade event. Null if `notice_type` is not `gift_paid_upgrade`. |
| `gifter_is_anonymous` | bool | Whether the gift was given anonymously. |
| `gifter_user_id` | string | **Optional**. The user ID of the user who gifted the subscription. Null if anonymous. |
| `gifter_user_name` | string | **Optional**. The user name of the user who gifted the subscription. Null if anonymous. |
| `prime_paid_upgrade` | object | Information about the Prime gift paid upgrade event. Null if `notice_type` is not `prime_paid_upgrade` |
| `sub_tier` | string | The type of subscription plan being used. Possible values are:   - 1000 - First level of paid or Prime subscription. - 2000 - Second level of paid subscription. - 3000 - Third level of paid subscription. |
| `pay_it_forward` | object | Information about the pay it forward event. Null if `notice_type` is not `pay_it_forward` |
| `gifter_is_anonymous` | bool | Whether the gift was given anonymously. |
| `gifter_user_id` | string | The user ID of the user who gifted the subscription. Null if anonymous. |
| `gifter_user_name` | string | **Optional**. The user name of the user who gifted the subscription. Null if anonymous. |
| `gifter_user_login` | string | The user login of the user who gifted the subscription. Null if anonymous. |
| `raid` | object | Information about the raid event. Null if `notice_type` is not `raid` |
| `user_id` | string | The user ID of the broadcaster raiding this channel. |
| `user_name` | string | The user name of the broadcaster raiding this channel. |
| `user_login` | string | The login name of the broadcaster raiding this channel. |
| `viewer_count` | int | The number of viewers raiding this channel from the broadcaster’s channel. |
| `profile_image_url` | string | Profile image URL of the broadcaster raiding this channel. |
| `unraid` | object | Returns an empty payload if `notice_type` is not `unraid`, otherwise returns null. |
| `announcement` | object | Information about the announcement event. Null if `notice_type` is not `announcement` |
| `color` | string | Color of the announcement. |
| `bits_badge_tier` | object | Information about the Bits badge tier event. Null if `notice_type` is not `bits_badge_tier` |
| `tier` | int | The tier of the Bits badge the user just earned. For example, 100, 1000, or 10000. |
| `charity_donation` | string | Information about the announcement event. Null if `notice_type` is not `charity_donation` |
| `charity_name` | string | Name of the charity. |
| `amount` | object | An object that contains the amount of money that the user paid. |
| `value` | int | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, value is set to 550. |
| `decimal_place` | int | The number of decimal places used by the currency. For example, USD uses two decimal places. |
| `currency` | string | The [ISO-4217](https://www.iso.org/iso-4217-currency-codes.html) three-letter currency code that identifies the type of currency in value. |
| `watch_streak` | object | Information about the Watch Streak event. Null if `notice_type` is not `watch_streak`. |
| `streak_count` | int | The number of consecutive broadcasts for which the user has been watching. |
| `channel_points_awarded` | int | The number of channel points awarded for the Watch Streak milestone. |
| `modiversary` | object | Information about the modiversary event. Null if `notice_type` is not `modiversary`. |
| `months` | int | The number of months the user has been a moderator in this channel. |
| `gifted_drops_summary` | object | Information about the gifted Drops summary event. Null if `notice_type` is not `gifted_drops_summary`. |
| `recipient_count` | int | The number of users who received a gifted Drop. |
| `source_broadcaster_user_id` | string | **Optional**. The broadcaster user ID of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_broadcaster_user_name` | string | **Optional**. The user name of the broadcaster of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_broadcaster_user_login` | string | **Optional**. The login of the broadcaster of the channel the message was sent from. Is null when the message notification happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_message_id` | string | **Optional**. The UUID that identifies the source message from the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `source_badges` | object | **Optional**. The list of chat badges for the chatter in the channel the message was sent from. Is null when the message happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `set_id` | string | The ID that identifies this set of chat badges. For example, Bits or Subscriber. |
| `id` | string | The ID that identifies this version of the badge. The ID can be any value. For example, for Bits, the ID is the Bits tier level, but for World of Warcraft, it could be Alliance or Horde. |
| `info` | string | Contains metadata related to the chat badges in the badges tag. Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| `is_source_only` | bool | **Optional**. Whether the notification is only sent to the source channel. Is `null` if the notification is not in a shared chat session. |
| `shared_chat_sub` | object | **Optional**. Information about the `shared_chat_sub` event. Is null if `notice_type` is not `shared_chat_sub`. This field has the same information as the `sub` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_resub` | object | **Optional**. Information about the `shared_chat_resub` event. Is null if `notice_type` is not `shared_chat_resub`. This field has the same information as the `resub` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_sub_gift` | object | **Optional**. Information about the `shared_chat_sub_gift` event. Is null if `notice_type` is not `shared_chat_sub_gift`. This field has the same information as the `chat_sub_gift` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_community_sub_gift` | object | **Optional**. Information about the `shared_chat_community_sub_gift` event. Is null if `notice_type` is not `shared_chat_community_sub_gift`. This field has the same information as the `community_sub_gift` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_gift_paid_upgrade` | object | **Optional**. Information about the `shared_chat_gift_paid_upgrade` event. Is null if `notice_type` is not `shared_chat_gift_paid_upgrade`. This field has the same information as the `gift_paid_upgrade` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_prime_paid_upgrade` | object | **Optional**. Information about the `shared_chat_chat_prime_paid_upgrade` event. Is null if `notice_type` is not `shared_chat_prime_paid_upgrade`. This field has the same information as the `prime_paid_upgrade` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_pay_it_forward` | object | **Optional**. Information about the `shared_chat_pay_it_forward` event. Is null if `notice_type` is not `shared_chat_pay_it_forward`. This field has the same information as the `pay_it_forward` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_raid` | object | **Optional**. Information about the `shared_chat_raid` event. Is null if `notice_type` is not `shared_chat_raid`. This field has the same information as the `raid` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_announcement` | object | **Optional**. Information about the `shared_chat_announcement` event. Is null if `notice_type` is not `shared_chat_announcement`. This field has the same information as the `announcement` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_modiversary` | object | **Optional**. Information about the `shared_chat_modiversary` event. Is null if `notice_type` is not `shared_chat_modiversary`. This field has the same information as the `modiversary` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_gifted_drops_summary` | object | **Optional**. Information about the `shared_chat_gifted_drops_summary` event. Is null if `notice_type` is not `shared_chat_gifted_drops_summary`. This field has the same information as the `gifted_drops_summary` field but for a notice that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |

### Channel Chat Settings Update Event  {#channel-chat-settings-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | string | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | string | The user name of the broadcaster specified in the request. |
| `emote_mode` | bool | A Boolean value that determines whether chat messages must contain only emotes. True if only messages that are 100% emotes are allowed; otherwise false. |
| `follower_mode` | bool | A Boolean value that determines whether the broadcaster restricts the chat room to followers only, based on how long they’ve followed.  True if the broadcaster restricts the chat room to followers only; otherwise false.  See `follower_mode_duration_minutes` for how long the followers must have followed the broadcaster to participate in the chat room. |
| `follower_mode_duration_minutes` | int | The length of time, in minutes, that the followers must have followed the broadcaster to participate in the chat room. See `follower_mode`.  Null if `follower_mode` is false. |
| `slow_mode` | bool | A Boolean value that determines whether the broadcaster limits how often users in the chat room are allowed to send messages.  Is true, if the broadcaster applies a delay; otherwise, false.  See `slow_mode_wait_time_seconds` for the delay. |
| `slow_mode_wait_time_seconds` | int | The amount of time, in seconds, that users need to wait between sending messages. See `slow_mode`.  Null if `slow_mode` is false. |
| `subscriber_mode` | bool | A Boolean value that determines whether only users that subscribe to the broadcaster’s channel can talk in the chat room.  True if the broadcaster restricts the chat room to subscribers only; otherwise false. |
| `unique_chat_mode` | bool | A Boolean value that determines whether the broadcaster requires users to post only unique messages in the chat room.  True if the broadcaster requires unique messages only; otherwise false. |

### Channel Chat User Message Hold Event  {#channel-chat-user-message-hold-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The User ID of the message sender. |
| `user_login` | String | The message sender’s login. |
| `user_name` | String | The message sender’s display name. |
| `message_id` | String | The ID of the message that was flagged by automod. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Ordered list of chat message fragments. |
| `text` | String | Message text in a fragment. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |

### Channel Chat User Message Update Event  {#channel-chat-user-message-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the broadcaster specified in the request. |
| `broadcaster_user_login` | String | The login of the broadcaster specified in the request. |
| `broadcaster_user_name` | String | The user name of the broadcaster specified in the request. |
| `user_id` | String | The User ID of the message sender. |
| `user_login` | String | The message sender’s login. |
| `user_name` | String | The message sender’s user name. |
| `status` | String | The message’s status. Possible values are:  - approved - denied - invalid |
| `message_id` | String | The ID of the message that was flagged by automod. |
| `message` | Object | The body of the message. |
| `text` | String | The contents of the message caught by automod. |
| `fragments` | Object[] | Ordered list of chat message fragments. |
| `text` | String | Message text in a fragment. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits, converted to lowercase. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.  **For example**, if the prefix is “cheer” and you want to cheer 100 Bits, the full Cheermote string is cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | Int | The amount of Bits cheered. |
| `tier` | Int | The tier level of the cheermote. |

### Channel Subscribe Event  {#channel-subscribe-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID for the user who subscribed to the specified channel. |
| `user_login` | string | The user login for the user who subscribed to the specified channel. |
| `user_name` | string | The user display name for the user who subscribed to the specified channel. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `tier` | string | The tier of the subscription. Valid values are `1000`, `2000`, and `3000`. |
| `is_gift` | boolean | Whether the subscription is a gift. |

### Channel Cheer Event  {#channel-cheer-event}

| Name | Type | Description |
|---|---|---|
| `is_anonymous` | boolean | Whether the user cheered anonymously or not. |
| `user_id` | string | The user ID for the user who cheered on the specified channel. This is null if `is_anonymous` is true. |
| `user_login` | string | The user login for the user who cheered on the specified channel. This is null if `is_anonymous` is true. |
| `user_name` | string | The user display name for the user who cheered on the specified channel. This is null if `is_anonymous` is true. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `message` | string | The message sent with the cheer. |
| `bits` | integer | The number of Bits cheered. |

### Channel Update Event  {#channel-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The broadcaster’s user ID. |
| `broadcaster_user_login` | string | The broadcaster’s user login. |
| `broadcaster_user_name` | string | The broadcaster’s user display name. |
| `title` | string | The channel’s stream title. |
| `language` | string | The channel’s broadcast language. |
| `category_id` | string | The channel’s category ID. |
| `category_name` | string | The category name. |
| `content_classification_labels` | string[] | Array of content classification label IDs currently applied on the Channel. To retrieve a list of all possible IDs, use the [Get Content Classification Labels](/docs/api/reference/#get-content-classification-labels) API endpoint. |

### Channel Unban Event  {#channel-unban-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user id for the user who was unbanned on the specified channel. |
| `user_login` | string | The user login for the user who was unbanned on the specified channel. |
| `user_name` | string | The user display name for the user who was unbanned on the specified channel. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `moderator_user_id` | string | The user ID of the issuer of the unban. |
| `moderator_user_login` | string | The user login of the issuer of the unban. |
| `moderator_user_name` | string | The user name of the issuer of the unban. |

### Channel Unban Request Create Event  {#channel-unban-request-create-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The ID of the unban request. |
| `broadcaster_user_id` | string | The broadcaster’s user ID for the channel the unban request was created for. |
| `broadcaster_user_login` | string | The broadcaster’s login name. |
| `broadcaster_user_name` | string | The broadcaster’s display name. |
| `user_id` | string | User ID of user that is requesting to be unbanned. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `text` | string | Message sent in the unban request. |
| `created_at` | string | The UTC timestamp (in RFC3339 format) of when the unban request was created. |

### Channel Unban Request Resolve Event  {#channel-unban-request-resolve-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The ID of the unban request. |
| `broadcaster_user_id` | string | The broadcaster’s user ID for the channel the unban request was updated for. |
| `broadcaster_user_login` | string | The broadcaster’s login name. |
| `broadcaster_user_name` | string | The broadcaster’s display name. |
| `moderator_id` | string | Optional. User ID of moderator who approved/denied the request. |
| `moderator_login` | string | Optional. The moderator’s login name |
| `moderator_name` | string | Optional. The moderator’s display name |
| `user_id` | string | User ID of user that requested to be unbanned. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `resolution_text` | string | Optional. Resolution text supplied by the mod/broadcaster upon approval/denial of the request. |
| `status` | string | Dictates whether the unban request was approved or denied. Can be the following:   - approved - canceled - denied |

### Channel Follow Event  {#channel-follow-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID for the user now following the specified channel. |
| `user_login` | string | The user login for the user now following the specified channel. |
| `user_name` | string | The user display name for the user now following the specified channel. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `followed_at` | string | RFC3339 timestamp of when the follow occurred. |

### Channel Raid Event  {#channel-raid-event}

| Name | Type | Description |
|---|---|---|
| `from_broadcaster_user_id` | string | The broadcaster ID that created the raid. |
| `from_broadcaster_user_login` | string | The broadcaster login that created the raid. |
| `from_broadcaster_user_name` | string | The broadcaster display name that created the raid. |
| `to_broadcaster_user_id` | string | The broadcaster ID that received the raid. |
| `to_broadcaster_user_login` | string | The broadcaster login that received the raid. |
| `to_broadcaster_user_name` | string | The broadcaster display name that received the raid. |
| `viewers` | integer | The number of viewers in the raid. |

### Channel Moderate Event  {#channel-moderate-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The user name of the broadcaster. |
| `source_broadcaster_user_id` | string | The channel in which the action originally occurred. Is the same as the `broadcaster_user_id` if not in shared chat. |
| `source_broadcaster_user_login` | string | The channel in which the action originally occurred. Is the same as the `broadcaster_user_login` if not in shared chat. |
| `source_broadcaster_user_name` | string | The channel in which the action originally occurred. Is null when the moderator action happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `moderator_user_id` | string | The ID of the moderator who performed the action. |
| `moderator_user_login` | string | The login of the moderator. |
| `moderator_user_name` | string | The user name of the moderator. |
| `action` | string | The type of action: Possible values are:   - ban - timeout - unban - untimeout - clear - emoteonly - emoteonlyoff - followers - followersoff - uniquechat - uniquechatoff - slow - slowoff - subscribers - subscribersoff - unraid - delete - unvip - vip - raid - add_blocked_term - add_permitted_term - remove_blocked_term - remove_permitted_term - mod - unmod - approve_unban_request - deny_unban_request - shared_chat_ban - shared_chat_timeout - shared_chat_untimeout - shared_chat_unban - shared_chat_delete |
| `followers` | object | **Optional**.. Metadata associated with the followers command. |
| `follow_duration_minutes` | Int | The length of time, in minutes, that the followers must have followed the broadcaster to participate in the chat room. |
| `slow` | object | **Optional**. Metadata associated with the slow command. |
| `wait_time_seconds` | int | The amount of time, in seconds, that users need to wait between sending messages. |
| `vip` | object | **Optional**. Metadata associated with the vip command. |
| `user_id` | string | The ID of the user gaining VIP status. |
| `user_login` | string | The login of the user gaining VIP status. |
| `user_name` | string | The user name of the user gaining VIP status. |
| `unvip` | object | **Optional**. Metadata associated with the unvip command. |
| `user_id` | string | The ID of the user losing VIP status. |
| `user_login` | string | The login of the user losing VIP status. |
| `user_name` | string | The user name of the user losing VIP status. |
| `mod` | object | **Optional**. Metadata associated with the mod command. |
| `user_id` | string | The ID of the user gaining mod status. |
| `user_login` | string | The login of the user gaining mod status. |
| `user_name` | string | The user name of the user gaining mod status. |
| `unmod` | object | **Optional**. Metadata associated with the unmod command. |
| `user_id` | string | The ID of the user losing mod status. |
| `user_login` | string | The login of the user losing mod status. |
| `user_name` | string | The user name of the user losing mod status. |
| `ban` | object | **Optional**. Metadata associated with the ban command. |
| `user_id` | string | The ID of the user being banned. |
| `user_login` | string | The login of the user being banned. |
| `user_name` | string | The user name of the user being banned. |
| `reason` | string | **Optional**. Reason given for the ban. |
| `unban` | object | **Optional**. Metadata associated with the unban command. |
| `user_id` | string | The ID of the user being unbanned. |
| `user_login` | string | The login of the user being unbanned. |
| `user_name` | string | The user name of the user being unbanned. |
| `timeout` | object | **Optional**.. Metadata associated with the timeout command. |
| `user_id` | string | The ID of the user being timed out. |
| `user_login` | string | The login of the user being timed out. |
| `user_name` | string | The user name of the user being timed out. |
| `reason` | string | **Optional**.. The reason given for the timeout. |
| `expires_at` | string | The time at which the timeout ends. |
| `untimeout` | object | **Optional**. Metadata associated with the untimeout command. |
| `user_id` | string | The ID of the user being untimed out. |
| `user_login` | string | The login of the user being untimed out. |
| `user_name` | string | The user name of the user untimed out. |
| `raid` | object | **Optional**. Metadata associated with the raid command. |
| `user_id` | string | The ID of the user being raided. |
| `user_login` | string | The login of the user being raided. |
| `user_name` | string | The user name of the user raided. |
| `viewer_count` | Int | The viewer count. |
| `unraid` | object | **Optional**. Metadata associated with the unraid command. |
| `user_id` | string | The ID of the user no longer being raided. |
| `user_login` | string | The login of the user no longer being raided. |
| `user_name` | string | The user name of the no longer user raided. |
| `delete` | object | **Optional**. Metadata associated with the delete command. |
| `user_id` | string | The ID of the user whose message is being deleted. |
| `user_login` | string | The login of the user. |
| `user_name` | string | The user name of the user. |
| `message_id` | string | The ID of the message being deleted. |
| `message_body` | string | The message body of the message being deleted. |
| `automod_terms` | object | **Optional**. Metadata associated with the automod terms changes. |
| `action` | string | Either “add” or “remove”. |
| `list` | string | Either “blocked” or “permitted”. |
| `terms` | string[] | Terms being added or removed. |
| `from_automod` | bool | Whether the terms were added due to an Automod message approve/deny action. |
| `unban_request` | object | **Optional**. Metadata associated with an unban request. |
| `is_approved` | bool | Whether or not the unban request was approved or denied. |
| `user_id` | string | The ID of the banned user. |
| `user_login` | string | The login of the user. |
| `user_name` | string | The user name of the user. |
| `moderator_message` | string | The message included by the moderator explaining their approval or denial. |
| `shared_chat_ban` | object | **Optional**. Information about the `shared_chat_ban` event. Is null if `action` is not `shared_chat_ban`. This field has the same information as the `ban` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_unban` | object | **Optional**. Information about the `shared_chat_unban` event. Is null if `action` is not `shared_chat_unban`. This field has the same information as the `unban` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_timeout` | object | **Optional**. Information about the `shared_chat_timeout` event. Is null if `action` is not `shared_chat_timeout`. This field has the same information as the `timeout` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_untimeout` | object | **Optional**. Information about the `shared_chat_untimeout` event. Is null if `action` is not `shared_chat_untimeout`. This field has the same information as the `untimeout` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_delete` | object | **Optional**. Information about the `shared_chat_delete` event. Is null if `action` is not `shared_chat_delete`. This field has the same information as the `delete` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |

### Channel Moderate Event V2  {#channel-moderate-event-v2}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The user name of the broadcaster. |
| `source_broadcaster_user_id` | string | The channel in which the action originally occurred. Is the same as the broadcaster_user_id if not in shared chat. |
| `source_broadcaster_user_login` | string | The channel in which the action originally occurred. Is the same as the broadcaster_user_login if not in shared chat. |
| `source_broadcaster_user_name` | string | The channel in which the action originally occurred. Is null when the moderator action happens in the same channel as the broadcaster. Is not null when in a shared chat session, and the action happens in the channel of a participant other than the broadcaster. |
| `moderator_user_id` | string | The ID of the moderator who performed the action. |
| `moderator_user_login` | string | The login of the moderator. |
| `moderator_user_name` | string | The user name of the moderator. |
| `action` | string | The action performed. Possible values are:   - ban - timeout - unban - untimeout - clear - emoteonly - emoteonlyoff - followers - followersoff - uniquechat - uniquechatoff - slow - slowoff - subscribers - subscribersoff - unraid - delete - unvip - vip - raid - add_blocked_term - add_permitted_term - remove_blocked_term - remove_permitted_term - mod - unmod - approve_unban_request - deny_unban_request - warn - shared_chat_ban - shared_chat_timeout - shared_chat_unban - shared_chat_untimeout - shared_chat_delete |
| `followers` | object | **Optional**. Metadata associated with the followers command. |
| `follow_duration_minutes` | Int | The length of time, in minutes, that the followers must have followed the broadcaster to participate in the chat room. |
| `slow` | object | **Optional**. Metadata associated with the slow command. |
| `wait_time_seconds` | int | The amount of time, in seconds, that users need to wait between sending messages. |
| `vip` | object | **Optional**. Metadata associated with the vip command. |
| `user_id` | string | The ID of the user gaining VIP status. |
| `user_login` | string | The login of the user gaining VIP status. |
| `user_name` | string | The user name of the user gaining VIP status. |
| `unvip` | object | **Optional**. Metadata associated with the unvip command. |
| `user_id` | string | The ID of the user losing VIP status. |
| `user_login` | string | The login of the user losing VIP status. |
| `user_name` | string | The user name of the user losing VIP status. |
| `mod` | object | **Optional**. Metadata associated with the mod command. |
| `user_id` | string | The ID of the user gaining mod status. |
| `user_login` | string | The login of the user gaining mod status. |
| `user_name` | string | The user name of the user gaining mod status. |
| `unmod` | object | **Optional**. Metadata associated with the unmod command. |
| `user_id` | string | The ID of the user losing mod status. |
| `user_login` | string | The login of the user losing mod status. |
| `user_name` | string | The user name of the user losing mod status. |
| `ban` | object | **Optional**. Metadata associated with the ban command. |
| `user_id` | string | The ID of the user being banned. |
| `user_login` | string | The login of the user being banned. |
| `user_name` | string | The user name of the user being banned. |
| `reason` | string | **Optional**. Reason given for the ban. |
| `unban` | object | **Optional**. Metadata associated with the unban command. |
| `user_id` | string | The ID of the user being unbanned. |
| `user_login` | string | The login of the user being unbanned. |
| `user_name` | string | The user name of the user being unbanned. |
| `timeout` | object | **Optional**. Metadata associated with the timeout command. |
| `user_id` | string | The ID of the user being timed out. |
| `user_login` | string | The login of the user being timed out. |
| `user_name` | string | The user name of the user being timed out. |
| `reason` | string | **Optional**. The reason given for the timeout. |
| `expires_at` | string | The time at which the timeout ends. |
| `untimeout` | object | **Optional**. Metadata associated with the untimeout command. |
| `user_id` | string | The ID of the user being untimed out. |
| `user_login` | string | The login of the user being untimed out. |
| `user_name` | string | The user name of the user untimed out. |
| `raid` | object | **Optional**. Metadata associated with the raid command. |
| `user_id` | string | The ID of the user being raided. |
| `user_login` | string | The login of the user being raided. |
| `user_name` | string | The user name of the user raided. |
| `viewer_count` | Int | The viewer count. |
| `unraid` | object | **Optional**. Metadata associated with the unraid command. |
| `user_id` | string | The ID of the user no longer being raided. |
| `user_login` | string | The login of the user no longer being raided. |
| `user_name` | string | The user name of the no longer user raided. |
| `delete` | object | **Optional**. Metadata associated with the delete command. |
| `user_id` | string | The ID of the user whose message is being deleted. |
| `user_login` | string | The login of the user. |
| `user_name` | string | The user name of the user. |
| `message_id` | string | The ID of the message being deleted. |
| `message_body` | string | The message body of the message being deleted. |
| `automod_terms` | object | **Optional**. Metadata associated with the automod terms changes. |
| `action` | string | Either “add” or “remove”. |
| `list` | string | Either “blocked” or “permitted”. |
| `terms` | string[] | Terms being added or removed. |
| `from_automod` | bool | Whether the terms were added due to an Automod message approve/deny action. |
| `unban_request` | object | **Optional**. Metadata associated with an unban request. |
| `is_approved` | bool | Whether or not the unban request was approved or denied. |
| `user_id` | string | The ID of the banned user. |
| `user_login` | string | The login of the user. |
| `user_name` | string | The user name of the user. |
| `moderator_message` | string | The message included by the moderator explaining their approval or denial. |
| `warn` | object | **Optional**. Metadata associated with the warn command. |
| `user_id` | string | The ID of the user being warned. |
| `user_login` | string | The login of the user being warned. |
| `user_name` | string | The user name of the user being warned. |
| `reason` | string | **Optional**. Reason given for the warning. |
| `chat_rules_cited` | []string | **Optional**. Chat rules cited for the warning. |
| `shared_chat_ban` | object | **Optional**. Information about the `shared_chat_ban` event. Is null if `action` is not `shared_chat_ban`. This field has the same information as the `ban` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_unban` | object | **Optional**. Information about the `shared_chat_unban` event. Is null if `action` is not `shared_chat_unban`. This field has the same information as the `unban` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_timeout` | object | **Optional**. Information about the `shared_chat_timeout` event. Is null if `action` is not `shared_chat_timeout`. This field has the same information as the `timeout` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_untimeout` | object | **Optional**. Information about the `shared_chat_untimeout` event. Is null if `action` is not `shared_chat_untimeout`. This field has the same information as the `untimeout` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |
| `shared_chat_delete` | object | **Optional**. Information about the `shared_chat_delete` event. Is null if `action` is not `shared_chat_delete`. This field has the same information as the `delete` field but for a action that happened for a channel in a shared chat session other than the broadcaster in the subscription condition. |

### Channel Moderator Add Event  {#channel-moderator-add-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `user_id` | string | The user ID of the new moderator. |
| `user_login` | string | The user login of the new moderator. |
| `user_name` | string | The display name of the new moderator. |

### Channel Moderator Remove Event  {#channel-moderator-remove-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `user_id` | string | The user ID of the removed moderator. |
| `user_login` | string | The user login of the removed moderator. |
| `user_name` | string | The display name of the removed moderator. |

### Channel Guest Star Session Begin Event  {#channel-guest-star-session-begin-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The broadcaster user ID. |
| `broadcaster_user_name` | String | The broadcaster display name. |
| `broadcaster_user_login` | String | The broadcaster login. |
| `session_id` | String | ID representing the unique session that was started. |
| `started_at` | String | RFC3339 timestamp indicating the time the session began. |

### Channel Guest Star Session End Event  {#channel-guest-star-session-end-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The non-host broadcaster user ID. |
| `broadcaster_user_name` | String | The non-host broadcaster display name. |
| `broadcaster_user_login` | String | The non-host broadcaster login. |
| `session_id` | String | ID representing the unique session that was started. |
| `started_at` | String | RFC3339 timestamp indicating the time the session began. |
| `ended_at` | String | RFC3339 timestamp indicating the time the session ended. |
| `host_user_id` | String | User ID of the host channel. |
| `host_user_name` | String | The host display name. |
| `host_user_login` | String | The host login. |

### Channel Guest Star Guest Update Event  {#channel-guest-star-guest-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The non-host broadcaster user ID. |
| `broadcaster_user_name` | String | The non-host broadcaster display name. |
| `broadcaster_user_login` | String | The non-host broadcaster login. |
| `session_id` | String | ID representing the unique session that was started. |
| `moderator_user_id` | String | The user ID of the moderator who updated the guest’s state (could be the host). `null` if the update was performed by the guest. |
| `moderator_user_name` | String | The moderator display name.`null` if the update was performed by the guest. |
| `moderator_user_login` | String | The moderator login. `null` if the update was performed by the guest. |
| `guest_user_id` | String | The user ID of the guest who transitioned states in the session. `null` if the slot is now empty. |
| `guest_user_name` | String | The guest display name. `null` if the slot is now empty. |
| `guest_user_login` | String | The guest login. `null` if the slot is now empty. |
| `slot_id` | String | The ID of the slot assignment the guest is assigned to. `null` if the guest is in the INVITED, REMOVED, READY, or ACCEPTED state. |
| `state` | String | The current state of the user after the update has taken place. `null` if the slot is now empty. Can otherwise be one of the following:   - `invited` — The guest has transitioned to the invite queue. This can take place when the guest was previously assigned a slot, but have been removed from the call and are sent back to the invite queue. - `accepted` — The guest has accepted the invite and is currently in the process of setting up to join the session. - `ready` — The guest has signaled they are ready and can be assigned a slot. - `backstage` — The guest has been assigned a slot in the session, but is not currently seen live in the broadcasting software. - `live` — The guest is now live in the host's broadcasting software. - `removed` — The guest was removed from the call or queue. |
| `host_user_id` | String | User ID of the host channel. |
| `host_user_name` | String | The host display name. |
| `host_user_login` | String | The host login. |
| `host_video_enabled` | Bool | Flag that signals whether the host is allowing the slot’s video to be seen by participants within the session. `null` if the guest is not slotted. |
| `host_audio_enabled` | Bool | Flag that signals whether the host is allowing the slot’s audio to be heard by participants within the session. `null` if the guest is not slotted. |
| `host_volume` | int | Value between 0-100 that represents the slot’s audio level as heard by participants within the session. `null` if the guest is not slotted. |

### Channel Guest Star Settings Update Event  {#channel-guest-star-settings-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | User ID of the host channel. |
| `broadcaster_user_name` | String | The broadcaster display name |
| `broadcaster_user_login` | String | he broadcaster login. |
| `is_moderator_send_live_enabled` | Bool | Flag determining if Guest Star moderators have access to control whether a guest is live once assigned to a slot. |
| `slot_count` | Int | Number of slots the Guest Star call interface will allow the host to add to a call. |
| `is_browser_source_audio_enabled` | Bool | Flag determining if browser sources subscribed to sessions on this channel should output audio. |
| `group_layout` | String | This setting determines how the guests within a session should be laid out within a group browser source. Can be one of the following values:   - `tiled` — All live guests are tiled within the browser source with the same size. - `screenshare` — All live guests are tiled within the browser source with the same size. If there is an active screen share, it is sized larger than the other guests. - `horizontal_top` — Indicates the group layout will contain all participants in a top-aligned horizontal stack. - `horizontal_bottom` — Indicates the group layout will contain all participants in a bottom-aligned horizontal stack. - `vertical_left` — Indicates the group layout will contain all participants in a left-aligned vertical stack. - `vertical_right` — Indicates the group layout will contain all participants in a right-aligned vertical stack. |

### Channel Poll Begin Event  {#channel-poll-begin-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | ID of the poll. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Question displayed for the poll. |
| `choices` | choices | An array of choices for the poll. |
| `bits_voting` | bits_voting | Not supported. |
| `channel_points_voting` | channel_points_voting | The Channel Points voting settings for the poll. |
| `started_at` | string | The time the poll started. |
| `ends_at` | string | The time the poll will end. |

### Channel Poll Progress Event  {#channel-poll-progress-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | ID of the poll. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Question displayed for the poll. |
| `choices` | choices | An array of choices for the poll. Includes vote counts. |
| `bits_voting` | bits_voting | Not supported. |
| `channel_points_voting` | channel_points_voting | The Channel Points voting settings for the poll. |
| `started_at` | string | The time the poll started. |
| `ends_at` | string | The time the poll will end. |

### Channel Poll End Event  {#channel-poll-end-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | ID of the poll. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Question displayed for the poll. |
| `choices` | choices | An array of choices for the poll. Includes vote counts. |
| `bits_voting` | bits_voting | Not supported. |
| `channel_points_voting` | channel_points_voting | The Channel Points voting settings for the poll. |
| `status` | string | The status of the poll. Valid values are `completed`, `archived`, and `terminated`. |
| `started_at` | string | The time the poll started. |
| `ended_at` | string | The time the poll ended. |

### Channel Points Automatic Reward Redemption Add Event  {#channel-points-automatic-reward-redemption-add-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the channel where the reward was redeemed. |
| `broadcaster_user_login` | string | The login of the channel where the reward was redeemed. |
| `broadcaster_user_name` | string | The display name of the channel where the reward was redeemed. |
| `user_id` | string | The ID of the redeeming user. |
| `user_login` | string | The login of the redeeming user. |
| `user_name` | string | The display name of the redeeming user. |
| `id` | string | The ID of the Redemption. |
| `reward` | object | An object that contains the reward information. |
| `type` | string | The type of reward. One of:   - single_message_bypass_sub_mode - send_highlighted_message - random_sub_emote_unlock - chosen_sub_emote_unlock - chosen_modified_sub_emote_unlock - message_effect - gigantify_an_emote - celebration |
| `cost` | int | The reward cost. |
| `unlocked_emote` | object | Optional. Emote that was unlocked. |
| `id` | string | The emote ID. |
| `name` | string | The human readable emote token. |
| `message` | [Message](/docs/eventsub/eventsub-reference/#message) | An object that contains the user message and emote information needed to recreate the message. |
| `text` | string | The text of the chat message. |
| `emotes` | object[] | An array that includes the emote ID and start and end positions for where the emote appears in the text. |
| `id` | string | The emote ID. |
| `begin` | int | The index of where the Emote starts in the text. |
| `end` | int | The index of where the Emote ends in the text. |
| `user_input` | string | Optional. A string that the user entered if the reward requires input. |
| `redeemed_at` | string | The UTC date and time (in RFC3339 format) of when the reward was redeemed. |

### Channel Points Automatic Reward Redemption Add V2 Event  {#channel-points-automatic-reward-redemption-add-v2-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The ID of the channel where the reward was redeemed. |
| `broadcaster_user_login` | string | The login of the channel where the reward was redeemed. |
| `broadcaster_user_name` | string | The display name of the channel where the reward was redeemed. |
| `user_id` | string | The ID of the redeeming user. |
| `user_login` | string | The login of the redeeming user. |
| `user_name` | string | The display name of the redeeming user. |
| `id` | string | The ID of the Redemption. |
| `reward` | object | An object that contains the reward information. |
| `type` | string | The type of reward. One of:   - single_message_bypass_sub_mode - send_highlighted_message - random_sub_emote_unlock - chosen_sub_emote_unlock - chosen_modified_sub_emote_unlock |
| `channel_points` | int | Number of channel points used. |
| `emote` | object | Optional. Emote associated with the reward. |
| `id` | string | The emote ID. |
| `name` | string | The human readable emote token. |
| `message` | object | Optional. An object that contains the user message and emote information needed to recreate the message. |
| `text` | string | The chat message in plain text. |
| `fragments` | array | The ordered list of chat message fragments. |
| `text` | string | The message text in fragment. |
| `type` | string | The type of message fragment. Possible values are:   - text - emote |
| `emote` | object | Optional. The metadata pertaining to the emote. |
| `id` | string | The ID that uniquely identifies this emote. |
| `redeemed_at` | string | The UTC date and time (in RFC3339 format) of when the reward was redeemed. |

### Channel Points Custom Reward Add Event  {#channel-points-custom-reward-add-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The reward identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `is_enabled` | boolean | Is the reward currently enabled. If false, the reward won’t show up to viewers. |
| `is_paused` | boolean | Is the reward currently paused. If true, viewers can’t redeem. |
| `is_in_stock` | boolean | Is the reward currently in stock. If false, viewers can’t redeem. |
| `title` | string | The reward title. |
| `cost` | integer | The reward cost. |
| `prompt` | string | The reward description. |
| `is_user_input_required` | boolean | Does the viewer need to enter information when redeeming the reward. |
| `should_redemptions_skip_request_queue` | boolean | Should redemptions be set to `fulfilled` status immediately when redeemed and skip the request queue instead of the normal `unfulfilled` status. |
| `max_per_stream` | max_per_stream | Whether a maximum per stream is enabled and what the maximum is. |
| `max_per_user_per_stream` | max_per_user_per_stream | Whether a maximum per user per stream is enabled and what the maximum is. |
| `background_color` | string | Custom background color for the reward. Format: Hex with # prefix. Example: `#FA1ED2`. |
| `image` | image | Set of custom images of 1x, 2x and 4x sizes for the reward. Can be `null` if no images have been uploaded. |
| `default_image` | image | Set of default images of 1x, 2x and 4x sizes for the reward. |
| `global_cooldown` | global_cooldown | Whether a cooldown is enabled and what the cooldown is in seconds. |
| `cooldown_expires_at` | string | Timestamp of the cooldown expiration. `null` if the reward isn’t on cooldown. |
| `redemptions_redeemed_current_stream` | integer | The number of redemptions redeemed during the current live stream. Counts against the `max_per_stream` limit. `null` if the broadcasters stream isn’t live or `max_per_stream` isn’t enabled. |

### Channel Points Custom Reward Update Event  {#channel-points-custom-reward-update-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The reward identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `is_enabled` | boolean | Is the reward currently enabled. If false, the reward won’t show up to viewers. |
| `is_paused` | boolean | Is the reward currently paused. If true, viewers can’t redeem. |
| `is_in_stock` | boolean | Is the reward currently in stock. If false, viewers can’t redeem. |
| `title` | string | The reward title. |
| `cost` | integer | The reward cost. |
| `prompt` | string | The reward description. |
| `is_user_input_required` | boolean | Does the viewer need to enter information when redeeming the reward. |
| `should_redemptions_skip_request_queue` | boolean | Should redemptions be set to `fulfilled` status immediately when redeemed and skip the request queue instead of the normal `unfulfilled` status. |
| `max_per_stream` | max_per_stream | Whether a maximum per stream is enabled and what the maximum is. |
| `max_per_user_per_stream` | max_per_user_per_stream | Whether a maximum per user per stream is enabled and what the maximum is. |
| `background_color` | string | Custom background color for the reward. Format: Hex with # prefix. Example: `#FA1ED2`. |
| `image` | image | Set of custom images of 1x, 2x and 4x sizes for the reward. Can be `null` if no images have been uploaded. |
| `default_image` | image | Set of default images of 1x, 2x and 4x sizes for the reward. |
| `global_cooldown` | global_cooldown | Whether a cooldown is enabled and what the cooldown is in seconds. |
| `cooldown_expires_at` | string | Timestamp of the cooldown expiration. `null` if the reward isn’t on cooldown. |
| `redemptions_redeemed_current_stream` | integer | The number of redemptions redeemed during the current live stream. Counts against the `max_per_stream` limit. `null` if the broadcasters stream isn’t live or `max_per_stream` isn’t enabled. |

### Channel Points Custom Reward Remove Event  {#channel-points-custom-reward-remove-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The reward identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `is_enabled` | boolean | Is the reward currently enabled. If false, the reward won’t show up to viewers. |
| `is_paused` | boolean | Is the reward currently paused. If true, viewers can’t redeem. |
| `is_in_stock` | boolean | Is the reward currently in stock. If false, viewers can’t redeem. |
| `title` | string | The reward title. |
| `cost` | integer | The reward cost. |
| `prompt` | string | The reward description. |
| `is_user_input_required` | boolean | Does the viewer need to enter information when redeeming the reward. |
| `should_redemptions_skip_request_queue` | boolean | Should redemptions be set to `fulfilled` status immediately when redeemed and skip the request queue instead of the normal `unfulfilled` status. |
| `max_per_stream` | max_per_stream | Whether a maximum per stream is enabled and what the maximum is. |
| `max_per_user_per_stream` | max_per_user_per_stream | Whether a maximum per user per stream is enabled and what the maximum is. |
| `background_color` | string | Custom background color for the reward. Format: Hex with # prefix. Example: `#FA1ED2`. |
| `image` | image | Set of custom images of 1x, 2x and 4x sizes for the reward. Can be `null` if no images have been uploaded. |
| `default_image` | image | Set of default images of 1x, 2x and 4x sizes for the reward. |
| `global_cooldown` | global_cooldown | Whether a cooldown is enabled and what the cooldown is in seconds. |
| `cooldown_expires_at` | string | Timestamp of the cooldown expiration. `null` if the reward isn’t on cooldown. |
| `redemptions_redeemed_current_stream` | integer | The number of redemptions redeemed during the current live stream. Counts against the `max_per_stream` limit. `null` if the broadcasters stream isn’t live or `max_per_stream` isn’t enabled. |

### Channel Points Custom Reward Redemption Add Event  {#channel-points-custom-reward-redemption-add-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The redemption identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `user_id` | string | User ID of the user that redeemed the reward. |
| `user_login` | string | Login of the user that redeemed the reward. |
| `user_name` | string | Display name of the user that redeemed the reward. |
| `user_input` | string | The user input provided. Empty string if not provided. |
| `status` | string | Defaults to `unfulfilled`. Possible values are `unknown`, `unfulfilled`, `fulfilled`, and `canceled`. |
| `redeemed_at` | string | RFC3339 timestamp of when the reward was redeemed. |
| `reward` | reward | Basic information about the reward that was redeemed, at the time it was redeemed. |

### Channel Points Custom Reward Redemption Update Event  {#channel-points-custom-reward-redemption-update-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The redemption identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `user_id` | string | User ID of the user that redeemed the reward. |
| `user_login` | string | Login of the user that redeemed the reward. |
| `user_name` | string | Display name of the user that redeemed the reward. |
| `user_input` | string | The user input provided. Empty string if not provided. |
| `status` | string | Will be `fulfilled` or `canceled`. Possible values are `unknown`, `unfulfilled`, `fulfilled`, and `canceled`. |
| `reward` | reward | Basic information about the reward that was redeemed, at the time it was redeemed. |
| `redeemed_at` | string | RFC3339 timestamp of when the reward was redeemed. |

### Channel Custom Power-up Redemption Add Event  {#channel-custom-power-up-redemption-add-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The redemption identifier. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `user_id` | string | User ID of the user that redeemed the custom Power-up. |
| `user_login` | string | Login of the user that redeemed the custom Power-up. |
| `user_name` | string | Display name of the user that redeemed the custom Power-up. |
| `user_input` | string | The user input provided. Empty string if not provided. |
| `status` | string | Defaults to `unfulfilled`. Possible values are `unknown`, `unfulfilled`, `fulfilled`, and `canceled`. |
| `custom_power_up` | Custom Power Up | Basic information about the custom Power-up that was redeemed, at the time it was redeemed. |
| `redeemed_at` | string | RFC3339 timestamp of when the custom Power-up was redeemed. |

### Channel Prediction Begin Event  {#channel-prediction-begin-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | Channel Points Prediction ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Title for the Channel Points Prediction. |
| `outcomes` | outcomes | An array of outcomes for the Channel Points Prediction. |
| `started_at` | string | The time the Channel Points Prediction started. |
| `locks_at` | string | The time the Channel Points Prediction will automatically lock. |

### Channel Prediction Progress Event  {#channel-prediction-progress-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | Channel Points Prediction ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Title for the Channel Points Prediction. |
| `outcomes` | outcomes | An array of outcomes for the Channel Points Prediction. Includes top_predictors. |
| `started_at` | string | The time the Channel Points Prediction started. |
| `locks_at` | string | The time the Channel Points Prediction will automatically lock. |

### Channel Prediction Lock Event  {#channel-prediction-lock-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | Channel Points Prediction ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Title for the Channel Points Prediction. |
| `outcomes` | outcomes | An array of outcomes for the Channel Points Prediction. Includes top_predictors. |
| `started_at` | string | The time the Channel Points Prediction started. |
| `locked_at` | string | The time the Channel Points Prediction was locked. |

### Channel Prediction End Event  {#channel-prediction-end-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | Channel Points Prediction ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `title` | string | Title for the Channel Points Prediction. |
| `winning_outcome_id` | string | ID of the winning outcome. |
| `outcomes` | outcomes | An array of outcomes for the Channel Points Prediction. Includes top_predictors. |
| `status` | string | The status of the Channel Points Prediction. Valid values are `resolved` and `canceled`. |
| `started_at` | string | The time the Channel Points Prediction started. |
| `ended_at` | string | The time the Channel Points Prediction ended. |

### Channel Shared Chat Session Begin Event  {#channel-shared-chat-session-begin-event}

| Name | Type | Description |
|---|---|---|
| `session_id` | string | The unique identifier for the shared chat session. |
| `broadcaster_user_id` | string | The User ID of the channel in the subscription condition which is now active in the shared chat session. |
| `broadcaster_user_name` | string | The display name of the channel in the subscription condition which is now active in the shared chat session. |
| `broadcaster_user_login` | string | The user login of the channel in the subscription condition which is now active in the shared chat session. |
| `host_broadcaster_user_id` | string | The User ID of the host channel. |
| `host_broadcaster_user_name` | string | The display name of the host channel. |
| `host_broadcaster_user_login` | string | The user login of the host channel. |
| `participants` | object | The list of participants in the session. |
| `broadcaster_user_id` | string | The User ID of the participant channel. |
| `broadcaster_user_name` | string | The display name of the participant channel. |
| `broadcaster_user_login` | string | The user login of the participant channel. |

### Channel Shared Chat Session Update Event  {#channel-shared-chat-session-update-event}

| Name | Type | Description |
|---|---|---|
| `session_id` | string | The unique identifier for the shared chat session. |
| `broadcaster_user_id` | string | The User ID of the channel in the subscription condition. |
| `broadcaster_user_name` | string | The display name of the channel in the subscription condition. |
| `broadcaster_user_login` | string | The user login of the channel in the subscription condition. |
| `host_broadcaster_user_id` | string | The User ID of the host channel. |
| `host_broadcaster_user_name` | string | The display name of the host channel. |
| `host_broadcaster_user_login` | string | The user login of the host channel. |
| `participants` | object | The list of participants in the session. |
| `broadcaster_user_id` | string | The User ID of the participant channel. |
| `broadcaster_user_name` | string | The display name of the participant channel. |
| `broadcaster_user_login` | string | The user login of the participant channel. |

### Channel Shared Chat Session End Event  {#channel-shared-chat-session-end-event}

| Name | Type | Description |
|---|---|---|
| `session_id` | string | The unique identifier for the shared chat session. |
| `broadcaster_user_id` | string | The User ID of the channel in the subscription condition which is no longer active in the shared chat session. |
| `broadcaster_user_name` | string | The display name of the channel in the subscription condition which is no longer active in the shared chat session. |
| `broadcaster_user_login` | string | The user login of the channel in the subscription condition which is no longer active in the shared chat session. |
| `host_broadcaster_user_id` | string | The User ID of the host channel. |
| `host_broadcaster_user_name` | string | The display name of the host channel. |
| `host_broadcaster_user_login` | string | The user login of the host channel. |

### Channel Subscription End Event  {#channel-subscription-end-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID for the user whose subscription ended. |
| `user_login` | string | The user login for the user whose subscription ended. |
| `user_name` | string | The user display name for the user whose subscription ended. |
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `tier` | string | The tier of the subscription that ended. Valid values are `1000`, `2000`, and `3000`. |
| `is_gift` | boolean | Whether the subscription was a gift. |

### Channel Subscription Gift Event  {#channel-subscription-gift-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID of the user who sent the subscription gift. Set to `null` if it was an anonymous subscription gift. |
| `user_login` | string | The user login of the user who sent the gift. Set to `null` if it was an anonymous subscription gift. |
| `user_name` | string | The user display name of the user who sent the gift. Set to `null` if it was an anonymous subscription gift. |
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `total` | integer | The number of subscriptions in the subscription gift. |
| `tier` | string | The tier of subscriptions in the subscription gift. |
| `cumulative_total` | integer | The number of subscriptions gifted by this user in the channel. This value is `null` for anonymous gifts or if the gifter has opted out of sharing this information. |
| `is_anonymous` | boolean | Whether the subscription gift was anonymous. |

### Channel Subscription Message Event  {#channel-subscription-message-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user ID of the user who sent a resubscription chat message. |
| `user_login` | string | The user login of the user who sent a resubscription chat message. |
| `user_name` | string | The user display name of the user who a resubscription chat message. |
| `broadcaster_user_id` | string | The broadcaster user ID. |
| `broadcaster_user_login` | string | The broadcaster login. |
| `broadcaster_user_name` | string | The broadcaster display name. |
| `tier` | string | The tier of the user’s subscription. |
| `message` | message | An object that contains the resubscription message and emote information needed to recreate the message. |
| `cumulative_months` | integer | The total number of months the user has been subscribed to the channel. |
| `streak_months` | integer | The number of consecutive months the user’s current subscription has been active. This value is `null` if the user has opted out of sharing this information. |
| `duration_months` | integer | The month duration of the subscription. |

### Channel Suspicious User Update Event  {#channel-suspicious-user-update-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the channel where the treatment for a suspicious user was updated. |
| `broadcaster_user_name` | String | The display name of the channel where the treatment for a suspicious user was updated. |
| `broadcaster_user_login` | String | The Login of the channel where the treatment for a suspicious user was updated. |
| `moderator_user_id` | String | The ID of the moderator that updated the treatment for a suspicious user. |
| `moderator_user_name` | String | The display name of the moderator that updated the treatment for a suspicious user. |
| `moderator_user_login` | String | The login of the moderator that updated the treatment for a suspicious user. |
| `user_id` | String | The ID of the suspicious user whose treatment was updated. |
| `user_name` | String | The display name of the suspicious user whose treatment was updated. |
| `user_login` | String | The login of the suspicious user whose treatment was updated. |
| `low_trust_status` | String | The status set for the suspicious user. Can be the following: “none”, “active_monitoring”, or “restricted”. |

### Channel Suspicious User Message Event  {#channel-suspicious-user-message-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | The ID of the channel where the treatment for a suspicious user was updated. |
| `broadcaster_user_name` | String | The display name of the channel where the treatment for a suspicious user was updated. |
| `broadcaster_user_login` | String | The login of the channel where the treatment for a suspicious user was updated. |
| `user_id` | String | The user ID of the user that sent the message. |
| `user_name` | String | The user name of the user that sent the message. |
| `user_login` | String | The user login of the user that sent the message. |
| `low_trust_status` | String | The status set for the suspicious user. Can be the following: “none”, “active_monitoring”, or “restricted” |
| `shared_ban_channel_ids` | []String | A list of channel IDs where the suspicious user is also banned. |
| `types` | []String | User types (if any) that apply to the suspicious user, can be “manually_added”, “ban_evader”, or “banned_in_shared_channel”. |
| `ban_evasion_evaluation` | String | A ban evasion likelihood value (if any) that as been applied to the user automatically by Twitch, can be “unknown”, “possible”, or “likely”. |
| `message` | Object | The structured chat message. |
| `message_id` | String | The UUID that identifies the message. |
| `text` | String | The chat message in plain text. |
| `fragments` | Object[] | Ordered list of chat message fragments. |
| `type` | String | The type of message fragment. Possible values: -text -cheermote -emote |
| `text` | String | Message text in fragment. |
| `cheermote` | Object | Optional. Metadata pertaining to the cheermote. |
| `prefix` | String | The name portion of the Cheermote string that you use in chat to cheer Bits. The full Cheermote string is the concatenation of {prefix} + {number of Bits}.     **For example**, if the prefix is “Cheer” and you want to cheer 100 Bits, the full Cheermote string is Cheer100. When the Cheermote string is entered in chat, Twitch converts it to the image associated with the Bits tier that was cheered. |
| `bits` | String | The amount of Bits cheered. |
| `tier` | String | The tier level of the cheermote. |
| `emote` | Object | Optional. Metadata pertaining to the emote. |
| `id` | String | An ID that uniquely identifies this emote. |
| `emote_set_id` | String | An ID that identifies the emote set that the emote belongs to. |

### Channel VIP Add Event  {#channel-vip-add-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The ID of the user who was added as a VIP. |
| `user_login` | string | The login of the user who was added as a VIP. |
| `user_name` | string | The display name of the user who was added as a VIP. |
| `broadcaster_user_id` | string | The ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The display name of the broadcaster. |

### Channel VIP Remove Event  {#channel-vip-remove-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The ID of the user who was removed as a VIP. |
| `user_login` | string | The login of the user who was removed as a VIP. |
| `user_name` | string | The display name of the user who was removed as a VIP. |
| `broadcaster_user_id` | string | The ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The display name of the broadcaster. |

### Channel Warning Acknowledge Event  {#channel-warning-acknowledge-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The user ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The user name of the broadcaster. |
| `user_id` | string | The ID of the user that has acknowledged their warning. |
| `user_login` | string | The login of the user that has acknowledged their warning. |
| `user_name` | string | The user name of the user that has acknowledged their warning. |

### Channel Warning Send Event  {#channel-warning-send-event}

| Name | Type | Description |
|---|---|---|
| `broadcaster_user_id` | string | The user ID of the broadcaster. |
| `broadcaster_user_login` | string | The login of the broadcaster. |
| `broadcaster_user_name` | string | The user name of the broadcaster. |
| `moderator_user_id` | string | The user ID of the moderator who sent the warning. |
| `moderator_user_login` | string | The login of the moderator. |
| `moderator_user_name` | string | The user name of the moderator. |
| `user_id` | string | The ID of the user being warned. |
| `user_login` | string | The login of the user being warned. |
| `user_name` | string | The user name of the user being. |
| `reason` | string | Optional. The reason given for the warning. |
| `chat_rules_cited` | []string | Optional. The chat rules cited for the warning. |

### Charity Donation Event  {#charity-donation-event}

Defines the data you receive in your event handler when users donate to the broadcaster’s charity campaign (see [channel.charity_campaign.donate](/docs/eventsub/eventsub-subscription-types#channelcharity_campaigndonate)).

| Field | Type | Description |
|---|---|---|
| `id` | String | An ID that identifies the donation. The ID is unique across campaigns. |
| `campaign_id` | String | An ID that identifies the charity campaign. |
| `broadcaster_user_id` | String | An ID that identifies the broadcaster that’s running the campaign. |
| `broadcaster_user_login` | String | The broadcaster’s login name. |
| `broadcaster_user_name` | String | The broadcaster’s display name. |
| `user_id` | String | An ID that identifies the user that donated to the campaign. |
| `user_login` | String | The user’s login name. |
| `user_name` | String | The user’s display name. |
| `charity_name` | String | The charity’s name. |
| `charity_description` | String | A description of the charity. |
| `charity_logo` | String | A URL to an image of the charity’s logo. The image’s type is PNG and its size is 100px X 100px. |
| `charity_website` | String | A URL to the charity’s website. |
| `amount` | Object | An object that contains the amount of money that the user donated. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |

### Charity Campaign Start Event  {#charity-campaign-start-event}

Defines the data you receive in your event handler when the broadcaster starts a charity campaign (see [channel.charity_campaign.start](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignstart)).

| Field | Type | Description |
|---|---|---|
| `id` | String | An ID that identifies the charity campaign. |
| `broadcaster_id` | String | An ID that identifies the broadcaster that’s running the campaign. |
| `broadcaster_login` | String | The broadcaster’s login name. |
| `broadcaster_name` | String | The broadcaster’s display name. |
| `charity_name` | String | The charity’s name. |
| `charity_description` | String | A description of the charity. |
| `charity_logo` | String | A URL to an image of the charity’s logo. The image’s type is PNG and its size is 100px X 100px. |
| `charity_website` | String | A URL to the charity’s website. |
| `current_amount` | Object | An object that contains the current amount of donations that the campaign has received. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |
| `target_amount` | Object | An object that contains the campaign’s target fundraising goal. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |
| `started_at` | String | The UTC timestamp (in RFC3339 format) of when the broadcaster started the campaign. |

### Charity Campaign Progress Event  {#charity-campaign-progress-event}

Defines the data you receive in your event handler when progress is made towards the campaign’s goal or when the broadcaster changes the fundraising goal (see [channel.charity_campaign.progress](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignprogress)).

| Field | Type | Description |
|---|---|---|
| `id` | String | An ID that identifies the charity campaign. |
| `broadcaster_id` | String | An ID that identifies the broadcaster that’s running the campaign. |
| `broadcaster_login` | String | The broadcaster’s login name. |
| `broadcaster_name` | String | The broadcaster’s display name. |
| `charity_name` | String | The charity’s name. |
| `charity_description` | String | A description of the charity. |
| `charity_logo` | String | A URL to an image of the charity’s logo. The image’s type is PNG and its size is 100px X 100px. |
| `charity_website` | String | A URL to the charity’s website. |
| `current_amount` | Object | An object that contains the current amount of donations that the campaign has received. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |
| `target_amount` | Object | An object that contains the campaign’s target fundraising goal. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |

### Charity Campaign Stop Event  {#charity-campaign-stop-event}

Defines the data you receive in your event handler when the broadcaster stops the charity campaign (see [channel.charity_campaign.stop](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignstop)).

| Field | Type | Description |
|---|---|---|
| `id` | String | An ID that identifies the charity campaign. |
| `broadcaster_id` | String | An ID that identifies the broadcaster that ran the campaign. |
| `broadcaster_login` | String | The broadcaster’s login name. |
| `broadcaster_name` | String | The broadcaster’s display name. |
| `charity_name` | String | The charity’s name. |
| `charity_description` | String | A description of the charity. |
| `charity_logo` | String | A URL to an image of the charity’s logo. The image’s type is PNG and its size is 100px X 100px. |
| `charity_website` | String | A URL to the charity’s website. |
| `current_amount` | Object | An object that contains the final amount of donations that the campaign received. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |
| `target_amount` | Object | An object that contains the campaign’s target fundraising goal. |
| `value` | Integer | The monetary amount. The amount is specified in the currency’s minor unit. For example, the minor units for USD is cents, so if the amount is $5.50 USD, `value` is set to 550. |
| `decimal_places` | Integer | The number of decimal places used by the currency. For example, USD uses two decimal places. Use this number to translate `value` from minor units to major units by using the formula:  `value / 10^decimal_places` |
| `currency` | String | The ISO-4217 three-letter currency code that identifies the type of currency in `value`. |
| `stopped_at` | String | The UTC timestamp (in RFC3339 format) of when the broadcaster stopped the campaign. |

### Conduit Shard Disabled Event  {#conduit-shard-disabled-event}

| Name | Type | Description |
|---|---|---|
| `conduit_id` | String | The ID of the conduit. |
| `shard_id` | String | The ID of the disabled shard. |
| `status` | String | The new status of the transport. |
| `transport` | Object | The disabled transport. |
| `method` | String | **websocket** or **webhook** |
| `callback` | String | Optional. Webhook callback URL. Null if `method` is set to **websocket**. |
| `session_id` | String | Optional. WebSocket session ID. Null if `method` is set to **webhook**. |
| `connected_at` | String | Optional. Time that the WebSocket session connected. Null if `method` is set to **webhook**. |
| `disconnected_at` | String | Optional. Time that the WebSocket session disconnected. Null if `method` is set to **webhook**. |

### Drop Entitlement Grant Event  {#drop-entitlement-grant-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | Individual event ID, as assigned by EventSub. Use this for de-duplicating messages. |
| `data` | array | Entitlement object. |

`data` Object

| Name | Type | Description |
|---|---|---|
| `organization_id` | string | The ID of the organization that owns the game that has Drops enabled. |
| `category_id` | string | Twitch category ID of the game that was being played when this benefit was entitled. |
| `category_name` | string | The category name. |
| `campaign_id` | string | The campaign this entitlement is associated with. |
| `user_id` | string | Twitch user ID of the user who was granted the entitlement. |
| `user_name` | string | The user display name of the user who was granted the entitlement. |
| `user_login` | string | The user login of the user who was granted the entitlement. |
| `entitlement_id` | string | Unique identifier of the entitlement. Use this to de-duplicate entitlements. |
| `benefit_id` | string | Identifier of the Benefit. |
| `created_at` | string | UTC timestamp in ISO format when this entitlement was granted on Twitch. |

### Extension Bits Transaction Create Event  {#extension-bits-transaction-create-event}

| Name | Type | Description |
|---|---|---|
| `extension_client_id` | string | Client ID of the extension. |
| `id` | string | Transaction ID. |
| `broadcaster_user_id` | string | The transaction’s broadcaster ID. |
| `broadcaster_user_login` | string | The transaction’s broadcaster login. |
| `broadcaster_user_name` | string | The transaction’s broadcaster display name. |
| `user_id` | string | The transaction’s user ID. |
| `user_login` | string | The transaction’s user login. |
| `user_name` | string | The transaction’s user display name. |
| `product` | product | Additional extension product information. |

### Goals Event  {#goals-event}

Defines the event payload for a Goals event.

| Name | Type | Description |
|---|---|---|
| `id` | string | An ID that identifies this event. |
| `broadcaster_user_id` | string | An ID that uniquely identifies the broadcaster. |
| `broadcaster_user_name` | string | The broadcaster’s display name. |
| `broadcaster_user_login` | string | The broadcaster’s user handle. |
| `type` | string | The type of goal. Possible values are:   - follow — The goal is to increase followers. - subscription — The goal is to increase subscriptions. This type shows the net increase or decrease in tier points associated with the subscriptions. - subscription_count — The goal is to increase subscriptions. This type shows the net increase or decrease in the number of subscriptions. - new_subscription — The goal is to increase subscriptions. This type shows only the net increase in tier points associated with the subscriptions (it does not account for users that unsubscribed since the goal started). - new_subscription_count — The goal is to increase subscriptions. This type shows only the net increase in the number of subscriptions (it does not account for users that unsubscribed since the goal started). - new_bit — The goal is to increase the amount of Bits used on the channel. - new_cheerer — The goal is to increase the number of unique Cheerers to Cheer on the channel. |
| `description` | string | A description of the goal, if specified. The description may contain a maximum of 40 characters. |
| `is_achieved` | Boolean | A Boolean value that indicates whether the broadcaster achieved their goal. Is **true** if the goal was achieved; otherwise, **false**.  Only the **channel.goal.end** event includes this field. |
| `current_amount` | integer | The goal’s current value.  The goal’s `type` determines how this value is increased or decreased.  - If `type` is follow, this field is set to the broadcaster's current number of followers. This number increases with new followers and decreases when users unfollow the broadcaster. - If `type` is subscription, this field is increased and decreased by the points value associated with the subscription tier. For example, if a tier-two subscription is worth 2 points, this field is increased or decreased by 2, not 1. - If `type` is subscription_count, this field is increased by 1 for each new subscription and decreased by 1 for each user that unsubscribes. - If `type` is new_subscription, this field is increased by the points value associated with the subscription tier. For example, if a tier-two subscription is worth 2 points, this field is increased by 2, not 1. - If `type` is new_subscription_count, this field is increased by 1 for each new subscription. |
| `target_amount` | integer | The goal’s target value. For example, if the broadcaster has 200 followers before creating the goal, and their goal is to double that number, this field is set to 400. |
| `started_at` | string | The UTC timestamp in [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339) format, which indicates when the broadcaster created the goal. |
| `ended_at` | string | The UTC timestamp in [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339) format, which indicates when the broadcaster ended the goal.  Only the **channel.goal.end** event includes this field. |

### Hype Train Begin Event  {#hype-train-begin-event}

| Param | Type | Description |
|---|---|---|
| `id` | string | The Hype Train ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `total` | integer | Total points contributed to the Hype Train. |
| `progress` | integer | The number of points contributed to the Hype Train at the current level. |
| `goal` | integer | The number of points required to reach the next level. |
| `top_contributions` | top_contributions | The contributors with the most points contributed. |
| `user_id` | string | The ID of the user that made the contribution. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `type` | string | The contribution method used. Possible values are:   - **bits** - Bits contributions with Cheering and Power-ups. - **subscription** - Subscription activity like subscribing or gifting subscriptions. - **other** - Covers other contribution methods not listed. |
| `total` | integer | The total amount contributed. If type is bits, total represents the amount of Bits used. If type is subscription, total is 500, 1000, or 2500 to represent tier 1, 2, or 3 subscriptions, respectively. |
| `level` | integer | The current level of the Hype Train. |
| `all_time_high_level` | integer | The all-time high level this type of Hype Train has reached for this broadcaster. |
| `all_time_high_total` | integer | The all-time high total this type of Hype Train has reached for this broadcaster. |
| `shared_train_participants` | object[] | Optional. Non-null for a shared Hype Train. Contains the list of broadcasters in the shared Hype Train. |
| `broadcaster_user_id` | string | The ID of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_login` | string | The login of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_name` | string | The display name of the broadcaster participating in the shared Hype Train. |
| `started_at` | string | The time when the Hype Train started. |
| `expires_at` | string | The time when the Hype Train expires. The expiration is extended when the Hype Train reaches a new level. |
| `type` | string | The type of the Hype Train. Possible values are:   - treasure - golden_kappa - regular |
| `is_shared_train` | boolean | Indicates if the Hype Train is shared. When true, `shared_train_participants` will contain the list of broadcasters the train is shared with. |

### Hype Train Progress Event  {#hype-train-progress-event}

| Param | Type | Description |
|---|---|---|
| `id` | string | The Hype Train ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `total` | integer | Total points contributed to the Hype Train. |
| `progress` | integer | The number of points contributed to the Hype Train at the current level. |
| `goal` | integer | The number of points required to reach the next level. |
| `top_contributions` | top_contributions | The contributors with the most points contributed. |
| `user_id` | string | The ID of the user that made the contribution. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `type` | string | The contribution method used. Possible values are:   - **bits** - Bits contributions with Cheering, Power-ups, and Extensions. - **subscription** - Subscription activity like subscribing or gifting subscriptions. - **other** - Covers other contribution methods not listed. |
| `total` | integer | The total amount contributed. If type is bits, total represents the amount of Bits used. If type is subscription, total is 500, 1000, or 2500 to represent tier 1, 2, or 3 subscriptions, respectively. |
| `level` | integer | The current level of the Hype Train. |
| `shared_train_participants` | object[] | Optional. Non-null for a shared Hype Train. Contains the list of broadcasters in the shared Hype Train. |
| `broadcaster_user_id` | string | The ID of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_login` | string | The login of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_name` | string | The display name of the broadcaster participating in the shared Hype Train. |
| `started_at` | string | The time when the Hype Train started. |
| `expires_at` | string | The time when the Hype Train expires. The expiration is extended when the Hype Train reaches a new level. |
| `type` | string | The type of the Hype Train. Possible values are:   - treasure - golden_kappa - regular |
| `is_shared_train` | boolean | Indicates if the Hype Train is shared. When true, `shared_train_participants` will contain the list of broadcasters the train is shared with. |

### Hype Train End Event  {#hype-train-end-event}

| Param | Type | Description |
|---|---|---|
| `id` | string | The Hype Train ID. |
| `broadcaster_user_id` | string | The requested broadcaster ID. |
| `broadcaster_user_login` | string | The requested broadcaster login. |
| `broadcaster_user_name` | string | The requested broadcaster display name. |
| `total` | integer | Total points contributed to the Hype Train. |
| `top_contributions` | object[] | The contributors with the most points contributed. |
| `user_id` | string | The ID of the user that made the contribution. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `type` | string | The contribution method used. Possible values are:   - **bits** - Bits contributions with Cheering, Power-ups, and Extensions. - **subscription** - Subscription activity like subscribing or gifting subscriptions. - **other** - Covers other contribution methods not listed. |
| `total` | integer | The total amount contributed. If type is bits, total represents the amount of Bits used. If type is subscription, total is 500, 1000, or 2500 to represent tier 1, 2, or 3 subscriptions, respectively. |
| `level` | integer | The current level of the Hype Train. |
| `shared_train_participants` | object[] | Optional. Non-null for a shared Hype Train. Contains the list of broadcasters in the shared Hype Train. |
| `broadcaster_user_id` | string | The ID of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_login` | string | The login of the broadcaster participating in the shared Hype Train. |
| `broadcaster_user_name` | string | The display name of the broadcaster participating in the shared Hype Train. |
| `started_at` | string | The time when the Hype Train started. |
| `cooldown_ends_at` | string | The time when the Hype Train cooldown ends so that the next Hype Train can start. |
| `ended_at` | string | The time when the Hype Train ended. |
| `type` | string | The type of the Hype Train. Possible values are:   - treasure - golden_kappa - regular |
| `is_shared_train` | boolean | Indicates if the Hype Train is shared. When true, `shared_train_participants` will contain the list of broadcasters the train is shared with. |

### Stream Online Event  {#stream-online-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The id of the stream. |
| `broadcaster_user_id` | string | The broadcaster’s user id. |
| `broadcaster_user_login` | string | The broadcaster’s user login. |
| `broadcaster_user_name` | string | The broadcaster’s user display name. |
| `type` | string | The stream type. Valid values are: `live`, `playlist`, `watch_party`, `premiere`, `rerun`. |
| `started_at` | string | The timestamp at which the stream went online at. |

### Stream Offline Event  {#stream-offline-event}

| Name | Type | Description |
|---|---|---|
| `id` | string | The id of the stream. |
| `broadcaster_user_id` | string | The broadcaster’s user id. |
| `broadcaster_user_login` | string | The broadcaster’s user login. |
| `broadcaster_user_name` | string | The broadcaster’s user display name. |

### User Authorization Grant Event  {#user-authorization-grant-event}

| Name | Type | Description |
|---|---|---|
| `client_id` | string | The client_id of the application that was granted user access. |
| `user_id` | string | The user id for the user who has granted authorization for your client id. |
| `user_login` | string | The user login for the user who has granted authorization for your client id. |
| `user_name` | string | The user display name for the user who has granted authorization for your client id. |

### User Authorization Revoke Event  {#user-authorization-revoke-event}

| Name | Type | Description |
|---|---|---|
| `client_id` | string | The client_id of the application with revoked user access. |
| `user_id` | string | The user id for the user who has revoked authorization for your client id. |
| `user_login` | string | The user login for the user who has revoked authorization for your client id. This is `null` if the user no longer exists. |
| `user_name` | string | The user display name for the user who has revoked authorization for your client id. This is `null` if the user no longer exists. |

### User Update Event  {#user-update-event}

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The user’s user id. |
| `user_login` | string | The user’s user login. |
| `user_name` | string | The user’s user display name. |
| `email` | string | The user’s email address. The event includes the user’s email address only if the app used to request this event type includes the `user:read:email` scope for the user; otherwise, the field is set to an empty string. See [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription). |
| `email_verified` | boolean | A Boolean value that determines whether Twitch has verified the user’s email address. Is **true** if Twitch has verified the email address; otherwise, false.  NOTE: Ignore this field if the `email` field contains an empty string. |
| `description` | string | The user’s description. |

### Whisper Received Event  {#whisper-received-event}

| Name | Type | Description |
|---|---|---|
| `from_user_id` | String | The ID of the user sending the message. |
| `from_user_name` | String | The name of the user sending the message. |
| `from_user_login` | String | The login of the user sending the message. |
| `to_user_id` | String | The ID of the user receiving the message. |
| `to_user_name` | String | The name of the user receiving the message. |
| `to_user_login` | String | The login of the user receiving the message. |
| `whisper_id` | String | The whisper ID. |
| `whisper` | Object | Object containing whisper information. |
| `text` | String | The body of the whisper message. |

## Global Cooldown  {#global-cooldown}

| Name | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Is the setting enabled. |
| `seconds` | integer | The cooldown in seconds. |

## Image  {#image}

| Name | Type | Description |
|---|---|---|
| `url_1x` | string | URL for the image at 1x size. |
| `url_2x` | string | URL for the image at 2x size. |
| `url_4x` | string | URL for the image at 4x size. |

## Last Contribution  {#last-contribution}

The most recent contribution towards the Hype Train’s goal.

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The ID of the user that made the contribution. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `type` | string | The contribution method used. Possible values are:   - `bits` — Cheering with Bits. - `subscription` — Subscription activity like subscribing or gifting subscriptions. - `other` — Covers other contribution methods not listed. |
| `total` | int | The total amount contributed. If `type` is `bits`, `total` represents the amount of Bits used. If `type` is `subscription`, `total` is 500, 1000, or 2500 to represent tier 1, 2, or 3 subscriptions, respectively. |

## Max Per Stream  {#max-per-stream}

| Name | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Is the setting enabled. |
| `value` | integer | The max per stream limit. |

## Max Per User Per Stream  {#max-per-user-per-stream}

| Name | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Is the setting enabled. |
| `value` | integer | The max per user per stream limit. |

## Message  {#message}

| Name | Type | Description |
|---|---|---|
| `text` | string | The text of the resubscription chat message. |
| `emotes` | emotes | An array that includes the emote ID and start and end positions for where the emote appears in the text. |

## Outcomes  {#outcomes}

An array of the outcomes for a particular Channel Points Prediction. Each Prediction’s event payload includes an outcomes array. The outcomes array contains an object that describes each outcome and, if applicable, the number of users who selected that outcome, the number of Channel Points for that outcome, and an array of top_predictors.

| Name | Type | Description |
|---|---|---|
| `id` | string | The outcome ID. |
| `title` | string | The outcome title. |
| `color` | string | The color for the outcome. Valid values are `pink` and `blue`. |
| `users` | integer | The number of users who used Channel Points on this outcome. |
| `channel_points` | int | The total number of Channel Points used on this outcome. |
| `top_predictors` | top_predictors | An array of users who used the most Channel Points on this outcome. |

## Product  {#product}

Additional information about a product acquired via a Twitch Extension Bits transaction.

| Name | Type | Description |
|---|---|---|
| `name` | string | Product name. |
| `bits` | integer | Bits involved in the transaction. |
| `sku` | string | Unique identifier for the product acquired. |
| `in_development` | boolean | Flag indicating if the product is in development. If `in_development` is true, `bits` will be 0. |

## Reward  {#reward}

| Name | Type | Description |
|---|---|---|
| `id` | string | The reward identifier. |
| `title` | string | The reward name. |
| `cost` | integer | The reward cost. |
| `prompt` | string | The reward description. |

## Shield Mode  {#shield-mode}

Defines the Shield Mode data that you receive when the [channel.shield_mode.begin](/docs/eventsub/eventsub-subscription-types#channelshield_modebegin) and [channel.shield_mode.end](/docs/eventsub/eventsub-subscription-types#channelshield_modeend) events occur.

| Field | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | An ID that identifies the broadcaster whose Shield Mode status was updated. |
| `broadcaster_user_login` | String | The broadcaster’s login name. |
| `broadcaster_user_name` | String | The broadcaster’s display name. |
| `moderator_user_id` | String | An ID that identifies the moderator that updated the Shield Mode’s status. If the broadcaster updated the status, this ID will be the same as `broadcaster_user_id`. |
| `moderator_user_login` | String | The moderator’s login name. |
| `moderator_user_name` | String | The moderator’s display name. |
| `started_at` | String | The UTC timestamp (in RFC3339 format) of when the moderator activated Shield Mode. The object includes this field only for **channel.shield_mode.begin** events. |
| `ended_at` | String | The UTC timestamp (in RFC3339 format) of when the moderator deactivated Shield Mode. The object includes this field only for **channel.shield_mode.end** events. |

## Shoutout Create  {#shoutout-create}

Defines the Shoutout data that you receive when the [channel.shoutout.create](/docs/eventsub/eventsub-subscription-types#channelshoutoutcreate) event occurs.

| Field | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | An ID that identifies the broadcaster that sent the Shoutout. |
| `broadcaster_user_login` | String | The broadcaster’s login name. |
| `broadcaster_user_name` | String | The broadcaster’s display name. |
| `to_broadcaster_user_id` | String | An ID that identifies the broadcaster that received the Shoutout. |
| `to_broadcaster_user_login` | String | The broadcaster’s login name. |
| `to_broadcaster_user_name` | String | The broadcaster’s display name. |
| `moderator_user_id` | String | An ID that identifies the moderator that sent the Shoutout. If the broadcaster sent the Shoutout, this ID is the same as the ID in `broadcaster_user_id`. |
| `moderator_user_login` | String | The moderator’s login name. |
| `moderator_user_name` | String | The moderator’s display name. |
| `viewer_count` | Integer | The number of users that were watching the broadcaster’s stream at the time of the Shoutout. |
| `started_at` | String | The UTC timestamp (in RFC3339 format) of when the moderator sent the Shoutout. |
| `cooldown_ends_at` | String | The UTC timestamp (in RFC3339 format) of when the broadcaster may send a Shoutout to a different broadcaster. |
| `target_cooldown_ends_at` | String | The UTC timestamp (in RFC3339 format) of when the broadcaster may send another Shoutout to the broadcaster in `to_broadcaster_user_id`. |

## Shoutout Received  {#shoutout-received}

Defines the Shoutout data that you receive when the [channel.shoutout.receive](/docs/eventsub/eventsub-subscription-types#channelshoutoutreceive) event occurs.

| Field | Type | Description |
|---|---|---|
| `broadcaster_user_id` | String | An ID that identifies the broadcaster that received the Shoutout. |
| `broadcaster_user_login` | String | The broadcaster’s login name. |
| `broadcaster_user_name` | String | The broadcaster’s display name. |
| `from_broadcaster_user_id` | String | An ID that identifies the broadcaster that sent the Shoutout. |
| `from_broadcaster_user_login` | String | The broadcaster’s login name. |
| `from_broadcaster_user_name` | String | The broadcaster’s display name. |
| `viewer_count` | Integer | The number of users that were watching the from-broadcaster’s stream at the time of the Shoutout. |
| `started_at` | String | The UTC timestamp (in RFC3339 format) of when the moderator sent the Shoutout. |

## Subscription  {#subscription}

| Name | Type | Description |
|---|---|---|
| `id` | string | The Subscription ID of the Subscription |
| `type` | string | The notification’s subscription type. |
| `version` | string | The version of the subscription. |
| `status` | string | The status of the subscription. |
| `cost` | integer | How much the subscription counts against your limit. See [Subscription Limits](/docs/eventsub/manage-subscriptions#subscription-limits) for more information. |
| `condition` | condition | Subscription-specific parameters. |
| `created_at` | string | The time the notification was created. |

## Top Contributions  {#top-contributions}

The top contributor for a contribution type. For example, the top contributor using BITS (by aggregate) or the top contributor using subscriptions (by count).

| Field | Type | Description |
|---|---|---|
| `user_id` | string | The ID of the user that made the contribution. |
| `user_login` | string | The user’s login name. |
| `user_name` | string | The user’s display name. |
| `type` | string | The contribution method used. Possible values are:   - `bits` — Cheering with Bits. - `subscription` — Subscription activity like subscribing or gifting subscriptions. - `other` — Covers other contribution methods not listed. |
| `total` | int | The total amount contributed. If `type` is `bits`, `total` represents the amount of Bits used. If `type` is `subscription`, `total` is 500, 1000, or 2500 to represent tier 1, 2, or 3 subscriptions, respectively. |

## Top Predictors  {#top-predictors}

An array of up to 10 objects that describe users who participated in a Channel Points Prediction.

| Name | Type | Description |
|---|---|---|
| `user_id` | string | The ID of the user. |
| `user_login` | string | The login of the user. |
| `user_name` | string | The display name of the user. |
| `channel_points_won` | integer | The number of Channel Points won. This value is always `null` in the event payload for Prediction progress and Prediction lock. This value is 0 if the outcome did not win or if the Prediction was canceled and Channel Points were refunded. |
| `channel_points_used` | integer | The number of Channel Points used to participate in the Prediction. |

## Transport  {#transport}

Defines the transport details that you want Twitch to use when sending you event notifications.

| Field | Type | Required? | Description |
|---|---|---|---|
| `method` | string | yes | The transport method. Possible values are:   - webhook - websocket |
| `callback` | string | no | The callback URL where the notifications are sent. The URL must use the HTTPS protocol and port 443. See [Processing an event](/docs/eventsub/handling-webhook-events#processing-an-event).  Specify this field only if `method` is set to **webhook**.  **NOTE**: Redirects are not followed. |
| `secret` | string | no | The secret used to verify the signature. The secret must be an ASCII string that’s a minimum of 10 characters long and a maximum of 100 characters long. For information about how the secret is used, see [Verifying the event message](/docs/eventsub/handling-webhook-events#verifying-the-event-message).  Specify this field only if `method` is set to **webhook**. |
| `session_id` | string | no | An ID that identifies the WebSocket to send notifications to. When you connect to EventSub using WebSockets, the server returns the ID in the [Welcome message](/docs/eventsub/handling-websocket-events#welcome-message).  Specify this field only if `method` is set to **websocket**. |
| `connected_at` | string | no | The UTC date and time that the WebSocket connection was established.  This is a response-only field that [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription) and [Get EventSub Subscription](/docs/api/reference#get-eventsub-subscriptions) returns if the `method` field is set to **websocket**. |
| `disconnected_at` | string | no | The UTC date and time that the WebSocket connection was lost.  This is a response-only field that [Get EventSub Subscription](/docs/api/reference#get-eventsub-subscriptions) returns if the `method` field is set to **websocket**. |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
