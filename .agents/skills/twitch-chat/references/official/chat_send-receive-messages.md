<!-- source: https://dev.twitch.tv/docs/chat/send-receive-messages/ -->

Contents

# Sending and Receiving Chat Messages  {#sending-and-receiving-chat-messages}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

## Sending chat messages  {#sending-chat-messages}

Sending chat messages is performed using the [Send Chat Message API](/docs/api/reference/#send-chat-message). You’ll perform this filling in the `broadcaster_id` with the chat channel owner’s User ID, and with `sender_id` being your bot’s User ID. You can optionally reply to another chat message, filling in `reply_parent_message_id` with the Message ID of the message you wish to reply to.

An example of sending a regular chat message with the message “Hello world! HeyGuys”:

```
curl -X POST 'https://api.twitch.tv/helix/chat/messages' \
-H 'Authorization: Bearer kpvy3cjboyptmdkiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{
  "broadcaster_id": "12826",
  "sender_id": "141981764",
  "message": "Hello, World! HeyGuys"
}'

```

**NOTE:** Sending emotes, such as HeyGuys, is done by typing in the case-sensitive name of the emote as-is.

An example of sending a chat message in reply to someone else:

```
curl -X POST 'https://api.twitch.tv/helix/chat/messages' \
-H 'Authorization: Bearer kpvy3cjboyptmdkiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{
  "broadcaster_id": "12826",
  "sender_id": "141981764",
  "message": "Hello, World! HeyGuys",
  "reply_parent_message_id": "142f46b8-a159-4c58-a5b0-30a13142dddc"
}'

```

After calling the API, it will reply with additional data about the chat message, including the Message ID, and if the message was sent or not. An example of a successfully sent chat message:

```
{
  "data": [
    {
      "message_id": "142f46b8-a159-4c58-a5b0-30a13142dddc",
      "is_sent": true,
      "drop_reason": null
    }
  ]
}

```

If the message wasn’t sent, no Message ID will be given, but additional information will be provided on why it was not sent. An example of a chat message that was not successfully sent:

```
{
  "data": [
    {
      "message_id": "",
      "is_sent": false,
      "drop_reason": {
        "code": "automod_held",
        "message": "Your message has been held for review by Automod."
      }
    }
  ]
}

```

## Sending chat announcements  {#sending-chat-announcements}

Announcements are a type of chat message that is highlighted to end-users. Announcements cannot be send using the Send Chat Message API, and instead need to use the [Send Chat Announcement API](/docs/api/reference/#send-chat-announcement).

The concept is the same as sending a regular chat message, but you cannot send it as a reply to another chat message, and you additionally can change the color of the announcement banner.

An example of sending an announcement is seen here:

```
curl -X POST 'https://api.twitch.tv/helix/chat/announcements?broadcaster_id=12826&moderator_id=141981764' \
-H 'Authorization: Bearer kpvy3cjboyptmdkiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{
  "message": "Event is starting in 20 minutes!",
  "color": "purple"
}'

```

## Receiving chat messages  {#receiving-chat-messages}

Chat messages are received using EventSub’s [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage). This EventSub subscription lets you receive standard chat messages from a specific chat channel, using the bot account specified in `user_id`. The `user_id` will have to be the bot you authorized with earlier.

To subscribe to this, you first need to call [Create EventSub Subscription](/docs/api/reference/#create-eventsub-subscription), like this:

```
curl -X POST 'https://api.twitch.tv/helix/eventsub/subscriptions' \
-H 'Authorization: Bearer kpvy3cjboyptmdkiacwr0c19hotn5s' \
-H 'Client-Id: hof5gwx0su6owfnys0nyan9c87zr6t' \
-H 'Content-Type: application/json' \
-d '{
  "type": "channel.chat.message",
  "version": "1",
  "condition": {
    "broadcaster_user_id": "12826",
    "user_id": "141981764"
  },
  "transport": {
    "method": "webhook",
    "callback": "https://your-callback-url-here.example",
    "secret": "s3cre7"
  }
}'

```

You’ll need to replace the `transport` field with the information about the transport you’re using to receive events, such as Webhook or WebSockets. You will also need to change the `broadcaster_user_id` to your target chat channel.

If you are banned or timed out from the chat channel you are trying to join, this request will return a 403 HTTP status code, and the message “subscription missing proper authorization”. The same message is given if joining that chat channel would breach your [concurrent join limit](/docs/chat/#rate-limits).

After a subscription is successfully created, you’ll be able to receive notifications to your Webhook server or WebSocket connection.

An example of the [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub subscription notification:

```
{
  "subscription": {
    "id": "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    "status": "enabled",
    "type": "channel.chat.message",
    "version": "1",
    "condition": {
      "broadcaster_user_id": "12826",
      "user_id": "141981764"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2023-11-06T18:11:47.492253549Z",
    "cost": 0
  },
  "event": {
    "broadcaster_user_id": "12826",
    "broadcaster_user_login": "twitch",
    "broadcaster_user_name": "Twitch",
    "chatter_user_id": "141981764",
    "chatter_user_login": "twitchdev",
    "chatter_user_name": "TwitchDev",
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
    "channel_points_custom_reward_id": null
  }
}

```

Sometimes the subscription can be removed, such as in the case of your bot being banned or timed out from the chatroom. Notifications about this will come in the form of a revocation message. In the case of timeouts, no information is given about the length of the timeout.

For handling revocations when subscribed using Webhooks, see [Handling Webhook Events](/docs/eventsub/handling-webhook-events/#revoking-your-subscription).
 For handling revocations when subscribed using WebSockets, see [Handling WebSocket Events](/docs/eventsub/handling-websocket-events/#revocation-message).

## Handling Emotes  {#handling-emotes}

An important part of the culture in Twitch Chat is [Twitch Emotes](https://www.twitch.tv/creatorcamp/paths/getting-started-on-twitch/emotes/). Some of these include the famous PogChamp, Kappa, and LUL.

In chat messages, Emotes are sent and received as plaintext. When sending chat messages to your chatbot using EventSub, Twitch will break up the message into fragments to help describe what each portion is. One of these fragments is of the type `emote`, which indicates that further information will be given about the emote.

An example of this, shortened to just the `message` object within a notification from a Channel Chat Message subscription:

```
"message": {
  "text": "RAID TombRaid RAID twitchRaid RAID",
  "fragments": [
    {
      "type": "text",
      "text": "RAID ",
      "cheermote": null,
      "emote": null,
      "mention": null
    },
    {
      "type": "emote",
      "text": "TombRaid",
      "cheermote": null,
      "emote": {
        "id": "864205",
        "emote_set_id": "0",
        "owner_id": "0",
        "format": [
          "static"
        ]
      },
      "mention": null
    },
    {
      "type": "text",
      "text": " RAID ",
      "cheermote": null,
      "emote": null,
      "mention": null
    },
    {
      "type": "emote",
      "text": "twitchRaid",
      "cheermote": null,
      "emote": {
        "id": "62836",
        "emote_set_id": "0",
        "owner_id": "0",
        "format": [
          "static"
        ]
      },
      "mention": null
    },
    {
      "type": "text",
      "text": " RAID",
      "cheermote": null,
      "emote": null,
      "mention": null
    }
  ]
}

```

To get the image file for the emote, you will need to fill in the URL template you get from the Emote APIs. For example, the twitchRaid image file would be at the URL `https://static-cdn.jtvnw.net/emoticons/v2/62836/static/light/3.0`

If you want to know what Emotes are available for a given channel, your authenticated user, or globally, we provide the following API endpoints:

- [Get Global Emotes API](/docs/api/reference/#get-global-emotes), to get all global Twitch Emotes.
- [Get Channel Emotes API](/docs/api/reference/#get-channel-emotes), to get Emotes available for a given channel.
- [Get User Emotes API](/docs/api/reference/#get-user-emotes), to get Emotes available for use by your own user. This requires a User Access Token.

## Chat Badges  {#chat-badges}

Along with nearly every chat message on Twitch, there is a user’s [Chat Badges](https://help.twitch.tv/s/article/twitch-chat-badges-guide) to the left of their username.

When receiving chat messages through EventSub, the badges attached to a user’s message will be listed in the message. These should be read for each message and not stored for repeating across several messages, as a user may change their chat badges at any time.

An example of this, shortened to just the `badges` object within a notification from a Channel Chat Message subscription:

```
"badges": [
  {
    "set_id": "staff",
    "id": "1",
    "info": ""
  },
  {
    "set_id": "subscriber",
    "id": "6",
    "info": "6"
  },
  {
    "set_id": "bits",
    "id": "100",
    "info": ""
  }
]

```

To identify what each badge looks like, you’ll need to have called two endpoints and stored them in memory:

- [Get Global Chat Badges API](/docs/api/reference/#get-global-chat-badges), for all global chat badges.
- [Get Channel Chat Badges API](/docs/api/reference/#get-channel-chat-badges), for all chat badges unique to the current chat channel you’re in.

In the above example, the `set_id` of staff would be available through **Get Global Chat Badges**, while the subscriber and bits badges would be available through **Get Channel Chat Badges** for the channel the chat message was sent in.

## Reading events in chat  {#reading-events-in-chat}

Alongside messages, Twitch Chat also can send events related to the chat room and its messages. Some of these include deleting messages, subscriptions, and updates to chat moderation settings.

### Channel Chat Notification  {#channel-chat-notification}

Twitch provides a generic subscription type for a large amount of chat notifications. In [Twitch’s IRC](/docs/chat/irc/), this is handled by the USERNOTICE message. Possible notice types include:

- User Subscriptions and Gifted Subscriptions
- Raids and cancellation of raids
- Chat Announcements
- [Charity Donations](https://help.twitch.tv/s/article/charitable-donations)

For a full list, see the `notice_type` object in the [EventSub Reference](/docs/eventsub/eventsub-reference/#channel-chat-notification-event) for Channel Chat Notification.

Despite this event covering a lot of various different notifications related to Twitch Chat, there are some others that have their own separate events.

### Deleting and Clearing Messages  {#deleting-and-clearing-messages}

When a moderator deletes a user’s messages, or clears the entire chat of all of its messages, Twitch will send relevant events to each action:

- [Channel Chat Message Delete](/docs/eventsub/eventsub-subscription-types/#channelchatmessage_delete), sent when deleting an individual message, indicated by its `message_id`.
- [Channel Chat Clear User Messages](/docs/eventsub/eventsub-subscription-types/#channelchatclear_user_messages), sent when deleting all messages from a specific user, indicated by their User ID.
- [Channel Chat Clear](/docs/eventsub/eventsub-subscription-types/#channelchatclear), sent when clearing all message currently seen by the user in chat. This will not mark the messages as deleted, but instead reset all non-moderator chats to an empty state.

### Chat Settings Update  {#chat-settings-update}

There are a few moderation settings that can set for a chat that change how users send messages in it, including:

- **Emote-only Mode**, which causes the chat to drop any messages that contain anything other than Twitch Emotes.
- **Follower-only Mode**, which requires chatting users to follow the channel for a moderator-defined period of time.
- **Subscriber-only Mode**, which requires chatting users to subscribe to the channel to be able to chat.
- **Slow Mode**, which requires users to wait a moderator-defined period of time between messages sent.
- **Unique Chat Mode**, which requires a user’s chat messages to be unique and at least 9 characters long.

The [Channel Chat Settings Update](/docs/eventsub/eventsub-subscription-types/#channelchat_settingsupdate) EventSub event will be sent whenever a channel’s chat settings are updated.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
