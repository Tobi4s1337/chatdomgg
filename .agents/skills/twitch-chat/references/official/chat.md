<!-- source: https://dev.twitch.tv/docs/chat/ -->

Contents

# Twitch Chat & Chatbots  {#twitch-chat--chatbots}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

Chat is an essential part of the Twitch experience, allowing community members, streamers, chatbots to interact with each other in real time.
 Twitch provides [EventSub](/docs/eventsub/) interfaces for reading information about Twitch chat rooms and their chat messages. For large scale chat integrations, such as chatbots reading multiple large chats, an [additional wrapper](/docs/eventsub/handling-conduit-events/) is provided for loadbalancing.
 Twitch also provides API calls to send messages to a chat room, and send messages directly to another user.

The preferred method of viewing and sending chats on Twitch is through EventSub and Twitch API, but Twitch historically has an [IRC interface](/docs/chat/irc/), based on a modified RFC1459 and IRCv3 Message Tag specification. Twitch IRC has limited features, and for full chatbot functionality some API calls will need to be made, such as in the case of [using chat commands](/docs/chat/send-receive-messages/).

For the best possible experience within your chat integration, we recommend reading through the concepts described in this documentation series. However, for a simple example to get you started quickly, see [Example Chatbot](/docs/chat/chatbot-guide/).

## What is a chatbot?  {#what-is-a-chatbot}

The term “chatbot” is used to describe a 3rd party software is acting on behalf of a user in one or more Twitch chat rooms. This means they can act as if they were a specific Twitch account, appearing the same in Twitch Chat as any other real user.

In the case of Installed Chatbots, the application will act on behalf of a Twitch account provided by the end-user.
 In the case of Cloud Chatbots, the application can act either on behalf a Twitch account provided by the end-user, or a Twitch account owned by the creator of the application.

Further information about each type of chatbot is described below in “**Deciding what kind of chatbot to build**”.

