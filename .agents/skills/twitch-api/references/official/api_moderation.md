<!-- source: https://dev.twitch.tv/docs/api/moderation/ -->

Contents

# Moderating Twitch Chatrooms  {#moderating-twitch-chatrooms}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

Moderation is a key aspect of having a chat on Twitch. By default, the Broadcaster can run all moderation commands, but Twitch created the Moderator role to assist with this task.
 [Read more](https://www.twitch.tv/creatorcamp/en/paths/going-live/moderation-and-safety/) about Moderation on Twitch.

## Managing the broadcaster’s moderators  {#managing-the-broadcasters-moderators}

For a busy broadcaster, appointing moderators to their chat room is key to having a safe, welcoming, and fun place for viewers to hang out.

This section covers the following:

- Adding Moderators
- Getting a list of the broadcaster’s moderators
- Getting a list of channels you can moderate

### Adding moderators  {#adding-moderators}

To add a moderator to the broadcaster’s chat room, use the [Add Moderator](/docs/api/reference#add-channel-moderator) endpoint. There is no limit to the number of moderators that a broadcaster may add to their chat room.

The request must include:

- A User Access Token that includes the **channel:manage:moderators** scope.
- The broadcaster_id query parameter, which is the User ID of the broadcaster of the channel. This ID must match the User ID in the User Access Token.
- The user_id query parameter that’s set to the User ID of the user to make a moderator. The user that you’re adding can’t already be a moderator in the broadcaster’s chat room, can’t be a VIP, and can’t be banned from the chat room.

he following example shows adding a moderator.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=1234&user_id=5678' \
-H 'Authorization: Bearer kpvy3cjboyptmdkiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6fnys0nyan9c87zr6t'

```

If the request succeeds, the response is an HTTP 204 No Content status code.

### Removing moderators  {#removing-moderators}

To remove a moderator from the broadcaster’s chat room, use the [Remove Moderator](/docs/api/reference#remove-channel-moderator) endpoint.

- A User Access Token that includes the **channel:manage:moderators** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that’s removing the moderator. This ID must match the User ID in the User Access Token.
- The user_id query parameter that’s set to the User ID of the user to remove as a moderator.

```
curl -X DELETE 'https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=1234&user_id=5678' \
-H 'Authorization: Bearer jphlwj2k1wm09hwjmoidml1cs0bt' \
-H 'Client-Id: hof5gwx0su6fnys0nyan9c87zr6t'

```

If the request succeeds, the response is an HTTP 204 No Content status code.

### Getting a list of the broadcaster’s moderators  {#getting-a-list-of-the-broadcasters-moderators}

To get a list of the broadcaster’s moderators, use the [Get Moderators](/docs/api/reference#get-moderators) endpoint.

The request must include:

- A User Access Token that includes the **moderation:read** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster whose list of moderators you want to get. This ID must match the user ID in the User Access Token.

The following example shows getting the broadcaster’s list of moderators.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=1234' \
-H 'Authorization: Bearer jphlwj2k1wm09hwjmoidml1cs0bt' \
-H 'Client-Id: hof5gwx0su6fnys0nyan9c87zr6t'

```

The following example shows the response if the broadcaster has moderators.

```
{
  "data": [
    {
      "user_id": "5678",
      "user_login": "fun2bfun",
      "user_name": "Fun2bFun"
    },
    . . .
  ],
  "pagination": {}
}

```

The request includes an optional user_id query parameter that you can use to check if the user is a moderator in the broadcaster’s chat room. You may specify a maximum of 100 IDs. To specify multiple IDs, repeat the id parameter for each user you want to check. For example, `user_id=123&user_id=456&user_id=789`.
 **Note:** The API will ignore duplicate and invalid IDs.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=1234&user_id=5678' \
-H 'Authorization: Bearer jphlwj2k1wm09hwjmoidml1cs0bt' \
-H 'Client-Id: hof5gwx0su6fnys0nyan9c87zr6t'

```

If the user is a moderator, the response contains the user’s name (see the example above). If you specify multiple IDs, they’re returned in the same order that you specified them. If none of the specified users are moderators, the response contains an empty `data` array:

```
{
  "data": [],
  "pagination": {}
}

```

### Getting a list of channels you can moderate  {#getting-a-list-of-channels-you-can-moderate}

To see what channels you are a moderator in, use the [Get Moderated Channels](/docs/api/reference/#get-moderated-channels) endpoint.

The request must include:

- A User Access Token that includes the **user:read:moderated_channels** scope.
- The user_id query parameter that’s set to the User ID in the User Access Token.

The following example shows pulling the list of channels you your user account has moderator privileges in:

```
curl -X GET 'https://api.twitch.tv/helix/moderation/channels?user_id=931931' \
-H 'Authorization: Bearer cfabdegwdoklmawdzdo98xt2fo512y' \
-H 'Client-Id: uo6dggojyb8d6soh92zknwmi5ej1q2'

```

The following example shows the response if your user is a moderator in some channels:

```
{
  "data": [
    {
      "broadcaster_id" : "12345",
      "broadcaster_login" : "grateful_broadcaster",
      "broadcaster_name" : "Grateful_Broadcaster"
    },
    {
      "broadcaster_id" : "98765",
      "broadcaster_login" : "bashfulgamer",
      "broadcaster_name" : "BashfulGamer"
    },
  ],
  "pagination": {}
}

```

## Managing a broadcaster’s AutoMod settings  {#managing-a-broadcasters-automod-settings}

Twitch provides everyone an automatic moderation tool called [AutoMod](https://help.twitch.tv/s/article/how-to-use-automod), an automated method of catching potentially risky messages in chat so they can be reviewed by a channel moderator before appearing to the public. AutoMod will withhold messages from chat that may violate the broadcaster’s AutoMod settings. Moderations will then be able to approve or deny the held messages before they appear in chat.

Twitch also provides API access to modify your channel’s AutoMod rules and settings, test those rules and settings, and automate the handling of messages caught by AutoMod.

This section covers the following:

- Getting the broadcaster’s AutoMod settings
- Updating the broadcaster’s AutoMod settings
- Testing messages based on AutoMod settings

### Getting the broadcaster’s AutoMod settings  {#getting-the-broadcasters-automod-settings}

To get the broadcaster’s AutoMod settings, use the [Get AutoMod Settings](/docs/api/reference#get-automod-settings) endpoint.

The request must include:

- A User Access Token that includes the **moderator:read:automod_settings** scope, or you can use the **moderator:manage:automod_settings** scope if you’re also editing the settings.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster whose AutoMod settings you’re getting.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/automod/settings?broadcaster_id=12345&moderator_id=98765' \
-H 'Authorization: Bearer t72crrycenqmqrltqxtymgoy888v' \
-H 'Client-Id: hof5gwx0suwfnys0nyan9c87zr6t'

```

There are five levels of filtering: 0 (no filtering) through 4 (strongest filtering). The following example shows what the response would look like if the broadcaster requested the strongest level of filtering, 4.

```
{
  "data": [
    {
      "broadcaster_id": "12345",
      "moderator_id": "98765",
      "overall_level": 4,
      "disability": 4,
      "aggression": 4,
      "sexuality_sex_or_gender": 4,
      "misogyny": 4,
      "bullying": 4,
      "swearing": 4,
      "race_ethnicity_or_religion": 4,
      "sex_based_terms": 4
    }
  ]
}

```

In the above example, the broadcaster selected level 4 filtering, which applied the same level of filtering to all settings. But that isn’t the case for all levels. In the following example, the broadcaster selected level 2 filtering, but the bullying setting is set to 1 and the swearing setting is set to 0.

```
{
  "data": [
    {
      "broadcaster_id": "12345",
      "moderator_id": "98765",
      "overall_level": 2,
      "disability": 2,
      "aggression": 2,
      "sexuality_sex_or_gender": 2,
      "misogyny": 2,
      "bullying": 1,
      "swearing": 0,
      "race_ethnicity_or_religion": 2,
      "sex_based_terms": 2
    }
  ]
}

```

The `overall_level` field indicates whether the user selected one of five preset filter levels or chose custom filter levels. If the broadcaster chose custom filter levels for some of the filter settings, the `overall_level` field is set to **null**.

```
{
  "data": [
    {
      "broadcaster_id": "12345",
      "moderator_id": "98765",
      "overall_level": null,
      "disability": 3,
      "aggression": 4,
      "sexuality_sex_or_gender": 3,
      "misogyny": 3,
      "bullying": 4,
      "swearing": 1,
      "race_ethnicity_or_religion": 3,
      "sex_based_terms": 2
    }
  ]
}

```

### Updating the broadcaster’s AutoMod settings  {#updating-the-broadcasters-automod-settings}

To update the broadcaster’s AutoMod settings, use the [Update AutoMod Settings](/docs/api/reference#update-automod-settings) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:automod_settings** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster whose AutoMod settings you’re updating.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the User ID in the User Access Token.

The following example shows updating the broadcaster’s AutoMod settings to one of the preset filter levels.

```
curl -X PUT 'https://api.twitch.tv/helix/moderation/automod/settings?broadcaster_id=12345&moderator_id=98765' \
-H 'Authorization: Bearer t72crrycenqmqrltqxtymgoy888v' \
-H 'Client-Id: hof5gwx0suwfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"overall_level":3}'

```

The following example shows the response to the previous request.

```
{
  "data": [
    {
      "broadcaster_id": "12345",
      "moderator_id": "98765",
      "overall_level": 3,
      "disability": 3,
      "aggression": 3,
      "sexuality_sex_or_gender": 3,
      "misogyny": 3,
      "bullying": 2,
      "swearing": 0,
      "race_ethnicity_or_religion": 3,
      "sex_based_terms": 3
    }
  ]
}

```

Because the API uses the PUT method, you can choose to update only individual rules in the ruleset. However, if you set the `overall_level`, all rulesets will be set to match the chosen value.

Whenever the AutoMod settings change, whether it be manually in the Creator Dashboard or via the previous API call, Twitch can alert you of the changes through EventSub. This is done through the [Automod Settings Update](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#automodsettingsupdate) and [Automod Terms Update](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#automodtermsupdate) event subscriptions.

The following example subscribes to the AutoMod Settings Update EventSub subscription type. To subscribe to AutoMod Terms Update, change `automod.settings.update` to `automod.terms.update`:

```
curl -X POST 'https://api.twitch.tv/helix/eventsub/subscriptions' \
-H 'Authorization: Bearer t72crrycenqmqrltqxtymgoy888v' \
-H 'Client-Id: hof5gwx0suwfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{
  "type": "automod.settings.update",
  "version": "1",
  "condition": {
    "broadcaster_user_id": "12345",
    "moderator_user_id": "98765",
  },
  "transport": {
    "method": "webhook",
    "callback": "https://this-is-a-callback.com",
    "secret":"s3cre7"
  }
}'

```

The following example shows what the payload will look like when the broadcaster’s AutoMod terms change:

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

### Testing messages based on AutoMod settings  {#testing-messages-based-on-automod-settings}

If you want to test whether AutoMod would flag a message based on the broadcaster’s AutoMod settings, use the [Check AutoMod Status](/docs/api/reference#check-automod-status) endpoint. This endpoint also tests whether the channel’s blocked terms would prevent the message from being posted to chat.

The request must include:

- A User Access Token that includes the **moderation:read** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster whose AutoMod setting you want to test messages against. This ID must match the User ID in the User Access Token.
- A body with the following fields:

- The `data` field that’s set to an array of objects, each containing the following fields:

- The `msg-id` field that’s set to a caller-defined ID.
- The `msg-text` field that’s set to the message to test.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/enforcements/status?broadcaster_id=123456' \
-H 'Authorization: Bearer 42es0ohz1smtdrtsaq20g46oks31' \
-H 'Client-Id: hof5gwx0su6owys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"data":[{"msg_id":"1","msg_text":"i hate you!"},{"msg_id":"2","msg_text":"butterflies and unicorns"}]}

```

The following response shows that AutoMod would flag the first message but not the second message.

```
{
  "data": [
    {
      "msg_id": "1",
      "is_permitted": false
    },
    {
      "msg_id": "2",
      "is_permitted": true
    }
  ]
}

```

**Note:** Messages in the response are not guaranteed to be in the same order as the request.

## Blocking words or phrases from chat  {#blocking-words-or-phrases-from-chat}

While Twitch’s AutoMod automatically detects and blocks some common words and phrases, broadcasters have the option to block specific words and phrases on their own.

This section covers the following:

- Adding blocked terms
- Removing a term from the broadcaster’s list of blocked terms
- Getting a broadcaster’s list of blocked terms

### Adding blocked terms  {#adding-blocked-terms}

To block a word or phrase (term), use the [Add Blocked Term](/docs/api/reference#add-blocked-term) endpoint. This endpoint adds the term to the broadcaster’s list of public blocked terms only. Broadcasters must use the Twitch UX to add terms to their private list of blocked terms (see **Blocked Terms and Phrases** under **Creator Dashboard**, **Settings**, **Moderation**).

The request must include:

- A User Access Token that includes the **moderator:manage:blocked_terms** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the User ID in the User Access Token.
- A body with the following field:

- The `text` field that’s set to the term to block.

Terms must contain a minimum of 2 characters and may contain up to a maximum of 500 characters. Chat blocks messages that contain all words in the term. The words don’t have to appear in the same order. For example, adding the term, hi there doesn’t block messages containing only hi or there, but it does block hi there and there hi. Comparisons are case insensitive.

Terms may use a wildcard character (*) to block variations of a term. For example, adding the word shoot* also blocks shooting, shoots, and other variations. The wildcard must appear only at the beginning or end of the term.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer tmlk2xqxg8ofx8nage9gbwpexyyr' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"text":"because i said so"}'

```

The following example shows the response to the previous request. If the term already exists, the response contains the existing blocked term and ID.

```
{
  "data": [
    {
      "broadcaster_id": "1234",
      "moderator_id": "5678",
      "id": "4a00cffa-ec5c-4c13-93c1-8c3fa5ae8ccc",
      "text": "because i said so",
      "created_at": "2022-08-04T21:28:28Z",
      "updated_at": "2022-08-04T21:28:28Z",
      "expires_at": null
    }
  ]
}

```

Whenever a Blocked Term is added, whether it be manually in the Creator Dashboard or via the previous API call, Twitch can alert you of the changes through EventSub. This is done through the [Channel Moderate](/docs/eventsub/eventsub-subscription-types/#channelmoderate) EventSub subscription, where the `action` will be set to `add_blocked_term`.

An example of the payload for the Channel Moderate event when adding a blocked term:

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
    "broadcaster_user_name": "blah",
    "broadcaster_user_login": "blahblah",
    "moderator_user_id": "9001",
    "moderator_user_login": "the_mod",
    "moderator_user_name": "The_Mod",
    "action": "add_blocked_term",
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
    "automod_terms": {
      "action": "add",
      "list": "blocked",
      "terms": [
        "because i said so"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}

```

### Removing a term from the broadcaster’s list of blocked terms  {#removing-a-term-from-the-broadcasters-list-of-blocked-terms}

To remove terms from the broadcaster’s list of public blocked terms, use the [Remove Blocked Term](/docs/api/reference#remove-blocked-term) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:blocked_terms** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- The id query parameter that’s set to the ID of the blocked term to delete. You can get this ID from when you added the term or retrieved the broadcaster’s list of terms.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=1234&moderator_id=5678&id=4a00cffa-ec5c-4c13-93c1-8c3fa5ae8ccc' \
-H 'Authorization: Bearer tmlk2xqxc8ofx8nage9gbwpexyyr' \
-H 'Client-Id: hof5gwx0su6owfn0nyan9c87zr6t'

```

If successful, the response is an HTTP 204 No Content status code.

Similar to adding a blocked term, when you remove a blocked term Twitch will also notify you over EventSub using the [Channel Moderate](/docs/eventsub/eventsub-subscription-types/#channelmoderate) EventSub subscription, with the `action` field set to `remove_blocked_term`.

An example of the payload for the Channel Moderate event when removing a blocked term:

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
    "broadcaster_user_name": "blah",
    "broadcaster_user_login": "blahblah",
    "moderator_user_id": "9001",
    "moderator_user_login": "the_mod",
    "moderator_user_name": "The_Mod",
    "action": "remove_blocked_term",
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
    "automod_terms": {
      "action": "remove",
      "list": "blocked",
      "terms": [
        "because i said so"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}

```

### Getting a broadcaster’s list of blocked terms  {#getting-a-broadcasters-list-of-blocked-terms}

To get a list of blocked terms, use the [Get Blocked Terms](/docs/api/reference#get-blocked-terms) endpoint. The list contains the broadcaster’s public list of blocked terms.

The request must include:

- A User Access Token that includes the **moderator:read:blocked_terms** scope, or you can use the **moderator:manage:blocked_terms** scope if you’re also adding or removing blocked terms.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer tmlk2xqxc8ofx8nage9gbwpexyyr' \
-H 'Client-Id: hof5gwx0su6owfn0nyan9c87zr6t'

```

The following example shows what the response looks like. One of the broadcaster’s moderators added the first term and the broadcaster added the second term (the `moderator_id` field contains the broadcaster’s ID). The second term also shows using a wildcard character to block all variations of shoot.

```
{
  "data": [
    {
      "broadcaster_id": "1234",
      "moderator_id": "5678",
      "id": "81931a11-8e90-4b5c-9471-45ba9698d6b7",
      "text": "because i said so",
      "created_at": "2022-08-04T21:37:44Z",
      "updated_at": "2022-08-04T21:37:44Z",
      "expires_at": null
    },
    {
      "broadcaster_id": "1234",
      "moderator_id": "1234",
      "id": "a9dfb5d4-56f8-4a53-b90e-fdea1fc7eeae",
      "text": ":shoot*",
      "created_at": "2022-08-04T21:08:08Z",
      "updated_at": "2022-08-04T21:08:08Z",
      "expires_at": null
    },
    . . .
  ],
  "pagination": {}
}

```

## Handling messages held by AutoMod  {#handling-messages-held-by-automod}

If AutoMod flags a chat message as possibly inappropriate based on the broadcaster’s AutoMod settings, it holds it until a moderator reviews it and either allows it or denies it. To get held messages, your application must subscribe to the [Automod Message Hold](/docs/eventsub/eventsub-subscription-types/#automodmessagehold) EventSub subscription type. This subscription will notify you when AutoMod holds a message for review.

The following is an example of what this EventSub notification would look like:

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
    "broadcaster_user_id": "12826",
    "broadcaster_user_name": "Twitch",
    "broadcaster_user_login": "twitch",
    "user_id": "141981764",
    "user_name": "TwitchDev",
    "user_login": "twitchdev",
    "message_id": "989e9861-de5d-4c4d-88b4-75963e9e5b29",
    "message": "This is a bad message...",
    "level": 5,
    "category": "aggressive",
    "held_at": "2022-12-02T15:00:00.00Z",
    "fragments": [
      {
        "type": "text",
        "text": "This is a bad message...",
        "cheermote": null,
        "emote": null,
        "mention": null
      }
    ]
  }
}

```

After the moderator makes a determination about the message, use the [Manage Held AutoMod Messages](/docs/api/reference#manage-held-automod-messages) endpoint to allow or deny the message.

The request must include:

- The `user_id` field in the body of the request that’s set to the User ID in the EventSub messages `event.user_id` field.
- The `msg_id` field in the body of the request that’s set to the User ID in the EventSub message’s `event.message_id` field.
- The `action` field in the body of the request that’s set to ALLOW or DENY based on the moderator’s determination.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/automod/message' \
-H 'Authorization: Bearer cfabdegwdomawdzdo98xt2fo512y' \
-H 'Client-Id: uo6dggojyb8d6s92zknwmi5ej1q2' \
-H 'Content-Type: application/json' \
-d '{"user_id":"141981764","msg_id":"989e9861-de5d-4c4d-88b4-75963e9e5b29","action":"ALLOW"}'

```

If successful, the request returns an HTTP 204 No Content status code.

When a message held by AutoMod has its status updated, whether it be through the API or through Twitch’s UI, Twitch can notify you of the change through the [AutoMod Message Update](/docs/eventsub/eventsub-subscription-types/#automodmessageupdate) EventSub subscription type.

The following is an example of what this EventSub notification would look like:

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
    "broadcaster_user_id": "12826",
    "broadcaster_user_name": "Twitch",
    "broadcaster_user_login": "twitch",
    "user_id": "141981764",
    "user_name": "TwitchDev",
    "user_login": "twitchdev",
    "moderator_user_id": "197886470",
    "moderator_user_name": "TwitchRivals",
    "moderator_user_login": "twitchrivals",
    "message_id": "989e9861-de5d-4c4d-88b4-75963e9e5b29",
    "message": "This is a bad message...",
    "level": 5,
    "category": "aggressive",
    "status": "approved",
    "held_at": "2022-12-02T15:00:00.00Z",
    "fragments": [
      {
        "type": "text",
        "text": "This is a bad message...",
        "cheermote": null,
        "emote": null,
        "mention": null
      }
    ]
  }
}

```

## Monitoring suspicious users  {#monitoring-suspicious-users}

Sometimes a user needs to be monitored by the moderation team without indicating to the user, or people not on the moderation team, that they are being monitored. Twitch provides [Suspicious User Controls](https://help.twitch.tv/s/article/suspicious-user-controls) to perform this action.

Twitch can notify you whenever a user marked as a Supicious User sends a chat message, or when their status as Monitored or Restricted has changed.

Monitoring messages sent by a Suspicious User is performed using the [Suspicious User Message](/docs/eventsub/eventsub-subscription-types/#channelsuspicious_usermessage) EventSub subscription type. This subscription type is important for monitoring messages from these users, as users marked as **restricted** will not have their messages appear in Channel Chat Message, and instead will only appear to moderators subscribed to this EventSub type.

The following is an example of this EventSub notification when a user is marked as restricted:

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "automod.suspicious_user.message",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-04-11T10:11:12.123Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_name": "TwitchDev",
    "broadcaster_user_login": "twitchdev",
    "user_id": "57047445",
    "user_name": "Xemdo",
    "user_login": "xemdo",
    "low_trust_status": "restricted",
    "shared_ban_channel_ids": null,
    "types": [
      "manually_added"
    ],
    "ban_evasion_evaluation": "unknown",
    "message": {
      "message_id": "c94481e0-aa78-4dfa-b666-9cc856f446f1",
      "text": "I'm gonna disrupt your Twitch experience! PotFriend",
      "fragments": [
        {
          "type": "emote",
          "text": "PotFriend",
          "Cheermote": {
            "prefix": "",
            "bits": 0,
            "tier": 0
          },
          "emote": {
            "id": "emotesv2_e02650251d204198923de93a0c62f5f5",
            "emote_set_id": "0"
          }
        }
      ]
    }
  }
}

```

When manually changing the Suspicious User status of a given user, Twitch can also notify you of this EventSub through the [Suspicious User Update](/docs/eventsub/eventsub-subscription-types/#channelsuspicious_userupdate) EventSub subscription type.

The following is an example of this EventSub notification when a has their Suspicious User status removed:

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
    "broadcaster_user_id": "141981764",
    "broadcaster_user_name": "TwitchDev",
    "broadcaster_user_login": "twitchdev",
    "moderator_user_id": "135093069",
    "moderator_user_name": "BlueLava",
    "moderator_user_login": "bluelava",
    "user_id": "57047445",
    "user_name": "Xemdo",
    "user_login": "xemdo",
    "low_trust_status": "no_treatment"
  }
}

```

## Managing bad behavior with timeouts and bans  {#managing-bad-behavior-with-timeouts-and-bans}

If a user is behaving badly in chat, you might put them in a timeout to give them a chance to cooldown. If they continue behaving badly, you have the option to ban them from chat. If the user’s behavior is really bad, you might ban them without first putting them in a timeout.

This section covers the following:

- Putting a user in a timeout
- Banning a user from chat
- Removing a ban or timeout
- Getting a list of users that are banned or in a timeout

### Putting a user in a timeout  {#putting-a-user-in-a-timeout}

To put a user in a timeout, use the [Ban User](/docs/api/reference#ban-user) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:banned_users** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- A body with the following fields:

- The `data` field that’s set to an object with the following fields:

- The `user_id` field that’s set to the User ID of the user to put in a timeout.
- The `duration` field that’s set to the length of the timeout in seconds.
- The `reason` field that’s set to the reason for putting the user in a timeout. Optional.

The following example puts the user in a 5 minute timeout. No reason is given for the timeout.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer 3roj7kbiewqqhl9t6nb3vdvxrbdvlm' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"data":{"user_id":"9876","duration":300}}'

```

The response includes the timestamp when the timeout ends.

```
{
  "data": [
    {
      "broadcaster_id": "1234",
      "moderator_id": "5678",
      "user_id": "9876",
      "created_at": "2022-08-04T16:49:01Z",
      "end_time": "2022-08-04T16:54:01Z"
    }
  ]
}

```

While a user is in a timeout, you can extend or shorten the timeout by calling the endpoint again with a longer or shorter duration. Or, if you think the user’s behavior warrants it, you can ban them.

When a user is timed out, Twitch can notify you through the [Channel Ban](/docs/eventsub/eventsub-subscription-types/#channelban) EventSub notification. For timeouts, this event will set the field `is_permanent` to `false`, and will have an RFC3339 date string in the field `ends_at`.

An example of this EventSub notification, where a user was timed out for 60 seconds:

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

### Banning a user from chat  {#banning-a-user-from-chat}

To ban a user, use the [Ban User](/docs/api/reference#ban-user) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:banned_users** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- A body with the following fields:

- The `data` field that’s set to an object with the following fields:

- The `user_id` field that’s set to the User ID of the user to ban.
- The `reason` field that’s set to the reason for banning the user. Optional.

The following example bans a user from the broadcaster’s chat room. No reason is given for the ban. Notice that the only difference between banning the user and putting them in a timeout, is you don’t include the `duration` field.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer 3roj7kbiewqqhl9t6nb3vdvxrbdvlm' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"data":{"user_id":"9876"}}'

```

The response to the ban request. Because bans don’t expire, the `end_time` field is set to **null**.

```
{
  "data": [
    {
      "broadcaster_id": "713936733",
      "moderator_id": "713936733",
      "user_id": "800154565",
      "created_at": "2022-08-04T17:12:49Z",
      "end_time": null
    }
  ]
}

```

When a user is timed out, Twitch can notify you through the [Channel Ban](/docs/eventsub/eventsub-subscription-types/#channelban) EventSub subscription type. When a user is timed out, this event will set the field `is_permanent` to `true`, and will have a null value set in the `ends_at` field.

An example of this EventSub notification, where a user was banned from chat:

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
        "reason": "VERY offensive language",
        "banned_at": "2020-07-15T18:15:11.17106713Z",
        "ends_at": null,
        "is_permanent": true
    }
}

```

### Removing a ban or timeout  {#removing-a-ban-or-timeout}

To remove a ban or timeout, use the [Unban User](/docs/api/reference#unban-user) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:banned_users** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- The user_id query parameter that’s set to the User ID of the user to remove from a ban or timeout.

The following example shows how to remove a user from a ban or timeout.

```
curl -X DELETE 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=1234&moderator_id=5678&user_id=9876' \
-H 'Authorization: Bearer 3roj7kbiewqqhl9t6nb3vdvxrbdvlm' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t'

```

If the request succeeds, the response is an HTTP 204 No Content status code.

When a user is unbanned from chat, Twitch can notify you through the [Channel Unban](/docs/eventsub/eventsub-subscription-types/#channelunban) EventSub subscription type.

An example of this EventSub notification:

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

### Getting a list of users that are banned or in a timeout  {#getting-a-list-of-users-that-are-banned-or-in-a-timeout}

To get the list of users that the broadcaster has banned or put in a timeout, use the [Get Banned Users](/docs/api/reference#get-banned-users) endpoint.

The request must include:

- A User Access Token that includes the **moderation:read** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room. This ID must match the user ID in the User Access Token.

The following example shows how to get the list of users that were banned or put in a timeout.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=1234' \
-H 'Authorization: Bearer 3roj7kbiewqq9t6nb3vdvxrbdvlm' \
-H 'Client-Id: hof5gwx0su6owfnys0nn9c87zr6t'

```

The following example shows what the response looks like. The first user was put in a five minute timeout (you can tell this because the `expires_at` field is set to a timestamp). And the second user was banned (you can tell this because the `expires_at` field is set to an empty string). The list is in order of the `created_at` timestamp.

```
{
  "data": [
    {
      "user_id": "13579",
      "user_login": "rollinpants",
      "user_name": "RollinPants",
      "expires_at": "2022-08-04T19:00:08Z",
      "created_at": "2022-08-04T18:55:08Z",
      "reason": "",
      "moderator_id": "5678",
      "moderator_login": "modovermod",
      "moderator_name": "ModOverMod"
    },
    {
      "user_id": "98765",
      "user_login": "toastedwheaties",
      "user_name": "ToastedWheaties",
      "expires_at": "",
      "created_at": "2022-08-04T18:54:31Z",
      "reason": "",
      "moderator_id": "5678",
      "moderator_login": "modovermod",
      "moderator_name": "ModOverMod"
    }
  ],
  "pagination": {}
}

```

And here’s what the response looks like if the broadcaster hasn’t banned anyone or put them in a timeout.

```
{
  "data": [],
  "pagination": {}
}

```

The endpoint provides the following optional query parameter:

- user_id — A filter that you can use to determine whether specific users are banned or in a timeout. To specify more than one ID, include this parameter for each user you want to get. For example, `user_id=1234&user_id=5678`. You may specify a maximum of 100 IDs. Twitch API ignores duplicate and invalid IDs.

```
curl -X GET 'https://api.twitch.tv/helix/moderation/banned?broadcaster_id=1234&user_id=5678&user_id=9012&user_id=123' \
-H 'Authorization: Bearer lk9t9o4qyhnlwwy9rs2pwao0kutr' \
-H 'Client-Id: hof5gwx0su6owfnysyan9c87zr6t'

```

## Deleting chat messages  {#deleting-chat-messages}

Moderators can delete specific messages in chat, delete all messages from a specific user, and clear the current chat history.

This section covers the following:

- Removing a specific message from chat
- Removing all messages from chat

### Removing a specific message from chat  {#removing-a-specific-message-from-chat}

If a user posts a message that wasn’t filtered out by other means, you can use the [Delete Chat Messages](/docs/api/reference#delete-chat-messages) endpoint to remove it from chat.

The request must include:

- A User Access Token that includes the **moderator:manage:chat_messages** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- The message_id query parameter that’s set to the User ID of the message to delete. The message must be less than 6 hours old and it must not belong to the broadcaster.

```
curl -X DELETE 'https://api.twitch.tv/helix/moderation/chat?broadcaster_id=1234&moderator_id=5678&message_id=abc-123-def-456' \
-H 'Authorization: Bearer ln6n5azzuliqq57gmncybxrno4fy' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t'

```

If successful, the response is an HTTP 204 No Content status code, and the specified chat message will be removed from chat.

When messages are deleted from chat, Twitch can notify you through the [Channel Chat Message Delete](/docs/eventsub/eventsub-subscription-types/#channelchatmessage_delete) EventSub subscription type.

An example of the EventSub notification received when a user’s chat message is deleted:

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

Sometimes all messages from a user will be removed from chat. If this happens, Twitch can notify you through the [Channel Chat Clear User Messages](/docs/eventsub/eventsub-subscription-types/#channelchatclear_user_messages) EventSub subscription type.

An example of the EventSub notification received when all of a specific user’s chat messages are deleted:

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

This event is very similar to Channel Chat Message Delete, except it does not specify a message_id as all messages from that user are to be deleted.

### Removing all messages from chat  {#removing-all-messages-from-chat}

Sometimes you may desire to remove all messages in a chat. You can do this using the same [Delete Chat Messages](/docs/api/reference/#delete-chat-messages) endpoint. Most of the same requirements as deleting an individual message apply, but instead of specifying a message_id query parameter you will need to leave it empty.

```
curl -X DELETE 'https://api.twitch.tv/helix/moderation/chat?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer ln6n5azzuliqq57gmncybxrno4fy' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t'

```

If successful, the response is an HTTP 204 No Content status code, and all of the user’s chat messages will be removed from chat.

When all messages are cleared from chat, Twitch can notify you through the [Channel Chat Clear](/docs/eventsub/eventsub-subscription-types/#channelchatclear) EventSub subscription type.

An example of the EventSub notification received when a channel’s chat is cleared:

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

## Managing unban requests  {#managing-unban-requests}

While chat bans are more than often well-justified, some streamers may wish to offer their chatters a second chat. Therefore, Twitch offers Unban Requests as a feature to give users a way to ask for a second chance at being a part of their community.

This section covers the following:

- Getting a list of unban requests
- Resolving unban requests

### Getting a list of unban requests  {#getting-a-list-of-unban-requests}

Twitch lets you see a list of these requests through the [Get Unban Requests](/docs/api/reference/#get-unban-requests) endpoint.

The request must include:

- A User Access Token that includes either the **moderator:read:unban_requests** or **moderator:manage:unban_requests** scope
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster of the channel.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- The status query parameter that’s set to one of the following statuses:

- pending
- approved
- denied
- acknowledged
- canceled

```
curl -X GET 'https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=1234&moderator_id=5678&status=pending' \
-H 'Authorization: Bearer ln6n5azzuliqq57gmncybxrno4fy' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t'

```

The following example shows the response to the previous request.

```
{
  "data": [
    {
      "id": "92af127c-7326-4483-a52b-b0da0be61c01",
      "broadcaster_name": "12826",
      "broadcaster_login": "twitch",
      "broadcaster_id": "Twitch",
      "moderator_id": "141981764",
      "moderator_login": "twitchdev",
      "moderator_name": "TwitchDev",
      "user_id": "57047445",
      "user_login": "xemdo",
      "user_name": "Xemdo",
      "text": "Please unban me, I love Patch Notes!",
      "status": "pending",
      "created_at": "2024-04-01T02:07:55Z",
      "resolved_at": null,
      "resolution_text": null
    }
  ],
  "pagination": {}
}

```

You can also observe and handle unban requests as they are requested. Twitch can notify you when an unban request is made through the [Channel Unban Request Create](/docs/eventsub/eventsub-subscription-types/#channelunban_requestcreate) EventSub subscription type.

An example of the EventSub notification received when an unban request is created:

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.unban_request.create",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "12826",
      "moderator_user_id": "141981764"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "id": "92af127c-7326-4483-a52b-b0da0be61c01",
    "broadcaster_id": "12826",
    "broadcaster_login": "twitch",
    "broadcaster_name": "Twitch",
    "user_id": "57047445",
    "user_login": "xemdo",
    "user_name": "Xemdo",
    "text": "Please unban me, I love Patch Notes!",
    "created_at": "2024-04-01T02:07:55Z"
  }
}

```

### Resolving unban requests  {#resolving-unban-requests}

To resolve an Unban Request, you can use the [Resolve Unban Requests](/docs/api/reference/#resolve-unban-requests) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:unban_requests** scope
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster of the channel.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- The unban_request_id query parameter that’s set to the ID given by the `id` field from the response of Get Unban Requests
- The status query parameter that’s set to one of the following statuses:

- approved
- denied

```
curl -X PATCH 'https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=1234&moderator_id=5678&status=approved' \
-H 'Authorization: Bearer ln6n5azzuliqq57gmncybxrno4fy' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t'

```

You may also optionally set a resolution message by using the `resolution_text` query parameter.

If successful, the response is an HTTP 200 OK status code, as well as the following example response body:

```
{
  "data": [
    {
      "id": "92af127c-7326-4483-a52b-b0da0be61c01",
      "broadcaster_name": "12826",
      "broadcaster_login": "twitch",
      "broadcaster_id": "Twitch",
      "moderator_id": "141981764",
      "moderator_login": "twitchdev",
      "moderator_name": "TwitchDev",
      "user_id": "57047445",
      "user_login": "xemdo",
      "user_name": "Xemdo",
      "text": "Please unban me, I love Patch Notes!",
      "status": "approved",
      "created_at": "2024-04-01T02:07:55Z",
      "resolved_at": "2022-08-09T02:07:55Z",
      "resolution_text": "The beauty of grace is that it makes life not fair"
    }
  ]
}

```

When an unban request has been resolved, Twitch can notify you through the [Channel Unban Request Resolve](/docs/eventsub/eventsub-subscription-types/#channelunban_requestresolve) EventSub subscription type.

An example of the EventSub notification received when an unban request is resolved:

```
{
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "type": "channel.unban_request.create",
    "version": "1",
    "status": "enabled",
    "cost": 0,
    "condition": {
      "broadcaster_user_id": "12826",
      "moderator_user_id": "141981764"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "id": "92af127c-7326-4483-a52b-b0da0be61c01",
    "broadcaster_name": "12826",
    "broadcaster_login": "twitch",
    "broadcaster_id": "Twitch",
    "moderator_id": "141981764",
    "moderator_login": "twitchdev",
    "moderator_name": "TwitchDev",
    "user_id": "57047445",
    "user_login": "xemdo",
    "user_name": "Xemdo",
    "resolution_text": "The beauty of grace is that it makes life not fair",
    "status": "approved"
  }
}

```

## Protecting your chat with Shield Mode  {#protecting-your-chat-with-shield-mode}

[Shield Mode](https://safety.twitch.tv/s/article/Protect-your-channel-with-Shield-Mode) is a tool on Twitch to customize and pre-set powerful safety settings that can be quickly activated to stop hateful messages from being spammed in your channel and instantly ban harassers.

Twitch allows you to activate and disable Shield Mode on a channel using the [Update Shield Mode Status](/docs/api/reference/#update-shield-mode-status) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:shield_mode** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.
- A body with the following fields:

- The `is_active` field that’s set to the `true` to activate Shield Mode, or `false` to deactivate Shield Mode.

The following example activates Shield Mode in a broadcaster’s chat.

```
curl -X POST 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=1234&moderator_id=5678' \
-H 'Authorization: Bearer 3roj7kbiewqqhl9t6nb3vdvxrbdvlm' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{"is_active":true}'

```

The following is the response to the previous request:

```
{
  "data": [
    {
      "is_active": true,
      "moderator_id": "98765",
      "moderator_name": "SimplySimple",
      "moderator_login": "simplysimple",
      "last_activated_at": "2022-07-26T17:16:03.123Z"
    }
  ]
}

```

You can check if Shield Mode is activated using the [Get Shield Mode Status](/docs/api/reference/#get-shield-mode-status) endpoint.

The request must include:

- A User Access Token that includes the **moderator:manage:shield_mode** scope.
- The broadcaster_id query parameter that’s set to the User ID of the broadcaster that owns the chat room.
- The moderator_id query parameter that’s set to the User ID of a user that moderates the broadcaster’s chat room or the broadcaster’s ID. This ID must match the user ID in the User Access Token.

If successful, the response will be in the same format as Update Shield Mode Status.

When Shield Mode is enabled or disabled, Twitch can notify you through the [Channel Shield Mode Begin](/docs/eventsub/eventsub-subscription-types/#channelshield_modebegin) and [Channel Shield Mode End](/docs/eventsub/eventsub-subscription-types/#channelshield_modeend) EventSub subscription types.

An example of a the Channel Shield Mode Begin notification being received:

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

The notification for Channel Shield Mode Begin is the same except for removing the field `started_at` and adding the field `ended_at`.

## Monitoring moderation actions  {#monitoring-moderation-actions}

For each above action, the relevant EventSub event was included. However, Twitch also provides the [Channel Moderate](/docs/eventsub/eventsub-subscription-types/#channelmoderate) EventSub subscription type for monitoring even more moderation actions.

The Channel Moderate EventSub subscription type is an umberella type, and meant to replicate the information provided in the past by Twitch’s PubSub. Therefore, it requires **all** of the following scopes:

- **moderator:read:blocked_terms** OR **moderator:manage:blocked_terms**
- **moderator:read:chat_settings** OR **moderator:manage:chat_settings**
- **moderator:read:unban_requests** OR **moderator:manage:unban_requests**
- **moderator:read:banned_users** OR **moderator:manage:banned_users**
- **moderator:read:chat_messages** OR **moderator:manage:chat_messages**
- **moderator:read:moderators**
- **moderator:read:vips**

When a notification from Channel Moderate is received, it will look similar to this example payload:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "...",
    "followers": ...,
    "slow": ...,
    "vip": ...,
    "unvip": ...,
    "mod": ...,
    "unmod": ...,
    "ban": ...,
    "unban": ...,
    "timeout": ...,
    "untimeout": ...,
    "raid": ...,
    "unraid": ...,
    "delete": ...,
    "automod_terms": ...,
    "unban_request": ...
  }
}

```

In the above example, all values have been replaced with `...` to indicate where data will be. Most values will be set to `null`, except for the one that corresponds to whatever string is put into the `action` field.

The possible values for the `action` field are:

- ban
- timeout
- unban
- untimeout
- clear
- emoteonly
- emoteonlyoff
- followers
- followersoff
- uniquechat
- uniquechatoff
- slow
- slowoff
- subscribers
- subscribersoff
- unraid
- delete
- unvip
- vip
- raid
- add_blocked_term
- add_permitted_term
- remove_blocked_term
- remove_permitted_term
- mod
- unmod
- approve_unban_request
- deny_unban_request

The following actions from that list will not have any metadata about the action. This means every field below `action` in the above example payload will be null:

- clear
- emoteonly
- emoteonlyoff
- followersoff
- uniquechat
- uniquechatoff
- slowoff
- subscribers
- subscribersoff
- unraid

The following events have additional fields set with metadata about the action. Example EventSub payloads are included with each action name.

### ban  {#ban}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `ban`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "ban",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "reason": "Rude behavior"
    },
    "unban": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### timeout  {#timeout}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `timeout`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "timeout",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": null,
    "timeout": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "reason": "Rude behavior",
      "expires_at": "2024-04-11T02:36:22.719151926Z"
    },
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### unban  {#unban}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `unban`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "unban",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### untimeout  {#untimeout}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `untimeout`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "untimeout",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": null,
    "ban": null,
    "unban": null,
    "timeout": null,
    "untimeout": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### followers  {#followers}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `followers`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "followers",
    "followers": {
      "follow_duration_minutes": 600
    },
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
    "unban_request": null
  }
}
```

### slow  {#slow}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `slow`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "slow",
    "followers": null,
    "slow": {
      "wait_time_seconds": 1000
    },
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
    "unban_request": null
  }
}
```

### raid  {#raid}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `raid`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "raid",
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
    "raid": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "viewer_count": 0
    },
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### unraid  {#unraid}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `unraid`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "unraid",
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
    "unraid": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### delete  {#delete}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `delete`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "delete",
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
    "delete": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "message_id": "01734b3f-b3af-4790-9189-9e17acb7cd36",
      "message_body": "Test"
    },
    "automod_terms": null,
    "unban_request": null
  }
}
```

### vip  {#vip}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `vip`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "vip",
    "followers": null,
    "slow": null,
    "vip": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
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
    "unban_request": null
  }
}
```

### unvip  {#unvip}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `unvip`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "unvip",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
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
    "unban_request": null
  }
}
```

### add_blocked_term  {#add_blocked_term}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `add_blocked_term`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "add_blocked_term",
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
    "automod_terms": {
      "action": "add",
      "list": "blocked",
      "terms": [
        "poggers"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}
```

### add_permitted_term  {#add_permitted_term}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `add_permitted_term`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "add_permitted_term",
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
    "automod_terms": {
      "action": "add",
      "list": "permitted",
      "terms": [
        "poggers"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}
```

### remove_blocked_term  {#remove_blocked_term}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `remove_blocked_term`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "remove_blocked_term",
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
    "automod_terms": {
      "action": "remove",
      "list": "blocked",
      "terms": [
        "poggers"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}
```

### remove_permitted_term  {#remove_permitted_term}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `remove_permitted_term`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "remove_permitted_term",
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
    "automod_terms": {
      "action": "remove",
      "list": "permitted",
      "terms": [
        "poggers"
      ],
      "from_automod": false
    },
    "unban_request": null
  }
}
```

### mod  {#mod}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `mod`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "mod",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
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
    "unban_request": null
  }
}
```

### unmod  {#unmod}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `unmod`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "unmod",
    "followers": null,
    "slow": null,
    "vip": null,
    "unvip": null,
    "mod": null,
    "unmod": {
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals"
    },
    "ban": null,
    "unban": null,
    "timeout": null,
    "untimeout": null,
    "raid": null,
    "unraid": null,
    "delete": null,
    "automod_terms": null,
    "unban_request": null
  }
}
```

### approve_unban_request  {#approve_unban_request}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `approve_unban_request`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "approve_unban_request",
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
    "unban_request": {
      "is_approved": true,
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "moderator_message": "The beauty of grace is that it makes life not fair"
    }
  }
}
```

### deny_unban_request  {#deny_unban_request}

   **Example Payload -- Click to Expand**  Example payload when `action` field is set to `deny_unban_request`:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "channel.moderate",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "141981764",
      "moderator_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "broadcaster_user_id": "141981764",
    "broadcaster_user_login": "twitchdev",
    "broadcaster_user_name": "TwitchDev",
    "moderator_user_id": "12826",
    "moderator_user_login": "twitch",
    "moderator_user_name": "Twitch",
    "action": "deny_unban_request",
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
    "unban_request": {
      "is_approved": false,
      "user_id": "197886470",
      "user_login": "twitchrivals",
      "user_name": "TwitchRivals",
      "moderator_message": "You've lost your chance"
    }
  }
}
```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
