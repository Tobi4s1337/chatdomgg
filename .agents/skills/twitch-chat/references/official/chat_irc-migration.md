<!-- source: https://dev.twitch.tv/docs/chat/irc-migration/ -->

Contents

# Migrating from IRC  {#migrating-from-irc}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

With the introduction of Chat on EventSub, it is recommended to upgrade your chatbots that are using Twitch IRC to use EventSub (for reading chat messages and roomstates) and Twitch API (for sending chat messages).

This guide is designed to assist in migrating from IRC to EventSub/API, as there is large differences in the presentation and delivery of some information. It will focus more on the differences between the two systems rather than providing code samples for each topic.

## Sending chat messages  {#sending-chat-messages}

Sending chat messages can now be performed using the [Send Chat Message](/docs/api/reference/#send-chat-message) API. For more information on performing this, see [Sending Chat Messages](/docs/chat/send-receive-messages/#sending-chat-messages).

While IRC required the scope chat:edit, the Send Chat Message API requires at a minimum the **user:write:chat** from the chatting user. If using an App Access Token, the token will also require the scope **user:bot** from the chatting user, and either moderator status in the channel or **channel:bot** scope from the broadcaster.

## Reading chat messages  {#reading-chat-messages}

Reading chat messages can now be performed using the [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub subscription. For more information on performing this, see [Receiving Chat Messages](/docs/chat/send-receive-messages/#receiving-chat-messages).

While IRC required the scope chat:read, the Channel Chat Message EventSub subscription requires at a minimum the **user:read:chat** scope from the chatting user. If using an App Access Token, the token will also require the scope **user:bot** from the chatting user, and either moderator status or **channel:bot** scope from the broadcaster.

## PRIVMSG Tags  {#privmsg-tags}

Reading chat messages in IRC was done by parsing the `PRIVMSG` command sent by the Twitch IRC Server. Using EventSub, some information from `PRIVMSG` tags are still provided for [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage), however the format is much different than IRC.

### Badges  {#badges}

In Twitch IRC’s PRIVMSG command, badges were included in the command’s `badge-info` and `badges` tags when [Twitch-specific capabilities](/docs/chat/irc/#requesting-twitch-capabilities) were requested. For more information on these tags, see [PRIVMSG Tags](/docs/chat/irc/#privmsg-tags).

When a message is received via the Channel Chat Message EventSub subscription, the `badges` object will be found under the `event` object. An example of this object:

```
"badges": [
  {
    "set_id": "staff",
    "id": "1",
    "info": ""
  },
  {
    "set_id": "broadcaster",
    "id": "1",
    "info": ""
  },
  {
    "set_id": "twitch-recap-2023",
    "id": "1",
    "info": ""
  }
],

```

That object describes, as an array, what badges the user sending the message will have.

To get the badge from each object in the array, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set_id` field’s value in the response. Then, match the version to the id field in the list of versions.

### Emotes  {#emotes}

In Twitch IRC’s PRIVMSG command, emotes were included in the command’s `emotes` tag when [Twitch-specific capabilities](/docs/chat/irc/#requesting-twitch-capabilities) were requested. For more information on these tags, see [PRIVMSG Tags](/docs/chat/irc/#privmsg-tags).

When a message is received via the Channel Chat Message EventSub subscription, the `message` object will contain information about the chat message sent. This object will be found under the `event` object. An example of this object:

```
"message": {
  "text": "Hello! HeyGuys",
  "fragments": [
    {
      "type": "text",
      "text": "Hello! ",
      "cheermote": null,
      "emote": null,
      "mention": null
    },
    {
      "type": "emote",
      "text": "HeyGuys",
      "cheermote": null,
      "emote": {
        "id": "30259",
        "emote_set_id": "0",
        "owner_id": "0",
        "format": [
          "static"
        ]
      },
      "mention": null
    }
  ]
},

```

In the above chat message, the user sent “Hello!” followed by the HeyGuys emote. Twitch breaks this message up into fragments, one of which is regarding the emote found in the message. The following information is given about the emote:

- Emote ID, as `id`
- Emote Set ID, as `emote_set_id`
- The User ID of the user who owns the emote, as `owner_id` (**NOTE:** this may be 0 for emotes with no owners, such as global emotes)
- Emote’s possible formats, as `format`

You can get the image file for an emote using some of this information. The image file will be at the URL defined in the `template` string provided from the following emote-related API endpoints:

- [Get Global Emotes](/docs/api/reference/#get-global-emotes) API, to get all global Twitch Emotes.
- [Get Channel Emotes](/docs/api/reference/#get-channel-emotes) API, to get Emotes available for a given channel.
- [Get User Emotes](/docs/api/reference/#get-user-emotes) API, to get Emotes available for use by your own user. This requires a User Access Token.

For more information on how to handle emotes in chat messages using EventSub, see [Handling Emotes](/docs/chat/send-receive-messages/#handling-emotes).

### Replies  {#replies}

In Twitch IRC’s PRIVMSG command, information about replies were included in the tags `reply-*` when [Twitch-specific capabilities](/docs/chat/irc/#requesting-twitch-capabilities) were requested. For more information on these tags, see [PRIVMSG Tags](/docs/chat/irc/#privmsg-tags).

When a message is received via the Channel Chat Message EventSub subscription, the `message` object will be found under the `event` object. An example of this object:

```
"reply": {
  "parent_message_id": "e403cdaf-b781-4740-8473-9a00291fef0b",
  "parent_message_body": "@twitchdev That's awesome!",
  "parent_user_id": "57047445",
  "parent_user_name": "TwitchRivals",
  "parent_user_login": "twitchrivals",
  "thread_message_id": "ed977655-8c2e-4dcb-ac72-52fcfa7362f2",
  "thread_user_id": "783878488",
  "thread_user_name": "TwitchDev",
  "thread_user_login": "twitchdev"
},

```

In the above object, the user who sent the message was replying to a message from the user TwitchRivals. The original message in this thread was by TwitchDev. The “parent” message is the message that is being directly replied to. The “thread” message is the message that was the first message replied to in the reply chain. This allows for easier displaying of reply chains in Chat Clients.

**NOTE:** Because TwitchDev started the reply, the chat on twitch.tv will automatically add @twitchdev to the beginning of the message. When you add a reply to your chatbot, you do not have to include this portion.

If you send messages over Twitch API, you’ll be using the [Send Chat Message](/docs/api/reference/#send-chat-message) API to do so. If you want to send a message replying to someone using this API, you’ll need to include the `reply_parent_message_id` string object in the request body of the API call. This will need to be set to the `message_id` of the chat message you wish to reply to.

An example of sending a chat message in reply to someone:

```
curl -X POST 'https://api.twitch.tv/helix/chat/messages' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz' \
-H 'Content-Type: application/json' \
-d '{
  "broadcaster_id": "12826",
  "sender_id": "141981764",
  "message": "Hello, world! twitchdevHype",
  "reply_parent_message_id": "ed977655-8c2e-4dcb-ac72-52fcfa7362f2"
}'

```

### Cheer / Bits  {#cheer--bits}

In Twitch IRC’s PRIVMSG command, emotes were included in the tags command’s `bits` tag when [Twitch-specific capabilities](/docs/chat/irc/#requesting-twitch-capabilities) were requested. For more information on these tags, see [PRIVMSG Tags](/docs/chat/irc/#privmsg-tags).

When a message is received via the Channel Chat Message EventSub subscription, the `cheer` object will be found under the `event` object. An example of this object:

```
"cheer": {
  "bits": 100
},

```

The `cheer` object describes how many bits were cheered in the message.

If you need information about how the cheer appears in the message, such as for info about the cheermote used, you can check the `message` object, under the `fragments` array:

```
"message": {
  "text": "Cheer100 Amazing speedrun!",
  "fragments": [
    {
      "type": "cheermote",
      "text": "Cheer100",
      "cheermote": {
        "prefix": "cheer",
        "bits": 100,
        "tier": 100
      },
      "emote": null,
      "mention": null
    },
    {
      "type": "text",
      "text": " Amazing speedrun!",
      "cheermote": null,
      "emote": null,
      "mention": null
    }
  ]
},

```

## CLEARCHAT  {#clearchat}

In Twitch IRC, `CLEARCHAT` was sent when a moderator clears the entire chat, or clears every message in chat sent by a specific user. This was split into two subscription types in EventSub:

- [Channel Chat Clear](/docs/eventsub/eventsub-subscription-types/#channelchatclear)
- [Channel Chat Clear User Messages](/docs/eventsub/eventsub-subscription-types/#channelchatclear_user_messages)

### Channel Chat Clear  {#channel-chat-clear}

When a moderator clears the entire chat, the EventSub subscription type **Channel Chat Clear** will be sent. Here is an example of how this payload will look:

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.clear",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "197886470",
            "user_id": "1337"
        },
        "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "197886470",
        "broadcaster_user_name": "TwitchRivals",
        "broadcaster_user_login": "twitchrivals"
    }
}

```

In the above example, all messages in TwitchRivals’ chat were cleared.

### Channel Chat Clear User Messages  {#channel-chat-clear-user-messages}

When a moderator clears all messages sent by an individual user in chat, the EventSub subscription type **Channel Chat Clear** will be sent. Here is an example of how this payload will look:

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat.clear_user_messages",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "197886470",
            "user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "197886470",
        "broadcaster_user_name": "TwitchRivals",
        "broadcaster_user_login": "twitchrivals",
        "target_user_id": "141981764",
        "target_user_name": "TwitchDev",
        "target_user_login": "twitchdev"
    }
}

```

In the above example, all messages from the user TwitchDev were removed from TwitchRivals’ chat.

## CLEARMSG  {#clearmsg}

In Twitch IRC, `CLEARMSG` was sent when a single message was deleted by a moderator. This was introduced into EventSub was the [Channel Chat Message Delete](/docs/eventsub/eventsub-subscription-types/#channelchatmessage_delete) EventSub subscription type. Here is an example of how this payload will look:

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
        "broadcaster_user_id": "197886470",
        "broadcaster_user_name": "TwitchRivals",
        "broadcaster_user_login": "twitchrivals",
        "target_user_id": "141981764",
        "target_user_name": "TwitchDev",
        "target_user_login": "twitchdev",
        "message_id": "ab24e0b0-2260-4bac-94e4-05eedd4ecd0e"
    }
}

```

In the above example, a single message sent by TwitchDev was deleted from TwitchRivals’ chat. The specific message is identified by the `message_id` field.

## ROOMSTATE  {#roomstate}

In Twitch IRC, `ROOMSTATE` was sent whenever a user joined a chatroom, and also whenever the chatroom’s settings changed. In EventSub this was introduced as the [Channel Chat Settings Update](/docs/eventsub/eventsub-subscription-types/#channelchat_settingsupdate) EventSub subscription type, however it only sends whenever the chatroom settings change. To get the settings at any given moment, such as when you first join the chatroom, you can call the [Get Chat Settings](/docs/api/reference/#get-chat-settings) API.

### Channel Chat Settings Update (EventSub)  {#channel-chat-settings-update-eventsub}

When a chatroom’s settings change, the EventSub subscription type **Channel Chat Settings Update** will be sent. Here is an example of how this payload will look:

```
{
    "subscription": {
        "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
        "type": "channel.chat_settings.update",
        "version": "1",
        "status": "enabled",
        "cost": 0,
        "condition": {
            "broadcaster_user_id": "141981764",
            "user_id": "1337"
        },
         "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
        },
        "created_at": "2023-04-11T10:11:12.123Z"
    },
    "event": {
        "broadcaster_user_id": "141981764",
        "broadcaster_user_login": "twitchdev",
        "broadcaster_user_name": "TwitchDev",
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

In the above example, the chatroom’s settings were updated to what was listed in the response body. This does not offer indication of what the settings were before the update, just what they were updated to. Given that there is no indication of transition, it is up to your chat bot to analyze which settings have changed.

### Get Chat Settings (API)  {#get-chat-settings-api}

At any given time you can call the [Get Chat Settings](/docs/api/reference/#get-chat-settings) API to get information about what the chatroom’s settings are. To replicate the `ROOMSTATE` message you get when you join a channel, you should call this API whenever you subscribe to the **Channel Chat Message** subscription type via EventSub.

An example of calling the API to get a chatroom’s settings:

```
curl -X GET 'https://api.twitch.tv/helix/chat/settings?broadcaster_id=141981764' \
-H 'Authorization: Bearer 4a4x78f5wqvkybms7mxfist3jmzul' \
-H 'Client-Id: t214nt8z1rdtbj69hyarjvh5mi6fh'

```

Replace `broadcaster_id` with the User ID of the chatroom you wish to get the settings of. If the user exists and is not banned, the API will return a JSON response body similar to this example:

```
{
  "data": [
    {
      "broadcaster_id": "141981764",
      "slow_mode": false,
      "slow_mode_wait_time": null,
      "follower_mode": true,
      "follower_mode_duration": 0,
      "subscriber_mode": false,
      "emote_mode": false,
      "unique_chat_mode": false
    }
  ]
}

```

If you are a moderator, you can get also get the non-moderator chat delay. This is the delay in seconds after a chat message is sent before non-moderator users can see it. This allows moderators to moderate messages before users can see them, preventing any bad things appearing if they were to delete it manually. To get this information, you must include `moderator_id` in the query parameters when calling the Twitch API.

An example of this API call when you include the `moderator_id` query parameter:

```
{
  "data": [
    {
      "broadcaster_id": "141981764",
      "slow_mode": false,
      "slow_mode_wait_time": null,
      "follower_mode": true,
      "follower_mode_duration": 0,
      "subscriber_mode": false,
      "emote_mode": false,
      "unique_chat_mode": false,
      "non_moderator_chat_delay": true,
      "non_moderator_chat_delay_duration": 4
    }
  ]
}

```

## USERSTATE and GLOBALUSERSTATE  {#userstate-and-globaluserstate}

In Twitch IRC, `GLOBALUSERSTATE` and `USERSTATE` contain information about the authenticated user, such as User ID, display name, user type, emote sets available for you, your user’s chat badges, and your user’s chat color. `GLOBALUSERSTATE` sends this information as soon as you authenticate with the Twitch IRC Server. `USERSTATE` sends this every time you join a new channel using `JOIN`.

These two commands were split into multiple EventSub events and API calls.

### User ID, Display Name, and User Type  {#user-id-display-name-and-user-type}

You can get the User ID, display name, and user type of the authenticated user associated with your the User Access Token by calling Get Users without any query parameters.

An example of calling the API to get that information about your user:

```
curl -X GET 'https://api.twitch.tv/helix/users' \
-H 'Authorization: Bearer 4a4x78f5wqvkybms7mxfist3jmzul' \
-H 'Client-Id: t214nt8z1rdtbj69hyarjvh5mi6fh'

```

This call must be done using a User Access Token. If called using an App Access Token, it will fail with the HTTP status code of 400 Bad Request. If successful, the API will return a JSON response body containing information about your user:

```
{
  "data": [
    {
      "broadcaster_type": "",
      "created_at": "2014-02-18T01:07:56Z",
      "description": "redacted!",
      "display_name": "Xemdo",
      "id": "57047445",
      "login": "xemdo",
      "offline_image_url": "",
      "profile_image_url": "https://static-cdn.jtvnw.net/jtv_user_pictures/d7e81fca-ae54-4e9c-b29d-c50486c9a7fe-profile_image-300x300.png",
      "type": "staff",
      "view_count": 0
    }
  ]
}

```

The relevant fields in the above payload are:

| Field | Description |
|---|---|
| `id` | The User ID of your user. In `USERSTATE` this was `id`. |
| `display_name` | The display name of your user. In `USERSTATE` this was `display-name`. |
| `type` | The user type of your user. In `USERSTATE` this was `user-type`. |

### List of emotes you can use  {#list-of-emotes-you-can-use}

To get a list of emotes you can use in chat, you can call the [Get User Emotes](/docs/api/reference/#get-user-emotes) API. To get this list, you’ll need to call the API and iterate through its pages using the [pagination cursor](/docs/api/guide/#pagination).

There are additional requirements to this API:

- Your token must be a User Access Token
- You must authenticate the token with the scope **user:read:emotes**
- The `user_id` query parameter used must match the User ID in your User Access Token

An example of calling this API:

```
curl -X GET 'https://api.twitch.tv/helix/chat/emotes/user?user_id=123456' \
-H 'Authorization: Bearer kpvy3cjboyptmiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfn0nyan9c87zr6t'

```

This provides all emotes you can use globally, including but not limited to global emotes, subscriber emotes, and follower emotes of broadcasters you are subscribed to. To see follower emotes for broadcasters you follow but are not subscirbed to, you will need to call the API using the `broadcaster_id` query parameter. The value of this parameter will be the channel you wish to get the follower emotes of:

```
curl -X GET 'https://api.twitch.tv/helix/chat/emotes/user?user_id=123456&broadcaster_id=141981764' \
-H 'Authorization: Bearer kpvy3cjboyptmiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfn0nyan9c87zr6t'

```

### Chat Color  {#chat-color}

You can get any user’s chat color, including your own, by calling the [Get User Chat Color](/docs/api/reference/#get-user-chat-color) API.

There is no EventSub subscription type that indicates when your user’s chat color has changed, but it can be inferred by other events. The following EventSub subscription types describe a user’s chat color whenever they occur:

- [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage)
- [Channel Chat Notification](/docs/eventsub/eventsub-subscription-types/#channelchatnotification)

### Chat Badges  {#chat-badges}

You can see what chat badges a user has when they send a message, or when a chat notification occurs. This happens during [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) and [Channel Chat Notification](/docs/eventsub/eventsub-subscription-types/#channelchatnotification) respectively.

In these events, the badges of the user sending the message will appear as in the `event` object as the `badges` array:

```
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

```

To get additional information about the badge, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set-id` field’s value in the response. Then, match the version to the `id` field in the list of versions.

## USERNOTICE  {#usernotice}

USERNOTICE provided various information about events. To replace some of this functionality, the [Channel Chat Notification](/docs/eventsub/eventsub-subscription-types/#channelchatnotification) EventSub subscription was introduced.

The following table describes what `notice_type` found in the Channel Chat Notification corresponds to the `msg-id` given by `USERNOTICE` in Twitch IRC:

| IRC msg-id | EventSub notice_type | Notes |
|---|---|---|
| sub | sub |  |
| resub | resub | `is_gift` indicates whether the resub was gifted or not. |
| subgift | sub_gift |  |
| submysterygift | community_sub_gift |  |
| giftpaidupgrade | gift_paid_upgrade |  |
| rewardgift | N/A | Not in Channel Chat Notification |
| anongiftpaidupgrade | gift_paid_upgrade | `gift_paid_upgrade` object will have `gifter_is_anonymous` set to true. |
| raid | raid |  |
| unraid | unraid |  |
| bitsbadgetier | bits_badge_tier |  |

## IRC Commands with limited or no equivalent  {#irc-commands-with-limited-or-no-equivalent}

There are some IRC commands with limited equivalents, or none at all. This is for various reasons, and each one is mentioned here.

### JOIN, PART, and /NAMES  {#join-part-and-names}

When you joined a channel in IRC, and that channel had under 1,000 users in it, you were able to see what users were in the channel in two ways:

- When you join, a `/NAMES` list will be sent to you containing the users in the chatroom.
- When another user joins or leaves the chatroom, `JOIN` or `PART` will be sent by the server.

When running a chatbot using EventSub or API, you do not get notifications when a user leaves or joins a chatroom. Instead, you can only see who is in a chatroom if you are a moderator in the chatroom, or the broadcaster who owns the chatroom. This is performed using the [Get Chatters](/docs/api/reference/#get-chatters) API.

There are additional requirements to this API:

- Your token must be a User Access Token.
- You must authenticate the token with the **moderator:read:chatters** scope.
- The user in the token must be a moderator on the channel specified by `broadcaster_id`, or be the broadcaster specified.

An example of calling the Get Chatters API:

```
curl -X GET 'https://api.twitch.tv/helix/chat/chatters?broadcaster_id=123456&moderator_id=654321' \
-H 'Authorization: Bearer kpvy3cjboyptmiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfn0nyan9c87zr6t'

```

If successful, the response body will be a JSON object containing a `data` array, which is a list of all users in the chatroom. If there’s over 100 people, you’ll have to use the [pagination cursor](/docs/api/guide/#pagination) to get the rest of the users.

### PING and PONG  {#ping-and-pong}

The IRC commands `PING` and `PONG` have no replacement when using [Webhooks for EventSub](/docs/eventsub/handling-webhook-events/). This is because the Webhook connection is not persistent, and therefore does not need indications that the connection is still alive. This is unlike IRC which persists over either a TCP connection or WebSockets.

If you are using [WebSockets for EventSub](/docs/eventsub/handling-websocket-events/), the WebSocket standard has Ping frames, which must be responded to using Pong. For more information on this, see [Ping Message](/docs/eventsub/handling-websocket-events/#ping-message). Additionally, the EventSub WebSocket server will provide a [Keepalive message](/docs/eventsub/handling-websocket-events/#keepalive-message) that does not need to be responded to, but can be used by your client to ensure the connection to the server is still alive.

### RECONNECT  {#reconnect}

The IRC command `RECONNECT` has no replacement when using [Webhooks for EventSub](/docs/eventsub/handling-webhook-events/). This is because the Webhook connection is not persistent, and therefore cannot restart/reconnect. This is unlike IRC which persists over either a TCP connection or WebSockets.

If you are using [WebSockets for EventSub](/docs/eventsub/handling-websocket-events/), Twitch’s EventSub WebSocket server provides an Reconnect message before the connection is restarted. In that message, the server provides a URL to reconnect using, which reconnects your subscriptions to your chat channels made on that connection. For more information, see [Reconnect Message](/docs/eventsub/handling-websocket-events/#reconnect-message).

### NOTICE  {#notice}

Twitch IRC server would send `NOTICE` messages when events occur in the channel, such as a user subscribing to the channel. In EventSub and API, this was split in various ways for each NOTICE `msg-id`.

#### NOTICE messages related to sending chat messages  {#notice-messages-related-to-sending-chat-messages}

If you fail to send a chat message using Send Chat Message, information about why the chat message was dropped will be given in the response body, as part of the `drop_reason` object. For more information on this API response, see [Send Chat Message](/docs/api/reference/#send-chat-message) API reference.

#### NOTICE messages related to joining a chatroom  {#notice-messages-related-to-joining-a-chatroom}

If you attempt to join a chatroom and it fails for any reason, such as the user being banned from Twitch, or your account being banned from the streamer’s chat, the Create EventSub Subscription API call will fail with an HTTP 403 response code, and also will return the following response body:

```
{
    "error": "Forbidden",
    "status": 403,
    "message": "subscription missing proper authorization"
}

```

#### NOTICE messages related to being removed from a chatroom  {#notice-messages-related-to-being-removed-from-a-chatroom}

If you are removed from a chatroom for any reason, including being banned from the channel or being timed out, your EventSub subscription for all events related to that channel will be revoked. This can be viewed by calling [Get EventSub Subscriptions](/docs/api/reference/#get-eventsub-subscriptions).

Information about why you were removed will be indicated in the `status` of the subscription. An example of this when calling Get EventSub Subscriptions, after a user was banned from chat, can be here:

```
{
  "id": "2a2e1e29-1274-4758-a23d-e89f5b7dc9c5",
  "status": "chat_user_banned",
  "type": "channel.chat.message",
  "version": "1",
  "condition": {
    "broadcaster_user_id": "...",
    "user_id": "..."
  },
  "created_at": "2024-04-18T20:52:05.253689603Z",
  "transport": {
    ...
  },
  "cost": 0
}

```

For a list of possible statuses, see the `status` field of [Get EventSub Subscriptions](/docs/api/reference/#get-eventsub-subscriptions).

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