Chatbots can send and receive chat messages, see when messages are deleted or cleared, and see [notifications](/docs/eventsub/eventsub-subscription-types/#channelchatnotification) in a chat room. If granted moderator permissions, or acting on behalf of the broadcaster, chatbots can also read and perform moderator actions including deleting or clearing chat messages, updating chat room settings, sending announcements, and seeing what users are in chat.

## Deciding what kind of chatbot to build  {#deciding-what-kind-of-chatbot-to-build}

When building any kind of Twitch Chatbot, the context of the application is important to consider before beginning development.

There are 3 contexts of a chatbot: **Cloud Chatbots**, **Installed Chatbots**, and **Chat Clients**.

### Cloud Chatbots  {#cloud-chatbots}

**Cloud Chatbots** are a type of chatbot that are hosted off of the end-user’s system. They are often designed to run at massive scales, aiming to support a large portion of Twitch’s userbase. These chatbots are the most commonly known type of chatbot to the general public.

A user will never have to install any type of software to use this type of chatbot, but they may still need to authenticate the chatbot, or make the chatbot’s Twitch user a moderator in their chat.

### Installed Chatbots  {#installed-chatbots}

**Installed Chatbots** are a type of chatbot that are hosted on the end-user’s system. This includes standalone chatbot programs, meant to replicate the features of a Cloud Chatbot but hosted on the user’s system, and also chatbots within other types of applications such as OBS Overlays, and games.

Users will need to authenticate for these chatbots to work.

### Chat Clients  {#chat-clients}

A **Chat Client** is an interface intended to provide access to Twitch chat similar to Twitch’s regular chat interface. This is primarily implemented for specific use cases, such as moderation and flexible UI. Some examples of this would include a standalone program that allows for accessing specific moderation tooling quickly, and terminal-based programs that allow you to access Twitch chat from a [virtual terminal](https://en.wikipedia.org/wiki/Terminal_emulator).

Users will need to authenticate for the chat client to read and write to Twitch chat.

## Rate Limits  {#rate-limits}

Twitch Chat has four limits to take into consideration:

- Twitch API Rate Limits
- Twitch Chat Rate Limits
- Concurrent Join Limits
- Join Rate Limits

### Twitch API Rate Limits  {#twitch-api-rate-limits}

When using the [Send Chat Message API](/docs/api/reference/#send-chat-message), the `Ratelimit-Limit` header may return a different number than your regular rate limit bucket size, often much bigger than usual. The rate limit bucket this API uses is separate from your regular rate limit bucket, and using the Send Chat Message API will not decrease your regular bucket.

For more information on rate limit buckets, see [Twitch API Rate Limits](/docs/api/guide#twitch-rate-limits).

### Twitch Chat Rate Limits  {#twitch-chat-rate-limits}

Twitch’s chat backend also enforces its own seperate limits on sending chat messages.

The following tables show the rate limits for the number of messages that your chatbot may send. If you exceed these limits, Twitch ignores the bot messages for 1 hour, except in chats where the chatbot’s user account is the broadcaster, a moderator, or a VIP.

**The following table shows the send message rate limits for a regular account.**

| Limit | Description |
|---|---|
| 20 Messages per 30 seconds | If the user **is not** the channel’s broadcaster, a moderator, or a VIP, the bot may send a maximum of 20 messages per 30 seconds. |
| 100 messages per 30 seconds | If the user **is** the channel’s broadcaster, a moderator, or a VIP, the bot may send a maximum of 100 messages per 30 seconds.  **NOTE:** Messages by a user who is a broadcaster, moderator, or VIP will still add to the 20 messages per 30 seconds rate limit, but when that is breached messages from these users can still be sent until the larger rate limit bucket is filled. |
| 1 message per second per channel | If the user **is not** the channel’s broadcaster, a moderator, or a VIP, the bot may send a maximum of 1 message per second per channel. |

**The following table shows the send message rate limits for a verified account.**

| Limit | Description |
|---|---|
| 7500 messages per 30 seconds | Verified bots can send 7500 messages per 30 seconds. This limit **does not** take into consideration if the user is the channels broadcaster, a moderator, or a VIP. |
| 1 message per second per channel | If the user **is not** the channel’s broadcaster, a moderator, or a VIP, the bot may send a maximum of 1 message per second per channel. |

All of the above limits are per user, unless otherwise stated. If 10 users are running the bot on a single bot account, the rate limit applies across all 10 users (meaning that the 10 users combined can send a total of 20 messages). If each user is using a different bot account, each bot account has its own rate limit (meaning that each user can send 20 messages).

### Concurrent Join Limits  {#concurrent-join-limits}

Twitch imposes limits for how many chat rooms you can join from a single user account. As of May 15th 2024, the limit is set to **100**.

Joining a chat room occurs only when you subscribe to the [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub subscription, or use the `JOIN` command in IRC. The following actions do not count towards your global Concurrent Join Limit:

- Joining a chat room as the broadcaster or as a moderator user
- Joining a chat room after being authorized by the chat room’s broadcaster. This is done by the broadcaster authorizing a [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub subscription with an App Access Token and the `channel:bot` scope.

Joining a chat room as the broadcaster or as a moderator will not count towards your global Concurrent Join Limit.

Subscribing to **Channel Chat Message** keeps your connection to the chat room open until the subscription is [no longer enabled](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/).

### Join Rate Limits  {#join-rate-limits}

When using IRC, and EventSub or Twitch API using a User Access Token, Twitch imposes rate limits for how quickly you can join channels.

**The following shows the join rate limits for a normal account.**

- 20 join attempts per 10 seconds per user.
- 20 authentication attempts per 10 seconds per user. **(IRC only)**

**The following shows the join rate limits for a verified account.**

- 2,000 join attempts per 10 seconds per user.
- 200 authentication attempts per 10 seconds per user. **(IRC only)**

When using an App Access Token for [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub subscription, the above limits are not applicable.

## Chatbot Badge and Chat Identity  {#chatbot-badge-and-chat-identity}

Chatbots can visually indicate in a Twitch channel when they are programmatically sending or receiving chat messages. This is provided in the form of a [Chat Badge](https://help.twitch.tv/s/article/how-to-use-badges) when sending messages, and recategorization of the chatbot user in [**Users in Chat**](https://help.twitch.tv/s/article/understanding-viewer-count-vs-users-in-chat), also commonly referred to as the “chatters list,” to appear under the segment **Chat Bots**.

For a chatbot to display the **Chat Bot Badge** when sending a message, it must meet the following requirements:

- A message sent by the chatbot must use the [Send Chat Message API](/docs/api/reference/#send-chat-message).
- A message sent by the chatbot must use an App Access Token.
- The chatbot must either have the `channel:bot` scope authorized by the broadcaster of the channel it is sending a message in, or have moderator status in the broadcaster’s channel. For information on obtaining this authorization, see [Authenticating Cloud Chatbots](/docs/chat/authenticating/#cloud-chatbots).
- The chatbot’s user account is not the channel’s broadcaster.

When these requirements are met, the Chat Bot Badge will take the position of your bot’s global vanity badge. For more information on the apperance of this badge and others, see [How to Use Badges](https://help.twitch.tv/s/article/how-to-use-badges) and [Twitch Chat Badges Guide](https://help.twitch.tv/s/article/twitch-chat-badges-guide).

For a chatbot to appear under **Chat Bots** within **Users in Chat**, it must meet the following requirements:

- The chatbot must be listening for chat messages using the [Channel Chat Message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage) EventSub event.
- The chatbot must use an App Access Token when subscribed to the Channel Chat Message EventSub event.
- The chatbot must have the `channel:bot` scope authorized by the broadcaster of the channel it is listening for messages in.
- The chatbot’s user account is not the channel’s broadcaster.

Due to these requirements, chatbots that utilize User Access Tokens will not appear in chat with the Chat Bot Badge, and chatbots utilizing EventSub WebSockets or IRC for reading chat messages will not appear as a Chat Bot in Users in Chat. In addition, the broadcaster of a channel will never appear with the chatbot badge.

## Verified Bots  {#verified-bots}

As a chatbot grows in popularity, it’s likely that it may approach or exceed the rate limits. Chatbots that enhance the Twitch user experience and have reached these limits may apply for verified bot status, but note that verified bot status is rarely granted. A bot with verified bot status enjoys:

- Higher chat message limits than regular Twitch accounts.
- Higher authentication and join limits than regular Twitch accounts.

But they:

- Don’t have higher whisper limits than regular Twitch accounts.
- Aren’t exempt from AutoMod mode. AutoMod analyzes chat messages and flags potentially risky messages for a channel moderator, who can then allow them to or prevent them from appearing in chat.

### Requesting Verified Bot status  {#requesting-verified-bot-status}

If a chatbot has reached the rate limits for messages, authentications, or joins; the bot’s developer may request verified bot status. To request verified bot status, go to [IRC Command and Message Rate](https://dev.twitch.tv/limit-increase) and fill out the form. After Twitch reviews the request, Twitch sends its determination to the requestor via email.

**Note:** This verification does not grant you the Chat Bot Badge. For access to that, see Chatbot Badge and Chat Identity

## Next Steps  {#next-steps}

- Read more about [Authenticating and Setting up EventSub](/docs/chat/authenticating/) for your chatbot.
- Check out the [Example Chatbot](/docs/chat/chatbot-guide/) to get your first chatbot running in a matter of minutes.
- For help, post questions in the chat category on the [Twitch developer forums](https://discuss.dev.twitch.tv/c/chat), or join the [TwitchDev Discord server](https://link.twitch.tv/devchat).

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
