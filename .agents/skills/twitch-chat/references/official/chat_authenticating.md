<!-- source: https://dev.twitch.tv/docs/chat/authenticating/ -->

Contents

# Authenticating and EventSub  {#authenticating-and-eventsub}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

## Registering your bot  {#registering-your-bot}

To get an access token, you must first register your bot. For information about registering your bot, see [Registering Your App](/docs/authentication/register-app/).

## Authenticating  {#authenticating}

After registering your bot and getting a client ID, you can generate an access token. You can use either a User Access Token or an App Access Token, depending on what type of chatbot you are making. For information about Access Tokens and managing Twitch OAuth tokens, see [Authentication](/docs/authentication/).

After determining what type of access token to use, and what scopes are required, you can get a token in a number of ways, including:

- Getting it programmatically. For more information, see [Getting OAuth Access Tokens](/docs/authentication/getting-tokens-oauth/).
- Using the [Twitch CLI](/docs/cli/). To get a token, use the CLI’s [token](/docs/cli/token-command#user-access-token) command.

If you just need a token for testing chat functionality, you can use the Twitch CLI to generate a User Access Token:
 `twitch token --user-token --scopes "user:read:chat user:write:chat"`

## What type of Access Token to use  {#what-type-of-access-token-to-use}

Each type of chatbot has a different Access Token and scope requirement.

### Cloud Chatbots  {#cloud-chatbots}

Since Cloud Chatbots use a user account owned by an application user, but need permission from the chat room’s broadcaster to read and write chat messages, you’ll need an **App Access Token**, and a **User Access Token** from the user who owns the chat room.

The App Access Token you’ll need is for the bot that will be reading and sending chat messages as the bot. This is only needed to be performed once and kept alive through [refreshing the access token](/docs/refresh-tokens/). This authentication requires 3 scopes minimum:

- `user:read:chat`, to read chat messages as the bot.
- `user:write:chat`, to write chat messages as the bot.
- `user:bot`, to grant permission to use this user as a bot when subscribing to EventSub.
- Additional scopes can be requested depending on what API calls you’d like to make as the bot account.

The User Access Token needed will be from the broadcaster who owns the chat room. This will be used for API calls that can only be performed as the broadcaster, such as [Get Creator Goals](/docs/api/reference#get-creator-goals). This authentication requires 1 scope minumum:

- `channel:bot`, to grant your Client ID permission to subscribe to chat-related EventSub subscriptions for the broadcaster’s channel.
- Additional scopes can be requested depending on what API calls you’d like to make on behalf of the broadcaster’s account.

### Installed Chatbots  {#installed-chatbots}

Installed Chatbots access the broadcaster’s user account to act as a bot, so only a single User Access Token from the broadcaster will be needed. This authentication only requires 1 scope minimum:

- `user:read:chat`, to read chat messages as the user.
- Optionally `user:write:chat`, to write chat messages as the user.
- Additional scopes can be requested depending on what API calls you’d like to make on behalf of the broadcaster’s account.

### Chat Clients  {#chat-clients}

Chat Clients, similar to Installed Chatbots, access the broadcaster’s user account to act as a bot. Unlike Installed Chatbots, sending chat messages is a part of chat clients, so this authentication requires 2 scopes minimum:

- `user:read:chat`, to read chat messages as the user.
- `user:write:chat`, to write chat messages as the user.
- Additional scopes can be requested depending on what API calls you’d like to make on behalf of the broadcaster’s account.

## Setting up EventSub Subscriptions  {#setting-up-eventsub-subscriptions}

To read chat messages and other chat events, you’ll need to set up an EventSub subscription.

### WebSockets vs Webhooks  {#websockets-vs-webhooks}

Before making your subscription, you’ll have to decide what EventSub transport you’d like to use. The options Twitch currently provides is **WebSockets** and **Webhooks**.

The **WebSocket** transport sends EventSub events to you over [WebSockets](https://websockets.spec.whatwg.org/), a protocol designed for persistent client-server communication within web browsers. Receiving EventSub events via WebSockets is the best option when a chatbot is hosted on the end-user’s system, such as in the case of Chat Clients and Installed Chatbots.
 You can only subscribe to events over WebSockets transport using a User Access Token.

The **Webhook** transport sends EventSub events to your public HTTP server via a [webhook](https://en.wikipedia.org/wiki/Webhook). Receiving EventSub events via Webhooks is the best option when a chatbot is hosted off of the end-user’s system, such as in the case of Cloud Chatbots. You can only subscribe to events over Webhook transport using an App Access Token.

For more information on handling WebSocket events, see [Getting Events Using WebSockets](/docs/eventsub/handling-websocket-events/).
 For more information on handling Webhook events, see [Getting Events Using Webhook Callbacks](/docs/eventsub/handling-webhook-events/).

### Making the subscription  {#making-the-subscription}

Creating the subscription is done by calling the [Create EventSub Subscription API](/docs/api/reference/#create-eventsub-subscription).

Each subscription type has a different `condition` object that needs to be filled in. For chat subscription types, you’ll need to set the chat’s broadcaster in `broadcaster_user_id` and your bot’s User ID in `user_id`.
 For further information on each subscription type, see [EventSub Subscription Types](/docs/eventsub/eventsub-subscription-types/).

An example of subscribing to [channel.chat.message](/docs/eventsub/eventsub-subscription-types/#channelchatmessage), where the broadcaster is User ID `12826` (Twitch) and the bot authorized is User ID `141981764` (TwitchDev):

```
curl -X POST 'https://api.twitch.tv/helix/eventsub/subscriptions' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz' \
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
    "callback": "https://your-webhook-handling-server.com",
    "secret":"s3cre7"
  }
}'

```

For more information on managing EventSub subscriptions, see [Managing EventSub Subscriptions](/docs/eventsub/manage-subscriptions/).

## Scaling WebSockets with conduits  {#scaling-websockets-with-conduits}

When your bot starts handling a large amount of users, scaling up requires taking into consideration load balancing. When using WebSockets specifically it can be difficult to handle scaling, so to ease this Twitch provides a wrapper transport type to assist with load balancing called [Conduits](/docs/eventsub/handling-conduit-events/).

Conduits is designed to allow you to tell Twitch what WebSocket connection or Webhook endpoint you want specific EventSub subscriptions to go to, each of these endpoints being referred to as a “shard”. For chat messages, this means an EventSub subscription for listening to a specific chat room’s chat messages will only send those messages to the specified shard.

Conduits can only be managed using App Access Tokens, but the transports of the subscriptions assigned to each conduit shard can be created using a User Access Token or an App Access Token.

For more information on managing and scaling with conduits, see [Handling Conduit Events](/docs/eventsub/handling-conduit-events/).

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
